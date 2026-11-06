import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import type { ProviderSnapshot, Snapshot } from '../domain/types.js';
import { DEFAULT_CONFIG } from '../config/schema.js';
import { makeSnapshot, NOW } from '../../test/helpers/snapshot.js';
import { providerUsage, usageLayout } from './providerUsage.js';
import { UsagePanel, usagePanelRows } from './UsagePanel.js';
import { App } from './App.js';
import { renderSized } from '../../test/helpers/renderSized.js';
import { stripAnsi } from '../../test/helpers/ansi.js';

function mixed(): Snapshot {
  const snapshot = makeSnapshot();
  const common: ProviderSnapshot = { ...snapshot, dir: '/fixture', found: true, enabled: true };
  return {
    ...snapshot,
    providers: {
      claude: common,
      codex: {
        ...common,
        limits: {
          status: 'ok',
          fetchedAt: NOW - 10_000,
          block: { label: 'primary', percent: 20, durationMs: 7_200_000, resetsAt: NOW + 3_600_000 },
          perModelWeekly: [],
        },
        costs: { ...snapshot.costs, month: { ...snapshot.costs.month, costUSD: 27 } },
      },
    },
  };
}

describe('responsive provider usage', () => {
  it('uses separate columns at 122 columns and preserves independent amounts', () => {
    const result = usageLayout(mixed(), DEFAULT_CONFIG, 'all', 'claude', 122, 30, 1);
    expect(result.horizontal).toBe(true);
    expect(result.entries.map((e) => e.width)).toEqual([60, 60]);
    expect(result.entries.map((e) => e.snapshot.costs.month.costUSD)).toEqual([412.75, 27]);
  });
  it('stacks when three session rows and requested detail fit, otherwise selects one', () => {
    expect(usageLayout(mixed(), DEFAULT_CONFIG, 'all', 'claude', 80, 40, 1).entries).toHaveLength(2);
    const compact = usageLayout(mixed(), DEFAULT_CONFIG, 'all', 'codex', 80, 24, 1);
    expect(compact.entries.map((e) => e.provider)).toEqual(['codex']);
    expect(
      usageLayout(mixed(), DEFAULT_CONFIG, 'codex', 'claude', 160, 50, 1).entries.map((e) => e.provider),
    ).toEqual(['codex']);
  });
  it('does not substitute Claude amounts when Codex data is missing', () => {
    expect(providerUsage(makeSnapshot(), 'codex').costs.month.costUSD).toBeNull();
  });
  it('uses dynamic quota duration, observation age, stale marking, and partial costs', () => {
    const snapshot = { ...providerUsage(mixed(), 'codex'), accountingIncomplete: true };
    for (const age of [10_000, 301_000]) {
      const data = { ...snapshot, limits: { ...snapshot.limits, fetchedAt: NOW - age } };
      const view = render(<UsagePanel snapshot={data} width={80} provider="codex" subscriptionUSD={20} />);
      const frame = view.lastFrame();
      expect(frame).toContain('2h');
      expect(frame).toContain(age > 300_000 ? 'stale' : 'observed');
      expect(frame).toContain('partial');
      expect(frame).not.toContain('plan');
      expect(frame?.split('\n')).toHaveLength(usagePanelRows(data, 20, 'codex'));
      view.unmount();
    }
  });
  it('retains per-bucket ages and names while compacting many windows', () => {
    const snapshot = mixed();
    const codex = snapshot.providers!.codex!;
    codex.limits.windows = Array.from({ length: 8 }, (_, i) => ({
      id: `bucket-${i}`,
      label: `Bucket ${i}`,
      percent: i * 10,
      windowMinutes: 120,
      observedAt: NOW - (i + 1) * 60_000,
    }));
    const full = render(
      <UsagePanel snapshot={providerUsage(snapshot, 'codex')} width={100} provider="codex" />,
    );
    expect(full.lastFrame()).toContain('2h Bucket 7');
    expect(full.lastFrame()).toContain('stale 8m');
    expect(full.lastFrame()?.split('\n')).toHaveLength(
      usagePanelRows(providerUsage(snapshot, 'codex'), null, 'codex'),
    );
    full.unmount();
    const compact = usageLayout(snapshot, DEFAULT_CONFIG, 'codex', 'codex', 60, 16, 1);
    expect(compact.height).toBeLessThanOrEqual(7);
    expect(compact.entries[0]!.snapshot.hiddenLimitCount).toBeGreaterThan(0);
    const view = render(<UsagePanel snapshot={compact.entries[0]!.snapshot} width={60} provider="codex" />);
    expect(view.lastFrame()).toContain('more quota windows');
    expect(view.lastFrame()).toContain('observed 1m');
    view.unmount();
  });
  it.each([
    { columns: 60, rows: 16 },
    { columns: 60, rows: 24 },
    { columns: 100, rows: 30 },
    { columns: 122, rows: 40 },
  ])('fits mixed usage at $columns x $rows', (size) => {
    const snapshot = mixed();
    const view = renderSized(
      <App
        store={{ getSnapshot: () => snapshot, subscribe: () => () => {} }}
        config={DEFAULT_CONFIG}
        onQuit={() => {}}
        size={size}
      />,
      size,
    );
    const lines = stripAnsi(view.lastFrame()).split('\n');
    expect(lines.length).toBeLessThan(size.rows);
    expect(Math.max(...lines.map((line) => line.length))).toBeLessThanOrEqual(size.columns);
    expect(view.lastFrame()).toContain('Quit');
    view.unmount();
  });
});
