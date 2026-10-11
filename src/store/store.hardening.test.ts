import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOUR, lookup, makeStore, MIN, NOW, reg, session, usage } from './testFixtures.js';

describe('Store sanitization', () => {
  it('strips terminal escape sequences from disk-sourced strings', () => {
    const store = makeStore();
    store.upsertRegistry(reg({ name: 'evil\x1b[2Jname', waitingFor: 'x\x07y', status: 'waiting' }));
    store.setLimits({
      status: 'ok',
      block: { label: '5h\x1b]0;t\x07', percent: 1 },
      perModelWeekly: [{ label: 'opus\x9b', percent: 2 }],
    });
    store.flush();
    const snap = store.getSnapshot();
    expect(snap.sessions[0]?.name).toBe('evil[2Jname');
    expect(snap.sessions[0]?.waitingFor).toBe('xy');
    expect(snap.limits.block?.label).toBe('5h]0;t');
    expect(snap.limits.perModelWeekly[0]?.label).toBe('opus');
  });

  it('sanitizes byModel keys in every window total, merging collisions', () => {
    const store = makeStore();
    store.setPricing(lookup, 'ok');
    store.applyEvents('s1', [
      usage('a', NOW - MIN, { model: 'evil\x1b[0m' }),
      usage('b', NOW - MIN, { model: 'claude-opus-5-5' }),
      usage('c', NOW - MIN, { model: 'claude-opus-5-5\x07' }), // unpriced, collides after sanitizing
    ]);
    store.flush();
    const { costs } = store.getSnapshot();
    for (const w of [costs.block, costs.today, costs.week, costs.month]) {
      expect(Object.keys(w.byModel).sort()).toEqual(['claude-opus-5-5', 'evil[0m']);
    }
    expect(costs.today.byModel['evil[0m']).toMatchObject({ costUSD: null, tokens: { input: 1000 } });
    const merged = costs.today.byModel['claude-opus-5-5'];
    expect(merged?.tokens.input).toBe(2000);
    expect(merged?.costUSD).toBeCloseTo(0.0045, 6);
  });

  it('keeps the raw sessionId as identity but sanitizes the id-prefix name', () => {
    const store = makeStore();
    store.upsertRegistry(reg({ sessionId: 'ab\x1bcdef', cwd: '' }));
    store.flush();
    const v = session(store.getSnapshot(), 'ab\x1bcdef');
    expect(v.sessionId).toBe('ab\x1bcdef');
    expect(v.name).toBe('abcdef');
  });
});

describe('Store ended-session window', () => {
  it('drops an ended session once now - endedAt exceeds endedWindowHours', () => {
    let now = NOW;
    const store = makeStore({ now: () => now });
    store.upsertRegistry(reg());
    store.markEnded('s1');
    now = NOW + 23 * HOUR;
    store.flush();
    expect(session(store.getSnapshot()).status).toBe('ended');
    now = NOW + 25 * HOUR;
    store.flush();
    expect(store.getSnapshot().sessions).toEqual([]);
  });
});

describe('Store lifecycle robustness', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('schedules no timers after stop() until start()', () => {
    const store = makeStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.stop();
    store.applyEvents('s1', [usage('a', NOW - MIN)]);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(5000);
    expect(listener).not.toHaveBeenCalled();
    store.start();
    store.applyEvents('s1', [usage('b', NOW - MIN)]);
    vi.advanceTimersByTime(1000);
    expect(listener).toHaveBeenCalled();
    store.stop();
  });

  it('a throwing listener does not prevent the others from being notified', () => {
    const store = makeStore();
    const second = vi.fn();
    store.subscribe(() => {
      throw new Error('boom');
    });
    store.subscribe(second);
    expect(() => store.flush()).not.toThrow();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('keeps block totals right when records arrive out of order', () => {
    const store = makeStore();
    store.setPricing(lookup, 'ok');
    // Sorted, the block starts at the 10:00 UTC hour and holds all three; an unsorted
    // timestamp list would start the block at 14:00 and drop the two older records.
    store.applyEvents('s1', [usage('late', NOW - MIN)]);
    store.applyEvents('s1', [usage('early', NOW - 4 * HOUR), usage('mid', NOW - 2 * HOUR)]);
    store.flush();
    expect(store.getSnapshot().costs.block.tokens.input).toBe(3000);
  });
});
