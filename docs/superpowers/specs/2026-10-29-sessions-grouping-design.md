# Design: Sessions section — project grouping, idle cutoff, subagent rows (2026-10-29)

## Context
It's hard to tell what the running agents are working on from the Sessions table. The Branch column doesn't identify the project. Exited sessions stay listed for 24h (`endedWindowHours`). Subagents only show up as a count like `◐ 2`. This update:
1. Adds a **Project** column (git repo name). Sessions are grouped by project with a header row per project, and that becomes the default sort. Branch is hidden by default.
2. Removes exited sessions right away. Live sessions with no activity past a configurable cutoff (default **1h**) are **dimmed**. The cutoff can be set in the config file and in the options menu, typed as minutes or hours.
3. Shows **active subagents as tree child rows** (`├─` / `└─`) under their parent session, with agent type, status and last activity.

### Decisions (user answers)
- Cutoff: remove exited sessions immediately; dim live sessions idle longer than the cutoff.
- Subagents: indented tree child rows, active subagents only.
- Project: git repo name via `git rev-parse` (handles subfolders and worktrees), falling back to the cwd basename.
- Grouping: a divider header row per project, e.g. `── ccstatusboard (2) ────`.

### My calls (flagged for review)
- Keep the `endedWindowHours` config key so existing configs still parse (the schema is `strictObject`). Change its default from 24 to **0**, which means "remove on exit". It stays in the menu as "Keep exited", for anyone who wants a grace period.
- New key `idleCutoffMinutes` (default 60). In the menu it's labelled "Dim idle after" and accepts `45`, `90m`, `1.5h` or `2h`. Arrow keys step it by 15 min. It's displayed as `1h`, `1h 30m` or `45m`.
- The `project` sort means "group by project". Groups are ordered by their most urgent session (waiting before busy before idle), then by recent activity. Inside a group, sessions are sorted by status, then activity.
- Group headers and subagent rows can't be selected. j/k moves between sessions only, and the detail pane follows the selected session.
- Default columns: all except `branch`, with `project` placed after `status`. The user's config only sets `theme`, so the new defaults apply with no migration. Anyone who saved a column list can turn Project on in the Columns menu.
- `project` drops before `model` when the terminal is narrow (it goes into `DROP_ORDER` after `branch`).
- The existing uncommitted `package.json` / `package-lock.json` changes are the user's and won't be staged in any commit.

## Design by layer

**Types (`src/domain/types.ts`, first):**
- Add `'project'` to `COLUMN_KEYS` and `SORT_KEYS`.
- Add `Config.idleCutoffMinutes: number`.
- Add `SessionView.project?: string`.
- Add `SessionView.subagents: SubagentView[]`, where `SubagentView = { id; name; lastActivity }`.

**Config (`src/config/schema.ts`):**
- Defaults: `sort: 'project'`, `endedWindowHours: 0`, `idleCutoffMinutes: 60`, and columns set to `COLUMN_KEYS` minus `branch`.
- Schema: `idleCutoffMinutes: z.number().int().min(1).max(10_080)`.

**Collectors:**
- New `src/collectors/projectName.ts`. It runs `resolveProject(cwd, exec)` with the injected `runCommand` from `src/core/exec.ts`: `git -C <cwd> rev-parse --path-format=absolute --git-common-dir` with a 2s timeout.
  - If the result ends in `/.git`, the name is `basename(dirname(result))`; otherwise it's `basename(result)` (bare repo).
  - On any error it uses `basename(cwd)`.
  - Results are cached per cwd as a promise map, so each cwd is resolved once.
- `src/collectors/subagents.ts`: `scanSubagents` also returns `agents: { id, name, lastActivity }[]` for the active ones. The id comes from the filename and `lastActivity` is the file's mtime. Existing fields stay.
- `src/app/runtime.ts`:
  - When a session's cwd becomes known (registry or meta), resolve the project and call `store.setProject(cwd, name)`.
  - Pass `agents` through `store.setAgents`.

**Store:**
- `store.ts` keeps a `projects: Map<cwd, name>` and fills `view.project` from it, falling back to the cwd basename.
- Visibility: when `!s.live && endedWindowHours === 0`, the session is hidden. Otherwise the current cutoff logic applies.
- `sessionState.ts` carries the agents list into `view.subagents`, sanitized, and only for live sessions.

**UI:**
- `src/ui/sessionList.ts`:
  - Add `project` to `COLUMN_WIDTHS` (14) and `DROP_ORDER`.
  - Add a `project` case to `sortSessions`.
  - New pure `buildRows(sessions, sort)` returning `Array<{kind:'group',project,count} | {kind:'session',session,index} | {kind:'agent',agent,last:boolean}>`.
  - New `isStale(s, now, cutoffMin)`.
  - New `rowWindow(rows, selectedIndex, maxRows)`, which replaces `scrollWindow` for the table and keeps the selected session in view.
