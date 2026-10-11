// Startup scan of all recent transcripts, with an incremental on-disk cache so restarts only read new bytes.
import {
  mkdir as fsMkdir,
  readdir as fsReaddir,
  readFile as fsReadFile,
  stat as fsStat,
  writeFile as fsWriteFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { projectsDir, sessionIdFromTranscriptPath } from '../core/paths.js';
import type { ScanProgress, TranscriptEvent } from '../domain/types.js';
import { parseTranscriptLine } from './transcriptParser.js';
import { readRangeFromDisk } from './transcriptTailer.js';

const DAY_MS = 86_400_000;
const CACHE_VERSION = 1;

export interface ScanCacheEntry {
  mtimeMs: number;
  size: number;
  offset: number;
  events: TranscriptEvent[];
}

interface ScanCacheFile {
  version: number;
  claudeDir: string;
  files: Record<string, ScanCacheEntry>;
}

export interface HistoryScannerDeps {
  readdir?: (dir: string) => Promise<string[]>;
  stat?: (p: string) => Promise<{ mtimeMs: number; size: number; isDirectory(): boolean }>;
  readRange?: (p: string, start: number, end: number) => Promise<Buffer>;
  readFile?: (p: string) => Promise<string>;
  writeFile?: (p: string, data: string) => Promise<void>;
  mkdir?: (p: string) => Promise<unknown>;
  now?: () => number;
}

export interface HistoryScannerOptions {
  claudeDir: string;
  cacheDir: string;
  maxAgeDays?: number;
  deps?: HistoryScannerDeps;
  onEvents: (sessionId: string, events: TranscriptEvent[], file: string) => void;
  onProgress: (p: ScanProgress) => void;
}

const latestKey = (e: TranscriptEvent): string => (e.kind === 'title' ? `title:${e.source}` : e.kind);

/** Keep everything the store aggregates; for "latest wins" kinds keep only the last one. */
export function compactEvents(events: TranscriptEvent[]): TranscriptEvent[] {
  const lastIndex = new Map<string, number>();
  events.forEach((e, i) => {
    if (e.kind === 'usage' || e.kind === 'compact') return;
    lastIndex.set(latestKey(e), i);
  });
  return events.filter((e, i) => {
    if (e.kind === 'usage' || e.kind === 'compact') return true;
    return lastIndex.get(latestKey(e)) === i;
  });
}

function isValidEntry(e: unknown): e is ScanCacheEntry {
  if (typeof e !== 'object' || e === null) return false;
  const c = e as Partial<ScanCacheEntry>;
  return (
    Number.isFinite(c.mtimeMs) &&
    Number.isFinite(c.size) &&
    Number.isFinite(c.offset) &&
    Array.isArray(c.events)
  );
}

export class HistoryScanner {
  private readonly opts: HistoryScannerOptions;
  private readonly d: Required<HistoryScannerDeps>;
  private readonly cacheFile: string;

  constructor(opts: HistoryScannerOptions) {
    this.opts = opts;
    const d = opts.deps ?? {};
    this.d = {
      readdir: d.readdir ?? ((dir) => fsReaddir(dir)),
      stat: d.stat ?? fsStat,
      readRange: d.readRange ?? readRangeFromDisk,
      readFile: d.readFile ?? ((p) => fsReadFile(p, 'utf8')),
      writeFile: d.writeFile ?? ((p, data) => fsWriteFile(p, data, 'utf8')),
      mkdir: d.mkdir ?? ((p) => fsMkdir(p, { recursive: true })),
      now: d.now ?? Date.now,
    };
    this.cacheFile = join(opts.cacheDir, 'scan-cache.json');
  }

  async listFiles(): Promise<string[]> {
    const cutoff = this.d.now() - (this.opts.maxAgeDays ?? 35) * DAY_MS;
    const root = projectsDir(this.opts.claudeDir);
    const out: string[] = [];
    const recent = async (p: string) => {
      try {
        return (await this.d.stat(p)).mtimeMs >= cutoff;
      } catch {
        return false;
      }
    };
    for (const project of await this.safeReaddir(root)) {
      const projectPath = join(root, project);
      for (const entry of await this.safeReaddir(projectPath)) {
        const entryPath = join(projectPath, entry);
        if (entry.endsWith('.jsonl')) {
          if (await recent(entryPath)) out.push(entryPath);
          continue;
        }
        const subDir = join(entryPath, 'subagents');
        for (const sub of await this.safeReaddir(subDir)) {
          const subPath = join(subDir, sub);
          if (sub.endsWith('.jsonl') && (await recent(subPath))) out.push(subPath);
        }
      }
    }
    return out;
  }

  async run(): Promise<void> {
    const files = await this.listFiles();
    const cache = await this.loadCache();
    const next: Record<string, ScanCacheEntry> = {};
    const total = files.length;
    let done = 0;
    if (total > 0) this.opts.onProgress({ done: false, filesDone: 0, filesTotal: total });

    for (const file of files) {
      try {
        const entry = await this.scanFile(file, cache[file]);
        next[file] = entry;
        const { sessionId } = sessionIdFromTranscriptPath(file);
        if (entry.events.length > 0) this.opts.onEvents(sessionId, entry.events, file);
      } catch {
        // Unreadable file: skip it this run.
      }
      done += 1;
      if (done < total) this.opts.onProgress({ done: false, filesDone: done, filesTotal: total });
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    await this.saveCache(next);
    this.opts.onProgress({ done: true, filesDone: done, filesTotal: total });
  }

  private async scanFile(file: string, prev: ScanCacheEntry | undefined): Promise<ScanCacheEntry> {
    const st = await this.d.stat(file);
    if (prev && prev.mtimeMs === st.mtimeMs && prev.size === st.size) return prev;
    const resume = prev !== undefined && st.size >= prev.size && prev.offset <= st.size;
    const start = resume ? prev.offset : 0;
    const { sessionId, isSubagent } = sessionIdFromTranscriptPath(file);
    const buf = start < st.size ? await this.d.readRange(file, start, st.size) : Buffer.alloc(0);
    const lastNewline = buf.lastIndexOf(0x0a);
    const events: TranscriptEvent[] = resume ? [...prev.events] : [];
    if (lastNewline >= 0) {
      // Decode only up to the last newline so a multi-byte char is never split.
      for (const line of buf
        .subarray(0, lastNewline + 1)
        .toString('utf8')
        .split('\n')) {
        if (line !== '') events.push(...parseTranscriptLine(line, { sessionId, forceSidechain: isSubagent }));
      }
    }
    return {
      mtimeMs: st.mtimeMs,
      size: st.size,
      offset: start + lastNewline + 1,
      events: compactEvents(events),
    };
  }

  private async safeReaddir(dir: string): Promise<string[]> {
    try {
      return (await this.d.readdir(dir)).sort();
    } catch {
      return [];
    }
  }

  private async loadCache(): Promise<Record<string, ScanCacheEntry>> {
    try {
      const parsed = JSON.parse(await this.d.readFile(this.cacheFile)) as Partial<ScanCacheFile>;
      if (parsed.version !== CACHE_VERSION || parsed.claudeDir !== this.opts.claudeDir) return {};
      if (typeof parsed.files !== 'object' || parsed.files === null) return {};
      const valid: Record<string, ScanCacheEntry> = {};
      for (const [file, entry] of Object.entries(parsed.files)) {
        if (isValidEntry(entry)) valid[file] = entry;
      }
      return valid;
    } catch {
      return {};
    }
  }

  private async saveCache(files: Record<string, ScanCacheEntry>): Promise<void> {
    const data: ScanCacheFile = { version: CACHE_VERSION, claudeDir: this.opts.claudeDir, files };
    try {
      await this.d.mkdir(this.opts.cacheDir);
      await this.d.writeFile(this.cacheFile, JSON.stringify(data));
    } catch {
      // Cache is an optimisation only.
    }
  }
}
