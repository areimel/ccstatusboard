import { describe, expect, it } from 'vitest';
import type { SystemStats } from '../../domain/types.js';
import { fakeSysfs } from '../../../test/helpers/system.js';
import { SystemMonitor, type SystemMonitorDeps } from './systemMonitor.js';

const t = (
  user: number,
  idle: number,
): { user: number; nice: number; sys: number; idle: number; irq: number } => ({
  user,
  nice: 0,
  sys: 0,
  idle,
  irq: 0,
});
const net = (rx: number, tx: number): string =>
  `h\nh\n  eth0: ${rx} 1 0 0 0 0 0 0 ${tx} 1 0 0 0 0 0 0\n    lo: 5 1 0 0 0 0 0 0 5 1 0 0 0 0 0 0\n`;

function makeDeps(over: Partial<SystemMonitorDeps> = {}): {
  deps: Partial<SystemMonitorDeps>;
  clock: { ms: number };
} {
  const clock = { ms: 1000 };
  const cpuSamples = [[t(0, 0)], [t(50, 50)]];
  const netSamples = [net(0, 0), net(4000, 2000)];
  let c = 0;
  let n = 0;
  const deps: Partial<SystemMonitorDeps> = {
    platform: 'linux',
    cpus: () => cpuSamples[Math.min(c++, 1)]!,
    loadavg: () => [1, 2, 3],
    totalmem: () => 0,
    freemem: () => 0,
    readFile: async (p) => {
      if (p === '/proc/meminfo')
        return 'MemTotal: 100 kB\nMemAvailable: 40 kB\nSwapTotal: 10 kB\nSwapFree: 10 kB\n';
      if (p === '/proc/net/dev') return netSamples[Math.min(n++, 1)]!;
      throw new Error(`ENOENT ${p}`);
    },
    readdir: async () => {
      throw new Error('ENOENT');
    },
    uptime: () => 4171,
    networkInterfaces: () => ({}),
    statfs: async () => ({ blocks: 100, bfree: 50, bsize: 10 }),
    exec: async () => '',
    now: () => clock.ms,
    ...over,
  };
  return { deps, clock };
}

describe('SystemMonitor.sample', () => {
  it('produces deltas across two samples', async () => {
    const { deps, clock } = makeDeps();
    const m = new SystemMonitor({ onUpdate: () => {} }, deps);
    const a = await m.sample();
    expect(a.cpu.total).toBe(0);
    expect(a.net).toEqual({ rxPerSec: 0, txPerSec: 0 });
    clock.ms += 2000;
    const b = await m.sample();
    expect(b.cpu.total).toBeCloseTo(50);
    expect(b.net).toEqual({ rxPerSec: 2000, txPerSec: 1000 });
    expect(b.mem).toEqual({ used: 60 * 1024, total: 100 * 1024 });
    expect(b.disk).toEqual({ used: 500, total: 1000, mount: '/' });
    expect(b.load).toEqual([1, 2, 3]);
    expect(b.sampledAt).toBe(3000);
  });

  it('falls back to zeros when statfs fails', async () => {
    const { deps } = makeDeps({
      statfs: async () => {
        throw new Error('nope');
      },
    });
    const s = await new SystemMonitor({ mount: '/mnt', onUpdate: () => {} }, deps).sample();
    expect(s.disk).toEqual({ used: 0, total: 0, mount: '/mnt' });
    expect(s.mem.total).toBeGreaterThan(0);
  });

  it('survives readFile failures', async () => {
    const { deps } = makeDeps({
      readFile: async () => {
        throw new Error('x');
      },
    });
    const s = await new SystemMonitor({ onUpdate: () => {} }, deps).sample();
    expect(s.mem).toEqual({ used: 0, total: 0 });
    expect(s.net).toEqual({ rxPerSec: 0, txPerSec: 0 });
  });

  it('uses exec on darwin', async () => {
    const calls: string[] = [];
    const { deps } = makeDeps({
      platform: 'darwin',
      totalmem: () => 1000,
      freemem: () => 250,
      exec: async (cmd, args) => {
        calls.push(`${cmd} ${args.join(' ')}`);
        return cmd === 'sysctl' ? 'total = 1.00M  used = 0.50M  free = 0.50M' : '';
      },
    });
    const s = await new SystemMonitor({ onUpdate: () => {} }, deps).sample();
    expect(calls).toEqual(['sysctl -n vm.swapusage', 'netstat -ibn']);
    expect(s.mem).toEqual({ used: 750, total: 1000 });
  });
});

