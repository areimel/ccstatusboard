import { describe, expect, it } from 'vitest';
import { configSchema, DEFAULT_CONFIG } from './schema.js';

describe('configSchema', () => {
  it('parses {} to DEFAULT_CONFIG', () => {
    expect(configSchema.parse({})).toEqual(DEFAULT_CONFIG);
  });

  it('has the spec defaults', () => {
    expect(DEFAULT_CONFIG).toEqual({
      theme: 'default',
      refreshMs: 1000,
      usagePollSeconds: 60,
      endedWindowHours: 0,
      idleCutoffMinutes: 60,
      columns: ['status', 'project', 'name', 'model', 'ctx', 'cpu', 'mem', 'cost', 'last', 'uptime'],
      sort: 'project',
      showDetail: true,
      claudeDir: null,
      usageApi: true,
      subscriptionUSD: null,
      showSystem: true,
    });
  });

  it('returns a fresh columns array each parse', () => {
    const a = configSchema.parse({});
    a.columns.push('name');
    expect(configSchema.parse({}).columns).toHaveLength(10);
  });

  it('defaults include project column, exclude branch, and sort by project', () => {
    const cfg = configSchema.parse({});
    expect(cfg.sort).toBe('project');
    expect(cfg.columns).toContain('project');
    expect(cfg.columns).not.toContain('branch');
    expect(cfg.idleCutoffMinutes).toBe(60);
    expect(cfg.endedWindowHours).toBe(0);
  });

  it('rejects idleCutoffMinutes of 0, non-integers, and out-of-range values', () => {
    expect(configSchema.safeParse({ idleCutoffMinutes: 0 }).success).toBe(false);
    expect(configSchema.safeParse({ idleCutoffMinutes: 1.5 }).success).toBe(false);
    expect(configSchema.safeParse({ idleCutoffMinutes: 10_081 }).success).toBe(false);
    expect(configSchema.safeParse({ idleCutoffMinutes: 1 }).success).toBe(true);
    expect(configSchema.safeParse({ idleCutoffMinutes: 10_080 }).success).toBe(true);
  });

  it('enforces minimums and enums', () => {
    expect(configSchema.safeParse({ refreshMs: 100 }).success).toBe(false);
    expect(configSchema.safeParse({ refreshMs: 3_000_000_000 }).success).toBe(false);
    expect(configSchema.safeParse({ usagePollSeconds: 3_000_000 }).success).toBe(false);
    expect(configSchema.safeParse({ usagePollSeconds: 10 }).success).toBe(false);
    expect(configSchema.safeParse({ endedWindowHours: -1 }).success).toBe(false);
    expect(configSchema.safeParse({ theme: 'neon' }).success).toBe(false);
    expect(configSchema.safeParse({ theme: 'gruvbox' }).success).toBe(true);
    expect(configSchema.safeParse({ sort: 'size' }).success).toBe(false);
    expect(configSchema.safeParse({ columns: ['bogus'] }).success).toBe(false);
    expect(configSchema.safeParse({ refreshMs: Number.NaN }).success).toBe(false);
  });

  it('rejects unknown keys', () => {
    expect(configSchema.safeParse({ colour: 'red' }).success).toBe(false);
  });

  it('accepts a full valid config', () => {
    const cfg = configSchema.parse({
      theme: 'dracula',
      refreshMs: 500,
      claudeDir: '/x',
      columns: ['name', 'ctx'],
    });
    expect(cfg.theme).toBe('dracula');
    expect(cfg.columns).toEqual(['name', 'ctx']);
    expect(cfg.claudeDir).toBe('/x');
  });
});
