// Tails append-only JSONL transcripts by byte offset, emitting only complete lines.
import { watch as fsWatch } from 'node:fs';
import { open, stat as fsStat } from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';
import { LineSplitter } from '../core/jsonl.js';

const CHUNK_BYTES = 4 * 1024 * 1024;

export interface TailerDeps {
  stat?: (p: string) => Promise<{ size: number; mtimeMs: number }>;
  readRange?: (p: string, start: number, end: number) => Promise<Buffer>;
  watch?: (p: string, listener: () => void) => { close(): void };
}

export async function readRangeFromDisk(p: string, start: number, end: number): Promise<Buffer> {
  const fh = await open(p, 'r');
  try {
    const len = Math.max(0, end - start);
    const buf = Buffer.alloc(len);
    const { bytesRead } = await fh.read(buf, 0, len, start);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

function watchOnDisk(p: string, listener: () => void): { close(): void } {
  const w = fsWatch(p);
  w.on('change', listener);
  w.on('error', () => w.close());
  return w;
}

interface FileState {
  offset: number;
  splitter: LineSplitter;
  decoder: StringDecoder;
  watcher?: { close(): void };
}

export class TranscriptTailer {
  private readonly files = new Map<string, FileState>();
  private readonly onLines: (file: string, lines: string[]) => void;
  private readonly pollMs: number;
  private readonly stat: NonNullable<TailerDeps['stat']>;
  private readonly readRange: NonNullable<TailerDeps['readRange']>;
  private readonly watch: NonNullable<TailerDeps['watch']>;
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;
  private rerun = false;

  constructor(opts: {
    onLines: (file: string, lines: string[]) => void;
    pollMs?: number;
    deps?: TailerDeps;
  }) {
    this.onLines = opts.onLines;
    this.pollMs = opts.pollMs ?? 1000;
    this.stat = opts.deps?.stat ?? fsStat;
    this.readRange = opts.deps?.readRange ?? readRangeFromDisk;
    this.watch = opts.deps?.watch ?? watchOnDisk;
  }

  add(file: string, startOffset = 0): void {
    if (this.files.has(file)) return;
    const state: FileState = {
      offset: startOffset,
      splitter: new LineSplitter(),
      decoder: new StringDecoder('utf8'),
    };
    this.files.set(file, state);
    if (this.timer) this.attachWatcher(file, state);
  }

  remove(file: string): void {
    this.files.get(file)?.watcher?.close();
    this.files.delete(file);
  }

  has(file: string): boolean {
    return this.files.has(file);
  }

  /** Read any new bytes from every tailed file. Concurrent calls coalesce into one extra pass. */
  pollOnce(): Promise<void> {
    if (this.running) {
      this.rerun = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.rerun = false;
        for (const file of [...this.files.keys()]) await this.readFile(file);
      } while (this.rerun);
    })().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.pollOnce(), this.pollMs);
    this.timer.unref?.();
    for (const [file, state] of this.files) this.attachWatcher(file, state);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    for (const state of this.files.values()) {
      state.watcher?.close();
      state.watcher = undefined;
    }
  }

  private attachWatcher(file: string, state: FileState): void {
    if (state.watcher) return;
    try {
      state.watcher = this.watch(file, () => void this.pollOnce());
    } catch {
      // File may not exist yet or fs.watch unsupported: interval polling covers it.
    }
  }

  private async readFile(file: string): Promise<void> {
    const state = this.files.get(file);
    if (!state) return;
    try {
      const { size } = await this.stat(file);
      if (size < state.offset) {
        state.offset = 0;
        state.splitter = new LineSplitter();
        state.decoder = new StringDecoder('utf8');
      }
      while (state.offset < size) {
        const end = Math.min(size, state.offset + CHUNK_BYTES);
        const buf = await this.readRange(file, state.offset, end);
        if (buf.length === 0) break;
        state.offset += buf.length;
        const lines = state.splitter.push(state.decoder.write(buf));
        if (lines.length > 0 && this.files.get(file) === state) this.onLines(file, lines);
      }
    } catch {
      // Missing or unreadable file: try again next poll.
    }
  }
}
