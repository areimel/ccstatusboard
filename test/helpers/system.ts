import type { SystemStats } from '../../src/domain/types.js';

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
