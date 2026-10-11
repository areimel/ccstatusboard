import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import type { Config, SortKey } from '../domain/types.js';
import type { Store } from '../store/store.js';
import { useSnapshot } from '../store/useSnapshot.js';
import { ThemeProvider } from '@inkjs/ui';
import { THEMES, ThemeContext, inkUiTheme } from './theme.js';
import { Panel } from './Panel.js';
import { Header, headerWarnings } from './Header.js';
import { UsagePanel } from './UsagePanel.js';
import { Footer } from './Footer.js';
import { SessionTable, filterSessions, sortSessions } from './SessionTable.js';
import { DetailPane } from './DetailPane.js';
import { HelpOverlay } from './HelpOverlay.js';

export const MIN_COLUMNS = 60;
export const MIN_ROWS = 16;
export const DETAIL_MIN_ROWS = 24;
// header 1 (+1 when warnings) + usage panel 6 + table borders 2 + table header 1 + footer 1
const CHROME_ROWS = 11;
const DETAIL_ROWS = 5;
const SORT_ORDER: SortKey[] = ['status', 'activity', 'cost', 'ctx', 'name'];

export interface UiState {
  selectedIndex: number;
  sort: SortKey;
  filter: 'all' | 'live';
  search: string;
  mode: 'normal' | 'search' | 'help';
  showDetail: boolean;
}

export type UiAction =
  | {
      type:
        | 'up'
        | 'down'
        | 'top'
        | 'bottom'
        | 'toggleDetail'
        | 'cycleSort'
        | 'toggleFilter'
        | 'startSearch'
        | 'endSearch'
        | 'clearSearch'
        | 'toggleHelp';
    }
  | { type: 'searchInput'; char: string }
  | { type: 'searchBackspace' };

export interface AppProps {
  store: Pick<Store, 'subscribe' | 'getSnapshot'>;
  config: Config;
  onQuit: () => void;
  /** Test-only terminal size override; defaults to live stdout size. */
  size?: { columns: number; rows: number };
}

export function initialUiState(config: Config): UiState {
  return {
    selectedIndex: 0,
    sort: config.sort,
    filter: 'all',
    search: '',
    mode: 'normal',
    showDetail: config.showDetail,
  };
}

function clamp(i: number, rowCount: number): number {
  if (rowCount <= 0) return 0;
  return Math.min(Math.max(i, 0), rowCount - 1);
}

export function uiReducer(s: UiState, a: UiAction, rowCount: number): UiState {
  switch (a.type) {
    case 'up':
      return { ...s, selectedIndex: clamp(s.selectedIndex - 1, rowCount) };
    case 'down':
      return { ...s, selectedIndex: clamp(s.selectedIndex + 1, rowCount) };
    case 'top':
      return { ...s, selectedIndex: 0 };
    case 'bottom':
      return { ...s, selectedIndex: clamp(rowCount - 1, rowCount) };
    case 'toggleDetail':
      return { ...s, showDetail: !s.showDetail };
    case 'cycleSort': {
      const next = SORT_ORDER[(SORT_ORDER.indexOf(s.sort) + 1) % SORT_ORDER.length] ?? 'status';
      return { ...s, sort: next, selectedIndex: 0 };
    }
    case 'toggleFilter':
      return { ...s, filter: s.filter === 'all' ? 'live' : 'all', selectedIndex: 0 };
    case 'startSearch':
      return { ...s, mode: 'search' };
    case 'endSearch':
      return { ...s, mode: 'normal' };
    case 'clearSearch':
      return { ...s, mode: 'normal', search: '', selectedIndex: 0 };
    case 'toggleHelp':
      return { ...s, mode: s.mode === 'help' ? 'normal' : 'help' };
    case 'searchInput':
      return { ...s, search: s.search + a.char, selectedIndex: 0 };
    case 'searchBackspace':
      return { ...s, search: s.search.slice(0, -1), selectedIndex: 0 };
  }
}

function useTerminalSize(override?: { columns: number; rows: number }): { columns: number; rows: number } {
  const { stdout } = useStdout();
  const read = () => ({ columns: stdout.columns || 80, rows: stdout.rows || 24 });
  const [size, setSize] = useState(read);
  useEffect(() => {
    if (override) return;
    const onResize = () => setSize(read());
    stdout.on('resize', onResize);
    return () => {
      stdout.off('resize', onResize);
    };
  }, [stdout, override]);
  return override ?? size;
}

