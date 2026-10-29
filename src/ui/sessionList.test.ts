import { describe, expect, it } from 'vitest';
import type { ColumnKey } from '../domain/types.js';
import {
  buildRows,
  filterSessions,
  requiredWidth,
  rowWindow,
  scrollWindow,
  sortSessions,
  visibleColumns,
} from './sessionList.js';
import { makeSession, NOW } from '../../test/helpers/snapshot.js';

const ALL: ColumnKey[] = ['status', 'name', 'model', 'branch', 'ctx', 'cost', 'last', 'uptime'];

describe('visibleColumns (Review Focus 5: narrow terminals)', () => {
  it('keeps all 8 columns at 120 and at exactly 90', () => {
    expect(requiredWidth(ALL)).toBe(90);
    expect(visibleColumns(ALL, 120)).toEqual(ALL);
    expect(visibleColumns(ALL, 90)).toEqual(ALL);
  });
  it('drops uptime first (89)', () => {
    expect(visibleColumns(ALL, 89)).toEqual(['status', 'name', 'model', 'branch', 'ctx', 'cost', 'last']);
  });
  it('drops uptime then branch at 70', () => {
    expect(visibleColumns(ALL, 70)).toEqual(['status', 'name', 'model', 'ctx', 'cost', 'last']);
  });
  it('drops uptime, branch, last at 61', () => {
    expect(visibleColumns(ALL, 61)).toEqual(['status', 'name', 'model', 'ctx', 'cost']);
  });
  it('drops model too at 60, never the core four', () => {
    expect(visibleColumns(ALL, 60)).toEqual(['status', 'name', 'ctx', 'cost']);
    expect(visibleColumns(ALL, 20)).toEqual(['status', 'name', 'ctx', 'cost']);
  });
  it('drops uptime, then mem, then cpu when narrow (cpu/mem columns present)', () => {
    const WITH_RES: ColumnKey[] = [
      'status',
      'name',
      'model',
      'branch',
      'ctx',
      'cpu',
      'mem',
      'cost',
      'last',
      'uptime',
    ];
    expect(requiredWidth(WITH_RES)).toBe(103);
    expect(visibleColumns(WITH_RES, 103)).toEqual(WITH_RES);
    expect(visibleColumns(WITH_RES, 102)).toEqual(WITH_RES.filter((c) => c !== 'uptime'));
    expect(visibleColumns(WITH_RES, 95)).toEqual(WITH_RES.filter((c) => c !== 'uptime' && c !== 'mem'));
    expect(visibleColumns(WITH_RES, 88)).toEqual(
      WITH_RES.filter((c) => c !== 'uptime' && c !== 'mem' && c !== 'cpu'),
    );
  });
  it('preserves the user-configured column order and subset', () => {
    expect(visibleColumns(['cost', 'name', 'uptime', 'status'], 120)).toEqual([
      'cost',
      'name',
      'uptime',
      'status',
    ]);
  });
});

describe('sortSessions', () => {
  const s = [
    makeSession({
      sessionId: 'idle',
      name: 'b',
      status: 'idle',
      lastActivity: NOW - 10,
      costUSD: 1,
      contextPercent: 10,
    }),
    makeSession({
      sessionId: 'ended',
      name: 'a',
      live: false,
      status: 'ended',
      lastActivity: NOW - 5,
      costUSD: null,
    }),
    makeSession({
      sessionId: 'wait',
      name: 'd',
      status: 'waiting',
      lastActivity: NOW - 1000,
      costUSD: 3,
      contextPercent: 90,
    }),
    makeSession({
      sessionId: 'busy',
      name: 'c',
      status: 'busy',
      lastActivity: NOW - 1,
      costUSD: 2,
      contextPercent: undefined,
    }),
  ];
  const ids = (xs: typeof s) => xs.map((x) => x.sessionId);
  it('status: waiting > busy > idle > ended', () => {
    expect(ids(sortSessions(s, 'status'))).toEqual(['wait', 'busy', 'idle', 'ended']);
  });
  it('activity: most recent first', () => {
    expect(ids(sortSessions(s, 'activity'))).toEqual(['busy', 'ended', 'idle', 'wait']);
  });
  it('cost: highest first, null last', () => {
    expect(ids(sortSessions(s, 'cost'))).toEqual(['wait', 'busy', 'idle', 'ended']);
  });
  it('ctx: highest first, undefined last', () => {
    expect(ids(sortSessions(s, 'ctx'))[0]).toBe('wait');
    expect(ids(sortSessions(s, 'ctx')).slice(-2)).toContain('busy');
  });
  it('name: alphabetical; does not mutate input', () => {
    const before = ids(s);
    expect(ids(sortSessions(s, 'name'))).toEqual(['ended', 'idle', 'busy', 'wait']);
    expect(ids(s)).toEqual(before);
  });
});

