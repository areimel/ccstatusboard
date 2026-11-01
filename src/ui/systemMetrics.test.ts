import { describe, expect, it } from 'vitest';
import { makeFullSystemStats, makeSystemStats } from '../../test/helpers/system.js';
import { SYSTEM_METRIC_KEYS, type SystemMetricKey, type SystemStats } from '../domain/types.js';
import {
  buildSystemLayout,
  fillRows,
  rowText,
  systemContentRows,
  tempThresholds,
  visibleSystemGroups,
  type Row,
} from './systemMetrics.js';

const ALL = [...SYSTEM_METRIC_KEYS];
const FULL = makeFullSystemStats();
const text = (rows: Row[]): string => rows.map(rowText).join('\n');

describe('fillRows', () => {
  const seg = (value: string) => ({ value });

  it('flows segments across rows and pads to the exact row count', () => {
    const rows = fillRows([seg('aaaa'), seg('bbbb'), seg('cccc')], 10, 3);
    expect(rows.map(rowText)).toEqual(['aaaa  bbbb', 'cccc', '']);
  });
  it('drops what does not fit instead of adding rows', () => {
    const rows = fillRows([seg('aaaaaaaa'), seg('bbbbbbbb'), seg('cccccccc')], 8, 2);
    expect(rows.map(rowText)).toEqual(['aaaaaaaa', 'bbbbbbbb']);
  });
  it('truncates a single oversized segment', () => {
    expect(rowText(fillRows([seg('abcdefghij')], 5, 1)[0]!)).toBe('abcd…');
  });
  it('counts a label in the width', () => {
    const rows = fillRows([{ label: 'CPU', value: '66°' }, seg('x')], 8, 2);
    expect(rows.map(rowText)).toEqual(['CPU 66°', 'x']);
  });
});

describe('tempThresholds', () => {
  it('prefers the sensor limits', () => {
    expect(tempThresholds({ label: 'SSD', celsius: 34, warn: 78.85, crit: 83.85 })).toEqual([78.85, 83.85]);
  });
  it('gives CPU and GPU hotter defaults than other sensors', () => {
    expect(tempThresholds({ label: 'CPU', celsius: 66 })).toEqual([85, 95]);
    expect(tempThresholds({ label: 'GPU2', celsius: 66 })).toEqual([85, 95]);
    expect(tempThresholds({ label: 'Board', celsius: 53 })).toEqual([70, 85]);
  });
  it('never lets warn exceed crit', () => {
    expect(tempThresholds({ label: 'CPU', celsius: 66, crit: 80 })).toEqual([80, 80]);
  });
});

describe('systemContentRows', () => {
  it('matches the current panel with no extra groups', () => {
    expect(systemContentRows(FULL, [], 100)).toBe(4);
    expect(systemContentRows(makeSystemStats({ swap: { used: 0, total: 0 } }), [], 100)).toBe(3);
  });
  it('is the tallest column when wide', () => {
    expect(systemContentRows(FULL, ALL, 100)).toBe(6); // middle: 3 + network 2 + disk 1
    expect(systemContentRows(FULL, ['temps', 'power', 'chips'], 100)).toBe(5);
    expect(systemContentRows(FULL, ['temps'], 100)).toBe(4);
  });
  it('adds one row per group when narrow', () => {
    expect(systemContentRows(FULL, ALL, 99)).toBe(9);
    expect(systemContentRows(FULL, ['temps'], 80)).toBe(5);
  });
});

