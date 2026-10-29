import { appendFile, rm } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRuntime, type Runtime } from './runtime.js';
import { DEFAULT_CONFIG } from '../config/schema.js';
import { assistantLine } from '../../test/helpers/transcript.js';
import {
  makeClaudeDir,
  makeFakeFetch,
  PRICING_FIXTURE,
  usageFixture,
  waitFor,
  type ClaudeFixture,
  type FixtureSession,
} from '../../test/helpers/claudeDir.js';

let rt: Runtime | undefined;
let fx: ClaudeFixture | undefined;
afterEach(async () => {
  rt?.stop();
  await fx?.cleanup();
  rt = undefined;
  fx = undefined;
});

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const usage = { input_tokens: 1000, output_tokens: 2000 };

function liveSession(lines: string[]): FixtureSession {
  return {
    pid: process.pid,
    sessionId: 'sess-live',
    cwd: '/work/proj',
    name: 'live-one',
    status: 'waiting',
    waitingFor: 'input needed',
    lines,
  };
}

describe('createRuntime', () => {
  it('discovers a live session, tails its transcript (deduped), prices it and loads limits', async () => {
    fx = await makeClaudeDir([
      // one API response split across two lines → must count once
      liveSession([
        assistantLine({ id: 'm1', requestId: 'r1', ts: iso(60_000), usage }),
        assistantLine({ id: 'm1', requestId: 'r1', ts: iso(60_000), usage }),
      ]),
    ]);
    rt = createRuntime({
      config: { ...DEFAULT_CONFIG, refreshMs: 250 },
      claudeDir: fx.claudeDir,
      cacheDir: fx.cacheDir,
      version: '0.1.0-test',
      fetch: makeFakeFetch({ usage: usageFixture(Date.now()), pricing: PRICING_FIXTURE }),
    });
    await rt.start();
    const store = rt.store;

    const s = await waitFor(() =>
      store
        .getSnapshot()
        .sessions.find((x) => x.sessionId === 'sess-live' && x.tokens.output > 0 && x.costUSD !== null),
    );
    expect(s).toMatchObject({ live: true, status: 'waiting', waitingFor: 'input needed', name: 'live-one' });
    expect(s.tokens.input).toBe(1000);
    expect(s.tokens.output).toBe(2000);
    expect(s.costUSD).toBeCloseTo(0.055, 6); // 1000×5e-6 + 2000×25e-6

    const snap = await waitFor(() => {
      const x = store.getSnapshot();
      return x.limits.status === 'ok' ? x : undefined;
    });
    expect(snap.limits.block?.percent).toBe(58);
    expect(snap.limits.weekly?.percent).toBe(31);
    expect(snap.pricingStatus).toBe('ok');
  });

  it('picks up lines appended to a live transcript after start', async () => {
    const session = liveSession([assistantLine({ id: 'm1', requestId: 'r1', ts: iso(60_000), usage })]);
    fx = await makeClaudeDir([session]);
    rt = createRuntime({
      config: { ...DEFAULT_CONFIG, refreshMs: 250 },
      claudeDir: fx.claudeDir,
      cacheDir: fx.cacheDir,
      version: '0.1.0-test',
      fetch: makeFakeFetch({ pricing: PRICING_FIXTURE }),
    });
    await rt.start();
    const store = rt.store;
    await waitFor(() => store.getSnapshot().sessions.find((x) => x.tokens.output === 2000));

    await appendFile(
      fx.transcriptFile(session),
      assistantLine({ id: 'm2', requestId: 'r2', ts: iso(1_000), usage }) + '\n',
    );
    const s = await waitFor(() => store.getSnapshot().sessions.find((x) => x.tokens.output === 4000));
    expect(s.tokens.input).toBe(2000);
  });

  it('marks a session ended when its registry entry disappears', async () => {
    const session = liveSession([assistantLine({ id: 'm1', requestId: 'r1', ts: iso(60_000), usage })]);
    fx = await makeClaudeDir([session]);
    rt = createRuntime({
      config: { ...DEFAULT_CONFIG, refreshMs: 250 },
      claudeDir: fx.claudeDir,
      cacheDir: fx.cacheDir,
      version: '0.1.0-test',
      fetch: makeFakeFetch({ fail: true }),
    });
    await rt.start();
    const store = rt.store;
    await waitFor(() => store.getSnapshot().sessions.find((x) => x.live));

    await rm(fx.registryFile(session.pid));
    const s = await waitFor(() =>
      store.getSnapshot().sessions.find((x) => x.sessionId === 'sess-live' && !x.live),
    );
    expect(s.tokens.output).toBe(2000);
  });

  it('never calls the usage API when disabled, and reports limits as disabled', async () => {
    fx = await makeClaudeDir([]);
    const fetch = makeFakeFetch({ usage: usageFixture(Date.now()), pricing: PRICING_FIXTURE });
    rt = createRuntime({
      config: { ...DEFAULT_CONFIG, refreshMs: 250, usageApi: false },
      claudeDir: fx.claudeDir,
      cacheDir: fx.cacheDir,
      version: '0.1.0-test',
      fetch,
    });
    await rt.start();
    const store = rt.store;
    await waitFor(() => store.getSnapshot().limits.status === 'disabled');
    expect(fetch.calls.some((u) => u.includes('oauth/usage'))).toBe(false);
  });

  it('reports a missing Claude dir and stays up', async () => {
    fx = await makeClaudeDir([], { createClaudeDir: false });
    rt = createRuntime({
      config: { ...DEFAULT_CONFIG, refreshMs: 250 },
      claudeDir: fx.claudeDir,
      cacheDir: fx.cacheDir,
      version: '0.1.0-test',
      fetch: makeFakeFetch({ fail: true }),
    });
    await rt.start();
    const store = rt.store;
    expect(store.getSnapshot().claudeDirFound).toBe(false);
    await waitFor(() => store.getSnapshot().scan.done);
    expect(store.getSnapshot().sessions).toEqual([]);
  });

  it('stop() is idempotent', async () => {
    fx = await makeClaudeDir([]);
    rt = createRuntime({
      config: DEFAULT_CONFIG,
      claudeDir: fx.claudeDir,
      cacheDir: fx.cacheDir,
      version: '0.1.0-test',
      fetch: makeFakeFetch({ fail: true }),
    });
    await rt.start();
    rt.stop();
    expect(() => rt?.stop()).not.toThrow();
  });
});

