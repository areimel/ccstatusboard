import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.js';
import { DEFAULT_CONFIG } from '../config/schema.js';
import { makeOverflowSnapshot, makeSession, makeSnapshot, NOW } from '../../test/helpers/snapshot.js';
import { renderSized, type SizedRender } from '../../test/helpers/renderSized.js';
import { GB, makeFullSystemStats, makeSystemStats } from '../../test/helpers/system.js';
import type { Config, Snapshot, SystemStats } from '../domain/types.js';

// Laid out in a fake TTY whose columns/rows match `size` (ink-testing-library is fixed at 100 columns).
const mounted: SizedRender[] = [];
afterEach(() => mounted.splice(0).forEach((r) => r.unmount()));

const fakeStore = (snap: Snapshot) => ({ subscribe: () => () => {}, getSnapshot: () => snap });

async function frameAt(
  snap: Snapshot,
  size: { columns: number; rows: number },
  config: Config = DEFAULT_CONFIG,
): Promise<string[]> {
  const r = renderSized(<App store={fakeStore(snap)} config={config} onQuit={vi.fn()} size={size} />, size);
  mounted.push(r);
  await vi.waitFor(() => expect(r.lastFrame()).toContain('Sessions'));
  return r.lastFrame().split('\n');
}

function expectFits(lines: string[], size: { columns: number; rows: number }): void {
  expect(lines.length).toBeLessThanOrEqual(size.rows - 1);
  for (const l of lines) expect(l.length).toBeLessThanOrEqual(size.columns);
  expect(lines.at(-1)).toContain('Quit');
}

describe('App height budget (sized stdout)', () => {
  const heavy = (): Snapshot =>
    makeSnapshot({
      sessions: Array.from({ length: 40 }, (_, i) =>
        makeSession({ sessionId: `s${i}`, name: `sess${i}`, lastActivity: NOW - i * 1_000 }),
      ),
      scan: { done: false, filesDone: 3, filesTotal: 10 },
      pricingStatus: 'stale',
      warnings: ['something odd'],
      limits: {
        status: 'stale',
        fetchedAt: NOW - 600_000,
        block: { label: '5h', percent: 58, resetsAt: NOW + 3_600_000 },
        weekly: { label: 'Week', percent: 31, resetsAt: NOW + 86_400_000 },
        perModelWeekly: [
          { label: 'Opus', percent: 22 },
          { label: 'Sonnet', percent: 12 },
        ],
      },
    });

  for (const rows of [16, 20, 24, 28, 40]) {
    it(`fits 120x${rows}`, async () => {
      const size = { columns: 120, rows };
      expectFits(await frameAt(heavy(), size), size);
    });
  }

  for (const size of [
    { columns: 140, rows: 45 },
    { columns: 100, rows: 30 },
    { columns: 80, rows: 24 },
    { columns: 60, rows: 24 },
  ]) {
    it(`fits ${size.columns}x${size.rows} with many models, agents and expired limits`, async () => {
      const lines = await frameAt(makeOverflowSnapshot(), size);
      expectFits(lines, size);
      expect(lines.join('\n')).toContain('Detail:');
    });
  }
});

describe('App height with value-less limit messages (sized stdout)', () => {
  for (const status of ['expired', 'no-credentials', 'error'] as const) {
    it(`fits 60x24 when limits are ${status} with no values`, async () => {
      const size = { columns: 60, rows: 24 };
      const snap = { ...makeOverflowSnapshot(), limits: { status, perModelWeekly: [] } };
      expectFits(await frameAt(snap, size), size);
    });
  }
});

describe('App root height backstop (sized stdout)', () => {
  it('clips unexpected overflow but keeps the footer visible', async () => {
    const size = { columns: 60, rows: 16 };
    const snap = makeSnapshot({ claudeDirFound: false, claudeDir: `/${'very-long-dir/'.repeat(60)}` });
    const r = renderSized(
      <App store={fakeStore(snap)} config={DEFAULT_CONFIG} onQuit={vi.fn()} size={size} />,
      size,
    );
    mounted.push(r);
    await vi.waitFor(() => expect(r.lastFrame()).toContain('not found'));
    expectFits(r.lastFrame().split('\n'), size);
  });
});

describe('App height with long warnings (sized stdout)', () => {
  for (const size of [
    { columns: 60, rows: 16 },
    { columns: 80, rows: 24 },
  ]) {
    it(`stays within ${size.columns}x${size.rows}`, async () => {
      const warnings = Array.from(
        { length: 4 },
        (_, i) => `runtime warning number ${i} with a very long explanation text`,
      );
      const snap = makeSnapshot({
        sessions: Array.from({ length: 30 }, (_, i) => makeSession({ sessionId: `s${i}`, name: `sess${i}` })),
        pricingStatus: 'stale',
        unknownModels: ['claude-mystery-model-1', 'claude-mystery-model-2'],
        warnings,
      });
      expectFits(await frameAt(snap, size), size);
    });
  }
});

