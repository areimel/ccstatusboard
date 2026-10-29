# ccstatusboard — Design Spec

- **Date:** 2026-10-11
- **Status:** Draft for review
- **Author:** Alec Reimel (with Claude)

## 1. Purpose

[ccstatusline](https://github.com/sirmalloc/ccstatusline) renders a statusline *inside* a single Claude Code session. **ccstatusboard** is a standalone terminal dashboard (htop/ntop-style) that runs in its own terminal window and monitors **every** Claude Code session on the machine.

At a glance it answers, in priority order:

1. **How much of my usage have I burned?** 5-hour block %, weekly %, per-model weekly %, and estimated USD cost for the current block, today, this week and this month.
2. **What are my sessions doing?** Which are waiting on me, which are working, which are idle, how full each context window is.

### Success criteria
- Shows all live Claude Code sessions within 2s of them starting/ending.
- 5h / weekly % match Claude Code's `/usage` (same source).
- Per-session context % within ±2 percentage points of Claude Code's own figure.
- Today's estimated cost within ~5% of `ccusage daily`.
- Startup to first full render < 3s with ~1 GB of transcripts (history scan may finish progressively).
- Never writes to `~/.claude`, never refreshes OAuth tokens, never reads secret key files.

### Non-goals (v1)
- Acting on sessions (focusing terminals, sending input, killing).
- Desktop notifications.
- In-app config editor.
- Windows support.
- Non-Claude agents (Codex, Gemini, …).
- Persisting history across restarts beyond small caches.

## 2. Decisions

| Topic | Decision |
|---|---|
| Stack | Node ≥ 22, TypeScript (strict), ESM, **Ink 7.1.x + React 19.2.x** |
| Add-ons | `@inkjs/ui` (theme, ProgressBar, Badge, Spinner), `@pppp606/ink-chart` (Sparkline, BarChart; exact-pinned), `@mishieck/ink-titled-box` (titled panel borders), `ink-gradient` (header) |
| Other deps | `zod` (config/API validation). Arg parsing via `node:util` `parseArgs`. No chokidar (use `fs.watch` + polling). |
| Build/test | `tsup` → `dist/cli.js` with shebang; `vitest`; `ink-testing-library`; `tsc --noEmit` typecheck; ESLint + Prettier |
| Distribution | npm package `ccstatusboard`, `bin: { ccstatusboard: dist/cli.js }` |
| Platforms | Linux and macOS |
| Limits source | Anthropic OAuth usage API (read-only) |
| Pricing source | LiteLLM pricing JSON, cached on disk 24h |
| Architecture | Single process; collectors → in-memory store → Ink UI |
| Interaction | Navigable, read-only |
| Session scope | Live + ended within last 24h (configurable) |
| Layout | Stacked panels, htop-style meters |

## 3. Data sources

All Claude Code file formats below are **undocumented internals** observed in Claude Code 2.1.296. Every parser validates defensively, skips unparseable records, and never crashes the UI. Claude config dir = `$CLAUDE_CONFIG_DIR` if set, else `~/.claude`.

### 3.1 Session registry — `<claude>/sessions/<pid>.json`
One file per running Claude Code process:

```json
{ "pid": 2203789, "sessionId": "340f…", "cwd": "/abs/path",
  "startedAt": 1791730405569, "procStart": "9402548", "version": "2.1.296",
  "kind": "interactive", "entrypoint": "cli", "name": "ccstatusboard-6f",
  "status": "waiting", "waitingFor": "input needed",
  "updatedAt": 1791730911305, "statusUpdatedAt": 1791730911305 }
```

- `status` ∈ `busy | idle | waiting`; `waitingFor` (only when waiting) e.g. `input needed`, `dialog open`, `sandbox request`, `goal proposal`. Unknown values display verbatim.
- Times are epoch ms.
- Only `*.json` files are read. `*.key` files in the same directory are **never** opened.
- **Liveness:** `process.kill(pid, 0)` succeeds (EPERM also counts as alive). On Linux additionally require `/proc/<pid>/stat` field 22 === `procStart`, so a reused PID is ignored. If the check fails the session is treated as ended.

### 3.2 Transcripts — `<claude>/projects/<encoded-cwd>/<sessionId>.jsonl`
- `encoded-cwd` = absolute cwd with every char matching `[^A-Za-z0-9]` replaced by `-`. If not found, fall back to a glob over `projects/*/<sessionId>.jsonl`.
- Relevant record types:
  - `assistant`: `message.id`, `requestId`, `message.model`, `message.usage.{input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, cache_creation.ephemeral_5m_input_tokens, cache_creation.ephemeral_1h_input_tokens}`, `timestamp`, `gitBranch`, `isSidechain`, `cwd`.
  - `system` with `subtype: "compact_boundary"`: `compactMetadata.postTokens`.
  - `cost-state`: `totalCostUSD`, `modelUsage` (Claude Code's own running totals; fallback only).
  - `ai-title` (`aiTitle`), `agent-name` (`agentName`), `permission-mode` (`permissionMode`).
- **Dedup rule:** one API response is written as several lines sharing `message.id` and repeating `usage`. A usage record is counted once per key `message.id + ":" + requestId` (or `message.id` alone if `requestId` is missing). Lines with no `message.id` aren't counted.
- Synthetic/zero-usage assistant lines (all usage fields 0 or model `<synthetic>`) are ignored.

### 3.3 Subagent transcripts — `<claude>/projects/<enc>/<sessionId>/subagents/agent-*.jsonl`
- Their usage counts toward that session's and the global totals (same dedup rule).
- A subagent file modified in the last 30s counts as an **active agent**. Registry `status` only covers the main thread, so a session with active agents shows as `busy (N agents)` even if the registry says idle/waiting. The registry's `waiting` still wins visually, because the user is needed.

### 3.4 Usage limits — Anthropic OAuth usage API
- **Credentials (read-only):**
  - Linux/macOS: `<claude>/.credentials.json` → `claudeAiOauth.accessToken`, `claudeAiOauth.expiresAt` (epoch ms).
  - macOS fallback: `security find-generic-password -s "Claude Code-credentials" -w` (2s timeout), parsing the same JSON.
  - Never refresh or write tokens. If `expiresAt < now`, report `expired`.
- **Request:** `GET https://api.anthropic.com/api/oauth/usage` with headers `Authorization: Bearer <token>`, `anthropic-beta: oauth-2025-04-20`, `User-Agent: ccstatusboard/<version>`. 5s timeout.
- **Response (validated with zod `looseObject`):**
  - Legacy flat buckets: `five_hour`, `seven_day`, `seven_day_sonnet`, `seven_day_opus` → `{ utilization: number (0–100), resets_at: ISO string }`.
  - Newer `limits[]`: `{ kind, percent, resets_at, scope?.model?.display_name }` with `kind` ∈ `session` (5h), `weekly_all`, `weekly_scoped` (per-model).
  - Precedence: flat bucket first, then the `limits[]` equivalent. Entries with `percent 0` and no `resets_at` (and no model scope) are placeholders and are ignored.
  - `extra_usage` `{ is_enabled, monthly_limit, used_credits, utilization, currency }` (cents) is shown if enabled.
- **Polling:** every 60s (configurable, min 30s). On HTTP 429 honor `Retry-After` (default 300s). Other errors back off exponentially from 60s to a 10-minute cap. The last good value is kept and marked stale with its age.

### 3.5 Pricing — LiteLLM
- URL: `https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json`.
- Cached at `~/.cache/ccstatusboard/pricing.json` (`$XDG_CACHE_HOME` respected; macOS `~/Library/Caches/ccstatusboard`), refreshed when older than 24h. Network failure falls back to the stale cache.
- Used fields per model: `input_cost_per_token`, `output_cost_per_token`, `cache_creation_input_token_cost`, `cache_read_input_token_cost`, optional `cache_creation_input_token_cost_above_1hr`, `max_input_tokens`.
- **Model lookup:** exact id, then `anthropic/<id>`, then the id with a trailing date suffix stripped, then the id with a `[1m]` suffix stripped. Unknown models make cost `null` for those tokens; the model is listed in a warning badge.
- **Cost of one usage record:** `input × in + output × out + cache_5m_write × cacheWrite + cache_1h_write × (cacheWrite1h ?? cacheWrite) + cache_read × cacheRead`. If the `ephemeral_*` breakdown is missing, all `cache_creation_input_tokens` are priced as 5m writes.
- **No pricing available at all** (no cache, offline): aggregate costs show `—`. Per-session cost falls back to the latest transcript `cost-state.totalCostUSD`, marked `≈`.

## 4. Derived metrics

### 4.1 Context usage (per session)
- Context tokens = from the latest **main-thread** (`isSidechain !== true`) deduped assistant record: `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`.
- If a `compact_boundary` is newer than that record, use `compactMetadata.postTokens` instead.
- Window size = LiteLLM `max_input_tokens` for the model. Models whose id ends in `[1m]` use 1,000,000. If unknown, fall back to 200,000.
- `ctx% = round(tokens / window × 100)`. Color thresholds: < 60 normal, 60–80 warn, ≥ 80 danger.

### 4.2 Time windows
| Window | Definition |
|---|---|
| Block | `[five_hour.resets_at − 5h, now]`. If the API is unavailable, derive ccusage-style: walk deduped usage records in time order; a block starts at the first record's timestamp floored to the UTC hour and ends 5h later; a record after the block end or > 5h after the previous record starts a new block. The current block is the one containing `now`, if any. |
| Week | `[seven_day.resets_at − 7d, now]`. Fallback: rolling last 7 days. |
| Today | Local midnight → now. |
| Month | Local first of month 00:00 → now. |

### 4.3 Aggregates
- Cost and tokens (in/out/cache-write/cache-read) per window, summed over **all** transcripts (main and subagent) whose deduped records fall inside the window, broken down by model.
- **Burn rate:** cost of records in the last 60 minutes, in $/h.
- **Sparkline:** cost per hour for the last 24 hours (24 buckets).

### 4.4 Session list
- **Live:** registry file present and liveness passes.
- **Ended:** last seen live by this process and now gone, *or* a transcript (no live registry entry) whose last record is within `endedWindowHours` (default 24). The startup scan finds the latter.
- **Per-session fields:** status, waitingFor, active agent count, display name (registry `name` → latest `ai-title` → `agent-name` → cwd basename), cwd, git branch (latest record `gitBranch`), model (latest main-thread assistant model), ctx%, session cost, tokens, startedAt / uptime, last activity (max of registry `statusUpdatedAt`, last record timestamp, transcript mtime), permission mode, Claude Code version.

## 5. Architecture

```
┌─────────────── collectors ───────────────┐
│ SessionRegistry  TranscriptTailer(s)     │      ┌────────┐      ┌──────────┐
│ HistoryScanner   UsageApiPoller          │─────▶│ Store  │─────▶│  Ink UI  │
│ PricingProvider                          │events│snapshot│ hook │          │
└──────────────────────────────────────────┘      └────────┘      └──────────┘
```

### 5.1 Modules (`src/`)

| Path | Responsibility | Depends on |
|---|---|---|
| `cli.tsx` | Parse args, load config, enter alt screen, start collectors, `render(<App/>)`, clean shutdown on q/SIGINT/SIGTERM (restore screen, stop watchers) | everything |
| `config/schema.ts`, `config/load.ts` | zod schema, defaults, read `~/.config/ccstatusboard/config.json` (`$XDG_CONFIG_HOME` respected), merge CLI flags | zod |
| `core/paths.ts` | Claude dir, `encodeProjectDir(cwd)`, transcript path resolution, config/cache dirs | node |
| `core/jsonl.ts` | Line splitting with partial-line buffering; safe JSON parse | — |
| `collectors/sessionRegistry.ts` | Watch `sessions/` (`fs.watch` + 2s poll), parse registry files, liveness, emit `sessionUpserted/sessionEnded` | paths, liveness |
| `collectors/liveness.ts` | `isAlive(pid, procStart)` incl. Linux `/proc` check | node |
| `collectors/transcriptTailer.ts` | Per-file byte offset; reads appended bytes on change/poll; handles truncation (size < offset → reset) | jsonl |
| `collectors/transcriptParser.ts` | Raw record → typed `TranscriptEvent` (`usage`, `compact`, `costState`, `title`, `permissionMode`, `meta`) | zod |
| `collectors/historyScanner.ts` | Startup: stream every `*.jsonl` under `projects/` modified within the last 35 days; emit usage events; cache per-file `{mtime, size, offset, summary}` at `~/.cache/ccstatusboard/scan-cache.json` so restarts only read new bytes. Emits progress. | jsonl, parser |
| `collectors/credentials.ts` | Read OAuth token (file / macOS keychain) | node |
| `collectors/usageApi.ts` | Poll usage endpoint, parse, backoff | credentials, zod |
| `collectors/pricing.ts` | Fetch/cache LiteLLM, model lookup | zod |
| `domain/types.ts` | `Session`, `UsageRecord`, `Limits`, `WindowTotals`, `Snapshot`, … | — |
| `domain/dedup.ts` | Dedup key + seen-set | — |
| `domain/cost.ts` | Price one record / sum | types |
| `domain/context.ts` | Context tokens & % | types |
| `domain/windows.ts` | Window boundaries + fallback block derivation | types |
| `domain/aggregate.ts` | Window totals, by-model, burn rate, sparkline buckets | cost, windows |
| `store/store.ts` | Holds state, applies events, recomputes snapshot at most every `refreshMs` (throttled), `subscribe/getSnapshot` | domain |
| `store/useSnapshot.ts` | `useSyncExternalStore` hook | store |
| `ui/App.tsx` | Layout, keyboard handling (`useInput`), selection/sort/filter/search state | ui/* |
| `ui/theme.ts` | Themes (`default`, `mono`, `dracula`, `solarized`, `solarized-light`, `monokai`, `gruvbox`, `nord`, `tokyonight`, `catppuccin`, `onedark`, `cyberpunk`) → color tokens; `@inkjs/ui` `extendTheme` | @inkjs/ui |
| `ui/Panel.tsx` | Titled bordered panel wrapper | ink-titled-box |
| `ui/Header.tsx` | Gradient app name, clock, live count, warnings | ink-gradient |
| `ui/Meter.tsx` | htop-style meter `Label [|||||||     58%] resets 2h14m` | — |
| `ui/UsagePanel.tsx` | 5h / weekly / per-model meters, cost row (Block/Today/Week/Month), burn rate, 24h sparkline | Meter, ink-chart |
| `ui/SessionTable.tsx` | Rows with priority-based column dropping by terminal width; selection highlight; ended rows dimmed | theme |
| `ui/DetailPane.tsx` | Selected session: token breakdown, per-model BarChart, agents, title, cwd, branch, permission mode, version, uptime | ink-chart |
| `ui/Footer.tsx` | htop-style key hints (`F1Help ↑↓Select ⏎Detail sSort fFilter /Search qQuit`) | — |
| `ui/HelpOverlay.tsx` | Key reference (`?`/F1) | — |

Target: each file < 300 lines.

### 5.2 Store snapshot (UI contract)
```ts
interface Snapshot {
  now: number;
  limits: { block?: Limit; weekly?: Limit; perModelWeekly: Limit[]; extra?: ExtraUsage;
            status: 'ok' | 'stale' | 'no-credentials' | 'expired' | 'error' | 'loading'; fetchedAt?: number };
  costs: { block: WindowTotals; today: WindowTotals; week: WindowTotals; month: WindowTotals;
           burnRatePerHour: number | null; hourlySparkline: number[] };
  pricingStatus: 'ok' | 'stale' | 'unavailable'; unknownModels: string[];
  scan: { done: boolean; filesDone: number; filesTotal: number };
  sessions: SessionView[];
  warnings: string[];
}
interface Limit { label: string; percent: number; resetsAt?: number }
interface WindowTotals { costUSD: number | null; tokens: TokenCounts; byModel: Record<string, { costUSD: number | null; tokens: TokenCounts }> }
```

### 5.3 Data flow
1. On start: load config → start PricingProvider (cache first, refresh async) → start HistoryScanner (progressive) → start SessionRegistry → start UsageApiPoller.
2. SessionRegistry emits sessions; for each live session the store asks TranscriptTailer to tail its main transcript and subagent files (the subagents dir is re-globbed every 5s).
3. Every parsed usage record goes through the global dedup set. Records feed both global aggregates and the owning session.
4. The store recomputes the snapshot at most once per `refreshMs` (default 1000) and also ticks every `refreshMs` so countdowns update.

## 6. UI

```
 ccstatusboard  ·  5 live / 3 ended  ·  14:32:07                     ⚠ pricing stale
╭─ Usage ─────────────────────────────────────────────────────────────────────────╮
│ 5h    [||||||||||||||||||||          58%]  resets 2h14m     block  $12.40        │
│ Week  [|||||||||                     31%]  resets Thu 09:00  week   $96.10       │
│ Opus  [||||||                        22%]                    today  $18.20       │
│ burn  $4.10/h   24h ▁▂▃▅▇▆▅▃▂▃▅▆▇▅▃▂▁▁▂▃▅▆▇▆                month  $412.75      │
╰─────────────────────────────────────────────────────────────────────────────────╯
╭─ Sessions ── sort: status ── filter: all ───────────────────────────────────────╮
│ ST   NAME            MODEL     BRANCH    CTX              COST    LAST    UP    │
│ ●    ccstatusboard   opus-5.5  main      ███████░░░ 61%   $4.20   now     12m   │
│ ◐ 2  power-tools     sonnet    feat/x    ██░░░░░░░░ 22%   $1.10   3s      1h    │
│ ○    pet-tracker     opus-5.5  main      █████████░ 87%   $6.02   18m     5h    │
│ ·    blog            haiku     main      —                $0.42   3h ago  —     │
╰─────────────────────────────────────────────────────────────────────────────────╯
╭─ Detail: ccstatusboard ─────────────────────────────────────────────────────────╮
│ waiting: input needed · /home/alec/…/ccstatusboard · plan mode · v2.1.296       │
│ in 12.3k  out 48.1k  cache-w 210k  cache-r 3.1M      opus ████████ $3.90        │
│ agents: 2 active (Explore, Plan)                      haiku █ $0.30             │
╰─────────────────────────────────────────────────────────────────────────────────╯
 F1Help  ↑↓Select  ⏎Detail  sSort  fFilter  /Search  qQuit
```

- **Status glyphs:** `●` waiting (warn color, bold), `◐` busy (+ agent count), `○` idle, `·` ended (whole row dimmed).
- **Meter colors:** < 50 normal, 50–80 warn, ≥ 80 danger.
- **Default sort `status`:** waiting > busy > idle > ended, then most recent activity. Other sorts: `activity`, `cost`, `ctx`, `name`.
- **Filter:** `all` / `live`. **Search:** `/` filters by name/cwd substring; Esc clears.
- **Keys:** `↑↓`/`jk` move, `⏎` toggles the detail pane, `g`/`G` top/bottom, `s` cycles sort, `t`/`T` next/previous theme (saved to config), `f` toggles filter, `/` search, `?`/`F1` help, `q`/`Ctrl-C` quit.
- **Responsive:** column drop order as width shrinks: UP → BRANCH → LAST → MODEL. The detail pane hides if height < 24. Sparkline width adapts.
- **Empty states:** no `~/.claude` → "Claude Code data not found at <path>"; no sessions → "No Claude Code sessions in the last 24h".
- **Scan progress:** while the history scan is running the cost row shows `scanning 120/840…` and the values update progressively.

## 7. Configuration

`~/.config/ccstatusboard/config.json` (all optional):
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
CLI flags: `--theme`, `--refresh <ms>`, `--ended-hours <n>`, `--sort <key>`, `--claude-dir <path>`, `--no-usage-api`, `--config <path>`, `--version`, `--help`. Precedence: flags > config file > defaults. An invalid config prints the zod error and exits 1.

## 8. Error handling

| Failure | Behavior |
|---|---|
| Claude dir missing | Empty state message; keep polling for it |
| Malformed JSON line / registry file | Skip; count in a debug counter |
| Registry file for dead PID | Ignore (ended) |
| Unknown Claude Code `version` field | Continue; header shows a `⚠ untested Claude Code vX` warning when major.minor is not `2.1` (the version these formats were verified against) |
| No credentials / `--no-usage-api` | Limits rows show `login required` / `disabled`; cost rows still work |
| Token expired | `expired — open Claude Code to refresh` |
| Usage API error / 429 | Keep last value, show `stale 4m`, back off |
| LiteLLM fetch fails | Use stale cache (`⚠ pricing stale`); none → `—` costs + session `cost-state` fallback |
| Unknown model | Its cost is excluded; `⚠ unpriced: <model>` |
| `fs.watch` unsupported / errors | Poll only |
| Terminal too small (< 60×16) | "Terminal too small" message |
| Uncaught exception | Restore terminal, print error, exit 1 |

## 9. Testing

- **TDD** for all `core/`, `collectors/`, `domain/`, `store/` modules.
- **Fixtures** (`test/fixtures/claude/`): synthetic, content-free session files, transcripts (multi-line dedup, sidechain, compact boundary, cost-state, unknown record types, malformed lines, truncated last line), a subagents dir, a LiteLLM pricing subset, and usage API responses (flat buckets, `limits[]` shape, placeholders, 429).
- **Unit tests:** jsonl splitting, parser, dedup, tailer (append, partial line, truncation), liveness (mock `/proc` reader + kill), credentials (file/expired/missing; keychain via injected exec), usageApi (parse both shapes, backoff, Retry-After; injected fetch), pricing (lookup chain, cache TTL, offline), cost, context, windows (API-based and fallback blocks), aggregate (burn rate, sparkline), config (merge, validation).
- **Component tests** (`ink-testing-library`): Meter, SessionTable (sorting, dimming, column drop at widths), UsagePanel states (ok/stale/no-credentials/scanning), App keyboard navigation.
- **Integration:** temp `CLAUDE_CONFIG_DIR` built from fixtures + fake usage server + local pricing file → start collectors → assert snapshot; append a line to a transcript → assert update; delete a registry file → session becomes ended.
- **Manual verification:** run beside 2+ real sessions and check against `/usage`, `/context` and `ccusage daily`. `npm pack` smoke test via `npx`.

All time-dependent code takes an injected `now()`; all IO-heavy modules take injected fs/fetch/exec for testability.

## 10. Project layout

```
ccstatusboard/
  package.json  tsconfig.json  tsup.config.ts  vitest.config.ts  eslint.config.js  .prettierrc
  README.md  LICENSE (MIT)  CLAUDE.md
  src/ (see §5.1)
  test/fixtures/…  test/integration/…   (unit tests colocated as src/**/*.test.ts)
  docs/superpowers/specs/…  docs/superpowers/plans/…
```
