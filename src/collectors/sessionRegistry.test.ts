import { afterEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import type { RegistryEntry } from '../domain/types.js';
import { parseRegistryEntry, SessionRegistry, type RegistryDeps } from './sessionRegistry.js';

const CLAUDE = '/home/u/.claude';
const SESS = join(CLAUDE, 'sessions');

function entry(pid: number, sessionId: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ pid, sessionId, cwd: '/work/proj', procStart: String(pid * 10), ...extra });
}

/** In-memory fake of the sessions dir. Mutate `files` / `alive` between scans. */
function fakeFs(files: Record<string, string>, alive: Set<number>) {
  const readFile = vi.fn(async (p: string) => {
    const name = p.slice(SESS.length + 1);
    const v = files[name];
    if (v === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    return v;
  });
  const deps: RegistryDeps = {
    readdir: vi.fn(async () => Object.keys(files)),
    readFile,
    isAlive: vi.fn((pid: number) => alive.has(pid)),
  };
  return { deps, readFile };
}

function makeRegistry(deps: RegistryDeps) {
  const upserts: RegistryEntry[] = [];
  const ended: Array<[string, number]> = [];
  const reg = new SessionRegistry({
    claudeDir: CLAUDE,
    deps,
    onUpsert: (e) => upserts.push(e),
    onEnded: (sid, pid) => ended.push([sid, pid]),
  });
  return { reg, upserts, ended };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('parseRegistryEntry', () => {
  it('parses required and optional fields', () => {
    const e = parseRegistryEntry({
      pid: 42,
      sessionId: 'abc',
      cwd: '/w',
      startedAt: 1,
      procStart: 9402548,
      version: '2.1.296',
      kind: 'interactive',
      name: 'proj-6f',
      status: 'waiting',
      waitingFor: 'input needed',
      updatedAt: 2,
      statusUpdatedAt: 3,
      messagingSocketPath: '/run/x.sock',
    });
    expect(e).toEqual({
      pid: 42,
      sessionId: 'abc',
      cwd: '/w',
      startedAt: 1,
      procStart: '9402548',
      version: '2.1.296',
      kind: 'interactive',
      name: 'proj-6f',
      status: 'waiting',
      waitingFor: 'input needed',
      updatedAt: 2,
      statusUpdatedAt: 3,
    });
  });
  it('rejects records missing pid, sessionId or cwd, and non-objects', () => {
    expect(parseRegistryEntry({ sessionId: 'a', cwd: '/w' })).toBeNull();
    expect(parseRegistryEntry({ pid: 1, cwd: '/w' })).toBeNull();
    expect(parseRegistryEntry({ pid: 1, sessionId: 'a' })).toBeNull();
    expect(parseRegistryEntry({ pid: '1', sessionId: 'a', cwd: '/w' })).toBeNull();
    expect(parseRegistryEntry(null)).toBeNull();
    expect(parseRegistryEntry('x')).toBeNull();
  });
  it('drops optional fields with wrong types instead of failing', () => {
    expect(parseRegistryEntry({ pid: 1, sessionId: 'a', cwd: '/w', status: 5, startedAt: 'x' })).toEqual({
      pid: 1,
      sessionId: 'a',
      cwd: '/w',
    });
  });
});

describe('SessionRegistry.scanOnce', () => {
  it('never reads *.key files or non-json files', async () => {
    const { deps, readFile } = fakeFs(
      { '100.json': entry(100, 's1'), '100.0123abcd.key': 'SECRET', 'notes.txt': 'x' },
      new Set([100]),
    );
    const { reg, upserts } = makeRegistry(deps);
    await reg.scanOnce();
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(readFile).toHaveBeenCalledWith(join(SESS, '100.json'));
    for (const call of readFile.mock.calls) expect(call[0]).not.toMatch(/\.key$/);
    expect(upserts.map((e) => e.sessionId)).toEqual(['s1']);
  });

  it('upserts live entries on every scan', async () => {
    const { deps } = fakeFs({ '100.json': entry(100, 's1') }, new Set([100]));
    const { reg, upserts } = makeRegistry(deps);
    await reg.scanOnce();
    await reg.scanOnce();
    expect(upserts).toHaveLength(2);
    expect(upserts[0]).toMatchObject({ pid: 100, sessionId: 's1', cwd: '/work/proj', procStart: '1000' });
  });

  it('passes pid and procStart to isAlive', async () => {
    const { deps } = fakeFs({ '100.json': entry(100, 's1') }, new Set([100]));
    const { reg } = makeRegistry(deps);
    await reg.scanOnce();
    expect(deps.isAlive).toHaveBeenCalledWith(100, '1000');
  });

  it('a stale file for a dead PID at startup is never upserted and never ended', async () => {
    const { deps } = fakeFs({ '200.json': entry(200, 'stale') }, new Set());
    const { reg, upserts, ended } = makeRegistry(deps);
    await reg.scanOnce();
    await reg.scanOnce();
    expect(upserts).toEqual([]);
    expect(ended).toEqual([]);
  });

  it('fires onEnded exactly once when a live PID dies', async () => {
    const alive = new Set([100]);
    const { deps } = fakeFs({ '100.json': entry(100, 's1') }, alive);
    const { reg, ended } = makeRegistry(deps);
    await reg.scanOnce();
    alive.delete(100);
    await reg.scanOnce();
    await reg.scanOnce();
    expect(ended).toEqual([['s1', 100]]);
  });

  it('fires onEnded once when a live session file disappears', async () => {
    const files: Record<string, string> = { '100.json': entry(100, 's1'), '101.json': entry(101, 's2') };
    const { deps } = fakeFs(files, new Set([100, 101]));
    const { reg, ended } = makeRegistry(deps);
    await reg.scanOnce();
    delete files['101.json'];
    await reg.scanOnce();
    await reg.scanOnce();
    expect(ended).toEqual([['s2', 101]]);
  });

  it('skips malformed JSON and invalid entries without throwing', async () => {
    const { deps } = fakeFs(
      { '1.json': '{not json', '2.json': JSON.stringify({ pid: 2 }), '3.json': entry(3, 'ok') },
      new Set([1, 2, 3]),
    );
    const { reg, upserts } = makeRegistry(deps);
    await expect(reg.scanOnce()).resolves.toBeUndefined();
    expect(upserts.map((e) => e.sessionId)).toEqual(['ok']);
  });

  it('tolerates a file deleted between readdir and readFile', async () => {
    const deps: RegistryDeps = {
      readdir: async () => ['9.json', '3.json'],
      readFile: async (p: string) => {
        if (p.endsWith('9.json')) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        return entry(3, 'ok');
      },
      isAlive: () => true,
    };
    const { reg, upserts } = makeRegistry(deps);
    await reg.scanOnce();
    expect(upserts.map((e) => e.sessionId)).toEqual(['ok']);
  });

  it('treats a missing sessions dir as empty, and ends previously live sessions', async () => {
    let missing = false;
    const deps: RegistryDeps = {
      readdir: async () => {
        if (missing) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        return ['1.json'];
      },
      readFile: async () => entry(1, 's1'),
      isAlive: () => true,
    };
    const { reg, ended } = makeRegistry(deps);
    await reg.scanOnce();
    missing = true;
    await expect(reg.scanOnce()).resolves.toBeUndefined();
    expect(ended).toEqual([['s1', 1]]);
  });
});

describe('SessionRegistry.start/stop', () => {
  it('scans immediately, then every pollMs, and stops cleanly', async () => {
    vi.useFakeTimers();
    const { deps } = fakeFs({ '1.json': entry(1, 's1') }, new Set([1]));
    const close = vi.fn();
    deps.watch = vi.fn(() => ({ close, on: vi.fn() })) as unknown as RegistryDeps['watch'];
    const upserts: RegistryEntry[] = [];
    const reg = new SessionRegistry({
      claudeDir: CLAUDE,
      pollMs: 2000,
      deps,
      onUpsert: (e) => upserts.push(e),
      onEnded: () => {},
    });
    reg.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(upserts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(upserts).toHaveLength(2);
    reg.stop();
    expect(close).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(upserts).toHaveLength(2);
  });

  it('keeps polling when fs.watch throws', async () => {
    vi.useFakeTimers();
    const { deps } = fakeFs({ '1.json': entry(1, 's1') }, new Set([1]));
    deps.watch = vi.fn(() => {
      throw new Error('ENOSPC');
    }) as unknown as RegistryDeps['watch'];
    const upserts: RegistryEntry[] = [];
    const reg = new SessionRegistry({
      claudeDir: CLAUDE,
      pollMs: 1000,
      deps,
      onUpsert: (e) => upserts.push(e),
      onEnded: () => {},
    });
    expect(() => reg.start()).not.toThrow();
    await vi.advanceTimersByTimeAsync(1000);
    expect(upserts.length).toBeGreaterThanOrEqual(2);
    reg.stop();
  });
});
