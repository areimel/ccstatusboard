// Shared contract for ccstatusboard. Every module imports types from here.
// All timestamps are epoch milliseconds.

export interface TokenCounts {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
}

/** One deduplicatable API response's usage. */
export interface UsageRecord {
  /** Dedup key: `${messageId}:${requestId}` or `${messageId}`. */
  key: string;
  sessionId: string;
  timestamp: number;
  model: string;
  tokens: TokenCounts;
  /** true for subagent / sidechain records (excluded from context calc). */
  isSidechain: boolean;
}

export type TranscriptEvent =
  | { kind: 'usage'; record: UsageRecord; contextTokens: number }
  | { kind: 'compact'; timestamp: number; postTokens: number; isSidechain: boolean }
  | { kind: 'costState'; timestamp: number; totalCostUSD: number }
  | { kind: 'title'; timestamp: number; title: string; source: 'ai-title' | 'agent-name' }
  | { kind: 'permissionMode'; timestamp: number; mode: string }
  | {
      kind: 'meta';
      timestamp: number;
      isSidechain: boolean;
      gitBranch?: string;
      cwd?: string;
      version?: string;
    };

/** Parsed `<claude>/sessions/<pid>.json`. */
export interface RegistryEntry {
  pid: number;
  sessionId: string;
  cwd: string;
  startedAt?: number;
  procStart?: string;
  version?: string;
  kind?: string;
  name?: string;
  /** Usually 'busy' | 'idle' | 'waiting'; unknown values kept verbatim. */
  status?: string;
  waitingFor?: string;
  updatedAt?: number;
  statusUpdatedAt?: number;
}

export interface ModelPrice {
  /** USD per token. */
  input: number;
  output: number;
  cacheWrite: number;
  cacheWrite1h?: number;
  cacheRead: number;
  maxInputTokens?: number;
}

export type PriceLookup = (model: string) => ModelPrice | undefined;
export type PricingStatus = 'loading' | 'ok' | 'stale' | 'unavailable';

export interface Limit {
  label: string;
  /** 0–100 */
  percent: number;
  resetsAt?: number;
}

export interface ExtraUsage {
  enabled: boolean;
  limitAmount?: number;
  usedAmount?: number;
  percent?: number;
  currency?: string;
}

export type LimitsStatus = 'loading' | 'ok' | 'stale' | 'no-credentials' | 'expired' | 'error' | 'disabled';

export interface LimitsState {
  status: LimitsStatus;
  block?: Limit;
  weekly?: Limit;
  perModelWeekly: Limit[];
  extra?: ExtraUsage;
  fetchedAt?: number;
  error?: string;
}

export interface ModelTotals {
  costUSD: number | null;
  tokens: TokenCounts;
}

export interface WindowTotals extends ModelTotals {
  byModel: Record<string, ModelTotals>;
}

export interface TimeWindow {
  start: number;
  end: number;
}

export interface ScanProgress {
  done: boolean;
  filesDone: number;
  filesTotal: number;
}

export type DisplayStatus = 'waiting' | 'busy' | 'idle' | 'ended';

/** An active subagent of a live session. */
export interface SubagentView {
  id: string;
  /** agent type, e.g. 'Explore' */
  name: string;
  lastActivity: number;
}

export interface SessionView {
  sessionId: string;
  pid?: number;
  live: boolean;
  status: DisplayStatus;
  /** Raw registry status if it was not one of busy/idle/waiting. */
  rawStatus?: string;
  waitingFor?: string;
  activeAgents: number;
  agentNames: string[];
  /** Active subagents of a live session (empty otherwise). */
  subagents: SubagentView[];
  name: string;
  cwd?: string;
  /** Git repo name (or cwd basename) the session runs in. */
  project?: string;
  gitBranch?: string;
  model?: string;
  contextTokens?: number;
  contextWindow?: number;
  contextPercent?: number;
  costUSD: number | null;
  /** true when costUSD came from transcript cost-state fallback. */
  costApprox: boolean;
  tokens: TokenCounts;
  byModel: Record<string, ModelTotals>;
  startedAt?: number;
  lastActivity: number;
  permissionMode?: string;
  version?: string;
  /** Current CPU usage of the session's main process (100 = one full core). */
  cpuPercent?: number;
  /** Resident memory of the session's main process, in bytes. */
  memBytes?: number;
}

