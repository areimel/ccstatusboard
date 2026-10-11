import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'ink-testing-library';
import { App, initialUiState, uiReducer, type UiState } from './App.js';
import { DEFAULT_CONFIG } from '../config/schema.js';
import { makeSession, makeSnapshot, NOW } from '../../test/helpers/snapshot.js';
import type { Snapshot } from '../domain/types.js';

afterEach(cleanup);

const base: UiState = initialUiState(DEFAULT_CONFIG);

describe('uiReducer', () => {
  it('starts from config sort/showDetail with nothing selected beyond row 0', () => {
    expect(base).toEqual({
      selectedIndex: 0,
      sort: 'status',
      filter: 'all',
      search: '',
      mode: 'normal',
      showDetail: true,
    });
  });
  it('moves selection and clamps to [0, rowCount-1]', () => {
    let s = uiReducer(base, { type: 'down' }, 3);
    s = uiReducer(s, { type: 'down' }, 3);
    s = uiReducer(s, { type: 'down' }, 3);
    expect(s.selectedIndex).toBe(2);
    s = uiReducer(s, { type: 'up' }, 3);
    expect(s.selectedIndex).toBe(1);
    expect(uiReducer(base, { type: 'up' }, 3).selectedIndex).toBe(0);
  });
  it('top/bottom jump; empty list keeps index 0', () => {
    expect(uiReducer(base, { type: 'bottom' }, 5).selectedIndex).toBe(4);
    expect(uiReducer({ ...base, selectedIndex: 4 }, { type: 'top' }, 5).selectedIndex).toBe(0);
    expect(uiReducer(base, { type: 'bottom' }, 0).selectedIndex).toBe(0);
    expect(uiReducer(base, { type: 'down' }, 0).selectedIndex).toBe(0);
  });
  it('cycleSort walks status→activity→cost→ctx→name→status and resets selection', () => {
    let s: UiState = { ...base, selectedIndex: 2 };
    const seen: string[] = [];
    for (let i = 0; i < 5; i++) {
      s = uiReducer(s, { type: 'cycleSort' }, 3);
      seen.push(s.sort);
    }
    expect(seen).toEqual(['activity', 'cost', 'ctx', 'name', 'status']);
    expect(s.selectedIndex).toBe(0);
  });
  it('toggleFilter flips all/live and resets selection', () => {
    const s = uiReducer({ ...base, selectedIndex: 2 }, { type: 'toggleFilter' }, 3);
    expect(s.filter).toBe('live');
    expect(s.selectedIndex).toBe(0);
    expect(uiReducer(s, { type: 'toggleFilter' }, 3).filter).toBe('all');
  });
  it('search: start, type, backspace, end keeps text, clear wipes it', () => {
    let s = uiReducer(base, { type: 'startSearch' }, 3);
    expect(s.mode).toBe('search');
    s = uiReducer(s, { type: 'searchInput', char: 'a' }, 3);
    s = uiReducer(s, { type: 'searchInput', char: 'b' }, 3);
    s = uiReducer(s, { type: 'searchBackspace' }, 3);
    expect(s.search).toBe('a');
    s = uiReducer(s, { type: 'endSearch' }, 3);
    expect(s).toMatchObject({ mode: 'normal', search: 'a' });
    s = uiReducer(s, { type: 'clearSearch' }, 3);
    expect(s).toMatchObject({ mode: 'normal', search: '' });
  });
  it('toggleHelp and toggleDetail flip', () => {
    const h = uiReducer(base, { type: 'toggleHelp' }, 3);
    expect(h.mode).toBe('help');
    expect(uiReducer(h, { type: 'toggleHelp' }, 3).mode).toBe('normal');
    expect(uiReducer(base, { type: 'toggleDetail' }, 3).showDetail).toBe(false);
  });
});

const delay = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const fakeStore = (snap: Snapshot) => ({ subscribe: () => () => {}, getSnapshot: () => snap });
const BIG = { columns: 120, rows: 40 };

function twoSessions(): Snapshot {
  return makeSnapshot({
    sessions: [
      makeSession({ sessionId: 'a', name: 'alpha', cwd: '/srv/a-mark', lastActivity: NOW - 1_000 }),
      makeSession({ sessionId: 'b', name: 'beta', cwd: '/srv/b-mark', lastActivity: NOW - 5_000 }),
    ],
  });
}

function renderApp(snap: Snapshot, size = BIG, onQuit = vi.fn()) {
  const r = render(<App store={fakeStore(snap)} config={DEFAULT_CONFIG} onQuit={onQuit} size={size} />);
  return { ...r, onQuit };
}

