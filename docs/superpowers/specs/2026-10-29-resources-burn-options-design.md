# Resources, burn rate, plan ratio and options — design

Date: 2026-10-29 · Branch: feat/ui-resources

## Context
The dashboard shows limits, cost and sessions, but not the machine it runs on or how fast a limit is being used up. It also has no in-app way to change settings. This branch adds four things: a System panel, per-session CPU and MEM columns, a Burn Rate subsection with a plan value ratio, and an Options menu that persists edits to the config file.

## Goals
- Show machine load next to usage, with no new dependencies.
- Tell the user whether a limit will run out before reset, and when.
- Let every user-facing setting be changed in the app, with changes saved.
- Keep the UI a pure renderer: collectors do IO, `store/` aggregates, `ui/` renders.

Non-goals: per-process CPU for every process on the machine, alerts or notifications, and writing anything under the Claude config dir.

## Data sources
- **System stats** (`src/collectors/system/`, one `SystemMonitor`, default 2 s interval): CPU total and per core from deltas of `os.cpus()` tick counts between samples (the first sample reads 0%); memory from `/proc/meminfo` or `os.totalmem`/`freemem`; swap from `sysctl -n vm.swapusage` on macOS; disk from `statfs`; network rates from `/proc/net/dev` or `netstat -ibn`, excluding loopback; load from `os.loadavg`. No npm dependencies.
- **Per-session CPU and MEM** (`src/collectors/procStats.ts`): `/proc/<pid>/stat` and `statm` on Linux, `ps -o pid=,%cpu=,rss=` on macOS, for live session pids only.
- **Usage history**: the existing limit samples feed the burn-rate model.

## Burn-rate model (`src/domain/burn-rate-formula.ts`)
A window fills from 0% at its start to `percent` now. The projection is:

1. **Average rate**: `averageRate` = percent / hours elapsed since window start. Undefined if elapsed < `MIN_AVERAGE_ELAPSED_MS` (1 min).
2. **Recent rate**: `recentRate` = least-squares slope over samples from the last `RECENT_LOOKBACK_MS[kind]` (block 45 min, week 12 h), clamped at 0. Undefined if fewer than 2 samples or a span under `MIN_RECENT_SPAN_MS` (5 min).
3. **Blend**: `blendedRate` = `RECENT_WEIGHT` (0.6) × recent + 0.4 × average; falls back to whichever exists.
4. **Project**: `projectedPct` = percent + rate × hours until reset.
5. **Band**: `classifyBand` with `BAND_THRESHOLDS` = { near: 85, over: 100, critical: 125 }: under < 85, near 85–100, over ≤ 125, critical > 125.
6. **Hit time**: `timeToLimit` gives when 100% is reached if it is before the window ends. Already at 100% gives now. Otherwise undefined, and the UI shows `hits n/a`.

`WINDOW_MS` is 5 h for block and 7 d for week. `MAX_SAMPLES` (720) caps the ring buffer, and `trimSamples` keeps only samples inside the current window. Everything is pure, and `now` is always passed in, so tests use fixed times.

## Layout and row budget (`src/ui/layout.ts`, `SystemPanel.tsx`, `BurnRate.tsx`)
- `computeLayout` gets the fixed-height panels (header, usage, system) and returns `maxRows` for the table. Fixed rows are the sum of panel rows, plus 3 table chrome rows, 1 footer row and 1 spare row. The frame must stay shorter than the terminal, because Ink full-clears at exact height.
- The detail pane (`DETAIL_ROWS` = 6) shows only when `showDetail` is on, the terminal has at least `DETAIL_MIN_ROWS` = 24 rows, and at least one table row still fits.
- The System panel is hidden when `showSystem` is false, when the terminal has fewer than `SYSTEM_MIN_ROWS` (30) rows, or while an overlay (Help, Options) is open. Its height is `systemPanelRows`: 2 border rows plus the taller of the meter column (CPU, Mem, Swap when present, Disk) and the right column (net rx/tx and cores).
- The session table gets `maxRows` and scrolls within it (`scrollWindow`), so panel heights never push the frame past the terminal.
- `<BurnRate>` is a fixed 3 rows (heading plus one row per window). The `plan` row adds one row to the usage panel only when a ratio can be computed.
- Below `MIN_COLUMNS` = 60 or `MIN_ROWS` = 16 the app shows the "too small" view.

## Config keys (`src/config/schema.ts`)
| Key | Type | Default | Notes |
| --- | --- | --- | --- |
| `subscriptionUSD` | number > 0 or null | null | Monthly plan price. Drives the `plan N.N×` ratio: month API-equivalent cost / price. |
| `showSystem` | boolean | true | Turns the System panel on or off. |
| `columns` | subset of `COLUMN_KEYS` | all | `cpu` and `mem` are new; they are in the default list. |

Schema is `z.strictObject`, so unknown keys are still rejected.

## Options menu (`src/ui/options/`)
- `Esc` in normal mode, with no active search, opens the menu. `Esc` in search mode still clears the search.
- `OPTIONS` in `optionsModel.ts` describes each row: enum, bool, number, columns, or readonly. `adjust` steps a value and returns a patch only if the result passes `configSchema`. `parseNumberInput` validates typed numbers.
- Editable: theme, subscriptionUSD, sort, showDetail, showSystem, columns, endedWindowHours, refreshMs, usagePollSeconds.
- Read-only (restart needed): claudeDir and usageApi. They are changed with flags or by editing the file.

## Persistence semantics (`src/config/save.ts`, `createConfigSaver`)
- Each change becomes a patch passed to `onConfigChange`. In `cli.tsx` the patch is saved and also applied to the running runtime, so the change takes effect at once.
- The saver merges the patch into the existing JSON. Other keys are kept.
- If the file exists but is not valid JSON, or is not an object, the save is skipped. The user's file is never overwritten.
- A missing file is created, and its directory is made with `mkdir -p`.
- Writes go to `<path>.<pid>.tmp`, then `rename` onto the real path. Symlinks are resolved first, so dotfile links keep working.
- Writes are serialized. Pending patches coalesce, latest value per key wins.
- Write errors are swallowed, because the TUI has no stderr surface. The next save may succeed.
- The theme is saved by `t` / `T`. Other keys are saved only from the Options menu. `s` and `Enter` change the session only.
- Command-line flags still win at startup, but a change made in the menu is written to the file.

## Non-functional rules
- No new npm dependencies for system stats. Sparklines use the existing `@pppp606/ink-chart`.
- A failed read in the system monitor keeps zeros for that field and never throws into the UI. Per-session CPU and MEM show `—` when the session is not live.
- Live state (sampled stats, session processes) is never written to the config file.

## Keys and hints
- `Esc` opens Options only in normal mode with no active search. In search mode it still clears the search, and the search footer is unchanged.
- The normal-mode footer shows `esc Options` after `/ Search`. Optional hints are dropped in this order as the terminal narrows: theme (`t`) first, then options (`esc`), and the essentials (`F1` to `q`) always stay. The options hint outlasts the theme hint because it is the way to reach theme editing.
- The Help overlay lists `Esc  Options (outside search)`. It does not add CPU or MEM to the status legend, which covers only session status glyphs.

## Testing
- Pure functions (`burn-rate-formula`, `optionsModel`, `save`) get unit tests with injected `now` and fake fs.
- Collectors take injected `exec`, `readFile`, `statfs` and `now`, and use fixtures from `test/helpers/`.
- UI tests render at fixed sizes with `renderSized` for the height and width rules, and check the help and footer text.
