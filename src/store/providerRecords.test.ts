import { describe, expect, it } from 'vitest';
import { burnRatePerHour, hourlySparkline, totalsForWindow, unknownModelsIn } from '../domain/aggregate.js';
import type { PriceLookup, UsageRecord } from '../domain/types.js';
import { deriveCurrentBlock } from '../domain/windows.js';
import { PRICE } from './testFixtures.js';
import { ProviderRecords } from './providerRecords.js';

const H = 3_600_000;
const NOW = Date.parse('2026-10-11T14:32:07Z');
const lookup: PriceLookup = (m) => (m === 'a' ? PRICE : undefined);

function make(n: number): UsageRecord[] {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  return Array.from({ length: n }, (_, i) => ({
    provider: 'claude' as const,
    key: `k${i}`,
    sessionId: 's',
    timestamp: NOW - Math.floor(rnd() * 40 * 24 * H) + (i % 7 === 0 ? 3 * H : 0),
    model: rnd() < 0.7 ? 'a' : 'b',
    isSidechain: false,
    tokens: {
      input: i + 1,
      output: 2,
      cacheWrite5m: i % 3 ? 0 : 5,
      cacheWrite1h: 0,
      cacheRead: i % 2 ? 9 : 0,
    },
  }));
}

describe('ProviderRecords', () => {
  const records = make(3000);
  const windows = {
    block: { start: NOW - 3 * H, end: NOW },
    today: { start: NOW - 14.5 * H, end: NOW },
    week: { start: NOW - 7 * 24 * H, end: NOW },
    month: { start: NOW - 20 * 24 * H - 123, end: NOW },
  };

  it('aggregates equal the brute-force functions', () => {
    const p = new ProviderRecords();
    for (const r of records) p.add(r);
    const got = p.aggregates('claude', windows, NOW, lookup);
    for (const k of ['block', 'today', 'week', 'month'] as const) {
      const want = totalsForWindow(records, windows[k], lookup);
      expect(got[k].tokens).toEqual(want.tokens);
      expect(got[k].costUSD).toBeCloseTo(want.costUSD!, 6);
      expect(Object.keys(got[k].byModel).sort()).toEqual(Object.keys(want.byModel).sort());
    }
    expect(got.burnRatePerHour).toBeCloseTo(burnRatePerHour(records, NOW, lookup)!, 9);
    const spark = hourlySparkline(records, NOW, lookup);
    got.hourlySparkline.forEach((v, i) => expect(v).toBeCloseTo(spark[i]!, 9));
    expect(got.unknownModels).toEqual(unknownModelsIn(records, lookup));
  });

  it('derives the same block as deriveCurrentBlock, incrementally and after removals', () => {
    const p = new ProviderRecords();
    const sorted = (rs: UsageRecord[]) => rs.map((r) => r.timestamp).sort((a, b) => a - b);
    for (const r of records.slice(0, 1500)) p.add(r);
    for (const now of [NOW - 20 * H, NOW, NOW + 7 * H, NOW]) {
      expect(p.derivedBlockStart(now)).toBe(
        deriveCurrentBlock(sorted(records.slice(0, 1500)), now)?.start ?? null,
      );
    }
    for (const r of records.slice(1500)) p.add(r); // includes old inserts into sealed hours
    expect(p.derivedBlockStart(NOW)).toBe(deriveCurrentBlock(sorted(records), NOW)?.start ?? null);
    const gone = new Set(records.filter((r) => r.timestamp > NOW - 6 * H));
    p.remove(gone);
    const rest = records.filter((r) => !gone.has(r));
    expect(p.derivedBlockStart(NOW)).toBe(deriveCurrentBlock(sorted(rest), NOW)?.start ?? null);
    expect(p.aggregates('claude', windows, NOW, lookup).month.tokens).toEqual(
      totalsForWindow(rest, windows.month, lookup).tokens,
    );
  });

  it('prune returns the dropped records', () => {
    const p = new ProviderRecords();
    for (const r of records) p.add(r);
    const horizon = NOW - 35 * 24 * H;
    expect(p.prune(horizon).length).toBe(records.filter((r) => r.timestamp < horizon).length);
  });
});
