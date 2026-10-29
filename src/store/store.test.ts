import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOUR, lookup, makeStore, MIN, NOW, reg, session, usage } from './testFixtures.js';

describe('Store dedup (Review Focus 2)', () => {
  it('counts a usage record once across scan, tail and multi-line splits', () => {
    const store = makeStore();
    store.setPricing(lookup, 'ok');
    store.upsertRegistry(reg());
    const ev = usage('msg_1:req_1', NOW - MIN);
    store.applyEvents('s1', [ev]); // history scan
    store.applyEvents('s1', [ev, ev]); // live tail: same response split over two lines
    store.applyEvents('s1', [ev]); // tail restarted from offset 0
    store.flush();
    const snap = store.getSnapshot();
    expect(session(snap).tokens.input).toBe(1000);
    expect(session(snap).costUSD).toBeCloseTo(0.0045, 6);
    expect(snap.costs.today.tokens.input).toBe(1000);
    expect(snap.costs.block.tokens.input).toBe(1000);
    expect(snap.costs.month.costUSD).toBeCloseTo(0.0045, 6);
  });
});

describe('Store sessions', () => {
  it('applies display-status rules and markEnded', () => {
    const store = makeStore();
    store.upsertRegistry(reg({ status: 'waiting', waitingFor: 'dialog open' }));
    store.flush();
    expect(session(store.getSnapshot())).toMatchObject({
      status: 'waiting',
      waitingFor: 'dialog open',
      live: true,
    });

    store.upsertRegistry(reg({ status: 'idle' }));
    store.setAgents('s1', { activeCount: 2, names: ['Explore', 'Plan'] });
    store.flush();
    expect(session(store.getSnapshot())).toMatchObject({ status: 'busy', activeAgents: 2 });

    store.setAgents('s1', { activeCount: 0, names: [] });
    store.upsertRegistry(reg({ status: 'compacting' }));
    store.flush();
    expect(session(store.getSnapshot())).toMatchObject({ status: 'idle', rawStatus: 'compacting' });

    store.markEnded('s1');
    store.flush();
    expect(session(store.getSnapshot())).toMatchObject({ status: 'ended', live: false });
  });

  it('shows ended sessions only inside endedWindowHours but always counts their cost', () => {
    const store = makeStore();
    store.setPricing(lookup, 'ok');
    store.applyEvents('recent', [usage('r', NOW - 23 * HOUR, { sessionId: 'recent' })]);
    store.applyEvents('old', [usage('o', NOW - 25 * HOUR, { sessionId: 'old' })]);
    store.flush();
    const snap = store.getSnapshot();
    expect(snap.sessions.map((s) => s.sessionId)).toEqual(['recent']);
    expect(session(snap, 'recent').status).toBe('ended');
    expect(snap.costs.month.tokens.input).toBe(2000);
  });

  it('uses the name fallback chain', () => {
    const store = makeStore();
    store.applyEvents('abcdef123456', [usage('x', NOW - MIN, { sessionId: 'abcdef123456' })]);
    store.flush();
    expect(session(store.getSnapshot(), 'abcdef123456').name).toBe('abcdef12');

    store.applyEvents('abcdef123456', [
      { kind: 'meta', timestamp: NOW - MIN, isSidechain: false, cwd: '/work/blog' },
    ]);
    store.flush();
    expect(session(store.getSnapshot(), 'abcdef123456').name).toBe('blog');

    store.applyEvents('abcdef123456', [
      { kind: 'title', timestamp: 0, title: 'helper', source: 'agent-name' },
      { kind: 'title', timestamp: 0, title: 'Write README', source: 'ai-title' },
    ]);
    store.flush();
    expect(session(store.getSnapshot(), 'abcdef123456').name).toBe('Write README');

    store.upsertRegistry(reg({ sessionId: 'abcdef123456', name: 'docs-session' }));
    store.flush();
    expect(session(store.getSnapshot(), 'abcdef123456').name).toBe('docs-session');
  });
});

