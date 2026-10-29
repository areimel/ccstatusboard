import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LimitsState } from '../domain/types.js';
import type { CredentialsResult } from './credentials.js';
import { parseUsageResponse, USAGE_URL, UsagePoller, type UsagePollerDeps } from './usageApi.js';

const NOW = Date.parse('2026-10-11T14:00:00Z');
const R1 = '2026-10-11T16:14:00Z';
const R2 = '2026-10-15T09:00:00Z';

describe('parseUsageResponse', () => {
  it('reads the legacy flat bucket shape', () => {
    const r = parseUsageResponse({
      five_hour: { utilization: 58, resets_at: R1 },
      seven_day: { utilization: 31, resets_at: R2 },
      seven_day_opus: { utilization: 22, resets_at: R2 },
      seven_day_sonnet: null,
    });
    expect(r.block).toEqual({ label: '5h', percent: 58, resetsAt: Date.parse(R1) });
    expect(r.weekly).toEqual({ label: 'Week', percent: 31, resetsAt: Date.parse(R2) });
    expect(r.perModelWeekly).toEqual([{ label: 'Opus', percent: 22, resetsAt: Date.parse(R2) }]);
  });

  it('reads the newer limits[] shape when flat buckets are null', () => {
    const r = parseUsageResponse({
      five_hour: null,
      seven_day: null,
      limits: [
        { kind: 'session', percent: 42, resets_at: R1 },
        { kind: 'weekly_all', percent: 17, resets_at: R2 },
        {
          kind: 'weekly_scoped',
          percent: 9,
          resets_at: R2,
          scope: { model: { display_name: 'Claude Sonnet' } },
        },
      ],
    });
    expect(r.block).toEqual({ label: '5h', percent: 42, resetsAt: Date.parse(R1) });
    expect(r.weekly).toEqual({ label: 'Week', percent: 17, resetsAt: Date.parse(R2) });
    expect(r.perModelWeekly).toEqual([{ label: 'Sonnet', percent: 9, resetsAt: Date.parse(R2) }]);
  });

  it('ignores placeholder limits[] entries (0% with no reset and no model) instead of showing phantom 0%', () => {
    const r = parseUsageResponse({
      five_hour: null,
      limits: [
        { kind: 'session', percent: 0, resets_at: null },
        { kind: 'weekly_all', percent: null },
      ],
    });
    expect(r.block).toBeUndefined();
    expect(r.weekly).toBeUndefined();
    expect(r.perModelWeekly).toEqual([]);
  });

  it('prefers flat buckets over limits[] entries', () => {
    const r = parseUsageResponse({
      five_hour: { utilization: 58, resets_at: R1 },
      limits: [{ kind: 'session', percent: 99, resets_at: R2 }],
    });
    expect(r.block).toEqual({ label: '5h', percent: 58, resetsAt: Date.parse(R1) });
  });

  it('takes resets_at from limits[] when the flat bucket lacks it', () => {
    const r = parseUsageResponse({
      five_hour: { utilization: 58 },
      limits: [{ kind: 'session', percent: 99, resets_at: R1 }],
    });
    expect(r.block).toEqual({ label: '5h', percent: 58, resetsAt: Date.parse(R1) });
  });

  it('keeps weekly_scoped per-model entries reporting 0% with no reset (real data)', () => {
    const r = parseUsageResponse({
      limits: [
        { kind: 'weekly_scoped', percent: 0, resets_at: null, scope: { model: { display_name: 'Fable' } } },
      ],
    });
    expect(r.perModelWeekly).toEqual([{ label: 'Fable', percent: 0 }]);
  });

  it('does not duplicate a model reported both as a legacy bucket and weekly_scoped', () => {
    const r = parseUsageResponse({
      seven_day_opus: { utilization: 22, resets_at: R2 },
      limits: [
        { kind: 'weekly_scoped', percent: 50, resets_at: R2, scope: { model: { display_name: 'Opus' } } },
      ],
    });
    expect(r.perModelWeekly).toEqual([{ label: 'Opus', percent: 22, resetsAt: Date.parse(R2) }]);
  });

  it('uses the raw display name for unknown model families', () => {
    const r = parseUsageResponse({
      limits: [
        { kind: 'weekly_scoped', percent: 3, resets_at: R2, scope: { model: { display_name: 'Nova' } } },
      ],
    });
    expect(r.perModelWeekly).toEqual([{ label: 'Nova', percent: 3, resetsAt: Date.parse(R2) }]);
  });

  it('converts extra usage cents to amounts', () => {
    const r = parseUsageResponse({
      extra_usage: {
        is_enabled: true,
        monthly_limit: 5000,
        used_credits: 1234,
        utilization: 24.68,
        currency: 'USD',
      },
    });
    expect(r.extra).toEqual({
      enabled: true,
      limitAmount: 50,
      usedAmount: 12.34,
      percent: 24.68,
      currency: 'USD',
    });
  });

  it('never throws on garbage', () => {
    for (const bad of [null, undefined, 'x', 42, [], { five_hour: 'bad', limits: 'nope' }]) {
      expect(parseUsageResponse(bad)).toEqual({ perModelWeekly: [] });
    }
  });
});

