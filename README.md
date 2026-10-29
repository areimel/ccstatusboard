# ccstatusboard

An htop-style terminal dashboard for **all** your Claude Code sessions: usage limits, estimated costs, and what every session is doing right now.

[ccstatusline](https://github.com/sirmalloc/ccstatusline) shows a statusline _inside_ one Claude Code session. ccstatusboard runs in its own terminal window and watches every session on the machine.

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

(Illustrative mockup; the real layout adapts to your terminal size and theme.)

## Install

Requires Node.js 22+ on Linux or macOS. Windows is not supported.

```bash
npx ccstatusboard          # run once
npm i -g ccstatusboard     # or install globally
ccstatusboard
```

## What it shows

- **Limits:** current 5-hour block %, weekly %, per-model weekly %, with reset countdowns. Same source as Claude Code's `/usage`.
- **Burn rate:** a projection under each limit: the pace you are on, where it lands at reset, and when (if ever) you hit 100%. See [Burn rate](#burn-rate).
- **Estimated cost (USD):** current block, today, this week, this month, and an optional `plan` ratio against your subscription price. Burn rate ($/h) and a 24-hour sparkline.
- **System:** CPU, memory, swap and disk meters, network download/upload sparklines and a per-core strip. Hidden on terminals shorter than 30 rows, or with `showSystem: false`.
- **Sessions:** waiting for you (and why), working (with active subagent count), idle, or ended in the last 24h (dimmed). Each row shows model, git branch, context-window fill, CPU and memory of the session's process, cost, last activity and uptime.
- **Detail pane:** token breakdown, per-model cost, active agents, cwd, permission mode, Claude Code version.

Legend: `●` waiting, `◐` busy, `○` idle, `·` ended.

## Usage

```bash
ccstatusboard [options]
```

| Flag                  | Meaning                                                                 |
| --------------------- | ----------------------------------------------------------------------- |
| `--theme <name>`      | Start theme; `t` / `T` cycle and save it (see below)                    |
| `--refresh <ms>`      | UI refresh interval (default 1000, minimum 250)                         |
| `--ended-hours <n>`   | Show ended sessions from the last n hours (default 24)                  |
| `--sort <key>`        | `status`, `activity`, `cost`, `ctx` or `name`                           |
| `--claude-dir <path>` | Claude Code config dir (default `$CLAUDE_CONFIG_DIR`, else `~/.claude`) |
| `--no-usage-api`      | Do not call the Anthropic usage API (limits show "disabled")            |
| `--config <path>`     | Config file path (default `~/.config/ccstatusboard/config.json`)        |
| `-v`, `--version`     | Print version                                                           |
| `-h`, `--help`        | Print help                                                              |

## Keys

| Key               | Action                                              |
| ----------------- | --------------------------------------------------- |
| `↑` `↓` / `j` `k` | Move selection                                      |
| `g` / `G`         | Top / bottom                                        |
| `Enter`           | Toggle detail pane                                  |
| `s`               | Cycle sort: status, activity, cost, ctx, name       |
| `t` / `T`         | Next / previous theme (saved to the config file)    |
| `f`               | Filter: all / live only                             |
| `/`               | Search by name or cwd (`Enter` keeps, `Esc` clears) |
| `Esc`             | Options menu (when not searching, see below)        |
| `?` / `F1`        | Toggle help                                         |
| `q` / `Ctrl-C`    | Quit                                                |

## Options

Press `Esc` outside search to open the Options menu. `↑` `↓` move, `←` `→` change a value, `Enter` edits numbers and column visibility, and `Esc` closes the menu. Changes apply immediately and are written to the config file.

| Option                                           | Config key         | Default   |
| ------------------------------------------------ | ------------------ | --------- |
| Theme                                            | `theme`            | `default` |
| Subscription price (per month, for `plan` ratio) | `subscriptionUSD`  | unset     |
| Sort                                             | `sort`             | `status`  |
| Detail pane                                      | `showDetail`       | on        |
| System panel                                     | `showSystem`       | on        |
| Columns                                          | `columns`          | all       |
| Ended window                                     | `endedWindowHours` | 24 h      |
| Refresh                                          | `refreshMs`        | 1000 ms   |
| Usage poll                                       | `usagePollSeconds` | 60 s      |

`claudeDir` and `usageApi` are shown but read-only in the menu: change them with `--claude-dir` / `--no-usage-api` or in the file, then restart.

## Themes

`default`, `mono`, `dracula`, `solarized`, `solarized-light`, `monokai`, `gruvbox`, `nord`, `tokyonight`, `catppuccin`, `onedark`, `cyberpunk`.

`t` / `T` switch to the next / previous theme. The choice is written to the `theme` key of the config file (`~/.config/ccstatusboard/config.json`, or the `--config` path), keeping other keys intact.

## Burn rate

Under the 5h block and weekly lines, the Burn rate subsection projects where each limit will end up at its reset. The estimate blends two speeds, weighted 60% recent and 40% average:

- **average:** percent used so far, divided by the time elapsed in the window;
- **recent:** a least-squares slope over the last 45 minutes (block) or 12 hours (week), so a sudden change in pace shows up quickly.

The projection is labelled by band: `UNDER` below 85%, `NEAR LIMIT` from 85% up to and including 100%, `OVER` above 100% up to 125%, and `CRITICAL` above 125%. If 100% is reached before reset, the row shows when (`hits HH:MM`, or a weekday for the week) and what share of the window that is. Otherwise it shows `hits n/a`. The numbers are estimates from the usage samples ccstatusboard has seen, so they are most reliable once a few minutes of data exist.

The `plan N.N×` row in the Cost column is this month's API-equivalent cost divided by `subscriptionUSD`. It appears only when you have set a subscription price, and turns green at 1× or more.

## Config file

`~/.config/ccstatusboard/config.json` (or `$XDG_CONFIG_HOME/ccstatusboard/config.json`). Every key is optional; unknown keys are rejected. Command-line flags override the file.

```json
{
  "theme": "default",
  "refreshMs": 1000,
  "usagePollSeconds": 60,
  "endedWindowHours": 24,
  "columns": ["status", "name", "model", "branch", "ctx", "cpu", "mem", "cost", "last", "uptime"],
  "sort": "status",
  "showDetail": true,
  "showSystem": true,
  "subscriptionUSD": null,
  "claudeDir": null,
  "usageApi": true
}
```

- `usagePollSeconds` has a minimum of 30 and `refreshMs` a minimum of 250.
- `columns` takes any of `status`, `name`, `model`, `branch`, `ctx`, `cpu`, `mem`, `cost`, `last`, `uptime`. The default is all of them, in that order. `cpu` and `mem` are the session's own process; they show `—` for sessions that are not live.
- `showSystem` (default `true`) turns the System panel on or off.
- `subscriptionUSD` (default `null`) is your monthly plan price in USD, a positive number. `null` hides the `plan` ratio.

## Where the data comes from

| Data                               | Source                                                                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Running sessions and status        | `~/.claude/sessions/<pid>.json`, checked against the live process table                                                               |
| Tokens, model, branch, context     | Session transcripts in `~/.claude/projects/**/*.jsonl` (tailed incrementally)                                                         |
| Today / week / month totals        | A startup scan of transcripts from the last 35 days, cached in ccstatusboard's cache dir (see below)                                  |
| 5h / weekly limits                 | Anthropic's OAuth usage endpoint (as used by Claude Code's `/usage`), polled every 60 s                                               |
| Prices                             | [LiteLLM's pricing table](https://github.com/BerriAI/litellm), cached for 24 h                                                        |
| CPU, memory, swap, disk, net, load | `/proc` on Linux, `sysctl` and `netstat` on macOS; disk via `statfs`. Sampled every 2 s, with 60 points of history for the sparklines |
| Per-session CPU and memory         | `/proc/<pid>/stat` and `statm` on Linux; `ps` on macOS, for the live session processes only                                           |

Costs are **estimates** based on API list prices. On a Pro/Max subscription you are not billed these amounts.

## Privacy and safety

- **Read-only towards Claude Code.** ccstatusboard never writes inside `~/.claude`. Its writes are its own caches in `$XDG_CACHE_HOME/ccstatusboard/` if `XDG_CACHE_HOME` is set, otherwise `~/.cache/ccstatusboard/` on Linux and `~/Library/Caches/ccstatusboard/` on macOS, and the config file, which changes only when you edit an option or press `t` / `T`.
- It reads your Claude Code OAuth access token (from `~/.claude/.credentials.json`, or on macOS the Keychain entry `Claude Code-credentials`) **only** to call Anthropic's usage endpoint. It never refreshes, stores or sends the token anywhere else. Use `--no-usage-api` to turn this off.
- It never opens the per-session `*.key` files.
- The only network requests are to `api.anthropic.com` (usage) and `raw.githubusercontent.com` (LiteLLM prices).

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
