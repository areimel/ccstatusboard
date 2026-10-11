import { burnRatePerHour, hourlySparkline, totalsForWindow, unknownModelsIn } from '../domain/aggregate.js';
import { DedupSet } from '../domain/dedup.js';
import type {
  Limit,
  LimitsState,
  PriceLookup,
  PricingStatus,
  RegistryEntry,
  ScanProgress,
  SessionView,
  Snapshot,
  TimeWindow,
  TranscriptEvent,
  UsageRecord,
} from '../domain/types.js';
import {
  blockWindowFromLimit,
  deriveCurrentBlock,
  monthWindow,
  rollingWeekWindow,
  todayWindow,
  weekWindowFromLimit,
} from '../domain/windows.js';
import { sanitizeOptional, sanitizeText } from './sanitize.js';
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

export class Store {
  private readonly sessions = new Map<string, SessionState>();
  private readonly dedup = new DedupSet();
  private readonly records: UsageRecord[] = [];
  private sortedTs: number[] | null = null;
  private limits: LimitsState = { status: 'loading', perModelWeekly: [] };
  private lookup: PriceLookup | null = null;
  private pricingStatus: PricingStatus = 'loading';
  private scan: ScanProgress = { done: false, filesDone: 0, filesTotal: 0 };
  private claudeDirFound: boolean;
  private readonly listeners = new Set<() => void>();
  private snapshot: Snapshot;
  private pending: ReturnType<typeof setTimeout> | null = null;
  private ticker: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly opts: StoreOptions) {
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
          this.sortedTs = null;
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

  setAgents(sessionId: string, a: { activeCount: number; names: string[] }): void {
    this.session(sessionId).agents = { activeCount: a.activeCount, names: [...a.names] };
    this.markDirty();
  }

  setLimits(l: LimitsState): void {
    this.limits = sanitizeLimits(l);
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
    if (this.ticker) return;
    this.ticker = setInterval(() => this.flush(), this.opts.refreshMs);
  }

  stop(): void {
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
    for (const fn of this.listeners) fn();
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
    if (this.pending) return;
    this.pending = setTimeout(() => {
      this.pending = null;
      this.flush();
    }, this.opts.refreshMs);
  }

  private timestamps(): number[] {
    if (!this.sortedTs) this.sortedTs = this.records.map((r) => r.timestamp).sort((a, b) => a - b);
    return this.sortedTs;
  }

  private blockWindow(now: number): TimeWindow {
    const resetsAt = this.limits.block?.resetsAt;
    if (resetsAt !== undefined) return blockWindowFromLimit(resetsAt, now);
    return deriveCurrentBlock(this.timestamps(), now) ?? { start: now, end: now };
  }

  private weekWindow(now: number): TimeWindow {
    const resetsAt = this.limits.weekly?.resetsAt;
    return resetsAt !== undefined ? weekWindowFromLimit(resetsAt, now) : rollingWeekWindow(now);
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
      if (visible) sessions.push(buildSessionView(s, lookup));
    }
    return {
      now,
      claudeDirFound: this.claudeDirFound,
      claudeDir: this.opts.claudeDir,
      limits: this.limits,
      costs: {
        block: totalsForWindow(this.records, this.blockWindow(now), lookup),
        today: totalsForWindow(this.records, todayWindow(now), lookup),
        week: totalsForWindow(this.records, this.weekWindow(now), lookup),
        month: totalsForWindow(this.records, monthWindow(now), lookup),
        burnRatePerHour: burnRatePerHour(this.records, now, lookup),
        hourlySparkline: hourlySparkline(this.records, now, lookup),
      },
      pricingStatus: this.pricingStatus,
      unknownModels: unknownModelsIn(this.records, lookup).map(sanitizeText),
      scan: this.scan,
      sessions,
      warnings,
    };
  }
}

function isTestedVersion(version: string): boolean {
  const [major, minor] = version.split('.');
  return `${major}.${minor}` === TESTED_MAJOR_MINOR;
}

function sanitizeLimit(l: Limit): Limit {
  return { ...l, label: sanitizeText(l.label) };
}

/** Limits come from the network; strip control chars from every string the UI may render. */
function sanitizeLimits(l: LimitsState): LimitsState {
  return {
    ...l,
    ...(l.block ? { block: sanitizeLimit(l.block) } : {}),
    ...(l.weekly ? { weekly: sanitizeLimit(l.weekly) } : {}),
    perModelWeekly: l.perModelWeekly.map(sanitizeLimit),
    ...(l.extra ? { extra: { ...l.extra, currency: sanitizeOptional(l.extra.currency) } } : {}),
    ...(l.error !== undefined ? { error: sanitizeText(l.error) } : {}),
  };
}
