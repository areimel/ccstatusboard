import { emptyWindowTotals, ZERO_TOKENS, type SessionView, type Snapshot } from '../../src/domain/types.js';

export const NOW = Date.parse('2026-10-11T14:32:07Z');

export function makeSession(over: Partial<SessionView> = {}): SessionView {
  return {
    sessionId: 'sess-1',
    pid: 1234,
    live: true,
    status: 'idle',
    activeAgents: 0,
    agentNames: [],
    name: 'proj',
    cwd: '/work/proj',
    gitBranch: 'main',
    model: 'claude-opus-5-5',
    contextTokens: 120_000,
    contextWindow: 200_000,
    contextPercent: 60,
    costUSD: 4.2,
    costApprox: false,
    tokens: { ...ZERO_TOKENS },
    byModel: {},
    startedAt: NOW - 12 * 60_000,
    lastActivity: NOW - 3_000,
    ...over,
  };
}

export function makeSnapshot(over: Partial<Snapshot> = {}): Snapshot {
  return {
    now: NOW,
    claudeDirFound: true,
    claudeDir: '/home/u/.claude',
    limits: {
      status: 'ok',
      block: { label: '5h', percent: 58, resetsAt: NOW + (2 * 60 + 14) * 60_000 },
      weekly: { label: 'Week', percent: 31, resetsAt: NOW + 3 * 86_400_000 },
      perModelWeekly: [{ label: 'Opus', percent: 22 }],
      fetchedAt: NOW - 10_000,
    },
    costs: {
      block: { ...emptyWindowTotals(), costUSD: 12.4 },
      today: { ...emptyWindowTotals(), costUSD: 18.2 },
      week: { ...emptyWindowTotals(), costUSD: 96.1 },
      month: { ...emptyWindowTotals(), costUSD: 412.75 },
      burnRatePerHour: 4.1,
      hourlySparkline: Array.from({ length: 24 }, (_, i) => (i % 7) + 1),
    },
    pricingStatus: 'ok',
    unknownModels: [],
    scan: { done: true, filesDone: 10, filesTotal: 10 },
    sessions: [makeSession()],
    warnings: [],
    ...over,
  };
}
