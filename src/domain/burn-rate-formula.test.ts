import { describe, expect, it } from 'vitest';
import {
  BAND_THRESHOLDS,
  MAX_SAMPLES,
  RECENT_WEIGHT,
  WINDOW_MS,
  averageRate,
  blendedRate,
  classifyBand,
  projectBurn,
  recentRate,
  timeToLimit,
  trimSamples,
  windowStart,
} from './burn-rate-formula.js';

const H = 3_600_000;
const M = 60_000;
const NOW = Date.parse('2026-10-11T14:32:07Z');

describe('windowStart', () => {
  it('subtracts the window length', () => {
    expect(windowStart(NOW, 'block')).toBe(NOW - 5 * H);
    expect(windowStart(NOW, 'week')).toBe(NOW - 7 * 24 * H);
  });
});

describe('averageRate', () => {
  it('is pct per elapsed hour', () => {
    expect(averageRate(30, NOW - 2 * H, NOW)).toBeCloseTo(15);
  });
  it('is undefined when nothing or too little has elapsed', () => {
    expect(averageRate(30, NOW, NOW)).toBeUndefined();
    expect(averageRate(30, NOW + H, NOW)).toBeUndefined();
    expect(averageRate(30, NOW - 30_000, NOW)).toBeUndefined();
  });
});

describe('recentRate', () => {
  const start = NOW - 4 * H;
  it('fits a least-squares slope in pct/hour', () => {
    const samples = [
      { t: NOW - 30 * M, pct: 10 },
      { t: NOW - 15 * M, pct: 15 },
      { t: NOW, pct: 20 },
    ];
    expect(recentRate(samples, NOW, 'block', start)).toBeCloseTo(20);
  });
  it('ignores samples older than the lookback', () => {
    const samples = [
      { t: NOW - 3 * H, pct: 0 },
      { t: NOW - 30 * M, pct: 10 },
      { t: NOW, pct: 20 },
    ];
    expect(recentRate(samples, NOW, 'block', start)).toBeCloseTo(20);
  });
  it('is undefined with fewer than 2 samples or a short span', () => {
    expect(recentRate([{ t: NOW, pct: 5 }], NOW, 'block', start)).toBeUndefined();
    const short = [
      { t: NOW - 2 * M, pct: 5 },
      { t: NOW, pct: 6 },
    ];
    expect(recentRate(short, NOW, 'block', start)).toBeUndefined();
  });
  it('clamps negative slopes to 0', () => {
    const samples = [
      { t: NOW - 20 * M, pct: 12 },
      { t: NOW, pct: 10 },
    ];
    expect(recentRate(samples, NOW, 'block', start)).toBe(0);
  });
  it('excludes samples from before the window start', () => {
    const resetStart = NOW - 10 * M;
    const samples = [
      { t: NOW - 30 * M, pct: 95 },
      { t: NOW - 9 * M, pct: 1 },
      { t: NOW, pct: 2 },
    ];
    // Only the two post-reset samples count: 1pt over 9min.
    expect(recentRate(samples, NOW, 'block', resetStart)).toBeCloseTo((1 / 9) * 60);
  });
});

describe('blendedRate', () => {
  it('weights recent by RECENT_WEIGHT', () => {
    expect(blendedRate(10, 20)).toBeCloseTo(RECENT_WEIGHT * 20 + (1 - RECENT_WEIGHT) * 10);
  });
  it('falls back to whichever is defined', () => {
    expect(blendedRate(10, undefined)).toBe(10);
    expect(blendedRate(undefined, 7)).toBe(7);
    expect(blendedRate(undefined, undefined)).toBeUndefined();
  });
});

describe('classifyBand', () => {
  it.each([
    [0, 'under'],
    [84.9, 'under'],
    [85, 'near'],
    [100, 'near'],
    [100.1, 'over'],
    [125, 'over'],
    [125.1, 'critical'],
  ] as const)('%s -> %s', (p, band) => {
    expect(classifyBand(p)).toBe(band);
  });
  it('uses the exported thresholds', () => {
    expect(BAND_THRESHOLDS).toEqual({ near: 85, over: 100, critical: 125 });
  });
});