- `src/ui/SessionTable.tsx`:
  - Add a `PROJECT` header and cell.
  - Render group header rows full-width in `theme.dim` / bold.
  - Render agent rows with `├─`/`└─` plus the busy glyph in the status column, the agent name in the name column, and `formatAgo` in `last`. Other cells stay blank.
  - Stale sessions get `dimColor`.
  - The empty message becomes "No live Claude Code sessions".
- `src/ui/App.tsx`: `visible` stays the ordered session list, so selection and the detail pane keep working. It passes `idleCutoffMinutes` to the table. Group order has to match `buildRows` order, so the sorted list comes from the same function.
- `src/ui/options/optionsModel.ts` + `OptionsMenu.tsx`:
  - New `kind: 'duration'` descriptor, plus `parseDurationInput()` and `formatDuration` display.
  - Arrow keys step by 15, and typed entry reuses the number-editor mode.
  - Relabel `endedWindowHours` as "Keep exited" (step 1, `0` shows as "off").
- `HelpOverlay.tsx` / README: document the project sort, the subagent rows and the two cutoff settings.

## Execution: TODO list, subagents, commits
Run in waves. Each subagent owns a disjoint set of files and runs only its own test files plus `npm run typecheck`. It doesn't commit. I review each result and commit with explicit paths, so the user's `package*.json` is never staged.

| # | Task | Agent | Files owned | Commit |
|---|------|-------|-------------|--------|
| 0 | Write the design spec `docs/superpowers/specs/2026-10-29-sessions-grouping-design.md` from this plan | me | docs/ | `docs: spec for sessions project grouping, idle cutoff, subagent rows` |
| 1 | Types and config defaults/schema, with tests (TDD) | **Haiku A** | domain/types.ts, config/* | `feat(config): add project column/sort, idleCutoffMinutes, hide branch by default` |
| 2a | Project resolver and runtime wiring, plus store `setProject` | **Sonnet B** (sequential 2a→2b→2c) | collectors/projectName*, app/runtime*, store/* | `feat(collectors): resolve git repo name per session cwd` |
| 2b | Subagent per-agent detail through to `SessionView.subagents` | Sonnet B | collectors/subagents*, store/sessionState* | `feat(store): expose active subagents per session` |
| 2c | Remove exited sessions on exit (`endedWindowHours: 0`) | Sonnet B | store/store* | `feat(store): drop exited sessions immediately by default` |
| 3a | `buildRows`, project sort, `isStale`, `rowWindow`, with tests | **Sonnet C** (parallel with B, against the types from task 1) | ui/sessionList*, ui/SessionTable*, ui/App* | `feat(ui): group sessions by project with header rows` |
| 3b | Subagent tree rows and idle dimming in the table | Sonnet C | same | `feat(ui): show subagents as tree rows and dim idle sessions` |
| 4 | Duration option kind, "Dim idle after" / "Keep exited" in the menu | **Haiku D** (parallel with B, C) | ui/options/* | `feat(options): editable idle cutoff in minutes or hours` |
| 5 | Help overlay and README updates | **Haiku E** (after wave 2) | ui/HelpOverlay*, README.md | `docs: document project grouping, subagent rows, cutoffs` |
| 6 | Code review of the full diff (bugs, conventions, IO-in-UI rule) | **Sonnet F** (feature-dev:code-reviewer) | read-only | fixes: `fix: review follow-ups for sessions grouping` |

That's 5 or 6 subagents (3 Sonnet, 2 Haiku, plus a Sonnet reviewer), 9–10 commits, and all commits stay on `feat/v1`.

Each brief includes:
- the CLAUDE.md rules (types first; no IO in `ui/`; inject `now`/fs/exec; fixtures from `test/helpers/` and `src/store/testFixtures.ts`; never touch the Claude config dir)
- the exact files it owns
- the `SessionView` contract above

## Verification
- `npm run typecheck && npm run lint && npm test` passes after each commit (run by me before committing).
- Unit tests:
  - `resolveProject` (worktree path, subfolder, non-repo fallback, exec error, cache hit)
  - `buildRows` (group order, counts, agent `last` flag)
  - `isStale` boundary
  - `parseDurationInput` (`90`, `90m`, `1.5h`, `2h`, invalid)
  - config defaults
  - store hides an exited session immediately
- Manual: `npm run dev` with a few live sessions in two repos, plus one session running a subagent. Check:
  - header rows per repo, with the Branch column gone
  - `├─ Explore` child rows appear while the subagent is active
  - an idle-1h+ session is dimmed
  - quitting a session removes its row
  - changing "Dim idle after" to `2h` in the menu persists to `~/.config/ccstatusboard/config.json`
- Use the `run` skill to screenshot the TUI for a final visual check.
