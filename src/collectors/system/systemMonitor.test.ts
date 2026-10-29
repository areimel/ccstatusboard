import { describe, expect, it } from 'vitest';
import type { SystemStats } from '../../domain/types.js';
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
    readFile: async (p) =>
      p === '/proc/meminfo'
        ? 'MemTotal: 100 kB\nMemAvailable: 40 kB\nSwapTotal: 10 kB\nSwapFree: 10 kB\n'
        : netSamples[Math.min(n++, 1)]!,
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
