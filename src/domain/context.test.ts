import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTEXT_WINDOW, contextPercent, contextWindowFor, currentContextTokens } from './context.js';
import type { ModelPrice } from './types.js';

const price = (maxInputTokens?: number): ModelPrice => ({
  input: 1e-6,
  output: 1e-6,
  cacheWrite: 1e-6,
  cacheRead: 1e-7,
  ...(maxInputTokens === undefined ? {} : { maxInputTokens }),
});

describe('contextWindowFor', () => {
  it('uses 1,000,000 for [1m] model ids regardless of price', () => {
    expect(contextWindowFor('claude-sonnet-5-5[1m]', price(200_000))).toBe(1_000_000);
  });
  it('uses LiteLLM max_input_tokens when known', () => {
    expect(contextWindowFor('claude-opus-5-5', price(500_000))).toBe(500_000);
  });
  it('falls back to 200,000 when the model or its window is unknown', () => {
    expect(contextWindowFor('claude-opus-5-5', price())).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(contextWindowFor('mystery', undefined)).toBe(200_000);
    expect(contextWindowFor(undefined, undefined)).toBe(200_000);
  });
});

describe('contextPercent', () => {
  it('rounds to the nearest whole percent', () => {
    expect(contextPercent(122_000, 200_000)).toBe(61);
    expect(contextPercent(1_000, 200_000)).toBe(1); // 0.5 rounds up
  });
  it('does not clamp above 100', () => {
    expect(contextPercent(210_000, 200_000)).toBe(105);
  });
  it('clamps negatives and zero windows to 0', () => {
    expect(contextPercent(-5, 200_000)).toBe(0);
    expect(contextPercent(1000, 0)).toBe(0);
  });
});

describe('currentContextTokens', () => {
  it('returns undefined with no data', () => {
    expect(currentContextTokens({})).toBeUndefined();
  });
  it('uses the last usage when there is no compact', () => {
    expect(currentContextTokens({ lastUsage: { timestamp: 10, contextTokens: 150_000 } })).toBe(150_000);
  });
  it('uses postTokens when a compact boundary is newer than the last usage', () => {
    expect(
      currentContextTokens({
        lastUsage: { timestamp: 10, contextTokens: 180_000 },
        lastCompact: { timestamp: 20, postTokens: 30_000 },
      }),
    ).toBe(30_000);
  });
  it('uses the usage again once a newer assistant record arrives after the compact', () => {
    expect(
      currentContextTokens({
        lastUsage: { timestamp: 30, contextTokens: 42_000 },
        lastCompact: { timestamp: 20, postTokens: 30_000 },
      }),
    ).toBe(42_000);
  });
  it('uses postTokens when only a compact exists', () => {
    expect(currentContextTokens({ lastCompact: { timestamp: 5, postTokens: 12_000 } })).toBe(12_000);
  });
});
