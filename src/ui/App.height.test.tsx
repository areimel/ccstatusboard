import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.js';
import { DEFAULT_CONFIG } from '../config/schema.js';
import { makeOverflowSnapshot, makeSession, makeSnapshot, NOW } from '../../test/helpers/snapshot.js';
import { renderSized, type SizedRender } from '../../test/helpers/renderSized.js';
import type { Snapshot } from '../domain/types.js';

// Laid out in a fake TTY whose columns/rows match `size` (ink-testing-library is fixed at 100 columns).
const mounted: SizedRender[] = [];
afterEach(() => mounted.splice(0).forEach((r) => r.unmount()));

const fakeStore = (snap: Snapshot) => ({ subscribe: () => () => {}, getSnapshot: () => snap });

async function frameAt(snap: Snapshot, size: { columns: number; rows: number }): Promise<string[]> {
  const r = renderSized(
    <App store={fakeStore(snap)} config={DEFAULT_CONFIG} onQuit={vi.fn()} size={size} />,
    size,
  );
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
