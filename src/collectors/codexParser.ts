// Codex rollout formats are versioned internals. Retain only monitoring fields;
// never cache prompt, tool-output, reasoning, or credential contents.
import type { DisplayStatus, Limit, LimitsState, TokenCounts, TranscriptEvent } from '../domain/types.js';

type Obj = Record<string, unknown>;
export interface CodexUsage {
  input: number;
  cached: number;
  cacheWrite: number;
  output: number;
  reasoning: number;
  total: number;
}
export interface CodexObservation {
  timestamp: number;
  kind: 'session' | 'context' | 'tokens' | 'response' | 'status';
  sessionId?: string;
  parentSessionId?: string;
  forkedFromId?: string;
  cwd?: string;
  version?: string;
  gitBranch?: string;
  model?: string;
  startedAt?: number;
  contextWindow?: number;
  turnId?: string;
  responseId?: string;
  usage?: CodexUsage;
  lastUsage?: CodexUsage;
  limits?: Limit[];
  limitBucket?: string;
  status?: DisplayStatus;
}

export interface CodexSessionMetadata {
  cwd?: string;
  version?: string;
  gitBranch?: string;
  model?: string;
  contextWindow?: number;
  contextTokens?: number;
  startedAt?: number;
  lastActivity: number;
  observedStatus: DisplayStatus;
  accountingIncomplete: boolean;
  parentSessionId?: string;
  isSidechain: boolean;
}

const obj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);
const count = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : undefined;
const positive = (v: unknown): number | undefined => {
  const n = count(v);
  return n !== undefined && n > 0 ? n : undefined;
};
const timestamp = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

function parseUsage(v: unknown): CodexUsage | undefined {
  if (!obj(v)) return undefined;
  const input = count(v.input_tokens);
  const output = count(v.output_tokens);
  const cached = v.cached_input_tokens === undefined ? 0 : count(v.cached_input_tokens);
  const cacheWrite = v.cache_write_input_tokens === undefined ? 0 : count(v.cache_write_input_tokens);
  const reasoning = v.reasoning_output_tokens === undefined ? 0 : count(v.reasoning_output_tokens);
  const total = count(v.total_tokens);
  if ([input, output, cached, cacheWrite, reasoning, total].some((n) => n === undefined)) return undefined;
  if (cached! + cacheWrite! > input! || reasoning! > output!) return undefined;
  return {
    input: input!,
    cached: cached!,
    cacheWrite: cacheWrite!,
    output: output!,
    reasoning: reasoning!,
    total: total!,
  };
}

function parseLimits(v: unknown): { limits?: Limit[]; limitBucket?: string } {
  if (!obj(v)) return {};
  const bucket = str(v.limit_id) ?? 'codex';
  const name = str(v.limit_name) ?? bucket;
  const limits: Limit[] = [];
  for (const key of ['primary', 'secondary'] as const) {
    const window = v[key];
    if (!obj(window) || typeof window.used_percent !== 'number' || !Number.isFinite(window.used_percent))
      continue;
    if (window.used_percent < 0 || window.used_percent > 100) continue;
    const minutes = positive(window.window_minutes);
    const reset = positive(window.resets_at);
    limits.push({
      id: `${bucket}:${key}`,
      label: `${name} ${key}`,
      percent: window.used_percent,
      ...(minutes === undefined ? {} : { windowMinutes: minutes, durationMs: minutes * 60_000 }),
      ...(reset === undefined ? {} : { resetsAt: reset * 1000 }),
    });
  }
  return { limits, limitBucket: bucket };
}