describe('App rendering', () => {
  it('lists sessions', () => {
    const { lastFrame } = renderApp(twoSessions());
    expect(lastFrame()).toContain('alpha');
    expect(lastFrame()).toContain('beta');
  });

  it('shows "Terminal too small" below 60 columns or 16 rows', () => {
    expect(renderApp(twoSessions(), { columns: 59, rows: 40 }).lastFrame()).toContain('Terminal too small');
    expect(renderApp(twoSessions(), { columns: 120, rows: 15 }).lastFrame()).toContain('Terminal too small');
    expect(renderApp(twoSessions(), { columns: 60, rows: 16 }).lastFrame()).not.toContain(
      'Terminal too small',
    );
  });

  it('hides the detail pane when rows < 24', () => {
    expect(renderApp(twoSessions(), { columns: 120, rows: 40 }).lastFrame()).toContain('/srv/a-mark');
    expect(renderApp(twoSessions(), { columns: 120, rows: 23 }).lastFrame()).not.toContain('/srv/a-mark');
  });

  it('renders the empty states', () => {
    expect(renderApp(makeSnapshot({ sessions: [] })).lastFrame()).toContain(
      'No Claude Code sessions in the last 24h',
    );
    expect(
      renderApp(makeSnapshot({ sessions: [], claudeDirFound: false, claudeDir: '/nope' })).lastFrame(),
    ).toContain('Claude Code data not found at /nope');
  });
});

describe('App keyboard', () => {
  it('j moves the selection (detail pane follows)', async () => {
    const { lastFrame, stdin } = renderApp(twoSessions());
    expect(lastFrame()).toContain('/srv/a-mark');
    stdin.write('j');
    await delay();
    expect(lastFrame()).toContain('/srv/b-mark');
    expect(lastFrame()).not.toContain('/srv/a-mark');
  });

  it('Enter toggles the detail pane', async () => {
    const { lastFrame, stdin } = renderApp(twoSessions());
    stdin.write('\r');
    await delay();
    expect(lastFrame()).not.toContain('/srv/a-mark');
  });

  it('/ search filters, Esc clears', async () => {
    const { lastFrame, stdin } = renderApp(twoSessions());
    stdin.write('/');
    await delay();
    stdin.write('b');
    await delay();
    stdin.write('e');
    await delay();
    expect(lastFrame()).not.toContain('alpha');
    expect(lastFrame()).toContain('beta');
    stdin.write('\u001B');
    await delay(80);
    expect(lastFrame()).toContain('alpha');
  });

  it('? opens help (table hidden), any key closes it', async () => {
    const { lastFrame, stdin } = renderApp(twoSessions());
    stdin.write('?');
    await delay();
    expect(lastFrame()).not.toContain('alpha');
    stdin.write('x');
    await delay();
    expect(lastFrame()).toContain('alpha');
  });

  it('q and Ctrl-C call onQuit', async () => {
    const a = renderApp(twoSessions());
    a.stdin.write('q');
    await delay();
    expect(a.onQuit).toHaveBeenCalledTimes(1);
    const b = renderApp(twoSessions());
    b.stdin.write('\u0003');
    await delay();
    expect(b.onQuit).toHaveBeenCalledTimes(1);
  });
});

describe('App list shrink and layout budget', () => {
  it('clamps the selection when the list shrinks under it', async () => {
    let snap = makeSnapshot({
      sessions: [
        makeSession({ sessionId: 'a', name: 'alpha', cwd: '/srv/a-mark', lastActivity: NOW - 1_000 }),
        makeSession({ sessionId: 'b', name: 'beta', cwd: '/srv/b-mark', lastActivity: NOW - 5_000 }),
        makeSession({ sessionId: 'c', name: 'gamma', cwd: '/srv/c-mark', lastActivity: NOW - 9_000 }),
      ],
    });
    const listeners = new Set<() => void>();
    const store = {
      subscribe: (l: () => void) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      getSnapshot: () => snap,
    };
    const { lastFrame, stdin } = render(
      <App store={store} config={DEFAULT_CONFIG} onQuit={vi.fn()} size={BIG} />,
    );
    stdin.write('G');
    await vi.waitFor(() => expect(lastFrame()).toContain('/srv/c-mark'));
    snap = makeSnapshot({ sessions: [snap.sessions[0]!] });
    listeners.forEach((l) => l());
    await vi.waitFor(() => expect(lastFrame()).toContain('/srv/a-mark'));
    expect(lastFrame()).not.toContain('gamma');
    stdin.write('j');
    await delay();
    expect(lastFrame()).toContain('/srv/a-mark');
  });

  it('never overflows the terminal height when header warnings add a row', async () => {
    const sessions = Array.from({ length: 30 }, (_, i) =>
      makeSession({ sessionId: `s${i}`, name: `sess${i}`, lastActivity: NOW - i * 1_000 }),
    );
    const size = { columns: 120, rows: 20 };
    const { lastFrame } = renderApp(makeSnapshot({ sessions, pricingStatus: 'stale' }), size);
    await vi.waitFor(() => expect(lastFrame()).toContain('Sessions'));
    expect(lastFrame()).toContain('pricing stale');
    expect(lastFrame()!.split('\n').length).toBeLessThanOrEqual(size.rows);
  });
});

describe('App search empty state', () => {
  it('shows "No sessions match" when the search matches nothing', async () => {
    const { lastFrame, stdin } = renderApp(twoSessions());
    stdin.write('/');
    await delay();
    stdin.write('z');
    await vi.waitFor(() => expect(lastFrame()).toContain('No sessions match'));
  });
});
