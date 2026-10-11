// Turns raw Claude Code transcript records into typed TranscriptEvents.
// Formats are undocumented internals (Claude Code 2.1.x): validate everything, never throw.
import type { TokenCounts, TranscriptEvent } from '../domain/types.js';

export interface ParseContext {
  sessionId: string;
  /** Set for subagent transcript files: every event is treated as sidechain. */
  forceSidechain?: boolean;
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);

function parseTs(v: unknown): number | undefined {
  if (typeof v !== 'string') return undefined;
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : t;
}

function metaEvent(raw: Obj, timestamp: number | undefined, isSidechain: boolean): TranscriptEvent[] {
  if (timestamp === undefined) return [];
  const gitBranch = str(raw.gitBranch);
  const cwd = str(raw.cwd);
  const version = str(raw.version);
  return [
    {
      kind: 'meta',
      timestamp,
      isSidechain,
      ...(gitBranch === undefined ? {} : { gitBranch }),
      ...(cwd === undefined ? {} : { cwd }),
      ...(version === undefined ? {} : { version }),
    },
  ];
}

function usageEvent(
  raw: Obj,
  ctx: ParseContext,
  timestamp: number | undefined,
  isSidechain: boolean,
): TranscriptEvent[] {
  if (timestamp === undefined) return [];
  const message = raw.message;
  if (!isObj(message)) return [];
  const id = str(message.id);
  const model = str(message.model);
  const usage = message.usage;
  if (id === undefined || model === undefined || model === '<synthetic>' || !isObj(usage)) return [];

  const input = num(usage.input_tokens);
  const output = num(usage.output_tokens);
  const cacheCreation = num(usage.cache_creation_input_tokens);
  const cacheRead = num(usage.cache_read_input_tokens);
  if (input + output + cacheCreation + cacheRead === 0) return [];

  let cacheWrite5m = cacheCreation;
  let cacheWrite1h = 0;
  const breakdown = usage.cache_creation;
  if (isObj(breakdown)) {
    cacheWrite5m = num(breakdown.ephemeral_5m_input_tokens);
    cacheWrite1h = num(breakdown.ephemeral_1h_input_tokens);
    // Anything the breakdown does not account for is priced as a 5m write.
    if (cacheWrite5m + cacheWrite1h < cacheCreation) cacheWrite5m = cacheCreation - cacheWrite1h;
  }

  const tokens: TokenCounts = { input, output, cacheWrite5m, cacheWrite1h, cacheRead };
  const requestId = str(raw.requestId);
  return [
    {
      kind: 'usage',
      contextTokens: input + cacheCreation + cacheRead,
      record: {
        key: requestId ? `${id}:${requestId}` : id,
        sessionId: ctx.sessionId,
        timestamp,
        model,
        tokens,
        isSidechain,
      },
    },
  ];
}

export function parseTranscriptRecord(raw: unknown, ctx: ParseContext): TranscriptEvent[] {
  if (!isObj(raw)) return [];
  const isSidechain = ctx.forceSidechain === true || raw.isSidechain === true;
  const timestamp = parseTs(raw.timestamp);

  switch (raw.type) {
    case 'assistant':
      return [...usageEvent(raw, ctx, timestamp, isSidechain), ...metaEvent(raw, timestamp, isSidechain)];
    case 'user':
    case 'attachment':
      return metaEvent(raw, timestamp, isSidechain);
    case 'system': {
      const out: TranscriptEvent[] = [];
      const meta = raw.compactMetadata;
      if (
        raw.subtype === 'compact_boundary' &&
        timestamp !== undefined &&
        isObj(meta) &&
        typeof meta.postTokens === 'number'
      ) {
        out.push({ kind: 'compact', timestamp, postTokens: meta.postTokens, isSidechain });
      }
      return [...out, ...metaEvent(raw, timestamp, isSidechain)];
    }
    case 'cost-state':
      return typeof raw.totalCostUSD === 'number' && Number.isFinite(raw.totalCostUSD)
        ? [{ kind: 'costState', timestamp: timestamp ?? 0, totalCostUSD: raw.totalCostUSD }]
        : [];
    case 'ai-title': {
      const title = str(raw.aiTitle);
      return title === undefined
        ? []
        : [{ kind: 'title', timestamp: timestamp ?? 0, title, source: 'ai-title' }];
    }
    case 'agent-name': {
      const title = str(raw.agentName);
      return title === undefined
        ? []
        : [{ kind: 'title', timestamp: timestamp ?? 0, title, source: 'agent-name' }];
    }
    case 'permission-mode': {
      const mode = str(raw.permissionMode);
      return mode === undefined ? [] : [{ kind: 'permissionMode', timestamp: timestamp ?? 0, mode }];
    }
    default:
      return [];
  }
}

export function parseTranscriptLine(line: string, ctx: ParseContext): TranscriptEvent[] {
  if (line.trim() === '') return [];
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return [];
  }
  return parseTranscriptRecord(raw, ctx);
}