/** Parse a record without retaining text unrelated to usage monitoring. */
export function parseCodexRecord(raw: unknown): CodexObservation | undefined {
  if (!obj(raw) || !obj(raw.payload)) return undefined;
  const t = timestamp(raw.timestamp);
  if (t === undefined) return undefined;
  const p = raw.payload;
  if (raw.type === 'session_meta') {
    const sessionId = str(p.id);
    if (!sessionId) return undefined;
    const source =
      obj(p.source) && obj(p.source.subagent) && obj(p.source.subagent.thread_spawn)
        ? p.source.subagent.thread_spawn
        : undefined;
    return {
      kind: 'session',
      timestamp: t,
      sessionId,
      parentSessionId: str(p.parent_thread_id) ?? (source ? str(source.parent_thread_id) : undefined),
      forkedFromId: str(p.forked_from_id),
      cwd: str(p.cwd),
      version: str(p.cli_version),
      gitBranch: obj(p.git) ? str(p.git.branch) : undefined,
      startedAt: timestamp(p.timestamp) ?? t,
    };
  }
  if (raw.type === 'turn_context') {
    return { kind: 'context', timestamp: t, turnId: str(p.turn_id), model: str(p.model), cwd: str(p.cwd) };
  }
  if (raw.type === 'token_usage_record') {
    const sessionId = str(p.thread_id);
    const responseId = str(p.response_id);
    const usage = parseUsage(p.usage);
    if (!sessionId || !responseId || !usage) return undefined;
    return { kind: 'response', timestamp: t, sessionId, responseId, turnId: str(p.turn_id), usage };
  }
  if (raw.type !== 'event_msg') return undefined;
  if (p.type === 'token_count') {
    const info = obj(p.info) ? p.info : undefined;
    return {
      kind: 'tokens',
      timestamp: t,
      usage: info ? parseUsage(info.total_token_usage) : undefined,
      lastUsage: info ? parseUsage(info.last_token_usage) : undefined,
      contextWindow: info ? positive(info.model_context_window) : undefined,
      ...parseLimits(p.rate_limits),
    };
  }
  const statuses: Record<string, DisplayStatus> = {
    task_started: 'busy',
    turn_started: 'busy',
    task_complete: 'idle',
    turn_complete: 'idle',
    turn_aborted: 'idle',
    exec_approval_request: 'waiting',
    apply_patch_approval_request: 'waiting',
  };
  const status =
    str(p.type) && Object.hasOwn(statuses, p.type as string) ? statuses[p.type as string] : undefined;
  return status === undefined ? undefined : { kind: 'status', timestamp: t, status, turnId: str(p.turn_id) };
}

export function parseCodexLine(line: string): CodexObservation | undefined {
  try {
    return parseCodexRecord(JSON.parse(line));
  } catch {
    return undefined;
  }
}

/** Cache data is untrusted too: rebuild only validated, explicitly permitted fields. */
export function decodeCodexObservation(value: unknown): CodexObservation | undefined {
  if (
    !obj(value) ||
    !['session', 'context', 'tokens', 'response', 'status'].includes(String(value.kind)) ||
    typeof value.timestamp !== 'number' ||
    !Number.isFinite(value.timestamp)
  )
    return undefined;
  const result: CodexObservation = {
    kind: value.kind as CodexObservation['kind'],
    timestamp: value.timestamp,
  };
  for (const key of [
    'sessionId',
    'parentSessionId',
    'forkedFromId',
    'cwd',
    'version',
    'gitBranch',
    'model',
    'turnId',
    'responseId',
    'limitBucket',
  ] as const) {
    if (value[key] !== undefined) {
      if (!str(value[key])) return undefined;
      result[key] = value[key] as string;
    }
  }
  for (const key of ['startedAt', 'contextWindow'] as const) {
    if (value[key] !== undefined) {
      if (count(value[key]) === undefined) return undefined;
      result[key] = value[key] as number;
    }
  }
  for (const key of ['usage', 'lastUsage'] as const) {
    if (value[key] === undefined) continue;
    const u = value[key];
    if (!obj(u)) return undefined;
    const valid = parseUsage({
      input_tokens: u.input,
      cached_input_tokens: u.cached,
      cache_write_input_tokens: u.cacheWrite,
      output_tokens: u.output,
      reasoning_output_tokens: u.reasoning,
      total_tokens: u.total,
    });
    if (!valid) return undefined;
    result[key] = valid;
  }
  if (value.status !== undefined) {
    if (!['busy', 'idle', 'waiting', 'unknown', 'ended'].includes(String(value.status))) return undefined;
    result.status = value.status as DisplayStatus;
  }
  if (value.limits !== undefined) {
    if (!Array.isArray(value.limits)) return undefined;
    result.limits = [];
    for (const limit of value.limits) {
      if (
        !obj(limit) ||
        !str(limit.label) ||
        typeof limit.percent !== 'number' ||
        !Number.isFinite(limit.percent) ||
        limit.percent < 0 ||
        limit.percent > 100
      )
        return undefined;
      const valid: Limit = { label: limit.label as string, percent: limit.percent };
      if (limit.id !== undefined) {
        if (!str(limit.id)) return undefined;
        valid.id = limit.id as string;
      }
      for (const key of ['windowMinutes', 'durationMs', 'resetsAt', 'observedAt'] as const) {
        if (limit[key] === undefined) continue;
        if (count(limit[key]) === undefined) return undefined;
        valid[key] = limit[key] as number;
      }
      result.limits.push(valid);
    }
  }
  if (result.kind === 'session' && !result.sessionId) return undefined;
  if (result.kind === 'response' && (!result.sessionId || !result.responseId || !result.usage))
    return undefined;
  return result;
}