describe('Store ended-session visibility', () => {
  it('endedWindowHours 0 hides an ended session right after markEnded, and history-only sessions', () => {
    const store = makeStore({ endedWindowHours: 0 });
    store.upsertRegistry(reg());
    store.applyEvents('hist', [usage('h', NOW - MIN, { sessionId: 'hist' })]);
    store.flush();
    expect(store.getSnapshot().sessions.map((s) => s.sessionId)).toEqual(['s1']);
    store.markEnded('s1');
    store.flush();
    expect(store.getSnapshot().sessions).toEqual([]);
  });

  it('endedWindowHours 24 keeps a just-ended session', () => {
    const store = makeStore({ endedWindowHours: 24 });
    store.upsertRegistry(reg());
    store.markEnded('s1');
    store.flush();
    expect(session(store.getSnapshot()).status).toBe('ended');
  });

  it('setOptions changes visibility live', () => {
    const store = makeStore({ endedWindowHours: 24 });
    store.upsertRegistry(reg());
    store.markEnded('s1');
    store.flush();
    expect(store.getSnapshot().sessions).toHaveLength(1);
    store.setOptions({ endedWindowHours: 0 });
    store.flush();
    expect(store.getSnapshot().sessions).toEqual([]);
    store.setOptions({ endedWindowHours: 24 });
    store.flush();
    expect(store.getSnapshot().sessions).toHaveLength(1);
  });
});

describe('Store subagents', () => {
  const agents = [
    { id: 'a', name: 'Explore', lastActivity: NOW - 20_000 },
    { id: 'b', name: 'Pl\u001b[31man', lastActivity: NOW - 5_000 },
  ];

  it('exposes sanitized active subagents sorted by recent activity, cleared on end', () => {
    const store = makeStore();
    store.upsertRegistry(reg());
    store.setAgents('s1', { activeCount: 2, names: ['Explore', 'Plan'], agents });
    store.flush();
    const subs = session(store.getSnapshot()).subagents;
    expect(subs.map((a) => a.id)).toEqual(['b', 'a']);
    expect(subs[0]?.name).not.toContain('\u001b');
    expect(subs[1]).toEqual({ id: 'a', name: 'Explore', lastActivity: NOW - 20_000 });

    store.markEnded('s1');
    store.flush();
    expect(session(store.getSnapshot()).subagents).toEqual([]);
  });

  it('defaults to no subagents when setAgents omits the list', () => {
    const store = makeStore();
    store.upsertRegistry(reg());
    store.setAgents('s1', { activeCount: 1, names: ['Explore'] });
    store.flush();
    expect(session(store.getSnapshot()).subagents).toEqual([]);
  });
});

describe('Store project', () => {
  it('uses the resolved project name and falls back to the cwd basename', () => {
    const store = makeStore();
    store.upsertRegistry(reg({ cwd: '/work/proj/sub' }));
    store.flush();
    expect(session(store.getSnapshot()).project).toBe('sub');
    store.setProject('/work/proj/sub', 'proj');
    store.flush();
    expect(session(store.getSnapshot()).project).toBe('proj');
  });

  it('sanitizes the project name', () => {
    const store = makeStore();
    store.upsertRegistry(reg());
    store.setProject('/work/proj', 'a\u001b[31mb');
    store.flush();
    expect(session(store.getSnapshot()).project).not.toContain('\u001b');
  });
});

