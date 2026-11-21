// Baseline benchmark for Store flush cost and retained heap.
// Uses only the public Store API so it keeps working through refactors.
// Run: node --expose-gc --import tsx scripts/bench-store.ts
import { performance } from 'node:perf_hooks';
import { Store } from '../src/store/store.js';
import type { ModelPrice, RegistryEntry, TranscriptEvent, UsageRecord } from '../src/domain/types.js';

const gc = (globalThis as { gc?: () => void }).gc;
if (!gc) console.warn('WARNING: global.gc unavailable; run with --expose-gc. Heap numbers are not settled.');
const collect = (): void => {
  gc?.();
  gc?.();
};

// ---- knobs -----------------------------------------------------------------
const SIM_HOURS = 1; // Phase 2 simulated duration
const FLUSH_EVERY_SEC = 10; // Phase 2 flushes only every Nth simulated second (see output note)
const PHASE1_FLUSHES = 100;
const CLAUDE_SESSIONS = 1700;
const CLAUDE_RECORDS = 150_000;
const CODEX_SESSIONS = 100;
const CODEX_RECORDS_PER_SESSION = 100;
const LIVE_SESSIONS = 10;
const HISTORY_DAYS = 35;
const DAY = 24 * 3600_000;

// ---- deterministic helpers -------------------------------------------------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(0xc0ffee);
const randInt = (lo: number, hi: number): number => lo + Math.floor(rng() * (hi - lo + 1));

// Fixed per-token prices (USD) for three model names.
const MODELS = ['claude-opus-5-5', 'claude-sonnet-5-0', 'claude-haiku-5-5'] as const;
const PRICES = new Map<string, ModelPrice>([
  [
    'claude-opus-5-5',
    { input: 15e-6, output: 75e-6, cacheWrite: 18.75e-6, cacheRead: 1.5e-6, maxInputTokens: 200_000 },
  ],
  [
    'claude-sonnet-5-0',
    { input: 3e-6, output: 15e-6, cacheWrite: 3.75e-6, cacheRead: 0.3e-6, maxInputTokens: 200_000 },
  ],
  [
    'claude-haiku-5-5',
    { input: 1e-6, output: 5e-6, cacheWrite: 1.25e-6, cacheRead: 0.1e-6, maxInputTokens: 200_000 },
  ],
]);
const lookup = (model: string): ModelPrice | undefined => PRICES.get(model);

function usageEvent(sessionId: string, key: string, timestamp: number): TranscriptEvent {
  const record: UsageRecord = {
    key,
    sessionId,
    timestamp,
    model: MODELS[randInt(0, MODELS.length - 1)]!,
    tokens: {
      input: randInt(200, 4000),
      output: randInt(20, 1500),
      cacheWrite5m: randInt(0, 2000),
      cacheWrite1h: 0,
      cacheRead: randInt(0, 20_000),
    },
    isSidechain: false,
  };
  return { kind: 'usage', record, contextTokens: randInt(1000, 150_000) };
}

function stats(xs: number[]): { mean: number; p95: number } {
  if (xs.length === 0) return { mean: NaN, p95: NaN };
  const s = [...xs].sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  const p95 = s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]!;
  return { mean, p95 };
}

const mb = (bytes: number): number => bytes / 1024 / 1024;
const fmt = (n: number, d = 2): string => (Number.isFinite(n) ? n.toFixed(d) : '-');

// ---- setup -----------------------------------------------------------------
const T0 = Date.parse('2026-11-18T12:00:00Z');
let t = T0;
const store = new Store({
  now: () => t,
  refreshMs: 1000,
  endedWindowHours: 0,
  idleCutoffMinutes: 60,
  claudeDir: '/bench/home/.claude',
  claudeDirFound: true,
});
store.setPricing(lookup, 'ok');

// Harness-held codex event lists (needed for replaceProviderSession). Built before the
// baseline heap sample so their footprint is excluded from the "store MB" column.
const codexEvents: TranscriptEvent[][] = [];
for (let s = 0; s < CODEX_SESSIONS; s++) {
  const list: TranscriptEvent[] = [];
  for (let j = 0; j < CODEX_RECORDS_PER_SESSION; j++) {
    list.push(usageEvent(`x${s}`, `cx${s}:${j}`, T0 - randInt(0, HISTORY_DAYS * DAY)));
  }
  codexEvents.push(list);
}
collect();
const baselineHeap = process.memoryUsage().heapUsed;

const rows: string[][] = [];
let totalRecords = 0;
const pushRow = (phase: string, heapBytes: number, flushMs: number[], ingestMs: number[]): void => {
  const f = stats(flushMs);
  const ing = stats(ingestMs);
  rows.push([
    phase,
    totalRecords.toLocaleString('en-US'),
    fmt(mb(heapBytes)),
    fmt(mb(heapBytes - baselineHeap)),
    fmt(f.mean),
    fmt(f.p95),
    fmt(ing.mean, 3),
  ]);
};

