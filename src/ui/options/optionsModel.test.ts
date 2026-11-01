import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../config/schema.js';
import {
  adjust,
  editText,
  findOption,
  formatMinutes,
  formatValue,
  OPTIONS,
  parseDurationInput,
  parseNumberInput,
} from './optionsModel.js';

const d = (k: Parameters<typeof findOption>[0]) => findOption(k)!;

describe('optionsModel', () => {
  it('lists options in the specified order', () => {
    expect(OPTIONS.map((o) => o.key)).toEqual([
      'theme',
      'subscriptionUSD',
      'sort',
      'showDetail',
      'showSystem',
      'systemMetrics',
      'columns',
      'idleCutoffMinutes',
      'endedWindowHours',
      'refreshMs',
      'usagePollSeconds',
      'claudeDir',
      'usageApi',
    ]);
  });
  it('labels the idle and keep-exited options', () => {
    expect(d('idleCutoffMinutes')).toMatchObject({
      label: 'Dim idle after',
      kind: 'duration',
      min: 1,
      step: 15,
    });
    expect(d('endedWindowHours')).toMatchObject({ label: 'Keep exited', kind: 'number', min: 0, step: 1 });
  });
  it('formats values', () => {
    expect(formatValue(DEFAULT_CONFIG, d('subscriptionUSD'))).toBe('unset');
    expect(formatValue({ ...DEFAULT_CONFIG, subscriptionUSD: 200 }, d('subscriptionUSD'))).toBe('$200/mo');
    expect(formatValue(DEFAULT_CONFIG, d('showDetail'))).toBe('on');
    expect(formatValue(DEFAULT_CONFIG, d('refreshMs'))).toBe('1000 ms');
    expect(formatValue(DEFAULT_CONFIG, d('claudeDir'))).toBe('auto');
    expect(formatValue(DEFAULT_CONFIG, d('columns'))).toBe('10/11 shown');
    expect(formatValue(DEFAULT_CONFIG, d('systemMetrics'))).toBe('5/5 shown');
    expect(formatValue({ ...DEFAULT_CONFIG, systemMetrics: ['temps'] }, d('systemMetrics'))).toBe(
      '1/5 shown',
    );
    expect(formatValue(DEFAULT_CONFIG, d('idleCutoffMinutes'))).toBe('1h');
    expect(formatValue({ ...DEFAULT_CONFIG, idleCutoffMinutes: 90 }, d('idleCutoffMinutes'))).toBe('1h 30m');
  });
  it('shows keep-exited as off at zero and hours otherwise', () => {
    expect(formatValue(DEFAULT_CONFIG, d('endedWindowHours'))).toBe('off');
    expect(formatValue({ ...DEFAULT_CONFIG, endedWindowHours: 3 }, d('endedWindowHours'))).toBe('3 h');
  });
  it('cycles enums both ways and toggles bools', () => {
    expect(adjust(DEFAULT_CONFIG, 'sort', 1)).toEqual({ sort: 'status' });
    expect(adjust(DEFAULT_CONFIG, 'sort', -1)).toEqual({ sort: 'name' });
    expect(adjust(DEFAULT_CONFIG, 'showSystem', 1)).toEqual({ showSystem: false });
  });
  it('steps numbers and clamps at min', () => {
    expect(adjust(DEFAULT_CONFIG, 'refreshMs', 1)).toEqual({ refreshMs: 1250 });
    expect(adjust({ ...DEFAULT_CONFIG, refreshMs: 250 }, 'refreshMs', -1)).toEqual({});
    expect(adjust({ ...DEFAULT_CONFIG, usagePollSeconds: 40 }, 'usagePollSeconds', -1)).toEqual({
      usagePollSeconds: 30,
    });
    expect(adjust({ ...DEFAULT_CONFIG, endedWindowHours: 1 }, 'endedWindowHours', -1)).toEqual({
      endedWindowHours: 0,
    });
    expect(adjust(DEFAULT_CONFIG, 'endedWindowHours', -1)).toEqual({});
  });
  it('steps durations up and down by step, clamped to min', () => {
    const cfg = (idleCutoffMinutes: number) => ({ ...DEFAULT_CONFIG, idleCutoffMinutes });
    expect(adjust(cfg(60), 'idleCutoffMinutes', 1)).toEqual({ idleCutoffMinutes: 75 });
    expect(adjust(cfg(60), 'idleCutoffMinutes', -1)).toEqual({ idleCutoffMinutes: 45 });
    expect(adjust(cfg(50), 'idleCutoffMinutes', 1)).toEqual({ idleCutoffMinutes: 65 });
    expect(adjust(cfg(10), 'idleCutoffMinutes', -1)).toEqual({ idleCutoffMinutes: 1 });
    expect(adjust(cfg(1), 'idleCutoffMinutes', -1)).toEqual({});
    expect(adjust(cfg(10_080), 'idleCutoffMinutes', 1)).toEqual({});
  });
  it('nullable subscription: unset -> min -> unset', () => {
    expect(adjust(DEFAULT_CONFIG, 'subscriptionUSD', 1)).toEqual({ subscriptionUSD: 10 });
    expect(adjust({ ...DEFAULT_CONFIG, subscriptionUSD: 10 }, 'subscriptionUSD', -1)).toEqual({
      subscriptionUSD: null,
    });
    expect(adjust(DEFAULT_CONFIG, 'subscriptionUSD', -1)).toEqual({});
  });
  it('ignores readonly and columns', () => {
    expect(adjust(DEFAULT_CONFIG, 'usageApi', 1)).toEqual({});
    expect(adjust(DEFAULT_CONFIG, 'columns', 1)).toEqual({});
    expect(adjust(DEFAULT_CONFIG, 'systemMetrics', 1)).toEqual({});
  });
  it('parses number input with schema limits', () => {
    expect(parseNumberInput(d('subscriptionUSD'), '200')).toBe(200);
    expect(parseNumberInput(d('subscriptionUSD'), '$20.5')).toBe(20.5);
    expect(parseNumberInput(d('subscriptionUSD'), '')).toBeNull();
    expect(parseNumberInput(d('subscriptionUSD'), '0')).toBeUndefined();
    expect(parseNumberInput(d('subscriptionUSD'), 'abc')).toBeUndefined();
    expect(parseNumberInput(d('refreshMs'), '100')).toBeUndefined();
    expect(parseNumberInput(d('refreshMs'), '')).toBeUndefined();
    expect(parseNumberInput(d('refreshMs'), '500')).toBe(500);
    expect(parseNumberInput(d('refreshMs'), '500.5')).toBeUndefined();
    expect(parseNumberInput(d('usagePollSeconds'), '29')).toBeUndefined();
    expect(parseNumberInput(d('endedWindowHours'), '0')).toBe(0);
    expect(parseNumberInput(d('theme'), '1')).toBeUndefined();
    expect(parseNumberInput(d('idleCutoffMinutes'), '60')).toBeUndefined();
  });
  it('prefills the editor with the duration text', () => {
    expect(editText({ ...DEFAULT_CONFIG, idleCutoffMinutes: 90 }, d('idleCutoffMinutes'))).toBe('1h 30m');
    expect(editText(DEFAULT_CONFIG, d('endedWindowHours'))).toBe('0');
  });
  it('formats minutes', () => {
    expect(formatMinutes(45)).toBe('45m');
    expect(formatMinutes(60)).toBe('1h');
    expect(formatMinutes(90)).toBe('1h 30m');
    expect(formatMinutes(1440)).toBe('24h');
  });
  it('parses duration input', () => {
    expect(parseDurationInput('45')).toBe(45);
    expect(parseDurationInput('90m')).toBe(90);
    expect(parseDurationInput('2h')).toBe(120);
    expect(parseDurationInput('1.5h')).toBe(90);
    expect(parseDurationInput('1h 30m')).toBe(90);
    expect(parseDurationInput('1h30m')).toBe(90);
    expect(parseDurationInput('  2H  ')).toBe(120);
    expect(parseDurationInput('1H 30M')).toBe(90);
    expect(parseDurationInput('')).toBeUndefined();
    expect(parseDurationInput('abc')).toBeUndefined();
    expect(parseDurationInput('0')).toBeUndefined();
    expect(parseDurationInput('0.5m')).toBeUndefined();
    expect(parseDurationInput('200h')).toBeUndefined();
  });
});
