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

// East Asian Wide/Fullwidth blocks (approximation of `string-width`, no dependency).
const WIDE_RANGES: Array<[number, number]> = [
  [0x1100, 0x115f],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xa960, 0xa97f],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x20000, 0x3fffd],
];
const ZERO_WIDTH = /^[\p{Mn}\p{Me}\p{Cf}]$/u; // combining marks, ZWSP/ZWJ, variation selectors
const EMOJI = /^\p{Emoji_Presentation}$/u;

function charWidth(ch: string): number {
  const cp = ch.codePointAt(0) ?? 0;
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0) || ZERO_WIDTH.test(ch)) return 0;
  if (EMOJI.test(ch)) return 2;
  for (const [lo, hi] of WIDE_RANGES) if (cp >= lo && cp <= hi) return 2;
  return 1;
}

/** Terminal column width: East Asian wide characters and emoji count 2, combining marks 0. */
export function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += charWidth(ch);
  return w;
}

/** Like `truncate`, but measured in terminal columns. */
export function truncateDisplay(s: string, width: number): string {
  if (width <= 0) return '';
  if (displayWidth(s) <= width) return s;
  let out = '';
  let w = 0;
  for (const ch of s) {
    const cw = charWidth(ch);
    if (w + cw > width - 1) break;
    out += ch;
    w += cw;
  }
  return `${out}…`;
}
