# ccstatusboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `ccstatusboard`, a standalone htop-style Ink TUI that shows Claude Code usage limits, estimated costs, and the live status of every Claude Code session on the machine.

**Architecture:** One Node process. Collectors (session registry watcher, transcript tailer, history scanner, usage-API poller, LiteLLM pricing) push typed events into an in-memory `Store`. The store dedups usage records, aggregates them, and publishes immutable `Snapshot`s at most once per `refreshMs`. The Ink UI reads snapshots through `useSyncExternalStore` and only renders: it never does IO.

**Tech Stack:** Node ≥22, TypeScript 5.9 (strict, ESM), Ink 7.1.1, React 19.2.8, @inkjs/ui 2.0.0, @pppp606/ink-chart 0.2.8, @mishieck/ink-titled-box 0.4.2, ink-gradient 4.0.1, zod 4, tsup, vitest, ink-testing-library.

**Spec:** `docs/superpowers/specs/2026-10-11-ccstatusboard-design.md` (read it before starting any task).

## Global Constraints

- Node `>=22`; `"type": "module"`; ESM only; TS `strict: true`, `noUncheckedIndexedAccess: true`; imports use `.js` extensions in TS source (NodeNext resolution).
- Exact dependency versions: `ink@7.1.1`, `react@19.2.8`, `@inkjs/ui@2.0.0`, `@pppp606/ink-chart@0.2.8` (exact pin, no caret), `@mishieck/ink-titled-box@0.4.2`, `ink-gradient@4.0.1`, `zod@^4.6.6`; dev: `typescript@5.9.3`, `tsup@^8.5.1`, `vitest@^5.0.3`, `ink-testing-library@^4.0.0`, `@types/react@19.2.18`, `@types/node@^22`, `eslint@^10.12.0`, `@eslint/js@^10.0.1`, `typescript-eslint@^8.71.1`, `prettier@^3.9.10`.
- Platforms: Linux and macOS. No Windows-specific code.
- **Never write anything under the Claude config dir.** Never open `*.key` files. Never refresh OAuth tokens.
- Claude config dir = `--claude-dir` flag > config `claudeDir` > `$CLAUDE_CONFIG_DIR` > `~/.claude`.
- All time-dependent code takes an injected `now: () => number` (epoch ms). All IO-heavy modules take injected fs/fetch/exec dependencies with real defaults.
- UI components never perform IO; they render props / `Snapshot` only.
- Every source file < 300 lines. Unit tests are colocated as `src/**/*.test.ts(x)`.
- Parsers never throw on bad input: they skip the record and continue.
- Display copy is verbatim from spec: `login required`, `disabled`, `expired — open Claude Code to refresh`, `stale <age>`, `⚠ pricing stale`, `⚠ unpriced: <model>`, `⚠ untested Claude Code v<x>`, `Claude Code data not found at <path>`, `No Claude Code sessions in the last 24h` (hours value from config), `Terminal too small`.
- Commit after every task with a conventional-commit message ending in `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A transcript line written half-way when read** (Claude Code mid-write): the tailer must buffer the partial line and parse it on the next read, never dropping or double-counting it. Pinned in Task 13.
2. **The same assistant response appearing in both the history scan and the live tail, or split over several lines**: it must count exactly once in session and global totals. Pinned in Task 18.
3. **A registry file left behind for a dead or reused PID** (crash, reboot): it must show as ended, not live. Pinned in Tasks 5 and 15.
4. **A usage API response in the new `limits[]` shape, or with placeholder 0%/no-reset entries**: meters show real values and placeholders are ignored, never shown as a phantom 0%. Pinned in Task 17.
5. **A very narrow or short terminal, or a resize**: columns drop in spec order, the detail pane hides when height < 24, and below 60×16 it shows `Terminal too small` instead of corrupted output. Pinned in Tasks 21 and 22.

---

## File Map

```
package.json, tsconfig.json, tsup.config.ts, vitest.config.ts, eslint.config.js, .prettierrc, .gitignore, LICENSE, CLAUDE.md, README.md
src/
  cli.tsx                        Task 23  entry: flags, config, runtime, render
  app/runtime.ts                 Task 23  wires collectors → store
  config/schema.ts, load.ts      Task 4
  core/paths.ts                  Task 2
  core/jsonl.ts                  Task 3
  collectors/liveness.ts         Task 5
  collectors/credentials.ts      Task 6
  collectors/transcriptParser.ts Task 11
  collectors/pricing.ts          Task 12
  collectors/transcriptTailer.ts Task 13
  collectors/historyScanner.ts   Task 14
  collectors/sessionRegistry.ts  Task 15
  collectors/subagents.ts        Task 16
  collectors/usageApi.ts         Task 17
  domain/types.ts                Task 1   shared contract
  domain/dedup.ts, cost.ts       Task 7
  domain/context.ts              Task 8
  domain/windows.ts              Task 9
  domain/aggregate.ts            Task 10
  domain/format.ts               Task 19  shared display formatters
  store/store.ts, sessionState.ts, useSnapshot.ts  Task 18
  ui/theme.ts, Meter.tsx, Panel.tsx                 Task 19
  ui/UsagePanel.tsx, Header.tsx, Footer.tsx         Task 20
  ui/SessionTable.tsx, DetailPane.tsx, HelpOverlay.tsx  Task 21
  ui/App.tsx                     Task 22
test/helpers/transcript.ts       Task 1   JSONL line builders
test/helpers/snapshot.ts         Task 1   Snapshot/SessionView factories
test/helpers/ansi.ts             Task 19  stripAnsi for frame assertions
test/helpers/claudeDir.ts        Task 23  temp Claude-dir fixture + fake fetch (reused by Task 24)
test/integration/runtime.test.ts Task 24
```

## Execution Waves (parallel workstreams)

Tasks in the same wave touch disjoint files and depend only on earlier waves, so they can run in parallel subagents.

| Wave | Tasks | Depends on |
|---|---|---|
| 0 | 1 (scaffold + contract) | — |
| 1 | 2, 3, 5, 6, 7, 8, 9, 11, 12, 19 | 1 |
| 2 | 4, 10, 13, 15, 16, 17, 20, 21 | 4←2; 10←7,9; 13←3; 15←2,5; 16←2; 17←6; 20,21←19 |
| 3 | 14 (history scanner), 18 (store), 22 (App) | 14←2,3,11,13; 18←7,8,9,10; 22←18(useSnapshot),19,20,21 |
| 4 | 23 (runtime + cli) | all collectors, 4, 18, 22 |
| 5 | 24 (integration, README, pack) | 23 |

Run Task 22 after Task 18 has at least committed `src/store/useSnapshot.ts`, or run 18 first within wave 3.

**Parallel-run rule:** in waves 1–2, the only file several tasks may touch is `package.json`. Only Task 1 edits it. No later task adds dependencies.

---

### Task 1: Scaffold, toolchain, shared contract, test helpers

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`, `eslint.config.js`, `.prettierrc`, `.gitignore`, `LICENSE`, `CLAUDE.md`
- Create: `src/domain/types.ts`, `test/helpers/transcript.ts`, `test/helpers/snapshot.ts`
- Test: `src/domain/types.test.ts`, `test/helpers/smoke.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: every type in `src/domain/types.ts` (the contract all other tasks import); `test/helpers/transcript.ts` builders; `test/helpers/snapshot.ts` factories; npm scripts `test`, `typecheck`, `lint`, `build`, `dev`.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "ccstatusboard",
  "version": "0.1.0",
  "description": "htop-style terminal dashboard for all your Claude Code sessions, usage limits and costs",
  "type": "module",
  "bin": { "ccstatusboard": "dist/cli.js" },
  "files": ["dist", "README.md", "LICENSE"],
  "engines": { "node": ">=22" },
  "os": ["linux", "darwin"],
  "license": "MIT",
  "author": "Alec Reimel",
  "keywords": ["claude", "claude-code", "tui", "ink", "dashboard", "statusline"],
  "scripts": {
    "dev": "tsx src/cli.tsx",
    "build": "tsup",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "lint": "eslint . && prettier --check .",
    "format": "prettier --write .",
    "prepublishOnly": "npm run typecheck && npm test && npm run build"
  },
  "dependencies": {
    "@inkjs/ui": "2.0.0",
    "@mishieck/ink-titled-box": "0.4.2",
    "@pppp606/ink-chart": "0.2.8",
    "ink": "7.1.1",
    "ink-gradient": "4.0.1",
    "react": "19.2.8",
    "zod": "^4.6.6"
  },
  "devDependencies": {
    "@eslint/js": "^10.0.1",
    "@types/node": "^22",
    "@types/react": "19.2.18",
    "eslint": "^10.12.0",
    "ink-testing-library": "^4.0.0",
    "prettier": "^3.9.10",
    "tsup": "^8.5.1",
    "tsx": "^4",
    "typescript": "5.9.3",
    "typescript-eslint": "^8.71.1",
    "vitest": "^5.0.3"
  },
  "overrides": {
    "@mishieck/ink-titled-box": { "ink": "$ink", "react": "$react", "typescript": "$typescript" }
  }
}
```

- [ ] **Step 2: Write config files**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": false,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "test", "*.config.ts"]
}
```

`tsup.config.ts`:
```ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { cli: 'src/cli.tsx' },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  clean: true,
  sourcemap: true,
  banner: { js: '#!/usr/bin/env node' },
});
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
    environment: 'node',
    testTimeout: 10_000,
  },
});
```

`eslint.config.js`:
```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] } },
);
```

`.prettierrc`:
```json
{ "singleQuote": true, "printWidth": 110, "trailingComma": "all" }
```

`.gitignore`:
```
node_modules/
dist/
coverage/
*.tgz
.codegraph/
```

`LICENSE`: standard MIT text, `Copyright (c) 2026 Alec Reimel`.

`CLAUDE.md`:
```markdown
# ccstatusboard

Standalone htop-style Ink TUI monitoring all Claude Code sessions. Spec: docs/superpowers/specs/2026-10-11-ccstatusboard-design.md. Plan: docs/superpowers/plans/2026-10-11-ccstatusboard.md.

- Commands: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run dev`.
- Shared types live in `src/domain/types.ts`: change them there first.
- Collectors do IO and emit events; `store/` aggregates; `ui/` renders only (no IO in components).
- Never write under the Claude config dir, never open `*.key` files, never refresh OAuth tokens.
- Inject `now`, fs, fetch and exec for testability; tests use fixtures from `test/helpers/`.
```

- [ ] **Step 3: Install and check the peer-dependency situation**

Run: `npm install`
Expected: installs without ERESOLVE (the `overrides` block satisfies ink-titled-box's `ink ^6` / `typescript ^5` peers). If npm still reports ERESOLVE, add `legacy-peer-deps=true` to a new `.npmrc` and re-run.

- [ ] **Step 4: Write `src/domain/types.ts` (the shared contract, copied exactly)**

```ts
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
  name: string;
  cwd?: string;
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
}

export type ThemeName = 'default' | 'mono' | 'dracula' | 'solarized';
export type ColumnKey = 'status' | 'name' | 'model' | 'branch' | 'ctx' | 'cost' | 'last' | 'uptime';
export type SortKey = 'status' | 'activity' | 'cost' | 'ctx' | 'name';

export interface Config {
  theme: ThemeName;
  refreshMs: number;
  usagePollSeconds: number;
  endedWindowHours: number;
  columns: ColumnKey[];
  sort: SortKey;
  showDetail: boolean;
  claudeDir: string | null;
  usageApi: boolean;
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

export function emptyWindowTotals(): WindowTotals {
  return { costUSD: 0, tokens: { ...ZERO_TOKENS }, byModel: {} };
}
```

- [ ] **Step 5: Write the failing test for the helpers in types.ts**

`src/domain/types.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { addTokens, emptyWindowTotals, ZERO_TOKENS } from './types.js';

describe('types helpers', () => {
  it('addTokens sums every field', () => {
    const a = { input: 1, output: 2, cacheWrite5m: 3, cacheWrite1h: 4, cacheRead: 5 };
    expect(addTokens(a, a)).toEqual({ input: 2, output: 4, cacheWrite5m: 6, cacheWrite1h: 8, cacheRead: 10 });
  });
  it('ZERO_TOKENS is frozen and emptyWindowTotals returns fresh objects', () => {
    expect(Object.isFrozen(ZERO_TOKENS)).toBe(true);
    const w1 = emptyWindowTotals();
    const w2 = emptyWindowTotals();
    w1.tokens.input = 5;
    expect(w2.tokens.input).toBe(0);
    expect(w1.costUSD).toBe(0);
  });
});
```

Run: `npx vitest run src/domain/types.test.ts`
Expected: PASS. (types.ts was written in Step 4. This test guards the helpers.)

- [ ] **Step 6: Write the test helpers**

`test/helpers/transcript.ts`:
```ts
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
    usage.cache_creation = { ephemeral_5m_input_tokens: u.eph5m ?? 0, ephemeral_1h_input_tokens: u.eph1h ?? 0 };
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
  return JSON.stringify({ type: 'cost-state', ...(ts ? { timestamp: ts } : {}), totalCostUSD, modelUsage: {} });
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
```

`test/helpers/snapshot.ts`:
```ts
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
```

- [ ] **Step 7: Smoke-test the Ink add-ons on Ink 7**

`test/helpers/smoke.test.tsx`:
```tsx
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { TitledBox } from '@mishieck/ink-titled-box';
import { Sparkline } from '@pppp606/ink-chart';
import { ProgressBar } from '@inkjs/ui';
import Gradient from 'ink-gradient';

describe('ink add-on smoke test (Ink 7)', () => {
  it('renders TitledBox with title in the border', () => {
    const { lastFrame } = render(
      <TitledBox borderStyle="round" titles={['Usage']}>
        <Text>hi</Text>
      </TitledBox>,
    );
    expect(lastFrame()).toContain('Usage');
    expect(lastFrame()).toContain('hi');
  });
  it('renders Sparkline, ProgressBar and Gradient without throwing', () => {
    expect(() => render(<Sparkline data={[1, 3, 2, 5]} width={4} />)).not.toThrow();
    expect(() => render(<ProgressBar value={40} />)).not.toThrow();
    const { lastFrame } = render(
      <Gradient name="pastel">
        <Text>ccstatusboard</Text>
      </Gradient>,
    );
    expect(lastFrame()).toContain('ccstatusboard');
  });
});
```

Run: `npx vitest run test/helpers/smoke.test.tsx`
Expected: PASS. If the `TitledBox` prop names differ, check `node_modules/@mishieck/ink-titled-box/README.md` and fix the test to match the real API. Record the confirmed prop names in a comment at the top of this test file; Task 19 depends on them. If TitledBox fails to render under Ink 7 at all, delete those assertions, uninstall the package (`npm rm @mishieck/ink-titled-box`), and note in `CLAUDE.md`: "TitledBox incompatible with Ink 7 → ui/Panel.tsx draws its own titled border". Task 19 has the fallback implementation. Do the same check for Sparkline's props (`data`, `width`).

- [ ] **Step 8: Typecheck, lint, full test run**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all pass. If prettier flags files, run `npm run format` first.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: scaffold ccstatusboard toolchain, shared types and test helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Paths (Claude dir, project-dir encoding, config/cache dirs)

**Files:**
- Create: `src/core/paths.ts`
- Test: `src/core/paths.test.ts`

**Interfaces:**
- Consumes: nothing beyond Node built-ins.
- Produces:
  ```ts
  export function resolveClaudeDir(opts: { flag?: string | null; config?: string | null; env?: NodeJS.ProcessEnv; home?: string }): string
  export function encodeProjectDir(cwd: string): string
  export function sessionsDir(claudeDir: string): string
  export function projectsDir(claudeDir: string): string
  export function transcriptPath(claudeDir: string, cwd: string, sessionId: string): string
  export function subagentsDir(claudeDir: string, cwd: string, sessionId: string): string
  export async function findTranscript(claudeDir: string, cwd: string, sessionId: string): Promise<string | null>
  export function configDir(env?: NodeJS.ProcessEnv, home?: string, platform?: NodeJS.Platform): string
  export function cacheDir(env?: NodeJS.ProcessEnv, home?: string, platform?: NodeJS.Platform): string
  export function sessionIdFromTranscriptPath(file: string): { sessionId: string; isSubagent: boolean }
  ```

- [ ] **Step 1: Write the failing test**

`src/core/paths.test.ts`:
```ts
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cacheDir,
  configDir,
  encodeProjectDir,
  findTranscript,
  projectsDir,
  resolveClaudeDir,
  sessionIdFromTranscriptPath,
  sessionsDir,
  subagentsDir,
  transcriptPath,
} from './paths.js';

describe('resolveClaudeDir', () => {
  const home = '/home/u';
  it('prefers flag > config > env > ~/.claude', () => {
    const env = { CLAUDE_CONFIG_DIR: '/env/claude' };
    expect(resolveClaudeDir({ flag: '/flag', config: '/cfg', env, home })).toBe('/flag');
    expect(resolveClaudeDir({ flag: null, config: '/cfg', env, home })).toBe('/cfg');
    expect(resolveClaudeDir({ env, home })).toBe('/env/claude');
    expect(resolveClaudeDir({ env: {}, home })).toBe('/home/u/.claude');
  });
  it('expands a leading ~/', () => {
    expect(resolveClaudeDir({ flag: '~/alt', env: {}, home })).toBe('/home/u/alt');
  });
  it('ignores empty strings', () => {
    expect(resolveClaudeDir({ flag: '', config: '', env: { CLAUDE_CONFIG_DIR: '' }, home })).toBe('/home/u/.claude');
  });
});

describe('encodeProjectDir', () => {
  it('replaces every non-alphanumeric char with -', () => {
    expect(encodeProjectDir('/home/alec/code_projects/x.y')).toBe('-home-alec-code-projects-x-y');
    expect(encodeProjectDir('/a/b c/worktrees/T2')).toBe('-a-b-c-worktrees-T2');
  });
});

describe('path builders', () => {
  it('builds sessions/projects/transcript/subagents paths', () => {
    expect(sessionsDir('/c')).toBe('/c/sessions');
    expect(projectsDir('/c')).toBe('/c/projects');
    expect(transcriptPath('/c', '/w/p', 'sid')).toBe('/c/projects/-w-p/sid.jsonl');
    expect(subagentsDir('/c', '/w/p', 'sid')).toBe('/c/projects/-w-p/sid/subagents');
  });
});

describe('sessionIdFromTranscriptPath', () => {
  it('handles main transcripts', () => {
    expect(sessionIdFromTranscriptPath('/c/projects/-w-p/abc-123.jsonl')).toEqual({
      sessionId: 'abc-123',
      isSubagent: false,
    });
  });
  it('handles subagent transcripts', () => {
    expect(sessionIdFromTranscriptPath('/c/projects/-w-p/abc-123/subagents/agent-x1.jsonl')).toEqual({
      sessionId: 'abc-123',
      isSubagent: true,
    });
  });
});

describe('configDir / cacheDir', () => {
  it('uses XDG vars when set', () => {
    const env = { XDG_CONFIG_HOME: '/xdg/c', XDG_CACHE_HOME: '/xdg/k' };
    expect(configDir(env, '/h', 'linux')).toBe('/xdg/c/ccstatusboard');
    expect(cacheDir(env, '/h', 'darwin')).toBe('/xdg/k/ccstatusboard');
  });
  it('falls back per platform', () => {
    expect(configDir({}, '/h', 'linux')).toBe('/h/.config/ccstatusboard');
    expect(configDir({}, '/h', 'darwin')).toBe('/h/.config/ccstatusboard');
    expect(cacheDir({}, '/h', 'linux')).toBe('/h/.cache/ccstatusboard');
    expect(cacheDir({}, '/h', 'darwin')).toBe('/h/Library/Caches/ccstatusboard');
  });
});

describe('findTranscript', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ccsb-paths-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns the direct path when it exists', async () => {
    const p = transcriptPath(dir, '/w/p', 'sid1');
    await mkdir(join(dir, 'projects', '-w-p'), { recursive: true });
    await writeFile(p, '');
    expect(await findTranscript(dir, '/w/p', 'sid1')).toBe(p);
  });
  it('falls back to scanning projects/*/<sid>.jsonl (cwd changed mid-session)', async () => {
    await mkdir(join(dir, 'projects', '-other'), { recursive: true });
    const p = join(dir, 'projects', '-other', 'sid2.jsonl');
    await writeFile(p, '');
    expect(await findTranscript(dir, '/w/p', 'sid2')).toBe(p);
  });
  it('returns null when nothing matches or projects/ is missing', async () => {
    expect(await findTranscript(dir, '/w/p', 'nope')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/paths.test.ts`
Expected: FAIL with "Failed to resolve import './paths.js'" (or similar module-not-found error).

- [ ] **Step 3: Write minimal implementation**

`src/core/paths.ts`:
```ts
import { access, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';

function nonEmpty(v: string | null | undefined): v is string {
  return typeof v === 'string' && v.length > 0;
}

function expandHome(p: string, home: string): string {
  if (p === '~') return home;
  if (p.startsWith('~/')) return join(home, p.slice(2));
  return p;
}

export function resolveClaudeDir(opts: {
  flag?: string | null;
  config?: string | null;
  env?: NodeJS.ProcessEnv;
  home?: string;
}): string {
  const home = opts.home ?? homedir();
  const env = opts.env ?? process.env;
  const chosen = [opts.flag, opts.config, env.CLAUDE_CONFIG_DIR].find(nonEmpty);
  return chosen ? expandHome(chosen, home) : join(home, '.claude');
}

export function encodeProjectDir(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, '-');
}

export function sessionsDir(claudeDir: string): string {
  return join(claudeDir, 'sessions');
}

export function projectsDir(claudeDir: string): string {
  return join(claudeDir, 'projects');
}

export function transcriptPath(claudeDir: string, cwd: string, sessionId: string): string {
  return join(projectsDir(claudeDir), encodeProjectDir(cwd), `${sessionId}.jsonl`);
}

export function subagentsDir(claudeDir: string, cwd: string, sessionId: string): string {
  return join(projectsDir(claudeDir), encodeProjectDir(cwd), sessionId, 'subagents');
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export async function findTranscript(claudeDir: string, cwd: string, sessionId: string): Promise<string | null> {
  const direct = transcriptPath(claudeDir, cwd, sessionId);
  if (await exists(direct)) return direct;
  let dirs: string[];
  try {
    dirs = await readdir(projectsDir(claudeDir));
  } catch {
    return null;
  }
  for (const d of dirs) {
    const candidate = join(projectsDir(claudeDir), d, `${sessionId}.jsonl`);
    if (await exists(candidate)) return candidate;
  }
  return null;
}

export function configDir(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
  _platform: NodeJS.Platform = process.platform,
): string {
  const base = nonEmpty(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : join(home, '.config');
  return join(base, 'ccstatusboard');
}

export function cacheDir(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
  platform: NodeJS.Platform = process.platform,
): string {
  if (nonEmpty(env.XDG_CACHE_HOME)) return join(env.XDG_CACHE_HOME, 'ccstatusboard');
  if (platform === 'darwin') return join(home, 'Library', 'Caches', 'ccstatusboard');
  return join(home, '.cache', 'ccstatusboard');
}

export function sessionIdFromTranscriptPath(file: string): { sessionId: string; isSubagent: boolean } {
  const parent = dirname(file);
  if (basename(parent) === 'subagents') {
    return { sessionId: basename(dirname(parent)), isSubagent: true };
  }
  return { sessionId: basename(file, '.jsonl'), isSubagent: false };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/paths.test.ts`
Expected: PASS (all tests green).

- [ ] **Step 5: Commit**

```bash
git add src/core/paths.ts src/core/paths.test.ts
git commit -m "feat(core): add path resolution for claude, config and cache dirs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: JSONL line splitting and safe parsing

**Files:**
- Create: `src/core/jsonl.ts`
- Test: `src/core/jsonl.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export class LineSplitter { push(chunk: string): string[]; flush(): string[]; get pending(): string }
  export function safeParse(line: string): unknown | undefined
  ```
  `push` returns complete lines (no trailing `\n`, `\r` stripped, empty/whitespace-only lines skipped) and buffers the trailing partial line. `flush` returns the buffered remainder (if non-empty) and clears it. Task 13 relies on `push` never returning a partial line (Review Focus item 1).

- [ ] **Step 1: Write the failing test**

`src/core/jsonl.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { LineSplitter, safeParse } from './jsonl.js';

describe('LineSplitter', () => {
  it('returns complete lines and buffers the partial tail', () => {
    const s = new LineSplitter();
    expect(s.push('{"a":1}\n{"b":')).toEqual(['{"a":1}']);
    expect(s.pending).toBe('{"b":');
    expect(s.push('2}\n')).toEqual(['{"b":2}']);
    expect(s.pending).toBe('');
  });

  it('handles a line split across many chunks without emitting it early', () => {
    const s = new LineSplitter();
    const line = '{"type":"assistant","message":{"id":"m1"}}';
    const out: string[] = [];
    for (const ch of line) out.push(...s.push(ch));
    expect(out).toEqual([]);
    out.push(...s.push('\n'));
    expect(out).toEqual([line]);
  });

  it('skips empty lines and strips CR', () => {
    const s = new LineSplitter();
    expect(s.push('a\r\n\n  \nb\n')).toEqual(['a', 'b']);
  });

  it('flush returns the remainder once and clears it', () => {
    const s = new LineSplitter();
    s.push('x\ny');
    expect(s.flush()).toEqual(['y']);
    expect(s.flush()).toEqual([]);
    expect(s.pending).toBe('');
  });
});

describe('safeParse', () => {
  it('parses valid JSON', () => {
    expect(safeParse('{"a":1}')).toEqual({ a: 1 });
  });
  it('returns undefined for invalid JSON instead of throwing', () => {
    expect(safeParse('{"a":')).toBeUndefined();
    expect(safeParse('')).toBeUndefined();
    expect(safeParse('not json')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/jsonl.test.ts`
Expected: FAIL with "Failed to resolve import './jsonl.js'".

- [ ] **Step 3: Write minimal implementation**

`src/core/jsonl.ts`:
```ts
/** Splits a stream of text chunks into complete lines, buffering any partial trailing line. */
export class LineSplitter {
  private buffer = '';

  push(chunk: string): string[] {
    this.buffer += chunk;
    const parts = this.buffer.split('\n');
    this.buffer = parts.pop() ?? '';
    return parts.map(stripCr).filter(isNonBlank);
  }

  flush(): string[] {
    const rest = stripCr(this.buffer);
    this.buffer = '';
    return isNonBlank(rest) ? [rest] : [];
  }

  get pending(): string {
    return this.buffer;
  }
}

function stripCr(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

function isNonBlank(line: string): boolean {
  return line.trim().length > 0;
}

/** JSON.parse that never throws; returns undefined on bad input. */
export function safeParse(line: string): unknown | undefined {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/core/jsonl.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/jsonl.ts src/core/jsonl.test.ts
git commit -m "feat(core): add JSONL line splitter with partial-line buffering

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Config schema, file loading, CLI flag parsing

> **Ordering note:** `load.ts` imports `configDir` from Task 2 (`src/core/paths.ts`). Start this task only after Task 2 is committed. If both run in wave 1, run Task 4 after Task 2 completes.

**Files:**
- Create: `src/config/schema.ts`, `src/config/load.ts`
- Test: `src/config/schema.test.ts`, `src/config/load.test.ts`

**Interfaces:**
- Consumes: `Config`, `ThemeName`, `ColumnKey`, `SortKey` from `src/domain/types.ts` (Task 1); `configDir(env?, home?, platform?)` from `src/core/paths.ts` (Task 2).
- Produces:
  ```ts
  // schema.ts
  export const DEFAULT_CONFIG: Config
  export const configSchema  // zod strict object; output type is Config (satisfies z.ZodType<Config>)
  // load.ts
  export interface CliFlags { theme?: string; refresh?: string; endedHours?: string; sort?: string; claudeDir?: string; usageApi?: boolean; config?: string }
  export class ConfigError extends Error {}
  export async function loadConfig(opts: { flags: CliFlags; env?: NodeJS.ProcessEnv; home?: string; readFile?: (p: string) => Promise<string> }): Promise<Config>
  export function parseCliArgs(argv: string[]): { flags: CliFlags; help: boolean; version: boolean }
  ```
  `parseCliArgs` throws `ConfigError` on unknown flags. `loadConfig` throws `ConfigError` on invalid JSON, schema violations, or an explicit `--config` path that doesn't exist. A missing default config file means defaults.

- [ ] **Step 1: Write the failing schema test**

`src/config/schema.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { configSchema, DEFAULT_CONFIG } from './schema.js';

describe('configSchema', () => {
  it('parses {} to DEFAULT_CONFIG', () => {
    expect(configSchema.parse({})).toEqual(DEFAULT_CONFIG);
  });

  it('has the spec defaults', () => {
    expect(DEFAULT_CONFIG).toEqual({
      theme: 'default',
      refreshMs: 1000,
      usagePollSeconds: 60,
      endedWindowHours: 24,
      columns: ['status', 'name', 'model', 'branch', 'ctx', 'cost', 'last', 'uptime'],
      sort: 'status',
      showDetail: true,
      claudeDir: null,
      usageApi: true,
    });
  });

  it('returns a fresh columns array each parse', () => {
    const a = configSchema.parse({});
    a.columns.push('name');
    expect(configSchema.parse({}).columns).toHaveLength(8);
  });

  it('enforces minimums and enums', () => {
    expect(configSchema.safeParse({ refreshMs: 100 }).success).toBe(false);
    expect(configSchema.safeParse({ usagePollSeconds: 10 }).success).toBe(false);
    expect(configSchema.safeParse({ endedWindowHours: -1 }).success).toBe(false);
    expect(configSchema.safeParse({ theme: 'neon' }).success).toBe(false);
    expect(configSchema.safeParse({ sort: 'size' }).success).toBe(false);
    expect(configSchema.safeParse({ columns: ['bogus'] }).success).toBe(false);
    expect(configSchema.safeParse({ refreshMs: Number.NaN }).success).toBe(false);
  });

  it('rejects unknown keys', () => {
    expect(configSchema.safeParse({ colour: 'red' }).success).toBe(false);
  });

  it('accepts a full valid config', () => {
    const cfg = configSchema.parse({ theme: 'dracula', refreshMs: 500, claudeDir: '/x', columns: ['name', 'ctx'] });
    expect(cfg.theme).toBe('dracula');
    expect(cfg.columns).toEqual(['name', 'ctx']);
    expect(cfg.claudeDir).toBe('/x');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/config/schema.test.ts`
Expected: FAIL with "Failed to resolve import './schema.js'".

- [ ] **Step 3: Write the schema**

`src/config/schema.ts`:
```ts
import { z } from 'zod';
import type { ColumnKey, Config } from '../domain/types.js';

const ALL_COLUMNS: readonly ColumnKey[] = ['status', 'name', 'model', 'branch', 'ctx', 'cost', 'last', 'uptime'];

export const DEFAULT_CONFIG: Config = Object.freeze({
  theme: 'default',
  refreshMs: 1000,
  usagePollSeconds: 60,
  endedWindowHours: 24,
  columns: [...ALL_COLUMNS],
  sort: 'status',
  showDetail: true,
  claudeDir: null,
  usageApi: true,
}) as Config;

export const configSchema = z.strictObject({
  theme: z.enum(['default', 'mono', 'dracula', 'solarized']).default(DEFAULT_CONFIG.theme),
  refreshMs: z.number().int().min(250).default(DEFAULT_CONFIG.refreshMs),
  usagePollSeconds: z.number().int().min(30).default(DEFAULT_CONFIG.usagePollSeconds),
  endedWindowHours: z.number().min(0).default(DEFAULT_CONFIG.endedWindowHours),
  columns: z
    .array(z.enum(['status', 'name', 'model', 'branch', 'ctx', 'cost', 'last', 'uptime']))
    .min(1)
    .default(() => [...ALL_COLUMNS]),
  sort: z.enum(['status', 'activity', 'cost', 'ctx', 'name']).default(DEFAULT_CONFIG.sort),
  showDetail: z.boolean().default(DEFAULT_CONFIG.showDetail),
  claudeDir: z.string().nullable().default(DEFAULT_CONFIG.claudeDir),
  usageApi: z.boolean().default(DEFAULT_CONFIG.usageApi),
}) satisfies z.ZodType<Config>;
```

- [ ] **Step 4: Run schema test to verify it passes**

Run: `npx vitest run src/config/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing loader test**

`src/config/load.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, parseCliArgs } from './load.js';
import { DEFAULT_CONFIG } from './schema.js';

function enoent(): Error {
  return Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
}

function fakeFs(files: Record<string, string>) {
  return async (p: string): Promise<string> => {
    const v = files[p];
    if (v === undefined) throw enoent();
    return v;
  };
}

const home = '/home/u';
const env = {};
const defaultPath = '/home/u/.config/ccstatusboard/config.json';

describe('loadConfig', () => {
  it('returns defaults when the default config file is missing', async () => {
    expect(await loadConfig({ flags: {}, env, home, readFile: fakeFs({}) })).toEqual(DEFAULT_CONFIG);
  });

  it('reads the default file location (XDG respected)', async () => {
    const cfg = await loadConfig({
      flags: {},
      env: { XDG_CONFIG_HOME: '/xdg' },
      home,
      readFile: fakeFs({ '/xdg/ccstatusboard/config.json': '{"theme":"mono"}' }),
    });
    expect(cfg.theme).toBe('mono');
  });

  it('flags override file values', async () => {
    const cfg = await loadConfig({
      flags: { theme: 'solarized', refresh: '500', endedHours: '6', sort: 'cost', claudeDir: '/c', usageApi: false },
      env,
      home,
      readFile: fakeFs({ [defaultPath]: '{"theme":"mono","refreshMs":2000,"sort":"name"}' }),
    });
    expect(cfg).toMatchObject({
      theme: 'solarized',
      refreshMs: 500,
      endedWindowHours: 6,
      sort: 'cost',
      claudeDir: '/c',
      usageApi: false,
    });
  });

  it('uses --config path and errors if it does not exist', async () => {
    const cfg = await loadConfig({
      flags: { config: '/x.json' },
      env,
      home,
      readFile: fakeFs({ '/x.json': '{"endedWindowHours":2}' }),
    });
    expect(cfg.endedWindowHours).toBe(2);
    await expect(loadConfig({ flags: { config: '/missing.json' }, env, home, readFile: fakeFs({}) })).rejects.toThrow(
      ConfigError,
    );
  });

  it('throws ConfigError on invalid JSON with the path in the message', async () => {
    await expect(
      loadConfig({ flags: {}, env, home, readFile: fakeFs({ [defaultPath]: '{nope' }) }),
    ).rejects.toThrow(/config\.json/);
  });

  it('throws ConfigError on schema violations, including bad numeric flags', async () => {
    await expect(
      loadConfig({ flags: {}, env, home, readFile: fakeFs({ [defaultPath]: '{"refreshMs":10}' }) }),
    ).rejects.toThrow(ConfigError);
    await expect(loadConfig({ flags: { refresh: 'abc' }, env, home, readFile: fakeFs({}) })).rejects.toThrow(
      ConfigError,
    );
  });
});

describe('parseCliArgs', () => {
  it('parses all flags', () => {
    const r = parseCliArgs([
      '--theme',
      'mono',
      '--refresh',
      '500',
      '--ended-hours',
      '3',
      '--sort',
      'ctx',
      '--claude-dir',
      '/c',
      '--no-usage-api',
      '--config',
      '/x.json',
    ]);
    expect(r.flags).toEqual({
      theme: 'mono',
      refresh: '500',
      endedHours: '3',
      sort: 'ctx',
      claudeDir: '/c',
      usageApi: false,
      config: '/x.json',
    });
    expect(r.help).toBe(false);
    expect(r.version).toBe(false);
  });

  it('parses help and version (long and short)', () => {
    expect(parseCliArgs(['--help']).help).toBe(true);
    expect(parseCliArgs(['-h']).help).toBe(true);
    expect(parseCliArgs(['--version']).version).toBe(true);
    expect(parseCliArgs(['-v']).version).toBe(true);
  });

  it('returns empty flags for no args', () => {
    expect(parseCliArgs([]).flags).toEqual({});
  });

  it('throws ConfigError on unknown flags', () => {
    expect(() => parseCliArgs(['--bogus'])).toThrow(ConfigError);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run src/config/load.test.ts`
Expected: FAIL with "Failed to resolve import './load.js'".

- [ ] **Step 7: Write the loader**

`src/config/load.ts`:
```ts
import { readFile as fsReadFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { configDir } from '../core/paths.js';
import type { Config } from '../domain/types.js';
import { configSchema } from './schema.js';

export interface CliFlags {
  theme?: string;
  refresh?: string;
  endedHours?: string;
  sort?: string;
  claudeDir?: string;
  usageApi?: boolean;
  config?: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

function isEnoent(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'ENOENT';
}

async function readConfigFile(
  path: string,
  explicit: boolean,
  readFile: (p: string) => Promise<string>,
): Promise<Record<string, unknown>> {
  let text: string;
  try {
    text = await readFile(path);
  } catch (e) {
    if (isEnoent(e) && !explicit) return {};
    throw new ConfigError(`Cannot read config file ${path}: ${(e as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new ConfigError(`Invalid JSON in ${path}: ${(e as Error).message}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ConfigError(`Config file ${path} must contain a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function flagOverrides(flags: CliFlags): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  if (flags.theme !== undefined) o.theme = flags.theme;
  if (flags.refresh !== undefined) o.refreshMs = Number(flags.refresh);
  if (flags.endedHours !== undefined) o.endedWindowHours = Number(flags.endedHours);
  if (flags.sort !== undefined) o.sort = flags.sort;
  if (flags.claudeDir !== undefined) o.claudeDir = flags.claudeDir;
  if (flags.usageApi !== undefined) o.usageApi = flags.usageApi;
  return o;
}

export async function loadConfig(opts: {
  flags: CliFlags;
  env?: NodeJS.ProcessEnv;
  home?: string;
  readFile?: (p: string) => Promise<string>;
}): Promise<Config> {
  const readFile = opts.readFile ?? ((p: string) => fsReadFile(p, 'utf8'));
  const explicit = opts.flags.config !== undefined;
  const path = opts.flags.config ?? join(configDir(opts.env, opts.home), 'config.json');
  const fileValues = await readConfigFile(path, explicit, readFile);
  const result = configSchema.safeParse({ ...fileValues, ...flagOverrides(opts.flags) });
  if (!result.success) {
    throw new ConfigError(`Invalid configuration (${path}):\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

export function parseCliArgs(argv: string[]): { flags: CliFlags; help: boolean; version: boolean } {
  let values: Record<string, string | boolean | undefined>;
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: {
        theme: { type: 'string' },
        refresh: { type: 'string' },
        'ended-hours': { type: 'string' },
        sort: { type: 'string' },
        'claude-dir': { type: 'string' },
        'no-usage-api': { type: 'boolean' },
        config: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    }));
  } catch (e) {
    throw new ConfigError((e as Error).message);
  }
  const flags: CliFlags = {};
  const str = (k: string): string | undefined => (typeof values[k] === 'string' ? (values[k] as string) : undefined);
  const set = <K extends keyof CliFlags>(key: K, v: CliFlags[K] | undefined): void => {
    if (v !== undefined) flags[key] = v;
  };
  set('theme', str('theme'));
  set('refresh', str('refresh'));
  set('endedHours', str('ended-hours'));
  set('sort', str('sort'));
  set('claudeDir', str('claude-dir'));
  set('config', str('config'));
  if (values['no-usage-api'] === true) flags.usageApi = false;
  return { flags, help: values.help === true, version: values.version === true };
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run src/config`
Expected: PASS (schema and load tests green).

- [ ] **Step 9: Commit**

```bash
git add src/config
git commit -m "feat(config): add zod config schema, file loader and CLI flag parsing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Process liveness check (with PID-reuse guard)

**Files:**
- Create: `src/collectors/liveness.ts`
- Test: `src/collectors/liveness.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export interface LivenessDeps { kill?: (pid: number, sig: 0) => void; readProcStat?: (pid: number) => string | null; platform?: NodeJS.Platform }
  export function isAlive(pid: number, procStart: string | undefined, deps?: LivenessDeps): boolean
  export function procStartFromStat(stat: string): string | undefined
  ```
  Rules:
  - Non-positive or non-integer pid → `false`. Never signal pid 0 or negative pids, which target process groups.
  - `kill(pid, 0)` succeeding or throwing `EPERM` → alive. Any other error, e.g. `ESRCH` → dead.
  - On Linux with `procStart`, the process is alive only if `/proc/<pid>/stat` field 22 equals `procStart`. An unreadable or unparseable stat falls back to the kill result.

- [ ] **Step 1: Write the failing test**

`src/collectors/liveness.test.ts`:
```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isAlive, procStartFromStat } from './liveness.js';

function errno(code: string): Error {
  return Object.assign(new Error(code), { code });
}

// Real-world shape: comm may contain spaces and parens.
const STAT = '2203789 (claude (main) x) S 1 2203789 2203789 34816 2203789 4194304 1 2 3 4 5 6 7 8 20 0 12 0 9402548 1000 200';

describe('procStartFromStat', () => {
  it('reads field 22 after the last ")"', () => {
    expect(procStartFromStat(STAT)).toBe('9402548');
  });
  it('returns undefined for garbage', () => {
    expect(procStartFromStat('garbage')).toBeUndefined();
    expect(procStartFromStat('1 (x) S 1 2')).toBeUndefined();
  });
});

describe('isAlive', () => {
  const ok = (): void => {};

  it('treats a successful kill(pid,0) as alive', () => {
    expect(isAlive(42, undefined, { kill: ok, platform: 'darwin' })).toBe(true);
  });

  it('treats EPERM as alive (process exists, owned by another user)', () => {
    const kill = (): void => {
      throw errno('EPERM');
    };
    expect(isAlive(42, undefined, { kill, platform: 'darwin' })).toBe(true);
  });

  it('treats ESRCH as dead', () => {
    const kill = (): void => {
      throw errno('ESRCH');
    };
    expect(isAlive(42, '9402548', { kill, platform: 'linux', readProcStat: () => STAT })).toBe(false);
  });

  it('never signals pid <= 0 or non-integer pids', () => {
    let called = false;
    const kill = (): void => {
      called = true;
    };
    expect(isAlive(0, undefined, { kill })).toBe(false);
    expect(isAlive(-1, undefined, { kill })).toBe(false);
    expect(isAlive(1.5, undefined, { kill })).toBe(false);
    expect(called).toBe(false);
  });

  it('Linux: alive when procStart matches /proc stat field 22', () => {
    expect(isAlive(2203789, '9402548', { kill: ok, platform: 'linux', readProcStat: () => STAT })).toBe(true);
  });

  it('Linux: a reused PID (procStart mismatch) is treated as dead', () => {
    expect(isAlive(2203789, '1111111', { kill: ok, platform: 'linux', readProcStat: () => STAT })).toBe(false);
  });

  it('Linux: unreadable stat falls back to the kill result', () => {
    expect(isAlive(2203789, '9402548', { kill: ok, platform: 'linux', readProcStat: () => null })).toBe(true);
  });

  it('macOS: ignores procStart', () => {
    const readProcStat = (): string => {
      throw new Error('must not be called');
    };
    expect(isAlive(42, '1111111', { kill: ok, platform: 'darwin', readProcStat })).toBe(true);
  });

  it('works against the real current process', () => {
    expect(isAlive(process.pid, undefined)).toBe(true);
  });

  it.runIf(process.platform === 'linux')('Linux: real /proc check for current process', () => {
    const stat = readFileSync(`/proc/${process.pid}/stat`, 'utf8');
    const start = procStartFromStat(stat);
    expect(start).toBeDefined();
    expect(isAlive(process.pid, start)).toBe(true);
    expect(isAlive(process.pid, '1')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/collectors/liveness.test.ts`
Expected: FAIL with "Failed to resolve import './liveness.js'".

- [ ] **Step 3: Write minimal implementation**

`src/collectors/liveness.ts`:
```ts
import { readFileSync } from 'node:fs';

export interface LivenessDeps {
  kill?: (pid: number, sig: 0) => void;
  readProcStat?: (pid: number) => string | null;
  platform?: NodeJS.Platform;
}

function defaultReadProcStat(pid: number): string | null {
  try {
    return readFileSync(`/proc/${pid}/stat`, 'utf8');
  } catch {
    return null;
  }
}

/** Returns /proc/<pid>/stat field 22 (starttime in clock ticks). */
export function procStartFromStat(stat: string): string | undefined {
  const close = stat.lastIndexOf(')');
  if (close === -1) return undefined;
  // Fields after "comm)" start at field 3 (state); field 22 is index 19.
  const fields = stat
    .slice(close + 1)
    .trim()
    .split(/\s+/);
  const value = fields[19];
  return value !== undefined && /^\d+$/.test(value) ? value : undefined;
}

export function isAlive(pid: number, procStart: string | undefined, deps: LivenessDeps = {}): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  const kill = deps.kill ?? ((p: number, s: 0) => void process.kill(p, s));
  try {
    kill(pid, 0);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EPERM') return false;
  }
  const platform = deps.platform ?? process.platform;
  if (platform !== 'linux' || !procStart) return true;
  const stat = (deps.readProcStat ?? defaultReadProcStat)(pid);
  if (stat === null) return true;
  const start = procStartFromStat(stat);
  return start === undefined ? true : start === procStart;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/collectors/liveness.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/collectors/liveness.ts src/collectors/liveness.test.ts
git commit -m "feat(collectors): add process liveness check with /proc PID-reuse guard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: OAuth credentials reader (read-only)

**Files:**
- Create: `src/collectors/credentials.ts`
- Test: `src/collectors/credentials.test.ts`

**Interfaces:**
- Consumes: nothing. JSON parsing is local, so this task has no dependency on Task 3.
- Produces:
  ```ts
  export type CredentialsResult = { kind: 'ok'; accessToken: string; expiresAt?: number } | { kind: 'missing' } | { kind: 'expired'; expiresAt: number }
  export interface CredentialsDeps { readFile?: (p: string) => Promise<string>; exec?: (cmd: string, args: string[], timeoutMs: number) => Promise<string>; platform?: NodeJS.Platform; now?: () => number }
  export async function readCredentials(claudeDir: string, deps?: CredentialsDeps): Promise<CredentialsResult>
  ```
  Source order:
  1. `<claudeDir>/.credentials.json` → `claudeAiOauth.accessToken` (non-empty string) and `claudeAiOauth.expiresAt` (epoch ms, optional).
  2. On darwin, if the file is missing or invalid: `exec('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], 2000)`, parsed as the same JSON.

  `expiresAt < now()` → `expired`. The reader never writes anything and never logs the token.

- [ ] **Step 1: Write the failing test**

`src/collectors/credentials.test.ts`:
```ts
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readCredentials } from './credentials.js';

const NOW = Date.parse('2026-10-11T12:00:00Z');
const now = (): number => NOW;
const creds = (accessToken: unknown, expiresAt?: unknown): string =>
  JSON.stringify({ claudeAiOauth: { accessToken, refreshToken: 'r-tok', expiresAt } });

describe('readCredentials (file)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ccsb-creds-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reads accessToken and expiresAt from .credentials.json', async () => {
    await writeFile(join(dir, '.credentials.json'), creds('tok-abc', NOW + 3_600_000));
    expect(await readCredentials(dir, { now, platform: 'linux' })).toEqual({
      kind: 'ok',
      accessToken: 'tok-abc',
      expiresAt: NOW + 3_600_000,
    });
  });

  it('ok without expiresAt', async () => {
    await writeFile(join(dir, '.credentials.json'), creds('tok-abc'));
    expect(await readCredentials(dir, { now, platform: 'linux' })).toEqual({ kind: 'ok', accessToken: 'tok-abc' });
  });

  it('reports expired tokens', async () => {
    await writeFile(join(dir, '.credentials.json'), creds('tok-abc', NOW - 1));
    expect(await readCredentials(dir, { now, platform: 'linux' })).toEqual({ kind: 'expired', expiresAt: NOW - 1 });
  });

  it('missing file on linux → missing (no keychain attempt)', async () => {
    let execCalled = false;
    const exec = async (): Promise<string> => {
      execCalled = true;
      return '';
    };
    expect(await readCredentials(dir, { now, platform: 'linux', exec })).toEqual({ kind: 'missing' });
    expect(execCalled).toBe(false);
  });

  it('malformed JSON or empty token → missing', async () => {
    await writeFile(join(dir, '.credentials.json'), '{nope');
    expect(await readCredentials(dir, { now, platform: 'linux' })).toEqual({ kind: 'missing' });
    await writeFile(join(dir, '.credentials.json'), creds(''));
    expect(await readCredentials(dir, { now, platform: 'linux' })).toEqual({ kind: 'missing' });
    await writeFile(join(dir, '.credentials.json'), JSON.stringify({ other: 1 }));
    expect(await readCredentials(dir, { now, platform: 'linux' })).toEqual({ kind: 'missing' });
  });
});

describe('readCredentials (macOS keychain fallback)', () => {
  const noFile = async (): Promise<string> => {
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  };

  it('uses the security CLI with the right arguments when the file is missing', async () => {
    const calls: Array<{ cmd: string; args: string[]; timeoutMs: number }> = [];
    const exec = async (cmd: string, args: string[], timeoutMs: number): Promise<string> => {
      calls.push({ cmd, args, timeoutMs });
      return creds('tok-kc', NOW + 1000) + '\n';
    };
    const r = await readCredentials('/c', { now, platform: 'darwin', readFile: noFile, exec });
    expect(r).toEqual({ kind: 'ok', accessToken: 'tok-kc', expiresAt: NOW + 1000 });
    expect(calls).toEqual([
      { cmd: 'security', args: ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], timeoutMs: 2000 },
    ]);
  });

  it('prefers the file over the keychain', async () => {
    const exec = async (): Promise<string> => {
      throw new Error('must not be called');
    };
    const readFile = async (): Promise<string> => creds('tok-file');
    expect(await readCredentials('/c', { now, platform: 'darwin', readFile, exec })).toEqual({
      kind: 'ok',
      accessToken: 'tok-file',
    });
  });

  it('keychain failure or timeout → missing', async () => {
    const exec = async (): Promise<string> => {
      throw new Error('timed out');
    };
    expect(await readCredentials('/c', { now, platform: 'darwin', readFile: noFile, exec })).toEqual({
      kind: 'missing',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/collectors/credentials.test.ts`
Expected: FAIL with "Failed to resolve import './credentials.js'".

- [ ] **Step 3: Write minimal implementation**

`src/collectors/credentials.ts`:
```ts
import { execFile } from 'node:child_process';
import { readFile as fsReadFile } from 'node:fs/promises';
import { join } from 'node:path';

export type CredentialsResult =
  | { kind: 'ok'; accessToken: string; expiresAt?: number }
  | { kind: 'missing' }
  | { kind: 'expired'; expiresAt: number };

export interface CredentialsDeps {
  readFile?: (p: string) => Promise<string>;
  exec?: (cmd: string, args: string[], timeoutMs: number) => Promise<string>;
  platform?: NodeJS.Platform;
  now?: () => number;
}

const KEYCHAIN_SERVICE = 'Claude Code-credentials';
const KEYCHAIN_TIMEOUT_MS = 2000;

interface OAuthToken {
  accessToken: string;
  expiresAt?: number;
}

function defaultExec(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, encoding: 'utf8' }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

function extractToken(raw: string): OAuthToken | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    return undefined;
  }
  const oauth = (parsed as { claudeAiOauth?: unknown } | null)?.claudeAiOauth as
    | { accessToken?: unknown; expiresAt?: unknown }
    | undefined;
  if (!oauth || typeof oauth.accessToken !== 'string' || oauth.accessToken.length === 0) return undefined;
  return typeof oauth.expiresAt === 'number'
    ? { accessToken: oauth.accessToken, expiresAt: oauth.expiresAt }
    : { accessToken: oauth.accessToken };
}

async function fromFile(claudeDir: string, readFile: (p: string) => Promise<string>): Promise<OAuthToken | undefined> {
  try {
    return extractToken(await readFile(join(claudeDir, '.credentials.json')));
  } catch {
    return undefined;
  }
}

async function fromKeychain(
  exec: (cmd: string, args: string[], timeoutMs: number) => Promise<string>,
): Promise<OAuthToken | undefined> {
  try {
    const out = await exec('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'], KEYCHAIN_TIMEOUT_MS);
    return extractToken(out);
  } catch {
    return undefined;
  }
}

/** Reads the Claude Code OAuth token. Read-only: never refreshes or writes credentials. */
export async function readCredentials(claudeDir: string, deps: CredentialsDeps = {}): Promise<CredentialsResult> {
  const readFile = deps.readFile ?? ((p: string) => fsReadFile(p, 'utf8'));
  const platform = deps.platform ?? process.platform;
  const now = deps.now ?? Date.now;

  let token = await fromFile(claudeDir, readFile);
  if (!token && platform === 'darwin') token = await fromKeychain(deps.exec ?? defaultExec);
  if (!token) return { kind: 'missing' };
  if (token.expiresAt !== undefined && token.expiresAt < now()) {
    return { kind: 'expired', expiresAt: token.expiresAt };
  }
  return token.expiresAt === undefined
    ? { kind: 'ok', accessToken: token.accessToken }
    : { kind: 'ok', accessToken: token.accessToken, expiresAt: token.expiresAt };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/collectors/credentials.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/collectors/credentials.ts src/collectors/credentials.test.ts
git commit -m "feat(collectors): add read-only OAuth credentials reader with macOS keychain fallback

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

---

### Task 7: Usage dedup and per-record cost

**Files:**
- Create: `src/domain/dedup.ts`, `src/domain/cost.ts`
- Test: `src/domain/dedup.test.ts`, `src/domain/cost.test.ts`

**Interfaces:**
- Consumes: `TokenCounts`, `ModelPrice` from `src/domain/types.ts` (Task 1).
- Produces:
  - `dedupKey(messageId: string, requestId?: string): string`
  - `class DedupSet { has(key: string): boolean; add(key: string): boolean; get size(): number }`. `add` returns `true` only when the key is new.
  - `recordCost(tokens: TokenCounts, price: ModelPrice | undefined): number | null`. Returns `null` when `price` is undefined.
  - `sumCost(a: number | null, b: number | null): number | null`. Returns `null` only when both are `null`; otherwise `(a ?? 0) + (b ?? 0)`.

Cost formula (spec §3.5): `input×input + output×output + cacheWrite5m×cacheWrite + cacheWrite1h×(cacheWrite1h ?? cacheWrite) + cacheRead×cacheRead`.

- [ ] **Step 1: Write the failing dedup test**

`src/domain/dedup.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { DedupSet, dedupKey } from './dedup.js';

describe('dedupKey', () => {
  it('joins message id and request id with a colon', () => {
    expect(dedupKey('msg_1', 'req_9')).toBe('msg_1:req_9');
  });
  it('uses the message id alone when request id is missing or empty', () => {
    expect(dedupKey('msg_1')).toBe('msg_1');
    expect(dedupKey('msg_1', '')).toBe('msg_1');
  });
});

describe('DedupSet', () => {
  it('add returns true only the first time a key is seen', () => {
    const s = new DedupSet();
    expect(s.add('a')).toBe(true);
    expect(s.add('a')).toBe(false);
    expect(s.add('b')).toBe(true);
    expect(s.size).toBe(2);
  });
  it('has reflects added keys', () => {
    const s = new DedupSet();
    expect(s.has('x')).toBe(false);
    s.add('x');
    expect(s.has('x')).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/domain/dedup.test.ts`
Expected: FAIL with `Failed to load url ./dedup.js` (module does not exist).

- [ ] **Step 3: Implement dedup**

`src/domain/dedup.ts`:
```ts
// Usage dedup: one API response is written as several transcript lines that
// share message.id and repeat the same usage block (spec §3.2).

export function dedupKey(messageId: string, requestId?: string): string {
  return requestId ? `${messageId}:${requestId}` : messageId;
}

export class DedupSet {
  private readonly keys = new Set<string>();

  has(key: string): boolean {
    return this.keys.has(key);
  }

  /** Returns true if the key was new. */
  add(key: string): boolean {
    if (this.keys.has(key)) return false;
    this.keys.add(key);
    return true;
  }

  get size(): number {
    return this.keys.size;
  }
}
```

- [ ] **Step 4: Run dedup tests to verify they pass**

Run: `npx vitest run src/domain/dedup.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing cost test**

`src/domain/cost.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { recordCost, sumCost } from './cost.js';
import type { ModelPrice, TokenCounts } from './types.js';

const tokens: TokenCounts = { input: 1000, output: 2000, cacheWrite5m: 4000, cacheWrite1h: 1000, cacheRead: 10_000 };

const opus: ModelPrice = {
  input: 5e-6,
  output: 25e-6,
  cacheWrite: 6.25e-6,
  cacheWrite1h: 10e-6,
  cacheRead: 0.5e-6,
};

describe('recordCost', () => {
  it('prices every token class, using the 1h cache-write price when present', () => {
    // 0.005 + 0.05 + 0.025 + 0.01 + 0.005
    expect(recordCost(tokens, opus)).toBeCloseTo(0.095, 10);
  });
  it('falls back to the 5m cache-write price for 1h writes when cacheWrite1h is missing', () => {
    const { cacheWrite1h: _drop, ...noOneHour } = opus;
    // 0.005 + 0.05 + 0.025 + 0.00625 + 0.005
    expect(recordCost(tokens, noOneHour)).toBeCloseTo(0.09125, 10);
  });
  it('returns null for an unknown model (price undefined)', () => {
    expect(recordCost(tokens, undefined)).toBeNull();
  });
  it('returns 0 for zero tokens', () => {
    expect(recordCost({ input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 }, opus)).toBe(0);
  });
});

describe('sumCost', () => {
  it('is null only when both sides are null', () => {
    expect(sumCost(null, null)).toBeNull();
  });
  it('treats a single null as 0', () => {
    expect(sumCost(1.5, null)).toBe(1.5);
    expect(sumCost(null, 2)).toBe(2);
  });
  it('adds two numbers', () => {
    expect(sumCost(1.25, 2.5)).toBe(3.75);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run src/domain/cost.test.ts`
Expected: FAIL with `Failed to load url ./cost.js`.

- [ ] **Step 7: Implement cost**

`src/domain/cost.ts`:
```ts
import type { ModelPrice, TokenCounts } from './types.js';

/** USD cost of one usage record; null when the model has no known price. */
export function recordCost(tokens: TokenCounts, price: ModelPrice | undefined): number | null {
  if (!price) return null;
  return (
    tokens.input * price.input +
    tokens.output * price.output +
    tokens.cacheWrite5m * price.cacheWrite +
    tokens.cacheWrite1h * (price.cacheWrite1h ?? price.cacheWrite) +
    tokens.cacheRead * price.cacheRead
  );
}

/** Adds two costs; null only when both are null (an unknown side counts as 0). */
export function sumCost(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null;
  return (a ?? 0) + (b ?? 0);
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run src/domain/dedup.test.ts src/domain/cost.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 9: Commit**

```bash
git add src/domain/dedup.ts src/domain/dedup.test.ts src/domain/cost.ts src/domain/cost.test.ts
git commit -m "feat(domain): add usage dedup set and per-record cost

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Context window usage

**Files:**
- Create: `src/domain/context.ts`
- Test: `src/domain/context.test.ts`

**Interfaces:**
- Consumes: `ModelPrice` from `src/domain/types.ts` (Task 1).
- Produces:
  - `DEFAULT_CONTEXT_WINDOW = 200_000`
  - `contextWindowFor(model: string | undefined, price: ModelPrice | undefined): number`. A model id ending in `[1m]` gives `1_000_000`; otherwise `price.maxInputTokens`; otherwise `200_000`.
  - `contextPercent(tokens: number, window: number): number`. Returns `Math.round(tokens / window * 100)`, clamped at 0 below and **not** clamped above. A window ≤ 0 gives 0.
  - `interface ContextInputs { lastUsage?: { timestamp: number; contextTokens: number }; lastCompact?: { timestamp: number; postTokens: number } }`
  - `currentContextTokens(i: ContextInputs): number | undefined`. If the compact is newer than the last usage (or there is no usage), returns `postTokens`; otherwise the usage's `contextTokens`; `undefined` if neither exists.

- [ ] **Step 1: Write the failing test**

`src/domain/context.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONTEXT_WINDOW, contextPercent, contextWindowFor, currentContextTokens } from './context.js';
import type { ModelPrice } from './types.js';

const price = (maxInputTokens?: number): ModelPrice => ({
  input: 1e-6,
  output: 1e-6,
  cacheWrite: 1e-6,
  cacheRead: 1e-7,
  ...(maxInputTokens === undefined ? {} : { maxInputTokens }),
});

describe('contextWindowFor', () => {
  it('uses 1,000,000 for [1m] model ids regardless of price', () => {
    expect(contextWindowFor('claude-sonnet-5-5[1m]', price(200_000))).toBe(1_000_000);
  });
  it('uses LiteLLM max_input_tokens when known', () => {
    expect(contextWindowFor('claude-opus-5-5', price(500_000))).toBe(500_000);
  });
  it('falls back to 200,000 when the model or its window is unknown', () => {
    expect(contextWindowFor('claude-opus-5-5', price())).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(contextWindowFor('mystery', undefined)).toBe(200_000);
    expect(contextWindowFor(undefined, undefined)).toBe(200_000);
  });
});

describe('contextPercent', () => {
  it('rounds to the nearest whole percent', () => {
    expect(contextPercent(122_000, 200_000)).toBe(61);
    expect(contextPercent(1_000, 200_000)).toBe(1); // 0.5 rounds up
  });
  it('does not clamp above 100', () => {
    expect(contextPercent(210_000, 200_000)).toBe(105);
  });
  it('clamps negatives and zero windows to 0', () => {
    expect(contextPercent(-5, 200_000)).toBe(0);
    expect(contextPercent(1000, 0)).toBe(0);
  });
});

describe('currentContextTokens', () => {
  it('returns undefined with no data', () => {
    expect(currentContextTokens({})).toBeUndefined();
  });
  it('uses the last usage when there is no compact', () => {
    expect(currentContextTokens({ lastUsage: { timestamp: 10, contextTokens: 150_000 } })).toBe(150_000);
  });
  it('uses postTokens when a compact boundary is newer than the last usage', () => {
    expect(
      currentContextTokens({
        lastUsage: { timestamp: 10, contextTokens: 180_000 },
        lastCompact: { timestamp: 20, postTokens: 30_000 },
      }),
    ).toBe(30_000);
  });
  it('uses the usage again once a newer assistant record arrives after the compact', () => {
    expect(
      currentContextTokens({
        lastUsage: { timestamp: 30, contextTokens: 42_000 },
        lastCompact: { timestamp: 20, postTokens: 30_000 },
      }),
    ).toBe(42_000);
  });
  it('uses postTokens when only a compact exists', () => {
    expect(currentContextTokens({ lastCompact: { timestamp: 5, postTokens: 12_000 } })).toBe(12_000);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/domain/context.test.ts`
Expected: FAIL with `Failed to load url ./context.js`.

- [ ] **Step 3: Implement context**

`src/domain/context.ts`:
```ts
import type { ModelPrice } from './types.js';

export const DEFAULT_CONTEXT_WINDOW = 200_000;
const ONE_MILLION = 1_000_000;

export function contextWindowFor(model: string | undefined, price: ModelPrice | undefined): number {
  if (model?.endsWith('[1m]')) return ONE_MILLION;
  return price?.maxInputTokens ?? DEFAULT_CONTEXT_WINDOW;
}

export function contextPercent(tokens: number, window: number): number {
  if (window <= 0) return 0;
  return Math.max(0, Math.round((tokens / window) * 100));
}

export interface ContextInputs {
  lastUsage?: { timestamp: number; contextTokens: number };
  lastCompact?: { timestamp: number; postTokens: number };
}

/** Context tokens now: compact postTokens win until a newer assistant record arrives (spec §4.1). */
export function currentContextTokens(i: ContextInputs): number | undefined {
  const { lastUsage, lastCompact } = i;
  if (lastCompact && (!lastUsage || lastCompact.timestamp > lastUsage.timestamp)) {
    return lastCompact.postTokens;
  }
  return lastUsage?.contextTokens;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/domain/context.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/domain/context.ts src/domain/context.test.ts
git commit -m "feat(domain): add context window size and percent calculation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Time windows and fallback 5-hour block derivation

**Files:**
- Create: `src/domain/windows.ts`
- Test: `src/domain/windows.test.ts`

**Interfaces:**
- Consumes: `TimeWindow` from `src/domain/types.ts` (Task 1).
- Produces:
  - `FIVE_HOURS_MS = 18_000_000`, `SEVEN_DAYS_MS = 604_800_000`
  - `blockWindowFromLimit(resetsAt: number, now: number): TimeWindow` → `{ start: resetsAt - 5h, end: now }`
  - `weekWindowFromLimit(resetsAt: number, now: number): TimeWindow` → `{ start: resetsAt - 7d, end: now }`
  - `todayWindow(now: number): TimeWindow`: local midnight to now
  - `monthWindow(now: number): TimeWindow`: local first of the month 00:00 to now
  - `rollingWeekWindow(now: number): TimeWindow` → `{ start: now - 7d, end: now }`
  - `deriveCurrentBlock(timestamps: number[], now: number): TimeWindow | null`. Input sorted ascending. Returns `{ start, end: now }` for the block containing `now`, else `null`.

**Block rules (ccusage-style, spec §4.2), made exact here:**
- A block starts at its first record's timestamp floored to the UTC hour and covers the half-open range `[start, start + 5h)`.
- A record starts a new block if its timestamp is `>= start + 5h` (so a record exactly at the block end opens a new block), or if it is more than 5h after the previous record.
- The current block is the last block, if `now < start + 5h`. Otherwise `null`. Timestamps after `now` are ignored.

All windows end at `now`, so a window total covers everything up to the present.

- [ ] **Step 1: Write the failing test**

`src/domain/windows.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  FIVE_HOURS_MS,
  SEVEN_DAYS_MS,
  blockWindowFromLimit,
  deriveCurrentBlock,
  monthWindow,
  rollingWeekWindow,
  todayWindow,
  weekWindowFromLimit,
} from './windows.js';

const H = 3_600_000;
const M = 60_000;
// UTC-based instants so block flooring (UTC hour) is timezone independent.
const utc = (iso: string) => Date.parse(iso);

describe('constants', () => {
  it('have the expected durations', () => {
    expect(FIVE_HOURS_MS).toBe(5 * H);
    expect(SEVEN_DAYS_MS).toBe(7 * 24 * H);
  });
});

describe('limit-based windows', () => {
  it('block starts 5h before resetsAt and ends now', () => {
    const now = utc('2026-10-11T14:00:00Z');
    const resetsAt = utc('2026-10-11T16:14:00Z');
    expect(blockWindowFromLimit(resetsAt, now)).toEqual({ start: utc('2026-10-11T11:14:00Z'), end: now });
  });
  it('week starts 7d before resetsAt and ends now', () => {
    const now = utc('2026-10-11T14:00:00Z');
    const resetsAt = utc('2026-10-15T09:00:00Z');
    expect(weekWindowFromLimit(resetsAt, now)).toEqual({ start: utc('2026-10-08T09:00:00Z'), end: now });
  });
  it('rolling week is the last 7 days', () => {
    const now = utc('2026-10-11T14:00:00Z');
    expect(rollingWeekWindow(now)).toEqual({ start: now - SEVEN_DAYS_MS, end: now });
  });
});

describe('calendar windows (local time)', () => {
  // Built with local-time constructors so the test passes in any TZ.
  it('today starts at local midnight', () => {
    const now = new Date(2026, 9, 11, 14, 32, 7).getTime();
    expect(todayWindow(now)).toEqual({ start: new Date(2026, 9, 11, 0, 0, 0, 0).getTime(), end: now });
  });
  it('today at exactly midnight starts at that midnight', () => {
    const now = new Date(2026, 9, 11, 0, 0, 0, 0).getTime();
    expect(todayWindow(now).start).toBe(now);
  });
  it('month starts on the local first at 00:00', () => {
    const now = new Date(2026, 9, 11, 14, 32, 7).getTime();
    expect(monthWindow(now)).toEqual({ start: new Date(2026, 9, 1, 0, 0, 0, 0).getTime(), end: now });
  });
  it('month on the 1st starts that same day', () => {
    const now = new Date(2026, 0, 1, 8, 0).getTime();
    expect(monthWindow(now).start).toBe(new Date(2026, 0, 1).getTime());
  });
});

describe('deriveCurrentBlock', () => {
  it('returns null with no records', () => {
    expect(deriveCurrentBlock([], utc('2026-10-11T12:00:00Z'))).toBeNull();
  });

  it('floors the block start to the UTC hour of the first record', () => {
    const now = utc('2026-10-11T11:00:00Z');
    const ts = [utc('2026-10-11T09:47:12Z'), utc('2026-10-11T10:30:00Z')];
    expect(deriveCurrentBlock(ts, now)).toEqual({ start: utc('2026-10-11T09:00:00Z'), end: now });
  });

  it('returns null when now is at or past the end of the last block', () => {
    const ts = [utc('2026-10-11T09:10:00Z')];
    expect(deriveCurrentBlock(ts, utc('2026-10-11T14:00:00Z'))).toBeNull(); // exactly 09:00 + 5h
    expect(deriveCurrentBlock(ts, utc('2026-10-11T13:59:59Z'))).not.toBeNull();
  });

  it('starts a new block for a record exactly at the block end', () => {
    // Block 1: [09:00, 14:00). A record at 14:00 opens block 2 at 14:00.
    const ts = [utc('2026-10-11T09:00:00Z'), utc('2026-10-11T12:00:00Z'), utc('2026-10-11T14:00:00Z')];
    const now = utc('2026-10-11T14:30:00Z');
    expect(deriveCurrentBlock(ts, now)).toEqual({ start: utc('2026-10-11T14:00:00Z'), end: now });
  });

  it('keeps a record one ms before the block end in the same block', () => {
    const ts = [utc('2026-10-11T09:00:00Z'), utc('2026-10-11T14:00:00Z') - 1];
    const now = utc('2026-10-11T13:59:59.999Z');
    expect(deriveCurrentBlock(ts, now)).toEqual({ start: utc('2026-10-11T09:00:00Z'), end: now });
  });

  it('starts a new block, floored to its own UTC hour, after a gap of more than 5h', () => {
    // 01:30 → block [01:00, 06:00). Next record 07:05 (gap 5h35m) → new block [07:00, 12:00).
    const ts = [utc('2026-10-11T01:30:00Z'), utc('2026-10-11T07:05:00Z')];
    const now = utc('2026-10-11T08:00:00Z');
    expect(deriveCurrentBlock(ts, now)).toEqual({ start: utc('2026-10-11T07:00:00Z'), end: now });
  });

  it('chains consecutive blocks: a record past each block end opens the next', () => {
    const ts = [
      utc('2026-10-11T00:00:00Z'), // block A [00:00, 05:00)
      utc('2026-10-11T04:59:00Z'), // still A
      utc('2026-10-11T05:10:00Z'), // >= A end → block B [05:00, 10:00)
      utc('2026-10-11T10:20:00Z'), // >= B end → block C [10:00, 15:00)
    ];
    const now = utc('2026-10-11T10:30:00Z');
    expect(deriveCurrentBlock(ts, now)).toEqual({ start: utc('2026-10-11T10:00:00Z'), end: now });
  });

  it('records under 5h apart within the block stay in one block', () => {
    const ts = [utc('2026-10-11T10:00:00Z'), utc('2026-10-11T14:59:00Z')];
    const now = utc('2026-10-11T14:59:30Z');
    expect(deriveCurrentBlock(ts, now)).toEqual({ start: utc('2026-10-11T10:00:00Z'), end: now });
  });

  it('ignores records after now', () => {
    const now = utc('2026-10-11T10:00:00Z');
    const ts = [utc('2026-10-11T09:15:00Z'), utc('2026-10-11T16:00:00Z')];
    expect(deriveCurrentBlock(ts, now)).toEqual({ start: utc('2026-10-11T09:00:00Z'), end: now });
  });

  it('returns null when the last activity was long ago', () => {
    const ts = [utc('2026-10-10T09:00:00Z')];
    expect(deriveCurrentBlock(ts, utc('2026-10-11T09:00:00Z') + 30 * M)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/domain/windows.test.ts`
Expected: FAIL with `Failed to load url ./windows.js`.

- [ ] **Step 3: Implement windows**

`src/domain/windows.ts`:
```ts
import type { TimeWindow } from './types.js';

export const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export function blockWindowFromLimit(resetsAt: number, now: number): TimeWindow {
  return { start: resetsAt - FIVE_HOURS_MS, end: now };
}

export function weekWindowFromLimit(resetsAt: number, now: number): TimeWindow {
  return { start: resetsAt - SEVEN_DAYS_MS, end: now };
}

export function todayWindow(now: number): TimeWindow {
  const d = new Date(now);
  return { start: new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(), end: now };
}

export function monthWindow(now: number): TimeWindow {
  const d = new Date(now);
  return { start: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), end: now };
}

export function rollingWeekWindow(now: number): TimeWindow {
  return { start: now - SEVEN_DAYS_MS, end: now };
}

/**
 * ccusage-style fallback when the usage API is unavailable (spec §4.2).
 * Blocks are half-open [start, start+5h) with start floored to the UTC hour.
 * `timestamps` must be sorted ascending.
 */
export function deriveCurrentBlock(timestamps: number[], now: number): TimeWindow | null {
  let blockStart: number | null = null;
  let prev: number | null = null;
  for (const ts of timestamps) {
    if (ts > now) break;
    const pastEnd = blockStart !== null && ts >= blockStart + FIVE_HOURS_MS;
    const longGap = prev !== null && ts - prev > FIVE_HOURS_MS;
    if (blockStart === null || pastEnd || longGap) {
      blockStart = Math.floor(ts / HOUR_MS) * HOUR_MS; // epoch ms is UTC, so this floors to the UTC hour
    }
    prev = ts;
  }
  if (blockStart === null || now >= blockStart + FIVE_HOURS_MS) return null;
  return { start: blockStart, end: now };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/domain/windows.test.ts`
Expected: PASS (18 tests).

- [ ] **Step 5: Run again in two other timezones to prove TZ-robustness**

Run: `TZ=America/Los_Angeles npx vitest run src/domain/windows.test.ts && TZ=Asia/Kolkata npx vitest run src/domain/windows.test.ts`
Expected: PASS both times. (Kolkata's +5:30 offset catches any mistake that floors block starts to the *local* hour instead of the UTC hour.)

- [ ] **Step 6: Commit**

```bash
git add src/domain/windows.ts src/domain/windows.test.ts
git commit -m "feat(domain): add usage time windows and fallback 5h block derivation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Window aggregates, burn rate, sparkline

**Files:**
- Create: `src/domain/aggregate.ts`
- Test: `src/domain/aggregate.test.ts`

**Interfaces:**
- Consumes:
  - From `src/domain/types.ts` (Task 1): `UsageRecord`, `TimeWindow`, `WindowTotals`, `ModelTotals`, `PriceLookup`, `addTokens`, `ZERO_TOKENS`.
  - From Task 7: `recordCost(tokens, price): number | null`.
- Produces:
  - `totalsForWindow(records: Iterable<UsageRecord>, w: TimeWindow, lookup: PriceLookup | null): WindowTotals`
  - `unknownModelsIn(records: Iterable<UsageRecord>, lookup: PriceLookup | null): string[]`
  - `burnRatePerHour(records: Iterable<UsageRecord>, now: number, lookup: PriceLookup | null): number | null`
  - `hourlySparkline(records: Iterable<UsageRecord>, now: number, lookup: PriceLookup | null, hours = 24): number[]`

**Rules:**
- A record is in window `w` iff `w.start <= timestamp <= w.end`. Tokens always count.
- When `lookup` is `null` (pricing entirely unavailable), the total and every per-model `costUSD` is `null`.
- When `lookup` exists:
  - The window `costUSD` starts at `0` and sums priced records only.
  - A model with no price has `byModel[model].costUSD === null`, and its tokens still count.
- `unknownModelsIn` returns a sorted unique list of models with no price, or `[]` when `lookup` is `null`.
- Burn rate is the cost of records in `(now - 60min, now]`, or `null` when `lookup` is `null`.
- Sparkline: bucket `i` (0 = oldest) covers `[now-(hours-i)h, now-(hours-i-1)h)`, except that the newest bucket also includes `now`. Records outside the range or in the future are ignored. Unknown models add 0. When `lookup` is `null`, all buckets are 0.

- [ ] **Step 1: Write the failing test**

`src/domain/aggregate.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { burnRatePerHour, hourlySparkline, totalsForWindow, unknownModelsIn } from './aggregate.js';
import type { ModelPrice, PriceLookup, TokenCounts, UsageRecord } from './types.js';

const H = 3_600_000;
const M = 60_000;
const NOW = Date.parse('2026-10-11T14:00:00Z');

// $1 per input token makes expected costs trivial to read.
const opus: ModelPrice = { input: 1, output: 2, cacheWrite: 0, cacheRead: 0 };
const haiku: ModelPrice = { input: 0.5, output: 0.5, cacheWrite: 0, cacheRead: 0 };
const lookup: PriceLookup = (m) => (m === 'opus' ? opus : m === 'haiku' ? haiku : undefined);

function tok(input: number, output = 0): TokenCounts {
  return { input, output, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 };
}

let n = 0;
function rec(model: string, timestamp: number, tokens: TokenCounts): UsageRecord {
  n += 1;
  return { key: `k${n}`, sessionId: 's1', timestamp, model, tokens, isSidechain: false };
}

describe('totalsForWindow', () => {
  const records = [
    rec('opus', NOW - 2 * H, tok(1, 1)), // cost 3
    rec('haiku', NOW - 1 * H, tok(4)), // cost 2
    rec('mystery', NOW - 30 * M, tok(10)), // unpriced
    rec('opus', NOW - 10 * H, tok(100)), // outside window
  ];
  const w = { start: NOW - 5 * H, end: NOW };

  it('sums tokens and priced costs inside the window, by model', () => {
    const t = totalsForWindow(records, w, lookup);
    expect(t.costUSD).toBe(5);
    expect(t.tokens).toEqual({ input: 15, output: 1, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 });
    expect(t.byModel.opus).toEqual({ costUSD: 3, tokens: tok(1, 1) });
    expect(t.byModel.haiku).toEqual({ costUSD: 2, tokens: tok(4) });
    expect(t.byModel.mystery).toEqual({ costUSD: null, tokens: tok(10) });
    expect(t.byModel).not.toHaveProperty('x');
  });

  it('includes records exactly on both window boundaries', () => {
    const edge = [rec('opus', w.start, tok(1)), rec('opus', w.end, tok(1))];
    expect(totalsForWindow(edge, w, lookup).costUSD).toBe(2);
  });

  it('makes every cost null when pricing is unavailable but still counts tokens', () => {
    const t = totalsForWindow(records, w, null);
    expect(t.costUSD).toBeNull();
    expect(t.byModel.opus?.costUSD).toBeNull();
    expect(t.tokens.input).toBe(15);
  });

  it('returns zero cost and zero tokens for an empty window', () => {
    const t = totalsForWindow([], w, lookup);
    expect(t.costUSD).toBe(0);
    expect(t.tokens).toEqual(tok(0));
    expect(t.byModel).toEqual({});
  });

  it('accepts any iterable and does not mutate shared token objects', () => {
    const shared = tok(1);
    const set = new Set([rec('opus', NOW - H, shared), rec('opus', NOW - H, shared)]);
    const t = totalsForWindow(set, w, lookup);
    expect(t.tokens.input).toBe(2);
    expect(shared.input).toBe(1);
  });
});

describe('unknownModelsIn', () => {
  it('lists unpriced models once, sorted', () => {
    const rs = [rec('zeta', NOW, tok(1)), rec('alpha', NOW, tok(1)), rec('zeta', NOW, tok(1)), rec('opus', NOW, tok(1))];
    expect(unknownModelsIn(rs, lookup)).toEqual(['alpha', 'zeta']);
  });
  it('is empty when pricing is unavailable', () => {
    expect(unknownModelsIn([rec('zeta', NOW, tok(1))], null)).toEqual([]);
  });
});

describe('burnRatePerHour', () => {
  it('sums cost in the last 60 minutes, excluding the exact 60-minute edge', () => {
    const rs = [
      rec('opus', NOW - 60 * M, tok(100)), // excluded: (now-60m, now]
      rec('opus', NOW - 59 * M, tok(2)), // 2
      rec('haiku', NOW, tok(2)), // 1
      rec('mystery', NOW - M, tok(50)), // unpriced → 0
    ];
    expect(burnRatePerHour(rs, NOW, lookup)).toBe(3);
  });
  it('is 0 with no recent records and null without pricing', () => {
    expect(burnRatePerHour([rec('opus', NOW - 3 * H, tok(1))], NOW, lookup)).toBe(0);
    expect(burnRatePerHour([], NOW, null)).toBeNull();
  });
});

describe('hourlySparkline', () => {
  it('returns 24 buckets by default, oldest first', () => {
    const rs = [
      rec('opus', NOW, tok(1)), // newest bucket (now included)
      rec('opus', NOW - 30 * M, tok(2)), // newest bucket
      rec('opus', NOW - H, tok(4)), // exactly 1h ago → newest bucket (start-inclusive [now-1h, now])
      rec('opus', NOW - 23.5 * H, tok(8)), // oldest bucket
      rec('opus', NOW - 24 * H, tok(16)), // exactly 24h ago → oldest bucket start (inclusive)
      rec('opus', NOW - 25 * H, tok(100)), // out of range
      rec('opus', NOW + M, tok(100)), // future → ignored
    ];
    const s = hourlySparkline(rs, NOW, lookup);
    expect(s).toHaveLength(24);
    expect(s[23]).toBe(1 + 2 + 4);
    expect(s[0]).toBe(8 + 16);
    expect(s.slice(1, 23).every((v) => v === 0)).toBe(true);
  });
  it('honors a custom bucket count', () => {
    expect(hourlySparkline([rec('opus', NOW - 90 * M, tok(1))], NOW, lookup, 3)).toEqual([0, 1, 0]);
  });
  it('is all zeros without pricing', () => {
    expect(hourlySparkline([rec('opus', NOW, tok(1))], NOW, null, 4)).toEqual([0, 0, 0, 0]);
  });
});
```

Bucket index formula: `i = hours - ceil(age / 1h)` for `age > 0`, `hours - 1` for `age === 0`; indices outside `[0, hours)` are ignored. Worked examples (hours=24): age 30m→23, 1h→23, 23.5h→0, 24h→0, 25h→ignored.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/domain/aggregate.test.ts`
Expected: FAIL with `Failed to load url ./aggregate.js`.

- [ ] **Step 3: Implement aggregate**

`src/domain/aggregate.ts`:
```ts
import { recordCost } from './cost.js';
import {
  addTokens,
  ZERO_TOKENS,
  type ModelTotals,
  type PriceLookup,
  type TimeWindow,
  type UsageRecord,
  type WindowTotals,
} from './types.js';

const HOUR_MS = 60 * 60 * 1000;

export function totalsForWindow(
  records: Iterable<UsageRecord>,
  w: TimeWindow,
  lookup: PriceLookup | null,
): WindowTotals {
  const totals: WindowTotals = { costUSD: lookup ? 0 : null, tokens: { ...ZERO_TOKENS }, byModel: {} };
  for (const r of records) {
    if (r.timestamp < w.start || r.timestamp > w.end) continue;
    const price = lookup?.(r.model);
    const cost = lookup ? recordCost(r.tokens, price) : null;

    let m: ModelTotals | undefined = totals.byModel[r.model];
    if (!m) {
      m = { costUSD: price ? 0 : null, tokens: { ...ZERO_TOKENS } };
      totals.byModel[r.model] = m;
    }
    m.tokens = addTokens(m.tokens, r.tokens);
    totals.tokens = addTokens(totals.tokens, r.tokens);
    if (cost !== null) {
      m.costUSD = (m.costUSD ?? 0) + cost;
      totals.costUSD = (totals.costUSD ?? 0) + cost;
    }
  }
  return totals;
}

export function unknownModelsIn(records: Iterable<UsageRecord>, lookup: PriceLookup | null): string[] {
  if (!lookup) return [];
  const unknown = new Set<string>();
  for (const r of records) if (!lookup(r.model)) unknown.add(r.model);
  return [...unknown].sort();
}

function pricedCost(r: UsageRecord, lookup: PriceLookup): number {
  return recordCost(r.tokens, lookup(r.model)) ?? 0;
}

/** Cost of records in (now - 60 min, now], i.e. $/h. */
export function burnRatePerHour(
  records: Iterable<UsageRecord>,
  now: number,
  lookup: PriceLookup | null,
): number | null {
  if (!lookup) return null;
  let sum = 0;
  for (const r of records) {
    if (r.timestamp > now - HOUR_MS && r.timestamp <= now) sum += pricedCost(r, lookup);
  }
  return sum;
}

/** Hourly cost buckets, oldest first; bucket i = [now-(hours-i)h, now-(hours-i-1)h), newest also includes now. */
export function hourlySparkline(
  records: Iterable<UsageRecord>,
  now: number,
  lookup: PriceLookup | null,
  hours = 24,
): number[] {
  const buckets = new Array<number>(hours).fill(0);
  if (!lookup) return buckets;
  for (const r of records) {
    const age = now - r.timestamp;
    if (age < 0) continue;
    const i = age === 0 ? hours - 1 : hours - Math.ceil(age / HOUR_MS);
    if (i < 0 || i >= hours) continue;
    buckets[i] = (buckets[i] ?? 0) + pricedCost(r, lookup);
  }
  return buckets;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/domain/aggregate.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Run the whole domain suite, typecheck and lint**

Run: `npx vitest run src/domain && npm run typecheck && npm run lint`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/domain/aggregate.ts src/domain/aggregate.test.ts
git commit -m "feat(domain): add window totals, burn rate and hourly sparkline aggregates

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Transcript parser

**Files:**
- Create: `src/collectors/transcriptParser.ts`
- Test: `src/collectors/transcriptParser.test.ts`

**Interfaces:**
- Consumes: `TranscriptEvent`, `TokenCounts` from `src/domain/types.ts` (Task 1); builders from `test/helpers/transcript.ts` (Task 1).
- Produces:
  - `parseTranscriptRecord(raw: unknown, ctx: { sessionId: string; forceSidechain?: boolean }): TranscriptEvent[]`
  - `parseTranscriptLine(line: string, ctx: { sessionId: string; forceSidechain?: boolean }): TranscriptEvent[]`
  - The dedup key format is `${messageId}:${requestId}`, or `${messageId}` when `requestId` is missing. It is identical to `dedupKey()` in Task 7, but inlined here because Task 7 runs in the same wave.
  - The parser never throws.

- [ ] **Step 1: Write the failing test**

`src/collectors/transcriptParser.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { parseTranscriptLine, parseTranscriptRecord } from './transcriptParser.js';
import {
  agentNameLine,
  aiTitleLine,
  assistantLine,
  compactLine,
  costStateLine,
  permissionModeLine,
  userLine,
} from '../../test/helpers/transcript.js';
import type { TranscriptEvent } from '../domain/types.js';

const ctx = { sessionId: 'sess-1' };
const TS = '2026-10-11T14:00:00.000Z';
const T = Date.parse(TS);
const usageOf = (events: TranscriptEvent[]) => events.filter((e) => e.kind === 'usage');

describe('parseTranscriptLine — assistant usage', () => {
  it('emits a usage event with dedup key, tokens and context tokens, plus meta', () => {
    const events = parseTranscriptLine(
      assistantLine({
        id: 'msg_1',
        requestId: 'req_1',
        ts: TS,
        gitBranch: 'feat/x',
        usage: {
          input_tokens: 2,
          output_tokens: 256,
          cache_creation_input_tokens: 9368,
          cache_read_input_tokens: 15550,
        },
      }),
      ctx,
    );
    expect(events).toContainEqual({
      kind: 'usage',
      contextTokens: 2 + 9368 + 15550,
      record: {
        key: 'msg_1:req_1',
        sessionId: 'sess-1',
        timestamp: T,
        model: 'claude-opus-5-5',
        isSidechain: false,
        tokens: { input: 2, output: 256, cacheWrite5m: 9368, cacheWrite1h: 0, cacheRead: 15550 },
      },
    });
    expect(events).toContainEqual({
      kind: 'meta',
      timestamp: T,
      isSidechain: false,
      gitBranch: 'feat/x',
      cwd: '/work/proj',
      version: '2.1.296',
    });
  });

  it('uses the message id alone as key when requestId is missing', () => {
    const [u] = usageOf(parseTranscriptLine(assistantLine({ id: 'msg_2', ts: TS, usage: { output_tokens: 5 } }), ctx));
    expect(u?.kind === 'usage' && u.record.key).toBe('msg_2');
  });

  it('splits cache writes using the ephemeral 5m/1h breakdown when present', () => {
    const [u] = usageOf(
      parseTranscriptLine(
        assistantLine({
          id: 'msg_3',
          ts: TS,
          usage: { output_tokens: 1, cache_creation_input_tokens: 300, eph5m: 100, eph1h: 200 },
        }),
        ctx,
      ),
    );
    expect(u?.kind === 'usage' && u.record.tokens).toMatchObject({ cacheWrite5m: 100, cacheWrite1h: 200 });
  });

  it('prices any cache-write remainder not covered by the breakdown as 5m', () => {
    const [u] = usageOf(
      parseTranscriptLine(
        assistantLine({
          id: 'msg_4',
          ts: TS,
          usage: { output_tokens: 1, cache_creation_input_tokens: 500, eph5m: 0, eph1h: 0 },
        }),
        ctx,
      ),
    );
    expect(u?.kind === 'usage' && u.record.tokens).toMatchObject({ cacheWrite5m: 500, cacheWrite1h: 0 });
  });

  it('skips synthetic and all-zero usage records', () => {
    expect(usageOf(parseTranscriptLine(assistantLine({ id: 'm', ts: TS, model: '<synthetic>', usage: { output_tokens: 9 } }), ctx))).toEqual([]);
    expect(usageOf(parseTranscriptLine(assistantLine({ id: 'm', ts: TS }), ctx))).toEqual([]);
  });

  it('forceSidechain marks usage and meta as sidechain', () => {
    const events = parseTranscriptLine(assistantLine({ id: 'm5', ts: TS, usage: { output_tokens: 3 } }), {
      sessionId: 'parent',
      forceSidechain: true,
    });
    const u = usageOf(events)[0];
    expect(u?.kind === 'usage' && u.record).toMatchObject({ isSidechain: true, sessionId: 'parent' });
    expect(events.find((e) => e.kind === 'meta')).toMatchObject({ isSidechain: true });
  });

  it('honours isSidechain:true on the record itself', () => {
    const u = usageOf(parseTranscriptLine(assistantLine({ id: 'm6', ts: TS, sidechain: true, usage: { output_tokens: 3 } }), ctx))[0];
    expect(u?.kind === 'usage' && u.record.isSidechain).toBe(true);
  });
});

describe('parseTranscriptLine — other record types', () => {
  it('compact_boundary → compact event (and meta)', () => {
    expect(parseTranscriptLine(compactLine(TS, 41000), ctx)).toContainEqual({
      kind: 'compact',
      timestamp: T,
      postTokens: 41000,
      isSidechain: false,
    });
  });

  it('user line → meta with branch/cwd/version', () => {
    expect(parseTranscriptLine(userLine(TS, { gitBranch: 'dev' }), ctx)).toEqual([
      { kind: 'meta', timestamp: T, isSidechain: false, gitBranch: 'dev', cwd: '/work/proj', version: '2.1.296' },
    ]);
  });

  it('cost-state, ai-title, agent-name, permission-mode', () => {
    expect(parseTranscriptLine(costStateLine(1.25, TS), ctx)).toEqual([{ kind: 'costState', timestamp: T, totalCostUSD: 1.25 }]);
    expect(parseTranscriptLine(costStateLine(2), ctx)).toEqual([{ kind: 'costState', timestamp: 0, totalCostUSD: 2 }]);
    expect(parseTranscriptLine(aiTitleLine('Fix login bug'), ctx)).toEqual([
      { kind: 'title', timestamp: 0, title: 'Fix login bug', source: 'ai-title' },
    ]);
    expect(parseTranscriptLine(agentNameLine('reviewer'), ctx)).toEqual([
      { kind: 'title', timestamp: 0, title: 'reviewer', source: 'agent-name' },
    ]);
    expect(parseTranscriptLine(permissionModeLine('plan'), ctx)).toEqual([
      { kind: 'permissionMode', timestamp: 0, mode: 'plan' },
    ]);
  });
});

describe('parser robustness', () => {
  it('never throws on malformed input', () => {
    expect(parseTranscriptLine('{not json', ctx)).toEqual([]);
    expect(parseTranscriptLine('', ctx)).toEqual([]);
    expect(parseTranscriptRecord(null, ctx)).toEqual([]);
    expect(parseTranscriptRecord([1, 2], ctx)).toEqual([]);
    expect(parseTranscriptRecord({ type: 'assistant', message: 'x' }, ctx)).toEqual([]);
    expect(parseTranscriptRecord({ type: 'mystery', timestamp: TS }, ctx)).toEqual([]);
    expect(parseTranscriptRecord({ type: 'cost-state', totalCostUSD: 'lots' }, ctx)).toEqual([]);
  });

  it('assistant without message.id yields only meta', () => {
    const raw = JSON.parse(assistantLine({ id: 'x', ts: TS, usage: { output_tokens: 1 } }));
    delete raw.message.id;
    expect(parseTranscriptRecord(raw, ctx).map((e) => e.kind)).toEqual(['meta']);
  });

  it('assistant with an invalid timestamp yields no usage', () => {
    const raw = JSON.parse(assistantLine({ id: 'x', ts: 'not-a-date', usage: { output_tokens: 1 } }));
    expect(parseTranscriptRecord(raw, ctx)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/collectors/transcriptParser.test.ts`
Expected: FAIL with `Failed to resolve import "./transcriptParser.js"`.

- [ ] **Step 3: Write the implementation**

`src/collectors/transcriptParser.ts`:
```ts
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

function usageEvent(raw: Obj, ctx: ParseContext, timestamp: number | undefined, isSidechain: boolean): TranscriptEvent[] {
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
      if (raw.subtype === 'compact_boundary' && timestamp !== undefined && isObj(meta) && typeof meta.postTokens === 'number') {
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
      return title === undefined ? [] : [{ kind: 'title', timestamp: timestamp ?? 0, title, source: 'ai-title' }];
    }
    case 'agent-name': {
      const title = str(raw.agentName);
      return title === undefined ? [] : [{ kind: 'title', timestamp: timestamp ?? 0, title, source: 'agent-name' }];
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/collectors/transcriptParser.test.ts && npm run typecheck`
Expected: PASS, with no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/collectors/transcriptParser.ts src/collectors/transcriptParser.test.ts
git commit -m "feat(collectors): parse transcript records into typed events

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: LiteLLM pricing provider

**Files:**
- Create: `src/collectors/pricing.ts`
- Test: `src/collectors/pricing.test.ts`

**Interfaces:**
- Consumes: `ModelPrice`, `PriceLookup`, `PricingStatus` from `src/domain/types.ts` (Task 1).
- Produces:
  - `LITELLM_URL`
  - `buildPriceTable(json: unknown): Map<string, ModelPrice>`
  - `makeLookup(table: Map<string, ModelPrice>): PriceLookup`
  - `interface PricingDeps { fetch?; readFile?; writeFile?; mkdir?; stat?; now? }`
  - `class PricingProvider { constructor(opts: { cacheDir: string; ttlMs?: number; deps?: PricingDeps }); load(): Promise<{ lookup: PriceLookup | null; status: PricingStatus }> }`
  - The cache file is `<cacheDir>/pricing.json`, holding the raw LiteLLM JSON text.
- Pricing rules:
  - When LiteLLM has no `cache_creation_input_token_cost`, the cache-write price defaults to `input × 1.25`.
  - When it has no `cache_read_input_token_cost`, the cache-read price defaults to `input × 0.1`. These are Anthropic's standard multipliers.
  - `sample_spec` and entries without numeric input/output costs are skipped.

- [ ] **Step 1: Write the failing test**

`src/collectors/pricing.test.ts`:
```ts
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildPriceTable, LITELLM_URL, makeLookup, PricingProvider } from './pricing.js';

const FIXTURE = {
  sample_spec: { input_cost_per_token: 0, output_cost_per_token: 0, max_tokens: 'LEGACY' },
  'claude-opus-5-5': {
    input_cost_per_token: 5e-6,
    output_cost_per_token: 25e-6,
    cache_creation_input_token_cost: 6.25e-6,
    cache_creation_input_token_cost_above_1hr: 10e-6,
    cache_read_input_token_cost: 0.5e-6,
    max_input_tokens: 200000,
  },
  'anthropic/claude-sonnet-5-5': {
    input_cost_per_token: 3e-6,
    output_cost_per_token: 15e-6,
    cache_creation_input_token_cost: 3.75e-6,
    cache_read_input_token_cost: 0.3e-6,
    max_input_tokens: 1000000,
  },
  'claude-haiku-5-5': { input_cost_per_token: 1e-6, output_cost_per_token: 5e-6 },
  'gpt-x': { mode: 'chat' },
};

const NOW = Date.parse('2026-10-11T12:00:00Z');
const DAY = 86_400_000;
const CACHE_DIR = '/cache/ccstatusboard';
const CACHE_FILE = join(CACHE_DIR, 'pricing.json');

function fakeFs(initial: Record<string, { text: string; mtimeMs: number }> = {}) {
  const files = new Map(Object.entries(initial));
  const enoent = () => Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  return {
    files,
    readFile: async (p: string) => {
      const f = files.get(p);
      if (!f) throw enoent();
      return f.text;
    },
    writeFile: vi.fn(async (p: string, data: string) => {
      files.set(p, { text: data, mtimeMs: NOW });
    }),
    mkdir: async () => undefined,
    stat: async (p: string) => {
      const f = files.get(p);
      if (!f) throw enoent();
      return { mtimeMs: f.mtimeMs };
    },
  };
}

const okFetch = () =>
  vi.fn(async () => new Response(JSON.stringify(FIXTURE), { status: 200 })) as unknown as typeof fetch & {
    mock: { calls: unknown[][] };
  };

describe('buildPriceTable', () => {
  it('keeps priced entries, skips sample_spec and unpriced, fills cache defaults', () => {
    const t = buildPriceTable(FIXTURE);
    expect([...t.keys()].sort()).toEqual(['anthropic/claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5']);
    expect(t.get('claude-opus-5-5')).toEqual({
      input: 5e-6,
      output: 25e-6,
      cacheWrite: 6.25e-6,
      cacheWrite1h: 10e-6,
      cacheRead: 0.5e-6,
      maxInputTokens: 200000,
    });
    const haiku = t.get('claude-haiku-5-5')!;
    expect(haiku.cacheWrite).toBeCloseTo(1.25e-6, 12);
    expect(haiku.cacheRead).toBeCloseTo(1e-7, 12);
    expect(haiku.cacheWrite1h).toBeUndefined();
    expect(haiku.maxInputTokens).toBeUndefined();
  });

  it('returns an empty table for non-object input', () => {
    expect(buildPriceTable(null).size).toBe(0);
    expect(buildPriceTable([1]).size).toBe(0);
  });
});

describe('makeLookup', () => {
  const lookup = makeLookup(buildPriceTable(FIXTURE));
  it('resolves through the lookup chain', () => {
    expect(lookup('claude-opus-5-5')?.input).toBe(5e-6);
    expect(lookup('claude-sonnet-5-5')?.input).toBe(3e-6); // anthropic/ prefix
    expect(lookup('claude-haiku-5-5-20260301')?.input).toBe(1e-6); // date suffix stripped
    expect(lookup('claude-opus-5-5[1m]')?.input).toBe(5e-6); // [1m] stripped
    expect(lookup('claude-sonnet-5-5[1m]')?.input).toBe(3e-6); // [1m] stripped + anthropic/
  });
  it('returns undefined for unknown models', () => {
    expect(lookup('claude-mystery-9')).toBeUndefined();
    expect(lookup('')).toBeUndefined();
  });
});

describe('PricingProvider', () => {
  it('uses a fresh cache without fetching', async () => {
    const fs = fakeFs({ [CACHE_FILE]: { text: JSON.stringify(FIXTURE), mtimeMs: NOW - 60_000 } });
    const fetch = okFetch();
    const p = new PricingProvider({ cacheDir: CACHE_DIR, deps: { ...fs, fetch, now: () => NOW } });
    const r = await p.load();
    expect(r.status).toBe('ok');
    expect(r.lookup?.('claude-opus-5-5')?.output).toBe(25e-6);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refreshes a stale cache from LiteLLM and rewrites the cache file', async () => {
    const fs = fakeFs({ [CACHE_FILE]: { text: JSON.stringify({}), mtimeMs: NOW - 2 * DAY } });
    const fetch = okFetch();
    const p = new PricingProvider({ cacheDir: CACHE_DIR, deps: { ...fs, fetch, now: () => NOW } });
    const r = await p.load();
    expect(r.status).toBe('ok');
    expect(fetch.mock.calls[0]?.[0]).toBe(LITELLM_URL);
    expect(fs.writeFile).toHaveBeenCalledWith(CACHE_FILE, JSON.stringify(FIXTURE));
    expect(r.lookup?.('claude-haiku-5-5')).toBeDefined();
  });

  it('falls back to the stale cache when the fetch fails', async () => {
    const fs = fakeFs({ [CACHE_FILE]: { text: JSON.stringify(FIXTURE), mtimeMs: NOW - 3 * DAY } });
    const fetch = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const r = await new PricingProvider({ cacheDir: CACHE_DIR, deps: { ...fs, fetch, now: () => NOW } }).load();
    expect(r.status).toBe('stale');
    expect(r.lookup?.('claude-opus-5-5')?.input).toBe(5e-6);
  });

  it('reports unavailable with no cache and a failing fetch', async () => {
    const fs = fakeFs();
    const fetch = vi.fn(async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
    const r = await new PricingProvider({ cacheDir: CACHE_DIR, deps: { ...fs, fetch, now: () => NOW } }).load();
    expect(r).toEqual({ lookup: null, status: 'unavailable' });
  });

  it('treats a corrupt cache file as missing', async () => {
    const fs = fakeFs({ [CACHE_FILE]: { text: '{oops', mtimeMs: NOW } });
    const fetch = okFetch();
    const r = await new PricingProvider({ cacheDir: CACHE_DIR, deps: { ...fs, fetch, now: () => NOW } }).load();
    expect(r.status).toBe('ok');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('still returns ok if writing the cache fails', async () => {
    const fs = fakeFs();
    fs.writeFile.mockRejectedValueOnce(new Error('EACCES'));
    const r = await new PricingProvider({ cacheDir: CACHE_DIR, deps: { ...fs, fetch: okFetch(), now: () => NOW } }).load();
    expect(r.status).toBe('ok');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/collectors/pricing.test.ts`
Expected: FAIL with `Failed to resolve import "./pricing.js"`.

- [ ] **Step 3: Write the implementation**

`src/collectors/pricing.ts`:
```ts
// LiteLLM-backed model pricing with a 24h on-disk cache.
import { mkdir as fsMkdir, readFile as fsReadFile, stat as fsStat, writeFile as fsWriteFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ModelPrice, PriceLookup, PricingStatus } from '../domain/types.js';

export const LITELLM_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';

const DAY_MS = 86_400_000;
const FETCH_TIMEOUT_MS = 10_000;
/** Anthropic standard multipliers used when LiteLLM omits cache prices. */
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const numOrUndef = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

export function buildPriceTable(json: unknown): Map<string, ModelPrice> {
  const table = new Map<string, ModelPrice>();
  if (!isObj(json)) return table;
  for (const [name, entry] of Object.entries(json)) {
    if (name === 'sample_spec' || !isObj(entry)) continue;
    const input = numOrUndef(entry.input_cost_per_token);
    const output = numOrUndef(entry.output_cost_per_token);
    if (input === undefined || output === undefined) continue;
    const price: ModelPrice = {
      input,
      output,
      cacheWrite: numOrUndef(entry.cache_creation_input_token_cost) ?? input * CACHE_WRITE_MULTIPLIER,
      cacheRead: numOrUndef(entry.cache_read_input_token_cost) ?? input * CACHE_READ_MULTIPLIER,
    };
    const cacheWrite1h = numOrUndef(entry.cache_creation_input_token_cost_above_1hr);
    if (cacheWrite1h !== undefined) price.cacheWrite1h = cacheWrite1h;
    const maxInputTokens = numOrUndef(entry.max_input_tokens);
    if (maxInputTokens !== undefined) price.maxInputTokens = maxInputTokens;
    table.set(name, price);
  }
  return table;
}

function candidates(model: string): string[] {
  const stripDate = (s: string) => s.replace(/-\d{8}$/, '');
  const base = model.replace(/\[1m\]$/i, '');
  const names = [model, stripDate(model), base, stripDate(base)];
  return [...new Set(names.flatMap((n) => [n, `anthropic/${n}`]))];
}

export function makeLookup(table: Map<string, ModelPrice>): PriceLookup {
  const memo = new Map<string, ModelPrice | undefined>();
  return (model: string) => {
    if (memo.has(model)) return memo.get(model);
    let found: ModelPrice | undefined;
    if (model !== '') {
      for (const name of candidates(model)) {
        found = table.get(name);
        if (found) break;
      }
    }
    memo.set(model, found);
    return found;
  };
}

export interface PricingDeps {
  fetch?: typeof fetch;
  readFile?: (p: string) => Promise<string>;
  writeFile?: (p: string, data: string) => Promise<void>;
  mkdir?: (p: string) => Promise<unknown>;
  stat?: (p: string) => Promise<{ mtimeMs: number }>;
  now?: () => number;
}

export interface PricingResult {
  lookup: PriceLookup | null;
  status: PricingStatus;
}

export class PricingProvider {
  private readonly cacheDir: string;
  private readonly file: string;
  private readonly ttlMs: number;
  private readonly deps: Required<PricingDeps>;

  constructor(opts: { cacheDir: string; ttlMs?: number; deps?: PricingDeps }) {
    this.cacheDir = opts.cacheDir;
    this.file = join(opts.cacheDir, 'pricing.json');
    this.ttlMs = opts.ttlMs ?? DAY_MS;
    const d = opts.deps ?? {};
    this.deps = {
      fetch: d.fetch ?? globalThis.fetch,
      readFile: d.readFile ?? ((p) => fsReadFile(p, 'utf8')),
      writeFile: d.writeFile ?? ((p, data) => fsWriteFile(p, data, 'utf8')),
      mkdir: d.mkdir ?? ((p) => fsMkdir(p, { recursive: true })),
      stat: d.stat ?? fsStat,
      now: d.now ?? Date.now,
    };
  }

  async load(): Promise<PricingResult> {
    const cached = await this.readCache();
    if (cached && this.deps.now() - cached.mtimeMs < this.ttlMs) {
      return { lookup: makeLookup(cached.table), status: 'ok' };
    }
    try {
      const res = await this.deps.fetch(LITELLM_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const table = buildPriceTable(JSON.parse(text));
      if (table.size === 0) throw new Error('empty pricing table');
      await this.writeCache(text);
      return { lookup: makeLookup(table), status: 'ok' };
    } catch {
      if (cached) return { lookup: makeLookup(cached.table), status: 'stale' };
      return { lookup: null, status: 'unavailable' };
    }
  }

  private async readCache(): Promise<{ table: Map<string, ModelPrice>; mtimeMs: number } | null> {
    try {
      const { mtimeMs } = await this.deps.stat(this.file);
      const table = buildPriceTable(JSON.parse(await this.deps.readFile(this.file)));
      return table.size > 0 ? { table, mtimeMs } : null;
    } catch {
      return null;
    }
  }

  private async writeCache(text: string): Promise<void> {
    try {
      await this.deps.mkdir(this.cacheDir);
      await this.deps.writeFile(this.file, text);
    } catch {
      // A read-only cache dir only costs us a re-fetch next start.
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/collectors/pricing.test.ts && npm run typecheck`
Expected: PASS, with no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/collectors/pricing.ts src/collectors/pricing.test.ts
git commit -m "feat(collectors): LiteLLM pricing provider with daily disk cache

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Incremental transcript tailer

**Files:**
- Create: `src/collectors/transcriptTailer.ts`
- Test: `src/collectors/transcriptTailer.test.ts`

**Interfaces:**
- Consumes: `LineSplitter` from `src/core/jsonl.ts` (Task 3). `push(chunk: string): string[]` returns complete non-empty lines and buffers the remainder.
- Produces:
  - `interface TailerDeps { stat?: (p) => Promise<{ size: number; mtimeMs: number }>; readRange?: (p: string, start: number, end: number) => Promise<Buffer>; watch?: (p: string, listener: () => void) => { close(): void } }`
  - **Note:** `readRange` returns a `Buffer`, not a string. Bytes are decoded through a per-file `StringDecoder`, so a multi-byte UTF-8 character split across two reads is never corrupted, and offsets stay in bytes.
  - `class TranscriptTailer { constructor(opts: { onLines: (file: string, lines: string[]) => void; pollMs?: number; deps?: TailerDeps }); add(file: string, startOffset?: number): void; remove(file: string): void; has(file: string): boolean; pollOnce(): Promise<void>; start(): void; stop(): void }`
- Behavior:
  - Each file has its own byte offset.
  - A missing file is skipped silently and retried on the next poll.
  - If `size < offset`, the file was truncated: reset to offset 0 with a fresh splitter and decoder.
  - Reads happen in chunks of at most 4 MiB.
  - Concurrent `pollOnce` calls are coalesced: a call made during a poll schedules one more pass instead of reading in parallel.

- [ ] **Step 1: Write the failing test**

`src/collectors/transcriptTailer.test.ts`:
```ts
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TranscriptTailer } from './transcriptTailer.js';

let dir: string;
let file: string;
let got: string[];
const collect = (_f: string, lines: string[]) => {
  got.push(...lines);
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ccsb-tail-'));
  file = join(dir, 'sess.jsonl');
  got = [];
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function until(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('timeout waiting for condition');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('TranscriptTailer', () => {
  it('emits existing complete lines on the first poll, tagged with the file', async () => {
    await writeFile(file, '{"a":1}\n{"a":2}\n');
    const calls: Array<[string, string[]]> = [];
    const t = new TranscriptTailer({ onLines: (f, l) => calls.push([f, l]) });
    t.add(file);
    await t.pollOnce();
    expect(calls).toEqual([[file, ['{"a":1}', '{"a":2}']]]);
  });

  it('buffers a half-written line and emits it exactly once when completed (Review Focus 1)', async () => {
    await writeFile(file, '{"a":1}\n{"b":');
    const t = new TranscriptTailer({ onLines: collect });
    t.add(file);
    await t.pollOnce();
    expect(got).toEqual(['{"a":1}']);
    await appendFile(file, '2}\n');
    await t.pollOnce();
    expect(got).toEqual(['{"a":1}', '{"b":2}']);
    await t.pollOnce(); // nothing new
    expect(got).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('resets to offset 0 when the file is truncated', async () => {
    await writeFile(file, '{"n":1}\n{"n":2}\n{"n":3}\n');
    const t = new TranscriptTailer({ onLines: collect });
    t.add(file);
    await t.pollOnce();
    await writeFile(file, '{"z":9}\n');
    await t.pollOnce();
    expect(got).toEqual(['{"n":1}', '{"n":2}', '{"n":3}', '{"z":9}']);
  });

  it('honours startOffset', async () => {
    const first = '{"skip":true}\n';
    await writeFile(file, first + '{"keep":true}\n');
    const t = new TranscriptTailer({ onLines: collect });
    t.add(file, Buffer.byteLength(first));
    await t.pollOnce();
    expect(got).toEqual(['{"keep":true}']);
  });

  it('tolerates a missing file and picks it up once created', async () => {
    const t = new TranscriptTailer({ onLines: collect });
    t.add(file);
    await expect(t.pollOnce()).resolves.toBeUndefined();
    await writeFile(file, '{"late":1}\n');
    await t.pollOnce();
    expect(got).toEqual(['{"late":1}']);
  });

  it('decodes a multi-byte character split across reads', async () => {
    const full = Buffer.from('{"t":"é"}\n', 'utf8');
    let content = full.subarray(0, 7); // cuts the 2-byte "é" in half
    const t = new TranscriptTailer({
      onLines: collect,
      deps: {
        stat: async () => ({ size: content.length, mtimeMs: 0 }),
        readRange: async (_p, start, end) => content.subarray(start, end),
      },
    });
    t.add('/virtual.jsonl');
    await t.pollOnce();
    expect(got).toEqual([]);
    content = full;
    await t.pollOnce();
    expect(got).toEqual(['{"t":"é"}']);
  });

  it('add is idempotent, remove stops reading, has reflects membership', async () => {
    await writeFile(file, '{"a":1}\n');
    const t = new TranscriptTailer({ onLines: collect });
    t.add(file);
    t.add(file);
    expect(t.has(file)).toBe(true);
    await t.pollOnce();
    expect(got).toEqual(['{"a":1}']);
    t.remove(file);
    expect(t.has(file)).toBe(false);
    await appendFile(file, '{"a":2}\n');
    await t.pollOnce();
    expect(got).toEqual(['{"a":1}']);
  });

  it('coalesces concurrent polls without double-reading', async () => {
    await writeFile(file, '{"a":1}\n');
    const t = new TranscriptTailer({ onLines: collect });
    t.add(file);
    await Promise.all([t.pollOnce(), t.pollOnce(), t.pollOnce()]);
    expect(got).toEqual(['{"a":1}']);
  });

  it('start() polls on an interval until stop()', async () => {
    await writeFile(file, '');
    const t = new TranscriptTailer({ onLines: collect, pollMs: 20 });
    t.add(file);
    t.start();
    await appendFile(file, '{"live":1}\n');
    await until(() => got.length === 1);
    t.stop();
    await appendFile(file, '{"live":2}\n');
    await new Promise((r) => setTimeout(r, 80));
    expect(got).toEqual(['{"live":1}']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/collectors/transcriptTailer.test.ts`
Expected: FAIL with `Failed to resolve import "./transcriptTailer.js"`.

- [ ] **Step 3: Write the implementation**

`src/collectors/transcriptTailer.ts`:
```ts
// Tails append-only JSONL transcripts by byte offset, emitting only complete lines.
import { watch as fsWatch } from 'node:fs';
import { open, stat as fsStat } from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';
import { LineSplitter } from '../core/jsonl.js';

const CHUNK_BYTES = 4 * 1024 * 1024;

export interface TailerDeps {
  stat?: (p: string) => Promise<{ size: number; mtimeMs: number }>;
  readRange?: (p: string, start: number, end: number) => Promise<Buffer>;
  watch?: (p: string, listener: () => void) => { close(): void };
}

export async function readRangeFromDisk(p: string, start: number, end: number): Promise<Buffer> {
  const fh = await open(p, 'r');
  try {
    const len = Math.max(0, end - start);
    const buf = Buffer.alloc(len);
    const { bytesRead } = await fh.read(buf, 0, len, start);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

function watchOnDisk(p: string, listener: () => void): { close(): void } {
  const w = fsWatch(p);
  w.on('change', listener);
  w.on('error', () => w.close());
  return w;
}

interface FileState {
  offset: number;
  splitter: LineSplitter;
  decoder: StringDecoder;
  watcher?: { close(): void };
}

export class TranscriptTailer {
  private readonly files = new Map<string, FileState>();
  private readonly onLines: (file: string, lines: string[]) => void;
  private readonly pollMs: number;
  private readonly stat: NonNullable<TailerDeps['stat']>;
  private readonly readRange: NonNullable<TailerDeps['readRange']>;
  private readonly watch: NonNullable<TailerDeps['watch']>;
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;
  private rerun = false;

  constructor(opts: { onLines: (file: string, lines: string[]) => void; pollMs?: number; deps?: TailerDeps }) {
    this.onLines = opts.onLines;
    this.pollMs = opts.pollMs ?? 1000;
    this.stat = opts.deps?.stat ?? fsStat;
    this.readRange = opts.deps?.readRange ?? readRangeFromDisk;
    this.watch = opts.deps?.watch ?? watchOnDisk;
  }

  add(file: string, startOffset = 0): void {
    if (this.files.has(file)) return;
    const state: FileState = { offset: startOffset, splitter: new LineSplitter(), decoder: new StringDecoder('utf8') };
    this.files.set(file, state);
    if (this.timer) this.attachWatcher(file, state);
  }

  remove(file: string): void {
    this.files.get(file)?.watcher?.close();
    this.files.delete(file);
  }

  has(file: string): boolean {
    return this.files.has(file);
  }

  /** Read any new bytes from every tailed file. Concurrent calls coalesce into one extra pass. */
  pollOnce(): Promise<void> {
    if (this.running) {
      this.rerun = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.rerun = false;
        for (const file of [...this.files.keys()]) await this.readFile(file);
      } while (this.rerun);
    })().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.pollOnce(), this.pollMs);
    this.timer.unref?.();
    for (const [file, state] of this.files) this.attachWatcher(file, state);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    for (const state of this.files.values()) {
      state.watcher?.close();
      state.watcher = undefined;
    }
  }

  private attachWatcher(file: string, state: FileState): void {
    if (state.watcher) return;
    try {
      state.watcher = this.watch(file, () => void this.pollOnce());
    } catch {
      // File may not exist yet or fs.watch unsupported: interval polling covers it.
    }
  }

  private async readFile(file: string): Promise<void> {
    const state = this.files.get(file);
    if (!state) return;
    try {
      const { size } = await this.stat(file);
      if (size < state.offset) {
        state.offset = 0;
        state.splitter = new LineSplitter();
        state.decoder = new StringDecoder('utf8');
      }
      while (state.offset < size) {
        const end = Math.min(size, state.offset + CHUNK_BYTES);
        const buf = await this.readRange(file, state.offset, end);
        if (buf.length === 0) break;
        state.offset += buf.length;
        const lines = state.splitter.push(state.decoder.write(buf));
        if (lines.length > 0 && this.files.get(file) === state) this.onLines(file, lines);
      }
    } catch {
      // Missing or unreadable file: try again next poll.
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/collectors/transcriptTailer.test.ts && npm run typecheck`
Expected: PASS (9 tests), with no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/collectors/transcriptTailer.ts src/collectors/transcriptTailer.test.ts
git commit -m "feat(collectors): incremental byte-offset transcript tailer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: History scanner with incremental cache

**Files:**
- Create: `src/collectors/historyScanner.ts`
- Test: `src/collectors/historyScanner.test.ts`

**Interfaces:**
- Consumes:
  - `projectsDir(claudeDir)` and `sessionIdFromTranscriptPath(file): { sessionId; isSubagent }` from `src/core/paths.ts` (Task 2).
  - `parseTranscriptLine(line, { sessionId, forceSidechain })` from Task 11.
  - `readRangeFromDisk(p, start, end): Promise<Buffer>` from Task 13.
  - `TranscriptEvent` and `ScanProgress` from Task 1.
- Produces:
  - `interface ScanCacheEntry { mtimeMs: number; size: number; offset: number; events: TranscriptEvent[] }`
  - `interface HistoryScannerDeps { readdir?; stat?; readRange?; readFile?; writeFile?; mkdir?; now? }`
  - `class HistoryScanner { constructor(opts: { claudeDir; cacheDir; maxAgeDays?; deps?; onEvents: (sessionId, events, file) => void; onProgress: (p: ScanProgress) => void }); listFiles(): Promise<string[]>; run(): Promise<void> }`
- Cache:
  - File: `<cacheDir>/scan-cache.json`, shaped `{ version: 1, claudeDir, files: Record<path, ScanCacheEntry> }`.
  - A cache with the wrong version, a different claudeDir, or corrupt contents is ignored.
  - Cached events keep every `usage` and `compact` event. For `costState`, `permissionMode`, `meta`, and `title` (per `source`), only the last one is kept.
- Behavior:
  - The scanner does **not** dedup. The store dedups (Task 18).
  - Only complete lines are consumed. The cached `offset` stops right after the last `\n`.
  - Progress is reported after each file, and a final `{ done: true }` once the cache is saved.
  - It yields with `setImmediate` between files.

- [ ] **Step 1: Write the failing test**

`src/collectors/historyScanner.test.ts`:
```ts
import { appendFile, mkdir, mkdtemp, open, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HistoryScanner } from './historyScanner.js';
import { aiTitleLine, assistantLine, jsonl, userLine } from '../../test/helpers/transcript.js';
import type { ScanProgress, TranscriptEvent } from '../domain/types.js';

let root: string;
let claudeDir: string;
let cacheDir: string;
let mainFile: string;
let subFile: string;
let oldFile: string;
const TS = new Date().toISOString();

async function realReadRange(p: string, start: number, end: number): Promise<Buffer> {
  const fh = await open(p, 'r');
  try {
    const buf = Buffer.alloc(end - start);
    const { bytesRead } = await fh.read(buf, 0, end - start, start);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ccsb-scan-'));
  claudeDir = join(root, 'claude');
  cacheDir = join(root, 'cache');
  const proj = join(claudeDir, 'projects', '-work-proj');
  await mkdir(join(proj, 'sess-a', 'subagents'), { recursive: true });
  await mkdir(join(claudeDir, 'projects', '-work-other'), { recursive: true });
  mainFile = join(proj, 'sess-a.jsonl');
  subFile = join(proj, 'sess-a', 'subagents', 'agent-1.jsonl');
  oldFile = join(claudeDir, 'projects', '-work-other', 'sess-old.jsonl');
  await writeFile(
    mainFile,
    jsonl(
      userLine(TS),
      // one API response split over two lines (same id) — scanner must NOT dedup
      assistantLine({ id: 'msg_1', requestId: 'r1', ts: TS, usage: { input_tokens: 10, output_tokens: 5 } }),
      assistantLine({ id: 'msg_1', requestId: 'r1', ts: TS, usage: { input_tokens: 10, output_tokens: 5 } }),
      '{malformed',
      aiTitleLine('Scan test'),
    ),
  );
  await writeFile(subFile, jsonl(assistantLine({ id: 'msg_s', ts: TS, usage: { output_tokens: 7 } })));
  await writeFile(join(proj, 'sess-a', 'subagents', 'agent-1.meta.json'), '{"agentType":"Explore"}');
  await writeFile(oldFile, jsonl(assistantLine({ id: 'msg_old', ts: TS, usage: { output_tokens: 1 } })));
  const forty = (Date.now() - 40 * 86_400_000) / 1000;
  await utimes(oldFile, forty, forty);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function makeScanner(readRange = vi.fn(realReadRange)) {
  const emitted: Array<{ sessionId: string; events: TranscriptEvent[]; file: string }> = [];
  const progress: ScanProgress[] = [];
  const scanner = new HistoryScanner({
    claudeDir,
    cacheDir,
    deps: { readRange },
    onEvents: (sessionId, events, file) => emitted.push({ sessionId, events, file }),
    onProgress: (p) => progress.push(p),
  });
  return { scanner, emitted, progress, readRange };
}

const usageKeys = (events: TranscriptEvent[]) =>
  events.flatMap((e) => (e.kind === 'usage' ? [e.record.key] : []));

describe('HistoryScanner', () => {
  it('lists recent main and subagent transcripts only', async () => {
    const { scanner } = makeScanner();
    expect((await scanner.listFiles()).sort()).toEqual([mainFile, subFile].sort());
  });

  it('emits parsed events per file, without deduping, with subagent events as sidechain', async () => {
    const { scanner, emitted, progress } = makeScanner();
    await scanner.run();
    const main = emitted.find((e) => e.file === mainFile)!;
    expect(main.sessionId).toBe('sess-a');
    expect(usageKeys(main.events)).toEqual(['msg_1:r1', 'msg_1:r1']);
    expect(main.events).toContainEqual({ kind: 'title', timestamp: 0, title: 'Scan test', source: 'ai-title' });
    const sub = emitted.find((e) => e.file === subFile)!;
    expect(sub.sessionId).toBe('sess-a');
    const subUsage = sub.events.find((e) => e.kind === 'usage');
    expect(subUsage?.kind === 'usage' && subUsage.record.isSidechain).toBe(true);
    expect(progress.at(-1)).toEqual({ done: true, filesDone: 2, filesTotal: 2 });
    expect(progress.slice(0, -1).every((p) => !p.done)).toBe(true);
  });

  it('keeps only the last meta event per file', async () => {
    const { scanner, emitted } = makeScanner();
    await scanner.run();
    const main = emitted.find((e) => e.file === mainFile)!;
    expect(main.events.filter((e) => e.kind === 'meta')).toHaveLength(1);
  });

  it('serves unchanged files from the cache without reading them', async () => {
    await makeScanner().scanner.run();
    const second = makeScanner();
    await second.scanner.run();
    expect(second.readRange).not.toHaveBeenCalled();
    expect(usageKeys(second.emitted.find((e) => e.file === mainFile)!.events)).toEqual(['msg_1:r1', 'msg_1:r1']);
  });

  it('reads only appended complete lines when a file grows', async () => {
    const first = makeScanner();
    await first.scanner.run();
    const sizeBefore = (await stat(mainFile)).size;
    await appendFile(
      mainFile,
      assistantLine({ id: 'msg_2', ts: TS, usage: { output_tokens: 3 } }) + '\n' + '{"type":"assistant","partial',
    );
    const third = makeScanner();
    await third.scanner.run();
    const mainCall = third.readRange.mock.calls.find((c) => c[0] === mainFile)!;
    expect(mainCall[1]).toBe(sizeBefore);
    expect(usageKeys(third.emitted.find((e) => e.file === mainFile)!.events)).toEqual([
      'msg_1:r1',
      'msg_1:r1',
      'msg_2',
    ]);
  });

  it('ignores a corrupt cache file and rescans', async () => {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(join(cacheDir, 'scan-cache.json'), '{corrupt');
    const { scanner, emitted } = makeScanner();
    await scanner.run();
    expect(emitted).toHaveLength(2);
  });

  it('handles a missing projects dir', async () => {
    await rm(join(claudeDir, 'projects'), { recursive: true, force: true });
    const { scanner, emitted, progress } = makeScanner();
    await scanner.run();
    expect(emitted).toEqual([]);
    expect(progress.at(-1)).toEqual({ done: true, filesDone: 0, filesTotal: 0 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/collectors/historyScanner.test.ts`
Expected: FAIL with `Failed to resolve import "./historyScanner.js"`.

- [ ] **Step 3: Write the implementation**

`src/collectors/historyScanner.ts`:
```ts
// Startup scan of all recent transcripts, with an incremental on-disk cache so restarts only read new bytes.
import {
  mkdir as fsMkdir,
  readdir as fsReaddir,
  readFile as fsReadFile,
  stat as fsStat,
  writeFile as fsWriteFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { projectsDir, sessionIdFromTranscriptPath } from '../core/paths.js';
import type { ScanProgress, TranscriptEvent } from '../domain/types.js';
import { parseTranscriptLine } from './transcriptParser.js';
import { readRangeFromDisk } from './transcriptTailer.js';

const DAY_MS = 86_400_000;
const CACHE_VERSION = 1;

export interface ScanCacheEntry {
  mtimeMs: number;
  size: number;
  offset: number;
  events: TranscriptEvent[];
}

interface ScanCacheFile {
  version: number;
  claudeDir: string;
  files: Record<string, ScanCacheEntry>;
}

export interface HistoryScannerDeps {
  readdir?: (dir: string) => Promise<string[]>;
  stat?: (p: string) => Promise<{ mtimeMs: number; size: number; isDirectory(): boolean }>;
  readRange?: (p: string, start: number, end: number) => Promise<Buffer>;
  readFile?: (p: string) => Promise<string>;
  writeFile?: (p: string, data: string) => Promise<void>;
  mkdir?: (p: string) => Promise<unknown>;
  now?: () => number;
}

export interface HistoryScannerOptions {
  claudeDir: string;
  cacheDir: string;
  maxAgeDays?: number;
  deps?: HistoryScannerDeps;
  onEvents: (sessionId: string, events: TranscriptEvent[], file: string) => void;
  onProgress: (p: ScanProgress) => void;
}

/** Keep everything the store aggregates; for "latest wins" kinds keep only the last one. */
export function compactEvents(events: TranscriptEvent[]): TranscriptEvent[] {
  const lastIndex = new Map<string, number>();
  events.forEach((e, i) => {
    if (e.kind === 'usage' || e.kind === 'compact') return;
    lastIndex.set(e.kind === 'title' ? `title:${e.source}` : e.kind, i);
  });
  return events.filter((e, i) => {
    if (e.kind === 'usage' || e.kind === 'compact') return true;
    return lastIndex.get(e.kind === 'title' ? `title:${e.source}` : e.kind) === i;
  });
}

export class HistoryScanner {
  private readonly opts: HistoryScannerOptions;
  private readonly d: Required<HistoryScannerDeps>;
  private readonly cacheFile: string;

  constructor(opts: HistoryScannerOptions) {
    this.opts = opts;
    const d = opts.deps ?? {};
    this.d = {
      readdir: d.readdir ?? ((dir) => fsReaddir(dir)),
      stat: d.stat ?? fsStat,
      readRange: d.readRange ?? readRangeFromDisk,
      readFile: d.readFile ?? ((p) => fsReadFile(p, 'utf8')),
      writeFile: d.writeFile ?? ((p, data) => fsWriteFile(p, data, 'utf8')),
      mkdir: d.mkdir ?? ((p) => fsMkdir(p, { recursive: true })),
      now: d.now ?? Date.now,
    };
    this.cacheFile = join(opts.cacheDir, 'scan-cache.json');
  }

  async listFiles(): Promise<string[]> {
    const cutoff = this.d.now() - (this.opts.maxAgeDays ?? 35) * DAY_MS;
    const root = projectsDir(this.opts.claudeDir);
    const out: string[] = [];
    const recent = async (p: string) => {
      try {
        return (await this.d.stat(p)).mtimeMs >= cutoff;
      } catch {
        return false;
      }
    };
    for (const project of await this.safeReaddir(root)) {
      const projectPath = join(root, project);
      for (const entry of await this.safeReaddir(projectPath)) {
        const entryPath = join(projectPath, entry);
        if (entry.endsWith('.jsonl')) {
          if (await recent(entryPath)) out.push(entryPath);
          continue;
        }
        const subDir = join(entryPath, 'subagents');
        for (const sub of await this.safeReaddir(subDir)) {
          const subPath = join(subDir, sub);
          if (sub.endsWith('.jsonl') && (await recent(subPath))) out.push(subPath);
        }
      }
    }
    return out;
  }

  async run(): Promise<void> {
    const files = await this.listFiles();
    const cache = await this.loadCache();
    const next: Record<string, ScanCacheEntry> = {};
    const total = files.length;
    let done = 0;
    if (total > 0) this.opts.onProgress({ done: false, filesDone: 0, filesTotal: total });

    for (const file of files) {
      try {
        const entry = await this.scanFile(file, cache[file]);
        next[file] = entry;
        const { sessionId } = sessionIdFromTranscriptPath(file);
        if (entry.events.length > 0) this.opts.onEvents(sessionId, entry.events, file);
      } catch {
        // Unreadable file: skip it this run.
      }
      done += 1;
      if (done < total) this.opts.onProgress({ done: false, filesDone: done, filesTotal: total });
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    await this.saveCache(next);
    this.opts.onProgress({ done: true, filesDone: done, filesTotal: total });
  }

  private async scanFile(file: string, prev: ScanCacheEntry | undefined): Promise<ScanCacheEntry> {
    const st = await this.d.stat(file);
    if (prev && prev.mtimeMs === st.mtimeMs && prev.size === st.size) return prev;
    const resume = prev !== undefined && st.size >= prev.offset;
    const start = resume ? prev.offset : 0;
    const { sessionId, isSubagent } = sessionIdFromTranscriptPath(file);
    const buf = start < st.size ? await this.d.readRange(file, start, st.size) : Buffer.alloc(0);
    const lastNewline = buf.lastIndexOf(0x0a);
    const events: TranscriptEvent[] = resume ? [...prev.events] : [];
    if (lastNewline >= 0) {
      for (const line of buf.subarray(0, lastNewline + 1).toString('utf8').split('\n')) {
        if (line !== '') events.push(...parseTranscriptLine(line, { sessionId, forceSidechain: isSubagent }));
      }
    }
    return {
      mtimeMs: st.mtimeMs,
      size: st.size,
      offset: start + lastNewline + 1,
      events: compactEvents(events),
    };
  }

  private async safeReaddir(dir: string): Promise<string[]> {
    try {
      return (await this.d.readdir(dir)).sort();
    } catch {
      return [];
    }
  }

  private async loadCache(): Promise<Record<string, ScanCacheEntry>> {
    try {
      const parsed = JSON.parse(await this.d.readFile(this.cacheFile)) as Partial<ScanCacheFile>;
      if (parsed.version !== CACHE_VERSION || parsed.claudeDir !== this.opts.claudeDir) return {};
      return typeof parsed.files === 'object' && parsed.files !== null ? parsed.files : {};
    } catch {
      return {};
    }
  }

  private async saveCache(files: Record<string, ScanCacheEntry>): Promise<void> {
    const data: ScanCacheFile = { version: CACHE_VERSION, claudeDir: this.opts.claudeDir, files };
    try {
      await this.d.mkdir(this.opts.cacheDir);
      await this.d.writeFile(this.cacheFile, JSON.stringify(data));
    } catch {
      // Cache is an optimisation only.
    }
  }
}
```

Note: in `scanFile`, `lastNewline` is `-1` when no complete line was read, so `offset` becomes `start + 0 = start`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/collectors/historyScanner.test.ts && npm run typecheck`
Expected: PASS (7 tests), with no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/collectors/historyScanner.ts src/collectors/historyScanner.test.ts
git commit -m "feat(collectors): history scanner with incremental scan cache

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Session registry watcher

**Files:**
- Create: `src/collectors/sessionRegistry.ts`
- Test: `src/collectors/sessionRegistry.test.ts`

**Interfaces:**
- Consumes: `RegistryEntry` (Task 1, `src/domain/types.ts`); `sessionsDir(claudeDir: string): string` (Task 2, `src/core/paths.ts`); `isAlive(pid: number, procStart: string | undefined, deps?): boolean` (Task 5, `src/collectors/liveness.ts`).
- Produces:
  ```ts
  export function parseRegistryEntry(raw: unknown): RegistryEntry | null
  export interface RegistryDeps {
    readdir?: (dir: string) => Promise<string[]>;
    readFile?: (p: string) => Promise<string>;
    isAlive?: (pid: number, procStart?: string) => boolean;
    watch?: typeof import('node:fs').watch;
  }
  export class SessionRegistry {
    constructor(opts: { claudeDir: string; pollMs?: number; deps?: RegistryDeps;
                        onUpsert: (e: RegistryEntry) => void; onEnded: (sessionId: string, pid: number) => void });
    scanOnce(): Promise<void>;
    start(): void;
    stop(): void;
  }
  ```
  Semantics: only files ending in `.json` are read (never `*.key`). Every scan calls `onUpsert` for every live entry (the store dedups). A sessionId seen live in an earlier scan that is now missing, unparseable or dead fires `onEnded` exactly once. A file whose PID is dead at the first scan is never upserted and never ended.

- [ ] **Step 1: Write the failing test**

`src/collectors/sessionRegistry.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import type { RegistryEntry } from '../domain/types.js';
import { parseRegistryEntry, SessionRegistry, type RegistryDeps } from './sessionRegistry.js';

const CLAUDE = '/home/u/.claude';
const SESS = join(CLAUDE, 'sessions');

function entry(pid: number, sessionId: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ pid, sessionId, cwd: '/work/proj', procStart: String(pid * 10), ...extra });
}

/** In-memory fake of the sessions dir. Mutate `files` / `alive` between scans. */
function fakeFs(files: Record<string, string>, alive: Set<number>) {
  const readFile = vi.fn(async (p: string) => {
    const name = p.slice(SESS.length + 1);
    const v = files[name];
    if (v === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    return v;
  });
  const deps: RegistryDeps = {
    readdir: vi.fn(async () => Object.keys(files)),
    readFile,
    isAlive: vi.fn((pid: number) => alive.has(pid)),
  };
  return { deps, readFile };
}

function makeRegistry(deps: RegistryDeps) {
  const upserts: RegistryEntry[] = [];
  const ended: Array<[string, number]> = [];
  const reg = new SessionRegistry({
    claudeDir: CLAUDE,
    deps,
    onUpsert: (e) => upserts.push(e),
    onEnded: (sid, pid) => ended.push([sid, pid]),
  });
  return { reg, upserts, ended };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('parseRegistryEntry', () => {
  it('parses required and optional fields', () => {
    const e = parseRegistryEntry({
      pid: 42,
      sessionId: 'abc',
      cwd: '/w',
      startedAt: 1,
      procStart: 9402548,
      version: '2.1.296',
      kind: 'interactive',
      name: 'proj-6f',
      status: 'waiting',
      waitingFor: 'input needed',
      updatedAt: 2,
      statusUpdatedAt: 3,
      messagingSocketPath: '/run/x.sock',
    });
    expect(e).toEqual({
      pid: 42,
      sessionId: 'abc',
      cwd: '/w',
      startedAt: 1,
      procStart: '9402548',
      version: '2.1.296',
      kind: 'interactive',
      name: 'proj-6f',
      status: 'waiting',
      waitingFor: 'input needed',
      updatedAt: 2,
      statusUpdatedAt: 3,
    });
  });
  it('rejects records missing pid, sessionId or cwd, and non-objects', () => {
    expect(parseRegistryEntry({ sessionId: 'a', cwd: '/w' })).toBeNull();
    expect(parseRegistryEntry({ pid: 1, cwd: '/w' })).toBeNull();
    expect(parseRegistryEntry({ pid: 1, sessionId: 'a' })).toBeNull();
    expect(parseRegistryEntry({ pid: '1', sessionId: 'a', cwd: '/w' })).toBeNull();
    expect(parseRegistryEntry(null)).toBeNull();
    expect(parseRegistryEntry('x')).toBeNull();
  });
  it('drops optional fields with wrong types instead of failing', () => {
    expect(parseRegistryEntry({ pid: 1, sessionId: 'a', cwd: '/w', status: 5, startedAt: 'x' })).toEqual({
      pid: 1,
      sessionId: 'a',
      cwd: '/w',
    });
  });
});

describe('SessionRegistry.scanOnce', () => {
  it('never reads *.key files or non-json files', async () => {
    const { deps, readFile } = fakeFs(
      { '100.json': entry(100, 's1'), '100.0123abcd.key': 'SECRET', 'notes.txt': 'x' },
      new Set([100]),
    );
    const { reg, upserts } = makeRegistry(deps);
    await reg.scanOnce();
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(readFile).toHaveBeenCalledWith(join(SESS, '100.json'));
    for (const call of readFile.mock.calls) expect(call[0]).not.toMatch(/\.key$/);
    expect(upserts.map((e) => e.sessionId)).toEqual(['s1']);
  });

  it('upserts live entries on every scan', async () => {
    const { deps } = fakeFs({ '100.json': entry(100, 's1') }, new Set([100]));
    const { reg, upserts } = makeRegistry(deps);
    await reg.scanOnce();
    await reg.scanOnce();
    expect(upserts).toHaveLength(2);
    expect(upserts[0]).toMatchObject({ pid: 100, sessionId: 's1', cwd: '/work/proj', procStart: '1000' });
  });

  it('passes pid and procStart to isAlive', async () => {
    const { deps } = fakeFs({ '100.json': entry(100, 's1') }, new Set([100]));
    const { reg } = makeRegistry(deps);
    await reg.scanOnce();
    expect(deps.isAlive).toHaveBeenCalledWith(100, '1000');
  });

  it('a stale file for a dead PID at startup is never upserted and never ended', async () => {
    const { deps } = fakeFs({ '200.json': entry(200, 'stale') }, new Set());
    const { reg, upserts, ended } = makeRegistry(deps);
    await reg.scanOnce();
    await reg.scanOnce();
    expect(upserts).toEqual([]);
    expect(ended).toEqual([]);
  });

  it('fires onEnded exactly once when a live PID dies', async () => {
    const alive = new Set([100]);
    const { deps } = fakeFs({ '100.json': entry(100, 's1') }, alive);
    const { reg, ended } = makeRegistry(deps);
    await reg.scanOnce();
    alive.delete(100);
    await reg.scanOnce();
    await reg.scanOnce();
    expect(ended).toEqual([['s1', 100]]);
  });

  it('fires onEnded once when a live session file disappears', async () => {
    const files: Record<string, string> = { '100.json': entry(100, 's1'), '101.json': entry(101, 's2') };
    const { deps } = fakeFs(files, new Set([100, 101]));
    const { reg, ended } = makeRegistry(deps);
    await reg.scanOnce();
    delete files['101.json'];
    await reg.scanOnce();
    await reg.scanOnce();
    expect(ended).toEqual([['s2', 101]]);
  });

  it('skips malformed JSON and invalid entries without throwing', async () => {
    const { deps } = fakeFs(
      { '1.json': '{not json', '2.json': JSON.stringify({ pid: 2 }), '3.json': entry(3, 'ok') },
      new Set([1, 2, 3]),
    );
    const { reg, upserts } = makeRegistry(deps);
    await expect(reg.scanOnce()).resolves.toBeUndefined();
    expect(upserts.map((e) => e.sessionId)).toEqual(['ok']);
  });

  it('tolerates a file deleted between readdir and readFile', async () => {
    const deps: RegistryDeps = {
      readdir: async () => ['9.json', '3.json'],
      readFile: async (p: string) => {
        if (p.endsWith('9.json')) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        return entry(3, 'ok');
      },
      isAlive: () => true,
    };
    const { reg, upserts } = makeRegistry(deps);
    await reg.scanOnce();
    expect(upserts.map((e) => e.sessionId)).toEqual(['ok']);
  });

  it('treats a missing sessions dir as empty, and ends previously live sessions', async () => {
    let missing = false;
    const deps: RegistryDeps = {
      readdir: async () => {
        if (missing) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        return ['1.json'];
      },
      readFile: async () => entry(1, 's1'),
      isAlive: () => true,
    };
    const { reg, ended } = makeRegistry(deps);
    await reg.scanOnce();
    missing = true;
    await expect(reg.scanOnce()).resolves.toBeUndefined();
    expect(ended).toEqual([['s1', 1]]);
  });
});

describe('SessionRegistry.start/stop', () => {
  it('scans immediately, then every pollMs, and stops cleanly', async () => {
    vi.useFakeTimers();
    const { deps } = fakeFs({ '1.json': entry(1, 's1') }, new Set([1]));
    const close = vi.fn();
    deps.watch = vi.fn(() => ({ close, on: vi.fn() })) as unknown as RegistryDeps['watch'];
    const upserts: RegistryEntry[] = [];
    const reg = new SessionRegistry({
      claudeDir: CLAUDE,
      pollMs: 2000,
      deps,
      onUpsert: (e) => upserts.push(e),
      onEnded: () => {},
    });
    reg.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(upserts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(upserts).toHaveLength(2);
    reg.stop();
    expect(close).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(upserts).toHaveLength(2);
  });

  it('keeps polling when fs.watch throws', async () => {
    vi.useFakeTimers();
    const { deps } = fakeFs({ '1.json': entry(1, 's1') }, new Set([1]));
    deps.watch = vi.fn(() => {
      throw new Error('ENOSPC');
    }) as unknown as RegistryDeps['watch'];
    const upserts: RegistryEntry[] = [];
    const reg = new SessionRegistry({ claudeDir: CLAUDE, pollMs: 1000, deps, onUpsert: (e) => upserts.push(e), onEnded: () => {} });
    expect(() => reg.start()).not.toThrow();
    await vi.advanceTimersByTimeAsync(1000);
    expect(upserts.length).toBeGreaterThanOrEqual(2);
    reg.stop();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/collectors/sessionRegistry.test.ts`
Expected: FAIL with `Failed to resolve import "./sessionRegistry.js"`.

- [ ] **Step 3: Write minimal implementation**

`src/collectors/sessionRegistry.ts`:
```ts
import { readdir as fsReaddir, readFile as fsReadFile } from 'node:fs/promises';
import { watch as fsWatch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import type { RegistryEntry } from '../domain/types.js';
import { sessionsDir } from '../core/paths.js';
import { isAlive as defaultIsAlive } from './liveness.js';

export interface RegistryDeps {
  readdir?: (dir: string) => Promise<string[]>;
  readFile?: (p: string) => Promise<string>;
  isAlive?: (pid: number, procStart?: string) => boolean;
  watch?: typeof fsWatch;
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);

/** Validate a parsed `<claude>/sessions/<pid>.json` record. Unknown fields are dropped. */
export function parseRegistryEntry(raw: unknown): RegistryEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const pid = num(r.pid);
  const sessionId = str(r.sessionId);
  const cwd = str(r.cwd);
  if (pid === undefined || sessionId === undefined || cwd === undefined) return null;

  const e: RegistryEntry = { pid, sessionId, cwd };
  const startedAt = num(r.startedAt);
  if (startedAt !== undefined) e.startedAt = startedAt;
  const procStart = typeof r.procStart === 'number' ? String(r.procStart) : str(r.procStart);
  if (procStart !== undefined) e.procStart = procStart;
  const version = str(r.version);
  if (version !== undefined) e.version = version;
  const kind = str(r.kind);
  if (kind !== undefined) e.kind = kind;
  const name = str(r.name);
  if (name !== undefined) e.name = name;
  const status = str(r.status);
  if (status !== undefined) e.status = status;
  const waitingFor = str(r.waitingFor);
  if (waitingFor !== undefined) e.waitingFor = waitingFor;
  const updatedAt = num(r.updatedAt);
  if (updatedAt !== undefined) e.updatedAt = updatedAt;
  const statusUpdatedAt = num(r.statusUpdatedAt);
  if (statusUpdatedAt !== undefined) e.statusUpdatedAt = statusUpdatedAt;
  return e;
}

export class SessionRegistry {
  private readonly dir: string;
  private readonly pollMs: number;
  private readonly readdir: (dir: string) => Promise<string[]>;
  private readonly readFile: (p: string) => Promise<string>;
  private readonly alive: (pid: number, procStart?: string) => boolean;
  private readonly watchFn: typeof fsWatch;
  private readonly onUpsert: (e: RegistryEntry) => void;
  private readonly onEnded: (sessionId: string, pid: number) => void;
  /** sessionId → pid for sessions live as of the last scan. */
  private live = new Map<string, number>();
  private scanning: Promise<void> | null = null;
  private rescan = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private watcher: FSWatcher | null = null;

  constructor(opts: {
    claudeDir: string;
    pollMs?: number;
    deps?: RegistryDeps;
    onUpsert: (e: RegistryEntry) => void;
    onEnded: (sessionId: string, pid: number) => void;
  }) {
    const d = opts.deps ?? {};
    this.dir = sessionsDir(opts.claudeDir);
    this.pollMs = opts.pollMs ?? 2000;
    this.readdir = d.readdir ?? ((dir) => fsReaddir(dir));
    this.readFile = d.readFile ?? ((p) => fsReadFile(p, 'utf8'));
    this.alive = d.isAlive ?? ((pid, procStart) => defaultIsAlive(pid, procStart));
    this.watchFn = d.watch ?? fsWatch;
    this.onUpsert = opts.onUpsert;
    this.onEnded = opts.onEnded;
  }

  /** One full pass over the sessions dir. Concurrent calls coalesce into one extra pass. */
  scanOnce(): Promise<void> {
    if (this.scanning) {
      this.rescan = true;
      return this.scanning;
    }
    this.scanning = (async () => {
      do {
        this.rescan = false;
        await this.doScan();
      } while (this.rescan);
    })().finally(() => {
      this.scanning = null;
    });
    return this.scanning;
  }

  private async doScan(): Promise<void> {
    let names: string[];
    try {
      names = await this.readdir(this.dir);
    } catch {
      names = [];
    }
    const seen = new Map<string, number>();
    for (const name of names) {
      // Only `<pid>.json`. Never touch `<pid>.<hash>.key` secrets or anything else.
      if (!name.endsWith('.json')) continue;
      let raw: unknown;
      try {
        raw = JSON.parse(await this.readFile(join(this.dir, name)));
      } catch {
        continue;
      }
      const e = parseRegistryEntry(raw);
      if (!e) continue;
      if (!this.alive(e.pid, e.procStart)) continue;
      seen.set(e.sessionId, e.pid);
      this.onUpsert(e);
    }
    for (const [sessionId, pid] of this.live) {
      if (!seen.has(sessionId)) this.onEnded(sessionId, pid);
    }
    this.live = seen;
  }

  start(): void {
    void this.scanOnce();
    this.timer = setInterval(() => void this.scanOnce(), this.pollMs);
    try {
      const w = this.watchFn(this.dir, () => void this.scanOnce());
      w.on?.('error', () => {
        w.close();
        if (this.watcher === w) this.watcher = null;
      });
      this.watcher = w;
    } catch {
      // fs.watch unsupported or dir missing: polling alone is enough.
      this.watcher = null;
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.watcher?.close();
    this.watcher = null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/collectors/sessionRegistry.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npx eslint src/collectors/sessionRegistry.ts src/collectors/sessionRegistry.test.ts`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/collectors/sessionRegistry.ts src/collectors/sessionRegistry.test.ts
git commit -m "feat(collectors): watch Claude Code session registry with liveness checks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Subagent activity scanner

**Files:**
- Create: `src/collectors/subagents.ts`
- Test: `src/collectors/subagents.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks at runtime. The caller (Task 23) passes `subagentsDir(claudeDir, cwd, sessionId)` from Task 2.
- Produces:
  ```ts
  export interface AgentActivity { activeCount: number; names: string[]; files: string[] }
  export interface SubagentDeps {
    readdir?: (dir: string) => Promise<string[]>;
    stat?: (p: string) => Promise<{ mtimeMs: number }>;
    readFile?: (p: string) => Promise<string>;
  }
  export async function scanSubagents(dir: string, now: number, deps?: SubagentDeps, activeWindowMs?: number): Promise<AgentActivity>
  ```
  `files` = every `agent-*.jsonl` path, sorted, active or not (Task 23 tails them all). An agent is active if its mtime ≥ `now − activeWindowMs` (default 30 000). Its name is `agentType` from the sibling `agent-*.meta.json`, else `'agent'`. A missing dir gives `{ activeCount: 0, names: [], files: [] }`.

- [ ] **Step 1: Write the failing test**

`src/collectors/subagents.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { scanSubagents, type SubagentDeps } from './subagents.js';

const DIR = '/c/projects/-work-proj/sess-1/subagents';
const NOW = 1_000_000_000;

function deps(files: Record<string, { mtimeMs?: number; content?: string }>): SubagentDeps {
  return {
    readdir: vi.fn(async () => Object.keys(files)),
    stat: vi.fn(async (p: string) => {
      const f = files[p.slice(DIR.length + 1)];
      if (!f || f.mtimeMs === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return { mtimeMs: f.mtimeMs };
    }),
    readFile: vi.fn(async (p: string) => {
      const f = files[p.slice(DIR.length + 1)];
      if (!f || f.content === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return f.content;
    }),
  };
}

describe('scanSubagents', () => {
  it('returns empty activity when the dir is missing', async () => {
    const d: SubagentDeps = {
      readdir: async () => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      },
    };
    await expect(scanSubagents(DIR, NOW, d)).resolves.toEqual({ activeCount: 0, names: [], files: [] });
  });

  it('lists all agent jsonl files and counts only recently modified ones as active', async () => {
    const d = deps({
      'agent-b.jsonl': { mtimeMs: NOW - 5_000 },
      'agent-b.meta.json': { content: JSON.stringify({ agentType: 'Explore', description: 'x' }) },
      'agent-a.jsonl': { mtimeMs: NOW - 31_000 },
      'agent-a.meta.json': { content: JSON.stringify({ agentType: 'Plan' }) },
      'agent-c.jsonl': { mtimeMs: NOW },
      'notes.txt': { mtimeMs: NOW },
    });
    const r = await scanSubagents(DIR, NOW, d);
    expect(r.files).toEqual([join(DIR, 'agent-a.jsonl'), join(DIR, 'agent-b.jsonl'), join(DIR, 'agent-c.jsonl')]);
    expect(r.activeCount).toBe(2);
    expect(r.names).toEqual(['Explore', 'agent']);
  });

  it('honors a custom active window', async () => {
    const d = deps({ 'agent-a.jsonl': { mtimeMs: NOW - 50_000 } });
    expect((await scanSubagents(DIR, NOW, d, 60_000)).activeCount).toBe(1);
    expect((await scanSubagents(DIR, NOW, d, 30_000)).activeCount).toBe(0);
  });

  it('falls back to "agent" for malformed or missing meta, and skips files whose stat fails', async () => {
    const d = deps({
      'agent-a.jsonl': { mtimeMs: NOW },
      'agent-a.meta.json': { content: '{bad' },
      'agent-gone.jsonl': {},
    });
    const r = await scanSubagents(DIR, NOW, d);
    expect(r.activeCount).toBe(1);
    expect(r.names).toEqual(['agent']);
    expect(r.files).toEqual([join(DIR, 'agent-a.jsonl'), join(DIR, 'agent-gone.jsonl')]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/collectors/subagents.test.ts`
Expected: FAIL with `Failed to resolve import "./subagents.js"`.

- [ ] **Step 3: Write minimal implementation**

`src/collectors/subagents.ts`:
```ts
import { readdir as fsReaddir, readFile as fsReadFile, stat as fsStat } from 'node:fs/promises';
import { join } from 'node:path';

export interface AgentActivity {
  activeCount: number;
  names: string[];
  files: string[];
}

export interface SubagentDeps {
  readdir?: (dir: string) => Promise<string[]>;
  stat?: (p: string) => Promise<{ mtimeMs: number }>;
  readFile?: (p: string) => Promise<string>;
}

/** Inspect `<session>/subagents/`: every agent transcript path, plus which agents wrote recently. */
export async function scanSubagents(
  dir: string,
  now: number,
  deps: SubagentDeps = {},
  activeWindowMs = 30_000,
): Promise<AgentActivity> {
  const readdir = deps.readdir ?? ((d: string) => fsReaddir(d));
  const stat = deps.stat ?? ((p: string) => fsStat(p));
  const readFile = deps.readFile ?? ((p: string) => fsReadFile(p, 'utf8'));

  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return { activeCount: 0, names: [], files: [] };
  }

  const files = names
    .filter((n) => n.startsWith('agent-') && n.endsWith('.jsonl'))
    .sort()
    .map((n) => join(dir, n));

  const activeNames: string[] = [];
  for (const file of files) {
    let mtimeMs: number;
    try {
      mtimeMs = (await stat(file)).mtimeMs;
    } catch {
      continue;
    }
    if (mtimeMs < now - activeWindowMs) continue;
    activeNames.push(await agentName(file, readFile));
  }
  return { activeCount: activeNames.length, names: activeNames, files };
}

async function agentName(file: string, readFile: (p: string) => Promise<string>): Promise<string> {
  try {
    const meta: unknown = JSON.parse(await readFile(file.replace(/\.jsonl$/, '.meta.json')));
    if (meta && typeof meta === 'object') {
      const t = (meta as Record<string, unknown>).agentType;
      if (typeof t === 'string' && t.length > 0) return t;
    }
  } catch {
    // missing or malformed meta: fall through
  }
  return 'agent';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/collectors/subagents.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npx eslint src/collectors/subagents.ts src/collectors/subagents.test.ts`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/collectors/subagents.ts src/collectors/subagents.test.ts
git commit -m "feat(collectors): detect active subagents per session

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: Usage API parser and poller

**Files:**
- Create: `src/collectors/usageApi.ts`
- Test: `src/collectors/usageApi.test.ts`

**Interfaces:**
- Consumes: `Limit`, `LimitsState`, `ExtraUsage` (Task 1); `readCredentials(claudeDir, deps?): Promise<CredentialsResult>` and `CredentialsResult` (Task 6, `src/collectors/credentials.ts`).
- Produces:
  ```ts
  export const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
  export function parseUsageResponse(json: unknown): Omit<LimitsState, 'status' | 'fetchedAt'>;
  export interface UsagePollerDeps {
    fetch?: typeof fetch;
    readCredentials?: (claudeDir: string) => Promise<CredentialsResult>;
    now?: () => number;
    setTimeout?: (fn: () => void, ms: number) => unknown;
    clearTimeout?: (handle: unknown) => void;
  }
  export class UsagePoller {
    constructor(opts: { claudeDir: string; intervalSeconds: number; version: string; enabled: boolean;
                        deps?: UsagePollerDeps; onUpdate: (s: LimitsState) => void });
    pollOnce(): Promise<number>; // ms until next poll
    start(): void;
    stop(): void;
  }
  ```
  Parse rules (spec §3.4):
  - **5h:** label `'5h'`, from flat `five_hour` first, then `limits[kind='session']`.
  - **Weekly:** label `'Week'`, from flat `seven_day` first, then `limits[kind='weekly_all']`.
  - **Flat buckets:** a bucket counts only when `utilization` is a number. `null` or a missing bucket falls through to the `limits[]` entry, never to a phantom 0. If the flat bucket lacks `resets_at`, that value is taken from the matching `limits[]` entry.
  - **Placeholders:** a `limits[]` entry with `percent` 0 or null, no `resets_at`, and no model scope is ignored.
  - **Per-model:** legacy `seven_day_opus` → `'Opus'` and `seven_day_sonnet` → `'Sonnet'` come first. Then each `weekly_scoped` entry, labelled by its family (`/opus|sonnet|haiku|fable/i`, capitalised) or else its raw display name, unless that label is already present. A `weekly_scoped` entry with percent 0 and `resets_at` null is real data and is kept.
  - **Extra usage:** `extra_usage` cents ÷ 100 → `limitAmount` / `usedAmount`.
  - **Bad input:** anything unparseable gives `{ perModelWeekly: [] }`.

  Poller statuses: `ok`; `stale` (prior good values retained, with old `fetchedAt`); `error` (no prior good); `no-credentials`; `expired` (retains prior values); `disabled`; `loading` (first emit on start).

  Next-poll delays:
  - ok: `max(30, intervalSeconds)` s.
  - 429: `Retry-After` s, default 300.
  - Other failures: 60 s doubling, capped at 600 s. Success resets the backoff.

- [ ] **Step 1: Write the failing test**

`src/collectors/usageApi.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LimitsState } from '../domain/types.js';
import type { CredentialsResult } from './credentials.js';
import { parseUsageResponse, USAGE_URL, UsagePoller, type UsagePollerDeps } from './usageApi.js';

const NOW = Date.parse('2026-10-11T14:00:00Z');
const R1 = '2026-10-11T16:14:00Z';
const R2 = '2026-10-15T09:00:00Z';

describe('parseUsageResponse', () => {
  it('reads the legacy flat bucket shape', () => {
    const r = parseUsageResponse({
      five_hour: { utilization: 58, resets_at: R1 },
      seven_day: { utilization: 31, resets_at: R2 },
      seven_day_opus: { utilization: 22, resets_at: R2 },
      seven_day_sonnet: null,
    });
    expect(r.block).toEqual({ label: '5h', percent: 58, resetsAt: Date.parse(R1) });
    expect(r.weekly).toEqual({ label: 'Week', percent: 31, resetsAt: Date.parse(R2) });
    expect(r.perModelWeekly).toEqual([{ label: 'Opus', percent: 22, resetsAt: Date.parse(R2) }]);
  });

  it('reads the newer limits[] shape when flat buckets are null', () => {
    const r = parseUsageResponse({
      five_hour: null,
      seven_day: null,
      limits: [
        { kind: 'session', percent: 42, resets_at: R1 },
        { kind: 'weekly_all', percent: 17, resets_at: R2 },
        { kind: 'weekly_scoped', percent: 9, resets_at: R2, scope: { model: { display_name: 'Claude Sonnet' } } },
      ],
    });
    expect(r.block).toEqual({ label: '5h', percent: 42, resetsAt: Date.parse(R1) });
    expect(r.weekly).toEqual({ label: 'Week', percent: 17, resetsAt: Date.parse(R2) });
    expect(r.perModelWeekly).toEqual([{ label: 'Sonnet', percent: 9, resetsAt: Date.parse(R2) }]);
  });

  it('ignores placeholder limits[] entries (0% with no reset and no model) instead of showing phantom 0%', () => {
    const r = parseUsageResponse({
      five_hour: null,
      limits: [
        { kind: 'session', percent: 0, resets_at: null },
        { kind: 'weekly_all', percent: null },
      ],
    });
    expect(r.block).toBeUndefined();
    expect(r.weekly).toBeUndefined();
    expect(r.perModelWeekly).toEqual([]);
  });

  it('prefers flat buckets over limits[] entries', () => {
    const r = parseUsageResponse({
      five_hour: { utilization: 58, resets_at: R1 },
      limits: [{ kind: 'session', percent: 99, resets_at: R2 }],
    });
    expect(r.block).toEqual({ label: '5h', percent: 58, resetsAt: Date.parse(R1) });
  });

  it('takes resets_at from limits[] when the flat bucket lacks it', () => {
    const r = parseUsageResponse({
      five_hour: { utilization: 58 },
      limits: [{ kind: 'session', percent: 99, resets_at: R1 }],
    });
    expect(r.block).toEqual({ label: '5h', percent: 58, resetsAt: Date.parse(R1) });
  });

  it('keeps weekly_scoped per-model entries reporting 0% with no reset (real data)', () => {
    const r = parseUsageResponse({
      limits: [{ kind: 'weekly_scoped', percent: 0, resets_at: null, scope: { model: { display_name: 'Fable' } } }],
    });
    expect(r.perModelWeekly).toEqual([{ label: 'Fable', percent: 0 }]);
  });

  it('does not duplicate a model reported both as a legacy bucket and weekly_scoped', () => {
    const r = parseUsageResponse({
      seven_day_opus: { utilization: 22, resets_at: R2 },
      limits: [{ kind: 'weekly_scoped', percent: 50, resets_at: R2, scope: { model: { display_name: 'Opus' } } }],
    });
    expect(r.perModelWeekly).toEqual([{ label: 'Opus', percent: 22, resetsAt: Date.parse(R2) }]);
  });

  it('uses the raw display name for unknown model families', () => {
    const r = parseUsageResponse({
      limits: [{ kind: 'weekly_scoped', percent: 3, resets_at: R2, scope: { model: { display_name: 'Nova' } } }],
    });
    expect(r.perModelWeekly).toEqual([{ label: 'Nova', percent: 3, resetsAt: Date.parse(R2) }]);
  });

  it('converts extra usage cents to amounts', () => {
    const r = parseUsageResponse({
      extra_usage: { is_enabled: true, monthly_limit: 5000, used_credits: 1234, utilization: 24.68, currency: 'USD' },
    });
    expect(r.extra).toEqual({ enabled: true, limitAmount: 50, usedAmount: 12.34, percent: 24.68, currency: 'USD' });
  });

  it('never throws on garbage', () => {
    for (const bad of [null, undefined, 'x', 42, [], { five_hour: 'bad', limits: 'nope' }]) {
      expect(parseUsageResponse(bad)).toEqual({ perModelWeekly: [] });
    }
  });
});

// ---------- poller ----------

const okBody = {
  five_hour: { utilization: 58, resets_at: R1 },
  seven_day: { utilization: 31, resets_at: R2 },
};

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function makePoller(
  responses: Array<Response | Error>,
  opts: { creds?: CredentialsResult; intervalSeconds?: number; enabled?: boolean } = {},
) {
  const updates: LimitsState[] = [];
  let t = NOW;
  const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    const next = responses.shift();
    if (!next) throw new Error('no more responses');
    if (next instanceof Error) throw next;
    return next;
  });
  const deps: UsagePollerDeps = {
    fetch: fetchMock as unknown as typeof fetch,
    readCredentials: vi.fn(async () => opts.creds ?? { kind: 'ok' as const, accessToken: 'tok-123' }),
    now: () => t,
  };
  const poller = new UsagePoller({
    claudeDir: '/home/u/.claude',
    intervalSeconds: opts.intervalSeconds ?? 60,
    version: '0.1.0',
    enabled: opts.enabled ?? true,
    deps,
    onUpdate: (s) => updates.push(s),
  });
  return { poller, updates, fetchMock, deps, advance: (ms: number) => (t += ms) };
}

describe('UsagePoller.pollOnce', () => {
  it('fetches with OAuth headers and emits ok state', async () => {
    const { poller, updates, fetchMock } = makePoller([jsonResponse(okBody)]);
    const delay = await poller.pollOnce();
    expect(delay).toBe(60_000);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(USAGE_URL);
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe('Bearer tok-123');
    expect(headers.get('anthropic-beta')).toBe('oauth-2025-04-20');
    expect(headers.get('user-agent')).toBe('ccstatusboard/0.1.0');
    expect(updates.at(-1)).toMatchObject({ status: 'ok', fetchedAt: NOW, block: { percent: 58 }, weekly: { percent: 31 } });
  });

  it('enforces a 30s minimum interval', async () => {
    const { poller } = makePoller([jsonResponse(okBody)], { intervalSeconds: 10 });
    expect(await poller.pollOnce()).toBe(30_000);
  });

  it('reports no-credentials without calling fetch', async () => {
    const { poller, updates, fetchMock } = makePoller([], { creds: { kind: 'missing' } });
    expect(await poller.pollOnce()).toBe(60_000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(updates.at(-1)).toEqual({ status: 'no-credentials', perModelWeekly: [] });
  });

  it('reports expired without calling fetch', async () => {
    const { poller, updates, fetchMock } = makePoller([], { creds: { kind: 'expired', expiresAt: NOW - 1 } });
    await poller.pollOnce();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(updates.at(-1)).toMatchObject({ status: 'expired', perModelWeekly: [] });
  });

  it('honors Retry-After on 429, defaulting to 300s', async () => {
    const { poller } = makePoller([
      jsonResponse({}, 429, { 'retry-after': '120' }),
      jsonResponse({}, 429),
    ]);
    expect(await poller.pollOnce()).toBe(120_000);
    expect(await poller.pollOnce()).toBe(300_000);
  });

  it('backs off exponentially from 60s and caps at 600s', async () => {
    const { poller, updates } = makePoller([
      jsonResponse({}, 500),
      jsonResponse({}, 500),
      new Error('ECONNRESET'),
      jsonResponse({}, 503),
      jsonResponse({}, 500),
      jsonResponse({}, 500),
    ]);
    const delays: number[] = [];
    for (let i = 0; i < 6; i++) delays.push(await poller.pollOnce());
    expect(delays).toEqual([60_000, 120_000, 240_000, 480_000, 600_000, 600_000]);
    expect(updates.at(-1)).toMatchObject({ status: 'error', perModelWeekly: [] });
  });

  it('retains last good values as stale on failure, and resets backoff after success', async () => {
    const { poller, updates, advance } = makePoller([
      jsonResponse(okBody),
      jsonResponse({}, 500),
      jsonResponse({}, 429, { 'retry-after': '90' }),
      jsonResponse(okBody),
      jsonResponse({}, 500),
    ]);
    await poller.pollOnce();
    advance(60_000);
    expect(await poller.pollOnce()).toBe(60_000);
    expect(updates.at(-1)).toMatchObject({ status: 'stale', fetchedAt: NOW, block: { percent: 58 } });
    expect(await poller.pollOnce()).toBe(90_000);
    expect(updates.at(-1)).toMatchObject({ status: 'stale', block: { percent: 58 } });
    expect(await poller.pollOnce()).toBe(60_000);
    expect(updates.at(-1)).toMatchObject({ status: 'ok' });
    expect(await poller.pollOnce()).toBe(60_000); // backoff restarted at 60s
  });

  it('treats a non-object JSON body as an error', async () => {
    const { poller, updates } = makePoller([jsonResponse('nope')]);
    expect(await poller.pollOnce()).toBe(60_000);
    expect(updates.at(-1)).toMatchObject({ status: 'error' });
  });
});

describe('UsagePoller.start/stop', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits disabled once and never fetches when disabled', async () => {
    const { poller, updates, fetchMock } = makePoller([], { enabled: false });
    poller.start();
    await Promise.resolve();
    expect(updates).toEqual([{ status: 'disabled', perModelWeekly: [] }]);
    expect(fetchMock).not.toHaveBeenCalled();
    poller.stop();
  });

  it('emits loading, polls immediately, and reschedules with the returned delay', async () => {
    vi.useFakeTimers();
    const { poller, updates, fetchMock } = makePoller([jsonResponse(okBody), jsonResponse(okBody)]);
    poller.start();
    expect(updates[0]).toEqual({ status: 'loading', perModelWeekly: [] });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    poller.stop();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/collectors/usageApi.test.ts`
Expected: FAIL with `Failed to resolve import "./usageApi.js"`.

- [ ] **Step 3: Write minimal implementation**

`src/collectors/usageApi.ts`:
```ts
import { z } from 'zod';
import type { ExtraUsage, Limit, LimitsState } from '../domain/types.js';
import { readCredentials as defaultReadCredentials, type CredentialsResult } from './credentials.js';

export const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';

const MIN_INTERVAL_S = 30;
const DEFAULT_RETRY_AFTER_S = 300;
const BACKOFF_BASE_MS = 60_000;
const BACKOFF_CAP_MS = 600_000;
const REQUEST_TIMEOUT_MS = 5_000;

// ---------- response parsing ----------

const nullableNum = z.number().nullable().optional().catch(undefined);
const nullableStr = z.string().nullable().optional().catch(undefined);

const bucketSchema = z
  .looseObject({ utilization: nullableNum, resets_at: nullableStr })
  .nullable()
  .optional()
  .catch(undefined);

const limitSchema = z.looseObject({
  kind: nullableStr,
  percent: nullableNum,
  resets_at: nullableStr,
  scope: z
    .looseObject({
      model: z.looseObject({ display_name: nullableStr }).nullable().optional().catch(undefined),
    })
    .nullable()
    .optional()
    .catch(undefined),
});

const responseSchema = z.looseObject({
  five_hour: bucketSchema,
  seven_day: bucketSchema,
  seven_day_sonnet: bucketSchema,
  seven_day_opus: bucketSchema,
  limits: z.array(limitSchema).nullable().optional().catch(undefined),
  extra_usage: z
    .looseObject({
      is_enabled: z.boolean().nullable().optional().catch(undefined),
      monthly_limit: nullableNum,
      used_credits: nullableNum,
      utilization: nullableNum,
      currency: nullableStr,
    })
    .nullable()
    .optional()
    .catch(undefined),
});

type Bucket = z.infer<typeof bucketSchema>;
type ApiLimit = z.infer<typeof limitSchema>;

function toMs(iso: string | null | undefined): number | undefined {
  if (!iso) return undefined;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? undefined : ms;
}

function makeLimit(label: string, percent: number, resetsAt: number | undefined): Limit {
  return resetsAt === undefined ? { label, percent } : { label, percent, resetsAt };
}

function fromBucket(label: string, b: Bucket): Limit | undefined {
  if (!b || typeof b.utilization !== 'number') return undefined;
  return makeLimit(label, b.utilization, toMs(b.resets_at));
}

function modelName(l: ApiLimit): string | undefined {
  const n = l.scope?.model?.display_name;
  return n ? n : undefined;
}

function isPlaceholder(l: ApiLimit): boolean {
  if (modelName(l)) return false;
  return (l.percent ?? 0) === 0 && !l.resets_at;
}

function fromApiLimit(label: string, l: ApiLimit | undefined): Limit | undefined {
  if (!l || isPlaceholder(l) || typeof l.percent !== 'number') return undefined;
  return makeLimit(label, l.percent, toMs(l.resets_at));
}

/** Flat bucket first; limits[] entry fills the value or a missing reset time. */
function pick(label: string, flat: Bucket, entry: ApiLimit | undefined): Limit | undefined {
  const a = fromBucket(label, flat);
  const b = fromApiLimit(label, entry);
  if (!a) return b;
  if (a.resetsAt === undefined && b?.resetsAt !== undefined) return { ...a, resetsAt: b.resetsAt };
  return a;
}

function familyLabel(displayName: string): string {
  const m = /(opus|sonnet|haiku|fable)/i.exec(displayName);
  if (!m) return displayName.trim();
  const f = m[1]!.toLowerCase();
  return f[0]!.toUpperCase() + f.slice(1);
}

export function parseUsageResponse(json: unknown): Omit<LimitsState, 'status' | 'fetchedAt'> {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return { perModelWeekly: [] };
  const parsed = responseSchema.safeParse(json);
  if (!parsed.success) return { perModelWeekly: [] };
  const r = parsed.data;
  const limits = r.limits ?? [];
  const byKind = (kind: string) => limits.find((l) => l.kind === kind);

  const out: Omit<LimitsState, 'status' | 'fetchedAt'> = { perModelWeekly: [] };
  const block = pick('5h', r.five_hour, byKind('session'));
  if (block) out.block = block;
  const weekly = pick('Week', r.seven_day, byKind('weekly_all'));
  if (weekly) out.weekly = weekly;

  const perModel = new Map<string, Limit>();
  const opus = fromBucket('Opus', r.seven_day_opus);
  if (opus) perModel.set('Opus', opus);
  const sonnet = fromBucket('Sonnet', r.seven_day_sonnet);
  if (sonnet) perModel.set('Sonnet', sonnet);
  for (const l of limits) {
    if (l.kind !== 'weekly_scoped') continue;
    const name = modelName(l);
    if (!name) continue;
    const label = familyLabel(name);
    if (perModel.has(label)) continue;
    const lim = fromApiLimit(label, l);
    if (lim) perModel.set(label, lim);
  }
  out.perModelWeekly = [...perModel.values()];

  const x = r.extra_usage;
  if (x && typeof x.is_enabled === 'boolean') {
    const extra: ExtraUsage = { enabled: x.is_enabled };
    if (typeof x.monthly_limit === 'number') extra.limitAmount = x.monthly_limit / 100;
    if (typeof x.used_credits === 'number') extra.usedAmount = x.used_credits / 100;
    if (typeof x.utilization === 'number') extra.percent = x.utilization;
    if (x.currency) extra.currency = x.currency;
    out.extra = extra;
  }
  return out;
}

// ---------- poller ----------

export interface UsagePollerDeps {
  fetch?: typeof fetch;
  readCredentials?: (claudeDir: string) => Promise<CredentialsResult>;
  now?: () => number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

export class UsagePoller {
  private readonly claudeDir: string;
  private readonly intervalMs: number;
  private readonly userAgent: string;
  private readonly enabled: boolean;
  private readonly onUpdate: (s: LimitsState) => void;
  private readonly fetchFn: typeof fetch;
  private readonly readCreds: (claudeDir: string) => Promise<CredentialsResult>;
  private readonly now: () => number;
  private readonly setT: (fn: () => void, ms: number) => unknown;
  private readonly clearT: (handle: unknown) => void;
  private lastGood: LimitsState | null = null;
  private failures = 0;
  private timer: unknown = null;
  private stopped = false;

  constructor(opts: {
    claudeDir: string;
    intervalSeconds: number;
    version: string;
    enabled: boolean;
    deps?: UsagePollerDeps;
    onUpdate: (s: LimitsState) => void;
  }) {
    const d = opts.deps ?? {};
    this.claudeDir = opts.claudeDir;
    this.intervalMs = Math.max(MIN_INTERVAL_S, opts.intervalSeconds) * 1000;
    this.userAgent = `ccstatusboard/${opts.version}`;
    this.enabled = opts.enabled;
    this.onUpdate = opts.onUpdate;
    this.fetchFn = d.fetch ?? fetch;
    this.readCreds = d.readCredentials ?? ((dir) => defaultReadCredentials(dir));
    this.now = d.now ?? Date.now;
    this.setT = d.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearT = d.clearTimeout ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  /** One poll. Emits a state and returns the delay in ms until the next poll. */
  async pollOnce(): Promise<number> {
    const creds = await this.readCreds(this.claudeDir);
    if (creds.kind === 'missing') {
      this.onUpdate({ status: 'no-credentials', perModelWeekly: [] });
      return this.intervalMs;
    }
    if (creds.kind === 'expired') {
      this.onUpdate({ ...(this.lastGood ?? { perModelWeekly: [] }), status: 'expired' });
      return this.intervalMs;
    }

    let res: Response;
    try {
      res = await this.fetchFn(USAGE_URL, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${creds.accessToken}`,
          'anthropic-beta': 'oauth-2025-04-20',
          'User-Agent': this.userAgent,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      return this.fail(err instanceof Error ? err.message : 'network error');
    }

    if (res.status === 429) {
      const ra = Number.parseInt(res.headers.get('retry-after') ?? '', 10);
      this.emitFailure('rate limited');
      return (Number.isFinite(ra) && ra >= 0 ? ra : DEFAULT_RETRY_AFTER_S) * 1000;
    }
    if (!res.ok) return this.fail(`HTTP ${res.status}`);

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      return this.fail('invalid JSON');
    }
    if (!json || typeof json !== 'object' || Array.isArray(json)) return this.fail('unexpected response');

    this.failures = 0;
    this.lastGood = { ...parseUsageResponse(json), status: 'ok', fetchedAt: this.now() };
    this.onUpdate(this.lastGood);
    return this.intervalMs;
  }

  private fail(error: string): number {
    this.failures += 1;
    this.emitFailure(error);
    return Math.min(BACKOFF_BASE_MS * 2 ** (this.failures - 1), BACKOFF_CAP_MS);
  }

  private emitFailure(error: string): void {
    if (this.lastGood) this.onUpdate({ ...this.lastGood, status: 'stale', error });
    else this.onUpdate({ status: 'error', perModelWeekly: [], error });
  }

  start(): void {
    this.stopped = false;
    if (!this.enabled) {
      this.onUpdate({ status: 'disabled', perModelWeekly: [] });
      return;
    }
    this.onUpdate({ status: 'loading', perModelWeekly: [] });
    const run = async (): Promise<void> => {
      let delay: number;
      try {
        delay = await this.pollOnce();
      } catch (err) {
        delay = this.fail(err instanceof Error ? err.message : 'poll failed');
      }
      if (!this.stopped) this.timer = this.setT(() => void run(), delay);
    };
    this.timer = this.setT(() => void run(), 0);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) this.clearT(this.timer);
    this.timer = null;
  }
}
```

Note: `error` is an optional field on `LimitsState`, so the `{ status: 'error', perModelWeekly: [], error }` emits still satisfy the `toMatchObject` and `toEqual` assertions above. The `no-credentials` and `disabled` emits carry no `error` key, which keeps their `toEqual` checks exact.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/collectors/usageApi.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npx eslint src/collectors/usageApi.ts src/collectors/usageApi.test.ts`
Expected: no errors. If zod 4's `z.looseObject` is missing from the installed version, use `z.object({...}).passthrough()` instead. This only affects types; the behaviour is the same.

- [ ] **Step 6: Commit**

```bash
git add src/collectors/usageApi.ts src/collectors/usageApi.test.ts
git commit -m "feat(collectors): poll Anthropic OAuth usage API with backoff and stale handling

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

---

### Task 18: Store (event aggregation, session views, throttled snapshots)

**Files:**
- Create: `src/store/sessionState.ts` (per-session reducer + `SessionView` builder)
- Create: `src/store/store.ts` (global state, dedup, windows, snapshot, subscriptions)
- Create: `src/store/useSnapshot.ts`
- Test: `src/store/sessionState.test.ts`, `src/store/store.test.ts`, `src/store/useSnapshot.test.tsx`

**Interfaces:**
- Consumes:
  - `src/domain/types.ts` (Task 1): `TranscriptEvent`, `UsageRecord`, `RegistryEntry`, `PriceLookup`, `PricingStatus`, `LimitsState`, `ScanProgress`, `Snapshot`, `SessionView`, `DisplayStatus`, `TimeWindow`, `ModelPrice`, `TokenCounts`.
  - `src/domain/dedup.ts` (Task 7): `class DedupSet { add(key: string): boolean }`.
  - `src/domain/context.ts` (Task 8): `contextWindowFor(model, price): number`, `contextPercent(tokens, window): number`, `currentContextTokens({ lastUsage?, lastCompact? }): number | undefined`.
  - `src/domain/windows.ts` (Task 9): `blockWindowFromLimit(resetsAt, now)`, `weekWindowFromLimit(resetsAt, now)`, `todayWindow(now)`, `monthWindow(now)`, `rollingWeekWindow(now)`, `deriveCurrentBlock(sortedTimestamps, now): TimeWindow | null`.
  - `src/domain/aggregate.ts` (Task 10): `totalsForWindow(records, window, lookup): WindowTotals`, `unknownModelsIn(records, lookup): string[]`, `burnRatePerHour(records, now, lookup): number | null`, `hourlySparkline(records, now, lookup): number[]`.
- Produces:
  - `src/store/store.ts`:
    ```ts
    export interface StoreOptions { now: () => number; refreshMs: number; endedWindowHours: number; claudeDir: string; claudeDirFound: boolean }
    export class Store {
      constructor(opts: StoreOptions)
      applyEvents(sessionId: string, events: TranscriptEvent[]): void
      upsertRegistry(e: RegistryEntry): void
      markEnded(sessionId: string): void
      setAgents(sessionId: string, a: { activeCount: number; names: string[] }): void
      setLimits(l: LimitsState): void
      setPricing(lookup: PriceLookup | null, status: PricingStatus): void
      setScanProgress(p: ScanProgress): void
      setClaudeDirFound(found: boolean): void
      getSnapshot(): Snapshot
      subscribe(fn: () => void): () => void
      start(): void; stop(): void
      flush(): void
    }
    ```
  - `src/store/useSnapshot.ts`: `export function useSnapshot(store: Pick<Store, 'subscribe' | 'getSnapshot'>): Snapshot`
  - `src/store/sessionState.ts` (internal to the store; exported for tests): `SessionState`, `createSessionState(sessionId)`, `applySessionEvent(s, e, isNewUsage)`, `displayStatus(s)`, `displayName(s)`, `lastActivityOf(s)`, `buildSessionView(s, lookup)`.

**Behavior rules (from the spec, §4.4 and §5):**
- **Dedup:** every `usage` event goes through one global `DedupSet` keyed by `record.key`. Only the first occurrence is added to the global record list and to the owning session. That one check covers a response split over several lines, the same record seen by both the history scan and the live tail, and a re-tail from offset 0.
- **Display status:**
  - Not live → `ended`.
  - Registry `waiting` → `waiting` (with `waitingFor`).
  - Registry `busy`, or `activeAgents > 0` → `busy`.
  - Registry `idle` or missing → `idle`.
  - Any other raw value → `idle`, with `rawStatus` set to that value.
- **Visible sessions:** live, or `lastActivity >= now - endedWindowHours·3600·1000`. Aggregate totals always include all records, regardless of which sessions are visible.
- **Name:** registry `name` → latest `ai-title` → latest `agent-name` → `basename(cwd)` → `sessionId.slice(0, 8)`.
- **Session cost:**
  - Sum of priced records.
  - If pricing is unavailable (`lookup === null`) and a `cost-state` exists, use its `totalCostUSD` with `costApprox: true`.
  - Otherwise `null`.
- **Context:** from the latest main-thread usage. A newer main-thread `compact` overrides it with `postTokens`. The window comes from `contextWindowFor(model, lookup?.(model))`.
- **Last activity:** max of the latest event timestamp, registry `statusUpdatedAt`, `updatedAt` and `startedAt`. Transcript mtime isn't available to the store; event timestamps stand in for it.
- **Windows:**
  - Block: `blockWindowFromLimit(limits.block.resetsAt)`, else `deriveCurrentBlock(sorted timestamps)`, else `{ start: now, end: now }`.
  - Week: `weekWindowFromLimit(limits.weekly.resetsAt)`, else `rollingWeekWindow`.
- **Version warning:** computed from **live** sessions only, so old history transcripts don't add noise. Uses the registry version, else the meta version. When major.minor ≠ `2.1`, add `⚠ untested Claude Code v<version>`, once per distinct version.
- **Snapshots:**
  - `getSnapshot()` always returns the cached object, so the reference stays stable between notifications as `useSyncExternalStore` requires.
  - Mutations mark the store dirty and schedule a single `setTimeout(refreshMs)`. When it fires: recompute, then notify.
  - `start()` adds a `setInterval(refreshMs)` tick that recomputes and notifies, so countdowns move.
  - `flush()` recomputes and notifies immediately.

- [ ] **Step 1: Write the failing test for the session reducer**

`src/store/sessionState.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  applySessionEvent,
  buildSessionView,
  createSessionState,
  displayName,
  displayStatus,
  lastActivityOf,
} from './sessionState.js';
import type { ModelPrice, PriceLookup, TranscriptEvent } from '../domain/types.js';

const PRICE: ModelPrice = { input: 3e-6, output: 15e-6, cacheWrite: 3.75e-6, cacheRead: 0.3e-6, maxInputTokens: 200_000 };
const lookup: PriceLookup = (m) => (m === 'claude-opus-5-5' ? PRICE : undefined);

function usage(key: string, timestamp: number, contextTokens: number, sidechain = false): TranscriptEvent {
  return {
    kind: 'usage',
    contextTokens,
    record: {
      key,
      sessionId: 's1',
      timestamp,
      model: 'claude-opus-5-5',
      tokens: { input: 1000, output: 100, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 },
      isSidechain: sidechain,
    },
  };
}

describe('displayStatus', () => {
  it('maps registry status and agent activity', () => {
    const s = createSessionState('s1');
    expect(displayStatus(s)).toEqual({ status: 'ended' });
    s.live = true;
    expect(displayStatus(s)).toEqual({ status: 'idle' });
    s.registry = { pid: 1, sessionId: 's1', cwd: '/w', status: 'waiting', waitingFor: 'input needed' };
    expect(displayStatus(s)).toEqual({ status: 'waiting' });
    s.registry.status = 'busy';
    expect(displayStatus(s)).toEqual({ status: 'busy' });
    s.registry.status = 'idle';
    s.agents = { activeCount: 2, names: ['Explore', 'Plan'] };
    expect(displayStatus(s)).toEqual({ status: 'busy' });
    s.agents = { activeCount: 0, names: [] };
    s.registry.status = 'thinking';
    expect(displayStatus(s)).toEqual({ status: 'idle', rawStatus: 'thinking' });
  });
  it('waiting wins over active agents', () => {
    const s = createSessionState('s1');
    s.live = true;
    s.registry = { pid: 1, sessionId: 's1', cwd: '/w', status: 'waiting' };
    s.agents = { activeCount: 1, names: ['Explore'] };
    expect(displayStatus(s).status).toBe('waiting');
  });
});

describe('displayName', () => {
  it('follows registry name → ai-title → agent-name → cwd basename → id prefix', () => {
    const s = createSessionState('abcdef123456');
    expect(displayName(s)).toBe('abcdef12');
    applySessionEvent(s, { kind: 'meta', timestamp: 1, isSidechain: false, cwd: '/work/proj' }, false);
    expect(displayName(s)).toBe('proj');
    applySessionEvent(s, { kind: 'title', timestamp: 0, title: 'agent-x', source: 'agent-name' }, false);
    expect(displayName(s)).toBe('agent-x');
    applySessionEvent(s, { kind: 'title', timestamp: 0, title: 'Fix login bug', source: 'ai-title' }, false);
    expect(displayName(s)).toBe('Fix login bug');
    s.registry = { pid: 1, sessionId: 'abcdef123456', cwd: '/work/proj', name: 'my-session' };
    expect(displayName(s)).toBe('my-session');
  });
});

describe('applySessionEvent + buildSessionView', () => {
  it('only counts new usage, ignores sidechain for context, and honors compaction', () => {
    const s = createSessionState('s1');
    applySessionEvent(s, usage('a', 1_000, 150_000), true);
    applySessionEvent(s, usage('a', 1_000, 150_000), false); // duplicate → ignored
    applySessionEvent(s, usage('side', 1_500, 5_000, true), true); // subagent
    let v = buildSessionView(s, lookup);
    expect(v.tokens.input).toBe(2000);
    expect(v.contextTokens).toBe(150_000);
    expect(v.contextWindow).toBe(200_000);
    expect(v.contextPercent).toBe(75);

    applySessionEvent(
      s,
      { kind: 'compact', timestamp: 2_000, postTokens: 30_000, isSidechain: false },
      false,
    );
    v = buildSessionView(s, lookup);
    expect(v.contextTokens).toBe(30_000);
    expect(v.contextPercent).toBe(15);

    applySessionEvent(s, usage('b', 3_000, 40_000), true);
    expect(buildSessionView(s, lookup).contextTokens).toBe(40_000);
  });

  it('falls back to cost-state when pricing is unavailable', () => {
    const s = createSessionState('s1');
    applySessionEvent(s, usage('a', 1_000, 10), true);
    applySessionEvent(s, { kind: 'costState', timestamp: 1_100, totalCostUSD: 3.5 }, false);
    const priced = buildSessionView(s, lookup);
    expect(priced.costApprox).toBe(false);
    expect(priced.costUSD).toBeCloseTo(0.0045, 6);
    const unpriced = buildSessionView(s, null);
    expect(unpriced.costUSD).toBe(3.5);
    expect(unpriced.costApprox).toBe(true);
  });

  it('lastActivity is the max of events and registry timestamps', () => {
    const s = createSessionState('s1');
    applySessionEvent(s, usage('a', 5_000, 10), true);
    expect(lastActivityOf(s)).toBe(5_000);
    s.registry = { pid: 1, sessionId: 's1', cwd: '/w', statusUpdatedAt: 9_000, startedAt: 100 };
    expect(lastActivityOf(s)).toBe(9_000);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run src/store/sessionState.test.ts`
Expected: FAIL with `Failed to resolve import "./sessionState.js"`.

- [ ] **Step 3: Implement `src/store/sessionState.ts`**

```ts
import { basename } from 'node:path';
import { totalsForWindow } from '../domain/aggregate.js';
import { contextPercent, contextWindowFor, currentContextTokens } from '../domain/context.js';
import type {
  DisplayStatus,
  PriceLookup,
  RegistryEntry,
  SessionView,
  TimeWindow,
  TranscriptEvent,
  UsageRecord,
} from '../domain/types.js';

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
  agents: { activeCount: number; names: string[] };
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

export function displayName(s: SessionState): string {
  const cwd = s.registry?.cwd ?? s.meta.cwd;
  return (
    s.registry?.name || s.aiTitle || s.agentName || (cwd ? basename(cwd) : '') || s.sessionId.slice(0, 8)
  );
}

export function lastActivityOf(s: SessionState): number {
  const r = s.registry;
  return Math.max(s.lastEventTs, r?.statusUpdatedAt ?? 0, r?.updatedAt ?? 0, r?.startedAt ?? 0);
}

export function sessionVersion(s: SessionState): string | undefined {
  return s.registry?.version ?? s.meta.version;
}

export function buildSessionView(s: SessionState, lookup: PriceLookup | null): SessionView {
  const totals = totalsForWindow(s.records, ALL_TIME, lookup);
  const useFallback = totals.costUSD === null && s.costState !== undefined;
  const model = s.lastUsage?.model;
  const contextTokens = currentContextTokens({ lastUsage: s.lastUsage, lastCompact: s.lastCompact });
  const contextWindow =
    contextTokens === undefined ? undefined : contextWindowFor(model, model ? lookup?.(model) : undefined);
  const { status, rawStatus } = displayStatus(s);
  return {
    sessionId: s.sessionId,
    pid: s.registry?.pid,
    live: s.live,
    status,
    ...(rawStatus === undefined ? {} : { rawStatus }),
    waitingFor: status === 'waiting' ? s.registry?.waitingFor : undefined,
    activeAgents: s.live ? s.agents.activeCount : 0,
    agentNames: s.live ? s.agents.names : [],
    name: displayName(s),
    cwd: s.registry?.cwd ?? s.meta.cwd,
    gitBranch: s.meta.gitBranch,
    model,
    contextTokens,
    contextWindow,
    contextPercent:
      contextTokens === undefined || contextWindow === undefined
        ? undefined
        : contextPercent(contextTokens, contextWindow),
    costUSD: useFallback ? s.costState!.totalCostUSD : totals.costUSD,
    costApprox: useFallback,
    tokens: totals.tokens,
    byModel: totals.byModel,
    startedAt: s.registry?.startedAt,
    lastActivity: lastActivityOf(s),
    permissionMode: s.permissionMode,
    version: sessionVersion(s),
  };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run src/store/sessionState.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Write the failing test for the Store**

`src/store/store.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Store, type StoreOptions } from './store.js';
import type {
  ModelPrice,
  PriceLookup,
  RegistryEntry,
  Snapshot,
  TokenCounts,
  TranscriptEvent,
} from '../domain/types.js';

const NOW = Date.parse('2026-10-11T14:32:07Z');
const MIN = 60_000;
const HOUR = 60 * MIN;
const PRICE: ModelPrice = { input: 3e-6, output: 15e-6, cacheWrite: 3.75e-6, cacheRead: 0.3e-6, maxInputTokens: 200_000 };
const lookup: PriceLookup = (m) => (m === 'claude-opus-5-5' ? PRICE : undefined);

function usage(
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

const reg = (over: Partial<RegistryEntry> = {}): RegistryEntry => ({
  pid: 100,
  sessionId: 's1',
  cwd: '/work/proj',
  status: 'idle',
  version: '2.1.296',
  ...over,
});

function makeStore(over: Partial<StoreOptions> = {}): Store {
  return new Store({
    now: () => NOW,
    refreshMs: 1000,
    endedWindowHours: 24,
    claudeDir: '/home/u/.claude',
    claudeDirFound: true,
    ...over,
  });
}

function session(snap: Snapshot, id = 's1') {
  const s = snap.sessions.find((x) => x.sessionId === id);
  if (!s) throw new Error(`session ${id} not in snapshot`);
  return s;
}

describe('Store dedup (Review Focus 2)', () => {
  it('counts a usage record once across scan, tail and multi-line splits', () => {
    const store = makeStore();
    store.setPricing(lookup, 'ok');
    store.upsertRegistry(reg());
    const ev = usage('msg_1:req_1', NOW - MIN);
    store.applyEvents('s1', [ev]); // history scan
    store.applyEvents('s1', [ev, ev]); // live tail: same response split over two lines
    store.applyEvents('s1', [ev]); // tail restarted from offset 0
    store.flush();
    const snap = store.getSnapshot();
    expect(session(snap).tokens.input).toBe(1000);
    expect(session(snap).costUSD).toBeCloseTo(0.0045, 6);
    expect(snap.costs.today.tokens.input).toBe(1000);
    expect(snap.costs.block.tokens.input).toBe(1000);
    expect(snap.costs.month.costUSD).toBeCloseTo(0.0045, 6);
  });
});

describe('Store sessions', () => {
  it('applies display-status rules and markEnded', () => {
    const store = makeStore();
    store.upsertRegistry(reg({ status: 'waiting', waitingFor: 'dialog open' }));
    store.flush();
    expect(session(store.getSnapshot())).toMatchObject({ status: 'waiting', waitingFor: 'dialog open', live: true });

    store.upsertRegistry(reg({ status: 'idle' }));
    store.setAgents('s1', { activeCount: 2, names: ['Explore', 'Plan'] });
    store.flush();
    expect(session(store.getSnapshot())).toMatchObject({ status: 'busy', activeAgents: 2 });

    store.setAgents('s1', { activeCount: 0, names: [] });
    store.upsertRegistry(reg({ status: 'compacting' }));
    store.flush();
    expect(session(store.getSnapshot())).toMatchObject({ status: 'idle', rawStatus: 'compacting' });

    store.markEnded('s1');
    store.flush();
    expect(session(store.getSnapshot())).toMatchObject({ status: 'ended', live: false });
  });

  it('shows ended sessions only inside endedWindowHours but always counts their cost', () => {
    const store = makeStore();
    store.setPricing(lookup, 'ok');
    store.applyEvents('recent', [usage('r', NOW - 23 * HOUR, { sessionId: 'recent' })]);
    store.applyEvents('old', [usage('o', NOW - 25 * HOUR, { sessionId: 'old' })]);
    store.flush();
    const snap = store.getSnapshot();
    expect(snap.sessions.map((s) => s.sessionId)).toEqual(['recent']);
    expect(session(snap, 'recent').status).toBe('ended');
    expect(snap.costs.month.tokens.input).toBe(2000);
  });

  it('uses the name fallback chain', () => {
    const store = makeStore();
    store.applyEvents('abcdef123456', [usage('x', NOW - MIN, { sessionId: 'abcdef123456' })]);
    store.flush();
    expect(session(store.getSnapshot(), 'abcdef123456').name).toBe('abcdef12');

    store.applyEvents('abcdef123456', [
      { kind: 'meta', timestamp: NOW - MIN, isSidechain: false, cwd: '/work/blog' },
    ]);
    store.flush();
    expect(session(store.getSnapshot(), 'abcdef123456').name).toBe('blog');

    store.applyEvents('abcdef123456', [
      { kind: 'title', timestamp: 0, title: 'helper', source: 'agent-name' },
      { kind: 'title', timestamp: 0, title: 'Write README', source: 'ai-title' },
    ]);
    store.flush();
    expect(session(store.getSnapshot(), 'abcdef123456').name).toBe('Write README');

    store.upsertRegistry(reg({ sessionId: 'abcdef123456', name: 'docs-session' }));
    store.flush();
    expect(session(store.getSnapshot(), 'abcdef123456').name).toBe('docs-session');
  });
});

describe('Store pricing and context', () => {
  it('falls back to cost-state with costApprox when pricing is unavailable', () => {
    const store = makeStore();
    store.setPricing(null, 'unavailable');
    store.upsertRegistry(reg());
    store.applyEvents('s1', [
      usage('a', NOW - MIN),
      { kind: 'costState', timestamp: NOW - MIN, totalCostUSD: 3.5 },
    ]);
    store.flush();
    const snap = store.getSnapshot();
    expect(session(snap)).toMatchObject({ costUSD: 3.5, costApprox: true });
    expect(snap.costs.today.costUSD).toBeNull();
    expect(snap.pricingStatus).toBe('unavailable');
    expect(snap.unknownModels).toEqual([]);
  });

  it('reports unknown models', () => {
    const store = makeStore();
    store.setPricing(lookup, 'ok');
    store.applyEvents('s1', [usage('a', NOW - MIN, { model: 'mystery-model' })]);
    store.flush();
    expect(store.getSnapshot().unknownModels).toEqual(['mystery-model']);
  });

  it('uses compact postTokens until the next main-thread usage', () => {
    const store = makeStore();
    store.setPricing(lookup, 'ok');
    store.upsertRegistry(reg());
    store.applyEvents('s1', [usage('a', NOW - 10 * MIN, { contextTokens: 150_000 })]);
    store.applyEvents('s1', [{ kind: 'compact', timestamp: NOW - 9 * MIN, postTokens: 30_000, isSidechain: false }]);
    store.flush();
    expect(session(store.getSnapshot())).toMatchObject({ contextTokens: 30_000, contextPercent: 15 });
    store.applyEvents('s1', [usage('b', NOW - 8 * MIN, { contextTokens: 40_000 })]);
    store.flush();
    expect(session(store.getSnapshot())).toMatchObject({ contextTokens: 40_000, contextPercent: 20 });
  });
});

describe('Store windows and warnings', () => {
  it('derives the block window from limits.block.resetsAt', () => {
    const store = makeStore();
    store.setPricing(lookup, 'ok');
    store.setLimits({
      status: 'ok',
      block: { label: '5h', percent: 40, resetsAt: NOW + HOUR },
      perModelWeekly: [],
    });
    store.applyEvents('s1', [usage('in', NOW - 3 * HOUR), usage('out', NOW - 4.5 * HOUR)]);
    store.flush();
    const snap = store.getSnapshot();
    expect(snap.costs.block.tokens.input).toBe(1000);
    expect(snap.limits.block?.percent).toBe(40);
  });

  it('warns once per untested Claude Code version, live sessions only', () => {
    const store = makeStore();
    store.upsertRegistry(reg({ sessionId: 'a', pid: 1, version: '2.2.0' }));
    store.upsertRegistry(reg({ sessionId: 'b', pid: 2, version: '2.2.0' }));
    store.upsertRegistry(reg({ sessionId: 'c', pid: 3, version: '2.1.300' }));
    store.applyEvents('old', [
      usage('o', NOW - HOUR, { sessionId: 'old' }),
      { kind: 'meta', timestamp: NOW - HOUR, isSidechain: false, version: '2.0.1' },
    ]);
    store.flush();
    expect(store.getSnapshot().warnings).toEqual(['⚠ untested Claude Code v2.2.0']);
  });

  it('exposes claudeDir fields and scan progress', () => {
    const store = makeStore({ claudeDirFound: false });
    store.setScanProgress({ done: false, filesDone: 3, filesTotal: 10 });
    store.flush();
    expect(store.getSnapshot()).toMatchObject({
      claudeDirFound: false,
      claudeDir: '/home/u/.claude',
      scan: { done: false, filesDone: 3, filesTotal: 10 },
      limits: { status: 'loading', perModelWeekly: [] },
      pricingStatus: 'loading',
    });
    store.setClaudeDirFound(true);
    store.flush();
    expect(store.getSnapshot().claudeDirFound).toBe(true);
  });
});

describe('Store notifications', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('throttles notifications to one per refreshMs and keeps snapshot identity stable', () => {
    const store = makeStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    const before = store.getSnapshot();
    for (let i = 0; i < 5; i++) store.applyEvents('s1', [usage(`k${i}`, NOW - MIN)]);
    expect(listener).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toBe(before);
    vi.advanceTimersByTime(999);
    expect(listener).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(listener).toHaveBeenCalledTimes(1);
    const after = store.getSnapshot();
    expect(after).not.toBe(before);
    expect(store.getSnapshot()).toBe(after);
    expect(after.costs.today.tokens.input).toBe(5000);
    unsubscribe();
    store.applyEvents('s1', [usage('k9', NOW - MIN)]);
    vi.advanceTimersByTime(1000);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('ticks every refreshMs after start() until stop()', () => {
    const store = makeStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.start();
    vi.advanceTimersByTime(3000);
    expect(listener).toHaveBeenCalledTimes(3);
    store.stop();
    vi.advanceTimersByTime(3000);
    expect(listener).toHaveBeenCalledTimes(3);
  });
});
```

- [ ] **Step 6: Run the test and confirm it fails**

Run: `npx vitest run src/store/store.test.ts`
Expected: FAIL with `Failed to resolve import "./store.js"`.

- [ ] **Step 7: Implement `src/store/store.ts`**

```ts
import { burnRatePerHour, hourlySparkline, totalsForWindow, unknownModelsIn } from '../domain/aggregate.js';
import { DedupSet } from '../domain/dedup.js';
import type {
  LimitsState,
  PriceLookup,
  PricingStatus,
  RegistryEntry,
  ScanProgress,
  SessionView,
  Snapshot,
  TimeWindow,
  TranscriptEvent,
  UsageRecord,
} from '../domain/types.js';
import {
  blockWindowFromLimit,
  deriveCurrentBlock,
  monthWindow,
  rollingWeekWindow,
  todayWindow,
  weekWindowFromLimit,
} from '../domain/windows.js';
import {
  applySessionEvent,
  buildSessionView,
  createSessionState,
  lastActivityOf,
  sessionVersion,
  type SessionState,
} from './sessionState.js';

export interface StoreOptions {
  now: () => number;
  refreshMs: number;
  endedWindowHours: number;
  claudeDir: string;
  claudeDirFound: boolean;
}

const TESTED_MAJOR_MINOR = '2.1';

export class Store {
  private readonly sessions = new Map<string, SessionState>();
  private readonly dedup = new DedupSet();
  private readonly records: UsageRecord[] = [];
  private sortedTs: number[] | null = null;
  private limits: LimitsState = { status: 'loading', perModelWeekly: [] };
  private lookup: PriceLookup | null = null;
  private pricingStatus: PricingStatus = 'loading';
  private scan: ScanProgress = { done: false, filesDone: 0, filesTotal: 0 };
  private claudeDirFound: boolean;
  private readonly listeners = new Set<() => void>();
  private snapshot: Snapshot;
  private pending: ReturnType<typeof setTimeout> | null = null;
  private ticker: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly opts: StoreOptions) {
    this.claudeDirFound = opts.claudeDirFound;
    this.snapshot = this.compute();
  }

  applyEvents(sessionId: string, events: TranscriptEvent[]): void {
    const s = this.session(sessionId);
    for (const e of events) {
      let isNew = false;
      if (e.kind === 'usage') {
        isNew = this.dedup.add(e.record.key);
        if (isNew) {
          this.records.push(e.record);
          this.sortedTs = null;
        }
      }
      applySessionEvent(s, e, isNew);
    }
    this.markDirty();
  }

  upsertRegistry(e: RegistryEntry): void {
    const s = this.session(e.sessionId);
    s.registry = e;
    s.live = true;
    this.markDirty();
  }

  markEnded(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.live = false;
    s.agents = { activeCount: 0, names: [] };
    this.markDirty();
  }

  setAgents(sessionId: string, a: { activeCount: number; names: string[] }): void {
    this.session(sessionId).agents = { activeCount: a.activeCount, names: [...a.names] };
    this.markDirty();
  }

  setLimits(l: LimitsState): void {
    this.limits = l;
    this.markDirty();
  }

  setPricing(lookup: PriceLookup | null, status: PricingStatus): void {
    this.lookup = lookup;
    this.pricingStatus = status;
    this.markDirty();
  }

  setScanProgress(p: ScanProgress): void {
    this.scan = { ...p };
    this.markDirty();
  }

  setClaudeDirFound(found: boolean): void {
    this.claudeDirFound = found;
    this.markDirty();
  }

  getSnapshot = (): Snapshot => this.snapshot;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  start(): void {
    if (this.ticker) return;
    this.ticker = setInterval(() => this.flush(), this.opts.refreshMs);
  }

  stop(): void {
    if (this.ticker) clearInterval(this.ticker);
    if (this.pending) clearTimeout(this.pending);
    this.ticker = null;
    this.pending = null;
  }

  flush(): void {
    if (this.pending) {
      clearTimeout(this.pending);
      this.pending = null;
    }
    this.snapshot = this.compute();
    for (const fn of this.listeners) fn();
  }

  private session(sessionId: string): SessionState {
    let s = this.sessions.get(sessionId);
    if (!s) {
      s = createSessionState(sessionId);
      this.sessions.set(sessionId, s);
    }
    return s;
  }

  private markDirty(): void {
    if (this.pending) return;
    this.pending = setTimeout(() => {
      this.pending = null;
      this.flush();
    }, this.opts.refreshMs);
  }

  private timestamps(): number[] {
    if (!this.sortedTs) this.sortedTs = this.records.map((r) => r.timestamp).sort((a, b) => a - b);
    return this.sortedTs;
  }

  private blockWindow(now: number): TimeWindow {
    const resetsAt = this.limits.block?.resetsAt;
    if (resetsAt !== undefined) return blockWindowFromLimit(resetsAt, now);
    return deriveCurrentBlock(this.timestamps(), now) ?? { start: now, end: now };
  }

  private weekWindow(now: number): TimeWindow {
    const resetsAt = this.limits.weekly?.resetsAt;
    return resetsAt !== undefined ? weekWindowFromLimit(resetsAt, now) : rollingWeekWindow(now);
  }

  private compute(): Snapshot {
    const now = this.opts.now();
    const lookup = this.lookup;
    const cutoff = now - this.opts.endedWindowHours * 3_600_000;
    const sessions: SessionView[] = [];
    const warnings: string[] = [];
    for (const s of this.sessions.values()) {
      if (s.live) {
        const v = sessionVersion(s);
        const warning = v && !isTestedVersion(v) ? `⚠ untested Claude Code v${v}` : null;
        if (warning && !warnings.includes(warning)) warnings.push(warning);
      }
      if (s.live || lastActivityOf(s) >= cutoff) sessions.push(buildSessionView(s, lookup));
    }
    return {
      now,
      claudeDirFound: this.claudeDirFound,
      claudeDir: this.opts.claudeDir,
      limits: this.limits,
      costs: {
        block: totalsForWindow(this.records, this.blockWindow(now), lookup),
        today: totalsForWindow(this.records, todayWindow(now), lookup),
        week: totalsForWindow(this.records, this.weekWindow(now), lookup),
        month: totalsForWindow(this.records, monthWindow(now), lookup),
        burnRatePerHour: burnRatePerHour(this.records, now, lookup),
        hourlySparkline: hourlySparkline(this.records, now, lookup),
      },
      pricingStatus: this.pricingStatus,
      unknownModels: unknownModelsIn(this.records, lookup),
      scan: this.scan,
      sessions,
      warnings,
    };
  }
}

function isTestedVersion(version: string): boolean {
  const [major, minor] = version.split('.');
  return `${major}.${minor}` === TESTED_MAJOR_MINOR;
}
```

- [ ] **Step 8: Run the store tests and confirm they pass**

Run: `npx vitest run src/store/store.test.ts src/store/sessionState.test.ts`
Expected: PASS (18 tests). If the block-window test fails, check `totalsForWindow`'s window inclusion (Task 10: `start <= ts <= end`) before changing the store.

- [ ] **Step 9: Write the failing test for `useSnapshot`**

`src/store/useSnapshot.test.tsx`:
```tsx
import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { Store } from './store.js';
import { useSnapshot } from './useSnapshot.js';

function Probe({ store }: { store: Store }) {
  const snap = useSnapshot(store);
  return <Text>sessions:{snap.sessions.length}</Text>;
}

const tick = () => new Promise((r) => setTimeout(r, 20));

describe('useSnapshot', () => {
  it('re-renders when the store notifies', async () => {
    const store = new Store({
      now: () => Date.parse('2026-10-11T14:32:07Z'),
      refreshMs: 1000,
      endedWindowHours: 24,
      claudeDir: '/c',
      claudeDirFound: true,
    });
    const { lastFrame, unmount } = render(<Probe store={store} />);
    expect(lastFrame()).toContain('sessions:0');
    store.upsertRegistry({ pid: 1, sessionId: 's1', cwd: '/w', status: 'idle' });
    store.flush();
    await tick();
    expect(lastFrame()).toContain('sessions:1');
    unmount();
    store.stop();
  });
});
```

Run: `npx vitest run src/store/useSnapshot.test.tsx`
Expected: FAIL with `Failed to resolve import "./useSnapshot.js"`.

- [ ] **Step 10: Implement `src/store/useSnapshot.ts`**

```ts
import { useSyncExternalStore } from 'react';
import type { Snapshot } from '../domain/types.js';
import type { Store } from './store.js';

export function useSnapshot(store: Pick<Store, 'subscribe' | 'getSnapshot'>): Snapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
```

(`subscribe` and `getSnapshot` are arrow-function class fields, so passing them unbound is safe.)

- [ ] **Step 11: Run all store tests, typecheck and lint**

Run: `npx vitest run src/store && npm run typecheck && npm run lint`
Expected: all PASS, no type or lint errors.

- [ ] **Step 12: Commit**

```bash
git add src/store
git commit -m "feat(store): dedup usage events, build session views and throttled snapshots

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 19: Theme, display formatters, Meter, Panel

**Files:**
- Create: `src/domain/format.ts`, `src/ui/theme.ts`, `src/ui/Meter.tsx`, `src/ui/Panel.tsx`, `test/helpers/ansi.ts`
- Test: `src/domain/format.test.ts`, `src/ui/theme.test.ts`, `src/ui/Meter.test.tsx`, `src/ui/Panel.test.tsx`

**Interfaces:**
- Consumes (Task 1): `ThemeName` from `src/domain/types.ts`. Task 1 Step 7 records whether `@mishieck/ink-titled-box` works on Ink 7, either in the smoke-test header comment or in `CLAUDE.md`.
- Produces:
  - `src/domain/format.ts`: `formatUSD(v: number | null, approx?: boolean): string`, `formatTokens(n: number): string`, `formatDuration(ms: number): string`, `formatAgo(ts: number, now: number): string`, `formatResetsAt(ts: number, now: number): string`, `shortModel(model: string | undefined): string`. **Additions beyond the registry:** `formatClock(ts: number): string` (local `HH:MM:SS`) and `truncate(s: string, width: number): string` (ends with `…`).
  - `src/ui/theme.ts`: `interface Theme`, `THEMES: Record<ThemeName, Theme>`, `ThemeContext`, `useTheme(): Theme`, `levelColor(theme, percent, thresholds?: [number, number]): string`. **Addition:** `inkUiTheme(theme: Theme)` returns the `@inkjs/ui` theme. Task 22 wraps the app in `<ThemeProvider theme={inkUiTheme(t)}>`.
  - `src/ui/Meter.tsx`: `Meter(props: { label; percent: number | undefined; width; suffix?; labelWidth? })`. `width` is the total width of the bracketed bar, including both brackets.
  - `src/ui/Panel.tsx`: `Panel(props: { title; children; width?: number | string; flexGrow? })`. Callers should pass a numeric `width`, because the fallback border needs it.
  - `test/helpers/ansi.ts`: `stripAnsi(s: string | undefined): string`, used by every UI test.

- [ ] **Step 1: Write the ANSI test helper**

`test/helpers/ansi.ts`:
```ts
// Strips ANSI SGR/CSI sequences so UI tests can assert on plain text.
const ESC = String.fromCharCode(27);
const CSI = new RegExp(`${ESC}\\[[0-9;?]*[A-Za-z]`, 'g');

export function stripAnsi(s: string | undefined): string {
  return (s ?? '').replace(CSI, '');
}
```

- [ ] **Step 2: Write the failing formatter tests**

`src/domain/format.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  formatAgo,
  formatClock,
  formatDuration,
  formatResetsAt,
  formatTokens,
  formatUSD,
  shortModel,
  truncate,
} from './format.js';

const NOW = new Date(2026, 9, 11, 14, 32, 7).getTime(); // Sunday, local time

describe('formatUSD', () => {
  it('formats null/NaN as em dash', () => {
    expect(formatUSD(null)).toBe('—');
    expect(formatUSD(Number.NaN)).toBe('—');
  });
  it('uses two decimals below 1000 and grouped integers above', () => {
    expect(formatUSD(4.2)).toBe('$4.20');
    expect(formatUSD(96.1)).toBe('$96.10');
    expect(formatUSD(412.75)).toBe('$412.75');
    expect(formatUSD(1234.5)).toBe('$1,235');
  });
  it('prefixes ≈ when approximate', () => {
    expect(formatUSD(4.2, true)).toBe('≈$4.20');
  });
});

describe('formatTokens', () => {
  it.each([
    [950, '950'],
    [1000, '1k'],
    [12_300, '12.3k'],
    [48_100, '48.1k'],
    [120_000, '120k'],
    [210_000, '210k'],
    [999_700, '1M'],
    [3_100_000, '3.1M'],
  ])('%d → %s', (n, out) => {
    expect(formatTokens(n)).toBe(out);
  });
});

describe('formatDuration', () => {
  it.each([
    [-5, '0s'],
    [45_000, '45s'],
    [12 * 60_000, '12m'],
    [134 * 60_000, '2h14m'],
    [5 * 3_600_000, '5h'],
    [(3 * 24 + 4) * 3_600_000, '3d4h'],
    [2 * 86_400_000, '2d'],
  ])('%d → %s', (ms, out) => {
    expect(formatDuration(ms)).toBe(out);
  });
});

describe('formatAgo', () => {
  it('buckets by age', () => {
    expect(formatAgo(NOW - 3_000, NOW)).toBe('now');
    expect(formatAgo(NOW - 30_000, NOW)).toBe('30s');
    expect(formatAgo(NOW - 18 * 60_000, NOW)).toBe('18m');
    expect(formatAgo(NOW - 3 * 3_600_000, NOW)).toBe('3h ago');
  });
});

describe('formatResetsAt', () => {
  it('shows a countdown under 24h', () => {
    expect(formatResetsAt(NOW + 134 * 60_000, NOW)).toBe('resets 2h14m');
  });
  it('shows weekday + local time at or beyond 24h', () => {
    const thu9 = new Date(2026, 9, 15, 9, 0, 0).getTime();
    expect(formatResetsAt(thu9, NOW)).toBe('resets Thu 09:00');
  });
  it('shows "resets now" when already past', () => {
    expect(formatResetsAt(NOW - 1, NOW)).toBe('resets now');
  });
});

describe('shortModel', () => {
  it.each([
    ['claude-opus-5-5', 'opus-5.5'],
    ['claude-sonnet-5-5[1m]', 'sonnet-5.5'],
    ['claude-haiku-5-5-20261001', 'haiku-5.5'],
    ['claude-fable-5-1', 'fable-5.1'],
    ['<synthetic>', '<synthetic>'],
  ])('%s → %s', (m, out) => {
    expect(shortModel(m)).toBe(out);
  });
  it('undefined → em dash', () => {
    expect(shortModel(undefined)).toBe('—');
  });
});

describe('formatClock / truncate', () => {
  it('formats local HH:MM:SS', () => {
    expect(formatClock(NOW)).toBe('14:32:07');
  });
  it('truncates with ellipsis', () => {
    expect(truncate('ccstatusboard', 20)).toBe('ccstatusboard');
    expect(truncate('ccstatusboard', 6)).toBe('ccsta…');
    expect(truncate('abc', 0)).toBe('');
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/domain/format.test.ts`
Expected: FAIL with "Failed to resolve import './format.js'".

- [ ] **Step 4: Implement `src/domain/format.ts`**

```ts
// Pure display formatters shared by all UI components.

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const pad2 = (n: number): string => String(n).padStart(2, '0');
const trimZero = (s: string): string => s.replace(/\.0$/, '');

export function formatUSD(v: number | null, approx = false): string {
  if (v === null || !Number.isFinite(v)) return '—';
  const prefix = approx ? '≈' : '';
  if (Math.abs(v) < 1000) return `${prefix}$${v.toFixed(2)}`;
  return `${prefix}$${Math.round(v).toLocaleString('en-US')}`;
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 100_000) return `${trimZero((n / 1000).toFixed(1))}k`;
  const k = Math.round(n / 1000);
  if (k < 1000) return `${k}k`;
  return `${trimZero((n / 1_000_000).toFixed(1))}M`;
}

export function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  if (totalSec < 60) return `${totalSec}s`;
  const totalMin = Math.floor(totalSec / 60);
  if (totalMin < 60) return `${totalMin}m`;
  const totalHours = Math.floor(totalMin / 60);
  if (totalHours < 24) {
    const m = totalMin % 60;
    return m === 0 ? `${totalHours}h` : `${totalHours}h${m}m`;
  }
  const d = Math.floor(totalHours / 24);
  const h = totalHours % 24;
  return h === 0 ? `${d}d` : `${d}d${h}h`;
}

export function formatAgo(ts: number, now: number): string {
  const d = now - ts;
  if (d < 5_000) return 'now';
  if (d < 60_000) return `${Math.floor(d / 1000)}s`;
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m`;
  return `${Math.floor(d / 3_600_000)}h ago`;
}

export function formatResetsAt(ts: number, now: number): string {
  const d = ts - now;
  if (d <= 0) return 'resets now';
  if (d < 86_400_000) return `resets ${formatDuration(d)}`;
  const date = new Date(ts);
  return `resets ${WEEKDAYS[date.getDay()]} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function shortModel(model: string | undefined): string {
  if (model === undefined || model === '') return '—';
  return model
    .replace(/^claude-/, '')
    .replace(/\[1m\]$/i, '')
    .replace(/-\d{8}$/, '')
    .replace(/-(\d+)-(\d+)$/, '-$1.$2');
}

export function formatClock(ts: number): string {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

export function truncate(s: string, width: number): string {
  if (width <= 0) return '';
  if (s.length <= width) return s;
  return `${s.slice(0, width - 1)}…`;
}
```

- [ ] **Step 5: Run the formatter tests**

Run: `npx vitest run src/domain/format.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the failing theme tests**

`src/ui/theme.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { inkUiTheme, levelColor, THEMES } from './theme.js';

describe('theme', () => {
  it('defines every token for every theme', () => {
    const keys = ['accent', 'text', 'dim', 'ok', 'warn', 'danger', 'border', 'selectedBg', 'selectedFg'];
    for (const [name, t] of Object.entries(THEMES)) {
      expect(t.name).toBe(name);
      for (const k of keys) expect(typeof (t as unknown as Record<string, unknown>)[k]).toBe('string');
      expect(t.gradient.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('levelColor uses [50,80] by default and accepts custom thresholds', () => {
    const t = THEMES.default;
    expect(levelColor(t, 10)).toBe(t.ok);
    expect(levelColor(t, 50)).toBe(t.warn);
    expect(levelColor(t, 80)).toBe(t.danger);
    expect(levelColor(t, 59, [60, 80])).toBe(t.ok);
    expect(levelColor(t, 60, [60, 80])).toBe(t.warn);
  });

  it('inkUiTheme maps the accent onto @inkjs/ui Spinner and ProgressBar', () => {
    const t = THEMES.dracula;
    const ui = inkUiTheme(t);
    const spinner = ui.components.Spinner?.styles?.frame?.();
    const bar = ui.components.ProgressBar?.styles?.completed?.();
    expect(spinner).toMatchObject({ color: t.accent });
    expect(bar).toMatchObject({ color: t.accent });
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `npx vitest run src/ui/theme.test.ts`
Expected: FAIL with "Failed to resolve import './theme.js'".

- [ ] **Step 8: Implement `src/ui/theme.ts`**

```ts
import { createContext, useContext } from 'react';
import { defaultTheme, extendTheme, type Theme as InkUiTheme } from '@inkjs/ui';
import type { ThemeName } from '../domain/types.js';

export interface Theme {
  name: ThemeName;
  accent: string;
  text: string;
  dim: string;
  ok: string;
  warn: string;
  danger: string;
  border: string;
  selectedBg: string;
  selectedFg: string;
  gradient: string[];
}

export const THEMES: Record<ThemeName, Theme> = {
  default: {
    name: 'default',
    accent: 'cyan',
    text: 'white',
    dim: 'gray',
    ok: 'green',
    warn: 'yellow',
    danger: 'red',
    border: 'gray',
    selectedBg: 'blue',
    selectedFg: 'white',
    gradient: ['#5ee7df', '#b490ca'],
  },
  mono: {
    name: 'mono',
    accent: 'white',
    text: 'white',
    dim: 'gray',
    ok: 'white',
    warn: 'white',
    danger: 'white',
    border: 'gray',
    selectedBg: 'white',
    selectedFg: 'black',
    gradient: ['#ffffff', '#8a8a8a'],
  },
  dracula: {
    name: 'dracula',
    accent: '#bd93f9',
    text: '#f8f8f2',
    dim: '#6272a4',
    ok: '#50fa7b',
    warn: '#f1fa8c',
    danger: '#ff5555',
    border: '#6272a4',
    selectedBg: '#44475a',
    selectedFg: '#f8f8f2',
    gradient: ['#ff79c6', '#bd93f9'],
  },
  solarized: {
    name: 'solarized',
    accent: '#268bd2',
    text: '#93a1a1',
    dim: '#586e75',
    ok: '#859900',
    warn: '#b58900',
    danger: '#dc322f',
    border: '#586e75',
    selectedBg: '#073642',
    selectedFg: '#eee8d5',
    gradient: ['#b58900', '#cb4b16'],
  },
};

export const ThemeContext = createContext<Theme>(THEMES.default);

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

/** ok below thresholds[0], warn below thresholds[1], danger at/above thresholds[1]. */
export function levelColor(theme: Theme, percent: number, thresholds: [number, number] = [50, 80]): string {
  if (percent >= thresholds[1]) return theme.danger;
  if (percent >= thresholds[0]) return theme.warn;
  return theme.ok;
}

/** @inkjs/ui theme (for <ThemeProvider>) derived from our color tokens. */
export function inkUiTheme(theme: Theme): InkUiTheme {
  return extendTheme(defaultTheme, {
    components: {
      Spinner: { styles: { frame: () => ({ color: theme.accent }) } },
      ProgressBar: { styles: { completed: () => ({ color: theme.accent }) } },
      Badge: { styles: { label: () => ({ color: theme.selectedFg }) } },
    },
  });
}
```

- [ ] **Step 9: Run the theme tests**

Run: `npx vitest run src/ui/theme.test.ts`
Expected: PASS.

- [ ] **Step 10: Write the failing Meter tests**

`src/ui/Meter.test.tsx`:
```tsx
import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { Meter } from './Meter.js';
import { stripAnsi } from '../../test/helpers/ansi.js';

const frame = (el: React.ReactElement) => stripAnsi(render(el).lastFrame());

describe('Meter', () => {
  it('renders an htop-style bar with right-aligned percent and suffix', () => {
    // width 22 → 20 inner cells; 50% → 10 bars, then 7 spaces, then "50%"
    const out = frame(<Meter label="5h" labelWidth={4} percent={50} width={22} suffix="resets 2h14m" />);
    expect(out).toContain('5h   [||||||||||       50%] resets 2h14m');
  });

  it('lets the percent text cover the bar at 100%', () => {
    const out = frame(<Meter label="Week" percent={100} width={22} />);
    expect(out).toContain('[||||||||||||||||100%]');
  });

  it('clamps the bar above 100% but prints the real number', () => {
    const out = frame(<Meter label="Week" percent={112} width={22} />);
    expect(out).toContain('[||||||||||||||||112%]');
  });

  it('renders 0% as an empty bar', () => {
    const out = frame(<Meter label="5h" percent={0} width={12} />);
    expect(out).toContain('[        0%]');
  });

  it('renders an em dash when percent is unknown', () => {
    const out = frame(<Meter label="5h" percent={undefined} width={22} />);
    expect(out).toContain('[         —          ]');
  });
});
```

- [ ] **Step 11: Run it to verify it fails**

Run: `npx vitest run src/ui/Meter.test.tsx`
Expected: FAIL with "Failed to resolve import './Meter.js'".

- [ ] **Step 12: Implement `src/ui/Meter.tsx`**

```tsx
import type { JSX } from 'react';
import { Text } from 'ink';
import { levelColor, useTheme } from './theme.js';

export interface MeterProps {
  label: string;
  percent: number | undefined;
  /** Total width of the bracketed bar, including both brackets. */
  width: number;
  suffix?: string;
  labelWidth?: number;
}

/** htop-style meter: `Label [|||||||     58%] suffix`. */
export function Meter({ label, percent, width, suffix, labelWidth }: MeterProps): JSX.Element {
  const theme = useTheme();
  const inner = Math.max(6, width - 2);
  const labelText = label.padEnd(labelWidth ?? label.length);
  const suffixEl = suffix ? <Text color={theme.dim}> {suffix}</Text> : null;

  if (percent === undefined || !Number.isFinite(percent)) {
    const left = Math.floor((inner - 1) / 2);
    return (
      <Text wrap="truncate-end">
        <Text color={theme.accent} bold>
          {labelText}
        </Text>{' '}
        <Text color={theme.border}>[</Text>
        <Text color={theme.dim}>
          {' '.repeat(left)}—{' '.repeat(inner - 1 - left)}
        </Text>
        <Text color={theme.border}>]</Text>
        {suffixEl}
      </Text>
    );
  }

  const clamped = Math.min(100, Math.max(0, percent));
  const pctText = `${Math.round(percent)}%`;
  const filled = Math.round((inner * clamped) / 100);
  const barRoom = Math.max(0, inner - pctText.length);
  const bars = Math.min(filled, barRoom);
  const spaces = barRoom - bars;

  return (
    <Text wrap="truncate-end">
      <Text color={theme.accent} bold>
        {labelText}
      </Text>{' '}
      <Text color={theme.border}>[</Text>
      <Text color={levelColor(theme, percent)}>{'|'.repeat(bars)}</Text>
      {' '.repeat(spaces)}
      <Text color={theme.text} bold>
        {pctText}
      </Text>
      <Text color={theme.border}>]</Text>
      {suffixEl}
    </Text>
  );
}
```

- [ ] **Step 13: Run the Meter tests**

Run: `npx vitest run src/ui/Meter.test.tsx`
Expected: PASS.

- [ ] **Step 14: Write the failing Panel tests**

`src/ui/Panel.test.tsx`:
```tsx
import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { FallbackPanel, Panel } from './Panel.js';
import { stripAnsi } from '../../test/helpers/ansi.js';

describe('Panel', () => {
  it('renders the title in the top border and the children inside', () => {
    const out = stripAnsi(
      render(
        <Panel title="Usage" width={40}>
          <Text>hello</Text>
        </Panel>,
      ).lastFrame(),
    );
    const lines = out.split('\n');
    expect(lines[0]).toContain('Usage');
    expect(lines[0]).toMatch(/^╭/);
    expect(out).toContain('hello');
  });

  it('FallbackPanel draws its own titled border at the exact width', () => {
    const out = stripAnsi(
      render(
        <FallbackPanel title="Sessions" width={30}>
          <Text>row</Text>
        </FallbackPanel>,
      ).lastFrame(),
    );
    const [top] = out.split('\n');
    expect(top).toBe('╭─ Sessions ─────────────────╮');
    expect(top?.length).toBe(30);
    expect(out).toContain('row');
    expect(out).toMatch(/╰─+╯/);
  });
});
```

- [ ] **Step 15: Run it to verify it fails**

Run: `npx vitest run src/ui/Panel.test.tsx`
Expected: FAIL with "Failed to resolve import './Panel.js'".

- [ ] **Step 16: Implement `src/ui/Panel.tsx`**

`TitledBox` takes `borderStyle` (required; arrow borders don't work with titles) and `titles: string[]`, and passes every other Box prop through, as its README documents.

```tsx
import type { JSX, ReactNode } from 'react';
import { Box, Text } from 'ink';
import { TitledBox } from '@mishieck/ink-titled-box';
import { useTheme } from './theme.js';

/**
 * Single switch: set to false if @mishieck/ink-titled-box misbehaves on the
 * installed Ink version (Task 1 Step 7). If the package was uninstalled,
 * also delete the TitledBox import and the TitledBox branch below.
 */
export const USE_TITLED_BOX = true;

export interface PanelProps {
  title: string;
  children: ReactNode;
  /** Pass a number: the fallback border needs it to draw the top edge. */
  width?: number | string;
  flexGrow?: number;
}

/** Hand-drawn titled border: `╭─ Title ────╮` above a round box without a top edge. */
export function FallbackPanel({ title, children, width, flexGrow }: PanelProps): JSX.Element {
  const theme = useTheme();
  const head = '╭─ ';
  const titleText = `${title} `;
  const fill = typeof width === 'number' ? Math.max(0, width - head.length - titleText.length - 1) : 2;
  const close = typeof width === 'number' ? '╮' : '';
  return (
    <Box flexDirection="column" width={width} flexGrow={flexGrow}>
      <Text wrap="truncate-end">
        <Text color={theme.border}>{head}</Text>
        <Text color={theme.accent} bold>
          {title}
        </Text>
        <Text color={theme.border}>
          {' '}
          {'─'.repeat(fill)}
          {close}
        </Text>
      </Text>
      <Box
        borderStyle="round"
        borderTop={false}
        borderColor={theme.border}
        flexDirection="column"
        paddingX={1}
      >
        {children}
      </Box>
    </Box>
  );
}

export function Panel(props: PanelProps): JSX.Element {
  const theme = useTheme();
  if (!USE_TITLED_BOX) return <FallbackPanel {...props} />;
  return (
    <TitledBox
      borderStyle="round"
      titles={[props.title]}
      borderColor={theme.border}
      flexDirection="column"
      paddingX={1}
      width={props.width}
      flexGrow={props.flexGrow}
    >
      {props.children}
    </TitledBox>
  );
}
```

- [ ] **Step 17: Run the Panel tests**

Run: `npx vitest run src/ui/Panel.test.tsx`
Expected: PASS. If only the first test fails because TitledBox renders the title somewhere unexpected or throws under Ink 7, set `USE_TITLED_BOX = false` and re-run. Both tests must pass, and the first one then exercises the fallback.

- [ ] **Step 18: Typecheck, lint, commit**

Run: `npm run typecheck && npm run lint && npx vitest run src/domain/format.test.ts src/ui`
Expected: all pass.

```bash
git add src/domain/format.ts src/domain/format.test.ts src/ui/theme.ts src/ui/theme.test.ts src/ui/Meter.tsx src/ui/Meter.test.tsx src/ui/Panel.tsx src/ui/Panel.test.tsx test/helpers/ansi.ts
git commit -m "feat(ui): add themes, display formatters, htop-style Meter and titled Panel

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 20: UsagePanel, Header, Footer

**Files:**
- Create: `src/ui/UsagePanel.tsx`, `src/ui/Header.tsx`, `src/ui/Footer.tsx`
- Test: `src/ui/UsagePanel.test.tsx`, `src/ui/Header.test.tsx`, `src/ui/Footer.test.tsx`

**Interfaces:**
- Consumes:
  - Task 1: `Snapshot`, `LimitsState`, `Limit` from `src/domain/types.ts`; `makeSnapshot`, `makeSession`, `NOW` from `test/helpers/snapshot.ts`.
  - Task 19: `Meter`, `Panel`, `useTheme`, the `formatUSD`, `formatResetsAt`, `formatDuration` and `formatClock` formatters, and `stripAnsi`.
  - Libraries: `Sparkline` from `@pppp606/ink-chart` (`data: number[]`, `width?: number`); `Spinner` from `@inkjs/ui` (`label`); `Gradient` (default export) from `ink-gradient` (`colors?: string[]`).
- Produces: `UsagePanel(props: { snapshot: Snapshot; width: number })`, `Header(props: { snapshot: Snapshot })`, `Footer(props: { mode: 'normal' | 'search'; search: string })`.

UsagePanel behavior (spec §6, §8):
- **Meter rows:** `5h` (block), `Week` (weekly), one row per `perModelWeekly` entry (its `label`), and `Extra` when `extra?.enabled`. The suffix is `formatResetsAt(resetsAt, now)` when `resetsAt` is set.
- **Status message replacing the meters** when there are no block/weekly values:

  | Status | Message |
  |---|---|
  | `loading` | `loading…` |
  | `no-credentials` | `login required` |
  | `disabled` | `disabled` |
  | `expired` | `expired — open Claude Code to refresh` |
  | `error` | `limits unavailable` |

- **Stale note:** when values exist and the status is `stale`, `error` or `expired`, the meters stay and a dim note `stale <formatDuration(now - fetchedAt)>` is added. `expired` also appends its message.
- **Burn row:** `burn $4.10/h`, or `burn —` when null, followed by `24h` and a Sparkline of `hourlySparkline`.
- **Right column:** `block`, `week`, `today` and `month` costs via `formatUSD`. While `!scan.done`, a Spinner labelled `scanning <filesDone>/<filesTotal>…`.

- [ ] **Step 1: Write the failing UsagePanel tests**

`src/ui/UsagePanel.test.tsx`:
```tsx
import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { UsagePanel } from './UsagePanel.js';
import { makeSnapshot, NOW } from '../../test/helpers/snapshot.js';
import { emptyWindowTotals } from '../domain/types.js';
import { stripAnsi } from '../../test/helpers/ansi.js';

const frame = (snap = makeSnapshot()) => stripAnsi(render(<UsagePanel snapshot={snap} width={100} />).lastFrame());

describe('UsagePanel', () => {
  it('shows block/weekly/per-model meters with reset countdowns', () => {
    const out = frame();
    expect(out).toContain('Usage');
    expect(out).toMatch(/5h\s+\[\|+\s*58%\]/);
    expect(out).toContain('resets 2h14m');
    expect(out).toMatch(/Week\s+\[\|+\s*31%\]/);
    expect(out).toMatch(/Opus\s+\[\|+\s*22%\]/);
  });

  it('shows block/week/today/month costs and burn rate', () => {
    const out = frame();
    expect(out).toMatch(/block\s+\$12\.40/);
    expect(out).toMatch(/week\s+\$96\.10/);
    expect(out).toMatch(/today\s+\$18\.20/);
    expect(out).toMatch(/month\s+\$412\.75/);
    expect(out).toContain('burn $4.10/h');
    expect(out).toContain('24h');
  });

  it('shows "login required" when there are no credentials', () => {
    const out = frame(makeSnapshot({ limits: { status: 'no-credentials', perModelWeekly: [] } }));
    expect(out).toContain('login required');
    expect(out).not.toContain('58%');
  });

  it('shows "disabled" and the expired copy verbatim', () => {
    expect(frame(makeSnapshot({ limits: { status: 'disabled', perModelWeekly: [] } }))).toContain('disabled');
    expect(frame(makeSnapshot({ limits: { status: 'expired', perModelWeekly: [] } }))).toContain(
      'expired — open Claude Code to refresh',
    );
  });

  it('keeps last values and marks them stale with their age', () => {
    const base = makeSnapshot();
    const out = frame({ ...base, limits: { ...base.limits, status: 'stale', fetchedAt: NOW - 4 * 60_000 } });
    expect(out).toContain('58%');
    expect(out).toContain('stale 4m');
  });

  it('shows scan progress and em dashes when pricing is unavailable', () => {
    const nullTotals = { ...emptyWindowTotals(), costUSD: null };
    const base = makeSnapshot();
    const out = frame({
      ...base,
      pricingStatus: 'unavailable',
      scan: { done: false, filesDone: 3, filesTotal: 10 },
      costs: { ...base.costs, block: nullTotals, today: nullTotals, week: nullTotals, month: nullTotals, burnRatePerHour: null },
    });
    expect(out).toContain('scanning 3/10…');
    expect(out).toMatch(/block\s+—/);
    expect(out).toContain('burn —');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/ui/UsagePanel.test.tsx`
Expected: FAIL with "Failed to resolve import './UsagePanel.js'".

- [ ] **Step 3: Implement `src/ui/UsagePanel.tsx`**

```tsx
import type { JSX } from 'react';
import { Box, Text } from 'ink';
import { Sparkline } from '@pppp606/ink-chart';
import { Spinner } from '@inkjs/ui';
import type { Limit, LimitsState, Snapshot } from '../domain/types.js';
import { formatDuration, formatResetsAt, formatUSD } from '../domain/format.js';
import { Meter } from './Meter.js';
import { Panel } from './Panel.js';
import { useTheme } from './theme.js';

const RIGHT_WIDTH = 20;
const SUFFIX_WIDTH = 18;

const STATUS_MESSAGE: Partial<Record<LimitsState['status'], string>> = {
  loading: 'loading…',
  'no-credentials': 'login required',
  disabled: 'disabled',
  expired: 'expired — open Claude Code to refresh',
  error: 'limits unavailable',
};

interface MeterRow {
  label: string;
  percent: number | undefined;
  suffix?: string;
}

function meterRows(limits: LimitsState, now: number): MeterRow[] {
  const toRow = (l: Limit): MeterRow => ({
    label: l.label,
    percent: l.percent,
    ...(l.resetsAt === undefined ? {} : { suffix: formatResetsAt(l.resetsAt, now) }),
  });
  const rows: MeterRow[] = [];
  if (limits.block) rows.push(toRow({ ...limits.block, label: '5h' }));
  if (limits.weekly) rows.push(toRow({ ...limits.weekly, label: 'Week' }));
  for (const l of limits.perModelWeekly) rows.push(toRow(l));
  const extra = limits.extra;
  if (extra?.enabled) {
    const amounts =
      extra.usedAmount !== undefined && extra.limitAmount !== undefined
        ? `${extra.usedAmount.toFixed(2)}/${extra.limitAmount.toFixed(2)} ${extra.currency ?? ''}`.trim()
        : undefined;
    rows.push({ label: 'Extra', percent: extra.percent, ...(amounts ? { suffix: amounts } : {}) });
  }
  return rows;
}

function LimitsBlock({ limits, now, leftWidth }: { limits: LimitsState; now: number; leftWidth: number }) {
  const theme = useTheme();
  const hasValues = limits.block !== undefined || limits.weekly !== undefined;
  const message = STATUS_MESSAGE[limits.status];
  if (!hasValues) {
    return (
      <Text>
        <Text color={theme.accent} bold>
          5h / Week{' '}
        </Text>
        <Text color={limits.status === 'disabled' ? theme.dim : theme.warn}>{message ?? 'no data'}</Text>
      </Text>
    );
  }
  const rows = meterRows(limits, now);
  const labelWidth = Math.max(...rows.map((r) => r.label.length));
  const meterWidth = Math.max(10, Math.min(60, leftWidth - labelWidth - 1 - SUFFIX_WIDTH - 1));
  const isStale = limits.status === 'stale' || limits.status === 'error' || limits.status === 'expired';
  return (
    <Box flexDirection="column">
      {rows.map((r) => (
        <Meter
          key={r.label}
          label={r.label}
          labelWidth={labelWidth}
          percent={r.percent}
          width={meterWidth}
          {...(r.suffix ? { suffix: r.suffix } : {})}
        />
      ))}
      {isStale ? (
        <Text color={theme.dim}>
          stale {limits.fetchedAt === undefined ? '?' : formatDuration(now - limits.fetchedAt)}
          {limits.status === 'expired' ? ` · ${STATUS_MESSAGE.expired}` : ''}
        </Text>
      ) : null}
    </Box>
  );
}

function CostColumn({ snapshot }: { snapshot: Snapshot }) {
  const theme = useTheme();
  const { costs, scan } = snapshot;
  const rows: Array<[string, number | null]> = [
    ['block', costs.block.costUSD],
    ['week', costs.week.costUSD],
    ['today', costs.today.costUSD],
    ['month', costs.month.costUSD],
  ];
  return (
    <Box flexDirection="column" width={RIGHT_WIDTH}>
      {rows.map(([label, v]) => (
        <Text key={label}>
          <Text color={theme.dim}>{label.padEnd(7)}</Text>
          <Text color={theme.text} bold>
            {formatUSD(v)}
          </Text>
        </Text>
      ))}
      {scan.done ? null : <Spinner label={`scanning ${scan.filesDone}/${scan.filesTotal}…`} />}
    </Box>
  );
}

export function UsagePanel({ snapshot, width }: { snapshot: Snapshot; width: number }): JSX.Element {
  const theme = useTheme();
  const inner = Math.max(20, width - 4);
  const leftWidth = Math.max(20, inner - RIGHT_WIDTH - 2);
  const burn = snapshot.costs.burnRatePerHour;
  const burnText = burn === null ? 'burn —' : `burn ${formatUSD(burn)}/h`;
  const sparkWidth = Math.max(8, Math.min(48, leftWidth - burnText.length - 8));
  return (
    <Panel title="Usage" width={width}>
      <Box flexDirection="row" columnGap={2}>
        <Box flexDirection="column" width={leftWidth}>
          <LimitsBlock limits={snapshot.limits} now={snapshot.now} leftWidth={leftWidth} />
          <Box columnGap={1}>
            <Text color={theme.text}>{burnText}</Text>
            <Text color={theme.dim}> 24h</Text>
            <Sparkline data={snapshot.costs.hourlySparkline} width={sparkWidth} />
          </Box>
        </Box>
        <CostColumn snapshot={snapshot} />
      </Box>
    </Panel>
  );
}
```

- [ ] **Step 4: Run the UsagePanel tests**

Run: `npx vitest run src/ui/UsagePanel.test.tsx`
Expected: PASS. If the Sparkline renders nothing for an all-zero array, that's fine: no test depends on its glyphs.

- [ ] **Step 5: Write the failing Header and Footer tests**

`src/ui/Header.test.tsx`:
```tsx
import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { Header } from './Header.js';
import { makeSession, makeSnapshot, NOW } from '../../test/helpers/snapshot.js';
import { formatClock } from '../domain/format.js';
import { stripAnsi } from '../../test/helpers/ansi.js';

describe('Header', () => {
  it('shows app name, live/ended counts and the clock', () => {
    const snap = makeSnapshot({
      sessions: [
        makeSession({ sessionId: 'a' }),
        makeSession({ sessionId: 'b' }),
        makeSession({ sessionId: 'c', live: false, status: 'ended' }),
      ],
    });
    const out = stripAnsi(render(<Header snapshot={snap} />).lastFrame());
    expect(out).toContain('ccstatusboard');
    expect(out).toContain('2 live / 1 ended');
    expect(out).toContain(formatClock(NOW));
  });

  it('shows pricing, unpriced-model and runtime warnings verbatim', () => {
    const snap = makeSnapshot({
      pricingStatus: 'stale',
      unknownModels: ['claude-mystery-9'],
      warnings: ['⚠ untested Claude Code v2.2.0'],
    });
    const out = stripAnsi(render(<Header snapshot={snap} />).lastFrame());
    expect(out).toContain('⚠ pricing stale');
    expect(out).toContain('⚠ unpriced: claude-mystery-9');
    expect(out).toContain('⚠ untested Claude Code v2.2.0');
  });
});
```

`src/ui/Footer.test.tsx`:
```tsx
import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { Footer } from './Footer.js';
import { stripAnsi } from '../../test/helpers/ansi.js';

describe('Footer', () => {
  it('shows htop-style key hints in normal mode', () => {
    const out = stripAnsi(render(<Footer mode="normal" search="" />).lastFrame());
    for (const hint of ['F1Help', '↑↓Select', '⏎Detail', 'sSort', 'fFilter', '/Search', 'qQuit']) {
      expect(out).toContain(hint);
    }
  });

  it('shows the search prompt in search mode', () => {
    const out = stripAnsi(render(<Footer mode="search" search="pet" />).lastFrame());
    expect(out).toContain('/pet');
    expect(out).toContain('Esc');
  });
});
```

- [ ] **Step 6: Run them to verify they fail**

Run: `npx vitest run src/ui/Header.test.tsx src/ui/Footer.test.tsx`
Expected: FAIL with "Failed to resolve import".

- [ ] **Step 7: Implement `src/ui/Header.tsx` and `src/ui/Footer.tsx`**

`src/ui/Header.tsx`:
```tsx
import type { JSX } from 'react';
import { Box, Text } from 'ink';
import Gradient from 'ink-gradient';
import type { Snapshot } from '../domain/types.js';
import { formatClock } from '../domain/format.js';
import { useTheme } from './theme.js';

export function headerWarnings(snapshot: Snapshot): string[] {
  const out: string[] = [];
  if (snapshot.pricingStatus === 'stale') out.push('⚠ pricing stale');
  if (snapshot.unknownModels.length > 0) out.push(`⚠ unpriced: ${snapshot.unknownModels.join(', ')}`);
  out.push(...snapshot.warnings);
  return out;
}

export function Header({ snapshot }: { snapshot: Snapshot }): JSX.Element {
  const theme = useTheme();
  const live = snapshot.sessions.filter((s) => s.live).length;
  const ended = snapshot.sessions.length - live;
  const warnings = headerWarnings(snapshot);
  return (
    <Box justifyContent="space-between" paddingX={1}>
      <Text>
        <Gradient colors={theme.gradient}>
          <Text bold>ccstatusboard</Text>
        </Gradient>
        <Text color={theme.dim}> · </Text>
        <Text color={theme.text}>
          {live} live / {ended} ended
        </Text>
        <Text color={theme.dim}> · </Text>
        <Text color={theme.text}>{formatClock(snapshot.now)}</Text>
      </Text>
      {warnings.length > 0 ? (
        <Text color={theme.warn} wrap="truncate-start">
          {warnings.join('  ')}
        </Text>
      ) : null}
    </Box>
  );
}
```

`src/ui/Footer.tsx`:
```tsx
import type { JSX } from 'react';
import { Box, Text } from 'ink';
import { useTheme } from './theme.js';

const HINTS: Array<[string, string]> = [
  ['F1', 'Help'],
  ['↑↓', 'Select'],
  ['⏎', 'Detail'],
  ['s', 'Sort'],
  ['f', 'Filter'],
  ['/', 'Search'],
  ['q', 'Quit'],
];

export function Footer({ mode, search }: { mode: 'normal' | 'search'; search: string }): JSX.Element {
  const theme = useTheme();
  if (mode === 'search') {
    return (
      <Box paddingX={1}>
        <Text>
          <Text color={theme.accent} bold>
            /{search}
          </Text>
          <Text color={theme.accent}>█</Text>
          <Text color={theme.dim}> ⏎ done · Esc clear</Text>
        </Text>
      </Box>
    );
  }
  return (
    <Box paddingX={1} columnGap={2}>
      {HINTS.map(([key, label]) => (
        <Text key={key}>
          <Text color={theme.text} bold>
            {key}
          </Text>
          <Text color={theme.accent}>{label}</Text>
        </Text>
      ))}
    </Box>
  );
}
```

- [ ] **Step 8: Run the Header and Footer tests**

Run: `npx vitest run src/ui/Header.test.tsx src/ui/Footer.test.tsx`
Expected: PASS. If ink-gradient drops characters in the non-TTY test stdout, the `ccstatusboard` assertion still holds once ANSI is stripped. If it doesn't, check that `Gradient` wraps a single `<Text>` child.

- [ ] **Step 9: Typecheck, lint, commit**

Run: `npm run typecheck && npm run lint && npx vitest run src/ui`
Expected: all pass.

```bash
git add src/ui/UsagePanel.tsx src/ui/UsagePanel.test.tsx src/ui/Header.tsx src/ui/Header.test.tsx src/ui/Footer.tsx src/ui/Footer.test.tsx
git commit -m "feat(ui): add usage panel with limit meters, costs and burn sparkline; header and footer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 21: SessionTable, DetailPane, HelpOverlay

**Files:**
- Create: `src/ui/sessionList.ts` (pure helpers, re-exported from `SessionTable.tsx`), `src/ui/SessionTable.tsx`, `src/ui/DetailPane.tsx`, `src/ui/HelpOverlay.tsx`
- Test: `src/ui/sessionList.test.ts`, `src/ui/SessionTable.test.tsx`, `src/ui/DetailPane.test.tsx`, `src/ui/HelpOverlay.test.tsx`

**Interfaces:**
- Consumes:
  - Task 1: `SessionView`, `ColumnKey`, `SortKey`, `DisplayStatus` from `src/domain/types.ts`; `makeSession`, `NOW` from `test/helpers/snapshot.ts`.
  - Task 19: `Panel`, `useTheme`, `levelColor`, `formatUSD`, `formatAgo`, `formatDuration`, `formatTokens`, `shortModel`, `truncate`, `stripAnsi`.
  - Library: `BarChart` from `@pppp606/ink-chart` (`data: {label, value, color?}[]`, `width?: number`, `showValue?: 'right'`, `sort?: 'desc'`, `format?: (v) => string`).
- Produces, all importable from `src/ui/SessionTable.tsx`:
  - `visibleColumns(columns: ColumnKey[], width: number): ColumnKey[]`
  - `sortSessions(sessions, sort): SessionView[]`
  - `filterSessions(sessions, filter: 'all' | 'live', search: string): SessionView[]`
  - `SessionTable(props: { sessions; selectedIndex; columns; width; maxRows; now; sort; filter; emptyMessage? })`. **Addition:** `emptyMessage?: string`, default `No Claude Code sessions in the last 24h`. Task 22 passes `` `No Claude Code sessions in the last ${config.endedWindowHours}h` ``.
  - **Additions beyond the registry:** `scrollWindow(selected, total, maxRows): { start: number; end: number }`, `COLUMN_WIDTHS`, `requiredWidth(columns)`.
  - `DetailPane(props: { session: SessionView | undefined; now: number; width: number })`
  - `HelpOverlay()`

Column layout:
- **Fixed widths:** status 5, model 10, branch 12, ctx 17, cost 9, last 8, uptime 6. `name` is flexible, with a minimum of 12 and a maximum of 32.
- **Width formula:** required width = Σ widths (using name = 12) + (n − 1) gaps + 4 for the border and padding. All 8 columns need exactly 90.
- **Drop order** as width shrinks: `uptime` → `branch` → `last` → `model`. `status`, `name`, `ctx` and `cost` are never dropped.

- [ ] **Step 1: Write the failing pure-helper tests (includes Review Focus item 5)**

`src/ui/sessionList.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { ColumnKey } from '../domain/types.js';
import { filterSessions, requiredWidth, scrollWindow, sortSessions, visibleColumns } from './sessionList.js';
import { makeSession, NOW } from '../../test/helpers/snapshot.js';

const ALL: ColumnKey[] = ['status', 'name', 'model', 'branch', 'ctx', 'cost', 'last', 'uptime'];

describe('visibleColumns (Review Focus 5: narrow terminals)', () => {
  it('keeps all 8 columns at 120 and at exactly 90', () => {
    expect(requiredWidth(ALL)).toBe(90);
    expect(visibleColumns(ALL, 120)).toEqual(ALL);
    expect(visibleColumns(ALL, 90)).toEqual(ALL);
  });
  it('drops uptime first (89)', () => {
    expect(visibleColumns(ALL, 89)).toEqual(['status', 'name', 'model', 'branch', 'ctx', 'cost', 'last']);
  });
  it('drops uptime then branch at 70', () => {
    expect(visibleColumns(ALL, 70)).toEqual(['status', 'name', 'model', 'ctx', 'cost', 'last']);
  });
  it('drops uptime, branch, last at 61', () => {
    expect(visibleColumns(ALL, 61)).toEqual(['status', 'name', 'model', 'ctx', 'cost']);
  });
  it('drops model too at 60, never the core four', () => {
    expect(visibleColumns(ALL, 60)).toEqual(['status', 'name', 'ctx', 'cost']);
    expect(visibleColumns(ALL, 20)).toEqual(['status', 'name', 'ctx', 'cost']);
  });
  it('preserves the user-configured column order and subset', () => {
    expect(visibleColumns(['cost', 'name', 'uptime', 'status'], 120)).toEqual(['cost', 'name', 'uptime', 'status']);
  });
});

describe('sortSessions', () => {
  const s = [
    makeSession({ sessionId: 'idle', name: 'b', status: 'idle', lastActivity: NOW - 10, costUSD: 1, contextPercent: 10 }),
    makeSession({ sessionId: 'ended', name: 'a', live: false, status: 'ended', lastActivity: NOW - 5, costUSD: null }),
    makeSession({ sessionId: 'wait', name: 'd', status: 'waiting', lastActivity: NOW - 1000, costUSD: 3, contextPercent: 90 }),
    makeSession({ sessionId: 'busy', name: 'c', status: 'busy', lastActivity: NOW - 1, costUSD: 2, contextPercent: undefined }),
  ];
  const ids = (xs: typeof s) => xs.map((x) => x.sessionId);
  it('status: waiting > busy > idle > ended', () => {
    expect(ids(sortSessions(s, 'status'))).toEqual(['wait', 'busy', 'idle', 'ended']);
  });
  it('activity: most recent first', () => {
    expect(ids(sortSessions(s, 'activity'))).toEqual(['busy', 'ended', 'idle', 'wait']);
  });
  it('cost: highest first, null last', () => {
    expect(ids(sortSessions(s, 'cost'))).toEqual(['wait', 'busy', 'idle', 'ended']);
  });
  it('ctx: highest first, undefined last', () => {
    expect(ids(sortSessions(s, 'ctx'))[0]).toBe('wait');
    expect(ids(sortSessions(s, 'ctx')).slice(-2)).toContain('busy');
  });
  it('name: alphabetical; does not mutate input', () => {
    const before = ids(s);
    expect(ids(sortSessions(s, 'name'))).toEqual(['ended', 'idle', 'busy', 'wait']);
    expect(ids(s)).toEqual(before);
  });
});

describe('filterSessions', () => {
  const s = [
    makeSession({ sessionId: '1', name: 'pet-tracker', cwd: '/home/u/house/seeed-pet-tracker' }),
    makeSession({ sessionId: '2', name: 'blog', cwd: '/home/u/blog', live: false, status: 'ended' }),
  ];
  it('live filter hides ended sessions', () => {
    expect(filterSessions(s, 'live', '').map((x) => x.sessionId)).toEqual(['1']);
  });
  it('search matches name or cwd case-insensitively', () => {
    expect(filterSessions(s, 'all', 'BLOG').map((x) => x.sessionId)).toEqual(['2']);
    expect(filterSessions(s, 'all', 'house').map((x) => x.sessionId)).toEqual(['1']);
    expect(filterSessions(s, 'all', '')).toHaveLength(2);
  });
});

describe('scrollWindow', () => {
  it('keeps the selection visible', () => {
    expect(scrollWindow(0, 10, 3)).toEqual({ start: 0, end: 3 });
    expect(scrollWindow(7, 10, 3)).toEqual({ start: 5, end: 8 });
    expect(scrollWindow(2, 2, 5)).toEqual({ start: 0, end: 2 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/ui/sessionList.test.ts`
Expected: FAIL with "Failed to resolve import './sessionList.js'".

- [ ] **Step 3: Implement `src/ui/sessionList.ts`**

```ts
import type { ColumnKey, DisplayStatus, SessionView, SortKey } from '../domain/types.js';

export const COLUMN_WIDTHS: Record<ColumnKey, number> = {
  status: 5,
  name: 12, // minimum; grows into spare width
  model: 10,
  branch: 12,
  ctx: 17,
  cost: 9,
  last: 8,
  uptime: 6,
};

export const NAME_MAX_WIDTH = 32;
const CHROME = 4; // border (2) + paddingX (2)
const DROP_ORDER: ColumnKey[] = ['uptime', 'branch', 'last', 'model'];

export function requiredWidth(columns: ColumnKey[]): number {
  const sum = columns.reduce((acc, c) => acc + COLUMN_WIDTHS[c], 0);
  return sum + Math.max(0, columns.length - 1) + CHROME;
}

export function visibleColumns(columns: ColumnKey[], width: number): ColumnKey[] {
  let cols = [...columns];
  for (const drop of DROP_ORDER) {
    if (requiredWidth(cols) <= width) break;
    cols = cols.filter((c) => c !== drop);
  }
  return cols;
}

export function nameWidth(columns: ColumnKey[], width: number): number {
  const spare = width - requiredWidth(columns);
  return Math.min(NAME_MAX_WIDTH, COLUMN_WIDTHS.name + Math.max(0, spare));
}

const STATUS_RANK: Record<DisplayStatus, number> = { waiting: 0, busy: 1, idle: 2, ended: 3 };

const byActivity = (a: SessionView, b: SessionView) => b.lastActivity - a.lastActivity;
const desc = (a: number | null | undefined, b: number | null | undefined) => {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  return b - a;
};

export function sortSessions(sessions: SessionView[], sort: SortKey): SessionView[] {
  const out = [...sessions];
  switch (sort) {
    case 'status':
      return out.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || byActivity(a, b));
    case 'activity':
      return out.sort(byActivity);
    case 'cost':
      return out.sort((a, b) => desc(a.costUSD, b.costUSD) || byActivity(a, b));
    case 'ctx':
      return out.sort((a, b) => desc(a.contextPercent, b.contextPercent) || byActivity(a, b));
    case 'name':
      return out.sort((a, b) => a.name.localeCompare(b.name));
  }
}

export function filterSessions(sessions: SessionView[], filter: 'all' | 'live', search: string): SessionView[] {
  const q = search.trim().toLowerCase();
  return sessions.filter((s) => {
    if (filter === 'live' && !s.live) return false;
    if (q === '') return true;
    return s.name.toLowerCase().includes(q) || (s.cwd ?? '').toLowerCase().includes(q);
  });
}

export function scrollWindow(selected: number, total: number, maxRows: number): { start: number; end: number } {
  const rows = Math.max(1, maxRows);
  const start = selected >= rows ? selected - rows + 1 : 0;
  return { start, end: Math.min(total, start + rows) };
}
```

- [ ] **Step 4: Run the helper tests**

Run: `npx vitest run src/ui/sessionList.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing SessionTable tests**

`src/ui/SessionTable.test.tsx`:
```tsx
import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import type { ColumnKey, SessionView } from '../domain/types.js';
import { SessionTable } from './SessionTable.js';
import { makeSession, NOW } from '../../test/helpers/snapshot.js';
import { stripAnsi } from '../../test/helpers/ansi.js';

const ALL: ColumnKey[] = ['status', 'name', 'model', 'branch', 'ctx', 'cost', 'last', 'uptime'];

function frame(sessions: SessionView[], over: Partial<Parameters<typeof SessionTable>[0]> = {}) {
  return stripAnsi(
    render(
      <SessionTable
        sessions={sessions}
        selectedIndex={0}
        columns={ALL}
        width={100}
        maxRows={10}
        now={NOW}
        sort="status"
        filter="all"
        {...over}
      />,
    ).lastFrame(),
  );
}

describe('SessionTable', () => {
  it('renders the header, status glyphs, ctx bar, cost and ages', () => {
    const out = frame([
      makeSession({ sessionId: 'w', name: 'ccstatusboard', status: 'waiting', contextPercent: 60 }),
      makeSession({ sessionId: 'b', name: 'power-tools', status: 'busy', activeAgents: 2, model: 'claude-sonnet-5-5' }),
      makeSession({ sessionId: 'i', name: 'pet-tracker', status: 'idle', lastActivity: NOW - 18 * 60_000 }),
      makeSession({
        sessionId: 'e',
        name: 'blog',
        live: false,
        status: 'ended',
        lastActivity: NOW - 3 * 3_600_000,
        contextPercent: undefined,
        costUSD: 0.42,
      }),
    ]);
    expect(out).toContain('Sessions ── sort: status ── filter: all');
    for (const h of ['ST', 'NAME', 'MODEL', 'BRANCH', 'CTX', 'COST', 'LAST', 'UP']) expect(out).toContain(h);
    expect(out).toMatch(/●\s+ccstatusboard/);
    expect(out).toMatch(/◐ 2\s+power-tools/);
    expect(out).toMatch(/○\s+pet-tracker/);
    expect(out).toMatch(/·\s+blog/);
    expect(out).toContain('██████░░░░ 60%');
    expect(out).toContain('sonnet-5.5');
    expect(out).toContain('$0.42');
    expect(out).toContain('18m');
    expect(out).toContain('3h ago');
    expect(out).toContain('12m'); // uptime from makeSession startedAt
  });

  it('drops columns on a narrow terminal (Review Focus 5)', () => {
    const out = frame([makeSession()], { width: 70 });
    expect(out).toContain('CTX');
    expect(out).toContain('MODEL');
    expect(out).not.toContain('BRANCH');
    expect(out).not.toContain(' UP');
  });

  it('scrolls so the selected row stays visible', () => {
    const sessions = Array.from({ length: 10 }, (_, i) => makeSession({ sessionId: `s${i}`, name: `alpha-${i}` }));
    const out = frame(sessions, { maxRows: 3, selectedIndex: 7 });
    expect(out).toContain('alpha-5');
    expect(out).toContain('alpha-7');
    expect(out).not.toContain('alpha-4');
    expect(out).not.toContain('alpha-8');
  });

  it('shows the empty-state message', () => {
    expect(frame([], { emptyMessage: 'No Claude Code sessions in the last 6h' })).toContain(
      'No Claude Code sessions in the last 6h',
    );
    expect(frame([])).toContain('No Claude Code sessions in the last 24h');
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run src/ui/SessionTable.test.tsx`
Expected: FAIL with "Failed to resolve import './SessionTable.js'".

- [ ] **Step 7: Implement `src/ui/SessionTable.tsx`**

```tsx
import type { JSX } from 'react';
import { Box, Text } from 'ink';
import type { ColumnKey, DisplayStatus, SessionView, SortKey } from '../domain/types.js';
import { formatAgo, formatDuration, formatUSD, shortModel, truncate } from '../domain/format.js';
import { Panel } from './Panel.js';
import { COLUMN_WIDTHS, nameWidth, scrollWindow, visibleColumns } from './sessionList.js';
import { levelColor, useTheme, type Theme } from './theme.js';

export {
  COLUMN_WIDTHS,
  filterSessions,
  requiredWidth,
  scrollWindow,
  sortSessions,
  visibleColumns,
} from './sessionList.js';

const HEADERS: Record<ColumnKey, string> = {
  status: 'ST',
  name: 'NAME',
  model: 'MODEL',
  branch: 'BRANCH',
  ctx: 'CTX',
  cost: 'COST',
  last: 'LAST',
  uptime: 'UP',
};

const GLYPHS: Record<DisplayStatus, string> = { waiting: '●', busy: '◐', idle: '○', ended: '·' };

export interface SessionTableProps {
  sessions: SessionView[];
  selectedIndex: number;
  columns: ColumnKey[];
  width: number;
  maxRows: number;
  now: number;
  sort: SortKey;
  filter: 'all' | 'live';
  emptyMessage?: string;
}

function ctxBar(pct: number | undefined): string {
  if (pct === undefined) return '—';
  const filled = Math.max(0, Math.min(10, Math.round(pct / 10)));
  return `${'█'.repeat(filled)}${'░'.repeat(10 - filled)} ${pct}%`;
}

function cellText(col: ColumnKey, s: SessionView, now: number, nameW: number): string {
  switch (col) {
    case 'status':
      return s.activeAgents > 0 && s.status !== 'ended' ? `${GLYPHS[s.status]} ${s.activeAgents}` : GLYPHS[s.status];
    case 'name':
      return truncate(s.name, nameW);
    case 'model':
      return shortModel(s.model);
    case 'branch':
      return s.gitBranch ?? '—';
    case 'ctx':
      return ctxBar(s.contextPercent);
    case 'cost':
      return formatUSD(s.costUSD, s.costApprox);
    case 'last':
      return formatAgo(s.lastActivity, now);
    case 'uptime':
      return s.live && s.startedAt !== undefined ? formatDuration(now - s.startedAt) : '—';
  }
}

function cellColor(col: ColumnKey, s: SessionView, theme: Theme): string {
  if (col === 'status') {
    if (s.status === 'waiting') return theme.warn;
    if (s.status === 'busy') return theme.ok;
    return s.status === 'ended' ? theme.dim : theme.text;
  }
  if (col === 'ctx' && s.contextPercent !== undefined) return levelColor(theme, s.contextPercent, [60, 80]);
  return theme.text;
}

function Row(props: {
  session: SessionView;
  cols: ColumnKey[];
  nameW: number;
  now: number;
  selected: boolean;
}): JSX.Element {
  const theme = useTheme();
  const { session: s, cols, nameW, now, selected } = props;
  const ended = s.status === 'ended';
  return (
    <Box columnGap={1}>
      {cols.map((c) => (
        <Box key={c} width={c === 'name' ? nameW : COLUMN_WIDTHS[c]}>
          <Text
            wrap="truncate-end"
            color={selected ? theme.selectedFg : cellColor(c, s, theme)}
            {...(selected ? { backgroundColor: theme.selectedBg } : {})}
            dimColor={ended && !selected}
            bold={c === 'status' && s.status === 'waiting'}
          >
            {cellText(c, s, now, nameW)}
          </Text>
        </Box>
      ))}
    </Box>
  );
}

export function SessionTable(props: SessionTableProps): JSX.Element {
  const theme = useTheme();
  const { sessions, selectedIndex, width, maxRows, now, sort, filter } = props;
  const cols = visibleColumns(props.columns, width);
  const nameW = nameWidth(cols, width);
  const { start, end } = scrollWindow(selectedIndex, sessions.length, maxRows);
  const title = `Sessions ── sort: ${sort} ── filter: ${filter}`;
  return (
    <Panel title={title} width={width}>
      <Box columnGap={1}>
        {cols.map((c) => (
          <Box key={c} width={c === 'name' ? nameW : COLUMN_WIDTHS[c]}>
            <Text color={theme.dim} bold>
              {HEADERS[c]}
            </Text>
          </Box>
        ))}
      </Box>
      {sessions.length === 0 ? (
        <Text color={theme.dim}>{props.emptyMessage ?? 'No Claude Code sessions in the last 24h'}</Text>
      ) : (
        sessions
          .slice(start, end)
          .map((s, i) => (
            <Row
              key={s.sessionId}
              session={s}
              cols={cols}
              nameW={nameW}
              now={now}
              selected={start + i === selectedIndex}
            />
          ))
      )}
    </Panel>
  );
}
```

- [ ] **Step 8: Run the SessionTable tests**

Run: `npx vitest run src/ui/SessionTable.test.tsx`
Expected: PASS. If the panel title gets truncated by the TitledBox border at width 100, the first assertion will fail. In that case shorten the title separator to a single `─` in both the component and the test.

- [ ] **Step 9: Write the failing DetailPane and HelpOverlay tests**

`src/ui/DetailPane.test.tsx`:
```tsx
import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { DetailPane } from './DetailPane.js';
import { makeSession, NOW } from '../../test/helpers/snapshot.js';
import { stripAnsi } from '../../test/helpers/ansi.js';
import { ZERO_TOKENS } from '../domain/types.js';

describe('DetailPane', () => {
  it('shows status, cwd, mode, version, token breakdown, context, agents and per-model costs', () => {
    const session = makeSession({
      name: 'ccstatusboard',
      status: 'waiting',
      waitingFor: 'input needed',
      permissionMode: 'plan',
      version: '2.1.296',
      activeAgents: 2,
      agentNames: ['Explore', 'Plan'],
      tokens: { input: 12_300, output: 48_100, cacheWrite5m: 200_000, cacheWrite1h: 10_000, cacheRead: 3_100_000 },
      byModel: {
        'claude-opus-5-5': { costUSD: 3.9, tokens: { ...ZERO_TOKENS } },
        'claude-haiku-5-5': { costUSD: 0.3, tokens: { ...ZERO_TOKENS } },
      },
    });
    const out = stripAnsi(render(<DetailPane session={session} now={NOW} width={100} />).lastFrame());
    expect(out).toContain('Detail: ccstatusboard');
    expect(out).toContain('waiting: input needed');
    expect(out).toContain('/work/proj');
    expect(out).toContain('plan mode');
    expect(out).toContain('v2.1.296');
    expect(out).toContain('in 12.3k');
    expect(out).toContain('out 48.1k');
    expect(out).toContain('cache-w 210k');
    expect(out).toContain('cache-r 3.1M');
    expect(out).toContain('ctx 120k / 200k (60%)');
    expect(out).toContain('agents: 2 active (Explore, Plan)');
    expect(out).toContain('opus-5.5');
    expect(out).toContain('haiku-5.5');
  });

  it('handles no selection and ended sessions', () => {
    expect(stripAnsi(render(<DetailPane session={undefined} now={NOW} width={80} />).lastFrame())).toContain(
      'No session selected',
    );
    const ended = makeSession({ live: false, status: 'ended', lastActivity: NOW - 3 * 3_600_000, byModel: {} });
    const out = stripAnsi(render(<DetailPane session={ended} now={NOW} width={80} />).lastFrame());
    expect(out).toContain('ended 3h ago');
    expect(out).toContain('agents: none active');
  });
});
```

`src/ui/HelpOverlay.test.tsx`:
```tsx
import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { HelpOverlay } from './HelpOverlay.js';
import { stripAnsi } from '../../test/helpers/ansi.js';

describe('HelpOverlay', () => {
  it('lists every key binding and the status legend', () => {
    const out = stripAnsi(render(<HelpOverlay />).lastFrame());
    for (const s of ['Help', 'Move selection', 'Toggle detail', 'Top / bottom', 'Cycle sort', 'Toggle filter', 'Search', 'Quit']) {
      expect(out).toContain(s);
    }
    for (const g of ['● waiting', '◐ busy', '○ idle', '· ended']) expect(out).toContain(g);
  });
});
```

- [ ] **Step 10: Run them to verify they fail**

Run: `npx vitest run src/ui/DetailPane.test.tsx src/ui/HelpOverlay.test.tsx`
Expected: FAIL with "Failed to resolve import".

- [ ] **Step 11: Implement `src/ui/DetailPane.tsx` and `src/ui/HelpOverlay.tsx`**

`src/ui/DetailPane.tsx`:
```tsx
import type { JSX } from 'react';
import { Box, Text } from 'ink';
import { BarChart } from '@pppp606/ink-chart';
import type { SessionView } from '../domain/types.js';
import { formatAgo, formatDuration, formatTokens, formatUSD, shortModel } from '../domain/format.js';
import { Panel } from './Panel.js';
import { useTheme } from './theme.js';

function statusText(s: SessionView, now: number): string {
  switch (s.status) {
    case 'waiting':
      return s.waitingFor ? `waiting: ${s.waitingFor}` : 'waiting';
    case 'busy':
      return 'busy';
    case 'idle':
      return s.rawStatus ? `idle (${s.rawStatus})` : 'idle';
    case 'ended':
      return `ended ${formatAgo(s.lastActivity, now)}`;
  }
}

export function DetailPane({ session, now, width }: { session: SessionView | undefined; now: number; width: number }): JSX.Element {
  const theme = useTheme();
  if (!session) {
    return (
      <Panel title="Detail" width={width}>
        <Text color={theme.dim}>No session selected</Text>
      </Panel>
    );
  }
  const s = session;
  const chartWidth = Math.max(16, Math.min(36, Math.floor(width / 3)));
  const leftWidth = Math.max(20, width - 4 - chartWidth - 2);
  const line1 = [
    statusText(s, now),
    s.cwd,
    s.permissionMode ? `${s.permissionMode} mode` : undefined,
    s.version ? `v${s.version}` : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
  const t = s.tokens;
  const line2 = `in ${formatTokens(t.input)}  out ${formatTokens(t.output)}  cache-w ${formatTokens(
    t.cacheWrite5m + t.cacheWrite1h,
  )}  cache-r ${formatTokens(t.cacheRead)}`;
  const ctx =
    s.contextTokens !== undefined && s.contextWindow !== undefined
      ? `ctx ${formatTokens(s.contextTokens)} / ${formatTokens(s.contextWindow)} (${s.contextPercent ?? 0}%)`
      : 'ctx —';
  const up = s.live && s.startedAt !== undefined ? ` · up ${formatDuration(now - s.startedAt)}` : '';
  const agents =
    s.activeAgents > 0
      ? `agents: ${s.activeAgents} active${s.agentNames.length ? ` (${s.agentNames.join(', ')})` : ''}`
      : 'agents: none active';
  const chartData = Object.entries(s.byModel)
    .filter(([, m]) => (m.costUSD ?? 0) > 0)
    .map(([model, m]) => ({ label: shortModel(model), value: m.costUSD ?? 0 }));

  return (
    <Panel title={`Detail: ${s.name}`} width={width}>
      <Box flexDirection="row" columnGap={2}>
        <Box flexDirection="column" width={leftWidth}>
          <Text color={s.status === 'waiting' ? theme.warn : theme.text} wrap="truncate-middle">
            {line1}
          </Text>
          <Text color={theme.text}>{line2}</Text>
          <Text color={theme.text}>
            {ctx}
            {up}
            {' · '}
            {formatUSD(s.costUSD, s.costApprox)}
          </Text>
          <Text color={theme.dim}>{agents}</Text>
        </Box>
        <Box width={chartWidth} flexDirection="column">
          {chartData.length > 0 ? (
            <BarChart
              data={chartData}
              width={chartWidth}
              showValue="right"
              sort="desc"
              color={theme.accent}
              format={(v) => formatUSD(v)}
            />
          ) : (
            <Text color={theme.dim}>no model costs yet</Text>
          )}
        </Box>
      </Box>
    </Panel>
  );
}
```

`src/ui/HelpOverlay.tsx`:
```tsx
import type { JSX } from 'react';
import { Box, Text } from 'ink';
import { Panel } from './Panel.js';
import { useTheme } from './theme.js';

const KEYS: Array<[string, string]> = [
  ['↑/↓  j/k', 'Move selection'],
  ['⏎', 'Toggle detail pane'],
  ['g / G', 'Top / bottom'],
  ['s', 'Cycle sort (status → activity → cost → ctx → name)'],
  ['f', 'Toggle filter (all / live)'],
  ['/', 'Search by name or cwd (Esc clears)'],
  ['? / F1', 'Toggle this help'],
  ['q / Ctrl-C', 'Quit'],
];

const LEGEND = ['● waiting', '◐ busy', '○ idle', '· ended'];

export function HelpOverlay(): JSX.Element {
  const theme = useTheme();
  return (
    <Panel title="Help" width={64}>
      {KEYS.map(([key, label]) => (
        <Box key={key}>
          <Box width={14}>
            <Text color={theme.accent} bold>
              {key}
            </Text>
          </Box>
          <Text color={theme.text}>{label}</Text>
        </Box>
      ))}
      <Box marginTop={1} columnGap={3}>
        {LEGEND.map((l) => (
          <Text key={l} color={theme.dim}>
            {l}
          </Text>
        ))}
      </Box>
    </Panel>
  );
}
```

- [ ] **Step 12: Run the DetailPane and HelpOverlay tests**

Run: `npx vitest run src/ui/DetailPane.test.tsx src/ui/HelpOverlay.test.tsx`
Expected: PASS. If `BarChart` ignores the numeric `width` and wraps labels, the `opus-5.5` and `haiku-5.5` assertions still hold.

- [ ] **Step 13: Typecheck, lint, full UI run, commit**

Run: `npm run typecheck && npm run lint && npx vitest run src/ui`
Expected: all pass.

```bash
git add src/ui/sessionList.ts src/ui/sessionList.test.ts src/ui/SessionTable.tsx src/ui/SessionTable.test.tsx src/ui/DetailPane.tsx src/ui/DetailPane.test.tsx src/ui/HelpOverlay.tsx src/ui/HelpOverlay.test.tsx
git commit -m "feat(ui): add responsive session table, detail pane with per-model costs, help overlay

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

---

### Task 22: App shell — layout, keyboard navigation, size guards

**Files:**
- Create: `src/ui/App.tsx`
- Test: `src/ui/App.test.tsx`

**Interfaces:**
- Consumes:
  - `Store` type (Task 18, `src/store/store.ts`): only `Pick<Store, 'subscribe' | 'getSnapshot'>`
  - `useSnapshot(store)` (Task 18, `src/store/useSnapshot.ts`)
  - `THEMES`, `ThemeContext`, `inkUiTheme` (Task 19, `src/ui/theme.ts`); `ThemeProvider` from `@inkjs/ui`; `SessionTable`'s `emptyMessage` prop (Task 21)
  - `Panel` (Task 19, `src/ui/Panel.tsx`)
  - `Header({ snapshot })`, `UsagePanel({ snapshot, width })`, `Footer({ mode, search })` (Task 20)
  - `SessionTable(...)`, `sortSessions`, `filterSessions` (Task 21, `src/ui/SessionTable.tsx`)
  - `DetailPane({ session, now, width })`, `HelpOverlay()` (Task 21)
  - `DEFAULT_CONFIG` (Task 4, `src/config/schema.ts`), used in tests only
  - `makeSnapshot`, `makeSession`, `NOW` (Task 1, `test/helpers/snapshot.ts`)
- Produces (exact):
  ```ts
  export function App(props: AppProps): JSX.Element
  export interface AppProps {
    store: Pick<Store, 'subscribe' | 'getSnapshot'>;
    config: Config;
    onQuit: () => void;
    /** Extension beyond the registry: test-only terminal size override; defaults to live stdout size. */
    size?: { columns: number; rows: number };
  }
  export interface UiState { selectedIndex: number; sort: SortKey; filter: 'all' | 'live'; search: string; mode: 'normal' | 'search' | 'help'; showDetail: boolean }
  export type UiAction =
    | { type: 'up' | 'down' | 'top' | 'bottom' | 'toggleDetail' | 'cycleSort' | 'toggleFilter' | 'startSearch' | 'endSearch' | 'clearSearch' | 'toggleHelp' }
    | { type: 'searchInput'; char: string }
    | { type: 'searchBackspace' };
  export function uiReducer(s: UiState, a: UiAction, rowCount: number): UiState
  export function initialUiState(config: Config): UiState
  export const MIN_COLUMNS = 60, MIN_ROWS = 16, DETAIL_MIN_ROWS = 24
  ```
- Contract note: `App` passes `SessionTable` a list it has **already filtered and sorted** with `filterSessions` and then `sortSessions`. `SessionTable` re-sorting or re-filtering it is harmless because both operations are idempotent. The selected session handed to `DetailPane` is `visible[selectedIndex]` from that same list.

- [ ] **Step 1: Write the failing reducer tests**

`src/ui/App.test.tsx` (part 1 of 2; Step 5 appends part 2 to the same file):
```tsx
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { App, initialUiState, uiReducer, type UiState } from './App.js';
import { DEFAULT_CONFIG } from '../config/schema.js';
import { makeSession, makeSnapshot, NOW } from '../../test/helpers/snapshot.js';
import type { Snapshot } from '../domain/types.js';

const base: UiState = initialUiState(DEFAULT_CONFIG);

describe('uiReducer', () => {
  it('starts from config sort/showDetail with nothing selected beyond row 0', () => {
    expect(base).toEqual({ selectedIndex: 0, sort: 'status', filter: 'all', search: '', mode: 'normal', showDetail: true });
  });
  it('moves selection and clamps to [0, rowCount-1]', () => {
    let s = uiReducer(base, { type: 'down' }, 3);
    s = uiReducer(s, { type: 'down' }, 3);
    s = uiReducer(s, { type: 'down' }, 3);
    expect(s.selectedIndex).toBe(2);
    s = uiReducer(s, { type: 'up' }, 3);
    expect(s.selectedIndex).toBe(1);
    expect(uiReducer(base, { type: 'up' }, 3).selectedIndex).toBe(0);
  });
  it('top/bottom jump; empty list keeps index 0', () => {
    expect(uiReducer(base, { type: 'bottom' }, 5).selectedIndex).toBe(4);
    expect(uiReducer({ ...base, selectedIndex: 4 }, { type: 'top' }, 5).selectedIndex).toBe(0);
    expect(uiReducer(base, { type: 'bottom' }, 0).selectedIndex).toBe(0);
    expect(uiReducer(base, { type: 'down' }, 0).selectedIndex).toBe(0);
  });
  it('cycleSort walks status→activity→cost→ctx→name→status and resets selection', () => {
    let s: UiState = { ...base, selectedIndex: 2 };
    const seen: string[] = [];
    for (let i = 0; i < 5; i++) {
      s = uiReducer(s, { type: 'cycleSort' }, 3);
      seen.push(s.sort);
    }
    expect(seen).toEqual(['activity', 'cost', 'ctx', 'name', 'status']);
    expect(s.selectedIndex).toBe(0);
  });
  it('toggleFilter flips all/live and resets selection', () => {
    const s = uiReducer({ ...base, selectedIndex: 2 }, { type: 'toggleFilter' }, 3);
    expect(s.filter).toBe('live');
    expect(s.selectedIndex).toBe(0);
    expect(uiReducer(s, { type: 'toggleFilter' }, 3).filter).toBe('all');
  });
  it('search: start, type, backspace, end keeps text, clear wipes it', () => {
    let s = uiReducer(base, { type: 'startSearch' }, 3);
    expect(s.mode).toBe('search');
    s = uiReducer(s, { type: 'searchInput', char: 'a' }, 3);
    s = uiReducer(s, { type: 'searchInput', char: 'b' }, 3);
    s = uiReducer(s, { type: 'searchBackspace' }, 3);
    expect(s.search).toBe('a');
    s = uiReducer(s, { type: 'endSearch' }, 3);
    expect(s).toMatchObject({ mode: 'normal', search: 'a' });
    s = uiReducer(s, { type: 'clearSearch' }, 3);
    expect(s).toMatchObject({ mode: 'normal', search: '' });
  });
  it('toggleHelp and toggleDetail flip', () => {
    const h = uiReducer(base, { type: 'toggleHelp' }, 3);
    expect(h.mode).toBe('help');
    expect(uiReducer(h, { type: 'toggleHelp' }, 3).mode).toBe('normal');
    expect(uiReducer(base, { type: 'toggleDetail' }, 3).showDetail).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/ui/App.test.tsx`
Expected: FAIL with `Failed to resolve import "./App.js"`.

- [ ] **Step 3: Implement `src/ui/App.tsx`**

```tsx
import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import type { Config, SortKey } from '../domain/types.js';
import type { Store } from '../store/store.js';
import { useSnapshot } from '../store/useSnapshot.js';
import { ThemeProvider } from '@inkjs/ui';
import { THEMES, ThemeContext, inkUiTheme } from './theme.js';
import { Panel } from './Panel.js';
import { Header } from './Header.js';
import { UsagePanel } from './UsagePanel.js';
import { Footer } from './Footer.js';
import { SessionTable, filterSessions, sortSessions } from './SessionTable.js';
import { DetailPane } from './DetailPane.js';
import { HelpOverlay } from './HelpOverlay.js';

export const MIN_COLUMNS = 60;
export const MIN_ROWS = 16;
export const DETAIL_MIN_ROWS = 24;
// header 1 + usage panel 6 + table borders 2 + table header 1 + footer 1
const CHROME_ROWS = 11;
const DETAIL_ROWS = 5;
const SORT_ORDER: SortKey[] = ['status', 'activity', 'cost', 'ctx', 'name'];

export interface UiState {
  selectedIndex: number;
  sort: SortKey;
  filter: 'all' | 'live';
  search: string;
  mode: 'normal' | 'search' | 'help';
  showDetail: boolean;
}

export type UiAction =
  | {
      type:
        | 'up'
        | 'down'
        | 'top'
        | 'bottom'
        | 'toggleDetail'
        | 'cycleSort'
        | 'toggleFilter'
        | 'startSearch'
        | 'endSearch'
        | 'clearSearch'
        | 'toggleHelp';
    }
  | { type: 'searchInput'; char: string }
  | { type: 'searchBackspace' };

export interface AppProps {
  store: Pick<Store, 'subscribe' | 'getSnapshot'>;
  config: Config;
  onQuit: () => void;
  /** Test-only terminal size override; defaults to live stdout size. */
  size?: { columns: number; rows: number };
}

export function initialUiState(config: Config): UiState {
  return { selectedIndex: 0, sort: config.sort, filter: 'all', search: '', mode: 'normal', showDetail: config.showDetail };
}

function clamp(i: number, rowCount: number): number {
  if (rowCount <= 0) return 0;
  return Math.min(Math.max(i, 0), rowCount - 1);
}

export function uiReducer(s: UiState, a: UiAction, rowCount: number): UiState {
  switch (a.type) {
    case 'up':
      return { ...s, selectedIndex: clamp(s.selectedIndex - 1, rowCount) };
    case 'down':
      return { ...s, selectedIndex: clamp(s.selectedIndex + 1, rowCount) };
    case 'top':
      return { ...s, selectedIndex: 0 };
    case 'bottom':
      return { ...s, selectedIndex: clamp(rowCount - 1, rowCount) };
    case 'toggleDetail':
      return { ...s, showDetail: !s.showDetail };
    case 'cycleSort': {
      const next = SORT_ORDER[(SORT_ORDER.indexOf(s.sort) + 1) % SORT_ORDER.length] ?? 'status';
      return { ...s, sort: next, selectedIndex: 0 };
    }
    case 'toggleFilter':
      return { ...s, filter: s.filter === 'all' ? 'live' : 'all', selectedIndex: 0 };
    case 'startSearch':
      return { ...s, mode: 'search' };
    case 'endSearch':
      return { ...s, mode: 'normal' };
    case 'clearSearch':
      return { ...s, mode: 'normal', search: '', selectedIndex: 0 };
    case 'toggleHelp':
      return { ...s, mode: s.mode === 'help' ? 'normal' : 'help' };
    case 'searchInput':
      return { ...s, search: s.search + a.char, selectedIndex: 0 };
    case 'searchBackspace':
      return { ...s, search: s.search.slice(0, -1), selectedIndex: 0 };
  }
}

function useTerminalSize(override?: { columns: number; rows: number }): { columns: number; rows: number } {
  const { stdout } = useStdout();
  const read = () => ({ columns: stdout.columns || 80, rows: stdout.rows || 24 });
  const [size, setSize] = useState(read);
  useEffect(() => {
    if (override) return;
    const onResize = () => setSize(read());
    stdout.on('resize', onResize);
    return () => {
      stdout.off('resize', onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stdout, override]);
  return override ?? size;
}

// F1 arrives as ESC O P; Ink may strip the leading ESC.
const isF1 = (input: string) => input === '\u001bOP' || input === 'OP';

export function App({ store, config, onQuit, size }: AppProps): React.JSX.Element {
  const snapshot = useSnapshot(store);
  const { columns, rows } = useTerminalSize(size);
  const [ui, setUi] = useState<UiState>(() => initialUiState(config));

  const visible = useMemo(
    () => sortSessions(filterSessions(snapshot.sessions, ui.filter, ui.search), ui.sort),
    [snapshot.sessions, ui.filter, ui.search, ui.sort],
  );
  const selected = clamp(ui.selectedIndex, visible.length);
  const dispatch = (a: UiAction) => setUi((s) => uiReducer(s, a, visible.length));

  useInput((input, key) => {
    if (key.ctrl && input === 'c') return onQuit();
    if (ui.mode === 'search') {
      if (key.escape) dispatch({ type: 'clearSearch' });
      else if (key.return) dispatch({ type: 'endSearch' });
      else if (key.backspace || key.delete) dispatch({ type: 'searchBackspace' });
      else if (input && !key.ctrl && !key.meta) dispatch({ type: 'searchInput', char: input });
      return;
    }
    if (ui.mode === 'help') {
      if (input === 'q') return onQuit();
      dispatch({ type: 'toggleHelp' });
      return;
    }
    if (input === 'q') return onQuit();
    if (key.upArrow || input === 'k') dispatch({ type: 'up' });
    else if (key.downArrow || input === 'j') dispatch({ type: 'down' });
    else if (input === 'g') dispatch({ type: 'top' });
    else if (input === 'G') dispatch({ type: 'bottom' });
    else if (key.return) dispatch({ type: 'toggleDetail' });
    else if (input === 's') dispatch({ type: 'cycleSort' });
    else if (input === 'f') dispatch({ type: 'toggleFilter' });
    else if (input === '/') dispatch({ type: 'startSearch' });
    else if (input === '?' || isF1(input)) dispatch({ type: 'toggleHelp' });
    else if (key.escape && ui.search) dispatch({ type: 'clearSearch' });
  });

  if (columns < MIN_COLUMNS || rows < MIN_ROWS) {
    return <Text>Terminal too small</Text>;
  }

  const detailShown = ui.showDetail && rows >= DETAIL_MIN_ROWS;
  const maxRows = Math.max(1, rows - CHROME_ROWS - (detailShown ? DETAIL_ROWS : 0));

  let body: React.JSX.Element;
  if (ui.mode === 'help') {
    body = <HelpOverlay />;
  } else if (!snapshot.claudeDirFound) {
    body = (
      <Panel title="Sessions">
        <Text>Claude Code data not found at {snapshot.claudeDir}</Text>
      </Panel>
    );
  } else if (snapshot.sessions.length === 0) {
    body = (
      <Panel title="Sessions">
        <Text>No Claude Code sessions in the last {config.endedWindowHours}h</Text>
      </Panel>
    );
  } else {
    body = (
      <>
        <SessionTable
          sessions={visible}
          selectedIndex={selected}
          columns={config.columns}
          width={columns}
          maxRows={maxRows}
          now={snapshot.now}
          sort={ui.sort}
          filter={ui.filter}
          emptyMessage={`No Claude Code sessions in the last ${config.endedWindowHours}h`}
        />
        {detailShown && <DetailPane session={visible[selected]} now={snapshot.now} width={columns} />}
      </>
    );
  }

  return (
    <ThemeContext.Provider value={THEMES[config.theme]}>
      <ThemeProvider theme={inkUiTheme(THEMES[config.theme])}>
      <Box flexDirection="column" width={columns}>
        <Header snapshot={snapshot} />
        {ui.mode !== 'help' && <UsagePanel snapshot={snapshot} width={columns} />}
        {body}
        <Footer mode={ui.mode === 'search' ? 'search' : 'normal'} search={ui.search} />
      </Box>
      </ThemeProvider>
    </ThemeContext.Provider>
  );
}
```

If `eslint-plugin-react-hooks` isn't installed (Task 1 doesn't add it), delete the `eslint-disable-next-line` comment. Otherwise ESLint reports an unknown rule.

- [ ] **Step 4: Run reducer tests**

Run: `npx vitest run src/ui/App.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 5: Append the failing render/keyboard tests to `src/ui/App.test.tsx`**

```tsx
const delay = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const fakeStore = (snap: Snapshot) => ({ subscribe: () => () => {}, getSnapshot: () => snap });
const BIG = { columns: 120, rows: 40 };

function twoSessions(): Snapshot {
  return makeSnapshot({
    sessions: [
      makeSession({ sessionId: 'a', name: 'alpha', cwd: '/srv/a-mark', lastActivity: NOW - 1_000 }),
      makeSession({ sessionId: 'b', name: 'beta', cwd: '/srv/b-mark', lastActivity: NOW - 5_000 }),
    ],
  });
}

function renderApp(snap: Snapshot, size = BIG, onQuit = vi.fn()) {
  const r = render(<App store={fakeStore(snap)} config={DEFAULT_CONFIG} onQuit={onQuit} size={size} />);
  return { ...r, onQuit };
}

describe('App rendering', () => {
  it('lists sessions', () => {
    const { lastFrame } = renderApp(twoSessions());
    expect(lastFrame()).toContain('alpha');
    expect(lastFrame()).toContain('beta');
  });

  it('shows "Terminal too small" below 60 columns or 16 rows', () => {
    expect(renderApp(twoSessions(), { columns: 59, rows: 40 }).lastFrame()).toContain('Terminal too small');
    expect(renderApp(twoSessions(), { columns: 120, rows: 15 }).lastFrame()).toContain('Terminal too small');
    expect(renderApp(twoSessions(), { columns: 60, rows: 16 }).lastFrame()).not.toContain('Terminal too small');
  });

  it('hides the detail pane when rows < 24', () => {
    expect(renderApp(twoSessions(), { columns: 120, rows: 40 }).lastFrame()).toContain('/srv/a-mark');
    expect(renderApp(twoSessions(), { columns: 120, rows: 23 }).lastFrame()).not.toContain('/srv/a-mark');
  });

  it('renders the empty states', () => {
    expect(renderApp(makeSnapshot({ sessions: [] })).lastFrame()).toContain('No Claude Code sessions in the last 24h');
    expect(renderApp(makeSnapshot({ sessions: [], claudeDirFound: false, claudeDir: '/nope' })).lastFrame()).toContain(
      'Claude Code data not found at /nope',
    );
  });
});

describe('App keyboard', () => {
  it('j moves the selection (detail pane follows)', async () => {
    const { lastFrame, stdin } = renderApp(twoSessions());
    expect(lastFrame()).toContain('/srv/a-mark');
    stdin.write('j');
    await delay();
    expect(lastFrame()).toContain('/srv/b-mark');
    expect(lastFrame()).not.toContain('/srv/a-mark');
  });

  it('Enter toggles the detail pane', async () => {
    const { lastFrame, stdin } = renderApp(twoSessions());
    stdin.write('\r');
    await delay();
    expect(lastFrame()).not.toContain('/srv/a-mark');
  });

  it('/ search filters, Esc clears', async () => {
    const { lastFrame, stdin } = renderApp(twoSessions());
    stdin.write('/');
    await delay();
    stdin.write('b');
    await delay();
    stdin.write('e');
    await delay();
    expect(lastFrame()).not.toContain('alpha');
    expect(lastFrame()).toContain('beta');
    stdin.write('\u001B');
    await delay(80);
    expect(lastFrame()).toContain('alpha');
  });

  it('? opens help (table hidden), any key closes it', async () => {
    const { lastFrame, stdin } = renderApp(twoSessions());
    stdin.write('?');
    await delay();
    expect(lastFrame()).not.toContain('alpha');
    stdin.write('x');
    await delay();
    expect(lastFrame()).toContain('alpha');
  });

  it('q and Ctrl-C call onQuit', async () => {
    const a = renderApp(twoSessions());
    a.stdin.write('q');
    await delay();
    expect(a.onQuit).toHaveBeenCalledTimes(1);
    const b = renderApp(twoSessions());
    b.stdin.write('\u0003');
    await delay();
    expect(b.onQuit).toHaveBeenCalledTimes(1);
  });
});
```

These tests assume `DetailPane` prints the session's `cwd`, which spec §6 shows on the detail line's first row. If Task 21's DetailPane shortens long paths, the short fixture paths used here (`/srv/a-mark`) still come through unchanged.

- [ ] **Step 6: Run all App tests**

Run: `npx vitest run src/ui/App.test.tsx`
Expected: PASS (16 tests). If the Esc test is flaky, raise its delay to 150 ms; Ink waits briefly to tell a lone ESC apart from an escape sequence.

- [ ] **Step 7: Typecheck, lint, commit**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

```bash
git add src/ui/App.tsx src/ui/App.test.tsx
git commit -m "feat(ui): add App shell with keyboard navigation, search, help and size guards

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 23: Runtime wiring and CLI entry point

**Files:**
- Create: `src/app/runtime.ts`, `src/cli.tsx`, `test/helpers/claudeDir.ts`
- Test: `src/app/runtime.test.ts`, `src/cli.test.ts`

**Interfaces:**
- Consumes (exact names from earlier tasks):
  - `Store` (Task 18)
  - `App` (Task 22)
  - `parseCliArgs`, `loadConfig`, `ConfigError`, `CliFlags` (Task 4, `src/config/load.ts`); `DEFAULT_CONFIG` (Task 4, `src/config/schema.ts`)
  - `resolveClaudeDir`, `cacheDir`, `findTranscript`, `encodeProjectDir` (Task 2)
  - `parseTranscriptLine` (Task 11)
  - `PricingProvider` (Task 12)
  - `TranscriptTailer` (Task 13)
  - `HistoryScanner` (Task 14)
  - `SessionRegistry` (Task 15)
  - `scanSubagents` (Task 16)
  - `UsagePoller` (Task 17)
  - test builders `assistantLine`, `costStateLine`, `jsonl` (Task 1)
- Produces:
  ```ts
  // src/app/runtime.ts
  export interface Runtime { store: Store; start(): Promise<void>; stop(): void }
  export function createRuntime(opts: { config: Config; claudeDir: string; cacheDir: string; version: string; now?: () => number; fetch?: typeof fetch }): Runtime
  // test/helpers/claudeDir.ts (used by Task 24 too)
  export interface FixtureSession { pid: number; sessionId: string; cwd: string; status?: string; waitingFor?: string; name?: string; lines: string[]; registry?: boolean; mtime?: Date }
  export interface ClaudeFixture { root: string; claudeDir: string; cacheDir: string; transcriptFile(s: FixtureSession): string; registryFile(pid: number): string; cleanup(): Promise<void> }
  export async function makeClaudeDir(sessions: FixtureSession[], opts?: { credentials?: boolean; createClaudeDir?: boolean }): Promise<ClaudeFixture>
  export function makeFakeFetch(o: { usage?: unknown; pricing?: unknown; fail?: boolean }): typeof fetch & { calls: string[] }
  export const PRICING_FIXTURE: Record<string, unknown>
  export function usageFixture(now: number): Record<string, unknown>
  export async function waitFor<T>(fn: () => T | undefined | null | false, timeoutMs?: number, stepMs?: number): Promise<T>
  ```

- [ ] **Step 1: Write the fixture helper `test/helpers/claudeDir.ts`**

```ts
// Builds a temporary Claude config dir (sessions/, projects/, .credentials.json) for runtime tests.
import { mkdtemp, mkdir, writeFile, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeProjectDir } from '../../src/core/paths.js';

export interface FixtureSession {
  pid: number;
  sessionId: string;
  cwd: string;
  status?: string;
  waitingFor?: string;
  name?: string;
  lines: string[];
  /** false → transcript only (history / ended session). Default true. */
  registry?: boolean;
  /** Set transcript mtime (e.g. days ago). */
  mtime?: Date;
}

export interface ClaudeFixture {
  root: string;
  claudeDir: string;
  cacheDir: string;
  transcriptFile(s: FixtureSession): string;
  registryFile(pid: number): string;
  cleanup(): Promise<void>;
}

export async function makeClaudeDir(
  sessions: FixtureSession[],
  opts: { credentials?: boolean; createClaudeDir?: boolean } = {},
): Promise<ClaudeFixture> {
  const root = await mkdtemp(join(tmpdir(), 'ccsb-'));
  const claudeDir = join(root, 'claude');
  const cacheDir = join(root, 'cache');
  await mkdir(cacheDir, { recursive: true });
  const transcriptFile = (s: FixtureSession) =>
    join(claudeDir, 'projects', encodeProjectDir(s.cwd), `${s.sessionId}.jsonl`);
  const registryFile = (pid: number) => join(claudeDir, 'sessions', `${pid}.json`);

  if (opts.createClaudeDir !== false) {
    await mkdir(join(claudeDir, 'sessions'), { recursive: true });
    await mkdir(join(claudeDir, 'projects'), { recursive: true });
    if (opts.credentials !== false) {
      await writeFile(
        join(claudeDir, '.credentials.json'),
        JSON.stringify({ claudeAiOauth: { accessToken: 'test-token', expiresAt: Date.now() + 3_600_000 } }),
      );
    }
    for (const s of sessions) {
      const file = transcriptFile(s);
      await mkdir(join(file, '..'), { recursive: true });
      await writeFile(file, s.lines.length ? s.lines.join('\n') + '\n' : '');
      if (s.mtime) await utimes(file, s.mtime, s.mtime);
      if (s.registry !== false) {
        const now = Date.now();
        await writeFile(
          registryFile(s.pid),
          JSON.stringify({
            pid: s.pid,
            sessionId: s.sessionId,
            cwd: s.cwd,
            startedAt: now - 60_000,
            version: '2.1.296',
            kind: 'interactive',
            ...(s.name ? { name: s.name } : {}),
            status: s.status ?? 'idle',
            ...(s.waitingFor ? { waitingFor: s.waitingFor } : {}),
            updatedAt: now,
            statusUpdatedAt: now,
          }),
        );
      }
    }
  }
  return { root, claudeDir, cacheDir, transcriptFile, registryFile, cleanup: () => rm(root, { recursive: true, force: true }) };
}

/** opus: $5/M in, $25/M out, $6.25/M cache write, $0.50/M cache read. */
export const PRICING_FIXTURE: Record<string, unknown> = {
  'claude-opus-5-5': {
    input_cost_per_token: 0.000005,
    output_cost_per_token: 0.000025,
    cache_creation_input_token_cost: 0.00000625,
    cache_read_input_token_cost: 0.0000005,
    max_input_tokens: 200_000,
  },
};

export function usageFixture(now: number): Record<string, unknown> {
  return {
    five_hour: { utilization: 58, resets_at: new Date(now + 2 * 3_600_000).toISOString() },
    seven_day: { utilization: 31, resets_at: new Date(now + 3 * 86_400_000).toISOString() },
  };
}

export function makeFakeFetch(o: { usage?: unknown; pricing?: unknown; fail?: boolean }): typeof fetch & { calls: string[] } {
  const calls: string[] = [];
  const fn = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    if (o.fail) throw new TypeError('fetch failed');
    const body = url.includes('oauth/usage') ? o.usage : url.includes('litellm') ? o.pricing : undefined;
    if (body === undefined) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch & { calls: string[] };
  fn.calls = calls;
  return fn;
}

export async function waitFor<T>(
  fn: () => T | undefined | null | false,
  timeoutMs = 8_000,
  stepMs = 50,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > deadline) throw new Error(`waitFor timed out after ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, stepMs));
  }
}
```

- [ ] **Step 2: Write the failing runtime test `src/app/runtime.test.ts`**

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { createRuntime, type Runtime } from './runtime.js';
import { DEFAULT_CONFIG } from '../config/schema.js';
import { assistantLine } from '../../test/helpers/transcript.js';
import {
  makeClaudeDir,
  makeFakeFetch,
  PRICING_FIXTURE,
  usageFixture,
  waitFor,
  type ClaudeFixture,
} from '../../test/helpers/claudeDir.js';

let rt: Runtime | undefined;
let fx: ClaudeFixture | undefined;
afterEach(async () => {
  rt?.stop();
  await fx?.cleanup();
  rt = undefined;
  fx = undefined;
});

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

describe('createRuntime', () => {
  it('discovers a live session, tails its transcript (deduped), prices it and loads limits', async () => {
    const usage = { input_tokens: 1000, output_tokens: 2000 };
    fx = await makeClaudeDir([
      {
        pid: process.pid,
        sessionId: 'sess-live',
        cwd: '/work/proj',
        name: 'live-one',
        status: 'waiting',
        waitingFor: 'input needed',
        // one API response split across two lines → must count once
        lines: [
          assistantLine({ id: 'm1', requestId: 'r1', ts: iso(60_000), usage }),
          assistantLine({ id: 'm1', requestId: 'r1', ts: iso(60_000), usage }),
        ],
      },
    ]);
    rt = createRuntime({
      config: { ...DEFAULT_CONFIG, refreshMs: 250 },
      claudeDir: fx.claudeDir,
      cacheDir: fx.cacheDir,
      version: '0.1.0-test',
      fetch: makeFakeFetch({ usage: usageFixture(Date.now()), pricing: PRICING_FIXTURE }),
    });
    await rt.start();
    const store = rt.store;

    const s = await waitFor(() =>
      store.getSnapshot().sessions.find((x) => x.sessionId === 'sess-live' && x.tokens.output > 0 && x.costUSD !== null),
    );
    expect(s).toMatchObject({ live: true, status: 'waiting', waitingFor: 'input needed', name: 'live-one' });
    expect(s.tokens.input).toBe(1000);
    expect(s.tokens.output).toBe(2000);
    expect(s.costUSD).toBeCloseTo(0.055, 6); // 1000×5e-6 + 2000×25e-6

    const snap = await waitFor(() => {
      const x = store.getSnapshot();
      return x.limits.status === 'ok' ? x : undefined;
    });
    expect(snap.limits.block?.percent).toBe(58);
    expect(snap.limits.weekly?.percent).toBe(31);
    expect(snap.pricingStatus).toBe('ok');
  });

  it('stop() is idempotent', async () => {
    fx = await makeClaudeDir([]);
    rt = createRuntime({
      config: DEFAULT_CONFIG,
      claudeDir: fx.claudeDir,
      cacheDir: fx.cacheDir,
      version: '0.1.0-test',
      fetch: makeFakeFetch({ fail: true }),
    });
    await rt.start();
    rt.stop();
    expect(() => rt?.stop()).not.toThrow();
  });
});
```

Run: `npx vitest run src/app/runtime.test.ts`
Expected: FAIL with `Failed to resolve import "./runtime.js"`.

- [ ] **Step 3: Implement `src/app/runtime.ts`**

```ts
// Wires collectors to the Store. All IO lives in collectors; this file only routes events.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Config, RegistryEntry } from '../domain/types.js';
import { Store } from '../store/store.js';
import { findTranscript } from '../core/paths.js';
import { parseTranscriptLine } from '../collectors/transcriptParser.js';
import { PricingProvider } from '../collectors/pricing.js';
import { TranscriptTailer } from '../collectors/transcriptTailer.js';
import { HistoryScanner } from '../collectors/historyScanner.js';
import { SessionRegistry } from '../collectors/sessionRegistry.js';
import { scanSubagents } from '../collectors/subagents.js';
import { UsagePoller } from '../collectors/usageApi.js';

export interface Runtime {
  store: Store;
  start(): Promise<void>;
  stop(): void;
}

export interface RuntimeOptions {
  config: Config;
  claudeDir: string;
  cacheDir: string;
  version: string;
  now?: () => number;
  fetch?: typeof fetch;
}

const AGENT_SCAN_MS = 5_000;
const PRICING_RELOAD_MS = 6 * 3_600_000; // load() itself honours the 24h TTL

interface TrackedFile {
  sessionId: string;
  isSubagent: boolean;
}

export function createRuntime(opts: RuntimeOptions): Runtime {
  const { config, claudeDir, cacheDir, version } = opts;
  const now = opts.now ?? Date.now;
  const fetchDep = opts.fetch ? { fetch: opts.fetch } : {};

  const store = new Store({
    now,
    refreshMs: config.refreshMs,
    endedWindowHours: config.endedWindowHours,
    claudeDir,
    claudeDirFound: existsSync(claudeDir),
  });

  const files = new Map<string, TrackedFile>();
  const live = new Map<string, RegistryEntry>();
  /** sessionId → main transcript path, once found. */
  const mainTranscript = new Map<string, string>();
  const timers: NodeJS.Timeout[] = [];
  let stopped = false;

  const tailer = new TranscriptTailer({
    onLines: (file, lines) => {
      const t = files.get(file);
      if (!t) return;
      const events = lines.flatMap((l) =>
        parseTranscriptLine(l, { sessionId: t.sessionId, forceSidechain: t.isSubagent }),
      );
      if (events.length) store.applyEvents(t.sessionId, events);
    },
  });

  const track = (file: string, sessionId: string, isSubagent: boolean) => {
    if (files.has(file)) return;
    files.set(file, { sessionId, isSubagent });
    tailer.add(file);
  };

  const attachTranscript = async (e: RegistryEntry) => {
    if (mainTranscript.has(e.sessionId)) return;
    const path = await findTranscript(claudeDir, e.cwd, e.sessionId);
    if (!path || stopped || !live.has(e.sessionId)) return;
    mainTranscript.set(e.sessionId, path);
    track(path, e.sessionId, false);
  };

  const scanAgents = async () => {
    for (const e of live.values()) {
      const main = mainTranscript.get(e.sessionId);
      if (!main) {
        await attachTranscript(e); // transcript may not exist yet right after startup
        continue;
      }
      const dir = join(dirname(main), e.sessionId, 'subagents');
      const activity = await scanSubagents(dir, now());
      store.setAgents(e.sessionId, { activeCount: activity.activeCount, names: activity.names });
      for (const f of activity.files) track(f, e.sessionId, true);
    }
    store.setClaudeDirFound(existsSync(claudeDir));
  };

  const registry = new SessionRegistry({
    claudeDir,
    onUpsert: (e) => {
      store.upsertRegistry(e);
      const known = live.has(e.sessionId);
      live.set(e.sessionId, e);
      if (!known) void attachTranscript(e);
    },
    onEnded: (sessionId) => {
      store.markEnded(sessionId);
      live.delete(sessionId);
      mainTranscript.delete(sessionId);
      for (const [file, t] of files) {
        if (t.sessionId === sessionId) {
          tailer.remove(file);
          files.delete(file);
        }
      }
    },
  });

  const pricing = new PricingProvider({ cacheDir, deps: { ...fetchDep, now } });
  const loadPricing = async () => {
    const r = await pricing.load();
    if (!stopped) store.setPricing(r.lookup, r.status);
  };

  const scanner = new HistoryScanner({
    claudeDir,
    cacheDir,
    deps: { now },
    onEvents: (sessionId, events) => store.applyEvents(sessionId, events),
    onProgress: (p) => store.setScanProgress(p),
  });

  const poller = new UsagePoller({
    claudeDir,
    intervalSeconds: config.usagePollSeconds,
    version,
    enabled: config.usageApi,
    deps: { ...fetchDep, now },
    onUpdate: (l) => store.setLimits(l),
  });

  return {
    store,
    async start() {
      store.start();
      tailer.start();
      poller.start();
      void scanner.run().catch(() => store.setScanProgress({ done: true, filesDone: 0, filesTotal: 0 }));
      timers.push(setInterval(() => void scanAgents().catch(() => undefined), AGENT_SCAN_MS));
      timers.push(setInterval(() => void loadPricing().catch(() => undefined), PRICING_RELOAD_MS));
      await Promise.all([loadPricing().catch(() => store.setPricing(null, 'unavailable')), registry.scanOnce()]);
      registry.start();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      for (const t of timers) clearInterval(t);
      registry.stop();
      tailer.stop();
      poller.stop();
      store.stop();
    },
  };
}
```

`store.applyEvents` deduplicates `usage` records globally (Task 18). That's why the history scanner and the tailer can both read the same live transcript from offset 0 without double counting (Review Focus #2).

- [ ] **Step 4: Run the runtime tests**

Run: `npx vitest run src/app/runtime.test.ts`
Expected: PASS (2 tests). If the first test times out, the tailer's default poll and registry scan are the slow part. Check that `registry.scanOnce()` resolves before `start()` returns and that `TranscriptTailer.start()` triggers an immediate `pollOnce()`.

- [ ] **Step 5: Write the failing CLI tests `src/cli.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };

function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, ['--import', 'tsx', 'src/cli.tsx', ...args], { timeout: 15_000 }, (err, stdout, stderr) => {
      const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0;
      resolve({ code, stdout, stderr });
    });
  });
}

describe('cli', () => {
  it('--version prints the package version', async () => {
    const r = await runCli(['--version']);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe(pkg.version);
  });

  it('--help prints usage with key flags', async () => {
    const r = await runCli(['--help']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Usage: ccstatusboard');
    expect(r.stdout).toContain('--no-usage-api');
  });

  it('invalid config prints an error and exits 1', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ccsb-cfg-'));
    const cfg = join(dir, 'config.json');
    await writeFile(cfg, JSON.stringify({ theme: 'neon' }));
    const r = await runCli(['--config', cfg]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('ccstatusboard:');
  });

  it('refuses to run without an interactive terminal', async () => {
    const r = await runCli([]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('needs an interactive terminal');
  });
});
```

Run: `npx vitest run src/cli.test.ts`
Expected: FAIL (`src/cli.tsx` does not exist, so the process exits non-zero with a module-not-found error).

- [ ] **Step 6: Implement `src/cli.tsx`**

```tsx
import React from 'react';
import { readFileSync } from 'node:fs';
import { render, type Instance } from 'ink';
import { ConfigError, loadConfig, parseCliArgs } from './config/load.js';
import { cacheDir, resolveClaudeDir } from './core/paths.js';
import { createRuntime, type Runtime } from './app/runtime.js';
import { App } from './ui/App.js';

// dist/cli.js and src/cli.tsx are both one level below package.json.
const VERSION = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
).version;

const HELP = `Usage: ccstatusboard [options]

htop-style dashboard for all Claude Code sessions, usage limits and costs.

Options:
  --theme <name>        default | mono | dracula | solarized
  --refresh <ms>        UI refresh interval (default 1000, min 250)
  --ended-hours <n>     show ended sessions from the last n hours (default 24)
  --sort <key>          status | activity | cost | ctx | name
  --claude-dir <path>   Claude Code config dir (default $CLAUDE_CONFIG_DIR or ~/.claude)
  --no-usage-api        do not call the Anthropic usage API (limits show "disabled")
  --config <path>       config file (default ~/.config/ccstatusboard/config.json)
  --version             print version
  --help                print this help

Keys: ↑↓/jk select  ⏎ detail  s sort  f filter  / search  ? help  q quit
`;

const ENTER_ALT = '\u001b[?1049h\u001b[H';
const LEAVE_ALT = '\u001b[?1049l';

async function main(argv: string[]): Promise<number | undefined> {
  let parsed: ReturnType<typeof parseCliArgs>;
  try {
    parsed = parseCliArgs(argv);
  } catch (err) {
    process.stderr.write(`ccstatusboard: ${(err as Error).message}\nRun 'ccstatusboard --help' for usage.\n`);
    return 1;
  }
  if (parsed.version) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  if (parsed.help) {
    process.stdout.write(HELP);
    return 0;
  }

  let config;
  try {
    config = await loadConfig({ flags: parsed.flags });
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`ccstatusboard: ${err.message}\n`);
      return 1;
    }
    throw err;
  }

  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    process.stderr.write('ccstatusboard needs an interactive terminal (TTY).\n');
    return 1;
  }

  const claudeDir = resolveClaudeDir({ flag: parsed.flags.claudeDir ?? null, config: config.claudeDir });
  const runtime: Runtime = createRuntime({ config, claudeDir, cacheDir: cacheDir(), version: VERSION });

  let instance: Instance | undefined;
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    runtime.stop();
    instance?.unmount();
    process.stdout.write(LEAVE_ALT);
  };
  const shutdown = (code: number) => {
    restore();
    process.exit(code);
  };
  const crash = (err: unknown) => {
    restore();
    process.stderr.write(`ccstatusboard crashed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
    process.exit(1);
  };

  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));
  process.on('uncaughtException', crash);
  process.on('unhandledRejection', crash);

  process.stdout.write(ENTER_ALT);
  instance = render(<App store={runtime.store} config={config} onQuit={() => shutdown(0)} />, {
    exitOnCtrlC: false,
  });
  await runtime.start(); // render first so the loading state is visible immediately
  return undefined; // keep running until quit
}

main(process.argv.slice(2)).then(
  (code) => {
    if (code !== undefined) process.exit(code);
  },
  (err: unknown) => {
    process.stdout.write(LEAVE_ALT);
    process.stderr.write(`ccstatusboard: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  },
);
```

If Task 4's `loadConfig` already folds `flags.claudeDir` into `config.claudeDir`, the `resolveClaudeDir` call still gives the same result, because it lets the flag win.

- [ ] **Step 7: Run CLI tests**

Run: `npx vitest run src/cli.test.ts`
Expected: PASS (4 tests). Vitest runs with piped stdio, so the TTY test exercises the non-interactive guard.

- [ ] **Step 8: Build and verify manually**

Run: `npm run build && node dist/cli.js --version`
Expected: prints `0.1.0`.

Manual check, with 2 or more real Claude Code sessions open in other terminals:
1. Run `node dist/cli.js` in a separate terminal. The alt screen opens and the header shows the live count.
2. In one session, send a prompt. Its row changes ○ → ◐ while it works, then ● (waiting) or ○ within about 2 s.
3. Compare the 5h and Week meters with Claude Code's `/usage`. They should match.
4. Compare the session's CTX % with `/context`, which should be within ±2 points.
5. Press `q`. The terminal returns to its previous contents with no stray output. Run it again and press Ctrl-C: same result. Run it again and send `kill -TERM <pid>`: same result.
6. Run `node dist/cli.js --claude-dir /nonexistent`. It shows `Claude Code data not found at /nonexistent`.

- [ ] **Step 9: Full checks and commit**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all pass.

```bash
git add src/app/runtime.ts src/app/runtime.test.ts src/cli.tsx src/cli.test.ts test/helpers/claudeDir.ts
git commit -m "feat: wire collectors into runtime and add CLI entry with alt screen and clean shutdown

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 24: Integration tests, README, package smoke test

**Files:**
- Create: `test/integration/runtime.test.ts`, `README.md`
- Modify: none (unless a test exposes a defect, in which case fix it in the module that owns it)

**Interfaces:**
- Consumes: `createRuntime` (Task 23); `makeClaudeDir`, `makeFakeFetch`, `PRICING_FIXTURE`, `usageFixture`, `waitFor` (Task 23, `test/helpers/claudeDir.ts`); `assistantLine`, `costStateLine` (Task 1); `DEFAULT_CONFIG` (Task 4).
- Produces: nothing consumed by other tasks.

- [ ] **Step 1: Write the integration tests `test/integration/runtime.test.ts`**

```ts
// End-to-end: temp CLAUDE_CONFIG_DIR + fake network → real collectors → Store snapshot (spec §9).
import { afterEach, describe, expect, it } from 'vitest';
import { appendFile, rm } from 'node:fs/promises';
import { createRuntime, type Runtime } from '../../src/app/runtime.js';
import { DEFAULT_CONFIG } from '../../src/config/schema.js';
import type { Config } from '../../src/domain/types.js';
import { assistantLine, costStateLine } from '../helpers/transcript.js';
import {
  makeClaudeDir,
  makeFakeFetch,
  PRICING_FIXTURE,
  usageFixture,
  waitFor,
  type ClaudeFixture,
  type FixtureSession,
} from '../helpers/claudeDir.js';

const HOUR = 3_600_000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const usage = { input_tokens: 1000, output_tokens: 2000 };

let rt: Runtime | undefined;
let fx: ClaudeFixture | undefined;
afterEach(async () => {
  rt?.stop();
  await fx?.cleanup();
  rt = undefined;
  fx = undefined;
});

async function boot(
  sessions: FixtureSession[],
  o: { fetch?: ReturnType<typeof makeFakeFetch>; config?: Partial<Config>; credentials?: boolean; createClaudeDir?: boolean } = {},
) {
  fx = await makeClaudeDir(sessions, { credentials: o.credentials, createClaudeDir: o.createClaudeDir });
  rt = createRuntime({
    config: { ...DEFAULT_CONFIG, refreshMs: 250, ...o.config },
    claudeDir: fx.claudeDir,
    cacheDir: fx.cacheDir,
    version: '0.1.0-test',
    fetch: o.fetch ?? makeFakeFetch({ usage: usageFixture(Date.now()), pricing: PRICING_FIXTURE }),
  });
  await rt.start();
  return { fx, store: rt.store };
}

const liveSession = (lines: string[]): FixtureSession => ({
  pid: process.pid,
  sessionId: 'live',
  cwd: '/work/live',
  status: 'busy',
  lines,
});

describe('runtime integration', () => {
  it('aggregates live + history, updates on append, and ends a session when its registry file goes', async () => {
    const live = liveSession([assistantLine({ id: 'a1', ts: iso(10 * 60_000), usage })]);
    const recent: FixtureSession = {
      pid: 999_999_1,
      sessionId: 'recent',
      cwd: '/work/recent',
      registry: false,
      lines: [assistantLine({ id: 'r1', ts: iso(2 * HOUR), usage })],
    };
    const old: FixtureSession = {
      pid: 999_999_2,
      sessionId: 'old',
      cwd: '/work/old',
      registry: false,
      mtime: new Date(Date.now() - 3 * 24 * HOUR),
      lines: [assistantLine({ id: 'o1', ts: iso(3 * 24 * HOUR), usage })],
    };
    const { fx, store } = await boot([live, recent, old]);

    // history scan completes; the 'old' session is outside the 24h ended window but inside the week
    const snap = await waitFor(() => {
      const s = store.getSnapshot();
      return s.scan.done && s.pricingStatus === 'ok' && s.sessions.some((x) => x.sessionId === 'live' && x.tokens.output > 0)
        ? s
        : undefined;
    });
    const ids = snap.sessions.map((s) => s.sessionId).sort();
    expect(ids).toEqual(['live', 'recent']);
    expect(snap.sessions.find((s) => s.sessionId === 'recent')).toMatchObject({ live: false, status: 'ended' });
    expect(snap.sessions.find((s) => s.sessionId === 'live')).toMatchObject({ live: true, status: 'busy' });
    expect(snap.costs.week.costUSD ?? 0).toBeGreaterThan(snap.costs.today.costUSD ?? 0);
    expect(snap.costs.today.costUSD).toBeCloseTo(0.11, 6); // live + recent, 0.055 each

    // appending a new response is picked up by the tailer
    await appendFile(fx.transcriptFile(live), assistantLine({ id: 'a2', ts: iso(1_000), usage }) + '\n');
    const after = await waitFor(() =>
      store.getSnapshot().sessions.find((x) => x.sessionId === 'live' && x.tokens.output === 4000),
    );
    expect(after.costUSD).toBeCloseTo(0.11, 6);

    // registry file removed → session ends (registry polls every 2s)
    await rm(fx.registryFile(process.pid));
    const ended = await waitFor(
      () => store.getSnapshot().sessions.find((x) => x.sessionId === 'live' && !x.live),
      12_000,
    );
    expect(ended.status).toBe('ended');
  }, 20_000);

  it('offline: limits error, pricing unavailable, costs "—", session falls back to cost-state ≈', async () => {
    const { store } = await boot(
      [liveSession([assistantLine({ id: 'a1', ts: iso(60_000), usage }), costStateLine(1.23, iso(60_000))])],
      { fetch: makeFakeFetch({ fail: true }) },
    );
    const snap = await waitFor(() => {
      const s = store.getSnapshot();
      return s.limits.status === 'error' && s.pricingStatus === 'unavailable' && s.sessions[0]?.costUSD != null ? s : undefined;
    });
    expect(snap.costs.today.costUSD).toBeNull();
    expect(snap.sessions[0]).toMatchObject({ costUSD: 1.23, costApprox: true });
  });

  it('--no-usage-api → limits disabled and no usage request is made', async () => {
    const fetch = makeFakeFetch({ usage: usageFixture(Date.now()), pricing: PRICING_FIXTURE });
    const { store } = await boot([], { fetch, config: { usageApi: false } });
    await waitFor(() => store.getSnapshot().limits.status === 'disabled');
    expect(fetch.calls.some((u) => u.includes('oauth/usage'))).toBe(false);
  });

  it('missing credentials → limits no-credentials', async () => {
    const { store } = await boot([], { credentials: false });
    await waitFor(() => store.getSnapshot().limits.status === 'no-credentials');
  });

  it('missing Claude dir → claudeDirFound false and no sessions', async () => {
    const { store } = await boot([], { createClaudeDir: false });
    const s = store.getSnapshot();
    expect(s.claudeDirFound).toBe(false);
    expect(s.sessions).toEqual([]);
  });
});
```

The two history fixtures use made-up PIDs and have no registry file, so liveness is never checked for them.

- [ ] **Step 2: Run the integration tests**

Run: `npx vitest run test/integration/runtime.test.ts`
Expected: PASS (5 tests). Each failure points at the module that owns it:
- Duplicate cost: Task 18 dedup.
- `old` listed: Task 18 ended-window filter.
- `recent` missing: Task 14 scanner or Task 18 history sessions.
- Never ends: Task 15 `onEnded`.

Fix it in that module, keeping its unit tests green, then re-run.

- [ ] **Step 3: Write `README.md`**

````markdown
# ccstatusboard

An htop-style terminal dashboard for **all** your Claude Code sessions: usage limits, estimated costs, and what every session is doing right now.

[ccstatusline](https://github.com/sirmalloc/ccstatusline) shows a statusline *inside* one Claude Code session. ccstatusboard runs in its own terminal window and watches every session on the machine.

```
 ccstatusboard  ·  5 live / 3 ended  ·  14:32:07
╭─ Usage ──────────────────────────────────────────────────────────────╮
│ 5h    [||||||||||||||||||||          58%]  resets 2h14m   block $12.40 │
│ Week  [|||||||||                     31%]  resets Thu 09:00 week $96.10│
│ burn  $4.10/h   24h ▁▂▃▅▇▆▅▃▂▃▅▆▇▅▃▂▁▁▂▃▅▆▇▆            month $412.75 │
╰──────────────────────────────────────────────────────────────────────╯
╭─ Sessions ───────────────────────────────────────────────────────────╮
│ ●    ccstatusboard   opus-5.5  main    ███████░░░ 61%   $4.20   now   │
│ ◐ 2  power-tools     sonnet    feat/x  ██░░░░░░░░ 22%   $1.10   3s    │
╰──────────────────────────────────────────────────────────────────────╯
```

## Install

Requires Node.js 22+ on Linux or macOS.

```bash
npx ccstatusboard          # run once
npm i -g ccstatusboard     # or install globally
ccstatusboard
```

## What it shows

- **Limits:** current 5-hour block %, weekly %, per-model weekly %, with reset countdowns. Same source as Claude Code's `/usage`.
- **Estimated cost (USD):** current block, today, this week, this month. Burn rate ($/h) and a 24-hour sparkline.
- **Sessions:** ● waiting for you (and why), ◐ working (with active subagent count), ○ idle, · ended in the last 24h (dimmed). Each row shows model, git branch, context-window fill, cost, last activity and uptime.
- **Detail pane:** token breakdown, per-model cost, active agents, cwd, permission mode, Claude Code version.

## Keys

| Key | Action |
|---|---|
| `↑` `↓` / `j` `k` | Move selection |
| `g` / `G` | Top / bottom |
| `⏎` | Toggle detail pane |
| `s` | Cycle sort: status → activity → cost → ctx → name |
| `f` | Filter: all / live only |
| `/` | Search by name or path (`Esc` clears) |
| `?` / `F1` | Help |
| `q` / `Ctrl-C` | Quit |

## Options

```
--theme <name>        default | mono | dracula | solarized
--refresh <ms>        UI refresh interval (default 1000, min 250)
--ended-hours <n>     show ended sessions from the last n hours (default 24)
--sort <key>          status | activity | cost | ctx | name
--claude-dir <path>   Claude Code config dir (default $CLAUDE_CONFIG_DIR or ~/.claude)
--no-usage-api        don't call the Anthropic usage API
--config <path>       config file path
--version, --help
```

## Config file

`~/.config/ccstatusboard/config.json` (or `$XDG_CONFIG_HOME/ccstatusboard/config.json`). Every key is optional. Command-line flags override it.

```json
{
  "theme": "default",
  "refreshMs": 1000,
  "usagePollSeconds": 60,
  "endedWindowHours": 24,
  "columns": ["status", "name", "model", "branch", "ctx", "cost", "last", "uptime"],
  "sort": "status",
  "showDetail": true,
  "claudeDir": null
}
```

## Where the data comes from

| Data | Source |
|---|---|
| Running sessions & status | `~/.claude/sessions/<pid>.json`, checked against the live process table |
| Tokens, model, branch, context | Session transcripts in `~/.claude/projects/**.jsonl` (tailed incrementally) |
| Today / week / month totals | A startup scan of transcripts from the last 35 days, cached in `~/.cache/ccstatusboard/` |
| 5h / weekly limits | Anthropic's OAuth usage endpoint (the one ccstatusline and Claude Code's `/usage` use), polled every 60 s |
| Prices | [LiteLLM's pricing table](https://github.com/BerriAI/litellm), cached for 24 h |

Costs are **estimates** based on API list prices. On a Pro/Max subscription you are not billed these amounts.

## Privacy & safety

- **Read-only.** ccstatusboard never writes inside `~/.claude`. Its only writes are its own caches in `~/.cache/ccstatusboard/`.
- It reads your Claude Code OAuth access token (from `~/.claude/.credentials.json`, or the macOS Keychain entry `Claude Code-credentials`) **only** to call Anthropic's usage endpoint. It never refreshes, stores or sends the token anywhere else. Use `--no-usage-api` to turn this off.
- It never opens the per-session `*.key` files.
- The only network requests are `api.anthropic.com` (usage) and `raw.githubusercontent.com` (LiteLLM prices).

## Caveats

The session registry, transcript format and usage endpoint are **undocumented Claude Code internals**, verified against Claude Code 2.1.x. A future Claude Code release may change them. ccstatusboard skips records it can't parse and shows `⚠ untested Claude Code vX` when it sees an unverified version. Please open an issue if something looks wrong.

## Development

```bash
npm install
npm run dev        # run from source (tsx)
npm test           # vitest
npm run typecheck
npm run lint
npm run build      # tsup → dist/cli.js
```

## License

MIT
````

- [ ] **Step 4: Build, pack and run the smoke test**

Run:
```bash
npm run build && npm pack && npx --yes ./ccstatusboard-0.1.0.tgz --version
```
Expected: the last line printed is `0.1.0`.

Run: `tar -tzf ccstatusboard-0.1.0.tgz`
Expected: only `package/package.json`, `package/README.md`, `package/LICENSE`, `package/dist/cli.js`, `package/dist/cli.js.map`. No `src/`, `test/` or `docs/`.

Run: `rm ccstatusboard-0.1.0.tgz` (`*.tgz` is gitignored anyway).

- [ ] **Step 5: Final verification against the spec's success criteria**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all green.

Then, with 2 or more real Claude Code sessions running, run `node dist/cli.js` in a separate terminal and check each item:
- [ ] Start a new `claude` session: it appears within 2 s. Exit it: it becomes `·` ended (dimmed) within about 2 s.
- [ ] 5h and Week % equal Claude Code's `/usage`.
- [ ] A session's CTX % is within ±2 points of `/context` in that session.
- [ ] Today's cost is within about 5% of `npx ccusage daily` for today.
- [ ] With a large `~/.claude/projects`, the first frame appears in under 3 s. The cost row shows `scanning n/m…` while the history scan runs and fills in progressively.
- [ ] Run `ls -la --time-style=full-iso ~/.claude/sessions ~/.claude/projects` before and after a run. ccstatusboard changed nothing (it never writes under the Claude dir).
- [ ] Offline (e.g. `unshare -rn node dist/cli.js` on Linux, or wifi off): the limits panel shows `stale …`, `error` or `login required`, the cost row shows cached or `—` values, and the UI keeps working.
- [ ] Resize the terminal down past 60×16: `Terminal too small`. Resize back: it recovers. Below 24 rows the detail pane hides.
- [ ] `q`, Ctrl-C and `kill -TERM` all restore the terminal cleanly.

- [ ] **Step 6: Commit**

```bash
git add test/integration/runtime.test.ts README.md
git commit -m "test: add end-to-end runtime integration tests; docs: write README

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