function tokens(usage: CodexUsage): TokenCounts {
  return {
    input: usage.input - usage.cached - usage.cacheWrite,
    output: usage.output,
    cacheRead: usage.cached,
    cacheWrite5m: usage.cacheWrite,
    cacheWrite1h: 0,
  };
}

const ZERO_USAGE: CodexUsage = { input: 0, cached: 0, cacheWrite: 0, output: 0, reasoning: 0, total: 0 };
const usageKeys = Object.keys(ZERO_USAGE) as (keyof CodexUsage)[];
function difference(next: CodexUsage, previous: CodexUsage): CodexUsage | undefined {
  if (usageKeys.some((key) => next[key] < previous[key])) return undefined;
  const result = { ...ZERO_USAGE };
  for (const key of usageKeys) result[key] = next[key] - previous[key];
  // Cache accounting must remain a subset even if a provider revises breakdowns.
  return result.cached + result.cacheWrite <= result.input && result.reasoning <= result.output
    ? result
    : undefined;
}

export interface CodexProjectionOptions {
  sessionId: string;
  /** Available parent history proves which turn ids were inherited by a fork. */
  parentTurnIds?: ReadonlySet<string>;
  incomplete?: boolean;
}

/** Rebuild a complete session projection so later response records replace provisional snapshots. */
export function projectCodexSession(
  observations: readonly CodexObservation[],
  options: CodexProjectionOptions,
): { events: TranscriptEvent[]; metadata: CodexSessionMetadata } {
  const ownMeta = observations.find((o) => o.kind === 'session' && o.sessionId === options.sessionId);
  const forked = ownMeta?.forkedFromId !== undefined || ownMeta?.parentSessionId !== undefined;
  const metadata: CodexSessionMetadata = {
    cwd: ownMeta?.cwd,
    version: ownMeta?.version,
    gitBranch: ownMeta?.gitBranch,
    startedAt: ownMeta?.startedAt,
    lastActivity: ownMeta?.timestamp ?? 0,
    observedStatus: 'unknown',
    accountingIncomplete: options.incomplete === true || ownMeta === undefined,
    parentSessionId: ownMeta?.parentSessionId,
    isSidechain: false,
  };
  const responseTurns = new Set<string>();
  let currentTurn = '';
  for (const observation of observations) {
    if (observation.turnId && (observation.kind === 'status' || observation.kind === 'context'))
      currentTurn = observation.turnId;
    if (observation.kind === 'response' && observation.sessionId === options.sessionId) {
      responseTurns.add(observation.turnId ?? currentTurn);
      if (!(observation.turnId ?? currentTurn)) metadata.accountingIncomplete = true;
    }
  }
  const events: TranscriptEvent[] = [];
  const seenResponses = new Set<string>();
  const legacyTotals = new Map<string, CodexUsage>();
  const responseTotals = new Map<string, CodexUsage>();
  const accumulate = (totals: Map<string, CodexUsage>, turn: string, usage: CodexUsage) => {
    const total = totals.get(turn) ?? { ...ZERO_USAGE };
    for (const key of usageKeys) total[key] += usage[key];
    totals.set(turn, total);
  };
  let previous: CodexUsage = { ...ZERO_USAGE };
  let hasBaseline = ownMeta !== undefined && !forked && options.incomplete !== true;
  let turnId = '';
  let legacyIndex = 0;
  const emit = (usage: CodexUsage, observation: CodexObservation, key: string) => {
    if (usage.total === 0 && usage.input === 0 && usage.output === 0) return;
    events.push({
      kind: 'usage',
      contextTokens: metadata.contextTokens ?? usage.input + usage.output,
      record: {
        provider: 'codex',
        sessionId: options.sessionId,
        key,
        timestamp: observation.timestamp,
        model: metadata.model ?? 'unknown',
        tokens: tokens(usage),
        isSidechain: false,
      },
    });
  };
  for (const observation of observations) {
    metadata.lastActivity = Math.max(metadata.lastActivity, observation.timestamp);
    if (observation.kind === 'context') {
      metadata.model = observation.model ?? metadata.model;
      metadata.cwd = observation.cwd ?? metadata.cwd;
      turnId = observation.turnId ?? turnId;
    } else if (observation.kind === 'status') {
      turnId = observation.turnId ?? turnId;
      metadata.observedStatus = observation.status ?? metadata.observedStatus;
    } else if (
      observation.kind === 'response' &&
      observation.sessionId === options.sessionId &&
      observation.usage
    ) {
      const key = `response:${observation.sessionId}:${observation.responseId}`;
      if (!seenResponses.has(key)) {
        seenResponses.add(key);
        accumulate(responseTotals, observation.turnId ?? turnId, observation.usage);
        emit(observation.usage, observation, key);
      }
    } else if (observation.kind === 'tokens') {
      metadata.contextWindow = observation.contextWindow ?? metadata.contextWindow;
      metadata.contextTokens = observation.lastUsage?.total ?? metadata.contextTokens;
      if (!observation.usage) continue;
      const next = observation.usage;
      const inherited =
        forked && (options.parentTurnIds === undefined || !turnId || options.parentTurnIds.has(turnId));
      const delta = hasBaseline ? difference(next, previous) : undefined;
      previous = next;
      hasBaseline = true;
      if (inherited) {
        if (options.parentTurnIds === undefined) metadata.accountingIncomplete = true;
        continue;
      }
      if (!delta) {
        metadata.accountingIncomplete = true;
        continue;
      }
      accumulate(legacyTotals, turnId, delta);
      if (!responseTurns.has(turnId))
        emit(delta, observation, `legacy:${turnId}:${legacyIndex++}:${JSON.stringify(next)}`);
    }
  }
  for (const [turn, observed] of responseTotals) {
    const legacy = legacyTotals.get(turn);
    if (legacy && usageKeys.some((key) => legacy[key] > observed[key])) metadata.accountingIncomplete = true;
  }
  events.push({
    kind: 'meta',
    timestamp: metadata.lastActivity,
    isSidechain: false,
    cwd: metadata.cwd,
    version: metadata.version,
    gitBranch: metadata.gitBranch,
    model: metadata.model,
    contextTokens: metadata.contextTokens,
    contextWindow: metadata.contextWindow,
    startedAt: metadata.startedAt,
    observedStatus: metadata.observedStatus,
    accountingIncomplete: metadata.accountingIncomplete,
    parentSessionId: metadata.parentSessionId,
  });
  return { events, metadata };
}

