import { describe, expect, it } from 'vitest';
import { parseUsageResponse, UsagePoller } from './usageApi.js';

const R1 = '2026-10-11T16:14:00Z';

function pollerReturning(res: Response): UsagePoller {
  return new UsagePoller({
    claudeDir: '/home/u/.claude',
    intervalSeconds: 60,
    version: '0.1.0',
    enabled: true,
    onUpdate: () => {},
    deps: {
      fetch: (async () => res) as unknown as typeof fetch,
      readCredentials: async () => ({ kind: 'ok' as const, accessToken: 'tok' }),
      now: () => 0,
    },
  });
}

describe('UsagePoller Retry-After floor', () => {
  for (const ra of ['0', '5']) {
    it(`never polls sooner than 30s after a 429 with Retry-After: ${ra}`, async () => {
      const res = new Response('{}', { status: 429, headers: { 'retry-after': ra } });
      expect(await pollerReturning(res).pollOnce()).toBeGreaterThanOrEqual(30_000);
    });
  }
});

describe('parseUsageResponse limits[] tolerance', () => {
  it('skips non-object elements instead of dropping the whole array', () => {
    const r = parseUsageResponse({
      five_hour: null,
      limits: [null, 'junk', 7, { kind: 'session', percent: 42, resets_at: R1 }],
    });
    expect(r.block).toEqual({ label: '5h', percent: 42, resetsAt: Date.parse(R1) });
  });
});
