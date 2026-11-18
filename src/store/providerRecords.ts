import { UsageAccumulator, type ProviderAggregates } from '../domain/aggregate.js';
import { recordCost } from '../domain/cost.js';
import { FIVE_HOURS_MS } from '../domain/windows.js';
import type { PriceLookup, Provider, TimeWindow, UsageRecord } from '../domain/types.js';

const HOUR_MS = 3_600_000;

const hourOf = (ts: number): number => (Number.isFinite(ts) ? Math.floor(ts / HOUR_MS) : -1);

interface HourBucket {
  hour: number;
  records: UsageRecord[];
  acc: UsageAccumulator;
}

function rebuild(b: HourBucket, records: UsageRecord[]): void {
  b.records = records;
  b.acc = new UsageAccumulator();
  for (const r of records) b.acc.add(r);
}

/** Block state machine position after processing every record of all buckets up to `lastHour` (ccusage blocks). */
interface BlockCache {
  lastHour: number;
  count: number;
  blockStart: number | null;
  prev: number | null;
}

/**
 * One provider's usage records, bucketed by UTC hour. Each bucket keeps a per-model accumulator, so window
 * totals merge whole-hour accumulators and only scan the (few) records of partially covered edge hours.
 */
export class ProviderRecords {
  /** Bumped on every add/remove; keys the store's aggregate cache. */
  version = 0;
  private readonly buckets = new Map<number, HourBucket>();
  /** Bucket hours, ascending. */
  private order: number[] = [];
  private blockCache: BlockCache | undefined;

  add(r: UsageRecord): void {
    const hour = hourOf(r.timestamp);
    let b = this.buckets.get(hour);
    if (!b) {
      b = { hour, records: [], acc: new UsageAccumulator() };
      this.buckets.set(hour, b);
      const last = this.order[this.order.length - 1];
      if (last === undefined || hour > last) this.order.push(hour);
      else {
        this.order.push(hour);
        this.order.sort((a, c) => a - c);
      }
    }
    if (this.blockCache && hour <= this.blockCache.lastHour) this.blockCache = undefined;
    b.records.push(r);
    b.acc.add(r);
    this.version++;
  }

  /** Removes the given record objects. */
  remove(gone: ReadonlySet<UsageRecord>): void {
    const hours = new Set<number>();
    for (const r of gone) hours.add(hourOf(r.timestamp));
    this.filterBuckets(hours, (r) => !gone.has(r));
  }

  /** Drops records older than `horizon`; returns them (for dedup cleanup). */
  prune(horizon: number): UsageRecord[] {
    const removed: UsageRecord[] = [];
    const hours = new Set<number>();
    const lastOld = hourOf(horizon);
    for (const h of this.order) if (h <= lastOld) hours.add(h);
    this.filterBuckets(hours, (r) => {
      if (r.timestamp >= horizon) return true;
      removed.push(r);
      return false;
    });
    return removed;
  }

  private filterBuckets(hours: Set<number>, keep: (r: UsageRecord) => boolean): void {
    let changed = false;
    for (const h of hours) {
      const b = this.buckets.get(h);
      if (!b) continue;
      const kept = b.records.filter(keep);
      if (kept.length === b.records.length) continue;
      changed = true;
      if (kept.length === 0) this.buckets.delete(h);
      else rebuild(b, kept);
    }
    if (!changed) return;
    this.order = this.order.filter((h) => this.buckets.has(h));
    this.blockCache = undefined;
    this.version++;
  }

  /** Start of the current ccusage-style 5h block, or null when none is active (see deriveCurrentBlock). */
  derivedBlockStart(now: number): number | null {
    const nowHour = hourOf(now);
    if (this.blockCache && this.blockCache.lastHour >= nowHour) this.blockCache = undefined;
    const cache = this.blockCache;
    let i = cache ? cache.count : 0;
    let blockStart = cache ? cache.blockStart : null;
    let prev = cache ? cache.prev : null;
    let sealed: BlockCache | undefined = cache;
    for (; i < this.order.length; i++) {
      const h = this.order[i]!;
      const b = this.buckets.get(h)!;
      const isSealed = h < nowHour;
      const ts = b.records.map((r) => r.timestamp).sort((x, y) => x - y);
      for (const t of ts) {
        if (t > now) break;
        const pastEnd = blockStart !== null && t >= blockStart + FIVE_HOURS_MS;
        const longGap = prev !== null && t - prev > FIVE_HOURS_MS;
        if (blockStart === null || pastEnd || longGap) blockStart = Math.floor(t / HOUR_MS) * HOUR_MS;
        prev = t;
      }
      if (isSealed) sealed = { lastHour: h, count: i + 1, blockStart, prev };
      else if (h > nowHour) break;
    }
    this.blockCache = sealed;
    if (blockStart === null || now >= blockStart + FIVE_HOURS_MS) return null;
    return blockStart;
  }

  private windowTotals(w: TimeWindow): UsageAccumulator {
    const acc = new UsageAccumulator();
    if (w.end < w.start) return acc;
    const lo = hourOf(w.start);
    const hi = hourOf(w.end);
    let i = lowerBound(this.order, lo);
    for (; i < this.order.length; i++) {
      const h = this.order[i]!;
      if (h > hi) break;
      const b = this.buckets.get(h)!;
      if (h * HOUR_MS >= w.start && (h + 1) * HOUR_MS - 1 <= w.end && h >= 0) acc.merge(b.acc);
      else for (const r of b.records) if (r.timestamp >= w.start && r.timestamp <= w.end) acc.add(r);
    }
    return acc;
  }

  aggregates(
    provider: Provider,
    windows: { block: TimeWindow; today: TimeWindow; week: TimeWindow; month: TimeWindow },
    now: number,
    lookup: PriceLookup | null,
  ): ProviderAggregates {
    const codex = provider === 'codex';
    const spark = new Array<number>(24).fill(0);
    let burn: number | null = lookup ? 0 : null;
    let sparkIncomplete = false;
    if (lookup) {
      for (let i = lowerBound(this.order, hourOf(now - 24 * HOUR_MS)); i < this.order.length; i++) {
        for (const r of this.buckets.get(this.order[i]!)!.records) {
          const age = now - r.timestamp;
          if (!(age >= 0 && age <= 24 * HOUR_MS)) continue;
          const cost = recordCost(r.tokens, lookup(r.model, provider));
          if (age < HOUR_MS && burn !== null) {
            if (cost === null && codex) burn = null;
            else burn += cost ?? 0;
          }
          const idx = age === 0 ? 23 : 24 - Math.ceil(age / HOUR_MS);
          if (idx < 0 || idx >= 24) continue;
          if (cost === null && codex) sparkIncomplete = true;
          spark[idx] = (spark[idx] ?? 0) + (cost ?? 0);
        }
      }
    }
    const unknown = new Set<string>();
    if (lookup) {
      const seen = new Set<string>();
      for (const b of this.buckets.values())
        for (const m of b.acc.modelNames()) {
          if (seen.has(m)) continue;
          seen.add(m);
          if (!lookup(m, provider)) unknown.add(m);
        }
    }
    return {
      block: this.windowTotals(windows.block).totals(lookup, provider),
      today: this.windowTotals(windows.today).totals(lookup, provider),
      week: this.windowTotals(windows.week).totals(lookup, provider),
      month: this.windowTotals(windows.month).totals(lookup, provider),
      burnRatePerHour: burn,
      hourlySparkline: sparkIncomplete ? [] : spark,
      unknownModels: [...unknown].sort(),
    };
  }
}

function lowerBound(arr: number[], v: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid]! < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
