/**
 * Burn-rate math: the single place to tweak how limit projections are made.
 *
 * The model in plain words: a limit window (5h block or 7d week) fills from 0%
 * at its start to `percent` now. We estimate two speeds:
 *   - the AVERAGE rate: percent used divided by hours elapsed since window start;
 *   - the RECENT rate: least-squares slope of recent samples (last 45min for a
 *     block, 12h for a week), which reacts to a sudden change in pace.
 * The two are blended (RECENT_WEIGHT on recent), then extrapolated linearly to
 * the window reset to get a projected utilization. That projection is bucketed
 * into a band, and if 100% would be reached before the reset we also report
 * when. Everything here is pure; `now` is always passed in.
 */
import type { BurnBand, BurnProjection, BurnWindowKind, Limit, LimitSample } from './types.js';

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

/** Length of each limit window. */
export const WINDOW_MS: Record<BurnWindowKind, number> = {
  block: 5 * HOUR_MS,
  week: 7 * 24 * HOUR_MS,
};

/** How far back samples count towards the recent slope. */
export const RECENT_LOOKBACK_MS: Record<BurnWindowKind, number> = {
  block: 45 * MINUTE_MS,
  week: 12 * HOUR_MS,
};

/** Recent samples must span at least this long, otherwise the slope is noise. */
export const MIN_RECENT_SPAN_MS = 5 * MINUTE_MS;

/**
 * Below this much elapsed window time the average rate is not meaningful: one
 * early prompt over a tiny denominator would project a false CRITICAL.
 */
export const MIN_AVERAGE_ELAPSED_MS: Record<BurnWindowKind, number> = {
  block: 15 * MINUTE_MS,
  week: 6 * HOUR_MS,
};

/** Weight of the recent slope in the blend (the average gets 1 - this). */
export const RECENT_WEIGHT = 0.6;

/** Ring-buffer capacity the store should use per limit. */
export const MAX_SAMPLES = 720;

/**
 * Band cut-offs on projected utilization at reset:
 *   under    p < near
 *   near     near <= p <= over   (at or close to the limit; exactly 100 is "near")
 *   over     over < p <= critical
 *   critical p > critical
 */
export const BAND_THRESHOLDS = { near: 85, over: 100, critical: 125 } as const;

/** Start of the window that ends at `resetsAt`. */
export function windowStart(resetsAt: number, kind: BurnWindowKind): number {
  return resetsAt - WINDOW_MS[kind];
}

/** Percentage points per hour since window start; undefined if too little time has elapsed. */
export function averageRate(
  pct: number,
  start: number,
  now: number,
  kind: BurnWindowKind,
): number | undefined {
  const elapsed = now - start;
  if (elapsed < MIN_AVERAGE_ELAPSED_MS[kind]) return undefined;
  return pct / (elapsed / HOUR_MS);
}

/**
 * Least-squares slope (pct/hour) over samples inside the lookback and the
 * current window. Undefined with fewer than 2 samples or a span shorter than
 * MIN_RECENT_SPAN_MS. Negative slopes clamp to 0.
 */
export function recentRate(
  samples: readonly LimitSample[],
  now: number,
  kind: BurnWindowKind,
  start: number = now - WINDOW_MS[kind],
): number | undefined {
  const from = Math.max(now - RECENT_LOOKBACK_MS[kind], start);
  const pts = samples.filter((s) => s.t >= from && s.t <= now);
  if (pts.length < 2) return undefined;
  const ts = pts.map((s) => s.t);
  if (Math.max(...ts) - Math.min(...ts) < MIN_RECENT_SPAN_MS) return undefined;

  // Centre on the means for numerical stability (epoch ms are large).
  const n = pts.length;
  const meanT = ts.reduce((a, b) => a + b, 0) / n;
  const meanP = pts.reduce((a, s) => a + s.pct, 0) / n;
  let num = 0;
  let den = 0;
  for (const s of pts) {
    num += (s.t - meanT) * (s.pct - meanP);
    den += (s.t - meanT) ** 2;
  }
  if (den === 0) return undefined;
  return Math.max(0, (num / den) * HOUR_MS);
}

/** Blend average and recent rates; falls back to whichever exists. */
export function blendedRate(avg: number | undefined, recent: number | undefined): number | undefined {
  if (avg !== undefined && recent !== undefined) {
    return RECENT_WEIGHT * recent + (1 - RECENT_WEIGHT) * avg;
  }
  return recent ?? avg;
}

export function classifyBand(projectedPct: number): BurnBand {
  if (projectedPct < BAND_THRESHOLDS.near) return 'under';
  if (projectedPct <= BAND_THRESHOLDS.over) return 'near';
  if (projectedPct <= BAND_THRESHOLDS.critical) return 'over';
  return 'critical';
}

/**
 * When 100% is hit, if before the window ends. Already at/over 100 -> now.
 * Undefined when not projected to hit (UI shows n/a).
 */
export function timeToLimit(
  pct: number,
  rate: number,
  now: number,
  start: number,
  kind: BurnWindowKind,
): { hitAt: number; hitWindowPct: number } | undefined {
  const duration = WINDOW_MS[kind];
  const toWindowPct = (t: number) => ((t - start) / duration) * 100;
  if (pct >= 100) return { hitAt: now, hitWindowPct: toWindowPct(now) };
  if (!(rate > 0)) return undefined;
  const hitAt = now + ((100 - pct) / rate) * HOUR_MS;
  if (hitAt > start + duration) return undefined;
  return { hitAt, hitWindowPct: toWindowPct(hitAt) };
}

/** Full projection for one limit; undefined without a limit or its reset time. */
export function projectBurn(
  limit: Limit | undefined,
  samples: readonly LimitSample[],
  now: number,
  kind: BurnWindowKind,
): BurnProjection | undefined {
  if (!limit || limit.resetsAt === undefined) return undefined;
  const start = windowStart(limit.resetsAt, kind);
  const rate =
    blendedRate(averageRate(limit.percent, start, now, kind), recentRate(samples, now, kind, start)) ?? 0;
  const remainingHours = Math.max(0, limit.resetsAt - now) / HOUR_MS;
  const projectedPct = limit.percent + rate * remainingHours;
  return {
    currentPct: limit.percent,
    ratePctPerHour: rate,
    projectedPct,
    band: classifyBand(projectedPct),
    ...timeToLimit(limit.percent, rate, now, start, kind),
  };
}

/** Samples within the last window length, newest MAX_SAMPLES kept, chronological. */
export function trimSamples(
  samples: readonly LimitSample[],
  now: number,
  kind: BurnWindowKind,
): LimitSample[] {
  const from = now - WINDOW_MS[kind];
  const kept = samples.filter((s) => s.t >= from && s.t <= now);
  return kept.length > MAX_SAMPLES ? kept.slice(kept.length - MAX_SAMPLES) : kept;
}
