// Shared fixtures for the store tests.
import { Store, type StoreOptions } from './store.js';
import type {
  ModelPrice,
  PriceLookup,
  RegistryEntry,
  Snapshot,
  SessionView,
  TokenCounts,
  TranscriptEvent,
} from '../domain/types.js';

export const NOW = Date.parse('2026-10-11T14:32:07Z');
export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const PRICE: ModelPrice = {
  input: 3e-6,
  output: 15e-6,
  cacheWrite: 3.75e-6,
  cacheRead: 0.3e-6,
  maxInputTokens: 200_000,
};
export const lookup: PriceLookup = (m) => (m === 'claude-opus-5-5' ? PRICE : undefined);

export function usage(
  key: string,
  timestamp: number,
  opts: { tokens?: Partial<TokenCounts>; sessionId?: string; model?: string; contextTokens?: number } = {},
): TranscriptEvent {
  return {
    kind: 'usage',
    contextTokens: opts.contextTokens ?? 1100,
    record: {
      key,
      sessionId: opts.sessionId ?? 's1',
      timestamp,
      model: opts.model ?? 'claude-opus-5-5',
      tokens: { input: 1000, output: 100, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, ...opts.tokens },
      isSidechain: false,
    },
  };
}

export const reg = (over: Partial<RegistryEntry> = {}): RegistryEntry => ({
  pid: 100,
  sessionId: 's1',
  cwd: '/work/proj',
  status: 'idle',
  version: '2.1.296',
  ...over,
});

export function makeStore(over: Partial<StoreOptions> = {}): Store {
  return new Store({
    now: () => NOW,
    refreshMs: 1000,
    endedWindowHours: 24,
    claudeDir: '/home/u/.claude',
    claudeDirFound: true,
    ...over,
  });
}

export function session(snap: Snapshot, id = 's1'): SessionView {
  const s = snap.sessions.find((x) => x.sessionId === id);
  if (!s) throw new Error(`session ${id} not in snapshot`);
  return s;
}
