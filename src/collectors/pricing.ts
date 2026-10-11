// LiteLLM-backed model pricing with a 24h on-disk cache.
import {
  mkdir as fsMkdir,
  readFile as fsReadFile,
  stat as fsStat,
  writeFile as fsWriteFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import type { ModelPrice, PriceLookup, PricingStatus } from '../domain/types.js';

export const LITELLM_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';

const DAY_MS = 86_400_000;
const FETCH_TIMEOUT_MS = 10_000;
/** Anthropic standard multipliers used when LiteLLM omits cache prices. */
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const numOrUndef = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

export function buildPriceTable(json: unknown): Map<string, ModelPrice> {
  const table = new Map<string, ModelPrice>();
  if (!isObj(json)) return table;
  for (const [name, entry] of Object.entries(json)) {
    if (name === 'sample_spec' || !isObj(entry)) continue;
    const input = numOrUndef(entry.input_cost_per_token);
    const output = numOrUndef(entry.output_cost_per_token);
    if (input === undefined || output === undefined) continue;
    const price: ModelPrice = {
      input,
      output,
      cacheWrite: numOrUndef(entry.cache_creation_input_token_cost) ?? input * CACHE_WRITE_MULTIPLIER,
      cacheRead: numOrUndef(entry.cache_read_input_token_cost) ?? input * CACHE_READ_MULTIPLIER,
    };
    const cacheWrite1h = numOrUndef(entry.cache_creation_input_token_cost_above_1hr);
    if (cacheWrite1h !== undefined) price.cacheWrite1h = cacheWrite1h;
    const maxInputTokens = numOrUndef(entry.max_input_tokens);
    if (maxInputTokens !== undefined) price.maxInputTokens = maxInputTokens;
    table.set(name, price);
  }
  return table;
}

function candidates(model: string): string[] {
  const stripDate = (s: string) => s.replace(/-\d{8}$/, '');
  const base = model.replace(/\[1m\]$/i, '');
  const names = [model, stripDate(model), base, stripDate(base)];
  return [...new Set(names.flatMap((n) => [n, `anthropic/${n}`]))];
}

export function makeLookup(table: Map<string, ModelPrice>): PriceLookup {
  const memo = new Map<string, ModelPrice | undefined>();
  return (model: string) => {
    if (memo.has(model)) return memo.get(model);
    let found: ModelPrice | undefined;
    if (model !== '') {
      for (const name of candidates(model)) {
        found = table.get(name);
        if (found) break;
      }
    }
    memo.set(model, found);
    return found;
  };
}

export interface PricingDeps {
  fetch?: typeof fetch;
  readFile?: (p: string) => Promise<string>;
  writeFile?: (p: string, data: string) => Promise<void>;
  mkdir?: (p: string) => Promise<unknown>;
  stat?: (p: string) => Promise<{ mtimeMs: number }>;
  now?: () => number;
}

export interface PricingResult {
  lookup: PriceLookup | null;
  status: PricingStatus;
}

export class PricingProvider {
  private readonly cacheDir: string;
  private readonly file: string;
  private readonly ttlMs: number;
  private readonly deps: Required<PricingDeps>;

  constructor(opts: { cacheDir: string; ttlMs?: number; deps?: PricingDeps }) {
    this.cacheDir = opts.cacheDir;
    this.file = join(opts.cacheDir, 'pricing.json');
    this.ttlMs = opts.ttlMs ?? DAY_MS;
    const d = opts.deps ?? {};
    this.deps = {
      fetch: d.fetch ?? globalThis.fetch,
      readFile: d.readFile ?? ((p) => fsReadFile(p, 'utf8')),
      writeFile: d.writeFile ?? ((p, data) => fsWriteFile(p, data, 'utf8')),
      mkdir: d.mkdir ?? ((p) => fsMkdir(p, { recursive: true })),
      stat: d.stat ?? fsStat,
      now: d.now ?? Date.now,
    };
  }

  async load(): Promise<PricingResult> {
    const cached = await this.readCache();
    if (cached && this.deps.now() - cached.mtimeMs < this.ttlMs) {
      return { lookup: makeLookup(cached.table), status: 'ok' };
    }
    try {
      const res = await this.deps.fetch(LITELLM_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const table = buildPriceTable(JSON.parse(text));
      if (table.size === 0) throw new Error('empty pricing table');
      await this.writeCache(text);
      return { lookup: makeLookup(table), status: 'ok' };
    } catch {
      if (cached) return { lookup: makeLookup(cached.table), status: 'stale' };
      return { lookup: null, status: 'unavailable' };
    }
  }

  private async readCache(): Promise<{ table: Map<string, ModelPrice>; mtimeMs: number } | null> {
    try {
      const { mtimeMs } = await this.deps.stat(this.file);
      const table = buildPriceTable(JSON.parse(await this.deps.readFile(this.file)));
      return table.size > 0 ? { table, mtimeMs } : null;
    } catch {
      return null;
    }
  }

  private async writeCache(text: string): Promise<void> {
    try {
      await this.deps.mkdir(this.cacheDir);
      await this.deps.writeFile(this.file, text);
    } catch {
      // A read-only cache dir only costs us a re-fetch next start.
    }
  }
}
