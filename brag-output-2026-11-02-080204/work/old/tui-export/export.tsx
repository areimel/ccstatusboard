// Renders the REAL ccstatusboard <App> with fabricated in-memory snapshots into a fake TTY,
// keeps the ANSI colours, converts them to HTML spans and writes frames + layout JSON.
// Run from repo root: npx tsx brag-output/tui-export/export.tsx
// No IO against ~/.claude, no collectors, no network.
process.env.FORCE_COLOR = '3'; // must be set before chalk is loaded (dynamic imports below)
process.env.TZ = 'UTC';

import { EventEmitter } from 'node:events';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import type { ReactElement } from 'react';
import type { BurnProjection, Config, SessionView, Snapshot } from '../../src/domain/types.js';

const { render } = await import('ink');
const { App } = await import('../../src/ui/App.js');
const { DEFAULT_CONFIG } = await import('../../src/config/schema.js');
const { ZERO_TOKENS, emptyWindowTotals } = await import('../../src/domain/types.js');
const chalk = (await import('chalk')).default;

const HERE = dirname(fileURLToPath(import.meta.url));
const WORK = resolve(HERE, '../work');
const COLS = 150;
const ROWS = 42;
const BG = '#0c0c0a';
const FG = '#c0caf5';
const THEME: Config['theme'] = 'tokyonight';
const FRAMES = 33;
const T0 = 8;

if (chalk.level < 3) throw new Error(`chalk level ${chalk.level}, expected 3`);

// ---------- fixtures ----------
const BASE_NOW = Date.parse('2026-10-11T14:32:07Z'); // matches the landing page clock 14:32:07
const lerp = (a: number, b: number, k: number) => a + (b - a) * Math.min(1, Math.max(0, k));
/** progress 0..1 of frame time t across [from, to] */
const prog = (t: number, from: number, to: number) => Math.min(1, Math.max(0, (t - from) / (to - from)));

interface Spec {
  id: string;
  project: string;
  name: string;
  model: string;
  branch: string;
  ctx: (t: number) => number;
  cost: (t: number) => number;
  status: SessionView['status'];
  waitingFor?: string;
  lastAgo: number;
  upMin: number;
  cpu: number;
  memMB: number;
  subagents: string[];
  live: boolean;
}
const wob = (t: number, a: number, ph: number) => Math.sin(t * 0.9 + ph) * a;
const SPECS: Spec[] = [
  { id: 's1', project: 'ccstatusboard', name: 'landing-page', model: 'claude-opus-5-5', branch: 'feat/landing-page', ctx: (t) => lerp(52, 61, prog(t, 8, 24)), cost: (t) => 4.2 + 0.2 * prog(t, 8, 16) + 0.5 * prog(t, 16, 20), status: 'busy', lastAgo: 0, upMin: 47, cpu: 38, memMB: 412, subagents: ['Explore'], live: true },
  { id: 's2', project: 'ccstatusboard', name: 'release-script', model: 'claude-sonnet-5-5', branch: 'fix/release-version', ctx: (t) => lerp(34, 38, prog(t, 8, 24)), cost: (t) => 2.35 + 0.15 * prog(t, 16, 20), status: 'waiting', waitingFor: 'permission to run npm publish', lastAgo: 48, upMin: 31, cpu: 2, memMB: 318, subagents: [], live: true },
  { id: 's3', project: 'power-tools', name: 'power-tools', model: 'claude-sonnet-5-5', branch: 'main', ctx: (t) => lerp(62, 91, prog(t, 12, 16)), cost: (t) => 1.1 + 0.9 * prog(t, 12, 16) + 0.3 * prog(t, 16, 20), status: 'busy', lastAgo: 1, upMin: 63, cpu: 54, memMB: 536, subagents: [], live: true },
  { id: 's4', project: 'api-gateway', name: 'auth-refactor', model: 'claude-opus-5-5', branch: 'refactor/auth', ctx: (t) => lerp(52, 56, prog(t, 8, 24)), cost: (t) => 3.15 + 0.1 * prog(t, 16, 20), status: 'idle', lastAgo: 540, upMin: 112, cpu: 1, memMB: 289, subagents: [], live: true },
  { id: 's5', project: 'api-gateway', name: 'rate-limiter', model: 'claude-opus-5-5', branch: 'feat/rate-limit', ctx: (t) => lerp(70, 78, prog(t, 8, 24)), cost: (t) => 7.85 + 0.4 * prog(t, 8, 16) + 0.9 * prog(t, 16, 20), status: 'busy', lastAgo: 4, upMin: 88, cpu: 61, memMB: 604, subagents: ['general-purpose'], live: true },
  { id: 's6', project: 'dotfiles', name: 'nvim-lua', model: 'claude-haiku-4-5', branch: 'main', ctx: () => 27, cost: () => 0.32, status: 'ended', lastAgo: 7200, upMin: 95, cpu: 0, memMB: 0, subagents: [], live: false },
  { id: 's7', project: 'dotfiles', name: 'zsh-cleanup', model: 'claude-haiku-4-5', branch: 'main', ctx: () => 15, cost: () => 0.18, status: 'ended', lastAgo: 18000, upMin: 40, cpu: 0, memMB: 0, subagents: [], live: false },
  { id: 's8', project: 'dotfiles', name: 'tmux-conf', model: 'claude-sonnet-5-5', branch: 'main', ctx: () => 9, cost: () => 0.44, status: 'ended', lastAgo: 90000, upMin: 22, cpu: 0, memMB: 0, subagents: [], live: false },
];