// ---------- poller ----------

const okBody = {
  five_hour: { utilization: 58, resets_at: R1 },
  seven_day: { utilization: 31, resets_at: R2 },
};

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function makePoller(
  responses: Array<Response | Error>,
  opts: { creds?: CredentialsResult; intervalSeconds?: number; enabled?: boolean } = {},
) {
  const updates: LimitsState[] = [];
  let t = NOW;
  const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    const next = responses.shift();
    if (!next) throw new Error('no more responses');
    if (next instanceof Error) throw next;
    return next;
  });
  const deps: UsagePollerDeps = {
    fetch: fetchMock as unknown as typeof fetch,
    readCredentials: vi.fn(async () => opts.creds ?? { kind: 'ok' as const, accessToken: 'tok-123' }),
    now: () => t,
  };
  const poller = new UsagePoller({
    claudeDir: '/home/u/.claude',
    intervalSeconds: opts.intervalSeconds ?? 60,
    version: '0.1.0',
    enabled: opts.enabled ?? true,
    deps,
    onUpdate: (s) => updates.push(s),
  });
  return { poller, updates, fetchMock, deps, advance: (ms: number) => (t += ms) };
}

describe('UsagePoller.pollOnce', () => {
  it('fetches with OAuth headers and emits ok state', async () => {
    const { poller, updates, fetchMock } = makePoller([jsonResponse(okBody)]);
    const delay = await poller.pollOnce();
    expect(delay).toBe(60_000);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(USAGE_URL);
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe('Bearer tok-123');
    expect(headers.get('anthropic-beta')).toBe('oauth-2025-04-20');
    expect(headers.get('user-agent')).toBe('ccstatusboard/0.1.0');
    expect(updates.at(-1)).toMatchObject({
      status: 'ok',
      fetchedAt: NOW,
      block: { percent: 58 },
      weekly: { percent: 31 },
    });
  });

  it('enforces a 30s minimum interval', async () => {
    const { poller } = makePoller([jsonResponse(okBody)], { intervalSeconds: 10 });
    expect(await poller.pollOnce()).toBe(30_000);
  });

  it('reports no-credentials without calling fetch', async () => {
    const { poller, updates, fetchMock } = makePoller([], { creds: { kind: 'missing' } });
    expect(await poller.pollOnce()).toBe(60_000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(updates.at(-1)).toEqual({ status: 'no-credentials', perModelWeekly: [] });
  });

  it('reports expired without calling fetch', async () => {
    const { poller, updates, fetchMock } = makePoller([], { creds: { kind: 'expired', expiresAt: NOW - 1 } });
    await poller.pollOnce();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(updates.at(-1)).toMatchObject({ status: 'expired', perModelWeekly: [] });
  });

  it('honors Retry-After on 429, defaulting to 300s', async () => {
    const { poller } = makePoller([jsonResponse({}, 429, { 'retry-after': '120' }), jsonResponse({}, 429)]);
    expect(await poller.pollOnce()).toBe(120_000);
    expect(await poller.pollOnce()).toBe(300_000);
  });

  it('backs off exponentially from 60s and caps at 600s', async () => {
    const { poller, updates } = makePoller([
      jsonResponse({}, 500),
      jsonResponse({}, 500),
      new Error('ECONNRESET'),
      jsonResponse({}, 503),
      jsonResponse({}, 500),
      jsonResponse({}, 500),
    ]);
    const delays: number[] = [];
    for (let i = 0; i < 6; i++) delays.push(await poller.pollOnce());
    expect(delays).toEqual([60_000, 120_000, 240_000, 480_000, 600_000, 600_000]);
    expect(updates.at(-1)).toMatchObject({ status: 'error', perModelWeekly: [] });
  });

  it('retains last good values as stale on failure, and resets backoff after success', async () => {
    const { poller, updates, advance } = makePoller([
      jsonResponse(okBody),
      jsonResponse({}, 500),
      jsonResponse({}, 429, { 'retry-after': '90' }),
      jsonResponse(okBody),
      jsonResponse({}, 500),
    ]);
    await poller.pollOnce();
    advance(60_000);
    expect(await poller.pollOnce()).toBe(60_000);
    expect(updates.at(-1)).toMatchObject({ status: 'stale', fetchedAt: NOW, block: { percent: 58 } });
    expect(await poller.pollOnce()).toBe(90_000);
    expect(updates.at(-1)).toMatchObject({ status: 'stale', block: { percent: 58 } });
    expect(await poller.pollOnce()).toBe(60_000);
    expect(updates.at(-1)).toMatchObject({ status: 'ok' });
    expect(await poller.pollOnce()).toBe(60_000); // backoff restarted at 60s
  });

  it('treats a non-object JSON body as an error', async () => {
    const { poller, updates } = makePoller([jsonResponse('nope')]);
    expect(await poller.pollOnce()).toBe(60_000);
    expect(updates.at(-1)).toMatchObject({ status: 'error' });
  });
});

describe('UsagePoller.start/stop', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits disabled once and never fetches when disabled', async () => {
    const { poller, updates, fetchMock } = makePoller([], { enabled: false });
    poller.start();
    await Promise.resolve();
    expect(updates).toEqual([{ status: 'disabled', perModelWeekly: [] }]);
    expect(fetchMock).not.toHaveBeenCalled();
    poller.stop();
  });

  it('emits loading, polls immediately, and reschedules with the returned delay', async () => {
    vi.useFakeTimers();
    const { poller, updates, fetchMock } = makePoller([jsonResponse(okBody), jsonResponse(okBody)]);
    poller.start();
    expect(updates[0]).toEqual({ status: 'loading', perModelWeekly: [] });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    poller.stop();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('UsagePoller.setIntervalSeconds', () => {
  it('re-arms a pending regular wait with the new interval', async () => {
    const timers: Array<{ fn: () => void; ms: number; cleared: boolean }> = [];
    const { deps, advance } = makePoller([jsonResponse(okBody)], { intervalSeconds: 600 });
    deps.setTimeout = (fn, ms) => {
      const h = { fn, ms, cleared: false };
      timers.push(h);
      return h;
    };
    deps.clearTimeout = (h) => {
      (h as { cleared: boolean }).cleared = true;
    };
    const p2 = new UsagePoller({
      claudeDir: '/home/u/.claude',
      intervalSeconds: 600,
      version: '0.1.0',
      enabled: true,
      deps,
      onUpdate: () => undefined,
    });
    p2.start();
    timers[0]!.fn(); // first poll
    await vi.waitFor(() => expect(timers).toHaveLength(2));
    expect(timers[1]!.ms).toBe(600_000);
    advance(10_000);
    p2.setIntervalSeconds(30);
    expect(timers[1]!.cleared).toBe(true);
    expect(timers[2]!.ms).toBe(20_000);
    p2.stop();
  });
});
