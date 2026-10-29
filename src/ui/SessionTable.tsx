import type { JSX } from 'react';
import { Box, Text } from 'ink';
import type { ColumnKey, DisplayStatus, SessionView, SortKey } from '../domain/types.js';
import {
  formatAgo,
  formatBytes,
  formatDuration,
  formatPercent,
  formatUSD,
  shortModel,
  truncate,
} from '../domain/format.js';
import { Panel } from './Panel.js';
import { COLUMN_WIDTHS, nameWidth, scrollWindow, visibleColumns } from './sessionList.js';
import { levelColor, useTheme, type Theme } from './theme.js';

export {
  COLUMN_WIDTHS,
  filterSessions,
  requiredWidth,
  scrollWindow,
  sortSessions,
  visibleColumns,
} from './sessionList.js';

const HEADERS: Record<ColumnKey, string> = {
  status: 'ST',
  name: 'NAME',
  model: 'MODEL',
  branch: 'BRANCH',
  ctx: 'CTX',
  cpu: 'CPU',
  mem: 'MEM',
  cost: 'COST',
  last: 'LAST',
  uptime: 'UP',
};

const GLYPHS: Record<DisplayStatus, string> = { waiting: '●', busy: '◐', idle: '○', ended: '·' };

export interface SessionTableProps {
  sessions: SessionView[];
  selectedIndex: number;
  columns: ColumnKey[];
  width: number;
  maxRows: number;
  now: number;
  sort: SortKey;
  filter: 'all' | 'live';
  emptyMessage?: string;
}

function ctxBar(pct: number | undefined): string {
  if (pct === undefined) return '—';
  const filled = Math.max(0, Math.min(10, Math.round(pct / 10)));
  return `${'█'.repeat(filled)}${'░'.repeat(10 - filled)} ${pct}%`;
}

function cellText(col: ColumnKey, s: SessionView, now: number, nameW: number): string {
  switch (col) {
    case 'status':
      return s.activeAgents > 0 && s.status !== 'ended'
        ? `${GLYPHS[s.status]} ${s.activeAgents}`
        : GLYPHS[s.status];
    case 'name':
      return truncate(s.name, nameW);
    case 'model':
      return shortModel(s.model);
    case 'branch':
      return s.gitBranch ?? '—';
    case 'ctx':
      return ctxBar(s.contextPercent);
    case 'cpu':
      return s.live ? formatPercent(s.cpuPercent) : '—';
    case 'mem':
      return s.live ? formatBytes(s.memBytes) : '—';
    case 'cost':
      return formatUSD(s.costUSD, s.costApprox);
    case 'last':
      return formatAgo(s.lastActivity, now);
    case 'uptime':
      return s.live && s.startedAt !== undefined ? formatDuration(now - s.startedAt) : '—';
  }
}

function cellColor(col: ColumnKey, s: SessionView, theme: Theme): string {
  if (col === 'status') {
    if (s.status === 'waiting') return theme.warn;
    if (s.status === 'busy') return theme.ok;
    return s.status === 'ended' ? theme.dim : theme.text;
  }
  if (col === 'ctx' && s.contextPercent !== undefined) return levelColor(theme, s.contextPercent, [60, 80]);
  if (col === 'cpu' && s.live && s.cpuPercent !== undefined) return levelColor(theme, s.cpuPercent, [50, 90]);
  return theme.text;
}

function Row(props: {
  session: SessionView;
  cols: ColumnKey[];
  nameW: number;
  now: number;
  selected: boolean;
}): JSX.Element {
  const theme = useTheme();
  const { session: s, cols, nameW, now, selected } = props;
  const ended = s.status === 'ended';
  return (
    <Box columnGap={1}>
      {cols.map((c) => (
        <Box key={c} width={c === 'name' ? nameW : COLUMN_WIDTHS[c]}>
          <Text
            wrap="truncate-end"
            color={selected ? theme.selectedFg : cellColor(c, s, theme)}
            {...(selected ? { backgroundColor: theme.selectedBg } : {})}
            dimColor={ended && !selected}
            bold={c === 'status' && s.status === 'waiting'}
          >
            {cellText(c, s, now, nameW)}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

export function SessionTable(props: SessionTableProps): JSX.Element {
  const theme = useTheme();
  const { sessions, selectedIndex, width, maxRows, now, sort, filter } = props;
  const cols = visibleColumns(props.columns, width);
  const nameW = nameWidth(cols, width);
  const { start, end } = scrollWindow(selectedIndex, sessions.length, maxRows);
  const title = `Sessions ── sort: ${sort} ── filter: ${filter}`;
  return (
    <Panel title={title} width={width}>
      <Box columnGap={1}>
        {cols.map((c) => (
          <Box key={c} width={c === 'name' ? nameW : COLUMN_WIDTHS[c]}>
            <Text color={theme.dim} bold>
              {HEADERS[c]}
            </Text>
          </Box>
        ))}
      </Box>
      {sessions.length === 0 ? (
        <Text color={theme.dim}>{props.emptyMessage ?? 'No Claude Code sessions in the last 24h'}</Text>
      ) : (
        sessions
          .slice(start, end)
          .map((s, i) => (
            <Row
              key={s.sessionId}
              session={s}
              cols={cols}
              nameW={nameW}
              now={now}
              selected={start + i === selectedIndex}
            />
          ))
      )}
    </Panel>
  );
}
