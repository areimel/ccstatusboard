// Synthetic rollout fixtures; no credentials or user configuration are read.
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRuntime, type Runtime } from '../../src/app/runtime.js';
import { DEFAULT_CONFIG } from '../../src/config/schema.js';
import { makeClaudeDir, makeFakeFetch, PRICING_FIXTURE, waitFor } from '../helpers/claudeDir.js';
import { assistantLine } from '../helpers/transcript.js';

const roots: string[] = [];
const runtimes: Runtime[] = [];
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) runtime.stop();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true, maxRetries: 5 });
});

const line = (type: string, payload: unknown, now = Date.now()) =>
  JSON.stringify({ timestamp: new Date(now).toISOString(), type, payload }) + '\n';
const counts = (input = 1000, output = 200) => ({
  input_tokens: input,
  cached_input_tokens: 100,
  output_tokens: output,
  reasoning_output_tokens: 50,
  total_tokens: input + output,
});
const pricing = {
  ...PRICING_FIXTURE,
  'openai/gpt-test': {
    input_cost_per_token: 2e-6,
    output_cost_per_token: 8e-6,
    cache_read_input_token_cost: 0.2e-6,
  },
};

async function fixture(root?: string) {
  const base = root ?? (await mkdtemp(join(tmpdir(), 'ccsb-codex-runtime-')));
  if (!root) roots.push(base);
  const codexDir = join(base, 'codex');
  const directory = join(codexDir, 'sessions', '2026', '11', '06');
  await mkdir(directory, { recursive: true });
  const file = join(directory, 'rollout-synthetic.jsonl');
  const timestamp = Date.now();
  await writeFile(
    file,
    line('session_meta', { id: 'same', cwd: '/work/project', cli_version: '0.166.0' }, timestamp) +
      line('turn_context', { turn_id: 'turn-1', model: 'gpt-test' }, timestamp) +
      line('event_msg', { type: 'task_started', turn_id: 'turn-1' }, timestamp) +
      line(
        'event_msg',
        {
          type: 'token_count',
          info: { total_token_usage: counts(), last_token_usage: counts(), model_context_window: 250000 },
          rate_limits: {
            primary: {
              used_percent: 20,
              window_minutes: 300,
              resets_at: Math.floor(timestamp / 1000) + 7200,
            },
          },
        },
        timestamp,
      ),
  );
  return { base, codexDir, file };
}

describe('Codex runtime integration', () => {
  it('runs without Claude, never reads credentials, and collects incremental token updates', async () => {
    const fx = await fixture();
    const readCredentials = vi.fn(async () => {
      throw new Error('must not read credentials');
    });
    const fetch = makeFakeFetch({ pricing });
    const runtime = createRuntime({
      config: { ...DEFAULT_CONFIG, providers: ['codex'], refreshMs: 250 },
      claudeDir: join(fx.base, 'missing-claude'),
      codexDir: fx.codexDir,
      cacheDir: join(fx.base, 'cache'),
      version: 'test',
      fetch,
      readCredentials,
      systemMonitor: false,
      procStats: false,
      resolveProject: async () => 'project',
    });
    runtimes.push(runtime);
    await runtime.start();
    const session = await waitFor(() =>
      runtime.store.getSnapshot().sessions.find((s) => s.provider === 'codex'),
    );
    expect(session).toMatchObject({
      live: false,
      activityConfidence: 'observed',
      model: 'gpt-test',
      contextWindow: 250000,
      tokens: { input: 900, cacheRead: 100, output: 200 },
    });
    expect(session.pid).toBeUndefined();
    expect(session.costUSD).toBeCloseTo(0.00342, 8);
    expect(runtime.store.getSnapshot().claudeDirFound).toBe(false);
    expect(runtime.store.getSnapshot().providers?.codex?.limits.windows?.[0]?.percent).toBe(20);
    expect(readCredentials).not.toHaveBeenCalled();
    expect(fetch.calls.every((url) => url.includes('model_prices_and_context_window'))).toBe(true);

    await appendFile(
      fx.file,
      line('event_msg', {
        type: 'token_count',
        info: {
          total_token_usage: counts(1500, 300),
          last_token_usage: counts(),
          model_context_window: 250000,
        },
      }),
    );
    const updated = await waitFor(() =>
      runtime.store.getSnapshot().sessions.find((s) => s.tokens.output === 300),
    );
    expect(updated.tokens.input).toBe(1400);
    expect(updated.tokens.cacheRead).toBe(100);
  });

  it('keeps matching Claude and Codex session IDs and totals independent', async () => {
    const claude = await makeClaudeDir([
      {
        pid: process.pid,
        sessionId: 'same',
        cwd: '/work/project',
        status: 'busy',
        lines: [
          assistantLine({
            id: 'response',
            ts: new Date().toISOString(),
            usage: { input_tokens: 500, output_tokens: 100 },
          }),
        ],
      },
    ]);
    roots.push(claude.root);
    const fx = await fixture(claude.root);
    const runtime = createRuntime({
      config: { ...DEFAULT_CONFIG, usageApi: false, refreshMs: 250 },
      claudeDir: claude.claudeDir,
      codexDir: fx.codexDir,
      cacheDir: claude.cacheDir,
      version: 'test',
      fetch: makeFakeFetch({ pricing }),
      systemMonitor: false,
      procStats: false,
      resolveProject: async () => 'project',
    });
    runtimes.push(runtime);
    await runtime.start();
    const snapshot = await waitFor(() => {
      const value = runtime.store.getSnapshot();
      return value.scan.done &&
        value.sessions.length === 2 &&
        value.sessions.every((s) => s.tokens.output > 0)
        ? value
        : undefined;
    });
    expect(new Set(snapshot.sessions.map((s) => s.key)).size).toBe(2);
    expect(snapshot.providers?.claude?.costs.today.tokens.output).toBe(100);
    expect(snapshot.providers?.codex?.costs.today.tokens.output).toBe(200);
    await waitFor(() => runtime.store.getSnapshot().providers?.codex?.scan.done);
    expect(await readFile(fx.file, 'utf8')).toContain('session_meta');
  });
});
