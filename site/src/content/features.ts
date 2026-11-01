// Transcribed from README.md (the source of truth). Update both together.

export interface Feature {
  id: string;
  title: string;
  summary: string;
  details: string[];
}

export interface SafetyItem {
  title: string;
  body: string;
}

export interface DataSource {
  data: string;
  source: string;
}

export const FEATURES: readonly Feature[] = [
  {
    id: "limits",
    title: "Usage limits",
    summary: "Shows how much of your 5-hour and weekly Claude usage you have used, and when each limit resets.",
    details: [
      "The current 5-hour block percentage.",
      "The weekly percentage and the per-model weekly percentage.",
      "Reset countdowns for each limit.",
      "Same source as Claude Code's /usage.",
    ],
  },
  {
    id: "burn-rate",
    title: "Burn rate",
    summary: "Projects where each limit will end up at its reset.",
    details: [
      "The estimate blends two speeds, weighted 60% recent and 40% average.",
      "Average: percent used so far, divided by the time elapsed in the window.",
      "Recent: a least-squares slope over the last 45 minutes (block) or 12 hours (week), so a sudden change in pace shows up quickly.",
      "Bands: UNDER below 85%; NEAR LIMIT from 85% up to and including 100%; OVER above 100% up to 125%; CRITICAL above 125%.",
      "If 100% is reached before reset, the row shows when (hits HH:MM, or a weekday for the week) and what share of the window that is. Otherwise it shows hits n/a.",
      "The numbers are estimates from the usage samples seen so far, so they are most reliable once a few minutes of data exist.",
    ],
  },
  {
    id: "cost",
    title: "Estimated cost",
    summary: "Shows estimated spend in USD for the current block, today, this week and this month.",
    details: [
      "Totals in USD for the current block, today, this week and this month.",
      "Burn rate in $/h, with a 24-hour sparkline.",
      "Optional plan row: this month's API-equivalent cost divided by your subscriptionUSD. It appears only when a subscription price is set, and turns green at 1× or more.",
      "Costs are estimates based on API list prices. On a Pro/Max subscription you are not billed these amounts.",
    ],
  },
  {
    id: "sessions",
    title: "Sessions",
    summary: "Lists every Claude Code session on this machine, grouped by project.",
    details: [
      "Grouped by project (the git repo name), so worktrees and subfolders of one repo share a group, under ── <project> (n) ── header rows.",
      "Each row shows status (waiting and why, working, or idle), model, context-window fill, CPU and memory of the session's process, cost, last activity and uptime.",
      "The git branch is hidden by default. Turn it on under Options → Columns.",
      "Live sessions idle past the cutoff (idleCutoffMinutes, default 1h) are dimmed.",
      "Exited sessions are removed at once unless endedWindowHours keeps them.",
      "Subagent tree: active subagents appear as tree rows (├─ / └─) under their parent session, with the agent type and last activity.",
      "Group headers and subagent rows cannot be selected: j / k move between sessions.",
    ],
  },
  {
    id: "system",
    title: "System",
    summary: "Shows CPU, memory, swap and disk usage, plus network activity, at a glance.",
    details: [
      "CPU, memory, swap and disk meters.",
      "Network download and upload sparklines, and a per-core strip.",
      "On Linux: temperatures, battery, CPU and GPU detail, stall pressure, disk speeds and network link details, each with its own toggle.",
      "Sampled every 2 s, with 60 points of history for the sparklines.",
      "Hidden on terminals shorter than 30 rows, or when showSystem is false.",
    ],
  },
  {
    id: "detail-pane",
    title: "Detail pane",
    summary: "Shows the full details for the selected session.",
    details: [
      "Toggle it with Enter.",
      "Token breakdown and per-model cost.",
      "Active agents, cwd, permission mode and Claude Code version.",
    ],
  },
];

export const SAFETY: readonly SafetyItem[] = [
  {
    title: "Read-only towards Claude Code",
    body: "ccstatusboard never writes inside ~/.claude. Its writes are its own caches in $XDG_CACHE_HOME/ccstatusboard/ if XDG_CACHE_HOME is set, otherwise ~/.cache/ccstatusboard/ on Linux and ~/Library/Caches/ccstatusboard/ on macOS, and the config file, which changes only when you edit an option or press t / T.",
  },
  {
    title: "OAuth token",
    body: "It reads your Claude Code OAuth access token (from ~/.claude/.credentials.json, or on macOS the Keychain entry Claude Code-credentials) only to call Anthropic's usage endpoint. It never refreshes, stores or sends the token anywhere else. Use --no-usage-api to turn this off.",
  },
  {
    title: "Session key files",
    body: "It never opens the per-session *.key files.",
  },
  {
    title: "Network requests",
    body: "The only network requests are to api.anthropic.com (usage) and raw.githubusercontent.com (LiteLLM prices).",
  },
  {
    title: "Undocumented internals",
    body: "The session registry, transcript format and usage endpoint are undocumented Claude Code internals, verified against Claude Code 2.1.x. A future Claude Code release may change them. ccstatusboard skips records it can't parse and shows ⚠ untested Claude Code vX when it sees an unverified version. Please open an issue if something looks wrong.",
  },
];

export const DATA_SOURCES: readonly DataSource[] = [
  {
    data: "Running sessions and status",
    source: "~/.claude/sessions/<pid>.json, checked against the live process table",
  },
  {
    data: "Project name",
    source: "git rev-parse --git-common-dir in each session's cwd (read-only; falls back to the folder name outside a git repo)",
  },
  {
    data: "Subagents",
    source: "The session's subagents/ folder: agent transcripts, and which agents wrote recently (active ones only)",
  },
  {
    data: "Tokens, model, branch, context",
    source: "Session transcripts in ~/.claude/projects/**/*.jsonl (tailed incrementally)",
  },
  {
    data: "Today / week / month totals",
    source: "A startup scan of transcripts from the last 35 days, cached in ccstatusboard's cache dir",
  },
  {
    data: "5h / weekly limits",
    source: "Anthropic's OAuth usage endpoint (as used by Claude Code's /usage), polled every 60 s",
  },
  {
    data: "Prices",
    source: "LiteLLM's pricing table (https://github.com/BerriAI/litellm), cached for 24 h",
  },
  {
    data: "CPU, memory, swap, disk, net, load",
    source: "/proc on Linux, sysctl and netstat on macOS; disk via statfs. Sampled every 2 s, with 60 points of history for the sparklines",
  },
  {
    data: "Per-session CPU and memory",
    source: "/proc/<pid>/stat and statm on Linux; ps on macOS, for the live session processes only",
  },
];