// ---- Phase 1: history load -------------------------------------------------
const phase1Start = performance.now();
for (let s = 0; s < CLAUDE_SESSIONS; s++) {
  const sid = `c${s}`;
  const n = Math.floor(CLAUDE_RECORDS / CLAUDE_SESSIONS) + (s < CLAUDE_RECORDS % CLAUDE_SESSIONS ? 1 : 0);
  const events: TranscriptEvent[] = [];
  for (let j = 0; j < n; j++) {
    events.push(usageEvent(sid, `c${s}:${j}`, T0 - randInt(0, HISTORY_DAYS * DAY)));
  }
  store.applyEvents(sid, events);
  totalRecords += n;
}
for (let s = 0; s < CODEX_SESSIONS; s++) {
  store.applyEvents(`x${s}`, codexEvents[s]!, 'codex');
  totalRecords += codexEvents[s]!.length;
}
for (let s = 0; s < LIVE_SESSIONS; s++) {
  const entry: RegistryEntry = {
    pid: 1000 + s,
    sessionId: `c${s}`,
    cwd: `/work/proj${s}`,
    status: 'busy',
    version: '2.1.296',
  };
  store.upsertRegistry(entry);
}
const phase1LoadMs = performance.now() - phase1Start;
store.flush();

const phase1Flush: number[] = [];
console.error(`[progress] phase 1 load ${phase1LoadMs.toFixed(0)} ms`);
collect();
const loadHeapBytes = process.memoryUsage().heapUsed;
for (let i = 0; i < PHASE1_FLUSHES; i++) {
  t += 1000;
  const start = performance.now();
  store.flush();
  phase1Flush.push(performance.now() - start);
}
collect();
pushRow('1 history load', process.memoryUsage().heapUsed, phase1Flush, []);

// ---- Phase 2: 6 hours heavy ingest ----------------------------------------
const hourFlush: number[] = [];
const hourIngest: number[] = [];
let codexCursor = 0;
const simSeconds = SIM_HOURS * 3600;
for (let sec = 1; sec <= simSeconds; sec++) {
  t += 1000;

  // 3 new usage records per simulated second, round-robin over live sessions.
  for (let k = 0; k < 3; k++) {
    const idx = (sec * 3 + k) % LIVE_SESSIONS;
    store.applyEvents(`c${idx}`, [usageEvent(`c${idx}`, `live:${sec}:${k}`, t)]);
    totalRecords++;
  }

  // Every 2s: append one record to a codex session and replace its full event list.
  if (sec % 2 === 0) {
    const idx = codexCursor;
    codexCursor = (codexCursor + 1) % CODEX_SESSIONS;
    const list = codexEvents[idx]!;
    list.push(usageEvent(`x${idx}`, `cx${idx}:new${sec}`, t));
    const start = performance.now();
    store.replaceProviderSession(`x${idx}`, list, 'codex');
    hourIngest.push(performance.now() - start);
    totalRecords++;
  }

  if (sec % FLUSH_EVERY_SEC === 0) {
    const start = performance.now();
    store.flush();
    hourFlush.push(performance.now() - start);
  }

  if (sec % 3600 === 0) {
    const hour = sec / 3600;
    collect();
    pushRow(`2 hour ${hour}`, process.memoryUsage().heapUsed, hourFlush, hourIngest);
    console.error(`[progress] hour ${hour} done at ${new Date().toISOString()}`);
    hourFlush.length = 0;
    hourIngest.length = 0;
  }
}

// ---- report ----------------------------------------------------------------
const header = ['phase', 'records (cum)', 'heapUsed MB', 'store MB', 'ms/flush mean', 'p95', 'ms/replace'];
const all = [header, ...rows];
const widths = header.map((_, i) => Math.max(...all.map((r) => r[i]!.length)));
const line = (r: string[]): string =>
  r.map((c, i) => (i === 0 ? c.padEnd(widths[i]!) : c.padStart(widths[i]!))).join('  ');
console.log(`ccstatusboard Store baseline  (node ${process.version})`);
console.log(
  `Phase 1: ${CLAUDE_SESSIONS} claude sessions / ${CLAUDE_RECORDS} records + ${CODEX_SESSIONS} codex sessions / ` +
    `${CODEX_SESSIONS * CODEX_RECORDS_PER_SESSION} records, ${LIVE_SESSIONS} live. Load took ${fmt(phase1LoadMs, 0)} ms.`,
);
console.log(
  `Phase 2: ${SIM_HOURS} simulated hours (${simSeconds} s). flush() only every ${FLUSH_EVERY_SEC}th simulated second ` +
    `(not every second), to keep runtime bounded.`,
);
console.log(
  `store MB = heapUsed minus baseline taken after building harness-held codex event lists (store-only estimate).`,
);
console.log(
  `Heap after Phase 1 load, before first flush: ${fmt(mb(loadHeapBytes))} MB (gc'd, raw heapUsed).`,
);
console.log('');
console.log(all.map(line).join('\n'));
console.log('');
console.log(
  `Note: harness-held codex event lists grow by 1 record per replace (${Math.floor(simSeconds / 2)} total) and ` +
    `are included in "store MB" (~a few MB at most).`,
);
