import { describe, expect, it } from 'vitest';
import { LimitHistory } from './limitHistory.js';
import { HOUR, MIN, NOW } from './testFixtures.js';

const lim = (percent: number, resetsAt: number) => ({ label: 'x', percent, resetsAt });

describe('LimitHistory', () => {
  it('appends samples and skips duplicate timestamps', () => {
    const h = new LimitHistory();
    h.record('block', lim(10, NOW + HOUR), NOW - MIN, NOW);
    h.record('block', lim(11, NOW + HOUR), NOW - MIN, NOW);
    h.record('block', lim(12, NOW + HOUR), NOW, NOW);
    expect(h.samples('block')).toEqual([
      { t: NOW - MIN, pct: 10 },
      { t: NOW, pct: 12 },
    ]);
  });

  it('clears the buffer when resetsAt moves by more than a minute', () => {
    const h = new LimitHistory();
    h.record('block', lim(80, NOW + HOUR), NOW - MIN, NOW);
    h.record('block', lim(80, NOW + HOUR + 30_000), NOW, NOW);
    expect(h.samples('block')).toHaveLength(2);
    h.record('block', lim(2, NOW + 6 * HOUR), NOW + MIN, NOW + MIN);
    expect(h.samples('block')).toEqual([{ t: NOW + MIN, pct: 2 }]);
  });

  it('ignores limits without resetsAt and keeps kinds separate', () => {
    const h = new LimitHistory();
    h.record('block', { label: 'x', percent: 5 }, NOW, NOW);
    h.record('week', lim(5, NOW + HOUR), NOW, NOW);
    expect(h.samples('block')).toEqual([]);
    expect(h.samples('week')).toHaveLength(1);
  });

  it('trims samples older than the window', () => {
    const h = new LimitHistory();
    h.record('block', lim(1, NOW + HOUR), NOW - 6 * HOUR, NOW - 6 * HOUR);
    h.record('block', lim(2, NOW + HOUR), NOW, NOW);
    expect(h.samples('block')).toEqual([{ t: NOW, pct: 2 }]);
  });
});