describe('App help overlay at minimum width', () => {
  it('draws the help panel within 60 columns', async () => {
    const size = { columns: 60, rows: 24 };
    const r = renderSized(
      <App store={fakeStore(makeSnapshot())} config={DEFAULT_CONFIG} onQuit={vi.fn()} size={size} />,
      size,
    );
    mounted.push(r);
    await vi.waitFor(() => expect(r.lastFrame()).toContain('Sessions'));
    r.write('?');
    await vi.waitFor(() => expect(r.lastFrame()).toContain('Move selection'));
    const lines = r.lastFrame().split('\n');
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(60);
    expect(lines.find((l) => l.includes('Help'))).toMatch(/^╭.*╮$/);
  });
});

describe('App system panel', () => {
  const system: SystemStats = makeSystemStats({
    sampledAt: NOW,
    cpu: { total: 42, perCore: [10, 20, 30, 40, 50, 60, 70, 80] },
    mem: { used: 8 * GB, total: 16 * GB },
    swap: { used: GB, total: 4 * GB },
    disk: { used: 100 * GB, total: 500 * GB, mount: '/' },
    net: { rxPerSec: 2048, txPerSec: 1024 },
    load: [1.1, 0.9, 0.7],
  });
  const history = { cpu: [10, 40, 80, 20], rx: [1, 5, 2, 8], tx: [2, 2, 3, 1] };
  const withSystem = (over: Partial<Snapshot> = {}): Snapshot =>
    makeSnapshot({ system, systemHistory: history, ...over });

  for (const size of [
    { columns: 60, rows: 16 },
    { columns: 100, rows: 30 },
    { columns: 160, rows: 50 },
  ]) {
    it(`fits ${size.columns}x${size.rows}`, async () => {
      expectFits(await frameAt(withSystem(), size), size);
      expectFits(await frameAt({ ...makeOverflowSnapshot(), system, systemHistory: history }, size), size);
    });
  }

  it('is shown at 100x40, hidden at 100x24 and when showSystem is false', async () => {
    const shown = (await frameAt(withSystem(), { columns: 100, rows: 40 })).join('\n');
    expect(shown).toContain('System');
    const small = (await frameAt(withSystem(), { columns: 100, rows: 24 })).join('\n');
    expect(small).not.toContain('System');
    const off = (
      await frameAt(withSystem(), { columns: 100, rows: 40 }, { ...DEFAULT_CONFIG, showSystem: false })
    ).join('\n');
    expect(off).not.toContain('System');
  });

  describe('extra metrics', () => {
    const full = makeFullSystemStats({ sampledAt: NOW });
    const many = (): Snapshot => ({ ...makeOverflowSnapshot(), system: full, systemHistory: history });
    const sessionRows = (lines: string[]): number => lines.filter((l) => /sess\d+/.test(l)).length;
    const crowded = (over: Partial<SystemStats> = {}): Snapshot =>
      makeSnapshot({
        system: { ...full, ...over },
        systemHistory: history,
        sessions: Array.from({ length: 40 }, (_, i) =>
          makeSession({ sessionId: `s${i}`, name: `sess${i}`, lastActivity: NOW - i * 1_000 }),
        ),
      });

    for (const columns of [60, 80, 100, 160]) {
      it(`fits ${columns}x30 with every metric on`, async () => {
        const size = { columns, rows: 30 };
        expectFits(await frameAt(crowded(), size), size);
        expectFits(await frameAt(many(), size), size);
      });
    }

    it('drops groups rather than sessions at 100x30, keeping temperatures', async () => {
      const lines = await frameAt(crowded(), { columns: 100, rows: 30 });
      const text = lines.join('\n');
      expect(text).toContain('CPU 66°');
      expect(text).toContain('up 1h9m');
      expect(text).not.toContain('wlp2s0');
      expect(sessionRows(lines)).toBeGreaterThanOrEqual(3);
    });

    it('shows every group once the terminal is tall enough', async () => {
      const text = (await frameAt(crowded(), { columns: 100, rows: 40 })).join('\n');
      for (const needle of ['CPU 66°', 'up 1h9m', '4.17GHz', 'Press', 'wlp2s0']) {
        expect(text).toContain(needle);
      }
    });

    it('hides a group turned off in config', async () => {
      const text = (
        await frameAt(crowded(), { columns: 100, rows: 40 }, { ...DEFAULT_CONFIG, systemMetrics: ['temps'] })
      ).join('\n');
      expect(text).toContain('CPU 66°');
      expect(text).not.toContain('wlp2s0');
    });

    it('keeps the same session row count as live values change', async () => {
      const size = { columns: 100, rows: 34 };
      const base = sessionRows(await frameAt(crowded(), size));
      const changed = crowded({
        battery: { percent: 41, status: 'Discharging', watts: 12.3, secondsLeft: 7200 },
        gpu: { busyPercent: 100, clockHz: 1.8e9, watts: 45 },
        link: {},
      });
      expect(sessionRows(await frameAt(changed, size))).toBe(base);
    });
  });
});
