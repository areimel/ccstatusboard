// Wires collectors to the Store. All IO lives in collectors; this file only routes events.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Config, LimitsState, RegistryEntry, TranscriptEvent } from '../domain/types.js';
import { Store } from '../store/store.js';
import { findTranscript } from '../core/paths.js';
import { parseTranscriptLine } from '../collectors/transcriptParser.js';
import { PricingProvider } from '../collectors/pricing.js';
import { TranscriptTailer, type TailerDeps } from '../collectors/transcriptTailer.js';
import { HistoryScanner } from '../collectors/historyScanner.js';
import { SessionRegistry } from '../collectors/sessionRegistry.js';
import { createProjectResolver } from '../collectors/projectName.js';
import { scanSubagents } from '../collectors/subagents.js';
import { ProcStatsSampler, type ProcStatsDeps } from '../collectors/procStats.js';
import { SystemMonitor, type SystemMonitorDeps } from '../collectors/system/systemMonitor.js';
import { UsagePoller } from '../collectors/usageApi.js';
import { CodexMonitor } from '../collectors/codexMonitor.js';
import type { CredentialsResult } from '../collectors/credentials.js';

export interface Runtime {
  store: Store;
  start(): Promise<void>;
  stop(): void;
  /** Applies live config changes to the store and the usage poller. */
  applyConfig(patch: Partial<Config>): void;
}

export interface RuntimeOptions {
  config: Config;
  claudeDir: string;
  codexDir?: string;
  cacheDir: string;
  version: string;
  now?: () => number;
  fetch?: typeof fetch;
  /** cwd → project name resolver override (tests stub it to avoid spawning git). */
  resolveProject?: (cwd: string) => Promise<string>;
  /** System monitor: `false` disables it (tests); partial deps replace the real IO. */
  systemMonitor?: false | Partial<SystemMonitorDeps>;
  /** Per-process sampler: `false` disables it (tests); partial deps replace the real IO. */
  procStats?: false | Partial<ProcStatsDeps>;
  /** Credentials reader override (tests use it to keep off the real macOS Keychain). */
  readCredentials?: (claudeDir: string) => Promise<CredentialsResult>;
  /** Agent-scan interval override (tests). */
  agentScanMs?: number;
  /** IO overrides for the agent scan (tests). */
  agentDeps?: {
    findTranscript?: typeof findTranscript;
    scanSubagents?: typeof scanSubagents;
    tailer?: TailerDeps;
  };
}

const AGENT_SCAN_MS = 5_000;
const PROC_SAMPLE_MS = 2_000;
const SUBAGENT_IDLE_RELEASE_MS = 10 * 60_000;
const FIND_BACKOFF_START_MS = 5_000;
const FIND_BACKOFF_MAX_MS = 60_000;
const PRICING_RELOAD_MS = 6 * 3_600_000; // load() itself honours the 24h TTL

interface TrackedFile {
  sessionId: string;
  isSubagent: boolean;
}

