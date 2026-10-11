import type { ModelPrice, TokenCounts } from './types.js';

/** USD cost of one usage record; null when the model has no known price. */
export function recordCost(tokens: TokenCounts, price: ModelPrice | undefined): number | null {
  if (!price) return null;
  return (
    tokens.input * price.input +
    tokens.output * price.output +
    tokens.cacheWrite5m * price.cacheWrite +
    tokens.cacheWrite1h * (price.cacheWrite1h ?? price.cacheWrite) +
    tokens.cacheRead * price.cacheRead
  );
}

/** Adds two costs; null only when both are null (an unknown side counts as 0). */
export function sumCost(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null;
  return (a ?? 0) + (b ?? 0);
}
