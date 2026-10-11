import { describe, expect, it } from 'vitest';
import {
  FIVE_HOURS_MS,
  SEVEN_DAYS_MS,
  blockWindowFromLimit,
  deriveCurrentBlock,
  monthWindow,
  rollingWeekWindow,
  todayWindow,
  weekWindowFromLimit,
} from './windows.js';

const H = 3_600_000;
const M = 60_000;
// UTC-based instants so block flooring (UTC hour) is timezone independent.
const utc = (iso: string) => Date.parse(iso);

describe('constants', () => {
  it('have the expected durations', () => {
    expect(FIVE_HOURS_MS).toBe(5 * H);
    expect(SEVEN_DAYS_MS).toBe(7 * 24 * H);
  });
});

describe('limit-based windows', () => {
  it('block starts 5h before resetsAt and ends now', () => {
    const now = utc('2026-10-11T14:00:00Z');
    const resetsAt = utc('2026-10-11T16:14:00Z');
    expect(blockWindowFromLimit(resetsAt, now)).toEqual({ start: utc('2026-10-11T11:14:00Z'), end: now });
  });
  it('week starts 7d before resetsAt and ends now', () => {
    const now = utc('2026-10-11T14:00:00Z');
    const resetsAt = utc('2026-10-15T09:00:00Z');
    expect(weekWindowFromLimit(resetsAt, now)).toEqual({ start: utc('2026-10-08T09:00:00Z'), end: now });
  });
  it('rolling week is the last 7 days', () => {
    const now = utc('2026-10-11T14:00:00Z');
    expect(rollingWeekWindow(now)).toEqual({ start: now - SEVEN_DAYS_MS, end: now });
  });
});

describe('calendar windows (local time)', () => {
  // Built with local-time constructors so the test passes in any TZ.
  it('today starts at local midnight', () => {
    const now = new Date(2026, 9, 11, 14, 32, 7).getTime();
    expect(todayWindow(now)).toEqual({ start: new Date(2026, 9, 11, 0, 0, 0, 0).getTime(), end: now });
  });
  it('today at exactly midnight starts at that midnight', () => {
    const now = new Date(2026, 9, 11, 0, 0, 0, 0).getTime();
    expect(todayWindow(now).start).toBe(now);
  });
  it('month starts on the local first at 00:00', () => {
    const now = new Date(2026, 9, 11, 14, 32, 7).getTime();
    expect(monthWindow(now)).toEqual({ start: new Date(2026, 9, 1, 0, 0, 0, 0).getTime(), end: now });
  });
  it('month on the 1st starts that same day', () => {
    const now = new Date(2026, 0, 1, 8, 0).getTime();
    expect(monthWindow(now).start).toBe(new Date(2026, 0, 1).getTime());
  });
});

describe('deriveCurrentBlock', () => {
  it('returns null with no records', () => {
    expect(deriveCurrentBlock([], utc('2026-10-11T12:00:00Z'))).toBeNull();
  });

  it('floors the block start to the UTC hour of the first record', () => {
    const now = utc('2026-10-11T11:00:00Z');
    const ts = [utc('2026-10-11T09:47:12Z'), utc('2026-10-11T10:30:00Z')];
    expect(deriveCurrentBlock(ts, now)).toEqual({ start: utc('2026-10-11T09:00:00Z'), end: now });
  });

  it('returns null when now is at or past the end of the last block', () => {
    const ts = [utc('2026-10-11T09:10:00Z')];
    expect(deriveCurrentBlock(ts, utc('2026-10-11T14:00:00Z'))).toBeNull(); // exactly 09:00 + 5h
    expect(deriveCurrentBlock(ts, utc('2026-10-11T13:59:59Z'))).not.toBeNull();
  });

  it('starts a new block for a record exactly at the block end', () => {
    // Block 1: [09:00, 14:00). A record at 14:00 opens block 2 at 14:00.
    const ts = [utc('2026-10-11T09:00:00Z'), utc('2026-10-11T12:00:00Z'), utc('2026-10-11T14:00:00Z')];
    const now = utc('2026-10-11T14:30:00Z');
    expect(deriveCurrentBlock(ts, now)).toEqual({ start: utc('2026-10-11T14:00:00Z'), end: now });
  });

  it('keeps a record one ms before the block end in the same block', () => {
    const ts = [utc('2026-10-11T09:00:00Z'), utc('2026-10-11T14:00:00Z') - 1];
    const now = utc('2026-10-11T13:59:59.999Z');
    expect(deriveCurrentBlock(ts, now)).toEqual({ start: utc('2026-10-11T09:00:00Z'), end: now });
  });

  it('starts a new block, floored to its own UTC hour, after a gap of more than 5h', () => {
    // 01:30 → block [01:00, 06:00). Next record 07:05 (gap 5h35m) → new block [07:00, 12:00).
    const ts = [utc('2026-10-11T01:30:00Z'), utc('2026-10-11T07:05:00Z')];
    const now = utc('2026-10-11T08:00:00Z');
    expect(deriveCurrentBlock(ts, now)).toEqual({ start: utc('2026-10-11T07:00:00Z'), end: now });
  });

  it('chains consecutive blocks: a record past each block end opens the next', () => {
    const ts = [
      utc('2026-10-11T00:00:00Z'), // block A [00:00, 05:00)
      utc('2026-10-11T04:59:00Z'), // still A
      utc('2026-10-11T05:10:00Z'), // >= A end → block B [05:00, 10:00)
      utc('2026-10-11T10:20:00Z'), // >= B end → block C [10:00, 15:00)
    ];
    const now = utc('2026-10-11T10:30:00Z');
    expect(deriveCurrentBlock(ts, now)).toEqual({ start: utc('2026-10-11T10:00:00Z'), end: now });
  });

  it('records under 5h apart within the block stay in one block', () => {
    const ts = [utc('2026-10-11T10:00:00Z'), utc('2026-10-11T14:59:00Z')];
    const now = utc('2026-10-11T14:59:30Z');
    expect(deriveCurrentBlock(ts, now)).toEqual({ start: utc('2026-10-11T10:00:00Z'), end: now });
  });

  it('ignores records after now', () => {
    const now = utc('2026-10-11T10:00:00Z');
    const ts = [utc('2026-10-11T09:15:00Z'), utc('2026-10-11T16:00:00Z')];
    expect(deriveCurrentBlock(ts, now)).toEqual({ start: utc('2026-10-11T09:00:00Z'), end: now });
  });

  it('returns null when the last activity was long ago', () => {
    const ts = [utc('2026-10-10T09:00:00Z')];
    expect(deriveCurrentBlock(ts, utc('2026-10-11T09:00:00Z') + 30 * M)).toBeNull();
  });
});
