import { createHash } from 'node:crypto';
import { RETENTION_DAYS } from '../domain/windows.js';
import { lstat, mkdir, readdir, readFile, stat as fsStat, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { decompress } from 'fzstd';
import type { LimitsState, ScanProgress, TranscriptEvent } from '../domain/types.js';
import {
  codexLimits,
  decodeCodexObservation,
  parseCodexRecord,
  projectCodexSession,
  type CodexObservation,
  type CodexSessionMetadata,
} from './codexParser.js';
import { readRangeFromDisk } from './transcriptTailer.js';

const DAY_MS = 86400000;
const CACHE_SAVE_INTERVAL_MS = 60000;
const CACHE_VERSION = 1;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const FILE_ID = new RegExp(`(${UUID})(?:_${UUID})?\\.jsonl(?:\\.zst)?$`, 'i');

interface FileStat {
  size: number;
  mtimeMs: number;
  ino?: number;
  isDirectory(): boolean;
  isSymbolicLink?(): boolean;
}
export interface CodexMonitorDeps {
  now?: () => number;
  readdir?: (path: string) => Promise<string[]>;
  stat?: (path: string) => Promise<FileStat>;
  readRange?: (path: string, start: number, end: number) => Promise<Buffer>;
  readFile?: (path: string) => Promise<string>;
  writeFile?: (path: string, data: string) => Promise<void>;
  mkdir?: (path: string) => Promise<unknown>;
}
export interface CodexMonitorOptions {
  codexDir: string;
  cacheDir: string;
  pollMs?: number;
  maxAgeDays?: number;
  deps?: CodexMonitorDeps;
  onSession: (sessionId: string, events: TranscriptEvent[], metadata: CodexSessionMetadata) => void;
  onLimits: (state: LimitsState) => void;
  onProgress: (progress: ScanProgress) => void;
  onDirectory: (found: boolean) => void;
}

interface CacheEntry {
  size: number;
  mtimeMs: number;
  ino?: number;
  offset: number;
  prefix: string;
  observations: CodexObservation[];
  incomplete: boolean;
}
interface CachedFiles {
  version: number;
  codexDir: string;
  files: Record<string, CacheEntry>;
}
const hash = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');

/** Passive observer: only app-owned cache writes, and no Codex subprocess or auth access. */
export class CodexMonitor {
  private readonly options: CodexMonitorOptions;
  private readonly deps: Required<CodexMonitorDeps>;
  private readonly root: string;
  private readonly cacheFile: string | undefined;
  private files: Record<string, CacheEntry> = {};
  private loaded = false;
  private stopped = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private pending: Promise<void> | undefined;
  private readonly projections = new Map<string, string>();
  private limitObservations: CodexObservation[] = [];
  private limitsSignature: string | undefined;
  /** Parent session per projected session, for re-projecting forks when their parent changes. */
  private readonly sessionParents = new Map<string, string>();
  private readonly limitCache = new WeakMap<CacheEntry, Map<string, CodexObservation>>();
  private initialScanDone = false;
  private lastProgress: ScanProgress | undefined;
  private cacheDirty = false;
  private lastCacheSave = Number.NEGATIVE_INFINITY;
  private cacheWrite: Promise<void> = Promise.resolve();

  constructor(options: CodexMonitorOptions) {
    this.options = options;
    this.root = resolve(options.codexDir);
    const cacheDir = resolve(options.cacheDir);
    const relation = relative(this.root, cacheDir);
    // An accidental source/cache overlap must never write into Codex home.
    this.cacheFile =
      relation !== '' && (relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation))
        ? join(cacheDir, 'codex-scan-cache.json')
        : undefined;
    const d = options.deps ?? {};
    this.deps = {
      now: d.now ?? Date.now,
      readdir: d.readdir ?? ((path) => readdir(path)),
      stat: d.stat ?? lstat,
      readRange: d.readRange ?? readRangeFromDisk,
      readFile: d.readFile ?? ((path) => readFile(path, 'utf8')),
      writeFile: d.writeFile ?? ((path, data) => writeFile(path, data, 'utf8')),
      mkdir: d.mkdir ?? ((path) => mkdir(path, { recursive: true })),
    };
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.pollOnce();
    if (!this.stopped && !this.timer) {
      this.timer = setInterval(() => {
        void this.pollOnce();
      }, this.options.pollMs ?? 2000);
      this.timer.unref();
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    // Best-effort final flush; the write is fire-and-forget because stop() is synchronous. Skipped
    // mid-scan: appends reuse cached observation arrays, so this.files may be half-updated.
    if (!this.pending) void this.saveCache(true);
  }

  /** Concurrent polls share a pass; stop suppresses callbacks from in-flight I/O. */
  pollOnce(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.pending) return this.pending;
    this.pending = this.scan()
      .catch(() => {
        // Filesystem failures must not tear down the dashboard or the poll timer.
      })
      .finally(() => {
        this.pending = undefined;
      });
    return this.pending;
  }

  private async scan(): Promise<void> {
    if (!this.loaded) {
      this.files = await this.loadCache();
      this.loaded = true;
    }
    let directoryFound = false;
    let unreadable = false;
    try {
      const rootStat = this.options.deps?.stat ? await this.deps.stat(this.root) : await fsStat(this.root);
      directoryFound = rootStat.isDirectory();
    } catch (error) {
      unreadable = (error as NodeJS.ErrnoException).code !== 'ENOENT';
    }
    if (this.stopped) return;
    this.options.onDirectory(directoryFound);
    if (unreadable) {
      if (this.projections.size === 0) this.emitProjections(new Set());
      else this.emitLimits();
      this.emitFinalProgress({ done: true, filesDone: 0, filesTotal: 0 });
      return;
    }
    const discovered = directoryFound ? await this.discoverFiles() : [];
    const next: Record<string, CacheEntry> = {};
    let filesDone = 0;
    const reportProgress = !this.initialScanDone;
    if (reportProgress) this.options.onProgress({ done: false, filesDone, filesTotal: discovered.length });
    for (const file of discovered) {
      if (this.stopped) return;
      try {
        next[file] = await this.scanFile(file, this.files[file]);
      } catch {
        // Keep last-known observations through transient permission/read errors.
        if (this.files[file]) next[file] = this.files[file]!;
      }
      filesDone++;
      if (reportProgress && !this.stopped)
        this.options.onProgress({ done: false, filesDone, filesTotal: discovered.length });
      await new Promise<void>((done) => setImmediate(done));
    }
    if (this.stopped) return;
    // Files that are new, rewritten/appended or removed; unchanged entries keep their identity.
    const previousFiles = this.files;
    const changedFiles: { file: string; before?: CacheEntry; after?: CacheEntry }[] = [];
    for (const [file, entry] of Object.entries(next)) {
      if (previousFiles[file] !== entry)
        changedFiles.push({ file, before: previousFiles[file], after: entry });
    }
    for (const [file, entry] of Object.entries(previousFiles)) {
      if (!(file in next)) changedFiles.push({ file, before: entry });
    }
    this.files = next;
    const changed = changedFiles.length > 0;
    if (changed) {
      const dirty = new Set<string>();
      for (const { file, before, after } of changedFiles) {
        for (const entry of [before, after]) {
          const id = entry && this.sessionIdOf(file, entry);
          if (id) dirty.add(id);
        }
      }
      this.emitProjections(dirty);
      this.cacheDirty = true;
    } else if (this.projections.size === 0) this.emitProjections(new Set());
    else this.emitLimits();
    this.initialScanDone = true;
    this.emitFinalProgress({ done: true, filesDone, filesTotal: discovered.length });
    if (this.cacheDirty && this.deps.now() - this.lastCacheSave >= CACHE_SAVE_INTERVAL_MS)
      await this.saveCache();
  }

  /** After the initial scan, progress is only reported when its value actually changes. */
  private emitFinalProgress(progress: ScanProgress): void {
    const last = this.lastProgress;
    if (
      this.initialScanDone &&
      last &&
      last.done === progress.done &&
      last.filesDone === progress.filesDone &&
      last.filesTotal === progress.filesTotal
    )
      return;
    this.lastProgress = progress;
    this.options.onProgress(progress);
  }

  private emitLimits(): void {
    if (this.stopped) return;
    const state = codexLimits(this.limitObservations, this.deps.now());
    const signature = JSON.stringify(state);
    if (signature === this.limitsSignature) return;
    this.limitsSignature = signature;
    this.options.onLimits(state);
  }

  private sessionIdOf(file: string, entry: CacheEntry): string | undefined {
    // Real rollouts use UUID filenames, allowing copied metadata to remain owned by its source.
    return (
      FILE_ID.exec(basename(file))?.[1] ?? entry.observations.find((o) => o.kind === 'session')?.sessionId
    );
  }

  private async discoverFiles(): Promise<string[]> {
    const cutoff = this.deps.now() - (this.options.maxAgeDays ?? RETENTION_DAYS) * DAY_MS;
    const candidates = new Set<string>();
    const walk = async (directory: string, depth: number): Promise<void> => {
      let names: string[];
      try {
        names = (await this.deps.readdir(directory)).sort();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          for (const file of Object.keys(this.files)) {
            if (file.startsWith(`${directory}${sep}`)) candidates.add(file);
          }
        }
        return;
      }
      for (const name of names) {
        if (this.stopped) return;
        // Directory entries cannot redirect traversal outside the source root.
        if (name === '.' || name === '..' || name.includes('/') || name.includes('\\')) continue;
        const file = join(directory, name);
        let stat: FileStat;
        try {
          stat = await this.deps.stat(file);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && this.files[file]) candidates.add(file);
          continue;
        }
        if (stat.isSymbolicLink?.()) continue;
        if (stat.isDirectory()) {
          if (depth < 3) await walk(file, depth + 1);
        } else if (/^rollout-.*\.jsonl(?:\.zst)?$/.test(name) && stat.mtimeMs >= cutoff) candidates.add(file);
      }
    };
    await walk(join(this.root, 'sessions'), 0);
    await walk(join(this.root, 'archived_sessions'), 0);
    return [...candidates]
      .filter((file) => !file.endsWith('.zst') || !candidates.has(file.slice(0, -4)))
      .sort();
  }

  private async scanFile(file: string, previous: CacheEntry | undefined): Promise<CacheEntry> {
    const stat = await this.deps.stat(file);
    if (stat.isSymbolicLink?.()) throw new Error('Symlink rollout skipped');
    if (
      previous &&
      previous.size === stat.size &&
      previous.mtimeMs === stat.mtimeMs &&
      previous.ino === stat.ino
    )
      return previous;
    if (file.endsWith('.zst')) {
      const bytes = await this.deps.readRange(file, 0, stat.size);
      const text = Buffer.from(decompress(bytes)).toString('utf8');
      const observations: CodexObservation[] = [];
      const incomplete = this.parseLines(text, observations);
      return {
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        ino: stat.ino,
        offset: stat.size,
        prefix: '',
        observations,
        incomplete,
      };
    }
    let append = previous !== undefined && stat.size > previous.size && stat.ino === previous.ino;
    if (append && previous) {
      const prefix = await this.deps.readRange(file, 0, Math.min(previous.offset, 256));
      append = hash(prefix) === previous.prefix;
    }
    const start = append ? previous!.offset : 0;
    const bytes = await this.deps.readRange(file, start, stat.size);
    // Reads that can fail happen before the previous observation array is mutated in place.
    const lastNewline = bytes.lastIndexOf(0x0a);
    const offset = start + lastNewline + 1;
    const prefix =
      start === 0
        ? bytes.subarray(0, Math.min(offset, 256))
        : await this.deps.readRange(file, 0, Math.min(offset, 256));
    // The superseded cache entry is discarded after this call, so its array can be reused.
    const observations = append ? previous!.observations : [];
    const malformed =
      lastNewline >= 0
        ? this.parseLines(bytes.subarray(0, lastNewline + 1).toString('utf8'), observations)
        : false;
    return {
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      ino: stat.ino,
      offset,
      prefix: hash(prefix),
      observations,
      incomplete: (append && previous!.incomplete) || malformed,
    };
  }

  private parseLines(text: string, observations: CodexObservation[]): boolean {
    let malformed = false;
    for (const line of text.split('\n')) {
      if (line.trim() === '') continue;
      try {
        const raw: unknown = JSON.parse(line);
        const observation = parseCodexRecord(raw);
        if (observation) observations.push(observation);
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
          const value = raw as Record<string, unknown>;
          if (value.type === 'token_usage_record' && !observation) malformed = true;
          if (value.type === 'event_msg' && value.payload && typeof value.payload === 'object') {
            const payload = value.payload as Record<string, unknown>;
            if (
              payload.type === 'token_count' &&
              payload.info !== undefined &&
              payload.info !== null &&
              !observation?.usage
            )
              malformed = true;
          }
        }
      } catch {
        malformed = true;
      }
    }
    return malformed;
  }

  private emitProjections(dirty: ReadonlySet<string>): void {
    // Cheap pass over file names only: which files belong to which session.
    const owners = new Map<string, { entries: CacheEntry[]; archived: boolean }>();
    const limitBuckets = new Map<string, CodexObservation>();
    const archivedRoot = join(this.root, 'archived_sessions') + sep;
    for (const [file, entry] of Object.entries(this.files)) {
      const sessionId = this.sessionIdOf(file, entry);
      if (!sessionId) continue;
      const existing = owners.get(sessionId) ?? { entries: [], archived: true };
      existing.entries.push(entry);
      existing.archived &&= file.startsWith(archivedRoot);
      owners.set(sessionId, existing);
      for (const [bucket, observation] of this.latestLimits(entry)) {
        const current = limitBuckets.get(bucket);
        if (!current || observation.timestamp >= current.timestamp) limitBuckets.set(bucket, observation);
      }
    }
    // Forks depend on their parent's turn ids, so a changed parent re-projects its children.
    // The first emission (e.g. after a restart with a warm cache) has no dirty files, so it projects all.
    const toProject = this.initialScanDone
      ? new Set([...dirty].filter((id) => owners.has(id)))
      : new Set(owners.keys());
    for (const [child, parent] of this.sessionParents) {
      if (dirty.has(parent) && owners.has(child)) toProject.add(child);
    }
    const merged = new Map<string, CodexObservation[]>();
    const mergedFor = (sessionId: string): CodexObservation[] | undefined => {
      const cached = merged.get(sessionId);
      if (cached) return cached;
      const owner = owners.get(sessionId);
      if (!owner) return undefined;
      const seen = new Set<string>();
      const observations: CodexObservation[] = [];
      for (const entry of owner.entries) {
        for (const observation of entry.observations) {
          const key = observationKey(observation);
          if (seen.has(key)) continue;
          seen.add(key);
          observations.push(observation);
        }
      }
      observations.sort((a, b) => a.timestamp - b.timestamp);
      merged.set(sessionId, observations);
      return observations;
    };
    for (const sessionId of toProject) {
      const owner = owners.get(sessionId)!;
      const observations = mergedFor(sessionId)!;
      const sessionMeta = observations.find((o) => o.kind === 'session' && o.sessionId === sessionId);
      const parentId = sessionMeta?.forkedFromId ?? sessionMeta?.parentSessionId;
      if (parentId) this.sessionParents.set(sessionId, parentId);
      else this.sessionParents.delete(sessionId);
      const parentObservations = parentId ? mergedFor(parentId) : undefined;
      const parentTurnIds =
        parentObservations === undefined
          ? undefined
          : new Set(parentObservations.flatMap((o) => (o.turnId ? [o.turnId] : [])));
      const projection = projectCodexSession(observations, {
        sessionId,
        parentTurnIds,
        incomplete: owner.entries.some((entry) => entry.incomplete),
      });
      if (owner.archived) {
        projection.metadata.observedStatus = 'ended';
        for (const event of projection.events) {
          if (event.kind === 'meta') event.observedStatus = 'ended';
        }
      }
      const signature = hash(JSON.stringify(projection));
      if (this.projections.get(sessionId) !== signature && !this.stopped) {
        this.projections.set(sessionId, signature);
        this.options.onSession(sessionId, projection.events, projection.metadata);
      }
    }
    // Remove rows/usage when source files are actually removed or leave the retention window.
    for (const sessionId of [...this.projections.keys()]) {
      if (owners.has(sessionId) || this.stopped) continue;
      this.projections.delete(sessionId);
      this.sessionParents.delete(sessionId);
      this.options.onSession(sessionId, [], {
        lastActivity: 0,
        observedStatus: 'unknown',
        accountingIncomplete: true,
        isSidechain: false,
      });
    }
    this.limitObservations = [...limitBuckets.values()];
    this.emitLimits();
  }

  /** Latest observation per limit bucket for one file entry; entries are immutable once published. */
  private latestLimits(entry: CacheEntry): Map<string, CodexObservation> {
    let latest = this.limitCache.get(entry);
    if (!latest) {
      latest = new Map();
      for (const observation of entry.observations) {
        if (observation.limitBucket === undefined) continue;
        const current = latest.get(observation.limitBucket);
        if (!current || observation.timestamp >= current.timestamp)
          latest.set(observation.limitBucket, observation);
      }
      this.limitCache.set(entry, latest);
    }
    return latest;
  }

  private async loadCache(): Promise<Record<string, CacheEntry>> {
    if (!this.cacheFile) return {};
    try {
      const cache = JSON.parse(await this.deps.readFile(this.cacheFile)) as Partial<CachedFiles>;
      if (
        cache.version !== CACHE_VERSION ||
        cache.codexDir !== this.root ||
        !cache.files ||
        typeof cache.files !== 'object'
      )
        return {};
      const valid: Record<string, CacheEntry> = {};
      for (const [file, entry] of Object.entries(cache.files)) {
        if (
          resolve(file) !== file ||
          !/^rollout-.*\.jsonl(?:\.zst)?$/.test(basename(file)) ||
          !['sessions', 'archived_sessions'].some((folder) => file.startsWith(join(this.root, folder) + sep))
        )
          continue;
        if (
          !entry ||
          !Number.isSafeInteger(entry.size) ||
          entry.size < 0 ||
          !Number.isFinite(entry.mtimeMs) ||
          !Number.isSafeInteger(entry.offset) ||
          entry.offset < 0 ||
          entry.offset > entry.size ||
          typeof entry.prefix !== 'string' ||
          !Array.isArray(entry.observations) ||
          typeof entry.incomplete !== 'boolean'
        )
          continue;
        const observations = entry.observations.map(decodeCodexObservation);
        if (observations.some((o) => o === undefined)) continue;
        valid[file] = {
          size: entry.size,
          mtimeMs: entry.mtimeMs,
          ino: entry.ino,
          offset: entry.offset,
          prefix: entry.prefix,
          incomplete: entry.incomplete,
          observations: observations as CodexObservation[],
        };
      }
      return valid;
    } catch {
      return {};
    }
  }

  /** Writes are debounced by the caller; `final` flushes even after stop(). Writes are serialized. */
  private saveCache(final = false): Promise<void> {
    if (!this.cacheFile || (this.stopped && !final) || !this.cacheDirty) return Promise.resolve();
    this.cacheDirty = false;
    this.lastCacheSave = this.deps.now();
    const cacheFile = this.cacheFile;
    const write = async (): Promise<void> => {
      try {
        await this.deps.mkdir(resolve(this.options.cacheDir));
        await this.deps.writeFile(
          cacheFile,
          JSON.stringify({
            version: CACHE_VERSION,
            codexDir: this.root,
            files: this.files,
          } satisfies CachedFiles),
        );
      } catch {
        /* Cache is only an optimization. */
      }
    };
    this.cacheWrite = this.cacheWrite.then(write);
    return this.cacheWrite;
  }
}

/** Equivalent to JSON.stringify(observation) for duplicate detection, without allocating the JSON. */
function observationKey(o: CodexObservation): string {
  const usage = (u: CodexObservation['usage']) =>
    u ? `${u.input},${u.cached},${u.cacheWrite},${u.output},${u.reasoning},${u.total}` : '';
  const limits = o.limits
    ? JSON.stringify(
        o.limits.map((l) => [
          l.observedAt,
          l.id,
          l.windowMinutes,
          l.durationMs,
          l.label,
          l.percent,
          l.resetsAt,
        ]),
      )
    : '';
  // JSON-encode the free-text fields so separators inside values cannot create collisions.
  return (
    JSON.stringify([
      o.timestamp,
      o.kind,
      o.sessionId,
      o.parentSessionId,
      o.forkedFromId,
      o.cwd,
      o.version,
      o.gitBranch,
      o.model,
      o.startedAt,
      o.contextWindow,
      o.turnId,
      o.responseId,
      o.limitBucket,
      o.status,
    ]) +
    `|${usage(o.usage)}|${usage(o.lastUsage)}|${o.limits ? limits : ''}|${o.usage ? 1 : 0}${o.lastUsage ? 1 : 0}${o.limits ? 1 : 0}`
  );
}
