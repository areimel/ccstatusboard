import type os from 'node:os';

export type CpuTimes = os.CpuInfo['times'][];

export interface CpuUsage {
  total: number;
  perCore: number[];
}

type Times = CpuTimes[number];

function sum(t: Times): number {
  return t.user + t.nice + t.sys + t.idle + t.irq;
}

function pct(prev: Times, curr: Times): number {
  const total = sum(curr) - sum(prev);
  const idle = curr.idle - prev.idle;
  if (!(total > 0)) return 0;
  return Math.min(100, Math.max(0, ((total - idle) / total) * 100));
}

/** CPU busy percentage (0-100) from tick deltas; no previous sample yields zeros. */
export function cpuUsage(prev: CpuTimes | undefined, curr: CpuTimes): CpuUsage {
  if (!prev) return { total: 0, perCore: curr.map(() => 0) };
  const perCore = curr.map((c, i) => {
    const p = prev[i];
    return p ? pct(p, c) : 0;
  });
  const agg = (list: CpuTimes): Times =>
    list.reduce(
      (a, t) => ({
        user: a.user + t.user,
        nice: a.nice + t.nice,
        sys: a.sys + t.sys,
        idle: a.idle + t.idle,
        irq: a.irq + t.irq,
      }),
      { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
    );
  const n = Math.min(prev.length, curr.length);
  return { total: pct(agg(prev.slice(0, n)), agg(curr.slice(0, n))), perCore };
}
