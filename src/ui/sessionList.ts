import type { ColumnKey, DisplayStatus, SessionView, SortKey, SubagentView } from '../domain/types.js';

export const COLUMN_WIDTHS: Record<ColumnKey, number> = {
  status: 5,
  project: 14,
  name: 12, // minimum; grows into spare width
  model: 10,
  branch: 12,
  ctx: 17,
  cpu: 5,
  mem: 6,
  cost: 9,
  last: 8,
  uptime: 6,
};

export const NAME_MAX_WIDTH = 32;
const CHROME = 4; // border (2) + paddingX (2)
const DROP_ORDER: ColumnKey[] = ['uptime', 'mem', 'cpu', 'branch', 'project', 'last', 'model'];

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

export const NO_PROJECT = '—';
const projectOf = (s: SessionView) => s.project ?? NO_PROJECT;
const byStatusThenActivity = (a: SessionView, b: SessionView) =>
  STATUS_RANK[a.status] - STATUS_RANK[b.status] || byActivity(a, b);

function sortByProject(sessions: SessionView[]): SessionView[] {
  const groups = new Map<string, SessionView[]>();
  for (const s of sessions) {
    const g = groups.get(projectOf(s));
    if (g) g.push(s);
    else groups.set(projectOf(s), [s]);
  }
  const ranked = [...groups.entries()].map(([project, members]) => {
    members.sort(byStatusThenActivity);
    return {
      project,
      members,
      rank: Math.min(...members.map((m) => STATUS_RANK[m.status])),
      last: Math.max(...members.map((m) => m.lastActivity)),
    };
  });
  ranked.sort(
    (a, b) =>
      Number(a.project === NO_PROJECT) - Number(b.project === NO_PROJECT) ||
      a.rank - b.rank ||
      b.last - a.last ||
      a.project.localeCompare(b.project),
  );
  return ranked.flatMap((g) => g.members);
}

export function sortSessions(sessions: SessionView[], sort: SortKey): SessionView[] {
  const out = [...sessions];
  switch (sort) {
    case 'project':
      return sortByProject(out);
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

export type TableRow =
  | { kind: 'group'; project: string; count: number }
  | { kind: 'session'; session: SessionView; index: number }
  | { kind: 'agent'; agent: SubagentView; parent: string; last: boolean };

/** Flatten already-sorted sessions into display rows (group headers only when sorting by project). */
export function buildRows(sessions: SessionView[], sort: SortKey): TableRow[] {
  const rows: TableRow[] = [];
  let prev: string | undefined;
  sessions.forEach((session, index) => {
    if (sort === 'project' && projectOf(session) !== prev) {
      prev = projectOf(session);
      rows.push({
        kind: 'group',
        project: prev,
        count: sessions.filter((s) => projectOf(s) === prev).length,
      });
    }
    rows.push({ kind: 'session', session, index });
    session.subagents.forEach((agent, i) => {
      rows.push({
        kind: 'agent',
        agent,
        parent: session.sessionId,
        last: i === session.subagents.length - 1,
      });
    });
  });
  return rows;
}

/** Window over rows that keeps the selected session (and, if it fits, its group header) visible. */
export function rowWindow(
  rows: TableRow[],
  selectedIndex: number,
  maxRows: number,
): { start: number; end: number } {
  const size = Math.max(1, maxRows);
  const pos = rows.findIndex((r) => r.kind === 'session' && r.index === selectedIndex);
  const sel = Math.max(0, pos);
  let start = sel >= size ? sel - size + 1 : 0;
  for (let g = sel - 1; g >= 0 && g >= sel - size + 1; g--) {
    if (rows[g]?.kind === 'group') {
      start = Math.min(start, g);
      break;
    }
  }
  return { start, end: Math.min(rows.length, start + size) };
}

/** A live session with no activity for longer than the cutoff (exactly at the cutoff is not stale). */
export function isStale(s: SessionView, now: number, cutoffMinutes: number): boolean {
  return s.live && now - s.lastActivity > cutoffMinutes * 60_000;
}
