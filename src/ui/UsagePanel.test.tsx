import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { UsagePanel, usagePanelRows } from './UsagePanel.js';
import { makeSnapshot, NOW } from '../../test/helpers/snapshot.js';
import { emptyWindowTotals, type Snapshot } from '../domain/types.js';
import { stripAnsi } from '../../test/helpers/ansi.js';

// TitledBox renders its title only on the second render, so wait for it.
async function frame(snap: Snapshot = makeSnapshot()): Promise<string> {
  const { lastFrame } = render(<UsagePanel snapshot={snap} width={100} />);
  await vi.waitFor(() => expect(stripAnsi(lastFrame())).toContain('Usage'));
  return stripAnsi(lastFrame());
}

describe('UsagePanel', () => {
  it('shows block/weekly/per-model meters with reset countdowns', async () => {
    const out = await frame();
    expect(out).toContain('Usage');
    expect(out).toMatch(/5h\s+\[\|+\s*58%\]/);
    expect(out).toContain('resets 2h14m');
    expect(out).toMatch(/Week\s+\[\|+\s*31%\]/);
    expect(out).toMatch(/Opus\s+\[\|+\s*22%\]/);
  });

  it('shows block/week/today/month costs and burn rate', async () => {
    const out = await frame();
    expect(out).toMatch(/block\s+\$12\.40/);
    expect(out).toMatch(/week\s+\$96\.10/);
    expect(out).toMatch(/today\s+\$18\.20/);
    expect(out).toMatch(/month\s+\$412\.75/);
    expect(out).toContain('burn $4.10/h');
    expect(out).toContain('24h');
  });

  it('shows "login required" when there are no credentials', async () => {
    const out = await frame(makeSnapshot({ limits: { status: 'no-credentials', perModelWeekly: [] } }));
    expect(out).toContain('login required');
    expect(out).not.toContain('58%');
  });

  it('shows "disabled" and the expired copy verbatim', async () => {
    expect(await frame(makeSnapshot({ limits: { status: 'disabled', perModelWeekly: [] } }))).toContain(
      'disabled',
    );
    expect(await frame(makeSnapshot({ limits: { status: 'expired', perModelWeekly: [] } }))).toContain(
      'expired — open Claude Code to refresh',
    );
  });

  it('keeps last values and marks them stale with their age', async () => {
    const base = makeSnapshot();
    const out = await frame({
      ...base,
      limits: { ...base.limits, status: 'stale', fetchedAt: NOW - 4 * 60_000 },
    });
    expect(out).toContain('58%');
    expect(out).toContain('stale 4m');
  });

  it('shows scan progress and em dashes when pricing is unavailable', async () => {
    const nullTotals = { ...emptyWindowTotals(), costUSD: null };
    const base = makeSnapshot();
    const out = await frame({
      ...base,
      pricingStatus: 'unavailable',
      scan: { done: false, filesDone: 3, filesTotal: 10 },
      costs: {
        ...base.costs,
        block: nullTotals,
        today: nullTotals,
        week: nullTotals,
        month: nullTotals,
        burnRatePerHour: null,
      },
    });
    expect(out).toContain('scanning 3/10…');
    expect(out).toMatch(/block\s+—/);
    expect(out).toContain('burn —');
  });
});

describe('usagePanelRows', () => {
  const variants: Record<string, Snapshot> = {
    default: makeSnapshot(),
    scanning: makeSnapshot({ scan: { done: false, filesDone: 1, filesTotal: 5 } }),
    many: makeSnapshot({
      limits: {
        status: 'stale',
        fetchedAt: NOW - 60_000,
        block: { label: '5h', percent: 10 },
        weekly: { label: 'Week', percent: 20 },
        perModelWeekly: [
          { label: 'Opus', percent: 1 },
          { label: 'Sonnet', percent: 2 },
          { label: 'Haiku', percent: 3 },
        ],
        extra: { enabled: true, percent: 5, usedAmount: 1, limitAmount: 10, currency: 'USD' },
      },
    }),
    noCreds: makeSnapshot({ limits: { status: 'no-credentials', perModelWeekly: [] } }),
  };
  for (const [name, snap] of Object.entries(variants)) {
    it(`equals the rendered line count (${name})`, async () => {
      const out = await frame(snap);
      expect(usagePanelRows(snap)).toBe(out.split('\n').length);
    });
  }
});
