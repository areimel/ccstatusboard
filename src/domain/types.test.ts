import { describe, expect, it } from 'vitest';
import { addTokens, emptyWindowTotals, ZERO_TOKENS } from './types.js';

describe('types helpers', () => {
  it('addTokens sums every field', () => {
    const a = { input: 1, output: 2, cacheWrite5m: 3, cacheWrite1h: 4, cacheRead: 5 };
    expect(addTokens(a, a)).toEqual({ input: 2, output: 4, cacheWrite5m: 6, cacheWrite1h: 8, cacheRead: 10 });
  });
  it('ZERO_TOKENS is frozen and emptyWindowTotals returns fresh objects', () => {
    expect(Object.isFrozen(ZERO_TOKENS)).toBe(true);
    const w1 = emptyWindowTotals();
    const w2 = emptyWindowTotals();
    w1.tokens.input = 5;
    expect(w2.tokens.input).toBe(0);
    expect(w1.costUSD).toBe(0);
  });
});
