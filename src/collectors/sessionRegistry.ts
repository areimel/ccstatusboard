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
  /** sessionId → pid for sessions live as of the last scan. */
  private live = new Map<string, number>();
  private scanning: Promise<void> | null = null;
  private rescan = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private watcher: FSWatcher | null = null;

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
      } while (this.rescan);
    })().finally(() => {
      this.scanning = null;
    });
    return this.scanning;
  }

  private async doScan(): Promise<void> {
    let names: string[];
    try {
      names = await this.readdir(this.dir);
    } catch {
      names = [];
    }
    const seen = new Map<string, number>();
    for (const name of names) {
      // Only `<pid>.json`. Never touch `<pid>.<hash>.key` secrets or anything else.
      if (!name.endsWith('.json')) continue;
      let raw: unknown;
      try {
        raw = JSON.parse(await this.readFile(join(this.dir, name)));
      } catch {
        continue;
      }
      const e = parseRegistryEntry(raw);
      if (!e) continue;
      if (!this.alive(e.pid, e.procStart)) continue;
      seen.set(e.sessionId, e.pid);
      this.onUpsert(e);
    }
    for (const [sessionId, pid] of this.live) {
      if (!seen.has(sessionId)) this.onEnded(sessionId, pid);
    }
    this.live = seen;
  }

  start(): void {
    void this.scanOnce();
    this.timer = setInterval(() => void this.scanOnce(), this.pollMs);
    try {
      const w = this.watchFn(this.dir, () => void this.scanOnce());
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
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.watcher?.close();
    this.watcher = null;
  }
}
