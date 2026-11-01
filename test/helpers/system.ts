import type { SystemStats } from '../../src/domain/types.js';
import type { SysfsDeps } from '../../src/collectors/system/sysfs.js';

export const GB = 1024 ** 3;

export function makeSystemStats(over: Partial<SystemStats> = {}): SystemStats {
  return {
    sampledAt: 0,
    cpu: { total: 42, perCore: [10, 50, 90, 100] },
    mem: { used: 5.1 * GB, total: 15.6 * GB },
    swap: { used: 0.5 * GB, total: 2 * GB },
    disk: { used: 100 * GB, total: 500 * GB, mount: '/' },
    net: { rxPerSec: 1.2 * 1024 ** 2, txPerSec: 34 * 1024 },
    load: [1.2, 0.9, 0.8],
    ...over,
  };
}

/** Every optional metric populated, with values from a real Lenovo V15 G4 scan. */
export function makeFullSystemStats(over: Partial<SystemStats> = {}): SystemStats {
  return makeSystemStats({
    temps: [
      { label: 'CPU', celsius: 65.75 },
      { label: 'GPU', celsius: 48 },
      { label: 'Board', celsius: 53 },
      { label: 'WiFi', celsius: 40 },
      { label: 'SSD', celsius: 33.85, warn: 78.85, crit: 83.85 },
    ],
    battery: { percent: 98, status: 'Not charging', healthPercent: 92.3, cycles: 40 },
    uptimeSec: 4171,
    cpuFreq: { curHz: 4.17e9, maxHz: 4.55e9 },
    powerProfile: 'balanced',
    gpu: { busyPercent: 1, vramUsed: 936 * 1024 ** 2, clockHz: 200e6, watts: 18 },
    pressure: { mem: 0.63, cpu: 0.57, io: 0 },
    diskIo: { readPerSec: 0, writePerSec: 1024 ** 2 },
    procs: { processes: 552, threads: 2926 },
    link: { iface: 'wlp2s0', ip: '192.168.1.160', signalDbm: -47, vpn: 'tailscale0' },
    ...over,
  });
}

/** In-memory sysfs: file contents keyed by absolute path; directories are inferred. */
export function fakeSysfs(files: Record<string, string>): SysfsDeps & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    readFile: async (p) => {
      reads.push(p);
      const v = files[p];
      if (v === undefined) throw new Error(`ENOENT ${p}`);
      return v;
    },
    readdir: async (p) => {
      const prefix = `${p}/`;
      const names = new Set<string>();
      for (const k of Object.keys(files)) {
        if (k.startsWith(prefix)) names.add(k.slice(prefix.length).split('/')[0]!);
      }
      if (names.size === 0) throw new Error(`ENOENT ${p}`);
      return [...names];
    },
  };
}
