/*
 * ccstatusboard hero replica: data model, text formatting and animation.
 *
 * The same `createState()` + `view()` pair is used twice:
 *   - at build time by TuiBoard.astro, to server-render the full first frame;
 *   - in the browser by `initBoards()`, which only updates text/attributes of
 *     elements marked `data-t="key"` (text) and `data-a="key"` (-> data-v attr).
 * All figures are illustrative sample data. Nothing here touches the DOM at
 * import time, so it is safe to import from Astro frontmatter.
 */

export type Level = 'ok' | 'warn' | 'danger';
export type Status = 'busy' | 'waiting' | 'idle' | 'ended';
export type Fill = { usage: number; system: number; sessions: number };

export interface Sess {
  id: string;
  group: string;
  name: string;
  model: string;
  ctx: number;
  cost: number;
  /** Seconds since last activity. */
  last: number;
  status: Status;
}

export interface State {
  n: number;
  clock: number;
  block: number;
  week: number;
  blockReset: number;
  burn: number;
  spark: number[];
  costs: { block: number; today: number; week: number; month: number };
  cpu: number;
  mem: number;
  sel: number;
  sessions: Sess[];
  exploreSec: number;
}

export const METER_INNER = 30;
export const SPARK = '▁▂▃▄▅▆▇█';
const SPARK_INIT = '▁▂▃▅▇▆▅▃▂▃▅▆▇▅▃▂▁▁▂▃▅▆▇▆';
export const GROUPS = ['ccstatusboard', 'power-tools', 'api-gateway', 'dotfiles'] as const;
/** Sessions that can be selected (the live ones), in display order. */
const LIVE_IDS = ['s1', 's2', 's3', 's4', 's5'];

export function createState(): State {
  const s = (
    id: string,
    group: string,
    name: string,
    model: string,
    ctx: number,
    cost: number,
    last: number,
    status: Status,
  ): Sess => ({ id, group, name, model, ctx, cost, last, status });
  return {
    n: 0,
    clock: 14 * 3600 + 32 * 60 + 7,
    block: 58.2,
    week: 31.1,
    blockReset: 2 * 3600 + 14 * 60,
    burn: 4.1,
    spark: [...SPARK_INIT].map((c) => SPARK.indexOf(c)),
    costs: { block: 12.4, today: 27.15, week: 96.1, month: 412.75 },
    cpu: 23,
    mem: 41,
    sel: 0,
    exploreSec: 12,
    sessions: [
      s('s1', 'ccstatusboard', 'landing-page', 'opus-5.5', 61, 4.2, 0, 'busy'),
      s('s2', 'ccstatusboard', 'release-script', 'sonnet-5.5', 38, 2.35, 48, 'waiting'),
      s('s3', 'power-tools', 'power-tools', 'sonnet-5.5', 22, 1.1, 180, 'idle'),
      s('s4', 'api-gateway', 'auth-refactor', 'opus-5.5', 56, 3.15, 540, 'idle'),
      s('s5', 'api-gateway', 'rate-limiter', 'opus-5.5', 78, 7.85, 4, 'busy'),
      s('s6', 'dotfiles', 'nvim-lua', 'haiku-5.5', 27, 0.32, 7200, 'ended'),
      s('s7', 'dotfiles', 'zsh-cleanup', 'haiku-5.5', 15, 0.18, 18000, 'ended'),
      s('s8', 'dotfiles', 'tmux-conf', 'sonnet-5.5', 9, 0.44, 90000, 'ended'),
    ],
  };
}

/* ---------- formatting ---------- */

const pad2 = (n: number) => String(n).padStart(2, '0');
export const level = (p: number): Level => (p >= 85 ? 'danger' : p >= 60 ? 'warn' : 'ok');
const usd = (n: number) => `$${n.toFixed(2)}`;
const clock = (sec: number) => {
  const s = sec % 86400;
  return `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor((s % 3600) / 60))}:${pad2(s % 60)}`;
};
const ago = (s: number) =>
  s < 5 ? 'now' : s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