describe('timeToLimit', () => {
  const start = NOW - 1 * H;
  it('is undefined when not on course to hit', () => {
    expect(timeToLimit(40, 0, NOW, start, 'block')).toBeUndefined();
  });
  it('returns now when already at or over 100', () => {
    const r = timeToLimit(100, 5, NOW, start, 'block');
    expect(r?.hitAt).toBe(NOW);
    expect(r?.hitWindowPct).toBeCloseTo(20);
  });
  it('computes the hit time inside the window', () => {
    // 60% left at 30%/h = 2h from now; window is 1h in -> 3h of 5h = 60%.
    const r = timeToLimit(40, 30, NOW, start, 'block');
    expect(r?.hitAt).toBe(NOW + 2 * H);
    expect(r?.hitWindowPct).toBeCloseTo(60);
  });
  it('is undefined when the hit would land after the reset', () => {
    // 60% left at 10%/h = 6h, window has only 4h left.
    expect(timeToLimit(40, 10, NOW, start, 'block')).toBeUndefined();
  });
});

describe('projectBurn', () => {
  it('is undefined without a limit or resetsAt', () => {
    expect(projectBurn(undefined, [], NOW, 'block')).toBeUndefined();
    expect(projectBurn({ label: 'x', percent: 10 }, [], NOW, 'block')).toBeUndefined();
  });
  it('extrapolates the average to reset when there are no samples', () => {
    // 2h in, 20% used -> 10%/h; 3h remain -> 50%.
    const resetsAt = NOW + 3 * H;
    const p = projectBurn({ label: 'b', percent: 20, resetsAt }, [], NOW, 'block');
    expect(p?.ratePctPerHour).toBeCloseTo(10);
    expect(p?.projectedPct).toBeCloseTo(50);
    expect(p?.band).toBe('under');
    expect(p?.hitAt).toBeUndefined();
  });
  it('blends recent and reports a hit time', () => {
    const resetsAt = NOW + 3 * H;
    const samples = [
      { t: NOW - 30 * M, pct: 10 },
      { t: NOW, pct: 20 },
    ];
    const p = projectBurn({ label: 'b', percent: 20, resetsAt }, samples, NOW, 'block');
    // avg 10, recent 20 -> 0.6*20 + 0.4*10 = 16
    expect(p?.ratePctPerHour).toBeCloseTo(16);
    expect(p?.projectedPct).toBeCloseTo(68);
    expect(p?.hitAt).toBeUndefined();
  });
  it('ignores pre-reset samples', () => {
    const resetsAt = NOW + 5 * H - 10 * M; // window started 10min ago
    const samples = [
      { t: NOW - 60 * M, pct: 90 },
      { t: NOW - 30 * M, pct: 98 },
    ];
    const p = projectBurn({ label: 'b', percent: 2, resetsAt }, samples, NOW, 'block');
    expect(p?.ratePctPerHour).toBeCloseTo(12); // average only
  });
});

describe('trimSamples', () => {
  it('drops samples outside the window and future ones', () => {
    const samples = [
      { t: NOW - WINDOW_MS.block - 1, pct: 1 },
      { t: NOW - H, pct: 2 },
      { t: NOW + H, pct: 3 },
    ];
    expect(trimSamples(samples, NOW, 'block')).toEqual([{ t: NOW - H, pct: 2 }]);
  });
  it('caps to the newest MAX_SAMPLES', () => {
    const samples = Array.from({ length: MAX_SAMPLES + 5 }, (_, i) => ({
      t: NOW - (MAX_SAMPLES + 5 - i) * 1000,
      pct: i,
    }));
    const out = trimSamples(samples, NOW, 'block');
    expect(out).toHaveLength(MAX_SAMPLES);
    expect(out[out.length - 1]).toBe(samples[samples.length - 1]);
  });
});