export function createRuntime(opts: RuntimeOptions): Runtime {
  const { config, claudeDir, cacheDir, version } = opts;
  const now = opts.now ?? Date.now;
  const claudeEnabled = config.providers.includes('claude');
  // Embedded runtimes must supply a path explicitly; never discover a developer's home in tests.
  const codexEnabled = config.providers.includes('codex') && opts.codexDir !== undefined;
  const fetchDep = opts.fetch ? { fetch: opts.fetch } : {};

  const store = new Store({
    now,
    refreshMs: config.refreshMs,
    endedWindowHours: config.endedWindowHours,
    idleCutoffMinutes: config.idleCutoffMinutes,
    claudeDir,
    claudeDirFound: existsSync(claudeDir),
  });
  store.setProviderEnabled('claude', claudeEnabled);
  store.setProviderDirectory('codex', opts.codexDir ?? '', codexEnabled && existsSync(opts.codexDir!));
  store.setProviderEnabled('codex', codexEnabled);
  if (!claudeEnabled) {
    store.setScanProgress({ done: true, filesDone: 0, filesTotal: 0 });
    store.setLimits({ status: 'disabled', perModelWeekly: [] });
  }

  const findTranscriptFn = opts.agentDeps?.findTranscript ?? findTranscript;
  const scanSubagentsFn = opts.agentDeps?.scanSubagents ?? scanSubagents;
  const resolveProject = opts.resolveProject ?? createProjectResolver();
  const files = new Map<string, TrackedFile>();
  const live = new Map<string, RegistryEntry>();
  /** sessionId → main transcript path, once found. */
  const mainTranscript = new Map<string, string>();
  /** Idle subagent files released from the tailer: remembered so a later write resumes at the offset. */
  const released = new Map<string, { sessionId: string; offset: number; mtimeMs: number }>();
  /** sessionId → retry schedule for findTranscript while no transcript exists yet. */
  const findBackoff = new Map<string, { nextAt: number; delayMs: number }>();
  const timers: NodeJS.Timeout[] = [];
  const every = (fn: () => Promise<unknown>, ms: number): void => {
    timers.push(setInterval(() => void fn().catch(() => undefined), ms));
  };
  let started = false;
  let stopped = false;

  const codex = codexEnabled
    ? new CodexMonitor({
        codexDir: opts.codexDir!,
        cacheDir,
        deps: { now },
        onSession: (sessionId, events) => {
          if (stopped) return;
          store.replaceProviderSession(sessionId, events, 'codex');
          const meta = events.findLast((event) => event.kind === 'meta' && event.cwd);
          if (meta?.kind === 'meta' && meta.cwd) {
            const cwd = meta.cwd;
            void resolveProject(cwd)
              .then((name) => {
                if (!stopped) store.setProject(cwd, name);
              })
              .catch(() => undefined);
          }
        },
        onLimits: (limits) => {
          if (!stopped) store.setLimits(limits, 'codex');
        },
        onProgress: (progress) => {
          if (!stopped) store.setScanProgress(progress, 'codex');
        },
        onDirectory: (found) => {
          if (!stopped) store.setProviderDirectory('codex', opts.codexDir!, found);
        },
      })
    : null;

  /** Store calls are routed through here so a late callback after stop() is a no-op. */
  const applyEvents = (sessionId: string, events: TranscriptEvent[]) => {
    if (!stopped && events.length > 0) store.applyEvents(sessionId, events);
  };

  const tailer = new TranscriptTailer({
    onLines: (file, lines) => {
      const t = files.get(file);
      if (!t) return;
      // The tailer swallows our exceptions after advancing its offset; catch per batch so one
      // bad batch never aborts the rest of this read pass.
      try {
        const events = lines.flatMap((l) =>
          parseTranscriptLine(l, { sessionId: t.sessionId, forceSidechain: t.isSubagent }),
        );
        applyEvents(t.sessionId, events);
      } catch {
        // Skip this batch; later lines still arrive.
      }
    },
    ...(opts.agentDeps?.tailer ? { deps: opts.agentDeps.tailer } : {}),
  });

  const track = (file: string, sessionId: string, isSubagent: boolean, startOffset = 0) => {
    if (files.has(file)) return;
    files.set(file, { sessionId, isSubagent });
    tailer.add(file, startOffset);
    void tailer.pollOnce(); // don't wait for the next interval tick
  };

  const attachTranscript = async (e: RegistryEntry) => {
    if (mainTranscript.has(e.sessionId)) return;
    const bo = findBackoff.get(e.sessionId);
    if (bo && now() < bo.nextAt) return;
    const path = await findTranscriptFn(claudeDir, e.cwd, e.sessionId);
    if (stopped || !live.has(e.sessionId)) return;
    if (!path) {
      // Not written yet: back off so a long-lived session without a transcript doesn't rescan every tick.
      const delayMs = bo ? Math.min(bo.delayMs * 2, FIND_BACKOFF_MAX_MS) : FIND_BACKOFF_START_MS;
      findBackoff.set(e.sessionId, { nextAt: now() + delayMs, delayMs });
      return;
    }
    findBackoff.delete(e.sessionId);
    mainTranscript.set(e.sessionId, path);
    track(path, e.sessionId, false);
  };

  /** Release idle, fully-read subagent files; resume released ones from their offset if they grow. */
  const syncSubagentFile = async (
    f: string,
    sessionId: string,
    mtimeMs: number | undefined,
  ): Promise<void> => {
    if (files.has(f)) {
      if (mtimeMs === undefined || now() - mtimeMs < SUBAGENT_IDLE_RELEASE_MS) return;
      if (!(await tailer.isCaughtUp(f)) || stopped || !files.has(f)) return;
      const offset = tailer.offsetOf(f);
      if (offset === undefined) return;
      tailer.remove(f);
      files.delete(f);
      released.set(f, { sessionId, offset, mtimeMs });
      return;
    }
    const rel = released.get(f);
    if (!rel) return track(f, sessionId, true);
    if (mtimeMs === undefined || mtimeMs <= rel.mtimeMs) return;
    released.delete(f);
    track(f, sessionId, true, rel.offset);
  };

  let scanningAgents = false;
  const scanAgents = async () => {
    if (scanningAgents) return;
    scanningAgents = true;
    try {
      for (const e of [...live.values()]) {
        if (stopped) return;
        const main = mainTranscript.get(e.sessionId);
        if (!main) {
          await attachTranscript(e); // transcript may not exist yet right after a session starts
          continue;
        }
        const activity = await scanSubagentsFn(join(dirname(main), e.sessionId, 'subagents'), now());
        if (stopped || !live.has(e.sessionId)) continue;
        store.setAgents(e.sessionId, {
          activeCount: activity.activeCount,
          names: activity.names,
          agents: activity.agents,
        });
        for (const f of activity.files) {
          if (stopped || !live.has(e.sessionId)) break;
          await syncSubagentFile(f, e.sessionId, activity.mtimes[f]);
        }
      }
      if (!stopped) store.setClaudeDirFound(existsSync(claudeDir));
    } finally {
      scanningAgents = false;
    }
  };

  const registry = new SessionRegistry({
    claudeDir,
    onUpsert: (e) => {
      store.upsertRegistry(e);
      void resolveProject(e.cwd)
        .then((name) => {
          if (!stopped) store.setProject(e.cwd, name);
        })
        .catch(() => undefined);
      const known = live.has(e.sessionId);
      live.set(e.sessionId, e);
      if (!known) void attachTranscript(e).catch(() => undefined);
    },
    onEnded: (sessionId) => {
      store.markEnded(sessionId);
      live.delete(sessionId);
      mainTranscript.delete(sessionId);
      findBackoff.delete(sessionId);
      for (const [file, r] of released) if (r.sessionId === sessionId) released.delete(file);
      for (const [file, t] of files) {
        if (t.sessionId === sessionId) {
          tailer.remove(file);
          files.delete(file);
        }
      }
    },
  });

  const pricing = new PricingProvider({ cacheDir, deps: { ...fetchDep, now } });
  const loadPricing = async () => {
    const r = await pricing.load();
    if (!stopped) store.setPricing(r.lookup, r.status);
  };

  const scanner = new HistoryScanner({
    claudeDir,
    cacheDir,
    deps: { now },
    onEvents: applyEvents,
    onProgress: (p) => {
      if (!stopped) store.setScanProgress(p);
    },
  });

  const poller = new UsagePoller({
    claudeDir,
    intervalSeconds: config.usagePollSeconds,
    version,
    enabled: claudeEnabled && config.usageApi,
    deps: { ...fetchDep, now, ...(opts.readCredentials ? { readCredentials: opts.readCredentials } : {}) },
    // An in-flight poll may resolve after stop(); drop it.
    onUpdate: (l: LimitsState) => {
      if (!stopped) store.setLimits(l);
    },
  });

  const systemMonitor =
    opts.systemMonitor === false
      ? null
      : new SystemMonitor(
          {
            onUpdate: (stats) => {
              if (!stopped) store.setSystem(stats);
            },
          },
          opts.systemMonitor ?? {},
        );

  const procSampler = opts.procStats === false ? null : new ProcStatsSampler(opts.procStats ?? {});
  let sampling = false;
  const sampleProcs = async () => {
    if (!procSampler || sampling) return;
    sampling = true;
    try {
      const pids = [...live.values()].map((e) => e.pid);
      const stats = await procSampler.sample(pids);
      if (!stopped) store.setProcStats(stats);
    } finally {
      sampling = false;
    }
  };

  return {
    store,
    applyConfig(patch) {
      if (stopped) return;
      const o: { refreshMs?: number; endedWindowHours?: number; idleCutoffMinutes?: number } = {};
      if (patch.refreshMs !== undefined) o.refreshMs = patch.refreshMs;
      if (patch.endedWindowHours !== undefined) o.endedWindowHours = patch.endedWindowHours;
      if (patch.idleCutoffMinutes !== undefined) o.idleCutoffMinutes = patch.idleCutoffMinutes;
      if (Object.keys(o).length > 0) store.setOptions(o);
      if (patch.usagePollSeconds !== undefined) poller.setIntervalSeconds(patch.usagePollSeconds);
    },
    async start() {
      if (started || stopped) return;
      started = true;
      store.start();
      if (claudeEnabled) {
        tailer.start();
        poller.start();
      }
      systemMonitor?.start();
      if (procSampler) every(sampleProcs, PROC_SAMPLE_MS);
      if (claudeEnabled) {
        void scanner.run().catch(() => {
          if (!stopped) store.setScanProgress({ done: true, filesDone: 0, filesTotal: 0 });
        });
        every(scanAgents, opts.agentScanMs ?? AGENT_SCAN_MS);
      }
      every(loadPricing, PRICING_RELOAD_MS);
      await Promise.all([
        loadPricing().catch(() => {
          if (!stopped) store.setPricing(null, 'unavailable');
        }),
        ...(claudeEnabled ? [registry.scanOnce()] : []),
        ...(codex ? [codex.start()] : []),
      ]);
      if (!stopped && claudeEnabled) registry.start();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      for (const t of timers) clearInterval(t);
      registry.stop();
      tailer.stop();
      poller.stop();
      codex?.stop();
      systemMonitor?.stop();
      store.stop();
    },
  };
}
