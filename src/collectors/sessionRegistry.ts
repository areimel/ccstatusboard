import { readdir as fsReaddir, readFile as fsReadFile } from 'node:fs/promises';
import { watch as fsWatch, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import type { RegistryEntry } from '../domain/types.js';
import { sessionsDir } from '../core/paths.js';
import { isAlive as defaultIsAlive } from './liveness.js';

export interface RegistryDeps {
  readdir?: (dir: string) => Promise<string[]>;
  readFile?: (p: string) => Promise<string>;
  isAlive?: (pid: number, procStart?: string) => boolean;
  watch?: typeof fsWatch;
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);

/** Validate a parsed `<claude>/sessions/<pid>.json` record. Unknown fields are dropped. */
export function parseRegistryEntry(raw: unknown): RegistryEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const pid = num(r.pid);
  const sessionId = str(r.sessionId);
  const cwd = str(r.cwd);
  if (pid === undefined || sessionId === undefined || cwd === undefined) return null;

  const e: RegistryEntry = { pid, sessionId, cwd };
  const startedAt = num(r.startedAt);
  if (startedAt !== undefined) e.startedAt = startedAt;
  const procStart = typeof r.procStart === 'number' ? String(r.procStart) : str(r.procStart);
  if (procStart !== undefined) e.procStart = procStart;
  const version = str(r.version);
  if (version !== undefined) e.version = version;
  const kind = str(r.kind);
  if (kind !== undefined) e.kind = kind;
  const name = str(r.name);
  if (name !== undefined) e.name = name;
  const status = str(r.status);
  if (status !== undefined) e.status = status;
  const waitingFor = str(r.waitingFor);
  if (waitingFor !== undefined) e.waitingFor = waitingFor;
  const updatedAt = num(r.updatedAt);
  if (updatedAt !== undefined) e.updatedAt = updatedAt;
  const statusUpdatedAt = num(r.statusUpdatedAt);
  if (statusUpdatedAt !== undefined) e.statusUpdatedAt = statusUpdatedAt;
  return e;
}

export class SessionRegistry {
  private readonly dir: string;
  private readonly pollMs: number;
  private readonly readdir: (dir: string) => Promise<string[]>;
  private readonly readFile: (p: string) => Promise<string>;
  private readonly alive: (pid: number, procStart?: string) => boolean;
  private readonly watchFn: typeof fsWatch;
  private readonly onUpsert: (e: RegistryEntry) => void;
  private readonly onEnded: (sessionId: string, pid: number) => void;
  /** sessionId → entry for sessions live as of the last scan. */
  private live = new Map<string, RegistryEntry>();
  private scanning: Promise<void> | null = null;
  private rescan = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private watcher: FSWatcher | null = null;
  private stopped = false;

  constructor(opts: {
    claudeDir: string;
    pollMs?: number;
    deps?: RegistryDeps;
    onUpsert: (e: RegistryEntry) => void;
    onEnded: (sessionId: string, pid: number) => void;
  }) {
    const d = opts.deps ?? {};
    this.dir = sessionsDir(opts.claudeDir);
    this.pollMs = opts.pollMs ?? 2000;
    this.readdir = d.readdir ?? ((dir) => fsReaddir(dir));
    this.readFile = d.readFile ?? ((p) => fsReadFile(p, 'utf8'));
    this.alive = d.isAlive ?? ((pid, procStart) => defaultIsAlive(pid, procStart));
    this.watchFn = d.watch ?? fsWatch;
    this.onUpsert = opts.onUpsert;
    this.onEnded = opts.onEnded;
  }

  /** One full pass over the sessions dir. Concurrent calls coalesce into one extra pass. */
  scanOnce(): Promise<void> {
    if (this.scanning) {
      this.rescan = true;
      return this.scanning;
    }
    this.scanning = (async () => {
      do {
        this.rescan = false;
        await this.doScan();
      } while (this.rescan && !this.stopped);
    })().finally(() => {
      this.scanning = null;
    });
    return this.scanning;
  }

  private async doScan(): Promise<void> {
    let names: string[];
    try {
      names = await this.readdir(this.dir);
    } catch (err) {
      // A missing dir means no sessions; any other error is transient, so keep the last view.
      if ((err as NodeJS.ErrnoException | null)?.code !== 'ENOENT') return;
      names = [];
    }
    const seen = new Map<string, RegistryEntry>();
    for (const name of names) {
      // Only `<pid>.json`. Never touch `<pid>.<hash>.key` secrets or anything else.
      if (!name.endsWith('.json')) continue;
      let text: string;
      try {
        text = await this.readFile(join(this.dir, name));
      } catch {
        continue;
      }
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        // Caught mid-write: carry the previous entry for this pid so the row doesn't flicker to ended.
        const prev = this.previousEntryFor(name);
        if (prev && this.alive(prev.pid, prev.procStart)) seen.set(prev.sessionId, prev);
        continue;
      }
      const e = parseRegistryEntry(raw);
      if (!e) continue;
      if (!this.alive(e.pid, e.procStart)) continue;
      if (this.stopped) return;
      seen.set(e.sessionId, e);
      try {
        this.onUpsert(e);
      } catch {
        // A consumer error must never kill the scan.
      }
    }
    if (this.stopped) return;
    const prev = this.live;
    this.live = seen;
    for (const [sessionId, e] of prev) {
      if (this.stopped) return;
      if (seen.has(sessionId)) continue;
      try {
        this.onEnded(sessionId, e.pid);
      } catch {
        // swallow
      }
    }
  }

  /** The entry that was live last scan for registry file `<pid>.json`, if any. */
  private previousEntryFor(fileName: string): RegistryEntry | undefined {
    const pid = Number(fileName.slice(0, -'.json'.length));
    if (!Number.isInteger(pid)) return undefined;
    for (const e of this.live.values()) if (e.pid === pid) return e;
    return undefined;
  }

  start(): void {
    if (this.timer) return;
    this.stopped = false;
    const kick = (): void => {
      this.scanOnce().catch(() => {});
    };
    kick();
    this.timer = setInterval(kick, this.pollMs);
    try {
      const w = this.watchFn(this.dir, kick);
      w.on?.('error', () => {
        w.close();
        if (this.watcher === w) this.watcher = null;
      });
      this.watcher = w;
    } catch {
      // fs.watch unsupported or dir missing: polling alone is enough.
      this.watcher = null;
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.watcher?.close();
    this.watcher = null;
  }
}
