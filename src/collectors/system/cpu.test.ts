import { describe, expect, it } from 'vitest';
import { cpuUsage, type CpuTimes } from './cpu.js';

const t = (user: number, idle: number): CpuTimes[number] => ({ user, nice: 0, sys: 0, idle, irq: 0 });

describe('cpuUsage', () => {
  it('returns zeros on first sample', () => {
    expect(cpuUsage(undefined, [t(10, 90), t(5, 5)])).toEqual({ total: 0, perCore: [0, 0] });
  });
  it('computes per-core and total from deltas', () => {
    const prev = [t(100, 100), t(100, 100)];
    const curr = [t(150, 150), t(100, 200)];
    const r = cpuUsage(prev, curr);
    expect(r.perCore).toEqual([50, 0]);
    expect(r.total).toBeCloseTo(25);
  });
  it('is zero when no ticks elapsed', () => {
    const s = [t(1, 1)];
    expect(cpuUsage(s, s)).toEqual({ total: 0, perCore: [0] });
  });
});
