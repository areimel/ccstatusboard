import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LimitsState, SystemStats } from '../domain/types.js';
import { HOUR, makeStore, MIN, NOW, reg, session, usage } from './testFixtures.js';

afterEach(() => vi.useRealTimers());

const limits = (percent: number, fetchedAt: number, resetsAt = NOW + 2 * HOUR): LimitsState => ({
  status: 'ok',
  perModelWeekly: [],
  block: { label: '5h', percent, resetsAt },
  fetchedAt,
});

const stats = (cpu: number, rx = 1, tx = 2): SystemStats => ({
  sampledAt: NOW,
  cpu: { total: cpu, perCore: [cpu] },
  mem: { used: 1, total: 2 },
  swap: { used: 0, total: 0 },
  disk: { used: 1, total: 2, mount: '/' },
  net: { rxPerSec: rx, txPerSec: tx },
  load: [0, 0, 0],
});

describe('Store burn projection', () => {
  it('projects block burn after samples and omits week without a limit', () => {
    const s = makeStore();
    s.setLimits(limits(20, NOW - 20 * MIN));
    s.setLimits(limits(30, NOW));
    s.flush();
    const burn = s.getSnapshot().burn;
    expect(burn.block?.currentPct).toBe(30);
    expect(burn.block?.ratePctPerHour).toBeGreaterThan(0);
    expect('week' in burn).toBe(false);
  });

  it('starts fresh when the block window resets', () => {
    const s = makeStore();
    s.setLimits(limits(90, NOW - 10 * MIN));
    s.setLimits(limits(3, NOW, NOW + 5 * HOUR));
    s.flush();
    expect(s.getSnapshot().burn.block?.currentPct).toBe(3);
    expect(s.getSnapshot().burn.block?.band).toBe('under');
  });
});

describe('Store system', () => {
  it('stores latest stats, caps history at 60 and returns copies', () => {
    const s = makeStore();
    for (let i = 0; i < 70; i++) s.setSystem(stats(i));
    s.flush();
    const snap = s.getSnapshot();
    expect(snap.system?.cpu.total).toBe(69);
    expect(snap.systemHistory.cpu).toHaveLength(60);
    expect(snap.systemHistory.cpu[0]).toBe(10);
    snap.systemHistory.cpu.push(1);
    s.flush();
    expect(s.getSnapshot().systemHistory.cpu).toHaveLength(60);
  });

  it('sanitizes non-finite and negative numbers', () => {
    const s = makeStore();
    s.setSystem(stats(Number.NaN, -5, Number.POSITIVE_INFINITY));
    s.flush();
    expect(s.getSnapshot().systemHistory).toEqual({ cpu: [0], rx: [0], tx: [0] });
  });
});

describe('Store proc stats', () => {
  it('merges by pid for live sessions only', () => {
    const s = makeStore();
    s.upsertRegistry(reg({ sessionId: 'live', pid: 100 }));
    s.upsertRegistry(reg({ sessionId: 'dead', pid: 200 }));
    s.applyEvents('dead', [usage('k1', NOW - MIN, { sessionId: 'dead' })]);
    s.markEnded('dead');
    s.setProcStats(
      new Map([
        [100, { cpuPercent: 12.5, rssBytes: 4096 }],
        [200, { cpuPercent: 99, rssBytes: 1 }],
      ]),
    );
    s.flush();
    const snap = s.getSnapshot();
    expect(session(snap, 'live').cpuPercent).toBe(12.5);
    expect(session(snap, 'live').memBytes).toBe(4096);
    expect(session(snap, 'dead').cpuPercent).toBeUndefined();
  });
});

describe('Store setOptions', () => {
  it('applies endedWindowHours immediately', () => {
    let now = NOW;
    const s = makeStore({ endedWindowHours: 24, now: () => now });
    s.upsertRegistry(reg());
    s.applyEvents('s1', [usage('k1', NOW - 3 * HOUR)]);
    s.markEnded('s1');
    s.flush();
    expect(s.getSnapshot().sessions).toHaveLength(1);
    now += MIN;
    s.setOptions({ endedWindowHours: 0 });
    s.flush();
    expect(s.getSnapshot().sessions).toHaveLength(0);
  });

  it('restarts the flush interval when refreshMs changes', () => {
    vi.useFakeTimers();
    const s = makeStore({ refreshMs: 1000 });
    s.start();
    s.setOptions({ refreshMs: 200 });
    const fn = vi.fn();
    s.subscribe(fn);
    vi.advanceTimersByTime(1000);
    expect(fn.mock.calls.length).toBeGreaterThanOrEqual(5);
    s.stop();
  });
});