const win = (costUSD: number) => ({ ...emptyWindowTotals(), costUSD });
const GiB = 1024 ** 3;

function snapshotAt(i: number): Snapshot {
  const t = T0 + i * 0.5;
  const now = BASE_NOW + i * 1000;
  const k = prog(t, 8, 12);
  const blockPct = t <= 12 ? lerp(58, 86, k) : lerp(86, 87.2, prog(t, 12, 24));
  const weekPct = t <= 12 ? lerp(31, 33, k) : 33;
  const blockProj = t <= 12 ? lerp(72, 93, k) : lerp(93, 94, prog(t, 12, 24));
  const weekProj = lerp(38, 40, prog(t, 8, 24));
  const blk = (p: number): BurnProjection['band'] => (p > 125 ? 'critical' : p > 100 ? 'over' : p >= 85 ? 'near' : 'under');
  const block: BurnProjection = {
    currentPct: Math.round(blockPct),
    ratePctPerHour: t <= 12 ? lerp(12, 15, k) : 15,
    projectedPct: blockProj,
    band: blk(blockProj),
    ...(blk(blockProj) === 'near' ? { hitAt: now + 95 * 60_000, hitWindowPct: 96 } : {}),
  };
  const week: BurnProjection = { currentPct: Math.round(weekPct), ratePctPerHour: 0.9, projectedPct: weekProj, band: blk(weekProj) };

  const c = prog(t, 16, 20);
  const sessions: SessionView[] = SPECS.map((s) => {
    const pct = Math.round(s.ctx(t));
    const cost = s.cost(t);
    return {
      sessionId: s.id,
      pid: s.live ? 20000 + Number(s.id.slice(1)) * 137 : undefined,
      live: s.live,
      status: s.status,
      waitingFor: s.waitingFor,
      activeAgents: s.subagents.length,
      agentNames: s.subagents,
      subagents: s.subagents.map((n, j) => ({ id: `${s.id}-a${j}`, name: n, lastActivity: now - 2000 })),
      name: s.name,
      cwd: `/work/${s.project}`,
      project: s.project,
      gitBranch: s.branch,
      model: s.model,
      contextTokens: Math.round((pct / 100) * 200_000),
      contextWindow: 200_000,
      contextPercent: pct,
      costUSD: cost,
      costApprox: false,
      tokens: { ...ZERO_TOKENS, input: 120_000, output: 38_000, cacheRead: 2_100_000 },
      byModel: { [s.model]: { costUSD: cost, tokens: { ...ZERO_TOKENS, input: 120_000, output: 38_000, cacheRead: 2_100_000 } } },
      startedAt: now - s.upMin * 60_000,
      lastActivity: now - (s.lastAgo === 0 ? 1500 : s.lastAgo * 1000),
      permissionMode: 'default',
      version: '2.1.296',
      cpuPercent: s.live ? Math.max(1, s.cpu + wob(t, 6, Number(s.id.slice(1)))) : undefined,
      memBytes: s.live ? s.memMB * 1024 * 1024 : undefined,
    };
  });

  const spark = [0.8, 1.4, 2.2, 3.1, 2.6, 1.9, 1.2, 0.6, 0.4, 0.9, 1.7, 2.8, 3.9, 4.6, 3.8, 3.0, 2.2, 3.4, 4.8, 5.4, 4.3, 3.6, 4.4].map(
    (v) => v,
  );
  spark.push(lerp(2.6, 5.2, c) + (t <= 16 ? 0 : 0));
  const cpuHist = Array.from({ length: 24 }, (_, j) => 22 + 14 * Math.sin((j + i) * 0.7) + 6 * Math.sin((j + i) * 1.9));
  const rxHist = Array.from({ length: 24 }, (_, j) => 180 + 140 * Math.sin((j + i) * 0.55) + 60 * Math.sin((j + i) * 1.7));
  const txHist = Array.from({ length: 24 }, (_, j) => 40 + 30 * Math.sin((j + i) * 0.8 + 1) + 12 * Math.sin((j + i) * 2.1));
  const cpuNow = cpuHist.at(-1) ?? 23;

  return {
    now,
    claudeDirFound: true,
    claudeDir: '/work/.claude',
    limits: {
      status: 'ok',
      block: { label: '5h', percent: Math.round(blockPct), resetsAt: now + (2 * 60 + 14) * 60_000 - i * 1000 },
      weekly: { label: 'Week', percent: Math.round(weekPct), resetsAt: now + 3 * 86_400_000 },
      perModelWeekly: [
        { label: 'Opus', percent: Math.round(lerp(22, 24, prog(t, 8, 24))) },
        { label: 'Sonnet', percent: 9 },
      ],
      fetchedAt: now - 10_000,
    },
    costs: {
      block: win(lerp(12.4, 12.9, prog(t, 8, 16)) + lerp(0, 2.6, c)),
      today: win(lerp(27.15, 27.9, prog(t, 8, 16)) + lerp(0, 3.4, c)),
      week: win(lerp(96.1, 97.0, prog(t, 8, 16)) + lerp(0, 3.4, c)),
      month: win(lerp(412.75, 414.1, prog(t, 8, 16)) + lerp(0, 3.4, c)),
      burnRatePerHour: lerp(3.4, 4.1, prog(t, 8, 20)),
      hourlySparkline: spark,
    },
    pricingStatus: 'ok',
    unknownModels: [],
    scan: { done: true, filesDone: 10, filesTotal: 10 },
    sessions,
    warnings: [],
    system: {
      sampledAt: now,
      cpu: { total: cpuNow, perCore: Array.from({ length: 12 }, (_, j) => Math.max(2, cpuNow + 25 * Math.sin(j * 1.3 + i * 0.4))) },
      mem: { used: lerp(12.9, 13.2, prog(t, 8, 24)) * GiB, total: 32 * GiB },
      swap: { used: 0.4 * GiB, total: 8 * GiB },
      disk: { used: 412 * GiB, total: 954 * GiB, mount: '/' },
      net: { rxPerSec: (rxHist.at(-1) ?? 200) * 1024, txPerSec: (txHist.at(-1) ?? 40) * 1024 },
      load: [cpuNow / 19, cpuNow / 25, cpuNow / 30],
    },
    systemHistory: { cpu: cpuHist, rx: rxHist, tx: txHist },
    burn: { block, week },
  };
}

