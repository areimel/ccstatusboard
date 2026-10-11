// Wires collectors to the Store. All IO lives in collectors; this file only routes events.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Config, LimitsState, RegistryEntry, TranscriptEvent } from '../domain/types.js';
import { Store } from '../store/store.js';
import { findTranscript } from '../core/paths.js';
import { parseTranscriptLine } from '../collectors/transcriptParser.js';
import { PricingProvider } from '../collectors/pricing.js';
import { TranscriptTailer } from '../collectors/transcriptTailer.js';
import { HistoryScanner } from '../collectors/historyScanner.js';
import { SessionRegistry } from '../collectors/sessionRegistry.js';
import { scanSubagents } from '../collectors/subagents.js';
import { UsagePoller } from '../collectors/usageApi.js';
import type { CredentialsResult } from '../collectors/credentials.js';

export interface Runtime {
  store: Store;
  start(): Promise<void>;
  stop(): void;
}

export interface RuntimeOptions {
  config: Config;
  claudeDir: string;
  cacheDir: string;
  version: string;
  now?: () => number;
  fetch?: typeof fetch;
  /** Credentials reader override (tests use it to keep off the real macOS Keychain). */
  readCredentials?: (claudeDir: string) => Promise<CredentialsResult>;
}

const AGENT_SCAN_MS = 5_000;
const PRICING_RELOAD_MS = 6 * 3_600_000; // load() itself honours the 24h TTL

interface TrackedFile {
  sessionId: string;
  isSubagent: boolean;
}

export function createRuntime(opts: RuntimeOptions): Runtime {
  const { config, claudeDir, cacheDir, version } = opts;
  const now = opts.now ?? Date.now;
  const fetchDep = opts.fetch ? { fetch: opts.fetch } : {};

  const store = new Store({
    now,
    refreshMs: config.refreshMs,
    endedWindowHours: config.endedWindowHours,
    claudeDir,
    claudeDirFound: existsSync(claudeDir),
  });

  const files = new Map<string, TrackedFile>();
  const live = new Map<string, RegistryEntry>();
  /** sessionId → main transcript path, once found. */
  const mainTranscript = new Map<string, string>();
  const timers: NodeJS.Timeout[] = [];
  let started = false;
  let stopped = false;

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
  });

  const track = (file: string, sessionId: string, isSubagent: boolean) => {
    if (files.has(file)) return;
    files.set(file, { sessionId, isSubagent });
    tailer.add(file);
    void tailer.pollOnce(); // don't wait for the next interval tick
  };

  const attachTranscript = async (e: RegistryEntry) => {
    if (mainTranscript.has(e.sessionId)) return;
    const path = await findTranscript(claudeDir, e.cwd, e.sessionId);
    if (!path || stopped || !live.has(e.sessionId)) return;
    mainTranscript.set(e.sessionId, path);
    track(path, e.sessionId, false);
  };

  const scanAgents = async () => {
    for (const e of [...live.values()]) {
      if (stopped) return;
      const main = mainTranscript.get(e.sessionId);
      if (!main) {
        await attachTranscript(e); // transcript may not exist yet right after a session starts
        continue;
      }
      const activity = await scanSubagents(join(dirname(main), e.sessionId, 'subagents'), now());
      if (stopped || !live.has(e.sessionId)) continue;
      store.setAgents(e.sessionId, { activeCount: activity.activeCount, names: activity.names });
      for (const f of activity.files) track(f, e.sessionId, true);
    }
    if (!stopped) store.setClaudeDirFound(existsSync(claudeDir));
  };

  const registry = new SessionRegistry({
    claudeDir,
    onUpsert: (e) => {
      store.upsertRegistry(e);
      const known = live.has(e.sessionId);
      live.set(e.sessionId, e);
      if (!known) void attachTranscript(e).catch(() => undefined);
    },
    onEnded: (sessionId) => {
      store.markEnded(sessionId);
      live.delete(sessionId);
      mainTranscript.delete(sessionId);
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
    enabled: config.usageApi,
    deps: { ...fetchDep, now, ...(opts.readCredentials ? { readCredentials: opts.readCredentials } : {}) },
    // An in-flight poll may resolve after stop(); drop it.
    onUpdate: (l: LimitsState) => {
      if (!stopped) store.setLimits(l);
    },
  });

  return {
    store,
    async start() {
      if (started || stopped) return;
      started = true;
      store.start();
      tailer.start();
      poller.start();
      void scanner.run().catch(() => {
        if (!stopped) store.setScanProgress({ done: true, filesDone: 0, filesTotal: 0 });
      });
      timers.push(setInterval(() => void scanAgents().catch(() => undefined), AGENT_SCAN_MS));
      timers.push(setInterval(() => void loadPricing().catch(() => undefined), PRICING_RELOAD_MS));
      await Promise.all([
        loadPricing().catch(() => {
          if (!stopped) store.setPricing(null, 'unavailable');
        }),
        registry.scanOnce(),
      ]);
      if (!stopped) registry.start();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      for (const t of timers) clearInterval(t);
      registry.stop();
      tailer.stop();
      poller.stop();
      store.stop();
    },
  };
}
