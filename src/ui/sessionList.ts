import type { ColumnKey, DisplayStatus, SessionView, SortKey } from '../domain/types.js';

export const COLUMN_WIDTHS: Record<ColumnKey, number> = {
  status: 5,
  name: 12, // minimum; grows into spare width
  model: 10,
  branch: 12,
  ctx: 17,
  cost: 9,
  last: 8,
  uptime: 6,
};

export const NAME_MAX_WIDTH = 32;
const CHROME = 4; // border (2) + paddingX (2)
const DROP_ORDER: ColumnKey[] = ['uptime', 'branch', 'last', 'model'];

export function requiredWidth(columns: ColumnKey[]): number {
  const sum = columns.reduce((acc, c) => acc + COLUMN_WIDTHS[c], 0);
  return sum + Math.max(0, columns.length - 1) + CHROME;
}

export function visibleColumns(columns: ColumnKey[], width: number): ColumnKey[] {
  let cols = [...columns];
  for (const drop of DROP_ORDER) {
    if (requiredWidth(cols) <= width) break;
    cols = cols.filter((c) => c !== drop);
  }
  return cols;
}

export function nameWidth(columns: ColumnKey[], width: number): number {
  const spare = width - requiredWidth(columns);
  return Math.min(NAME_MAX_WIDTH, COLUMN_WIDTHS.name + Math.max(0, spare));
}

const STATUS_RANK: Record<DisplayStatus, number> = { waiting: 0, busy: 1, idle: 2, ended: 3 };

const byActivity = (a: SessionView, b: SessionView) => b.lastActivity - a.lastActivity;
const desc = (a: number | null | undefined, b: number | null | undefined) => {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  return b - a;
};

export function sortSessions(sessions: SessionView[], sort: SortKey): SessionView[] {
  const out = [...sessions];
  switch (sort) {
    case 'status':
      return out.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || byActivity(a, b));
    case 'activity':
      return out.sort(byActivity);
    case 'cost':
      return out.sort((a, b) => desc(a.costUSD, b.costUSD) || byActivity(a, b));
    case 'ctx':
      return out.sort((a, b) => desc(a.contextPercent, b.contextPercent) || byActivity(a, b));
    case 'name':
      return out.sort((a, b) => a.name.localeCompare(b.name));
  }
}

export function filterSessions(
  sessions: SessionView[],
  filter: 'all' | 'live',
  search: string,
): SessionView[] {
  const q = search.trim().toLowerCase();
  return sessions.filter((s) => {
    if (filter === 'live' && !s.live) return false;
    if (q === '') return true;
    return s.name.toLowerCase().includes(q) || (s.cwd ?? '').toLowerCase().includes(q);
  });
}

export function scrollWindow(
  selected: number,
  total: number,
  maxRows: number,
): { start: number; end: number } {
  const rows = Math.max(1, maxRows);
  const start = selected >= rows ? selected - rows + 1 : 0;
  return { start, end: Math.min(total, start + rows) };
}
