import { describe, expect, it } from 'vitest';
import type { ColumnKey } from '../domain/types.js';
import { filterSessions, requiredWidth, scrollWindow, sortSessions, visibleColumns } from './sessionList.js';
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
