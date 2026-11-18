import { recordCost } from './cost.js';
import {
  addTokens,
  ZERO_TOKENS,
  type ModelTotals,
  type PriceLookup,
  type Provider,
  type TokenCounts,
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
  const totals: WindowTotals = {
    costUSD: lookup ? 0 : null,
    tokens: { ...ZERO_TOKENS },
    byModel: Object.create(null) as Record<string, ModelTotals>,
  };
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

// ---- Incremental accumulation -------------------------------------------------
// recordCost is linear in token counts except for the "unpriced cache read/write" null rules, which depend
// on whether a record has any cacheRead / cacheWrite tokens. Records are therefore summed into four buckets
// per model by that signature; pricing the bucket sums equals pricing each record (up to float summation order).

interface Bucket {
  n: number;
  tokens: TokenCounts;
}
interface ModelAcc {
  /** Bucket index of the model's first record (decides whether m.costUSD starts at 0 or null). */
  first: number;
  buckets: (Bucket | undefined)[];
}

function bucketIndex(t: TokenCounts): number {
  return (t.cacheRead > 0 ? 1 : 0) | (t.cacheWrite5m > 0 || t.cacheWrite1h > 0 ? 2 : 0);
}

/** Sums usage records per model so window totals can be priced without revisiting every record. */
export class UsageAccumulator {
  private readonly models = new Map<string, ModelAcc>();

  add(r: UsageRecord): void {
    const bi = bucketIndex(r.tokens);
    let acc = this.models.get(r.model);
    if (!acc) {
      acc = { first: bi, buckets: [undefined, undefined, undefined, undefined] };
      this.models.set(r.model, acc);
    }
    let b = acc.buckets[bi];
    if (!b) acc.buckets[bi] = b = { n: 0, tokens: { ...ZERO_TOKENS } };
    b.n++;
    const t = b.tokens;
    t.input += r.tokens.input;
    t.output += r.tokens.output;
    t.cacheWrite5m += r.tokens.cacheWrite5m;
    t.cacheWrite1h += r.tokens.cacheWrite1h;
    t.cacheRead += r.tokens.cacheRead;
  }

  /** Adds another accumulator's sums (as if its records had been added after this one's). */
  merge(o: UsageAccumulator): void {
    for (const [model, oa] of o.models) {
      let acc = this.models.get(model);
      if (!acc) {
        acc = { first: oa.first, buckets: [undefined, undefined, undefined, undefined] };
        this.models.set(model, acc);
      }
      oa.buckets.forEach((ob, i) => {
        if (!ob) return;
        let b = acc.buckets[i];
        if (!b) acc.buckets[i] = b = { n: 0, tokens: { ...ZERO_TOKENS } };
        b.n += ob.n;
        b.tokens = addTokens(b.tokens, ob.tokens);
      });
    }
  }

  modelNames(): IterableIterator<string> {
    return this.models.keys();
  }

  /** Same result as totalsForWindow over every added record (all of one provider). */
  totals(lookup: PriceLookup | null, provider: Provider | undefined): WindowTotals {
    const totals: WindowTotals = {
      costUSD: lookup ? 0 : null,
      tokens: { ...ZERO_TOKENS },
      byModel: Object.create(null) as Record<string, ModelTotals>,
    };
    const codex = provider === 'codex';
    for (const [model, acc] of this.models) {
      const price = lookup?.(model, provider);
      const costs = acc.buckets.map((b) => (b ? (lookup ? recordCost(b.tokens, price) : null) : undefined));
      const m: ModelTotals = { costUSD: costs[acc.first] !== null ? 0 : null, tokens: { ...ZERO_TOKENS } };
      totals.byModel[model] = m;
      acc.buckets.forEach((b, i) => {
        if (!b) return;
        m.tokens = addTokens(m.tokens, b.tokens);
        totals.tokens = addTokens(totals.tokens, b.tokens);
        const cost = costs[i] as number | null;
        if (cost === null && codex) {
          totals.costIncomplete = true;
          m.costIncomplete = true;
        }
        if (cost !== null) {
          m.costUSD = (m.costUSD ?? 0) + cost;
          totals.costUSD = (totals.costUSD ?? 0) + cost;
        }
      });
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
}

export interface ProviderAggregates {
  block: WindowTotals;
  today: WindowTotals;
  week: WindowTotals;
  month: WindowTotals;
  burnRatePerHour: number | null;
  hourlySparkline: number[];
  unknownModels: string[];
}

export interface ProviderAggregates {
  block: WindowTotals;
  today: WindowTotals;
  week: WindowTotals;
  month: WindowTotals;
  burnRatePerHour: number | null;
  hourlySparkline: number[];
  unknownModels: string[];
}
