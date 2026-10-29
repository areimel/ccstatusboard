import {
  emptySystemHistory,
  emptyWindowTotals,
  ZERO_TOKENS,
  type SessionView,
  type Snapshot,
} from '../../src/domain/types.js';

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
    systemHistory: emptySystemHistory(),
    burn: {},
    ...over,
  };
}

const modelCost = (costUSD: number) => ({ costUSD, tokens: { ...ZERO_TOKENS } });

/** Worst-case layout fixture: 6 priced models, 7 agents, long text, expired limits with stale values. */
export function makeOverflowSnapshot(): Snapshot {
  const selected = makeSession({
    sessionId: 'big',
    name: 'ccstatusboard-design-spec-with-a-long-name',
    cwd: '/home/someone/code_projects/personal-projects/a-really-long-project-directory-name',
    status: 'waiting',
    waitingFor: 'permission to run a long shell command',
    permissionMode: 'acceptEdits',
    version: '2.1.296',
    lastActivity: NOW,
    costUSD: 27.07,
    costApprox: true,
    activeAgents: 7,
    agentNames: [...Array<string>(5).fill('general-purpose'), 'Explore', 'Plan'],
    tokens: {
      input: 1_234_000,
      output: 356_000,
      cacheWrite5m: 2_300_000,
      cacheWrite1h: 0,
      cacheRead: 45_600_000,
    },
    byModel: {
      'claude-opus-4-6': modelCost(5),
      'claude-sonnet-4-5': modelCost(2),
      'claude-haiku-4-5': modelCost(1),
      'claude-fable-5': modelCost(3),
      'claude-opus-5-5': modelCost(4),
      'claude-sonnet-5-5': modelCost(1.5),
    },
  });
  return makeSnapshot({
    sessions: [
      selected,
      ...Array.from({ length: 34 }, (_, i) =>
        makeSession({ sessionId: `s${i}`, name: `sess${i}`, lastActivity: NOW - (i + 1) * 1_000 }),
      ),
    ],
    limits: {
      status: 'expired',
      fetchedAt: NOW - 600_000,
      block: { label: '5h', percent: 26, resetsAt: NOW + 3_000_000 },
      weekly: { label: 'Week', percent: 4, resetsAt: NOW + 300_000_000 },
      perModelWeekly: [{ label: 'Fable', percent: 0, resetsAt: NOW + 300_000_000 }],
    },
  });
}
