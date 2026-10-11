import { describe, expect, it } from 'vitest';
import { burnRatePerHour, hourlySparkline, totalsForWindow, unknownModelsIn } from './aggregate.js';
import type { ModelPrice, PriceLookup, TokenCounts, UsageRecord } from './types.js';

const H = 3_600_000;
const M = 60_000;
const NOW = Date.parse('2026-10-11T14:00:00Z');

// $1 per input token makes expected costs trivial to read.
const opus: ModelPrice = { input: 1, output: 2, cacheWrite: 0, cacheRead: 0 };
const haiku: ModelPrice = { input: 0.5, output: 0.5, cacheWrite: 0, cacheRead: 0 };
const lookup: PriceLookup = (m) => (m === 'opus' ? opus : m === 'haiku' ? haiku : undefined);

function tok(input: number, output = 0): TokenCounts {
  return { input, output, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 };
}

let n = 0;
function rec(model: string, timestamp: number, tokens: TokenCounts): UsageRecord {
  n += 1;
  return { key: `k${n}`, sessionId: 's1', timestamp, model, tokens, isSidechain: false };
}

describe('totalsForWindow', () => {
  const records = [
    rec('opus', NOW - 2 * H, tok(1, 1)), // cost 3
    rec('haiku', NOW - 1 * H, tok(4)), // cost 2
    rec('mystery', NOW - 30 * M, tok(10)), // unpriced
    rec('opus', NOW - 10 * H, tok(100)), // outside window
  ];
  const w = { start: NOW - 5 * H, end: NOW };

  it('sums tokens and priced costs inside the window, by model', () => {
    const t = totalsForWindow(records, w, lookup);
    expect(t.costUSD).toBe(5);
    expect(t.tokens).toEqual({ input: 15, output: 1, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 });
    expect(t.byModel.opus).toEqual({ costUSD: 3, tokens: tok(1, 1) });
    expect(t.byModel.haiku).toEqual({ costUSD: 2, tokens: tok(4) });
    expect(t.byModel.mystery).toEqual({ costUSD: null, tokens: tok(10) });
    expect(t.byModel).not.toHaveProperty('x');
  });

  it('includes records exactly on both window boundaries', () => {
    const edge = [rec('opus', w.start, tok(1)), rec('opus', w.end, tok(1))];
    expect(totalsForWindow(edge, w, lookup).costUSD).toBe(2);
  });

  it('makes every cost null when pricing is unavailable but still counts tokens', () => {
    const t = totalsForWindow(records, w, null);
    expect(t.costUSD).toBeNull();
    expect(t.byModel.opus?.costUSD).toBeNull();
    expect(t.tokens.input).toBe(15);
  });

  it('returns zero cost and zero tokens for an empty window', () => {
    const t = totalsForWindow([], w, lookup);
    expect(t.costUSD).toBe(0);
    expect(t.tokens).toEqual(tok(0));
    expect(t.byModel).toEqual({});
  });

  it('accepts any iterable and does not mutate shared token objects', () => {
    const shared = tok(1);
    const set = new Set([rec('opus', NOW - H, shared), rec('opus', NOW - H, shared)]);
    const t = totalsForWindow(set, w, lookup);
    expect(t.tokens.input).toBe(2);
    expect(shared.input).toBe(1);
  });
});

describe('unknownModelsIn', () => {
  it('lists unpriced models once, sorted', () => {
    const rs = [
      rec('zeta', NOW, tok(1)),
      rec('alpha', NOW, tok(1)),
      rec('zeta', NOW, tok(1)),
      rec('opus', NOW, tok(1)),
    ];
    expect(unknownModelsIn(rs, lookup)).toEqual(['alpha', 'zeta']);
  });
  it('is empty when pricing is unavailable', () => {
    expect(unknownModelsIn([rec('zeta', NOW, tok(1))], null)).toEqual([]);
  });
});

describe('burnRatePerHour', () => {
  it('sums cost in the last 60 minutes, excluding the exact 60-minute edge', () => {
    const rs = [
      rec('opus', NOW - 60 * M, tok(100)), // excluded: (now-60m, now]
      rec('opus', NOW - 59 * M, tok(2)), // 2
      rec('haiku', NOW, tok(2)), // 1
      rec('mystery', NOW - M, tok(50)), // unpriced → 0
    ];
    expect(burnRatePerHour(rs, NOW, lookup)).toBe(3);
  });
  it('is 0 with no recent records and null without pricing', () => {
    expect(burnRatePerHour([rec('opus', NOW - 3 * H, tok(1))], NOW, lookup)).toBe(0);
    expect(burnRatePerHour([], NOW, null)).toBeNull();
  });
});

describe('hourlySparkline', () => {
  it('returns 24 buckets by default, oldest first', () => {
    const rs = [
      rec('opus', NOW, tok(1)), // newest bucket (now included)
      rec('opus', NOW - 30 * M, tok(2)), // newest bucket
      rec('opus', NOW - H, tok(4)), // exactly 1h ago → newest bucket (start-inclusive [now-1h, now])
      rec('opus', NOW - 23.5 * H, tok(8)), // oldest bucket
      rec('opus', NOW - 24 * H, tok(16)), // exactly 24h ago → oldest bucket start (inclusive)
      rec('opus', NOW - 25 * H, tok(100)), // out of range
      rec('opus', NOW + M, tok(100)), // future → ignored
    ];
    const s = hourlySparkline(rs, NOW, lookup);
    expect(s).toHaveLength(24);
    expect(s[23]).toBe(1 + 2 + 4);
    expect(s[0]).toBe(8 + 16);
    expect(s.slice(1, 23).every((v) => v === 0)).toBe(true);
  });
  it('honors a custom bucket count', () => {
    expect(hourlySparkline([rec('opus', NOW - 90 * M, tok(1))], NOW, lookup, 3)).toEqual([0, 1, 0]);
  });
  it('is all zeros without pricing', () => {
    expect(hourlySparkline([rec('opus', NOW, tok(1))], NOW, null, 4)).toEqual([0, 0, 0, 0]);
  });
});