const dur = (s: number) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${pad2(s % 60)}s`);
const resetIn = (s: number) => {
  const m = Math.max(0, Math.floor(s / 60));
  return m >= 60 ? `${Math.floor(m / 60)}h${pad2(m % 60)}m` : `${m}m`;
};

function meter(id: string, pct: number, f: number, t: Record<string, string>, a: Record<string, string>) {
  const p = pct * f;
  const label = `${Math.round(p)}%`;
  const clamped = Math.min(100, Math.max(0, p));
  const filled = Math.round((METER_INNER * clamped) / 100);
  const room = METER_INNER - label.length;
  const bars = Math.min(filled, room);
  t[`${id}.f`] = '|'.repeat(bars);
  t[`${id}.s`] = ' '.repeat(room - bars);
  t[`${id}.p`] = label;
  a[`${id}.lv`] = level(pct);
}

// Bands match README "Burn rate": UNDER <85, NEAR LIMIT 85-100 inclusive, OVER >100-125, CRITICAL >125.
const band = (p: number) => (p > 125 ? 'CRITICAL' : p > 100 ? 'OVER' : p >= 85 ? 'NEAR LIMIT' : 'UNDER');
const bandLevel = (p: number): Level => (p > 100 ? 'danger' : p >= 85 ? 'warn' : 'ok');

export interface View {
  t: Record<string, string>;
  a: Record<string, string>;
}

/** Pure projection of state to display strings. `fill` scales bars/percentages during boot. */
export function view(st: State, fill: Fill = { usage: 1, system: 1, sessions: 1 }): View {
  const t: Record<string, string> = {};
  const a: Record<string, string> = {};
  const live = st.sessions.filter((s) => s.status !== 'ended').length;
  t.live = String(live);
  t.ended = String(st.sessions.length - live);
  t.clock = clock(st.clock);

  meter('m5', st.block, fill.usage, t, a);
  meter('mw', st.week, fill.usage, t, a);
  t['m5.r'] = `resets ${resetIn(st.blockReset)}`;
  t['mw.r'] = 'resets Thu 09:00';
  const p5 = Math.round(st.block * 1.22);
  const pw = Math.round(st.week * 3.03);
  t['b5.p'] = `proj ${p5}%`;
  t['bw.p'] = `proj ${pw}%`;
  t['b5.b'] = band(p5);
  t['bw.b'] = band(pw);
  a['b5.lv'] = bandLevel(p5);
  a['bw.lv'] = bandLevel(pw);
  t.burn = `${usd(st.burn)}/h`;
  t.spark = st.spark.map((i) => SPARK[Math.max(0, Math.min(7, i))]).join('');
  t['c.block'] = usd(st.costs.block);
  t['c.today'] = usd(st.costs.today);
  t['c.week'] = usd(st.costs.week);
  t['c.month'] = usd(st.costs.month);
  t['c.plan'] = `${(st.costs.month / 200).toFixed(1)}×`;

  meter('cpu', st.cpu, fill.system, t, a);
  meter('mem', st.mem, fill.system, t, a);
  t['cpu.r'] = `load ${(st.cpu / 19).toFixed(1)} ${(st.cpu / 25).toFixed(1)}`;
  t['mem.r'] = `${((st.mem / 100) * 32).toFixed(1)}G/32G`;

  const counts: Record<string, number> = {};
  for (const s of st.sessions) counts[s.group] = (counts[s.group] ?? 0) + 1;
  for (const g of GROUPS) t[`g.${g}`] = `${g} (${counts[g] ?? 0})`;

  const selId = LIVE_IDS[st.sel % LIVE_IDS.length];
  for (const s of st.sessions) {
    const ctx = Math.round(s.ctx * fill.sessions);
    const filled = Math.max(0, Math.min(10, Math.round(ctx / 10)));
    t[`${s.id}.st`] = { busy: '◐', waiting: '●', idle: '○', ended: '·' }[s.status];
    t[`${s.id}.cf`] = '█'.repeat(filled);
    t[`${s.id}.ce`] = '░'.repeat(10 - filled);
    t[`${s.id}.cp`] = ` ${ctx}%`.padStart(5);
    t[`${s.id}.cost`] = usd(s.cost);
    t[`${s.id}.last`] = ago(s.last);
    a[`${s.id}.row`] = s.status + (s.id === selId ? ' sel' : '');
    a[`${s.id}.lv`] = level(s.ctx);
  }

  // Subagents: Explore under s1 is permanent; s5 has general-purpose plus a
  // code-reviewer that comes and goes on a 36 s loop (on for the first 20 s).
  const phase = st.n % 36;
  const reviewer = phase < 20;
  t['sa1.t'] = dur(st.exploreSec);
  t['sa2.t'] = dur(st.exploreSec + 31);
  t['sa2.c'] = reviewer ? '├─' : '└─';
  t['sa3.t'] = dur(phase + 7);
  a.sa3 = reviewer ? 'on' : 'off';
  return { t, a };
}

/* ---------- simulation ---------- */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Advance the state by one second. */
export function step(st: State, rand: () => number): void {
  st.n++;
  st.clock++;
  st.blockReset = Math.max(0, st.blockReset - 1);
  // Caps keep both projections (block x1.22, week x3.03) at or below 100%, so the
  // hardcoded "hits n/a" stays truthful however long the tab is open.
  st.block = Math.min(81, st.block + 0.03);
  st.week = Math.min(33, st.week + 0.006);
  st.burn = clamp(st.burn + (rand() - 0.5) * 0.05, 3.9, 4.4);
  st.cpu = clamp(st.cpu + (rand() - 0.5) * 9, 9, 62);
  st.mem = Math.min(80, st.mem + 0.01);
  st.exploreSec = st.exploreSec >= 80 ? 3 : st.exploreSec + 1;

  const phase = st.n % 30;
  for (const s of st.sessions) {
    if (s.id === 's5') {
      const next: Status = phase >= 16 && phase < 23 ? 'waiting' : 'busy';
      if (next !== s.status) {
        s.status = next;
        s.last = 0;
      }
    }
    if (s.status === 'ended') continue;
    if (s.status === 'busy') {
      s.last = rand() < 0.2 ? 0 : s.last + 1;
      if (rand() < 0.22) {
        const d = 0.01 + Math.floor(rand() * 4) / 100;
        s.cost += d;
        st.costs.block += d;
        st.costs.today += d;
        st.costs.week += d;
        st.costs.month += d;
      }
      if (rand() < 0.1) s.ctx = Math.min(95, s.ctx + 1);
    } else {
      s.last++;
    }
  }
  if (st.n % 4 === 0) {
    const last = st.spark[st.spark.length - 1] ?? 3;
    st.spark = [...st.spark.slice(1), clamp(last + Math.round((rand() - 0.5) * 4), 0, 7)];
  }
  if (st.n % 7 === 0) st.sel = (st.sel + 1) % LIVE_IDS.length;
}

/* ---------- DOM ---------- */

type Bound = { el: Element; last: string };

class Binder {
  private t = new Map<string, Bound>();
  private a = new Map<string, Bound>();
  constructor(root: Element) {
    root.querySelectorAll('[data-t]').forEach((el) => this.t.set(el.getAttribute('data-t')!, { el, last: el.textContent ?? '' }));
    root.querySelectorAll('[data-a]').forEach((el) => this.a.set(el.getAttribute('data-a')!, { el, last: el.getAttribute('data-v') ?? '' }));
  }
  apply(v: View): void {
    for (const [k, val] of Object.entries(v.t)) {
      const b = this.t.get(k);
      if (b && b.last !== val) {
        b.el.textContent = val;
        b.last = val;
      }
    }
    for (const [k, val] of Object.entries(v.a)) {
      const b = this.a.get(k);
      if (b && b.last !== val) {
        b.el.setAttribute('data-v', val);
        b.last = val;
      }
    }
  }
}

const BOOT_AT = [0, 180, 620, 800, 1350];
const BOOT_END = 2000;

function mount(root: HTMLElement, seed: number): void {
  const st = createState();
  const rand = mulberry32(seed);
  const binder = new Binder(root);
  const fill: Fill = { usage: 1, system: 1, sessions: 1 };
  const render = () => binder.apply(view(st, fill));

  let inView = false;
  let ticking = false;
  let timer = 0;
  let started = false;
  const sync = () => {
    const want = ticking && inView && !document.hidden;
    if (want && !timer) timer = window.setInterval(() => (step(st, rand), render()), 1000);
    else if (!want && timer) {
      clearInterval(timer);
      timer = 0;
    }
  };

  const tween = (key: keyof Fill, ms: number) => {
    const t0 = performance.now();
    const frame = (now: number) => {
      const x = Math.min(1, (now - t0) / ms);
      fill[key] = 1 - (1 - x) ** 3;
      render();
      if (x < 1) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  };

  const boot = () => {
    const panels = [...root.querySelectorAll<HTMLElement>('.tb-panel')];
    fill.usage = fill.system = fill.sessions = 0;
    render();
    root.setAttribute('data-boot', 'run');
    panels.forEach((p, i) =>
      window.setTimeout(() => {
        p.classList.add('is-on');
        const g = p.dataset.g as keyof Fill | undefined;
        if (g) tween(g, 700);
      }, BOOT_AT[i] ?? i * 300),
    );
    window.setTimeout(() => {
      fill.usage = fill.system = fill.sessions = 1;
      root.removeAttribute('data-boot');
      panels.forEach((p) => p.classList.remove('is-on'));
      render();
      ticking = true;
      sync();
    }, BOOT_END);
  };

  const onVisible = () => {
    if (!started) {
      started = true;
      boot();
    }
  };

  document.addEventListener('visibilitychange', sync);
  if (typeof IntersectionObserver === 'undefined') {
    inView = true;
    onVisible();
    return;
  }
  new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        inView = e.isIntersecting;
        if (inView) onVisible();
      }
      sync();
    },
    { threshold: 0.1 },
  ).observe(root);
}

export function initBoards(): void {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.querySelectorAll<HTMLElement>('.tb').forEach((root, i) => {
    if (root.dataset.js === '1') return;
    root.dataset.js = '1';
    if (root.getAttribute('data-boot') === 'pre') root.setAttribute('data-boot', 'armed');
    if (reduce || root.hasAttribute('data-static') || root.closest('[data-static]')) {
      root.removeAttribute('data-boot');
      return;
    }
    mount(root, 0xcc5b + i);
  });
}