describe('filterSessions', () => {
  const s = [
    makeSession({ sessionId: '1', name: 'pet-tracker', cwd: '/home/u/house/seeed-pet-tracker' }),
    makeSession({ sessionId: '2', name: 'blog', cwd: '/home/u/blog', live: false, status: 'ended' }),
  ];
  it('live filter hides ended sessions', () => {
    expect(filterSessions(s, 'live', '').map((x) => x.sessionId)).toEqual(['1']);
  });
  it('search matches name or cwd case-insensitively', () => {
    expect(filterSessions(s, 'all', 'BLOG').map((x) => x.sessionId)).toEqual(['2']);
    expect(filterSessions(s, 'all', 'house').map((x) => x.sessionId)).toEqual(['1']);
    expect(filterSessions(s, 'all', '')).toHaveLength(2);
  });
});

describe('scrollWindow', () => {
  it('keeps the selection visible', () => {
    expect(scrollWindow(0, 10, 3)).toEqual({ start: 0, end: 3 });
    expect(scrollWindow(7, 10, 3)).toEqual({ start: 5, end: 8 });
    expect(scrollWindow(2, 2, 5)).toEqual({ start: 0, end: 2 });
  });
});

describe('sortSessions project', () => {
  const mk = (id: string, project: string | undefined, status: 'waiting' | 'busy' | 'idle', ago: number) =>
    makeSession({ sessionId: id, project, status, lastActivity: NOW - ago });
  const list = [
    mk('z-idle', 'zeta', 'idle', 1_000),
    mk('a-idle', 'alpha', 'idle', 5_000),
    mk('none', undefined, 'waiting', 0),
    mk('b-busy-old', 'beta', 'busy', 9_000),
    mk('b-wait', 'beta', 'waiting', 8_000),
    mk('a-idle2', 'alpha', 'idle', 2_000),
  ];
  it('orders groups by best status, then recency, then name; no-project last', () => {
    expect(sortSessions(list, 'project').map((x) => x.sessionId)).toEqual([
      'b-wait',
      'b-busy-old',
      'z-idle',
      'a-idle2',
      'a-idle',
      'none',
    ]);
  });
  it('breaks ties by name', () => {
    const t = [mk('2', 'b', 'idle', 1000), mk('1', 'a', 'idle', 1000)];
    expect(sortSessions(t, 'project').map((x) => x.sessionId)).toEqual(['1', '2']);
  });
});

describe('buildRows', () => {
  const sorted = sortSessions(
    [
      makeSession({ sessionId: '1', project: 'a' }),
      makeSession({ sessionId: '2', project: 'a' }),
      makeSession({ sessionId: '3', project: 'b' }),
      makeSession({ sessionId: '4' }),
    ],
    'project',
  );
  it('emits group headers with counts and session-only indexes', () => {
    const rows = buildRows(sorted, 'project');
    expect(
      rows.map((r) =>
        r.kind === 'group' ? `g:${r.project}:${r.count}` : r.kind === 'session' ? `s${r.index}` : 'x',
      ),
    ).toEqual(['g:a:2', 's0', 's1', 'g:b:1', 's2', 'g:—:1', 's3']);
  });
  it('has no group rows for other sorts', () => {
    expect(buildRows(sorted, 'status').every((r) => r.kind === 'session')).toBe(true);
  });
});

describe('rowWindow', () => {
  const sorted = sortSessions(
    ['a', 'b', 'c'].flatMap((p) =>
      [1, 2, 3].map((n) => makeSession({ sessionId: `${p}${n}`, project: p, lastActivity: NOW - n })),
    ),
    'project',
  );
  const rows = buildRows(sorted, 'project'); // 12 rows
  const visibleSel = (sel: number, max: number) => {
    const { start, end } = rowWindow(rows, sel, max);
    return rows.slice(start, end);
  };
  it('keeps the selected session visible and within maxRows', () => {
    for (let sel = 0; sel < 9; sel++) {
      const w = visibleSel(sel, 4);
      expect(w.length).toBeLessThanOrEqual(4);
      expect(w.some((r) => r.kind === 'session' && r.index === sel)).toBe(true);
    }
  });
  it('keeps the group header when it fits', () => {
    // selected is the first session of group b (row 5); scrolled window still shows b's header.
    expect(visibleSel(3, 4).some((r) => r.kind === 'group' && r.project === 'b')).toBe(true);
    expect(visibleSel(1, 3)[0]?.kind).toBe('group');
  });
  it('shows everything when it fits', () => {
    expect(rowWindow(rows, 8, 50)).toEqual({ start: 0, end: 12 });
  });
});