describe('Store pricing and context', () => {
  it('falls back to cost-state with costApprox when pricing is unavailable', () => {
    const store = makeStore();
    store.setPricing(null, 'unavailable');
    store.upsertRegistry(reg());
    store.applyEvents('s1', [
      usage('a', NOW - MIN),
      { kind: 'costState', timestamp: NOW - MIN, totalCostUSD: 3.5 },
    ]);
    store.flush();
    const snap = store.getSnapshot();
    expect(session(snap)).toMatchObject({ costUSD: 3.5, costApprox: true });
    expect(snap.costs.today.costUSD).toBeNull();
    expect(snap.pricingStatus).toBe('unavailable');
    expect(snap.unknownModels).toEqual([]);
  });

  it('reports unknown models', () => {
    const store = makeStore();
    store.setPricing(lookup, 'ok');
    store.applyEvents('s1', [usage('a', NOW - MIN, { model: 'mystery-model' })]);
    store.flush();
    expect(store.getSnapshot().unknownModels).toEqual(['mystery-model']);
  });

  it('uses compact postTokens until the next main-thread usage', () => {
    const store = makeStore();
    store.setPricing(lookup, 'ok');
    store.upsertRegistry(reg());
    store.applyEvents('s1', [usage('a', NOW - 10 * MIN, { contextTokens: 150_000 })]);
    store.applyEvents('s1', [
      { kind: 'compact', timestamp: NOW - 9 * MIN, postTokens: 30_000, isSidechain: false },
    ]);
    store.flush();
    expect(session(store.getSnapshot())).toMatchObject({ contextTokens: 30_000, contextPercent: 15 });
    store.applyEvents('s1', [usage('b', NOW - 8 * MIN, { contextTokens: 40_000 })]);
    store.flush();
    expect(session(store.getSnapshot())).toMatchObject({ contextTokens: 40_000, contextPercent: 20 });
  });
});

describe('Store windows and warnings', () => {
  it('derives the block window from limits.block.resetsAt', () => {
    const store = makeStore();
    store.setPricing(lookup, 'ok');
    store.setLimits({
      status: 'ok',
      block: { label: '5h', percent: 40, resetsAt: NOW + HOUR },
      perModelWeekly: [],
    });
    store.applyEvents('s1', [usage('in', NOW - 3 * HOUR), usage('out', NOW - 4.5 * HOUR)]);
    store.flush();
    const snap = store.getSnapshot();
    expect(snap.costs.block.tokens.input).toBe(1000);
    expect(snap.limits.block?.percent).toBe(40);
  });

  it('warns once per untested Claude Code version, live sessions only', () => {
    const store = makeStore();
    store.upsertRegistry(reg({ sessionId: 'a', pid: 1, version: '2.2.0' }));
    store.upsertRegistry(reg({ sessionId: 'b', pid: 2, version: '2.2.0' }));
    store.upsertRegistry(reg({ sessionId: 'c', pid: 3, version: '2.1.300' }));
    store.applyEvents('old', [
      usage('o', NOW - HOUR, { sessionId: 'old' }),
      { kind: 'meta', timestamp: NOW - HOUR, isSidechain: false, version: '2.0.1' },
    ]);
    store.flush();
    expect(store.getSnapshot().warnings).toEqual(['⚠ untested Claude Code v2.2.0']);
  });

  it('exposes claudeDir fields and scan progress', () => {
    const store = makeStore({ claudeDirFound: false });
    store.setScanProgress({ done: false, filesDone: 3, filesTotal: 10 });
    store.flush();
    expect(store.getSnapshot()).toMatchObject({
      claudeDirFound: false,
      claudeDir: '/home/u/.claude',
      scan: { done: false, filesDone: 3, filesTotal: 10 },
      limits: { status: 'loading', perModelWeekly: [] },
      pricingStatus: 'loading',
    });
    store.setClaudeDirFound(true);
    store.flush();
    expect(store.getSnapshot().claudeDirFound).toBe(true);
  });
});

describe('Store notifications', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('throttles notifications to one per refreshMs and keeps snapshot identity stable', () => {
    const store = makeStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    const before = store.getSnapshot();
    for (let i = 0; i < 5; i++) store.applyEvents('s1', [usage(`k${i}`, NOW - MIN)]);
    expect(listener).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toBe(before);
    vi.advanceTimersByTime(999);
    expect(listener).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(listener).toHaveBeenCalledTimes(1);
    const after = store.getSnapshot();
    expect(after).not.toBe(before);
    expect(store.getSnapshot()).toBe(after);
    expect(after.costs.today.tokens.input).toBe(5000);
    unsubscribe();
    store.applyEvents('s1', [usage('k9', NOW - MIN)]);
    vi.advanceTimersByTime(1000);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('ticks every refreshMs after start() until stop()', () => {
    const store = makeStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.start();
    vi.advanceTimersByTime(3000);
    expect(listener).toHaveBeenCalledTimes(3);
    store.stop();
    vi.advanceTimersByTime(3000);
    expect(listener).toHaveBeenCalledTimes(3);
  });
});