describe('SystemMonitor extra metrics', () => {
  const route =
    'Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\n wlp2s0\t00000000\t0\t3\t0\t0\t100\n';
  const stat = (read: number, written: number): string =>
    ` 259 0 nvme0n1 1 1 ${read} 1 1 1 ${written} 1 0 0 0`;

  function linuxFiles(sectors: { read: number; written: number }): Record<string, string> {
    return {
      '/proc/meminfo': 'MemTotal: 100 kB\nMemAvailable: 40 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n',
      '/proc/net/dev': net(0, 0),
      '/proc/net/route': route,
      '/proc/diskstats': stat(sectors.read, sectors.written),
      '/proc/pressure/memory': 'some avg10=0.63 avg60=0 avg300=0 total=0\n',
      '/proc/loadavg': '1 2 3 2/2926 195361\n',
      '/proc/1/stat': 'x',
      '/sys/class/hwmon/hwmon4/name': 'k10temp',
      '/sys/class/hwmon/hwmon4/temp1_input': '65750',
      '/sys/class/power_supply/BAT0/type': 'Battery',
      '/sys/class/power_supply/BAT0/capacity': '98',
      '/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq': '4167329',
      '/sys/firmware/acpi/platform_profile': 'balanced',
      '/sys/class/drm/card1/device/gpu_busy_percent': '1',
    };
  }

  it('fills every group on linux and rates disk IO across samples', async () => {
    const sectors = { read: 0, written: 0 };
    const fs = (): ReturnType<typeof fakeSysfs> => fakeSysfs(linuxFiles(sectors));
    const { deps, clock } = makeDeps({
      readFile: (p) => fs().readFile(p),
      readdir: (p) => fs().readdir(p),
    });
    const m = new SystemMonitor({ onUpdate: () => {} }, deps);
    const a = await m.sample();
    expect(a.diskIo).toEqual({ readPerSec: 0, writePerSec: 0 });
    sectors.read = 8;
    clock.ms += 2000;
    const b = await m.sample();
    expect(b.diskIo).toEqual({ readPerSec: 2048, writePerSec: 0 });
    expect(b.temps?.[0]).toMatchObject({ label: 'CPU', celsius: 65.75 });
    expect(b.battery?.percent).toBe(98);
    expect(b.uptimeSec).toBe(4171);
    expect(b.cpuFreq?.curHz).toBe(4167329000);
    expect(b.powerProfile).toBe('balanced');
    expect(b.gpu?.busyPercent).toBe(1);
    expect(b.pressure?.mem).toBe(0.63);
    expect(b.procs).toEqual({ processes: 1, threads: 2926 });
    expect(b.link).toEqual({ iface: 'wlp2s0' });
  });

  it('keeps other metrics when one group throws', async () => {
    const { deps } = makeDeps({
      readFile: (p) => {
        if (p === '/proc/net/route') return Promise.reject(new Error('EIO'));
        return fakeSysfs(linuxFiles({ read: 0, written: 0 })).readFile(p);
      },
      readdir: (p) => fakeSysfs(linuxFiles({ read: 0, written: 0 })).readdir(p),
    });
    const s = await new SystemMonitor({ onUpdate: () => {} }, deps).sample();
    expect(s.link).toBeUndefined();
    expect(s.temps).toHaveLength(1);
    expect(s.battery?.percent).toBe(98);
  });

  it('survives uptime throwing', async () => {
    const { deps } = makeDeps({
      uptime: () => {
        throw new Error('x');
      },
    });
    const s = await new SystemMonitor({ onUpdate: () => {} }, deps).sample();
    expect(s.uptimeSec).toBeUndefined();
  });

  it('reads only uptime on darwin, touching no linux paths', async () => {
    const paths: string[] = [];
    const { deps } = makeDeps({
      platform: 'darwin',
      readFile: async (p) => {
        paths.push(p);
        return '';
      },
      readdir: async (p) => {
        paths.push(p);
        return [];
      },
      exec: async () => '',
      totalmem: () => 1000,
      freemem: () => 250,
    });
    const s = await new SystemMonitor({ onUpdate: () => {} }, deps).sample();
    expect(paths).toEqual([]);
    expect(s.uptimeSec).toBe(4171);
    for (const k of [
      'temps',
      'battery',
      'cpuFreq',
      'powerProfile',
      'gpu',
      'pressure',
      'diskIo',
      'procs',
      'link',
    ] as const) {
      expect(s[k]).toBeUndefined();
    }
  });
});

describe('SystemMonitor start/stop', () => {
  it('schedules via injected setTimeout and calls onUpdate', async () => {
    const { deps } = makeDeps();
    const scheduled: { fn: () => void; ms: number }[] = [];
    const cleared: unknown[] = [];
    const updates: SystemStats[] = [];
    const m = new SystemMonitor(
      { intervalMs: 500, onUpdate: (s) => updates.push(s) },
      {
        ...deps,
        setTimeout: (fn, ms) => {
          scheduled.push({ fn, ms });
          return scheduled.length;
        },
        clearTimeout: (h) => cleared.push(h),
      },
    );
    m.start();
    await new Promise((r) => setImmediate(r));
    expect(updates).toHaveLength(1);
    expect(scheduled.map((s) => s.ms)).toEqual([500]);
    scheduled[0]!.fn();
    await new Promise((r) => setImmediate(r));
    expect(updates).toHaveLength(2);
    m.stop();
    expect(cleared).toEqual([2]);
    scheduled[1]!.fn();
    await new Promise((r) => setImmediate(r));
    expect(updates).toHaveLength(2);
  });
});
