import type { ModelPrice } from './types.js';

export const DEFAULT_CONTEXT_WINDOW = 200_000;
const ONE_MILLION = 1_000_000;

export function contextWindowFor(model: string | undefined, price: ModelPrice | undefined): number {
  if (model?.endsWith('[1m]')) return ONE_MILLION;
  return price?.maxInputTokens ?? DEFAULT_CONTEXT_WINDOW;
}

export function contextPercent(tokens: number, window: number): number {
  if (window <= 0) return 0;
  return Math.max(0, Math.round((tokens / window) * 100));
}

export interface ContextInputs {
  lastUsage?: { timestamp: number; contextTokens: number };
  lastCompact?: { timestamp: number; postTokens: number };
}

/** Context tokens now: compact postTokens win until a newer assistant record arrives (spec §4.1). */
export function currentContextTokens(i: ContextInputs): number | undefined {
  const { lastUsage, lastCompact } = i;
  if (lastCompact && (!lastUsage || lastCompact.timestamp > lastUsage.timestamp)) {
    return lastCompact.postTokens;
  }
  return lastUsage?.contextTokens;
}