/** Machine-wide resource sample emitted by the system monitor. */
export interface SystemStats {
  sampledAt: number;
  /** total and perCore are 0–100. */
  cpu: { total: number; perCore: number[] };
  /** Bytes. */
  mem: { used: number; total: number };
  swap: { used: number; total: number };
  disk: { used: number; total: number; mount: string };
  /** Bytes per second, summed over non-loopback interfaces. */
  net: { rxPerSec: number; txPerSec: number };
  load: [number, number, number];
}

/** Per-process resource sample, keyed by pid in maps. */
export interface ProcStats {
  /** 100 = one full core. */
  cpuPercent: number;
  rssBytes: number;
}

/** Rolling history used for System panel sparklines, oldest first. */
export interface SystemHistory {
  cpu: number[];
  rx: number[];
  tx: number[];
}

/** One observation of a limit's utilization, used for burn-rate slopes. */
export interface LimitSample {
  t: number;
  pct: number;
}

export type BurnBand = 'under' | 'near' | 'over' | 'critical';
export type BurnWindowKind = 'block' | 'week';

export interface BurnProjection {
  currentPct: number;
  /** Percentage points per hour. */
  ratePctPerHour: number;
  /** Projected utilization at window reset. */
  projectedPct: number;
  band: BurnBand;
  /** Epoch ms when the limit is projected to be hit; undefined = not projected to hit. */
  hitAt?: number;
  /** Fraction (0–100) of the window elapsed at hitAt. */
  hitWindowPct?: number;
}

export interface Snapshot {
  now: number;
  claudeDirFound: boolean;
  claudeDir: string;
  limits: LimitsState;
  costs: {
    block: WindowTotals;
    today: WindowTotals;
    week: WindowTotals;
    month: WindowTotals;
    burnRatePerHour: number | null;
    /** 24 hourly cost buckets, oldest first. */
    hourlySparkline: number[];
  };
  pricingStatus: PricingStatus;
  unknownModels: string[];
  scan: ScanProgress;
  sessions: SessionView[];
  warnings: string[];
  system?: SystemStats;
  systemHistory: SystemHistory;
  burn: { block?: BurnProjection; week?: BurnProjection };
}

/** Order matters: it is the live theme cycle order. */
export const THEME_NAMES = [
  'default',
  'mono',
  'dracula',
  'solarized',
  'solarized-light',
  'monokai',
  'gruvbox',
  'nord',
  'tokyonight',
  'catppuccin',
  'onedark',
  'cyberpunk',
] as const;
export type ThemeName = (typeof THEME_NAMES)[number];
export const COLUMN_KEYS = [
  'status',
  'project',
  'name',
  'model',
  'branch',
  'ctx',
  'cpu',
  'mem',
  'cost',
  'last',
  'uptime',
] as const;
export type ColumnKey = (typeof COLUMN_KEYS)[number];
export const SORT_KEYS = ['project', 'status', 'activity', 'cost', 'ctx', 'name'] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export interface Config {
  theme: ThemeName;
  refreshMs: number;
  usagePollSeconds: number;
  /** Hours an exited session stays listed; 0 removes it on exit. */
  endedWindowHours: number;
  /** Live sessions idle longer than this are dimmed. */
  idleCutoffMinutes: number;
  columns: ColumnKey[];
  sort: SortKey;
  showDetail: boolean;
  claudeDir: string | null;
  usageApi: boolean;
  /** Monthly subscription price in USD; drives the plan value ratio. null = unset. */
  subscriptionUSD: number | null;
  showSystem: boolean;
}

export const ZERO_TOKENS: TokenCounts = Object.freeze({
  input: 0,
  output: 0,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
  cacheRead: 0,
}) as TokenCounts;

export function addTokens(a: TokenCounts, b: TokenCounts): TokenCounts {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheWrite5m: a.cacheWrite5m + b.cacheWrite5m,
    cacheWrite1h: a.cacheWrite1h + b.cacheWrite1h,
    cacheRead: a.cacheRead + b.cacheRead,
  };
}

export function emptySystemHistory(): SystemHistory {
  return { cpu: [], rx: [], tx: [] };
}

export function emptyWindowTotals(): WindowTotals {
  return { costUSD: 0, tokens: { ...ZERO_TOKENS }, byModel: {} };
}
