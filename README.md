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
- **Estimated cost (USD):** current block, today, this week, this month. Burn rate ($/h) and a 24-hour sparkline.
- **Sessions:** waiting for you (and why), working (with active subagent count), idle, or ended in the last 24h (dimmed). Each row shows model, git branch, context-window fill, cost, last activity and uptime.
- **Detail pane:** token breakdown, per-model cost, active agents, cwd, permission mode, Claude Code version.

Legend: `●` waiting, `◐` busy, `○` idle, `·` ended.

## Usage

```bash
ccstatusboard [options]
```

| Flag                  | Meaning                                                                 |
| --------------------- | ----------------------------------------------------------------------- |
| `--theme <name>`      | `default`, `mono`, `dracula` or `solarized`                             |
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
| `f`               | Filter: all / live only                             |
| `/`               | Search by name or cwd (`Enter` keeps, `Esc` clears) |
| `?` / `F1`        | Toggle help                                         |
| `q` / `Ctrl-C`    | Quit                                                |

## Config file

`~/.config/ccstatusboard/config.json` (or `$XDG_CONFIG_HOME/ccstatusboard/config.json`). Every key is optional; unknown keys are rejected. Command-line flags override the file.

```json
{
  "theme": "default",
  "refreshMs": 1000,
  "usagePollSeconds": 60,
  "endedWindowHours": 24,
  "columns": ["status", "name", "model", "branch", "ctx", "cost", "last", "uptime"],
  "sort": "status",
  "showDetail": true,
  "claudeDir": null,
  "usageApi": true
}
```

`usagePollSeconds` has a minimum of 30.

## Where the data comes from

| Data                           | Source                                                                                   |
| ------------------------------ | ---------------------------------------------------------------------------------------- |
| Running sessions and status    | `~/.claude/sessions/<pid>.json`, checked against the live process table                  |
| Tokens, model, branch, context | Session transcripts in `~/.claude/projects/**/*.jsonl` (tailed incrementally)            |
| Today / week / month totals    | A startup scan of transcripts from the last 35 days, cached in `~/.cache/ccstatusboard/` |
| 5h / weekly limits             | Anthropic's OAuth usage endpoint (as used by Claude Code's `/usage`), polled every 60 s  |
| Prices                         | [LiteLLM's pricing table](https://github.com/BerriAI/litellm), cached for 24 h           |

Costs are **estimates** based on API list prices. On a Pro/Max subscription you are not billed these amounts.

## Privacy and safety

- **Read-only.** ccstatusboard never writes inside `~/.claude`. Its only writes are its own caches in `~/.cache/ccstatusboard/` (or `$XDG_CACHE_HOME/ccstatusboard/`).
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
