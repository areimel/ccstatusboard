import { describe, expect, it } from 'vitest';
import {
  formatAgo,
  formatBytes,
  formatClock,
  formatDuration,
  formatPercent,
  formatRate,
  formatWeekdayTime,
  formatResetsAt,
  formatTokens,
  formatUSD,
  shortModel,
  truncate,
  truncateDisplay,
  displayWidth,
} from './format.js';

const NOW = new Date(2026, 9, 11, 14, 32, 7).getTime(); // Sunday, local time

describe('formatUSD', () => {
  it('formats null/NaN as em dash', () => {
    expect(formatUSD(null)).toBe('—');
    expect(formatUSD(Number.NaN)).toBe('—');
  });
  it('uses two decimals below 1000 and grouped integers above', () => {
    expect(formatUSD(4.2)).toBe('$4.20');
    expect(formatUSD(96.1)).toBe('$96.10');
    expect(formatUSD(412.75)).toBe('$412.75');
    expect(formatUSD(1234.5)).toBe('$1,235');
  });
  it('prefixes ≈ when approximate', () => {
    expect(formatUSD(4.2, true)).toBe('≈$4.20');
  });
});

describe('formatTokens', () => {
  it.each([
    [950, '950'],
    [1000, '1k'],
    [12_300, '12.3k'],
    [48_100, '48.1k'],
    [120_000, '120k'],
    [210_000, '210k'],
    [999_700, '1M'],
    [3_100_000, '3.1M'],
  ])('%d → %s', (n, out) => {
    expect(formatTokens(n)).toBe(out);
  });
});

describe('formatBytes', () => {
  it.each([
    [0, '0B'],
    [512, '512B'],
    [1023, '1023B'],
    [1024, '1K'],
    [1536, '1.5K'],
    [412 * 1024 * 1024, '412M'],
    [15.6 * 1024 ** 3, '15.6G'],
    [100 * 1024, '100K'],
  ])('%d → %s', (n, out) => {
    expect(formatBytes(n)).toBe(out);
  });
  it('returns em dash for undefined, negative, and non-finite input', () => {
    expect(formatBytes(undefined)).toBe('—');
    expect(formatBytes(-1)).toBe('—');
    expect(formatBytes(Number.NaN)).toBe('—');
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('formatRate', () => {
  it('appends /s to the byte size', () => {
    expect(formatRate(1.2 * 1024 * 1024)).toBe('1.2M/s');
    expect(formatRate(0)).toBe('0B/s');
  });
  it('returns em dash without the /s suffix for missing or negative rates', () => {
    expect(formatRate(undefined)).toBe('—');
    expect(formatRate(-1)).toBe('—');
  });
});

describe('formatPercent', () => {
  it('rounds to a whole percent', () => {
    expect(formatPercent(12.4)).toBe('12%');
    expect(formatPercent(12.5)).toBe('13%');
    expect(formatPercent(0)).toBe('0%');
  });
  it('returns em dash for undefined or non-finite input', () => {
    expect(formatPercent(undefined)).toBe('—');
    expect(formatPercent(Number.NaN)).toBe('—');
  });
});

describe('formatDuration', () => {
  it.each([
    [-5, '0s'],
    [45_000, '45s'],
    [12 * 60_000, '12m'],
    [134 * 60_000, '2h14m'],
    [5 * 3_600_000, '5h'],
    [(3 * 24 + 4) * 3_600_000, '3d4h'],
    [2 * 86_400_000, '2d'],
  ])('%d → %s', (ms, out) => {
    expect(formatDuration(ms)).toBe(out);
  });
});

describe('formatAgo', () => {
  it('buckets by age', () => {
    expect(formatAgo(NOW - 3_000, NOW)).toBe('now');
    expect(formatAgo(NOW - 30_000, NOW)).toBe('30s');
    expect(formatAgo(NOW - 18 * 60_000, NOW)).toBe('18m');
    expect(formatAgo(NOW - 3 * 3_600_000, NOW)).toBe('3h ago');
  });
});

describe('formatResetsAt', () => {
  it('shows a countdown under 24h', () => {
    expect(formatResetsAt(NOW + 134 * 60_000, NOW)).toBe('resets 2h14m');
  });
  it('shows weekday + local time at or beyond 24h', () => {
    const thu9 = new Date(2026, 9, 15, 9, 0, 0).getTime();
    expect(formatResetsAt(thu9, NOW)).toBe('resets Thu 09:00');
  });
  it('shows "resets now" when already past', () => {
    expect(formatResetsAt(NOW - 1, NOW)).toBe('resets now');
  });
});

describe('shortModel', () => {
  it.each([
    ['claude-opus-5-5', 'opus-5.5'],
    ['claude-sonnet-5-5[1m]', 'sonnet-5.5'],
    ['claude-haiku-5-5-20261001', 'haiku-5.5'],
    ['claude-fable-5-1', 'fable-5.1'],
    ['<synthetic>', '<synthetic>'],
  ])('%s → %s', (m, out) => {
    expect(shortModel(m)).toBe(out);
  });
  it('undefined → em dash', () => {
    expect(shortModel(undefined)).toBe('—');
  });
});

describe('formatClock / truncate', () => {
  it('formats local HH:MM:SS', () => {
    expect(formatClock(NOW)).toBe('14:32:07');
    expect(formatClock(NOW, false)).toBe('14:32');
  });
  it('truncates with ellipsis', () => {
    expect(truncate('ccstatusboard', 20)).toBe('ccstatusboard');
    expect(truncate('ccstatusboard', 6)).toBe('ccsta…');
    expect(truncate('abc', 0)).toBe('');
  });
});

describe('displayWidth / truncateDisplay', () => {
  it('counts East Asian wide characters and emoji as 2 columns, combining marks as 0', () => {
    expect(displayWidth('abc')).toBe(3);
    expect(displayWidth('日本語')).toBe(6);
    expect(displayWidth('ｱ全角Ａ')).toBe(7); // halfwidth katakana is 1, fullwidth Latin is 2
    expect(displayWidth('ok 🚀')).toBe(5);
    expect(displayWidth('é')).toBe(1);
    expect(displayWidth('한국')).toBe(4);
  });
  it('truncates to a display width with an ellipsis', () => {
    expect(truncateDisplay('ccstatusboard', 20)).toBe('ccstatusboard');
    expect(truncateDisplay('ccstatusboard', 6)).toBe('ccsta…');
    expect(truncateDisplay('日本語のセッション', 7)).toBe('日本語…');
    expect(displayWidth(truncateDisplay('日本語のセッション', 8))).toBeLessThanOrEqual(8);
    expect(truncateDisplay('abc', 0)).toBe('');
  });
});

describe('formatWeekdayTime', () => {
  it('renders weekday and HH:MM in local time', () => {
    const ts = new Date(2026, 9, 13, 14, 0).getTime(); // Tue
    expect(formatWeekdayTime(ts)).toBe('Tue 14:00');
  });
});