// ---------- fake TTY render, colours kept ----------
async function renderFrame(snap: Snapshot): Promise<string> {
  const chunks: string[] = [];
  const stdout = Object.assign(new EventEmitter(), {
    columns: COLS,
    rows: ROWS,
    isTTY: true,
    write: (c: string) => (chunks.push(c), true),
  });
  const stdin = Object.assign(new EventEmitter(), {
    isTTY: true,
    setRawMode: () => {},
    setEncoding: () => {},
    read: () => null,
    ref: () => {},
    unref: () => {},
  });
  const config: Config = { ...DEFAULT_CONFIG, theme: THEME, endedWindowHours: 24, subscriptionUSD: 200 };
  const store = { subscribe: () => () => {}, getSnapshot: () => snap };
  const el: ReactElement = React.createElement(App, { store, config, onQuit: () => {}, size: { columns: COLS, rows: ROWS } });
  const inst = render(el, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    debug: true,
    patchConsole: false,
    exitOnCtrlC: false,
  });
  await new Promise((r) => setTimeout(r, 40));
  const shown = chunks.filter((f) => plainOf(f).trim() !== '').at(-1) ?? '';
  inst.unmount();
  return shown.replace(/\n$/, '');
}

// ---------- ANSI -> HTML ----------
const ANSI16 = [
  '#15161e', '#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff', '#a9b1d6',
  '#414868', '#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff', '#c0caf5',
];
function xterm256(n: number): string {
  if (n < 16) return ANSI16[n]!;
  if (n >= 232) {
    const v = 8 + (n - 232) * 10;
    return `rgb(${v},${v},${v})`;
  }
  const m = n - 16;
  const lv = (x: number) => (x === 0 ? 0 : 55 + x * 40);
  return `rgb(${lv(Math.floor(m / 36))},${lv(Math.floor(m / 6) % 6)},${lv(m % 6)})`;
}
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

