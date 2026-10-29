import { basename } from 'node:path';
import { totalsForWindow } from '../domain/aggregate.js';
import { contextPercent, contextWindowFor, currentContextTokens } from '../domain/context.js';
import type {
  DisplayStatus,
  PriceLookup,
  RegistryEntry,
  SessionView,
  SubagentView,
  TimeWindow,
  TranscriptEvent,
  UsageRecord,
} from '../domain/types.js';
import { sanitizeKeys, sanitizeOptional, sanitizeText } from './sanitize.js';

const ALL_TIME: TimeWindow = { start: 0, end: Number.MAX_SAFE_INTEGER };

export interface SessionState {
  sessionId: string;
  live: boolean;
  registry?: RegistryEntry;
  /** Deduplicated usage records owned by this session (main + subagents). */
  records: UsageRecord[];
  lastUsage?: { timestamp: number; contextTokens: number; model: string };
  lastCompact?: { timestamp: number; postTokens: number };
  costState?: { timestamp: number; totalCostUSD: number };
  aiTitle?: string;
  agentName?: string;
  permissionMode?: string;
  meta: { timestamp: number; gitBranch?: string; cwd?: string; version?: string };
  lastEventTs: number;
  /** When the store saw the session end (process exit); keeps it visible for endedWindowHours. */
  endedAt?: number;
  agents: { activeCount: number; names: string[]; list?: SubagentView[] };
}

export function createSessionState(sessionId: string): SessionState {
  return {
    sessionId,
    live: false,
    records: [],
    meta: { timestamp: 0 },
    lastEventTs: 0,
    agents: { activeCount: 0, names: [] },
  };
}

function bumpActivity(s: SessionState, ts: number): void {
  if (ts > s.lastEventTs) s.lastEventTs = ts;
}

/** Applies one event. `isNewUsage` is false for usage records the global dedup set has already seen. */
export function applySessionEvent(s: SessionState, e: TranscriptEvent, isNewUsage: boolean): void {
  switch (e.kind) {
    case 'usage': {
      if (!isNewUsage) return;
      const r = e.record;
      s.records.push(r);
      bumpActivity(s, r.timestamp);
      if (!r.isSidechain && (!s.lastUsage || r.timestamp >= s.lastUsage.timestamp)) {
        s.lastUsage = { timestamp: r.timestamp, contextTokens: e.contextTokens, model: r.model };
      }
      return;
    }
    case 'compact':
      bumpActivity(s, e.timestamp);
      if (!e.isSidechain && (!s.lastCompact || e.timestamp >= s.lastCompact.timestamp)) {
        s.lastCompact = { timestamp: e.timestamp, postTokens: e.postTokens };
      }
      return;
    case 'costState':
      if (!s.costState || e.timestamp >= s.costState.timestamp) {
        s.costState = { timestamp: e.timestamp, totalCostUSD: e.totalCostUSD };
      }
      return;
    case 'title':
      if (e.source === 'ai-title') s.aiTitle = e.title;
      else s.agentName = e.title;
      return;
    case 'permissionMode':
      s.permissionMode = e.mode;
      return;
    case 'meta':
      bumpActivity(s, e.timestamp);
      if (e.isSidechain || e.timestamp < s.meta.timestamp) return;
      s.meta = {
        timestamp: e.timestamp,
        gitBranch: e.gitBranch ?? s.meta.gitBranch,
        cwd: e.cwd ?? s.meta.cwd,
        version: e.version ?? s.meta.version,
      };
      return;
  }
}

export function displayStatus(s: SessionState): { status: DisplayStatus; rawStatus?: string } {
  if (!s.live) return { status: 'ended' };
  const raw = s.registry?.status;
  if (raw === 'waiting') return { status: 'waiting' };
  if (raw === 'busy' || s.agents.activeCount > 0) return { status: 'busy' };
  if (raw === undefined || raw === 'idle') return { status: 'idle' };
  return { status: 'idle', rawStatus: raw };
}

/** First non-empty sanitized candidate: registry name → ai-title → agent-name → cwd basename → id prefix. */
export function displayName(s: SessionState): string {
  const cwd = s.registry?.cwd ?? s.meta.cwd;
  const candidates = [s.registry?.name, s.aiTitle, s.agentName, cwd ? basename(cwd) : undefined];
  for (const c of candidates) {
    const clean = c === undefined ? '' : sanitizeText(c).trim();
    if (clean) return clean;
  }
  return sanitizeText(s.sessionId).slice(0, 8);
}

export function lastActivityOf(s: SessionState): number {
  const r = s.registry;
  return Math.max(s.lastEventTs, r?.statusUpdatedAt ?? 0, r?.updatedAt ?? 0, r?.startedAt ?? 0);
}

export function sessionVersion(s: SessionState): string | undefined {
  return s.registry?.version ?? s.meta.version;
}

/** Builds the UI view. Every disk-sourced string is sanitized here so the UI never sees control chars. */
export function buildSessionView(s: SessionState, lookup: PriceLookup | null): SessionView {
  const totals = totalsForWindow(s.records, ALL_TIME, lookup);
  const fallback = totals.costUSD === null ? s.costState : undefined;
  const model = s.lastUsage?.model;
  const contextTokens = currentContextTokens({ lastUsage: s.lastUsage, lastCompact: s.lastCompact });
  const contextWindow =
    contextTokens === undefined ? undefined : contextWindowFor(model, model ? lookup?.(model) : undefined);
  const { status, rawStatus } = displayStatus(s);
  return {
    sessionId: s.sessionId, // identity key, kept raw; never rendered directly
    pid: s.registry?.pid,
    live: s.live,
    status,
    ...(rawStatus === undefined ? {} : { rawStatus: sanitizeText(rawStatus) }),
    waitingFor: status === 'waiting' ? sanitizeOptional(s.registry?.waitingFor) : undefined,
    activeAgents: s.live ? s.agents.activeCount : 0,
    agentNames: s.live ? s.agents.names.map(sanitizeText) : [],
    subagents: s.live
      ? [...(s.agents.list ?? [])]
          .sort((a, b) => b.lastActivity - a.lastActivity)
          .map((a) => ({ id: a.id, name: sanitizeText(a.name), lastActivity: a.lastActivity }))
      : [],
    name: displayName(s),
    cwd: sanitizeOptional(s.registry?.cwd ?? s.meta.cwd),
    gitBranch: sanitizeOptional(s.meta.gitBranch),
    model: sanitizeOptional(model),
    contextTokens,
    contextWindow,
    contextPercent:
      contextTokens === undefined || contextWindow === undefined
        ? undefined
        : contextPercent(contextTokens, contextWindow),
    costUSD: fallback ? fallback.totalCostUSD : totals.costUSD,
    costApprox: fallback !== undefined,
    tokens: totals.tokens,
    byModel: sanitizeKeys(totals.byModel),
    startedAt: s.registry?.startedAt,
    lastActivity: lastActivityOf(s),
    permissionMode: sanitizeOptional(s.permissionMode),
    version: sanitizeOptional(sessionVersion(s)),
  };
}
