import { describe, expect, it } from 'vitest';
import { RETENTION_MS } from '../domain/windows.js';
import { HOUR, lookup, PRICE, makeStore, NOW, reg, usage } from './testFixtures.js';

const DAY = 24 * HOUR;

function clocked(over = {}) {
  const clock = { now: NOW };
  const store = makeStore({ now: () => clock.now, ...over });
  store.setPricing(lookup, 'ok');
  return { store, clock };
}

describe('Store retention', () => {
  it('ignores usage older than the retention horizon at ingest', () => {
    const { store } = clocked();
    store.applyEvents('s1', [usage('old', NOW - RETENTION_MS - HOUR)]);
    store.applyEvents('s1', [usage('new', NOW - HOUR)]);
    store.flush();
    const snap = store.getSnapshot();
    expect(snap.sessions[0]?.tokens.input).toBe(1000);
  });

  it('prunes old records hourly and frees their dedup keys', () => {
    const { store, clock } = clocked();
    store.upsertRegistry(reg());
    const ts = NOW - 34 * DAY;
    store.applyEvents('s1', [usage('k1', ts)]);
    store.flush();
    const month = () => store.getSnapshot().providers?.claude?.costs.month.tokens.input;
    expect(store.getSnapshot().sessions[0]?.tokens.input).toBe(1000);
    clock.now = NOW + 2 * DAY; // record now past the horizon
    store.flush(); // prune runs
    expect(month()).toBe(0);
    // Session running totals keep everything ingested for the session.
    expect(store.getSnapshot().sessions[0]?.tokens.input).toBe(1000);
    // Re-ingesting the pruned record is ignored (too old)...
    store.applyEvents('s1', [usage('k1', ts)]);
    // ...and the pruned key does not block a fresh record reusing it.
    store.applyEvents('s1', [usage('k1', clock.now - HOUR)]);
    store.flush();
    expect(month()).toBe(1000);
    expect(store.getSnapshot().sessions[0]?.tokens.input).toBe(2000);
  });

  it('invalidates the provider aggregate cache on a new record and on setPricing', () => {
    const { store } = clocked();
    store.applyEvents('s1', [usage('a', NOW - 1000)]);
    store.flush();
    const cost = () => store.getSnapshot().providers?.claude?.costs.today.costUSD;
    expect(cost()).toBeCloseTo(0.0045, 6);
    store.applyEvents('s1', [usage('b', NOW - 500)]);
    store.flush();
    expect(cost()).toBeCloseTo(0.009, 6);
    store.setPricing(
      (m) => (m === 'claude-opus-5-5' ? { ...PRICE, input: PRICE.input * 2 } : undefined),
      'ok',
    );
    store.flush();
    expect(cost()).toBeGreaterThan(0.0135);
    store.setPricing(null, 'ok');
    store.flush();
    expect(cost()).toBeNull();
    expect(store.getSnapshot().sessions[0]?.costUSD).toBeNull();
  });

  it('does not prune more than once per hour', () => {
    const { store, clock } = clocked();
    store.upsertRegistry(reg());
    store.applyEvents('s1', [usage('k1', NOW - 34 * DAY)]);
    clock.now = NOW + 30 * 60_000;
    store.flush();
    expect(store.getSnapshot().sessions[0]?.tokens.input).toBe(1000);
  });

  it('evicts stale non-live sessions, keeps live and recent ones', () => {
    const { store, clock } = clocked({ endedWindowHours: 24 });
    store.upsertRegistry(reg({ sessionId: 'live' }));
    store.applyEvents('stale', [usage('a', NOW - 1000)], 'claude');
    store.applyEvents('codex1', [usage('c', NOW - 1000)], 'codex');
    store.applyEvents('fresh', [usage('b', NOW - 1000)]);
    clock.now = NOW + RETENTION_MS + HOUR;
    store.applyEvents('fresh', [usage('b2', clock.now - 1000)]);
    store.flush();
    const sessions = (store as unknown as { sessions: Map<string, unknown> }).sessions;
    expect([...sessions.keys()].sort()).toEqual(['claude:fresh', 'claude:live']);
  });

  it('replaceProviderSession leaves other sessions dedup and records intact', () => {
    const { store } = clocked();
    store.applyEvents('c1', [usage('k1', NOW - HOUR, { sessionId: 'c1' })], 'codex');
    store.applyEvents('c2', [usage('k2', NOW - HOUR, { sessionId: 'c2' })], 'codex');
    store.replaceProviderSession('c1', [usage('k1', NOW - HOUR, { sessionId: 'c1', tokens: { input: 5 } })]);
    store.applyEvents('c2', [usage('k2', NOW - HOUR, { sessionId: 'c2' })], 'codex'); // still deduped
    store.flush();
    const snap = store.getSnapshot();
    expect(snap.providers?.codex?.costs.month.tokens.input).toBe(1005);
  });
});
