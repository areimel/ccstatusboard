import type { TimeWindow } from './types.js';

export const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export function blockWindowFromLimit(resetsAt: number, now: number): TimeWindow {
  return { start: resetsAt - FIVE_HOURS_MS, end: now };
}

export function weekWindowFromLimit(resetsAt: number, now: number): TimeWindow {
  return { start: resetsAt - SEVEN_DAYS_MS, end: now };
}

export function todayWindow(now: number): TimeWindow {
  const d = new Date(now);
  return { start: new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(), end: now };
}

export function monthWindow(now: number): TimeWindow {
  const d = new Date(now);
  return { start: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), end: now };
}

export function rollingWeekWindow(now: number): TimeWindow {
  return { start: now - SEVEN_DAYS_MS, end: now };
}

/**
 * ccusage-style fallback when the usage API is unavailable (spec §4.2).
 * Blocks are half-open [start, start+5h) with start floored to the UTC hour.
 * `timestamps` must be sorted ascending.
 */
export function deriveCurrentBlock(timestamps: number[], now: number): TimeWindow | null {
  let blockStart: number | null = null;
  let prev: number | null = null;
  for (const ts of timestamps) {
    if (ts > now) break;
    const pastEnd = blockStart !== null && ts >= blockStart + FIVE_HOURS_MS;
    const longGap = prev !== null && ts - prev > FIVE_HOURS_MS;
    if (blockStart === null || pastEnd || longGap) {
      blockStart = Math.floor(ts / HOUR_MS) * HOUR_MS; // epoch ms is UTC, so this floors to the UTC hour
    }
    prev = ts;
  }
  if (blockStart === null || now >= blockStart + FIVE_HOURS_MS) return null;
  return { start: blockStart, end: now };
}
