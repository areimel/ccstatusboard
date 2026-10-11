import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildPriceTable, LITELLM_URL, makeLookup, PricingProvider } from './pricing.js';

const FIXTURE = {
  sample_spec: { input_cost_per_token: 0, output_cost_per_token: 0, max_tokens: 'LEGACY' },
  'claude-opus-5-5': {
    input_cost_per_token: 5e-6,
    output_cost_per_token: 25e-6,
    cache_creation_input_token_cost: 6.25e-6,
    cache_creation_input_token_cost_above_1hr: 10e-6,
    cache_read_input_token_cost: 0.5e-6,
    max_input_tokens: 200000,
  },
  'anthropic/claude-sonnet-5-5': {
    input_cost_per_token: 3e-6,
    output_cost_per_token: 15e-6,
    cache_creation_input_token_cost: 3.75e-6,
    cache_read_input_token_cost: 0.3e-6,
    max_input_tokens: 1000000,
  },
  'claude-haiku-5-5': { input_cost_per_token: 1e-6, output_cost_per_token: 5e-6 },
  'gpt-x': { mode: 'chat' },
};

const NOW = Date.parse('2026-10-11T12:00:00Z');
const DAY = 86_400_000;
const CACHE_DIR = '/cache/ccstatusboard';
const CACHE_FILE = join(CACHE_DIR, 'pricing.json');

function fakeFs(initial: Record<string, { text: string; mtimeMs: number }> = {}) {
  const files = new Map(Object.entries(initial));
  const enoent = () => Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  return {
    files,
    readFile: async (p: string) => {
      const f = files.get(p);
      if (!f) throw enoent();
      return f.text;
    },
    writeFile: vi.fn(async (p: string, data: string) => {
      files.set(p, { text: data, mtimeMs: NOW });
    }),
    mkdir: async () => undefined,
    stat: async (p: string) => {
      const f = files.get(p);
      if (!f) throw enoent();
      return { mtimeMs: f.mtimeMs };
    },
  };
}

const okFetch = () =>
  vi.fn(async () => new Response(JSON.stringify(FIXTURE), { status: 200 })) as unknown as typeof fetch & {
    mock: { calls: unknown[][] };
  };

describe('buildPriceTable', () => {
  it('keeps priced entries, skips sample_spec and unpriced, fills cache defaults', () => {
    const t = buildPriceTable(FIXTURE);
    expect([...t.keys()].sort()).toEqual([
      'anthropic/claude-sonnet-5-5',
      'claude-haiku-5-5',
      'claude-opus-5-5',
    ]);
    expect(t.get('claude-opus-5-5')).toEqual({
      input: 5e-6,
      output: 25e-6,
      cacheWrite: 6.25e-6,
      cacheWrite1h: 10e-6,
      cacheRead: 0.5e-6,
      maxInputTokens: 200000,
    });
    const haiku = t.get('claude-haiku-5-5')!;
    expect(haiku.cacheWrite).toBeCloseTo(1.25e-6, 12);
    expect(haiku.cacheRead).toBeCloseTo(1e-7, 12);
    expect(haiku.cacheWrite1h).toBeUndefined();
    expect(haiku.maxInputTokens).toBeUndefined();
  });

  it('returns an empty table for non-object input', () => {
    expect(buildPriceTable(null).size).toBe(0);
    expect(buildPriceTable([1]).size).toBe(0);
  });
});

describe('makeLookup', () => {
  const lookup = makeLookup(buildPriceTable(FIXTURE));
  it('resolves through the lookup chain', () => {
    expect(lookup('claude-opus-5-5')?.input).toBe(5e-6);
    expect(lookup('claude-sonnet-5-5')?.input).toBe(3e-6); // anthropic/ prefix
    expect(lookup('claude-haiku-5-5-20260301')?.input).toBe(1e-6); // date suffix stripped
    expect(lookup('claude-opus-5-5[1m]')?.input).toBe(5e-6); // [1m] stripped
    expect(lookup('claude-sonnet-5-5[1m]')?.input).toBe(3e-6); // [1m] stripped + anthropic/
  });
  it('returns undefined for unknown models', () => {
    expect(lookup('claude-mystery-9')).toBeUndefined();
    expect(lookup('')).toBeUndefined();
  });
});

describe('PricingProvider', () => {
  it('uses a fresh cache without fetching', async () => {
    const fs = fakeFs({ [CACHE_FILE]: { text: JSON.stringify(FIXTURE), mtimeMs: NOW - 60_000 } });
    const fetch = okFetch();
    const p = new PricingProvider({ cacheDir: CACHE_DIR, deps: { ...fs, fetch, now: () => NOW } });
    const r = await p.load();
    expect(r.status).toBe('ok');
    expect(r.lookup?.('claude-opus-5-5')?.output).toBe(25e-6);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refreshes a stale cache from LiteLLM and rewrites the cache file', async () => {
    const fs = fakeFs({ [CACHE_FILE]: { text: JSON.stringify({}), mtimeMs: NOW - 2 * DAY } });
    const fetch = okFetch();
    const p = new PricingProvider({ cacheDir: CACHE_DIR, deps: { ...fs, fetch, now: () => NOW } });
    const r = await p.load();
    expect(r.status).toBe('ok');
    expect(fetch.mock.calls[0]?.[0]).toBe(LITELLM_URL);
    expect(fs.writeFile).toHaveBeenCalledWith(CACHE_FILE, JSON.stringify(FIXTURE));
    expect(r.lookup?.('claude-haiku-5-5')).toBeDefined();
  });

  it('falls back to the stale cache when the fetch fails', async () => {
    const fs = fakeFs({ [CACHE_FILE]: { text: JSON.stringify(FIXTURE), mtimeMs: NOW - 3 * DAY } });
    const fetch = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof globalThis.fetch;
    const r = await new PricingProvider({
      cacheDir: CACHE_DIR,
      deps: { ...fs, fetch, now: () => NOW },
    }).load();
    expect(r.status).toBe('stale');
    expect(r.lookup?.('claude-opus-5-5')?.input).toBe(5e-6);
  });

  it('reports unavailable with no cache and a failing fetch', async () => {
    const fs = fakeFs();
    const fetch = vi.fn(
      async () => new Response('nope', { status: 500 }),
    ) as unknown as typeof globalThis.fetch;
    const r = await new PricingProvider({
      cacheDir: CACHE_DIR,
      deps: { ...fs, fetch, now: () => NOW },
    }).load();
    expect(r).toEqual({ lookup: null, status: 'unavailable' });
  });

  it('treats a corrupt cache file as missing', async () => {
    const fs = fakeFs({ [CACHE_FILE]: { text: '{oops', mtimeMs: NOW } });
    const fetch = okFetch();
    const r = await new PricingProvider({
      cacheDir: CACHE_DIR,
      deps: { ...fs, fetch, now: () => NOW },
    }).load();
    expect(r.status).toBe('ok');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('still returns ok if writing the cache fails', async () => {
    const fs = fakeFs();
    fs.writeFile.mockRejectedValueOnce(new Error('EACCES'));
    const r = await new PricingProvider({
      cacheDir: CACHE_DIR,
      deps: { ...fs, fetch: okFetch(), now: () => NOW },
    }).load();
    expect(r.status).toBe('ok');
  });
});
