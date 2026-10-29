import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, parseCliArgs, resolveConfigPath } from './load.js';
import { DEFAULT_CONFIG } from './schema.js';

function enoent(): Error {
  return Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
}

function fakeFs(files: Record<string, string>) {
  return async (p: string): Promise<string> => {
    const v = files[p];
    if (v === undefined) throw enoent();
    return v;
  };
}

const home = '/home/u';
const env = {};
const defaultPath = '/home/u/.config/ccstatusboard/config.json';

describe('loadConfig', () => {
  it('returns defaults when the default config file is missing', async () => {
    expect(await loadConfig({ flags: {}, env, home, readFile: fakeFs({}) })).toEqual(DEFAULT_CONFIG);
  });

  it('reads the default file location (XDG respected)', async () => {
    const cfg = await loadConfig({
      flags: {},
      env: { XDG_CONFIG_HOME: '/xdg' },
      home,
      readFile: fakeFs({ '/xdg/ccstatusboard/config.json': '{"theme":"mono"}' }),
    });
    expect(cfg.theme).toBe('mono');
  });

  it('flags override file values', async () => {
    const cfg = await loadConfig({
      flags: {
        theme: 'solarized',
        refresh: '500',
        endedHours: '6',
        sort: 'cost',
        claudeDir: '/c',
        usageApi: false,
      },
      env,
      home,
      readFile: fakeFs({ [defaultPath]: '{"theme":"mono","refreshMs":2000,"sort":"name"}' }),
    });
    expect(cfg).toMatchObject({
      theme: 'solarized',
      refreshMs: 500,
      endedWindowHours: 6,
      sort: 'cost',
      claudeDir: '/c',
      usageApi: false,
    });
  });

  it('uses --config path and errors if it does not exist', async () => {
    const cfg = await loadConfig({
      flags: { config: '/x.json' },
      env,
      home,
      readFile: fakeFs({ '/x.json': '{"endedWindowHours":2}' }),
    });
    expect(cfg.endedWindowHours).toBe(2);
    await expect(
      loadConfig({ flags: { config: '/missing.json' }, env, home, readFile: fakeFs({}) }),
    ).rejects.toThrow(ConfigError);
  });

  it('throws ConfigError on invalid JSON with the path in the message', async () => {
    await expect(
      loadConfig({ flags: {}, env, home, readFile: fakeFs({ [defaultPath]: '{nope' }) }),
    ).rejects.toThrow(/config\.json/);
  });

  it('throws ConfigError on schema violations, including bad numeric flags', async () => {
    await expect(
      loadConfig({ flags: {}, env, home, readFile: fakeFs({ [defaultPath]: '{"refreshMs":10}' }) }),
    ).rejects.toThrow(ConfigError);
    await expect(loadConfig({ flags: { refresh: 'abc' }, env, home, readFile: fakeFs({}) })).rejects.toThrow(
      ConfigError,
    );
  });
});

describe('parseCliArgs', () => {
  it('parses all flags', () => {
    const r = parseCliArgs([
      '--theme',
      'mono',
      '--refresh',
      '500',
      '--ended-hours',
      '3',
      '--sort',
      'ctx',
      '--claude-dir',
      '/c',
      '--no-usage-api',
      '--config',
      '/x.json',
    ]);
    expect(r.flags).toEqual({
      theme: 'mono',
      refresh: '500',
      endedHours: '3',
      sort: 'ctx',
      claudeDir: '/c',
      usageApi: false,
      config: '/x.json',
    });
    expect(r.help).toBe(false);
    expect(r.version).toBe(false);
  });

  it('parses help and version (long and short)', () => {
    expect(parseCliArgs(['--help']).help).toBe(true);
    expect(parseCliArgs(['-h']).help).toBe(true);
    expect(parseCliArgs(['--version']).version).toBe(true);
    expect(parseCliArgs(['-v']).version).toBe(true);
  });

  it('returns empty flags for no args', () => {
    expect(parseCliArgs([]).flags).toEqual({});
  });

  it('throws ConfigError on unknown flags', () => {
    expect(() => parseCliArgs(['--bogus'])).toThrow(ConfigError);
  });
});

describe('resolveConfigPath', () => {
  it('prefers --config, else XDG/home default', () => {
    expect(resolveConfigPath({ config: '/x/c.json' }, {}, home)).toBe('/x/c.json');
    expect(resolveConfigPath({}, {}, home)).toBe(defaultPath);
    expect(resolveConfigPath({}, { XDG_CONFIG_HOME: '/xdg' }, home)).toBe('/xdg/ccstatusboard/config.json');
  });
});
