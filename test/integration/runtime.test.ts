// End-to-end: temp CLAUDE_CONFIG_DIR + fake network → real collectors → Store snapshot (spec §9).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appendFile, rm } from 'node:fs/promises';
import { createRuntime, type Runtime, type RuntimeOptions } from '../../src/app/runtime.js';
import { readCredentials } from '../../src/collectors/credentials.js';
import { DEFAULT_CONFIG } from '../../src/config/schema.js';
import type { Config } from '../../src/domain/types.js';
import { assistantLine, costStateLine } from '../helpers/transcript.js';
import {
  makeClaudeDir,
  makeFakeFetch,
  PRICING_FIXTURE,
  usageFixture,
  waitFor,
  type ClaudeFixture,
  type FixtureSession,
} from '../helpers/claudeDir.js';

const HOUR = 3_600_000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const usage = { input_tokens: 1000, output_tokens: 2000 };

let rt: Runtime | undefined;
let fx: ClaudeFixture | undefined;
afterEach(async () => {
  // HistoryScanner has no stop(): let its scan (and cache write) finish before removing the temp dir.
  const store = rt?.store;
  if (store) await waitFor(() => store.getSnapshot().scan.done, 8_000).catch(() => undefined);
  rt?.stop();
  // Retry in case a late cache write recreates files while rm is walking the tree.
  if (fx) await rm(fx.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  rt = undefined;
  fx = undefined;
});

async function boot(
  sessions: FixtureSession[],
  o: {
    fetch?: ReturnType<typeof makeFakeFetch>;
    config?: Partial<Config>;
    credentials?: boolean;
    createClaudeDir?: boolean;
    readCredentials?: RuntimeOptions['readCredentials'];
  } = {},
) {
  fx = await makeClaudeDir(sessions, { credentials: o.credentials, createClaudeDir: o.createClaudeDir });
  rt = createRuntime({
    config: { ...DEFAULT_CONFIG, refreshMs: 250, endedWindowHours: 24, ...o.config },
    claudeDir: fx.claudeDir,
    cacheDir: fx.cacheDir,
    version: '0.1.0-test',
    fetch: o.fetch ?? makeFakeFetch({ usage: usageFixture(Date.now()), pricing: PRICING_FIXTURE }),
    ...(o.readCredentials ? { readCredentials: o.readCredentials } : {}),
  });
  await rt.start();
  return { fx, store: rt.store };
}

const liveSession = (lines: string[]): FixtureSession => ({
  pid: process.pid,
  sessionId: 'live',
  cwd: '/work/live',
  status: 'busy',
  lines,
});

describe('runtime integration', () => {
  it('aggregates live + history, updates on append, and ends a session when its registry file goes', async () => {
    const live = liveSession([assistantLine({ id: 'a1', ts: iso(10 * 60_000), usage })]);
    const recent: FixtureSession = {
      pid: 9_999_991,
      sessionId: 'recent',
      cwd: '/work/recent',
      registry: false,
      lines: [assistantLine({ id: 'r1', ts: iso(2 * HOUR), usage })],
    };
    const old: FixtureSession = {
      pid: 9_999_992,
      sessionId: 'old',
      cwd: '/work/old',
      registry: false,
      mtime: new Date(Date.now() - 3 * 24 * HOUR),
      lines: [assistantLine({ id: 'o1', ts: iso(3 * 24 * HOUR), usage })],
    };
    const { fx, store } = await boot([live, recent, old]);

    // history scan completes; the 'old' session is outside the 24h ended window but inside the week
    const snap = await waitFor(() => {
      const s = store.getSnapshot();
      return s.scan.done &&
        s.pricingStatus === 'ok' &&
        s.sessions.some((x) => x.sessionId === 'live' && x.tokens.output > 0)
        ? s
        : undefined;
    });
    const ids = snap.sessions.map((s) => s.sessionId).sort();
    expect(ids).toEqual(['live', 'recent']);
    expect(snap.sessions.find((s) => s.sessionId === 'recent')).toMatchObject({
      live: false,
      status: 'ended',
    });
    expect(snap.sessions.find((s) => s.sessionId === 'live')).toMatchObject({ live: true, status: 'busy' });
    expect(snap.costs.week.costUSD ?? 0).toBeGreaterThan(snap.costs.today.costUSD ?? 0);
    expect(snap.costs.today.costUSD).toBeCloseTo(0.11, 6); // live + recent, 0.055 each

    // appending a new response is picked up by the tailer
    await appendFile(fx.transcriptFile(live), assistantLine({ id: 'a2', ts: iso(1_000), usage }) + '\n');
    const after = await waitFor(() =>
      store.getSnapshot().sessions.find((x) => x.sessionId === 'live' && x.tokens.output === 4000),
    );
    expect(after.costUSD).toBeCloseTo(0.11, 6);

    // registry file removed → session ends (registry polls every 2s)
    await rm(fx.registryFile(process.pid));
    const ended = await waitFor(
      () => store.getSnapshot().sessions.find((x) => x.sessionId === 'live' && !x.live),
      12_000,
    );
    expect(ended.status).toBe('ended');
  }, 20_000);

  it('offline: limits error, pricing unavailable, costs "—", session falls back to cost-state ≈', async () => {
    const { store } = await boot(
      [liveSession([assistantLine({ id: 'a1', ts: iso(60_000), usage }), costStateLine(1.23, iso(60_000))])],
      { fetch: makeFakeFetch({ fail: true }) },
    );
    const snap = await waitFor(() => {
      const s = store.getSnapshot();
      return s.limits.status === 'error' &&
        s.pricingStatus === 'unavailable' &&
        s.sessions[0]?.costUSD != null
        ? s
        : undefined;
    });
    expect(snap.costs.today.costUSD).toBeNull();
    expect(snap.sessions[0]).toMatchObject({ costUSD: 1.23, costApprox: true });
  });

  it('--no-usage-api → limits disabled and no usage request is made', async () => {
    const fetch = makeFakeFetch({ usage: usageFixture(Date.now()), pricing: PRICING_FIXTURE });
    const { store } = await boot([], { fetch, config: { usageApi: false } });
    await waitFor(() => store.getSnapshot().limits.status === 'disabled');
    expect(fetch.calls.some((u) => u.includes('oauth/usage'))).toBe(false);
  });

  it('missing credentials → limits no-credentials', async () => {
    // Pin the platform so this never reaches the developer's real macOS Keychain.
    const exec = vi.fn(async () => {
      throw new Error('keychain must not be queried');
    });
    const seen: string[] = [];
    const { store, fx: f } = await boot([], {
      credentials: false,
      readCredentials: (dir) => {
        seen.push(dir);
        return readCredentials(dir, { platform: 'linux', exec });
      },
    });
    await waitFor(() => store.getSnapshot().limits.status === 'no-credentials');
    expect(seen).toContain(f.claudeDir);
    expect(exec).not.toHaveBeenCalled();
  });

  it('missing Claude dir → claudeDirFound false and no sessions', async () => {
    const { store } = await boot([], { createClaudeDir: false });
    const s = store.getSnapshot();
    expect(s.claudeDirFound).toBe(false);
    expect(s.sessions).toEqual([]);
  });
});
