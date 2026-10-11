import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readCredentials } from './credentials.js';

const NOW = Date.parse('2026-10-11T12:00:00Z');
const now = (): number => NOW;
const creds = (accessToken: unknown, expiresAt?: unknown): string =>
  JSON.stringify({ claudeAiOauth: { accessToken, refreshToken: 'r-tok', expiresAt } });

describe('readCredentials (file)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ccsb-creds-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reads accessToken and expiresAt from .credentials.json', async () => {
    await writeFile(join(dir, '.credentials.json'), creds('tok-abc', NOW + 3_600_000));
    expect(await readCredentials(dir, { now, platform: 'linux' })).toEqual({
      kind: 'ok',
      accessToken: 'tok-abc',
      expiresAt: NOW + 3_600_000,
    });
  });

  it('ok without expiresAt', async () => {
    await writeFile(join(dir, '.credentials.json'), creds('tok-abc'));
    expect(await readCredentials(dir, { now, platform: 'linux' })).toEqual({
      kind: 'ok',
      accessToken: 'tok-abc',
    });
  });

  it('reports expired tokens', async () => {
    await writeFile(join(dir, '.credentials.json'), creds('tok-abc', NOW - 1));
    expect(await readCredentials(dir, { now, platform: 'linux' })).toEqual({
      kind: 'expired',
      expiresAt: NOW - 1,
    });
  });

  it('missing file on linux → missing (no keychain attempt)', async () => {
    let execCalled = false;
    const exec = async (): Promise<string> => {
      execCalled = true;
      return '';
    };
    expect(await readCredentials(dir, { now, platform: 'linux', exec })).toEqual({ kind: 'missing' });
    expect(execCalled).toBe(false);
  });

  it('malformed JSON or empty token → missing', async () => {
    await writeFile(join(dir, '.credentials.json'), '{nope');
    expect(await readCredentials(dir, { now, platform: 'linux' })).toEqual({ kind: 'missing' });
    await writeFile(join(dir, '.credentials.json'), creds(''));
    expect(await readCredentials(dir, { now, platform: 'linux' })).toEqual({ kind: 'missing' });
    await writeFile(join(dir, '.credentials.json'), JSON.stringify({ other: 1 }));
    expect(await readCredentials(dir, { now, platform: 'linux' })).toEqual({ kind: 'missing' });
  });
});

describe('readCredentials (macOS keychain fallback)', () => {
  const noFile = async (): Promise<string> => {
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  };

  it('uses the security CLI with the right arguments when the file is missing', async () => {
    const calls: Array<{ cmd: string; args: string[]; timeoutMs: number }> = [];
    const exec = async (cmd: string, args: string[], timeoutMs: number): Promise<string> => {
      calls.push({ cmd, args, timeoutMs });
      return creds('tok-kc', NOW + 1000) + '\n';
    };
    const r = await readCredentials('/c', { now, platform: 'darwin', readFile: noFile, exec });
    expect(r).toEqual({ kind: 'ok', accessToken: 'tok-kc', expiresAt: NOW + 1000 });
    expect(calls).toEqual([
      {
        cmd: 'security',
        args: ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
        timeoutMs: 2000,
      },
    ]);
  });

  it('prefers the file over the keychain', async () => {
    const exec = async (): Promise<string> => {
      throw new Error('must not be called');
    };
    const readFile = async (): Promise<string> => creds('tok-file');
    expect(await readCredentials('/c', { now, platform: 'darwin', readFile, exec })).toEqual({
      kind: 'ok',
      accessToken: 'tok-file',
    });
  });

  it('keychain failure or timeout → missing', async () => {
    const exec = async (): Promise<string> => {
      throw new Error('timed out');
    };
    expect(await readCredentials('/c', { now, platform: 'darwin', readFile: noFile, exec })).toEqual({
      kind: 'missing',
    });
  });
});
