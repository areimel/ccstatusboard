import * as nodeFs from 'node:fs';
import { dirname } from 'node:path';

export const CRASH_LOG_MAX_BYTES = 256 * 1024;
export const CRASH_LOG_KEEP_BYTES = 128 * 1024;

const MB = 1024 * 1024;

export interface CrashLogFs {
  appendFileSync(path: string, data: string): void;
  statSync(path: string): { size: number };
  readFileSync(path: string, encoding: 'utf8'): string;
  writeFileSync(path: string, data: string): void;
  mkdirSync(path: string, options: { recursive: true }): unknown;
}

export interface CrashLogOptions {
  file: string;
  /** Called after the entry is written (or failed to be). Typically restores the terminal and exits. */
  onFatal: (err: unknown) => void;
  now?: () => Date;
  fs?: CrashLogFs;
  memoryUsage?: () => NodeJS.MemoryUsage;
}

export interface CrashHandlers {
  onUncaughtException: (err: unknown) => void;
  onUnhandledRejection: (reason: unknown) => void;
  /** Appends an entry without calling `onFatal` (for crashes caught elsewhere, e.g. Ink render errors). */
  log: (kind: string, reason: unknown) => void;
}

export function formatMemory(usage: NodeJS.MemoryUsage): string {
  const mb = (n: number) => `${(n / MB).toFixed(1)}MB`;
  return `memory: rss=${mb(usage.rss)} heapUsed=${mb(usage.heapUsed)} heapTotal=${mb(usage.heapTotal)} external=${mb(usage.external)} arrayBuffers=${mb(usage.arrayBuffers)}`;
}

export function formatEntry(kind: string, reason: unknown, at: Date, usage: NodeJS.MemoryUsage): string {
  const body =
    reason instanceof Error ? (reason.stack ?? `${reason.name}: ${reason.message}`) : String(reason);
  return `[${at.toISOString()}] ${kind}\n${body}\n${formatMemory(usage)}\n\n`;
}

/** Keeps roughly the last `keep` bytes, starting at a line boundary when one is available. */
function keepTail(text: string, keep: number): string {
  const buf = Buffer.from(text, 'utf8');
  if (buf.length <= keep) return text;
  const tail = buf.subarray(buf.length - keep).toString('utf8');
  const nl = tail.indexOf('\n');
  return nl === -1 ? tail : tail.slice(nl + 1);
}

function trimIfLarge(fs: CrashLogFs, file: string): void {
  let size: number;
  try {
    size = fs.statSync(file).size;
  } catch {
    return; // no log yet
  }
  if (size <= CRASH_LOG_MAX_BYTES) return;
  const text = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, keepTail(text, CRASH_LOG_KEEP_BYTES));
}

/**
 * Builds the process-level crash handlers without registering them, so they can be invoked
 * directly. Writing the log never throws; `onFatal` is always called.
 */
export function createCrashHandlers(opts: CrashLogOptions): CrashHandlers {
  const fs: CrashLogFs = opts.fs ?? nodeFs;
  const now = opts.now ?? (() => new Date());
  const memoryUsage = opts.memoryUsage ?? (() => process.memoryUsage());

  const record = (kind: string, reason: unknown): void => {
    try {
      fs.mkdirSync(dirname(opts.file), { recursive: true });
    } catch {
      // fall through: the append below reports nothing either and is also swallowed
    }
    try {
      trimIfLarge(fs, opts.file);
    } catch {
      // a failed trim must not stop the new entry from being recorded
    }
    try {
      fs.appendFileSync(opts.file, formatEntry(kind, reason, now(), memoryUsage()));
    } catch {
      // nothing else can be done; the process is already failing
    }
  };

  const fatal = (kind: string) => (reason: unknown) => {
    record(kind, reason);
    opts.onFatal(reason);
  };

  return {
    onUncaughtException: fatal('uncaughtException'),
    onUnhandledRejection: fatal('unhandledRejection'),
    log: record,
  };
}

/** Registers the crash handlers on `process`. Returns a function that removes them again. */
export function installCrashLog(opts: CrashLogOptions): () => void {
  const handlers = createCrashHandlers(opts);
  process.on('uncaughtException', handlers.onUncaughtException);
  process.on('unhandledRejection', handlers.onUnhandledRejection);
  return () => {
    process.off('uncaughtException', handlers.onUncaughtException);
    process.off('unhandledRejection', handlers.onUnhandledRejection);
  };
}
