// Builders for synthetic, content-free Claude Code transcript JSONL lines.

export interface UsageInput {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  eph5m?: number;
  eph1h?: number;
}

export interface AssistantOpts {
  id: string;
  requestId?: string;
  model?: string;
  ts: string; // ISO
  usage?: UsageInput;
  sidechain?: boolean;
  gitBranch?: string;
  cwd?: string;
  sessionId?: string;
  version?: string;
}

export function assistantLine(o: AssistantOpts): string {
  const u = o.usage ?? {};
  const usage: Record<string, unknown> = {
    input_tokens: u.input_tokens ?? 0,
    output_tokens: u.output_tokens ?? 0,
    cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
  };
  if (u.eph5m !== undefined || u.eph1h !== undefined) {
    usage.cache_creation = {
      ephemeral_5m_input_tokens: u.eph5m ?? 0,
      ephemeral_1h_input_tokens: u.eph1h ?? 0,
    };
  }
  return JSON.stringify({
    type: 'assistant',
    uuid: `u-${o.id}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: o.ts,
    isSidechain: o.sidechain ?? false,
    sessionId: o.sessionId ?? 'sess-1',
    cwd: o.cwd ?? '/work/proj',
    gitBranch: o.gitBranch ?? 'main',
    version: o.version ?? '2.1.296',
    ...(o.requestId === undefined ? {} : { requestId: o.requestId }),
    message: { id: o.id, model: o.model ?? 'claude-opus-5-5', role: 'assistant', content: [], usage },
  });
}

export function userLine(ts: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'user',
    timestamp: ts,
    isSidechain: false,
    cwd: '/work/proj',
    gitBranch: 'main',
    version: '2.1.296',
    message: { role: 'user', content: '' },
    ...extra,
  });
}

export function compactLine(ts: string, postTokens: number): string {
  return JSON.stringify({
    type: 'system',
    subtype: 'compact_boundary',
    timestamp: ts,
    isSidechain: false,
    compactMetadata: { trigger: 'auto', preTokens: postTokens * 5, postTokens },
  });
}

export function costStateLine(totalCostUSD: number, ts?: string): string {
  return JSON.stringify({
    type: 'cost-state',
    ...(ts ? { timestamp: ts } : {}),
    totalCostUSD,
    modelUsage: {},
  });
}

export function aiTitleLine(aiTitle: string): string {
  return JSON.stringify({ type: 'ai-title', aiTitle });
}

export function agentNameLine(agentName: string): string {
  return JSON.stringify({ type: 'agent-name', agentName });
}

export function permissionModeLine(permissionMode: string): string {
  return JSON.stringify({ type: 'permission-mode', permissionMode });
}

export function jsonl(...lines: string[]): string {
  return lines.join('\n') + '\n';
}
