import { describe, expect, it } from 'vitest';
import { totalsForWindow, UsageAccumulator } from './aggregate.js';
import type { ModelPrice, PriceLookup, Provider, UsageRecord } from './types.js';

const price = (over: Partial<ModelPrice> = {}): ModelPrice => ({
  input: 1e-6,
  output: 5e-6,
  cacheWrite: 2e-6,
  cacheRead: 1e-7,
  maxInputTokens: 200_000,
  ...over,
});

function rec(i: number, model: string, provider: Provider): UsageRecord {
  return {
    provider,
    key: `k${i}`,
    sessionId: 's',
    timestamp: i,
    model,
    isSidechain: false,
    tokens: {
      input: 10 * i,
      output: i,
      cacheWrite5m: i % 3 === 0 ? 7 : 0,
      cacheWrite1h: i % 5 === 0 ? 3 : 0,
      cacheRead: i % 2 === 0 ? 100 : 0,
    },
  };
}

describe('UsageAccumulator', () => {
  const lookups: [string, PriceLookup | null][] = [
    ['none', null],
    ['priced', (m) => (m === 'a' ? price() : undefined)],
    ['unpriced reads', (m) => (m === 'a' ? price({ cacheReadUnpriced: true }) : price())],
    ['unpriced writes', () => price({ cacheWriteUnpriced: true })],
  ];
  for (const provider of ['claude', 'codex'] as const)
    for (const [name, lookup] of lookups)
      it(`matches totalsForWindow (${provider}, ${name})`, () => {
        const records = Array.from({ length: 40 }, (_, i) => rec(i + 1, i % 4 === 0 ? 'b' : 'a', provider));
        const acc = new UsageAccumulator();
        for (const r of records) acc.add(r);
        const want = totalsForWindow(records, { start: 0, end: 1e9 }, lookup);
        const got = acc.totals(lookup, provider);
        expect(Object.keys(got.byModel)).toEqual(Object.keys(want.byModel));
        expect(got.tokens).toEqual(want.tokens);
        expect(got.costIncomplete).toBe(want.costIncomplete);
        if (want.costUSD === null) expect(got.costUSD).toBeNull();
        else expect(got.costUSD).toBeCloseTo(want.costUSD, 9);
        for (const [m, w] of Object.entries(want.byModel)) {
          expect(got.byModel[m]!.tokens).toEqual(w.tokens);
          expect(got.byModel[m]!.costIncomplete).toBe(w.costIncomplete);
          if (w.costUSD === null) expect(got.byModel[m]!.costUSD).toBeNull();
          else expect(got.byModel[m]!.costUSD).toBeCloseTo(w.costUSD, 9);
        }
      });
});
