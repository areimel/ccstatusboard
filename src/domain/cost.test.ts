import { describe, expect, it } from 'vitest';
import { recordCost, sumCost } from './cost.js';
import type { ModelPrice, TokenCounts } from './types.js';

const tokens: TokenCounts = {
  input: 1000,
  output: 2000,
  cacheWrite5m: 4000,
  cacheWrite1h: 1000,
  cacheRead: 10_000,
};

const opus: ModelPrice = {
  input: 5e-6,
  output: 25e-6,
  cacheWrite: 6.25e-6,
  cacheWrite1h: 10e-6,
  cacheRead: 0.5e-6,
};

describe('recordCost', () => {
  it('prices every token class, using the 1h cache-write price when present', () => {
    // 0.005 + 0.05 + 0.025 + 0.01 + 0.005
    expect(recordCost(tokens, opus)).toBeCloseTo(0.095, 10);
  });
  it('falls back to the 5m cache-write price for 1h writes when cacheWrite1h is missing', () => {
    const noOneHour: ModelPrice = { ...opus };
    delete noOneHour.cacheWrite1h;
    // 0.005 + 0.05 + 0.025 + 0.00625 + 0.005
    expect(recordCost(tokens, noOneHour)).toBeCloseTo(0.09125, 10);
  });
  it('returns null for an unknown model (price undefined)', () => {
    expect(recordCost(tokens, undefined)).toBeNull();
  });
  it('returns 0 for zero tokens', () => {
    expect(recordCost({ input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 }, opus)).toBe(0);
  });
});

describe('sumCost', () => {
  it('is null only when both sides are null', () => {
    expect(sumCost(null, null)).toBeNull();
  });
  it('treats a single null as 0', () => {
    expect(sumCost(1.5, null)).toBe(1.5);
    expect(sumCost(null, 2)).toBe(2);
  });
  it('adds two numbers', () => {
    expect(sumCost(1.25, 2.5)).toBe(3.75);
  });
});
