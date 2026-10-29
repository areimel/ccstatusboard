import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'ink-testing-library';
import { renderSized } from '../../test/helpers/renderSized.js';
import type { BurnProjection } from '../domain/types.js';
import { UsagePanel, usagePanelRows } from './UsagePanel.js';
import { makeSnapshot, NOW } from '../../test/helpers/snapshot.js';
import { emptyWindowTotals, type Snapshot } from '../domain/types.js';
import { stripAnsi } from '../../test/helpers/ansi.js';

afterEach(cleanup);

// TitledBox renders its title only on the second render, so wait for it.
async function frame(snap: Snapshot = makeSnapshot(), sub?: number | null): Promise<string> {
  const { lastFrame } = render(<UsagePanel snapshot={snap} width={100} subscriptionUSD={sub} />);
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

const burnProj: BurnProjection = {
  currentPct: 58,
  ratePctPerHour: 10,
  projectedPct: 112,
  band: 'over',
  hitAt: NOW + 3_600_000,
  hitWindowPct: 78,
};

describe('UsagePanel burn rate and plan ratio', () => {
  it('renders the Burn Rate subsection above the burn/sparkline row', async () => {
    const out = await frame(makeSnapshot({ burn: { block: burnProj } }));
    expect(out).toContain('Burn Rate');
    expect(out).toMatch(/proj 112%\s+OVER/);
    expect(out.indexOf('Burn Rate')).toBeLessThan(out.indexOf('burn $4.10/h'));
  });

  it('omits the subsection when limits have no values', async () => {
    const out = await frame(makeSnapshot({ limits: { status: 'disabled', perModelWeekly: [] } }));
    expect(out).not.toContain('Burn Rate');
  });

  it('shows plan ratio when subscriptionUSD is set (ok >= 1)', async () => {
    expect(await frame(makeSnapshot(), 100)).toMatch(/plan\s+4\.1×/);
  });

  it('hides plan ratio when unset, null, zero, or month cost unknown', async () => {
    expect(await frame(makeSnapshot())).not.toContain('plan');
    expect(await frame(makeSnapshot(), null)).not.toContain('plan');
    expect(await frame(makeSnapshot(), 0)).not.toContain('plan');
    const base = makeSnapshot();
    const unknown = { ...base, costs: { ...base.costs, month: { ...base.costs.month, costUSD: null } } };
    expect(await frame(unknown, 100)).not.toContain('plan');
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
  variants.burning = makeSnapshot({ burn: { block: burnProj, week: { ...burnProj, band: 'near' } } });
  for (const [name, snap] of Object.entries(variants)) {
    for (const sub of [undefined, 100] as const) {
      it(`equals the rendered line count (${name}, sub=${sub})`, async () => {
        const r = renderSized(<UsagePanel snapshot={snap} width={100} subscriptionUSD={sub} />, {
          columns: 100,
          rows: 60,
        });
        await vi.waitFor(() => expect(r.lastFrame()).toContain('Usage'));
        const h = r.lastFrame().split('\n').length;
        r.unmount();
        expect(usagePanelRows(snap, sub)).toBe(h);
      });
    }
  }
});
