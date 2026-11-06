import { recordCost } from './cost.js';
import {
  addTokens,
  ZERO_TOKENS,
  type ModelTotals,
  type PriceLookup,
  type TimeWindow,
  type UsageRecord,
  type WindowTotals,
} from './types.js';

const HOUR_MS = 60 * 60 * 1000;

export function totalsForWindow(
  records: Iterable<UsageRecord>,
  w: TimeWindow,
  lookup: PriceLookup | null,
): WindowTotals {
  const totals: WindowTotals = { costUSD: lookup ? 0 : null, tokens: { ...ZERO_TOKENS }, byModel: {} };
  for (const r of records) {
    if (r.timestamp < w.start || r.timestamp > w.end) continue;
    const price = lookup?.(r.model, r.provider);
    const cost = lookup ? recordCost(r.tokens, price) : null;

    let m: ModelTotals | undefined = totals.byModel[r.model];
    if (!m) {
      m = { costUSD: cost !== null ? 0 : null, tokens: { ...ZERO_TOKENS } };
      totals.byModel[r.model] = m;
    }
    m.tokens = addTokens(m.tokens, r.tokens);
    totals.tokens = addTokens(totals.tokens, r.tokens);
    if (cost === null && r.provider === 'codex') {
      totals.costIncomplete = true;
      m.costIncomplete = true;
    }
    if (cost !== null) {
      m.costUSD = (m.costUSD ?? 0) + cost;
      totals.costUSD = (totals.costUSD ?? 0) + cost;
    }
  }
  if (
    totals.costIncomplete &&
    Object.values(totals.byModel).every(
      (model) => model.costUSD === null || (model.costIncomplete && model.costUSD === 0),
    )
  ) {
    totals.costUSD = null;
  }
  return totals;
}

export function unknownModelsIn(records: Iterable<UsageRecord>, lookup: PriceLookup | null): string[] {
  if (!lookup) return [];
  const unknown = new Set<string>();
  for (const r of records) if (!lookup(r.model, r.provider)) unknown.add(r.model);
  return [...unknown].sort();
}

/** Cost of records in (now - 60 min, now], i.e. $/h. */
export function burnRatePerHour(
  records: Iterable<UsageRecord>,
  now: number,
  lookup: PriceLookup | null,
): number | null {
  if (!lookup) return null;
  let sum = 0;
  for (const r of records) {
    if (r.timestamp > now - HOUR_MS && r.timestamp <= now) {
      const cost = recordCost(r.tokens, lookup(r.model, r.provider));
      if (cost === null && r.provider === 'codex') return null;
      sum += cost ?? 0;
    }
  }
  return sum;
}

/** Hourly cost buckets, oldest first; bucket i = [now-(hours-i)h, now-(hours-i-1)h), newest also includes now. */
export function hourlySparkline(
  records: Iterable<UsageRecord>,
  now: number,
  lookup: PriceLookup | null,
  hours = 24,
): number[] {
  const buckets = new Array<number>(hours).fill(0);
  if (!lookup) return buckets;
  for (const r of records) {
    const age = now - r.timestamp;
    if (age < 0) continue;
    const i = age === 0 ? hours - 1 : hours - Math.ceil(age / HOUR_MS);
    if (i < 0 || i >= hours) continue;
    const cost = recordCost(r.tokens, lookup(r.model, r.provider));
    if (cost === null && r.provider === 'codex') return [];
    buckets[i] = (buckets[i] ?? 0) + (cost ?? 0);
  }
  return buckets;
}
