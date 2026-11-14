import { basename } from 'node:path';
import { burnRatePerHour, hourlySparkline, totalsForWindow, unknownModelsIn } from '../domain/aggregate.js';
import { DedupSet } from '../domain/dedup.js';
import { projectBurn } from '../domain/burn-rate-formula.js';
import {
  emptyWindowTotals,
  type LimitsState,
  type PriceLookup,
  type PricingStatus,
  type ProcStats,
  type Provider,
  type ProviderSnapshot,
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
  idleCutoffMinutes?: number;
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
  private dedup = new DedupSet();
  private readonly records: UsageRecord[] = [];
  private readonly providerState = new Map<
    Provider,
    {
      dir: string;
      found: boolean;
      enabled: boolean;
      limits: LimitsState;
      scan: ScanProgress;
      history: LimitHistory;
    }
  >();
  private lookup: PriceLookup | null = null;
  private pricingStatus: PricingStatus = 'loading';
  private claudeDirFound: boolean;
  private readonly listeners = new Set<() => void>();
  private snapshot: Snapshot;
  private pending: ReturnType<typeof setTimeout> | null = null;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private system: SystemStats | undefined;
  private readonly sysHistory: SystemHistory = { cpu: [], rx: [], tx: [] };
  private procStats = new Map<number, ProcStats>();
  /** cwd → resolved project (git repo) name. */
  private readonly projects = new Map<string, string>();

  private readonly opts: StoreOptions;

  constructor(opts: StoreOptions) {
    this.opts = { ...opts };
    this.claudeDirFound = opts.claudeDirFound;
    this.setProviderStateDefaults('claude', opts.claudeDir, opts.claudeDirFound);
    this.snapshot = this.compute();
  }

  applyEvents(sessionId: string, events: TranscriptEvent[], provider: Provider = 'claude'): void {
    const s = this.session(sessionId, provider);
    for (let e of events) {
      let isNew = false;
      if (e.kind === 'usage') {
        isNew = this.dedup.add(`${provider}:${e.record.key}`);
        if (isNew) {
          e = { ...e, record: { ...e.record, provider } };
          this.records.push(e.record);
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
    const s = this.sessions.get(`claude:${sessionId}`);
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
    // Keyed like view.cwd, which is already sanitized.
    const key = sanitizeText(cwd);
    if (this.projects.get(key) === name) return;
    this.projects.set(key, name);
    this.markDirty();
  }

  setLimits(l: LimitsState, provider: Provider = 'claude'): void {
    const state = this.provider(provider);
    state.limits = sanitizeLimits(l);
    const now = this.opts.now();
    const t = l.observedAt ?? l.fetchedAt ?? now;
    state.history.record('block', state.limits.block, state.limits.block?.observedAt ?? t, now);
    state.history.record('week', state.limits.weekly, state.limits.weekly?.observedAt ?? t, now);
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
  setOptions(patch: { refreshMs?: number; endedWindowHours?: number; idleCutoffMinutes?: number }): void {
    if (patch.idleCutoffMinutes !== undefined) this.opts.idleCutoffMinutes = patch.idleCutoffMinutes;
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

  setScanProgress(p: ScanProgress, provider: Provider = 'claude'): void {
    this.provider(provider).scan = { ...p };
    this.markDirty();
  }

  setClaudeDirFound(found: boolean): void {
    this.claudeDirFound = found;
    this.provider('claude').found = found;
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

  private session(sessionId: string, provider: Provider = 'claude'): SessionState {
    const key = `${provider}:${sessionId}`;
    let s = this.sessions.get(key);
    if (!s) {
      s = createSessionState(sessionId, provider);
      this.sessions.set(key, s);
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

  private setProviderStateDefaults(provider: Provider, dir = '', found = false): void {
    this.providerState.set(provider, {
      dir,
      found,
      enabled: true,
      limits: { status: 'loading', perModelWeekly: [] },
      scan: { done: false, filesDone: 0, filesTotal: 0 },
      history: new LimitHistory(),
    });
  }

  private provider(provider: Provider) {
    if (!this.providerState.has(provider)) this.setProviderStateDefaults(provider);
    return this.providerState.get(provider)!;
  }

  setProviderDirectory(provider: Provider, dir: string, found: boolean): void {
    Object.assign(this.provider(provider), { dir, found });
    if (provider === 'claude') this.claudeDirFound = found;
    this.markDirty();
  }

  setProviderEnabled(provider: Provider, enabled: boolean): void {
    this.provider(provider).enabled = enabled;
    this.markDirty();
  }

  /** Replace a normalized rollout after appended data changes provisional accounting. */
  replaceProviderSession(sessionId: string, events: TranscriptEvent[], provider: Provider = 'codex'): void {
    this.provider(provider);
    const key = `${provider}:${sessionId}`;
    this.sessions.delete(key);
    for (let i = this.records.length - 1; i >= 0; i--) {
      const record = this.records[i]!;
      if ((record.provider ?? 'claude') === provider && record.sessionId === sessionId)
        this.records.splice(i, 1);
    }
    this.dedup = new DedupSet();
    for (const record of this.records) this.dedup.add(`${record.provider ?? 'claude'}:${record.key}`);
    this.applyEvents(sessionId, events, provider);
  }

  private providerSnapshot(provider: Provider, now: number): ProviderSnapshot {
    const state = this.provider(provider);
    const records = this.records.filter((record) => (record.provider ?? 'claude') === provider);
    const lookup = this.lookup ? (model: string) => this.lookup!(model, provider) : null;
    const limitDuration = (limit: LimitsState['block']) =>
      limit?.durationMs ?? (limit?.windowMinutes === undefined ? undefined : limit.windowMinutes * 60_000);
    const block = state.limits.block?.resetsAt;
    const week = state.limits.weekly?.resetsAt;
    const validCodexBlock =
      provider !== 'codex' || (block !== undefined && (limitDuration(state.limits.block) ?? 0) > 0);
    const blockWindow: TimeWindow =
      block === undefined
        ? (deriveCurrentBlock(
            records.map((record) => record.timestamp).sort((a, b) => a - b),
            now,
          ) ?? { start: now, end: now })
        : blockWindowFromLimit(block, now, limitDuration(state.limits.block));
    const weekWindow =
      week === undefined
        ? rollingWeekWindow(now)
        : weekWindowFromLimit(week, now, limitDuration(state.limits.weekly));
    const canProject = (limit: LimitsState['block']) => {
      if (provider === 'claude') return true;
      const observedAt = limit?.observedAt ?? state.limits.observedAt;
      return (
        state.limits.status === 'ok' &&
        limit?.resetsAt !== undefined &&
        limit.resetsAt > now &&
        (observedAt === undefined || now - observedAt <= 5 * 60_000)
      );
    };
    const blockBurn = canProject(state.limits.block)
      ? projectBurn(state.limits.block, state.history.samples('block'), now, 'block')
      : undefined;
    const weekBurn = canProject(state.limits.weekly)
      ? projectBurn(state.limits.weekly, state.history.samples('week'), now, 'week')
      : undefined;
    return {
      dir: sanitizeText(state.dir),
      found: state.found,
      enabled: state.enabled,
      limits: state.limits,
      costs: {
        block: validCodexBlock
          ? sanitizeWindowTotals(totalsForWindow(records, blockWindow, lookup))
          : { ...emptyWindowTotals(), costUSD: null },
        today: sanitizeWindowTotals(totalsForWindow(records, todayWindow(now), lookup)),
        week: sanitizeWindowTotals(totalsForWindow(records, weekWindow, lookup)),
        month: sanitizeWindowTotals(totalsForWindow(records, monthWindow(now), lookup)),
        burnRatePerHour: burnRatePerHour(records, now, lookup),
        hourlySparkline: hourlySparkline(records, now, lookup),
      },
      pricingStatus: this.pricingStatus,
      unknownModels: unknownModelsIn(records, lookup).map(sanitizeText),
      scan: state.scan,
      burn: { ...(blockBurn ? { block: blockBurn } : {}), ...(weekBurn ? { week: weekBurn } : {}) },
      accountingIncomplete: [...this.sessions.values()].some(
        (session) => session.provider === provider && session.meta.accountingIncomplete,
      ),
    };
  }

  private compute(): Snapshot {
    const now = this.opts.now();
    const lookup = this.lookup;
    const cutoff = now - this.opts.endedWindowHours * 3_600_000;
    const sessions: SessionView[] = [];
    const warnings: string[] = [];
    for (const s of this.sessions.values()) {
      if (!this.provider(s.provider).enabled) continue;
      if (s.live && s.provider === 'claude') {
        const v = sessionVersion(s);
        const warning = v && !isTestedVersion(v) ? `⚠ untested Claude Code v${sanitizeText(v)}` : null;
        if (warning && !warnings.includes(warning)) warnings.push(warning);
      }
      // endedWindowHours === 0 means "remove on exit": ended and history-only sessions are hidden.
      const recentlyObserved =
        s.provider === 'codex' &&
        s.meta.observedStatus !== 'ended' &&
        lastActivityOf(s) >= now - (this.opts.idleCutoffMinutes ?? 60) * 60_000;
      const visible =
        s.live ||
        recentlyObserved ||
        (this.opts.endedWindowHours > 0 && (lastActivityOf(s) >= cutoff || (s.endedAt ?? 0) >= cutoff));
      if (!visible) continue;
      const view = buildSessionView(s, lookup);
      view.recentlyObserved = recentlyObserved;
      if (s.provider === 'codex' && !recentlyObserved) {
        view.status = s.meta.observedStatus === 'ended' ? 'ended' : 'unknown';
      }
      if (view.cwd) view.project = sanitizeText(this.projects.get(view.cwd) ?? basename(view.cwd));
      const proc = s.live && s.registry ? this.procStats.get(s.registry.pid) : undefined;
      if (proc) {
        view.cpuPercent = proc.cpuPercent;
        view.memBytes = proc.rssBytes;
      }
      sessions.push(view);
    }
    const providers: Partial<Record<Provider, ProviderSnapshot>> = {};
    for (const provider of this.providerState.keys())
      providers[provider] = this.providerSnapshot(provider, now);
    const claude = providers.claude!;
    return {
      providers,
      now,
      claudeDirFound: this.claudeDirFound,
      claudeDir: claude.dir,
      limits: claude.limits,
      costs: claude.costs,
      pricingStatus: claude.pricingStatus,
      unknownModels: claude.unknownModels,
      scan: claude.scan,
      sessions,
      warnings,
      ...(this.system ? { system: this.system } : {}),
      systemHistory: {
        cpu: [...this.sysHistory.cpu],
        rx: [...this.sysHistory.rx],
        tx: [...this.sysHistory.tx],
      },
      burn: claude.burn,
    };
  }
}

function isTestedVersion(version: string): boolean {
  const [major, minor] = version.split('.');
  return `${major}.${minor}` === TESTED_MAJOR_MINOR;
}
