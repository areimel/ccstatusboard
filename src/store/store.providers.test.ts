import { describe, expect, it } from 'vitest';
import type { TranscriptEvent } from '../domain/types.js';
import { HOUR, makeStore, MIN, NOW, PRICE, reg, usage } from './testFixtures.js';

function meta(over: Partial<Extract<TranscriptEvent, { kind: 'meta' }>> = {}): TranscriptEvent {
  return {
    kind: 'meta',
    timestamp: NOW,
    isSidechain: false,
    observedStatus: 'busy',
    model: 'codex',
    cwd: '/work/codex',
    ...over,
  };
}

function codexUsage(input = 30): TranscriptEvent {
  return usage('same', NOW, { model: 'codex', tokens: { input, output: 0 }, contextTokens: 40 });
}

describe('provider isolation', () => {
  it('keeps identical session/usage identities and provider totals separate', () => {
    const store = makeStore();
    store.setProviderDirectory('codex', '/codex', true);
    store.setPricing((_, provider) => ({ ...PRICE, input: provider === 'codex' ? 2 : 1 }), 'ok');
    store.upsertRegistry(reg());
    store.applyEvents('s1', [usage('same', NOW, { tokens: { input: 10, output: 0 } })]);
    store.applyEvents('s1', [meta(), codexUsage()], 'codex');
    store.flush();
    const snapshot = store.getSnapshot();
    expect(snapshot.sessions.map((session) => session.key).sort()).toEqual(['claude:s1', 'codex:s1']);
    expect(snapshot.providers?.claude?.costs.today.costUSD).toBe(10);
    expect(snapshot.providers?.codex?.costs.today.costUSD).toBe(60);
    expect(snapshot.costs.today.costUSD).toBe(10);
    expect(snapshot.providers?.codex).toMatchObject({ dir: '/codex', found: true });
  });

  it('replaces provisional Codex accounting without retaining old usage or affecting Claude', () => {
    const store = makeStore();
    store.applyEvents('s1', [usage('same', NOW)]);
    store.replaceProviderSession('s1', [meta(), codexUsage(100)]);
    store.replaceProviderSession('s1', [meta(), codexUsage(20)]);
    store.replaceProviderSession('s1', [meta(), codexUsage(20)]);
    store.flush();
    expect(store.getSnapshot().providers?.codex?.costs.today.tokens.input).toBe(20);
    expect(store.getSnapshot().providers?.claude?.costs.today.tokens.input).toBe(1000);
  });

  it('shows recent observed sessions without claiming a confirmed live process', () => {
    const store = makeStore({ endedWindowHours: 0, idleCutoffMinutes: 30 });
    store.replaceProviderSession('recent', [meta({ contextTokens: 50, contextWindow: 100 })]);
    store.replaceProviderSession('old', [meta({ timestamp: NOW - HOUR })]);
    store.replaceProviderSession('archived', [meta({ observedStatus: 'ended' })]);
    store.flush();
    expect(store.getSnapshot().sessions).toHaveLength(1);
    expect(store.getSnapshot().sessions[0]).toMatchObject({
      sessionId: 'recent',
      live: false,
      recentlyObserved: true,
      activityConfidence: 'observed',
      status: 'busy',
      contextPercent: 50,
    });
    store.setOptions({ idleCutoffMinutes: 1 });
    store.replaceProviderSession('recent', [meta({ timestamp: NOW - 2 * MIN })]);
    store.flush();
    expect(store.getSnapshot().sessions).toEqual([]);
  });

  it('uses reported quota durations and keeps provider quota histories independent', () => {
    const store = makeStore();
    const limits = {
      status: 'ok' as const,
      perModelWeekly: [],
      block: { label: 'daily', percent: 50, resetsAt: NOW + HOUR, durationMs: 2 * HOUR },
    };
    store.setLimits(limits, 'codex');
    store.setLimits({ ...limits, block: { ...limits.block, percent: 10 } });
    store.flush();
    expect(store.getSnapshot().providers?.codex?.burn.block?.ratePctPerHour).toBe(50);
    expect(store.getSnapshot().burn.block?.ratePctPerHour).toBe(10);
  });

  it('does not apply the Claude context fallback to unknown Codex models', () => {
    const store = makeStore();
    store.replaceProviderSession('s1', [meta(), codexUsage()]);
    store.flush();
    expect(store.getSnapshot().sessions[0]?.contextTokens).toBe(40);
    expect(store.getSnapshot().sessions[0]?.contextWindow).toBeUndefined();
  });

  it('hides a disabled provider while retaining its independent accounting', () => {
    const store = makeStore();
    store.replaceProviderSession('s1', [meta(), codexUsage()]);
    store.setProviderEnabled('codex', false);
    store.flush();
    expect(store.getSnapshot().sessions).toEqual([]);
    expect(store.getSnapshot().providers?.codex?.costs.today.tokens.input).toBe(30);
  });

  it('marks unknown Codex pricing incomplete rather than displaying a false zero', () => {
    const store = makeStore();
    store.setPricing(() => undefined, 'ok');
    store.replaceProviderSession('s1', [meta(), codexUsage()]);
    store.flush();
    expect(store.getSnapshot().providers?.codex?.costs.today).toMatchObject({
      costUSD: null,
      costIncomplete: true,
    });
    expect(store.getSnapshot().sessions[0]).toMatchObject({ costUSD: null, accountingIncomplete: true });
  });
});
