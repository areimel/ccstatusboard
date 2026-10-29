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

const BYTE_UNITS = ['B', 'K', 'M', 'G', 'T'];

/** Compact binary size: 512B, 412M, 15.6G. */
export function formatBytes(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n) || n < 0) return '—';
  let v = n;
  let i = 0;
  while (v >= 1024 && i < BYTE_UNITS.length - 1) {
    v /= 1024;
    i++;
  }
  const digits = i === 0 || v >= 100 ? 0 : 1;
  return `${trimZero(v.toFixed(digits))}${BYTE_UNITS[i]}`;
}

/** used/total as a percentage; undefined when total is not a positive finite number. */
export function ratioPercent(used: number, total: number): number | undefined {
  return Number.isFinite(total) && total > 0 ? (used / total) * 100 : undefined;
}

/** `a/b` pair, e.g. 5.1G/15.6G. */
export function formatPair(a: number, b: number, fmt: (n: number) => string = formatBytes): string {
  return `${fmt(a)}/${fmt(b)}`;
}

/** Transfer rate: 1.2M/s. */
export function formatRate(bytesPerSec: number | undefined): string {
  const b = formatBytes(bytesPerSec);
  return b === '—' ? b : `${b}/s`;
}

/** Whole-number percent: 12%. */
export function formatPercent(pct: number | undefined): string {
  if (pct === undefined || !Number.isFinite(pct)) return '—';
  return `${Math.round(pct)}%`;
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
  return `resets ${formatWeekdayTime(ts)}`;
}

/** Weekday + HH:MM, e.g. `Tue 14:00`. */
export function formatWeekdayTime(ts: number): string {
  const date = new Date(ts);
  return `${WEEKDAYS[date.getDay()]} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function shortModel(model: string | undefined): string {
  if (model === undefined || model === '') return '—';
  return model
    .replace(/^claude-/, '')
    .replace(/\[1m\]$/i, '')
    .replace(/-\d{8}$/, '')
    .replace(/-(\d+)-(\d+)$/, '-$1.$2');
}

export function formatClock(ts: number, withSeconds = true): string {
  const d = new Date(ts);
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return withSeconds ? `${hm}:${pad2(d.getSeconds())}` : hm;
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
