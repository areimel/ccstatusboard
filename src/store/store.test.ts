import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Store, type StoreOptions } from './store.js';
import type {
  ModelPrice,
  PriceLookup,
  RegistryEntry,
  Snapshot,
  TokenCounts,
  TranscriptEvent,
} from '../domain/types.js';

const NOW = Date.parse('2026-10-11T14:32:07Z');
const MIN = 60_000;
const HOUR = 60 * MIN;
const PRICE: ModelPrice = {
  input: 3e-6,
  output: 15e-6,
  cacheWrite: 3.75e-6,
  cacheRead: 0.3e-6,
  maxInputTokens: 200_000,
};
const lookup: PriceLookup = (m) => (m === 'claude-opus-5-5' ? PRICE : undefined);

function usage(
  key: string,
  timestamp: number,
  opts: { tokens?: Partial<TokenCounts>; sessionId?: string; model?: string; contextTokens?: number } = {},
): TranscriptEvent {
  return {
    kind: 'usage',
    contextTokens: opts.contextTokens ?? 1100,
    record: {
      key,
      sessionId: opts.sessionId ?? 's1',
      timestamp,
      model: opts.model ?? 'claude-opus-5-5',
      tokens: { input: 1000, output: 100, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, ...opts.tokens },
      isSidechain: false,
    },
  };
}

const reg = (over: Partial<RegistryEntry> = {}): RegistryEntry => ({
  pid: 100,
  sessionId: 's1',
  cwd: '/work/proj',
  status: 'idle',
  version: '2.1.296',
  ...over,
});

function makeStore(over: Partial<StoreOptions> = {}): Store {
  return new Store({
    now: () => NOW,
    refreshMs: 1000,
    endedWindowHours: 24,
    claudeDir: '/home/u/.claude',
    claudeDirFound: true,
    ...over,
  });
}

function session(snap: Snapshot, id = 's1') {
  const s = snap.sessions.find((x) => x.sessionId === id);
  if (!s) throw new Error(`session ${id} not in snapshot`);
  return s;
}

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
