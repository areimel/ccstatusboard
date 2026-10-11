import { describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import type { RegistryEntry } from '../domain/types.js';
import { SessionRegistry, type RegistryDeps } from './sessionRegistry.js';

const CLAUDE = '/home/u/.claude';
const SESS = join(CLAUDE, 'sessions');
const entry = (pid: number, sessionId: string) =>
  JSON.stringify({ pid, sessionId, cwd: '/work/proj', procStart: String(pid * 10) });

function setup(files: Record<string, string>, alive: Set<number>) {
  let readdirError: NodeJS.ErrnoException | null = null;
  const deps: RegistryDeps = {
    readdir: vi.fn(async () => {
      if (readdirError) throw readdirError;
      return Object.keys(files);
    }),
    readFile: vi.fn(async (p: string) => {
      const v = files[p.slice(SESS.length + 1)];
      if (v === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return v;
    }),
    isAlive: vi.fn((pid: number) => alive.has(pid)),
  };
  const upserts: RegistryEntry[] = [];
  const ended: Array<[string, number]> = [];
  const reg = new SessionRegistry({
    claudeDir: CLAUDE,
    deps,
    onUpsert: (e) => upserts.push(e),
    onEnded: (sid, pid) => ended.push([sid, pid]),
  });
  const failReaddir = (code: string | null) => {
    readdirError = code ? Object.assign(new Error(code), { code }) : null;
  };
  return { reg, upserts, ended, deps, failReaddir };
}

describe('SessionRegistry resilience', () => {
  it('a non-ENOENT readdir error skips the scan without ending live sessions', async () => {
    const t = setup({ '100.json': entry(100, 'a') }, new Set([100]));
    await t.reg.scanOnce();
    t.failReaddir('EMFILE');
    await t.reg.scanOnce();
    expect(t.ended).toEqual([]);
    expect(t.upserts).toHaveLength(1);
    t.failReaddir(null);
    await t.reg.scanOnce();
    expect(t.ended).toEqual([]);
    expect(t.upserts).toHaveLength(2);
  });

  it('a missing sessions dir (ENOENT) is empty and ends previously live sessions', async () => {
    const t = setup({ '100.json': entry(100, 'a') }, new Set([100]));
    await t.reg.scanOnce();
    t.failReaddir('ENOENT');
    await expect(t.reg.scanOnce()).resolves.toBeUndefined();
    expect(t.ended).toEqual([['a', 100]]);
  });

  it('a registry file caught mid-write keeps its live session', async () => {
    const files: Record<string, string> = { '100.json': entry(100, 'a') };
    const t = setup(files, new Set([100]));
    await t.reg.scanOnce();
    files['100.json'] = '{"pid":100,"sessi';
    await t.reg.scanOnce();
    expect(t.ended).toEqual([]);
    files['100.json'] = entry(100, 'a');
    await t.reg.scanOnce();
    expect(t.ended).toEqual([]);
    expect(t.upserts).toHaveLength(2);
  });

  it('a half-written file for a pid that has died still ends the session', async () => {
    const files: Record<string, string> = { '100.json': entry(100, 'a') };
    const alive = new Set([100]);
    const t = setup(files, alive);
    await t.reg.scanOnce();
    files['100.json'] = '{"pid":';
    alive.delete(100);
    await t.reg.scanOnce();
    expect(t.ended).toEqual([['a', 100]]);
    expect(t.deps.isAlive).toHaveBeenLastCalledWith(100, '1000');
  });

  it('a malformed file for a pid that was never live is still ignored', async () => {
    const t = setup({ '200.json': 'garbage' }, new Set([200]));
    await t.reg.scanOnce();
    expect(t.upserts).toEqual([]);
    expect(t.ended).toEqual([]);
  });
});
