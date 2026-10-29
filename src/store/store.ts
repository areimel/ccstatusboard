import { basename } from 'node:path';
import { burnRatePerHour, hourlySparkline, totalsForWindow, unknownModelsIn } from '../domain/aggregate.js';
import { DedupSet } from '../domain/dedup.js';
import { projectBurn } from '../domain/burn-rate-formula.js';
import {
  type BurnProjection,
  type LimitsState,
  type PriceLookup,
  type PricingStatus,
  type ProcStats,
  type RegistryEntry,
  type ScanProgress,
  type SessionView,
  type Snapshot,
  type SubagentView,
  type SystemHistory,
  type SystemStats,
  type TimeWindow,
  type TranscriptEvent,
  type UsageRecord,
} from '../domain/types.js';
import {
  blockWindowFromLimit,
  deriveCurrentBlock,
  monthWindow,
  rollingWeekWindow,
  todayWindow,
  weekWindowFromLimit,
} from '../domain/windows.js';
import { LimitHistory } from './limitHistory.js';
import { nonNeg, sanitizeLimits, sanitizeSystem, sanitizeText, sanitizeWindowTotals } from './sanitize.js';
import {
  applySessionEvent,
  buildSessionView,
  createSessionState,
  lastActivityOf,
  sessionVersion,
  type SessionState,
} from './sessionState.js';

export interface StoreOptions {
  now: () => number;
  refreshMs: number;
  endedWindowHours: number;
  claudeDir: string;
  claudeDirFound: boolean;
}

const TESTED_MAJOR_MINOR = '2.1';
const SYSTEM_HISTORY_POINTS = 60;

function pushCapped(arr: number[], v: number): void {
  arr.push(v);
  if (arr.length > SYSTEM_HISTORY_POINTS) arr.splice(0, arr.length - SYSTEM_HISTORY_POINTS);
}

export class Store {
  private readonly sessions = new Map<string, SessionState>();
  private readonly dedup = new DedupSet();
  private readonly records: UsageRecord[] = [];
  /** Usage timestamps, kept sorted ascending as records arrive. */
  private readonly sortedTs: number[] = [];
  private limits: LimitsState = { status: 'loading', perModelWeekly: [] };
  private lookup: PriceLookup | null = null;
  private pricingStatus: PricingStatus = 'loading';
  private scan: ScanProgress = { done: false, filesDone: 0, filesTotal: 0 };
  private claudeDirFound: boolean;
  private readonly listeners = new Set<() => void>();
  private snapshot: Snapshot;
  private pending: ReturnType<typeof setTimeout> | null = null;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private readonly limitHistory = new LimitHistory();
  private system: SystemStats | undefined;
  private readonly sysHistory: SystemHistory = { cpu: [], rx: [], tx: [] };
  private procStats = new Map<number, ProcStats>();
  /** cwd → resolved project (git repo) name. */
  private readonly projects = new Map<string, string>();

  private readonly opts: StoreOptions;

  constructor(opts: StoreOptions) {
    this.opts = { ...opts };
    this.claudeDirFound = opts.claudeDirFound;
    this.snapshot = this.compute();
  }

  applyEvents(sessionId: string, events: TranscriptEvent[]): void {
    const s = this.session(sessionId);
    for (const e of events) {
      let isNew = false;
      if (e.kind === 'usage') {
        isNew = this.dedup.add(e.record.key);
        if (isNew) {
          this.records.push(e.record);
          insertSorted(this.sortedTs, e.record.timestamp);
        }
      }
      applySessionEvent(s, e, isNew);
    }
    this.markDirty();
  }

  upsertRegistry(e: RegistryEntry): void {
    const s = this.session(e.sessionId);
    s.registry = e;
    s.live = true;
    this.markDirty();
  }

  markEnded(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.live = false;
    s.endedAt = this.opts.now();
    s.agents = { activeCount: 0, names: [] };
    this.markDirty();
  }

  setAgents(sessionId: string, a: { activeCount: number; names: string[]; agents?: SubagentView[] }): void {
    this.session(sessionId).agents = {
      activeCount: a.activeCount,
      names: [...a.names],
      list: (a.agents ?? []).map((x) => ({ ...x })),
    };
    this.markDirty();
  }

  setProject(cwd: string, name: string): void {
    if (this.projects.get(cwd) === name) return;
    this.projects.set(cwd, name);
    this.markDirty();
  }

  setLimits(l: LimitsState): void {
    this.limits = sanitizeLimits(l);
    const now = this.opts.now();
    const t = l.fetchedAt ?? now;
    this.limitHistory.record('block', this.limits.block, t, now);
    this.limitHistory.record('week', this.limits.weekly, t, now);
    this.markDirty();
  }

  setSystem(stats: SystemStats): void {
    this.system = sanitizeSystem(stats);
    pushCapped(this.sysHistory.cpu, this.system.cpu.total);
    pushCapped(this.sysHistory.rx, this.system.net.rxPerSec);
    pushCapped(this.sysHistory.tx, this.system.net.txPerSec);
    this.markDirty();
  }

  setProcStats(map: Map<number, ProcStats>): void {
    const next = new Map<number, ProcStats>();
    for (const [pid, p] of map)
      next.set(pid, { cpuPercent: nonNeg(p.cpuPercent), rssBytes: nonNeg(p.rssBytes) });
    this.procStats = next;
    this.markDirty();
  }

