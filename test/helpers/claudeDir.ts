// Builds a temporary Claude config dir (sessions/, projects/, .credentials.json) for runtime tests.
import { mkdtemp, mkdir, writeFile, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { encodeProjectDir } from '../../src/core/paths.js';

export interface FixtureSession {
  pid: number;
  sessionId: string;
  cwd: string;
  status?: string;
  waitingFor?: string;
  name?: string;
  lines: string[];
  /** false → transcript only (history / ended session). Default true. */
  registry?: boolean;
  /** Set transcript mtime (e.g. days ago). */
  mtime?: Date;
}

export interface ClaudeFixture {
  root: string;
  claudeDir: string;
  cacheDir: string;
  transcriptFile(s: FixtureSession): string;
  registryFile(pid: number): string;
  cleanup(): Promise<void>;
}

export async function makeClaudeDir(
  sessions: FixtureSession[],
  opts: { credentials?: boolean; createClaudeDir?: boolean } = {},
): Promise<ClaudeFixture> {
  const root = await mkdtemp(join(tmpdir(), 'ccsb-'));
  const claudeDir = join(root, 'claude');
  const cacheDir = join(root, 'cache');
  await mkdir(cacheDir, { recursive: true });
  const transcriptFile = (s: FixtureSession) =>
    join(claudeDir, 'projects', encodeProjectDir(s.cwd), `${s.sessionId}.jsonl`);
  const registryFile = (pid: number) => join(claudeDir, 'sessions', `${pid}.json`);

  if (opts.createClaudeDir !== false) {
    await mkdir(join(claudeDir, 'sessions'), { recursive: true });
    await mkdir(join(claudeDir, 'projects'), { recursive: true });
    if (opts.credentials !== false) {
      await writeFile(
        join(claudeDir, '.credentials.json'),
        JSON.stringify({ claudeAiOauth: { accessToken: 'test-token', expiresAt: Date.now() + 3_600_000 } }),
      );
    }
    for (const s of sessions) {
      const file = transcriptFile(s);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, s.lines.length ? s.lines.join('\n') + '\n' : '');
      if (s.mtime) await utimes(file, s.mtime, s.mtime);
      if (s.registry !== false) {
        const now = Date.now();
        await writeFile(
          registryFile(s.pid),
          JSON.stringify({
            pid: s.pid,
            sessionId: s.sessionId,
            cwd: s.cwd,
            startedAt: now - 60_000,
            version: '2.1.296',
            kind: 'interactive',
            ...(s.name ? { name: s.name } : {}),
            status: s.status ?? 'idle',
            ...(s.waitingFor ? { waitingFor: s.waitingFor } : {}),
            updatedAt: now,
            statusUpdatedAt: now,
          }),
        );
      }
    }
  }
  return {
    root,
    claudeDir,
    cacheDir,
    transcriptFile,
    registryFile,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

/** opus: $5/M in, $25/M out, $6.25/M cache write, $0.50/M cache read. */
export const PRICING_FIXTURE: Record<string, unknown> = {
  'claude-opus-5-5': {
    input_cost_per_token: 0.000005,
    output_cost_per_token: 0.000025,
    cache_creation_input_token_cost: 0.00000625,
    cache_read_input_token_cost: 0.0000005,
    max_input_tokens: 200_000,
  },
};

export function usageFixture(now: number): Record<string, unknown> {
  return {
    five_hour: { utilization: 58, resets_at: new Date(now + 2 * 3_600_000).toISOString() },
    seven_day: { utilization: 31, resets_at: new Date(now + 3 * 86_400_000).toISOString() },
  };
}

export function makeFakeFetch(o: {
  usage?: unknown;
  pricing?: unknown;
  fail?: boolean;
}): typeof fetch & { calls: string[] } {
  const calls: string[] = [];
  const fn = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    if (o.fail) throw new TypeError('fetch failed');
    const body = url.includes('oauth/usage') ? o.usage : url.includes('litellm') ? o.pricing : undefined;
    if (body === undefined) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch & { calls: string[] };
  fn.calls = calls;
  return fn;
}

export async function waitFor<T>(
  fn: () => T | undefined | null | false,
  timeoutMs = 8_000,
  stepMs = 50,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > deadline) throw new Error(`waitFor timed out after ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, stepMs));
  }
}