// F1 arrives as ESC O P; Ink may strip the leading ESC.
const isF1 = (input: string) => input === '\u001bOP' || input === 'OP';

export function App({ store, config, onQuit, size }: AppProps): React.JSX.Element {
  const snapshot = useSnapshot(store);
  const { columns, rows } = useTerminalSize(size);
  const [ui, setUi] = useState<UiState>(() => initialUiState(config));

  const visible = useMemo(
    () => sortSessions(filterSessions(snapshot.sessions, ui.filter, ui.search), ui.sort),
    [snapshot.sessions, ui.filter, ui.search, ui.sort],
  );
  const selected = clamp(ui.selectedIndex, visible.length);
  // Re-clamp against the current list so a stale index never leaks into the reducer.
  const dispatch = (a: UiAction) =>
    setUi((s) =>
      uiReducer({ ...s, selectedIndex: clamp(s.selectedIndex, visible.length) }, a, visible.length),
    );

  useInput((input, key) => {
    if (key.ctrl && input === 'c') return onQuit();
    if (ui.mode === 'search') {
      if (key.escape) dispatch({ type: 'clearSearch' });
      else if (key.return) dispatch({ type: 'endSearch' });
      else if (key.backspace || key.delete) dispatch({ type: 'searchBackspace' });
      else if (input && !key.ctrl && !key.meta) dispatch({ type: 'searchInput', char: input });
      return;
    }
    if (ui.mode === 'help') {
      if (input === 'q') return onQuit();
      dispatch({ type: 'toggleHelp' });
      return;
    }
    if (input === 'q') return onQuit();
    if (key.upArrow || input === 'k') dispatch({ type: 'up' });
    else if (key.downArrow || input === 'j') dispatch({ type: 'down' });
    else if (input === 'g') dispatch({ type: 'top' });
    else if (input === 'G') dispatch({ type: 'bottom' });
    else if (key.return) dispatch({ type: 'toggleDetail' });
    else if (input === 's') dispatch({ type: 'cycleSort' });
    else if (input === 'f') dispatch({ type: 'toggleFilter' });
    else if (input === '/') dispatch({ type: 'startSearch' });
    else if (input === '?' || isF1(input)) dispatch({ type: 'toggleHelp' });
    else if (key.escape && ui.search) dispatch({ type: 'clearSearch' });
  });

  if (columns < MIN_COLUMNS || rows < MIN_ROWS) {
    return <Text>Terminal too small</Text>;
  }

  const detailShown = ui.showDetail && rows >= DETAIL_MIN_ROWS;
  const headerRows = 1 + (headerWarnings(snapshot).length > 0 ? 1 : 0);
  const maxRows = Math.max(1, rows - (CHROME_ROWS - 1 + headerRows) - (detailShown ? DETAIL_ROWS : 0));

  let body: React.JSX.Element;
  if (ui.mode === 'help') {
    body = <HelpOverlay />;
  } else if (!snapshot.claudeDirFound) {
    body = (
      <Panel title="Sessions" width={columns}>
        <Text>Claude Code data not found at {snapshot.claudeDir}</Text>
      </Panel>
    );
  } else if (snapshot.sessions.length === 0) {
    body = (
      <Panel title="Sessions" width={columns}>
        <Text>No Claude Code sessions in the last {config.endedWindowHours}h</Text>
      </Panel>
    );
  } else {
    body = (
      <>
        <SessionTable
          sessions={visible}
          selectedIndex={selected}
          columns={config.columns}
          width={columns}
          maxRows={maxRows}
          now={snapshot.now}
          sort={ui.sort}
          filter={ui.filter}
          emptyMessage={`No Claude Code sessions in the last ${config.endedWindowHours}h`}
        />
        {detailShown && <DetailPane session={visible[selected]} now={snapshot.now} width={columns} />}
      </>
    );
  }

  return (
    <ThemeContext.Provider value={THEMES[config.theme]}>
      <ThemeProvider theme={inkUiTheme(THEMES[config.theme])}>
        <Box flexDirection="column" width={columns}>
          <Header snapshot={snapshot} />
          {ui.mode !== 'help' && <UsagePanel snapshot={snapshot} width={columns} />}
          {body}
          <Footer mode={ui.mode === 'search' ? 'search' : 'normal'} search={ui.search} />
        </Box>
      </ThemeProvider>
    </ThemeContext.Provider>
  );
}