  /** Applies live config changes; a new refreshMs restarts the flush interval. */
  setOptions(patch: { refreshMs?: number; endedWindowHours?: number }): void {
    if (patch.endedWindowHours !== undefined) this.opts.endedWindowHours = patch.endedWindowHours;
    if (patch.refreshMs !== undefined && patch.refreshMs !== this.opts.refreshMs) {
      this.opts.refreshMs = patch.refreshMs;
      if (this.ticker) {
        clearInterval(this.ticker);
        this.ticker = setInterval(() => this.flush(), this.opts.refreshMs);
      }
    }
    this.markDirty();
  }

  setPricing(lookup: PriceLookup | null, status: PricingStatus): void {
    this.lookup = lookup;
    this.pricingStatus = status;
    this.markDirty();
  }

  setScanProgress(p: ScanProgress): void {
    this.scan = { ...p };
    this.markDirty();
  }

  setClaudeDirFound(found: boolean): void {
    this.claudeDirFound = found;
    this.markDirty();
  }

  getSnapshot = (): Snapshot => this.snapshot;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  start(): void {
    this.stopped = false;
    if (this.ticker) return;
    this.ticker = setInterval(() => this.flush(), this.opts.refreshMs);
  }

  stop(): void {
    this.stopped = true;
    if (this.ticker) clearInterval(this.ticker);
    if (this.pending) clearTimeout(this.pending);
    this.ticker = null;
    this.pending = null;
  }

  flush(): void {
    if (this.pending) {
      clearTimeout(this.pending);
      this.pending = null;
    }
    this.snapshot = this.compute();
    for (const fn of this.listeners) {
      try {
        fn();
      } catch {
        // One misbehaving subscriber must not starve the others.
      }
    }
  }

  private session(sessionId: string): SessionState {
    let s = this.sessions.get(sessionId);
    if (!s) {
      s = createSessionState(sessionId);
      this.sessions.set(sessionId, s);
    }
    return s;
  }

  private markDirty(): void {
    if (this.pending || this.stopped) return;
    this.pending = setTimeout(() => {
      this.pending = null;
      this.flush();
    }, this.opts.refreshMs);
  }

  private blockWindow(now: number): TimeWindow {
    const resetsAt = this.limits.block?.resetsAt;
    if (resetsAt !== undefined) return blockWindowFromLimit(resetsAt, now);
    return deriveCurrentBlock(this.sortedTs, now) ?? { start: now, end: now };
  }

  private weekWindow(now: number): TimeWindow {
    const resetsAt = this.limits.weekly?.resetsAt;
    return resetsAt !== undefined ? weekWindowFromLimit(resetsAt, now) : rollingWeekWindow(now);
  }

  private burn(now: number): { block?: BurnProjection; week?: BurnProjection } {
    const block = projectBurn(this.limits.block, this.limitHistory.samples('block'), now, 'block');
    const week = projectBurn(this.limits.weekly, this.limitHistory.samples('week'), now, 'week');
    return { ...(block ? { block } : {}), ...(week ? { week } : {}) };
  }

  private compute(): Snapshot {
    const now = this.opts.now();
    const lookup = this.lookup;
    const cutoff = now - this.opts.endedWindowHours * 3_600_000;
    const sessions: SessionView[] = [];
    const warnings: string[] = [];
    for (const s of this.sessions.values()) {
      if (s.live) {
        const v = sessionVersion(s);
        const warning = v && !isTestedVersion(v) ? `⚠ untested Claude Code v${sanitizeText(v)}` : null;
        if (warning && !warnings.includes(warning)) warnings.push(warning);
      }
      const visible = s.live || lastActivityOf(s) >= cutoff || (s.endedAt ?? 0) >= cutoff;
      if (!visible) continue;
      const view = buildSessionView(s, lookup);
      if (view.cwd) view.project = sanitizeText(this.projects.get(view.cwd) ?? basename(view.cwd));
      const proc = s.live && s.registry ? this.procStats.get(s.registry.pid) : undefined;
      if (proc) {
        view.cpuPercent = proc.cpuPercent;
        view.memBytes = proc.rssBytes;
      }
      sessions.push(view);
    }
    return {
      now,
      claudeDirFound: this.claudeDirFound,
      claudeDir: sanitizeText(this.opts.claudeDir),
      limits: this.limits,
      costs: {
        block: sanitizeWindowTotals(totalsForWindow(this.records, this.blockWindow(now), lookup)),
        today: sanitizeWindowTotals(totalsForWindow(this.records, todayWindow(now), lookup)),
        week: sanitizeWindowTotals(totalsForWindow(this.records, this.weekWindow(now), lookup)),
        month: sanitizeWindowTotals(totalsForWindow(this.records, monthWindow(now), lookup)),
        burnRatePerHour: burnRatePerHour(this.records, now, lookup),
        hourlySparkline: hourlySparkline(this.records, now, lookup),
      },
      pricingStatus: this.pricingStatus,
      unknownModels: unknownModelsIn(this.records, lookup).map(sanitizeText),
      scan: this.scan,
      sessions,
      warnings,
      ...(this.system ? { system: this.system } : {}),
      systemHistory: {
        cpu: [...this.sysHistory.cpu],
        rx: [...this.sysHistory.rx],
        tx: [...this.sysHistory.tx],
      },
      burn: this.burn(now),
    };
  }
}

function isTestedVersion(version: string): boolean {
  const [major, minor] = version.split('.');
  return `${major}.${minor}` === TESTED_MAJOR_MINOR;
}

/** Inserts `v` into ascending `arr`: O(1) append for in-order data, binary search otherwise. */
function insertSorted(arr: number[], v: number): void {
  const last = arr[arr.length - 1];
  if (last === undefined || v >= last) {
    arr.push(v);
    return;
  }
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((arr[mid] ?? 0) <= v) lo = mid + 1;
    else hi = mid;
  }
  arr.splice(lo, 0, v);
}
