import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { DEFAULT_CONFIG } from '../config/schema.js';
import { makeSession, makeSnapshot, NOW } from '../../test/helpers/snapshot.js';
import { filterSessions } from './sessionList.js';
import { initialUiState, uiReducer } from './uiState.js';
import { SessionTable } from './SessionTable.js';
import { App } from './App.js';

const claude = makeSession();
const codex = makeSession({ provider: 'codex', live: false, recentlyObserved: true, status: 'unknown' });

describe('provider session navigation', () => {
  it('filters providers independently from confirmed live and recently observed activity', () => {
    expect(filterSessions([claude, codex], 'live', '', 'codex')).toEqual([codex]);
    expect(filterSessions([claude, codex], 'all', '', 'claude')).toEqual([claude]);
    expect(filterSessions([codex], 'live', 'absent', 'codex')).toEqual([]);
  });
  it('cycles providers and resets the selection', () => {
    let state = { ...initialUiState(DEFAULT_CONFIG), selectedIndex: 2 };
    state = uiReducer(state, { type: 'cycleProvider' }, 3);
    expect(state.providerFilter).toBe('claude');
    expect(state.selectedIndex).toBe(0);
    state = uiReducer(state, { type: 'cycleProvider' }, 3);
    expect(state.providerFilter).toBe('codex');
    state = uiReducer(state, { type: 'cycleProvider' }, 3);
    expect(state.providerFilter).toBe('all');
  });
  it('keeps provider markers with custom columns at minimum width', () => {
    const view = render(
      <SessionTable
        sessions={[claude, codex]}
        selectedIndex={0}
        columns={['name', 'cost']}
        width={60}
        maxRows={5}
        now={NOW}
        sort="activity"
        filter="live"
        showProvider
      />,
    );
    expect(view.lastFrame()).toContain('C proj');
    expect(view.lastFrame()).toContain('X proj');
    expect(view.lastFrame()).toContain('live/recent');
    view.unmount();
  });
  it('renders sessions when Claude data is absent', () => {
    const snapshot = makeSnapshot({ claudeDirFound: false, sessions: [codex] });
    const view = render(
      <App
        store={{ subscribe: () => () => {}, getSnapshot: () => snapshot }}
        config={DEFAULT_CONFIG}
        onQuit={() => {}}
        size={{ columns: 80, rows: 24 }}
      />,
    );
    expect(view.lastFrame()).toContain('proj');
    expect(view.lastFrame()).not.toContain('data not found');
    view.unmount();
  });
});