describe('createRuntime resources', () => {
  it('applyConfig forwards to store and poller; collectors stop on stop()', async () => {
    fx = await makeClaudeDir([]);
    const setTimeoutSpy: string[] = [];
    rt = createRuntime({
      config: { ...DEFAULT_CONFIG, refreshMs: 250, usageApi: false },
      claudeDir: fx.claudeDir,
      cacheDir: fx.cacheDir,
      version: '0.1.0-test',
      fetch: makeFakeFetch({ usage: usageFixture(Date.now()), pricing: PRICING_FIXTURE }),
      systemMonitor: {
        setTimeout: (fn, ms) => {
          setTimeoutSpy.push(`set:${ms}`);
          return setTimeout(fn, 1_000_000);
        },
        clearTimeout: (h) => {
          setTimeoutSpy.push('clear');
          clearTimeout(h as NodeJS.Timeout);
        },
      },
      procStats: false,
    });
    const spy = vi.spyOn(rt.store, 'setOptions');
    await rt.start();
    rt.applyConfig({ refreshMs: 500, endedWindowHours: 3, theme: 'mono' });
    expect(spy).toHaveBeenCalledWith({ refreshMs: 500, endedWindowHours: 3 });
    rt.applyConfig({ usagePollSeconds: 120 });
    expect(spy).toHaveBeenCalledTimes(1);
    await waitFor(() => setTimeoutSpy.some((x) => x.startsWith('set:')));
    rt.stop();
    expect(setTimeoutSpy).toContain('clear');
  });

  it('samples live pids into the store', async () => {
    fx = await makeClaudeDir([liveSession([])]);
    vi.useFakeTimers({ toFake: ['setInterval'] });
    const sample = vi.fn(async (_cmd: string, _args: string[]) => '');
    rt = createRuntime({
      config: { ...DEFAULT_CONFIG, refreshMs: 250, usageApi: false },
      claudeDir: fx.claudeDir,
      cacheDir: fx.cacheDir,
      version: '0.1.0-test',
      fetch: makeFakeFetch({ usage: usageFixture(Date.now()), pricing: PRICING_FIXTURE }),
      systemMonitor: false,
      procStats: { platform: 'darwin', exec: sample, now: Date.now },
    });
    await rt.start();
    await vi.advanceTimersByTimeAsync(2_100);
    vi.useRealTimers();
    expect(sample).toHaveBeenCalled();
    expect(String(sample.mock.calls[0]?.[1])).toContain(String(process.pid));
  });
});
