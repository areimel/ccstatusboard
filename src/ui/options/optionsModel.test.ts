import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../config/schema.js';
import { adjust, findOption, formatValue, OPTIONS, parseNumberInput } from './optionsModel.js';

const d = (k: Parameters<typeof findOption>[0]) => findOption(k)!;

describe('optionsModel', () => {
  it('lists options in the specified order', () => {
    expect(OPTIONS.map((o) => o.key)).toEqual([
      'theme',
      'subscriptionUSD',
      'sort',
      'showDetail',
      'showSystem',
      'columns',
      'endedWindowHours',
      'refreshMs',
      'usagePollSeconds',
      'claudeDir',
      'usageApi',
    ]);
  });
  it('formats values', () => {
    expect(formatValue(DEFAULT_CONFIG, d('subscriptionUSD'))).toBe('unset');
    expect(formatValue({ ...DEFAULT_CONFIG, subscriptionUSD: 200 }, d('subscriptionUSD'))).toBe('$200/mo');
    expect(formatValue(DEFAULT_CONFIG, d('showDetail'))).toBe('on');
    expect(formatValue(DEFAULT_CONFIG, d('refreshMs'))).toBe('1000 ms');
    expect(formatValue(DEFAULT_CONFIG, d('claudeDir'))).toBe('auto');
    expect(formatValue(DEFAULT_CONFIG, d('columns'))).toBe('10/10 shown');
  });
  it('cycles enums both ways and toggles bools', () => {
    expect(adjust(DEFAULT_CONFIG, 'sort', 1)).toEqual({ sort: 'activity' });
    expect(adjust(DEFAULT_CONFIG, 'sort', -1)).toEqual({ sort: 'name' });
    expect(adjust(DEFAULT_CONFIG, 'showSystem', 1)).toEqual({ showSystem: false });
  });
  it('steps numbers and clamps at min', () => {
    expect(adjust(DEFAULT_CONFIG, 'refreshMs', 1)).toEqual({ refreshMs: 1250 });
    expect(adjust({ ...DEFAULT_CONFIG, refreshMs: 250 }, 'refreshMs', -1)).toEqual({});
    expect(adjust({ ...DEFAULT_CONFIG, usagePollSeconds: 40 }, 'usagePollSeconds', -1)).toEqual({
      usagePollSeconds: 30,
    });
    expect(adjust({ ...DEFAULT_CONFIG, endedWindowHours: 3 }, 'endedWindowHours', -1)).toEqual({
      endedWindowHours: 0,
    });
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
  });
});
