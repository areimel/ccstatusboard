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
  it('options open/close and applyConfig merges into config', () => {
    const o = uiReducer(base, { type: 'openOptions' }, 3);
    expect(o.mode).toBe('options');
    expect(uiReducer(o, { type: 'closeOptions' }, 3).mode).toBe('normal');
    const c = uiReducer(base, { type: 'applyConfig', patch: { theme: 'mono', sort: 'cost' } }, 3);
    expect(c.config).toMatchObject({ theme: 'mono', sort: 'cost' });
  });
  it('starts from config sort/showDetail with nothing selected beyond row 0', () => {
    expect(base).toEqual({
      selectedIndex: 0,
      filter: 'all',
      search: '',
      mode: 'normal',
      config: DEFAULT_CONFIG,
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
  it('cycleSort walks project→status→activity→cost→ctx→name→project and resets selection', () => {
    let s: UiState = { ...base, selectedIndex: 2 };
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      s = uiReducer(s, { type: 'cycleSort' }, 3);
      seen.push(s.config.sort);
    }
    expect(seen).toEqual(['status', 'activity', 'cost', 'ctx', 'name', 'project']);
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
  it('nextTheme/prevTheme wrap around', () => {
    const last = { ...base, config: { ...base.config, theme: 'cyberpunk' as const } };
    expect(uiReducer(last, { type: 'nextTheme' }, 3).config.theme).toBe('default');
    expect(uiReducer(base, { type: 'prevTheme' }, 3).config.theme).toBe('cyberpunk');
  });
  it('toggleHelp and toggleDetail flip', () => {
    const h = uiReducer(base, { type: 'toggleHelp' }, 3);
    expect(h.mode).toBe('help');
    expect(uiReducer(h, { type: 'toggleHelp' }, 3).mode).toBe('normal');
    expect(uiReducer(base, { type: 'toggleDetail' }, 3).config.showDetail).toBe(false);
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

function renderApp(snap: Snapshot, size = BIG, onQuit = vi.fn(), config = DEFAULT_CONFIG) {
  const r = render(<App store={fakeStore(snap)} config={config} onQuit={onQuit} size={size} />);
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
    expect(
      renderApp(makeSnapshot({ sessions: [] }), BIG, vi.fn(), {
        ...DEFAULT_CONFIG,
        endedWindowHours: 24,
      }).lastFrame(),
    ).toContain('No Claude Code sessions in the last 24h');
    expect(
      renderApp(makeSnapshot({ sessions: [] }), BIG, vi.fn(), {
        ...DEFAULT_CONFIG,
        endedWindowHours: 0,
      }).lastFrame(),
    ).toContain('No live Claude Code sessions');
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

describe('App theme switching', () => {
  it('t/T change the footer theme name and call onConfigChange, not on mount', async () => {
    const onConfigChange = vi.fn();
    const { lastFrame, stdin } = render(
      <App
        store={fakeStore(twoSessions())}
        config={DEFAULT_CONFIG}
        onQuit={vi.fn()}
        onConfigChange={onConfigChange}
        size={BIG}
      />,
    );
    await delay();
    expect(onConfigChange).not.toHaveBeenCalled();
    expect(lastFrame()).toContain('tdefault');
    stdin.write('t');
    await vi.waitFor(() => expect(onConfigChange).toHaveBeenLastCalledWith({ theme: 'mono' }));
    expect(lastFrame()).toContain('tmono');
    stdin.write('T');
    await vi.waitFor(() => expect(onConfigChange).toHaveBeenLastCalledWith({ theme: 'default' }));
    expect(lastFrame()).toContain('tdefault');
    expect(onConfigChange).toHaveBeenCalledTimes(2);
  });

  it("'t' in search mode is typed into the query and does not change theme", async () => {
    const onConfigChange = vi.fn();
    const { lastFrame, stdin } = render(
      <App
        store={fakeStore(twoSessions())}
        config={DEFAULT_CONFIG}
        onQuit={vi.fn()}
        onConfigChange={onConfigChange}
        size={BIG}
      />,
    );
    stdin.write('/');
    await delay();
    stdin.write('t');
    await vi.waitFor(() => expect(lastFrame()).toContain('/t'));
    expect(onConfigChange).not.toHaveBeenCalled();
    stdin.write('\r');
    await delay();
    expect(lastFrame()).toContain('tdefault');
  });
});

describe('App options menu', () => {
  it('Esc opens Options, Esc closes it', async () => {
    const { lastFrame, stdin } = renderApp(twoSessions());
    stdin.write('\u001B');
    await vi.waitFor(() => expect(lastFrame()).toContain('Theme'));
    expect(lastFrame()).toContain('Options');
    expect(lastFrame()).not.toContain('alpha');
    stdin.write('\u001B');
    await vi.waitFor(() => expect(lastFrame()).toContain('alpha'));
  });

  it('right arrow on Theme changes theme and reports the patch', async () => {
    const onConfigChange = vi.fn();
    const { lastFrame, stdin } = render(
      <App
        store={fakeStore(twoSessions())}
        config={DEFAULT_CONFIG}
        onQuit={vi.fn()}
        onConfigChange={onConfigChange}
        size={BIG}
      />,
    );
    stdin.write('\u001B');
    await vi.waitFor(() => expect(lastFrame()).toContain('Theme'));
    await delay();
    stdin.write('\u001B[C');
    await vi.waitFor(() => expect(onConfigChange).toHaveBeenCalledWith({ theme: 'mono' }));
    expect(onConfigChange).toHaveBeenCalledTimes(1);
  });

  it('Esc while a search is active clears it instead of opening Options', async () => {
    const { lastFrame, stdin } = renderApp(twoSessions());
    stdin.write('/');
    await delay();
    stdin.write('b');
    await delay();
    stdin.write('\r');
    await delay();
    expect(lastFrame()).not.toContain('alpha');
    stdin.write('\u001B');
    await vi.waitFor(() => expect(lastFrame()).toContain('alpha'));
    expect(lastFrame()).not.toContain('Theme');
  });

  it('s and Enter do not call onConfigChange', async () => {
    const onConfigChange = vi.fn();
    const { stdin } = render(
      <App
        store={fakeStore(twoSessions())}
        config={DEFAULT_CONFIG}
        onQuit={vi.fn()}
        onConfigChange={onConfigChange}
        size={BIG}
      />,
    );
    stdin.write('s');
    await delay();
    stdin.write('\r');
    await delay();
    expect(onConfigChange).not.toHaveBeenCalled();
  });
});
