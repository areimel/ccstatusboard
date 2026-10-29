import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text } from 'ink';
import type { Config, ThemeName } from '../domain/types.js';
import type { Store } from '../store/store.js';
import { useSnapshot } from '../store/useSnapshot.js';
import { ThemeProvider } from '@inkjs/ui';
import { THEMES, ThemeContext, inkUiTheme } from './theme.js';
import { Panel } from './Panel.js';
import { Header, headerWarnings } from './Header.js';
import { UsagePanel, usagePanelRows } from './UsagePanel.js';
import { Footer } from './Footer.js';
import { SessionTable, filterSessions, sortSessions } from './SessionTable.js';
import { DetailPane } from './DetailPane.js';
import { HelpOverlay } from './HelpOverlay.js';
import { clamp, initialUiState, uiReducer, type UiAction, type UiState } from './uiState.js';
import { useKeymap } from './useKeymap.js';
import { SPARE_ROWS, computeLayout, useTerminalSize } from './layout.js';

export { initialUiState, uiReducer, type UiAction, type UiState } from './uiState.js';
export { MIN_COLUMNS, MIN_ROWS, DETAIL_MIN_ROWS } from './layout.js';

export interface AppProps {
  store: Pick<Store, 'subscribe' | 'getSnapshot'>;
  config: Config;
  onQuit: () => void;
  /** Called when the user switches theme (not on mount); the caller persists it. */
  onThemeChange?: (name: ThemeName) => void;
  /** Test-only terminal size override; defaults to live stdout size. */
  size?: { columns: number; rows: number };
}
export function App({ store, config, onQuit, onThemeChange, size }: AppProps): React.JSX.Element {
  const snapshot = useSnapshot(store);
  const { columns, rows } = useTerminalSize(size);
  const [ui, setUi] = useState<UiState>(() => initialUiState(config));

  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    onThemeChange?.(ui.theme);
  }, [ui.theme]);
  const theme = THEMES[ui.theme];
  const inkTheme = useMemo(() => inkUiTheme(theme), [theme]);

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

  useKeymap({ ui, dispatch, onQuit });

  const headerRows = 1 + (headerWarnings(snapshot).length > 0 ? 1 : 0);
  const { tooSmall, detailShown, maxRows } = computeLayout({
    rows,
    columns,
    showDetail: ui.showDetail,
    panels: [{ rows: headerRows }, { rows: usagePanelRows(snapshot) }],
  });
  if (tooSmall) {
    return <Text>Terminal too small</Text>;
  }

  let body: React.JSX.Element;
  if (ui.mode === 'help') {
    body = <HelpOverlay width={Math.min(64, columns)} />;
  } else if (!snapshot.claudeDirFound) {
    body = (
      <Panel title="Sessions" width={columns}>
        <Text>Claude Code data not found at {snapshot.claudeDir}</Text>
      </Panel>
    );
  } else if (snapshot.sessions.length === 0 || visible.length === 0) {
    body = (
      <Panel title="Sessions" width={columns}>
        <Text>
          {snapshot.sessions.length === 0
            ? `No Claude Code sessions in the last ${config.endedWindowHours}h`
            : 'No sessions match'}
        </Text>
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
    <ThemeContext.Provider value={theme}>
      <ThemeProvider theme={inkTheme}>
        {/* Backstop: never draw taller than the budget even if a child miscounts its rows. */}
        <Box flexDirection="column" width={columns} maxHeight={rows - SPARE_ROWS} overflow="hidden">
          <Header snapshot={snapshot} />
          {ui.mode !== 'help' && <UsagePanel snapshot={snapshot} width={columns} />}
          {body}
          <Footer mode={ui.mode === 'search' ? 'search' : 'normal'} search={ui.search} width={columns} />
        </Box>
      </ThemeProvider>
    </ThemeContext.Provider>
  );
}
