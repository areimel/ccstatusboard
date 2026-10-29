import React, { useMemo, useState } from 'react';
import { Box, Text } from 'ink';
import type { Config } from '../domain/types.js';
import type { Store } from '../store/store.js';
import { useSnapshot } from '../store/useSnapshot.js';
import { ThemeProvider } from '@inkjs/ui';
import { THEMES, ThemeContext, cycleTheme, inkUiTheme } from './theme.js';
import { Panel } from './Panel.js';
import { Header, headerWarnings } from './Header.js';
import { UsagePanel, usagePanelRows } from './UsagePanel.js';
import { Footer } from './Footer.js';
import { SessionTable, filterSessions, sortSessions } from './SessionTable.js';
import { DetailPane } from './DetailPane.js';
import { HelpOverlay } from './HelpOverlay.js';
import { OptionsMenu } from './options/OptionsMenu.js';
import { SystemPanel, systemPanelRows } from './SystemPanel.js';
import { clamp, initialUiState, uiReducer, type UiAction, type UiState } from './uiState.js';
import { useKeymap } from './useKeymap.js';
import { FOOTER_ROWS, SPARE_ROWS, SYSTEM_MIN_ROWS, computeLayout, useTerminalSize } from './layout.js';

export { initialUiState, uiReducer, type UiAction, type UiState } from './uiState.js';
export { MIN_COLUMNS, MIN_ROWS, DETAIL_MIN_ROWS } from './layout.js';

export interface AppProps {
  store: Pick<Store, 'subscribe' | 'getSnapshot'>;
  config: Config;
  onQuit: () => void;
  /** Called with a config patch to persist/apply: Options edits and t/T theme switches (never on mount). */
  onConfigChange?: (patch: Partial<Config>) => void;
  /** Test-only terminal size override; defaults to live stdout size. */
  size?: { columns: number; rows: number };
}
export function App({ store, config, onQuit, onConfigChange, size }: AppProps): React.JSX.Element {
  const snapshot = useSnapshot(store);
  const { columns, rows } = useTerminalSize(size);
  const [ui, setUi] = useState<UiState>(() => initialUiState(config));

  const cfg = ui.config;
  const theme = THEMES[cfg.theme];
  const inkTheme = useMemo(() => inkUiTheme(theme), [theme]);

  const visible = useMemo(
    () => sortSessions(filterSessions(snapshot.sessions, ui.filter, ui.search), cfg.sort),
    [snapshot.sessions, ui.filter, ui.search, cfg.sort],
  );
  const selected = clamp(ui.selectedIndex, visible.length);
  // Re-clamp against the current list so a stale index never leaks into the reducer.
  const reduce = (a: UiAction) =>
    setUi((s) =>
      uiReducer({ ...s, selectedIndex: clamp(s.selectedIndex, visible.length) }, a, visible.length),
    );
  const dispatch = (a: UiAction) => {
    reduce(a);
    // Only the theme is persisted when changed via hotkeys; sort/detail persist via Options only.
    if (a.type === 'nextTheme' || a.type === 'prevTheme') {
      onConfigChange?.({ theme: cycleTheme(cfg.theme, a.type === 'nextTheme' ? 1 : -1) });
    }
  };
  const changeConfig = (patch: Partial<Config>) => {
    reduce({ type: 'applyConfig', patch });
    onConfigChange?.(patch);
  };

  useKeymap({ ui, dispatch, onQuit });

  const headerRows = 1 + (headerWarnings(snapshot).length > 0 ? 1 : 0);
  const overlay = ui.mode === 'help' || ui.mode === 'options';
  const systemShown = cfg.showSystem && rows >= SYSTEM_MIN_ROWS && !overlay;
  const { tooSmall, detailShown, maxRows } = computeLayout({
    rows,
    columns,
    showDetail: cfg.showDetail,
    panels: [
      { rows: headerRows },
      { rows: usagePanelRows(snapshot, cfg.subscriptionUSD) },
      ...(systemShown ? [{ rows: systemPanelRows(snapshot) }] : []),
    ],
  });
  const emptyMessage =
    cfg.endedWindowHours === 0
      ? 'No live Claude Code sessions'
      : `No Claude Code sessions in the last ${cfg.endedWindowHours}h`;
  if (tooSmall) {
    return <Text>Terminal too small</Text>;
  }

  let body: React.JSX.Element;
  if (ui.mode === 'help') {
    body = <HelpOverlay width={Math.min(64, columns)} />;
  } else if (ui.mode === 'options') {
    body = (
      <OptionsMenu
        config={cfg}
        width={Math.min(64, columns)}
        maxHeight={rows - headerRows - FOOTER_ROWS - SPARE_ROWS}
        onChange={changeConfig}
        onClose={() => reduce({ type: 'closeOptions' })}
      />
    );
  } else if (!snapshot.claudeDirFound) {
    body = (
      <Panel title="Sessions" width={columns}>
        <Text>Claude Code data not found at {snapshot.claudeDir}</Text>
      </Panel>
    );
  } else if (snapshot.sessions.length === 0 || visible.length === 0) {
    body = (
      <Panel title="Sessions" width={columns}>
        <Text>{snapshot.sessions.length === 0 ? emptyMessage : 'No sessions match'}</Text>
      </Panel>
    );
  } else {
    body = (
      <>
        <SessionTable
          sessions={visible}
          selectedIndex={selected}
          columns={cfg.columns}
          width={columns}
          maxRows={maxRows}
          now={snapshot.now}
          sort={cfg.sort}
          filter={ui.filter}
          emptyMessage={emptyMessage}
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
          {!overlay && (
            <UsagePanel snapshot={snapshot} width={columns} subscriptionUSD={cfg.subscriptionUSD} />
          )}
          {systemShown && <SystemPanel snapshot={snapshot} width={columns} />}
          {body}
          <Footer mode={ui.mode === 'search' ? 'search' : 'normal'} search={ui.search} width={columns} />
        </Box>
      </ThemeProvider>
    </ThemeContext.Provider>
  );
}