/** Latest bucket observations remain snapshots: percentages are never added. */
export function codexLimits(observations: readonly CodexObservation[], now: number): LimitsState {
  const buckets = new Map<string, CodexObservation>();
  for (const observation of observations) {
    if (observation.limits === undefined || observation.limitBucket === undefined) continue;
    const previous = buckets.get(observation.limitBucket);
    if (!previous || observation.timestamp >= previous.timestamp)
      buckets.set(observation.limitBucket, observation);
  }
  const latest = Math.max(...[...buckets.values()].map((o) => o.timestamp));
  const windows = [...buckets.values()].flatMap((o) =>
    (o.limits ?? []).map((window) => ({ ...window, observedAt: o.timestamp })),
  );
  const stale = windows.some(
    (w) => now - w.observedAt > 5 * 60_000 || (w.resetsAt !== undefined && w.resetsAt <= now),
  );
  const defaultBucket = buckets.get('codex') ?? [...buckets.values()][0];
  const block = defaultBucket?.limits?.find((w) => w.id?.endsWith(':primary'));
  const weekly = defaultBucket?.limits?.find((w) => w.id?.endsWith(':secondary'));
  return {
    source: 'observed',
    status: windows.length === 0 ? 'error' : stale ? 'stale' : 'ok',
    ...(windows.length === 0 ? { error: 'No quota observation available' } : {}),
    windows,
    ...(block ? { block: { ...block, observedAt: defaultBucket!.timestamp } } : {}),
    ...(weekly ? { weekly: { ...weekly, observedAt: defaultBucket!.timestamp } } : {}),
    perModelWeekly: [],
    ...(Number.isFinite(latest) ? { observedAt: latest, fetchedAt: latest } : {}),
  };
}
