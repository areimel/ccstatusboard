// Transcribed from README.md (the source of truth). Update both together.

export interface Flag {
  flag: string;
  meaning: string;
}

export interface KeyBinding {
  keys: string[];
  action: string;
}

export interface Option {
  label: string;
  key: string;
  default: string;
}

export interface StatusGlyph {
  glyph: string;
  label: string;
}

export const FLAGS: readonly Flag[] = [
  { flag: "--theme <name>", meaning: "Start theme; t / T cycle and save it (see below)" },
  { flag: "--refresh <ms>", meaning: "UI refresh interval (default 1000, minimum 250)" },
  {
    flag: "--ended-hours <n>",
    meaning: "Keep ended sessions for n hours (default 0: removed when they exit)",
  },
  {
    flag: "--sort <key>",
    meaning: "project (default), status, activity, cost, ctx or name",
  },
  {
    flag: "--claude-dir <path>",
    meaning: "Claude Code config dir (default $CLAUDE_CONFIG_DIR, else ~/.claude)",
  },
  {
    flag: "--no-usage-api",
    meaning: 'Do not call the Anthropic usage API (limits show "disabled")',
  },
  {
    flag: "--config <path>",
    meaning: "Config file path (default ~/.config/ccstatusboard/config.json)",
  },
  { flag: "-v, --version", meaning: "Print version" },
  { flag: "-h, --help", meaning: "Print help" },
];

export const KEYS: readonly KeyBinding[] = [
  { keys: ["↑", "↓", "j", "k"], action: "Move selection" },
  { keys: ["g", "G"], action: "Top / bottom" },
  { keys: ["Enter"], action: "Toggle detail pane" },
  { keys: ["s"], action: "Cycle sort: project, status, activity, cost, ctx, name" },
  { keys: ["t", "T"], action: "Next / previous theme (saved to the config file)" },
  { keys: ["f"], action: "Filter: all / live only" },
  { keys: ["/"], action: "Search by name or cwd (Enter keeps, Esc clears)" },
  { keys: ["Esc"], action: "Options menu (when not searching, see below)" },
  { keys: ["?", "F1"], action: "Toggle help" },
  { keys: ["q", "Ctrl-C"], action: "Quit" },
];

export const THEMES: readonly string[] = [
  "default",
  "mono",
  "dracula",
  "solarized",
  "solarized-light",
  "monokai",
  "gruvbox",
  "nord",
  "tokyonight",
  "catppuccin",
  "onedark",
  "cyberpunk",
];

export const CONFIG_PATH: string = "~/.config/ccstatusboard/config.json";

export const OPTIONS: readonly Option[] = [
  { label: "Theme", key: "theme", default: "default" },
  {
    label: "Subscription price (per month, for plan ratio)",
    key: "subscriptionUSD",
    default: "unset",
  },
  { label: "Sort", key: "sort", default: "project" },
  { label: "Detail pane", key: "showDetail", default: "on" },
  { label: "System panel", key: "showSystem", default: "on" },
  { label: "System metrics", key: "systemMetrics", default: "all groups" },
  { label: "Columns", key: "columns", default: "all but branch" },
  { label: "Dim idle after", key: "idleCutoffMinutes", default: "60 min (1h)" },
  { label: "Keep exited", key: "endedWindowHours", default: "0 (removed on exit)" },
  { label: "Refresh", key: "refreshMs", default: "1000 ms" },
  { label: "Usage poll", key: "usagePollSeconds", default: "60 s" },
];

export const STATUS_LEGEND: readonly StatusGlyph[] = [
  { glyph: "●", label: "waiting" },
  { glyph: "◐", label: "busy" },
  { glyph: "○", label: "idle" },
  { glyph: "·", label: "ended" },
];
