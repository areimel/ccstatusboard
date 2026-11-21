import { describe, expect, it, vi } from 'vitest';
import {
  CRASH_LOG_KEEP_BYTES,
  CRASH_LOG_MAX_BYTES,
  createCrashHandlers,
  installCrashLog,
  type CrashLogFs,
} from './crashLog.js';

const FILE = '/cache/ccstatusboard/crash.log';
const MB = 1024 * 1024;
const NOW = new Date('2026-11-18T12:00:00.000Z');
const USAGE: NodeJS.MemoryUsage = {
  rss: 100 * MB,
  heapUsed: 50 * MB,
  heapTotal: 60 * MB,
  external: 2 * MB,
  arrayBuffers: MB,
};
const MEMORY_LINE = 'memory: rss=100.0MB heapUsed=50.0MB heapTotal=60.0MB external=2.0MB arrayBuffers=1.0MB';

function enoent(p: string): Error {
  return Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
}

function memFs(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  const dirs: string[] = [];
  const fs: CrashLogFs = {
    appendFileSync(p, data) {
      files.set(p, (files.get(p) ?? '') + data);
    },
    statSync(p) {
      const content = files.get(p);
      if (content === undefined) throw enoent(p);
      return { size: Buffer.byteLength(content, 'utf8') };
    },
    readFileSync(p) {
      const content = files.get(p);
      if (content === undefined) throw enoent(p);
      return content;
    },
    writeFileSync(p, data) {
      files.set(p, data);
    },
    mkdirSync(p) {
      dirs.push(p);
      return undefined;
    },
  };
  return { fs, files, dirs };
}

function setup(overrides: { fs?: CrashLogFs; initial?: Record<string, string> } = {}) {
  const mem = memFs(overrides.initial);
  const onFatal = vi.fn();
  const handlers = createCrashHandlers({
    file: FILE,
    onFatal,
    now: () => NOW,
    memoryUsage: () => USAGE,
    fs: overrides.fs ?? mem.fs,
  });
  return { ...mem, onFatal, handlers };
}

describe('crash log entries', () => {
  it('appends an uncaughtException entry with stack and memory line', () => {
    const { files, dirs, handlers } = setup();
    const err = new Error('boom');
    err.stack = 'Error: boom\n    at fake (file.ts:1:1)';

    handlers.onUncaughtException(err);

    expect(dirs).toEqual(['/cache/ccstatusboard']);
    expect(files.get(FILE)).toBe(
      `[2026-11-18T12:00:00.000Z] uncaughtException\nError: boom\n    at fake (file.ts:1:1)\n${MEMORY_LINE}\n\n`,
    );
  });

  it('records unhandled rejections with String(reason) when there is no stack', () => {
    const { files, handlers } = setup();

    handlers.onUnhandledRejection('plain reason');

    expect(files.get(FILE)).toBe(
      `[2026-11-18T12:00:00.000Z] unhandledRejection\nplain reason\n${MEMORY_LINE}\n\n`,
    );
  });

  it('falls back to name and message for an Error without a stack', () => {
    const { files, handlers } = setup();
    const err = new TypeError('bad');
    err.stack = undefined;

    handlers.onUncaughtException(err);

    expect(files.get(FILE)).toContain('uncaughtException\nTypeError: bad\n');
  });

  it('appends to an existing log rather than replacing it', () => {
    const { files, handlers } = setup({ initial: { [FILE]: 'older entry\n\n' } });

    handlers.onUnhandledRejection(42);

    expect(
      files.get(FILE)?.startsWith('older entry\n\n[2026-11-18T12:00:00.000Z] unhandledRejection\n42\n'),
    ).toBe(true);
  });
});