interface Sty { fg?: string; bg?: string; bold?: boolean; dim?: boolean; italic?: boolean; underline?: boolean; inverse?: boolean; strike?: boolean }

function styleCss(s: Sty): string {
  let fg = s.fg;
  let bg = s.bg;
  if (s.inverse) [fg, bg] = [bg ?? BG, fg ?? FG];
  const css: string[] = [];
  if (fg) css.push(`color:${fg}`);
  if (bg) css.push(`background:${bg}`);
  if (s.bold) css.push('font-weight:700');
  if (s.dim) css.push('opacity:.6');
  if (s.italic) css.push('font-style:italic');
  const deco = [s.underline ? 'underline' : '', s.strike ? 'line-through' : ''].filter(Boolean).join(' ');
  if (deco) css.push(`text-decoration:${deco}`);
  return css.join(';');
}

function ansiLineToHtml(line: string): string {
  let sty: Sty = {};
  let out = '';
  let buf = '';
  const flush = () => {
    if (!buf) return;
    const css = styleCss(sty);
    out += css ? `<span style="${css}">${esc(buf)}</span>` : esc(buf);
    buf = '';
  };
  const re = /\x1b\[([0-9;:]*)m|\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g;
  let last = 0;
  for (let m = re.exec(line); m; m = re.exec(line)) {
    buf += line.slice(last, m.index);
    last = re.lastIndex;
    if (m[1] === undefined) continue; // non-SGR escape: drop
    flush();
    const p = m[1] === '' ? [0] : m[1].split(/[;:]/).map(Number);
    for (let j = 0; j < p.length; j++) {
      const c = p[j]!;
      if (c === 0) sty = {};
      else if (c === 1) sty.bold = true;
      else if (c === 2) sty.dim = true;
      else if (c === 3) sty.italic = true;
      else if (c === 4) sty.underline = true;
      else if (c === 7) sty.inverse = true;
      else if (c === 9) sty.strike = true;
      else if (c === 22) (sty.bold = false), (sty.dim = false);
      else if (c === 23) sty.italic = false;
      else if (c === 24) sty.underline = false;
      else if (c === 27) sty.inverse = false;
      else if (c === 29) sty.strike = false;
      else if (c >= 30 && c <= 37) sty.fg = ANSI16[c - 30];
      else if (c >= 90 && c <= 97) sty.fg = ANSI16[c - 90 + 8];
      else if (c >= 40 && c <= 47) sty.bg = ANSI16[c - 40];
      else if (c >= 100 && c <= 107) sty.bg = ANSI16[c - 100 + 8];
      else if (c === 39) sty.fg = undefined;
      else if (c === 49) sty.bg = undefined;
      else if (c === 38 || c === 48) {
        const key = c === 38 ? 'fg' : 'bg';
        if (p[j + 1] === 2) {
          sty[key] = `rgb(${p[j + 2]},${p[j + 3]},${p[j + 4]})`;
          j += 4;
        } else if (p[j + 1] === 5) {
          sty[key] = xterm256(p[j + 2]!);
          j += 2;
        }
      }
    }
  }
  buf += line.slice(last);
  flush();
  return out;
}

const plainOf = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');

// ---------- main ----------
const frames: { t: number; lines: string[] }[] = [];
let plain0: string[] = [];
let ansiSample = '';
for (let i = 0; i < FRAMES; i++) {
  const raw = await renderFrame(snapshotAt(i));
  const ansiLines = raw.split('\n');
  while (ansiLines.length < ROWS) ansiLines.push('');
  const lines = ansiLines.slice(0, ROWS);
  if (i === 0) {
    plain0 = lines.map(plainOf);
    ansiSample = raw;
  }
  frames.push({ t: T0 + i * 0.5, lines: lines.map(ansiLineToHtml) });
}
const colourSpans = (frames[0]!.lines.join('').match(/color:/g) ?? []).length;
if (colourSpans < 50) throw new Error(`colours missing (spans=${colourSpans}); sample=${JSON.stringify(ansiSample.slice(0, 200))}`);
const maxW = Math.max(...plain0.map((l) => [...l].length));
if (maxW > COLS) throw new Error(`line wider than ${COLS}: ${maxW}`);

// ---------- layout ----------
const findRow = (re: RegExp, from = 0, lines = plain0) => {
  for (let r = from; r < lines.length; r++) if (re.test(lines[r]!)) return r;
  return -1;
};
const panelEnd = (start: number) => {
  for (let r = start + 1; r < plain0.length; r++) if (/^\s*[└╰]/.test(plain0[r]!)) return r;
  return start;
};
const cols = (r: number, re: RegExp) => {
  const l = [...plain0[r]!].join('');
  const m = re.exec(l);
  return m ? [m.index, m.index + m[0].length - 1] : [-1, -1];
};
const rng = (r0: number, r1: number, c0 = 0, c1 = COLS - 1) => ({ rowStart: r0, rowEnd: r1, colStart: c0, colEnd: c1 });

const usageTop = findRow(/[┌╭].*Usage/);
const sysTop = findRow(/[┌╭].*System/);
const sessTop = findRow(/[┌╭].*Sessions/);
const burnRow = findRow(/Burn rate|burn rate/i, usageTop);
const projRows = plain0.map((l, r) => (/proj \d+/.test(l) ? r : -1)).filter((r) => r >= 0);
const costRow = findRow(/Block|Today/i, usageTop);
const hdrRow = findRow(/CONTEXT|CTX/i, sessTop);
const missing = Object.entries({ usageTop, sysTop, sessTop, projRows: projRows[0] ?? -1, hdrRow }).filter(([, v]) => v < 0);
const ctxCols = hdrRow >= 0 ? cols(hdrRow, /CTX|CONTEXT/) : [-1, -1];
const sessEnd = panelEnd(sessTop);
const cRow0 = plain0.findIndex((l, r) => r > usageTop && /\bblock\s+\$/.test(l));
const cRow1 = plain0.findIndex((l, r) => r > cRow0 && /\bplan\s+/.test(l));
const cCol = cRow0 >= 0 ? plain0[cRow0]!.search(/block\s+\$/) : 0;
const costRng = { ...rng(cRow0, cRow1 >= 0 ? cRow1 : cRow0 + 4, cCol, COLS - 3), note: 'block/week/today/month/plan at right of Usage' };
const layout = {
  cols: COLS,
  rows: ROWS,
  note: 'rows/cols are 0-based inclusive; derived from plain text of frame 0',
  header: rng(0, usageTop - 1),
  usage: rng(usageTop, panelEnd(usageTop)),
  burnRate: { ...rng(burnRow >= 0 ? burnRow : projRows[0]!, projRows.at(-1)!), headingRow: burnRow, projRows },
  costRows: costRng,
  system: rng(sysTop, panelEnd(sysTop)),
  sessions: rng(sessTop, sessEnd),
  sessionsHeaderRow: hdrRow,
  sessionsContextColumn: { ...rng(hdrRow, sessEnd - 1, ctxCols[0]!, ctxCols[1]!), note: 'column range of the CTX header text; bars may extend a few cols right' },
  footer: rng(sessEnd + 1, ROWS - 1),
  missing: missing.map(([k]) => k),
  panelLines: Object.fromEntries(
    [usageTop, sysTop, sessTop, hdrRow, burnRow, costRow].map((r) => [r, plain0[r]]),
  ),
};
void costRow;

mkdirSync(HERE, { recursive: true });
mkdirSync(WORK, { recursive: true });
writeFileSync(resolve(HERE, 'tui-frames.json'), JSON.stringify({ cols: COLS, rows: ROWS, bg: BG, fg: FG, frames }));
writeFileSync(resolve(HERE, 'tui-layout.json'), JSON.stringify(layout, null, 2));

const pick = [0, 8, 16, 32];
const cell = (f: (typeof frames)[number]) =>
  `<h3>t=${f.t}s</h3><pre>${f.lines.join('\n')}</pre>`;
writeFileSync(
  resolve(WORK, 'tui-preview.html'),
  `<!doctype html><meta charset="utf-8"><style>
body{background:#000;color:#ddd;font-family:sans-serif;margin:12px}
h3{margin:14px 0 4px;font-weight:400;font-size:13px}
pre{margin:0;background:${BG};color:${FG};font:14px/1.2 'JetBrains Mono','DejaVu Sans Mono',monospace;width:${COLS}ch;white-space:pre;padding:6px}
</style>${pick.map((i) => cell(frames[i]!)).join('')}`,
);
console.log(`ok: ${FRAMES} frames ${COLS}x${ROWS}, colour spans in frame0: ${colourSpans}`);
console.log(JSON.stringify(layout, null, 1));