describe('visibleSystemGroups', () => {
  const visible = (metrics: SystemMetricKey[], columns: number, max: number, s: SystemStats = FULL) =>
    visibleSystemGroups(s, metrics, columns, max);

  it('shows everything when there is room', () => {
    expect(visible(ALL, 100, 8)).toEqual(ALL);
  });
  it('keeps temperatures and battery in a 6-row wide panel', () => {
    expect(visible(ALL, 100, 6)).toEqual(['temps', 'power']);
  });
  it('drops in the agreed order when narrow', () => {
    expect(visible(ALL, 80, 11)).toEqual(ALL);
    expect(visible(ALL, 80, 10)).toEqual(['temps', 'power', 'chips', 'pressure']);
    expect(visible(ALL, 80, 9)).toEqual(['temps', 'power', 'chips']);
    expect(visible(ALL, 80, 8)).toEqual(['temps', 'power']);
    expect(visible(ALL, 80, 7)).toEqual(['temps']);
    expect(visible(ALL, 80, 6)).toEqual([]);
  });
  it('keeps a low-priority group that costs no height', () => {
    // network alone fits in the middle column, beside a taller right column.
    expect(visible(['network', 'temps', 'power', 'chips'], 100, 7)).toEqual([
      'temps',
      'power',
      'chips',
      'network',
    ]);
  });
  it('takes back a dropped group once a later drop has made room', () => {
    // Without swap the meters have a spare row, so pressure fits again after chips goes.
    const noSwap = makeFullSystemStats({ swap: { used: 0, total: 0 } });
    expect(visible(ALL, 100, 6, noSwap)).toEqual(['temps', 'power', 'pressure']);
  });
  it('returns nothing when even the base panel does not fit', () => {
    expect(visible(ALL, 100, 2)).toEqual([]);
  });
  it('respects toggles', () => {
    expect(visible(['network'], 100, 40)).toEqual(['network']);
    expect(visible([], 100, 40)).toEqual([]);
  });
  it('skips groups the machine has no data for', () => {
    expect(visible(ALL, 100, 40, makeSystemStats())).toEqual([]);
    expect(visible(ALL, 100, 40, makeSystemStats({ uptimeSec: 10 }))).toEqual(['power']);
    expect(visible(ALL, 100, 40, makeSystemStats({ temps: [] }))).toEqual([]);
  });
});

describe('buildSystemLayout', () => {
  it('grows the third column on wider terminals, up to a cap', () => {
    expect(buildSystemLayout(FULL, ALL, 100).thirdWidth).toBe(30);
    expect(buildSystemLayout(FULL, ALL, 120).thirdWidth).toBe(40);
    expect(buildSystemLayout(FULL, ALL, 300).thirdWidth).toBe(44);
  });
  it('has no third column without right-hand groups', () => {
    expect(buildSystemLayout(FULL, ['network', 'pressure'], 100).thirdWidth).toBe(0);
    expect(buildSystemLayout(FULL, ['temps'], 80).thirdWidth).toBe(0);
  });
  it('places groups in their fixed slots when wide', () => {
    const l = buildSystemLayout(FULL, ALL, 120);
    expect(l.below).toEqual([]);
    expect(text(l.left)).toContain('mem 0.6%');
    expect(l.left).toHaveLength(1);
    expect(l.middle).toHaveLength(3);
    expect(text(l.middle)).toContain('-47dBm');
    expect(text(l.middle)).toContain('552p');
    expect(l.right).toHaveLength(5);
    expect(text(l.right)).toContain('CPU 66°');
  });
  it('gives each group one titled row when narrow', () => {
    const l = buildSystemLayout(FULL, ALL, 80);
    expect(l.left).toEqual([]);
    expect(l.middle).toEqual([]);
    expect(l.right).toEqual([]);
    expect(l.below.map((r) => r[0]?.value)).toEqual(['Temp ', 'Power', 'Chip ', 'Press', 'Link ']);
  });
  it('formats an idle battery on AC', () => {
    const t = text(buildSystemLayout(FULL, ['power'], 160).right);
    expect(t).toContain('98%  AC  up 1h9m  health 92%  40cyc');
  });
  it('formats a discharging battery with watts and time left', () => {
    const s = makeFullSystemStats({
      battery: { percent: 41, status: 'Discharging', watts: 12.3, secondsLeft: 7200 },
    });
    expect(text(buildSystemLayout(s, ['power'], 100).right)).toBe('41%  12.3W  2h  up 1h9m');
  });
  it('heats a low battery only while discharging', () => {
    const heat = (status: string) =>
      buildSystemLayout(makeFullSystemStats({ battery: { percent: 5, status } }), ['power'], 100)
        .right[0]?.[0]?.heat;
    expect(heat('Discharging')).toEqual({ value: 95, thresholds: [80, 90] });
    expect(heat('Charging')).toBeUndefined();
  });
  it('omits readings a machine lacks', () => {
    const s = makeFullSystemStats({ gpu: { busyPercent: 3 }, battery: undefined });
    const chips = text(buildSystemLayout(s, ['chips'], 100).right);
    expect(chips).toContain('GPU 3%');
    expect(chips).not.toContain('VRAM');
    expect(chips).not.toContain('—');
    expect(text(buildSystemLayout(s, ['power'], 100).right)).toBe('up 1h9m');
  });
});
