import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from 'ink-testing-library';
import { BURN_RATE_ROWS, BurnRate, burnRateRows } from './BurnRate.js';
import { NOW } from '../../test/helpers/snapshot.js';
import { stripAnsi } from '../../test/helpers/ansi.js';
import type { BurnProjection } from '../domain/types.js';
import { formatClock, formatWeekdayTime } from '../domain/format.js';

afterEach(cleanup);

const proj = (over: Partial<BurnProjection> = {}): BurnProjection => ({
  currentPct: 58,
  ratePctPerHour: 10,
  projectedPct: 112,
  band: 'over',
  hitAt: NOW + 3_600_000,
  hitWindowPct: 78,
  ...over,
});

function out(burn: Parameters<typeof BurnRate>[0]['burn'], width = 100): string {
  const { lastFrame } = render(<BurnRate burn={burn} now={NOW} width={width} />);
  return stripAnsi(lastFrame() ?? '');
}

describe('BurnRate', () => {
  it('has a fixed height', () => {
    expect(burnRateRows({})).toBe(BURN_RATE_ROWS);
    expect(out({ block: proj(), week: proj() }).split('\n')).toHaveLength(BURN_RATE_ROWS);
  });

  it.each([
    ['under', 'UNDER'],
    ['near', 'NEAR LIMIT'],
    ['over', 'OVER'],
    ['critical', 'CRITICAL'],
  ] as const)('labels the %s band', (band, label) => {
    expect(out({ block: proj({ band }) })).toContain(label);
  });

  it('shows projection, block hit clock and window share', () => {
    const o = out({ block: proj() });
    expect(o).toContain('Burn Rate');
    expect(o).toMatch(/5h\s+proj 112%\s+OVER\s+hits /);
    expect(o).toContain(`hits ${formatClock(NOW + 3_600_000, false)} (78% of block)`);
  });

  it('shows weekday+time for the week row', () => {
    const at = NOW + 2 * 86_400_000;
    expect(out({ week: proj({ hitAt: at, hitWindowPct: 60 }) })).toContain(
      `hits ${formatWeekdayTime(at)} (60% of week)`,
    );
  });

  it('shows hits n/a when the limit is not projected to be hit', () => {
    const rest: BurnProjection = { ...proj({ band: 'under', projectedPct: 60 }) };
    delete rest.hitAt;
    delete rest.hitWindowPct;
    expect(out({ block: rest })).toContain('hits n/a');
  });

  it('shows limit reached when hitAt is in the past', () => {
    expect(out({ block: proj({ hitAt: NOW - 1000, band: 'critical' }) })).toContain('limit reached');
  });

  it('shows an em dash when there is no projection', () => {
    const lines = out({}).split('\n');
    expect(lines[1]).toMatch(/^5h\s+—$/);
    expect(lines[2]).toMatch(/^Week\s+—$/);
  });

  it('truncates at narrow widths', () => {
    const lines = out({ block: proj(), week: proj() }, 24).split('\n');
    expect(lines).toHaveLength(3);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(24);
  });
});
