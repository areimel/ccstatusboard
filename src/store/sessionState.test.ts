import { describe, expect, it } from 'vitest';
import {
  applySessionEvent,
  buildSessionView,
  createSessionState,
  displayName,
  displayStatus,
  lastActivityOf,
} from './sessionState.js';
import type { ModelPrice, PriceLookup, TranscriptEvent } from '../domain/types.js';

const PRICE: ModelPrice = {
  input: 3e-6,
  output: 15e-6,
  cacheWrite: 3.75e-6,
  cacheRead: 0.3e-6,
  maxInputTokens: 200_000,
};
const lookup: PriceLookup = (m) => (m === 'claude-opus-5-5' ? PRICE : undefined);

function usage(key: string, timestamp: number, contextTokens: number, sidechain = false): TranscriptEvent {
  return {
    kind: 'usage',
    contextTokens,
    record: {
      key,
      sessionId: 's1',
      timestamp,
      model: 'claude-opus-5-5',
      tokens: { input: 1000, output: 100, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 },
      isSidechain: sidechain,
    },
  };
}

describe('displayStatus', () => {
  it('maps registry status and agent activity', () => {
    const s = createSessionState('s1');
    expect(displayStatus(s)).toEqual({ status: 'ended' });
    s.live = true;
    expect(displayStatus(s)).toEqual({ status: 'idle' });
    s.registry = { pid: 1, sessionId: 's1', cwd: '/w', status: 'waiting', waitingFor: 'input needed' };
    expect(displayStatus(s)).toEqual({ status: 'waiting' });
    s.registry.status = 'busy';
    expect(displayStatus(s)).toEqual({ status: 'busy' });
    s.registry.status = 'idle';
    s.agents = { activeCount: 2, names: ['Explore', 'Plan'] };
    expect(displayStatus(s)).toEqual({ status: 'busy' });
    s.agents = { activeCount: 0, names: [] };
    s.registry.status = 'thinking';
    expect(displayStatus(s)).toEqual({ status: 'idle', rawStatus: 'thinking' });
  });
  it('waiting wins over active agents', () => {
    const s = createSessionState('s1');
    s.live = true;
    s.registry = { pid: 1, sessionId: 's1', cwd: '/w', status: 'waiting' };
    s.agents = { activeCount: 1, names: ['Explore'] };
    expect(displayStatus(s).status).toBe('waiting');
  });
});

describe('displayName', () => {
  it('follows registry name → ai-title → agent-name → cwd basename → id prefix', () => {
    const s = createSessionState('abcdef123456');
    expect(displayName(s)).toBe('abcdef12');
    applySessionEvent(s, { kind: 'meta', timestamp: 1, isSidechain: false, cwd: '/work/proj' }, false);
    expect(displayName(s)).toBe('proj');
    applySessionEvent(s, { kind: 'title', timestamp: 0, title: 'agent-x', source: 'agent-name' }, false);
    expect(displayName(s)).toBe('agent-x');
    applySessionEvent(s, { kind: 'title', timestamp: 0, title: 'Fix login bug', source: 'ai-title' }, false);
    expect(displayName(s)).toBe('Fix login bug');
    s.registry = { pid: 1, sessionId: 'abcdef123456', cwd: '/work/proj', name: 'my-session' };
    expect(displayName(s)).toBe('my-session');
  });
});

describe('applySessionEvent + buildSessionView', () => {
  it('only counts new usage, ignores sidechain for context, and honors compaction', () => {
    const s = createSessionState('s1');
    applySessionEvent(s, usage('a', 1_000, 150_000), true);
    applySessionEvent(s, usage('a', 1_000, 150_000), false); // duplicate → ignored
    applySessionEvent(s, usage('side', 1_500, 5_000, true), true); // subagent
    let v = buildSessionView(s, lookup);
    expect(v.tokens.input).toBe(2000);
    expect(v.contextTokens).toBe(150_000);
    expect(v.contextWindow).toBe(200_000);
    expect(v.contextPercent).toBe(75);

    applySessionEvent(
      s,
      { kind: 'compact', timestamp: 2_000, postTokens: 30_000, isSidechain: false },
      false,
    );
    v = buildSessionView(s, lookup);
    expect(v.contextTokens).toBe(30_000);
    expect(v.contextPercent).toBe(15);

    applySessionEvent(s, usage('b', 3_000, 40_000), true);
    expect(buildSessionView(s, lookup).contextTokens).toBe(40_000);
  });

  it('falls back to cost-state when pricing is unavailable', () => {
    const s = createSessionState('s1');
    applySessionEvent(s, usage('a', 1_000, 10), true);
    applySessionEvent(s, { kind: 'costState', timestamp: 1_100, totalCostUSD: 3.5 }, false);
    const priced = buildSessionView(s, lookup);
    expect(priced.costApprox).toBe(false);
    expect(priced.costUSD).toBeCloseTo(0.0045, 6);
    const unpriced = buildSessionView(s, null);
    expect(unpriced.costUSD).toBe(3.5);
    expect(unpriced.costApprox).toBe(true);
  });

  it('lastActivity is the max of events and registry timestamps', () => {
    const s = createSessionState('s1');
    applySessionEvent(s, usage('a', 5_000, 10), true);
    expect(lastActivityOf(s)).toBe(5_000);
    s.registry = { pid: 1, sessionId: 's1', cwd: '/w', statusUpdatedAt: 9_000, startedAt: 100 };
    expect(lastActivityOf(s)).toBe(9_000);
  });
});