describe('crash log truncation', () => {
  it('keeps the file untouched when it is at or under the limit', () => {
    const body = 'x'.repeat(CRASH_LOG_MAX_BYTES);
    const { files, handlers } = setup({ initial: { [FILE]: body } });

    handlers.onUncaughtException(new Error('small'));

    expect(files.get(FILE)?.startsWith(body)).toBe(true);
  });

  it('keeps only the last ~128 KB, starting at a line boundary, when over 256 KB', () => {
    const line = 'filler line of log text that is fairly long to pad things out\n';
    let body = '';
    let n = 0;
    while (Buffer.byteLength(body, 'utf8') <= CRASH_LOG_MAX_BYTES) {
      body += `${String(n++).padStart(6, '0')} ${line}`;
    }
    const { files, handlers } = setup({ initial: { [FILE]: body } });

    handlers.onUncaughtException(new Error('late'));

    const result = files.get(FILE) ?? '';
    const entry = result.slice(result.indexOf('[2026-11-18'));
    const kept = result.slice(0, result.indexOf('[2026-11-18'));
    expect(Buffer.byteLength(kept, 'utf8')).toBeLessThanOrEqual(CRASH_LOG_KEEP_BYTES);
    expect(Buffer.byteLength(kept, 'utf8')).toBeGreaterThan(CRASH_LOG_KEEP_BYTES - 200);
    // The kept part is a suffix of the original, beginning at a whole line.
    expect(body.endsWith(kept)).toBe(true);
    expect(/^\d{6} /.test(kept)).toBe(true);
    expect(entry.startsWith('[2026-11-18T12:00:00.000Z] uncaughtException\nError: late\n')).toBe(true);
    expect(entry.endsWith(`${MEMORY_LINE}\n\n`)).toBe(true);
  });
});

describe('crash log failures', () => {
  it('never throws when every fs call fails, and still calls onFatal', () => {
    const broken = (): never => {
      throw new Error('disk on fire');
    };
    const fs: CrashLogFs = {
      appendFileSync: broken,
      statSync: broken,
      readFileSync: broken,
      writeFileSync: broken,
      mkdirSync: broken,
    };
    const { handlers, onFatal } = setup({ fs });
    const err = new Error('x');

    expect(() => handlers.onUncaughtException(err)).not.toThrow();
    expect(() => handlers.onUnhandledRejection(err)).not.toThrow();
    expect(onFatal).toHaveBeenNthCalledWith(1, err);
    expect(onFatal).toHaveBeenNthCalledWith(2, err);
  });

  it('still appends the entry when trimming fails', () => {
    const big = 'y'.repeat(CRASH_LOG_MAX_BYTES + 10);
    const mem = memFs({ [FILE]: big });
    const fs: CrashLogFs = {
      ...mem.fs,
      readFileSync: () => {
        throw new Error('read failed');
      },
    };
    const { handlers, onFatal } = setup({ fs });

    expect(() => handlers.onUncaughtException(new Error('still'))).not.toThrow();
    expect(onFatal).toHaveBeenCalledTimes(1);
  });
});

describe('crash handler dispatch', () => {
  it('calls onFatal with the error for uncaughtException', () => {
    const { handlers, onFatal } = setup();
    const err = new Error('fatal');

    handlers.onUncaughtException(err);

    expect(onFatal).toHaveBeenCalledWith(err);
  });

  it('calls onFatal with the reason for unhandledRejection', () => {
    const { handlers, onFatal } = setup();

    handlers.onUnhandledRejection('nope');

    expect(onFatal).toHaveBeenCalledWith('nope');
  });
});

describe('installCrashLog', () => {
  it('registers both listeners and the returned uninstall removes them', () => {
    const before = {
      uncaught: process.listenerCount('uncaughtException'),
      rejection: process.listenerCount('unhandledRejection'),
    };
    const uninstall = installCrashLog({
      file: FILE,
      onFatal: () => {},
      fs: memFs().fs,
      now: () => NOW,
      memoryUsage: () => USAGE,
    });
    try {
      expect(process.listenerCount('uncaughtException')).toBe(before.uncaught + 1);
      expect(process.listenerCount('unhandledRejection')).toBe(before.rejection + 1);
    } finally {
      uninstall();
    }
    expect(process.listenerCount('uncaughtException')).toBe(before.uncaught);
    expect(process.listenerCount('unhandledRejection')).toBe(before.rejection);
  });
});
