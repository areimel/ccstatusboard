import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isAlive, procStartFromStat } from './liveness.js';

function errno(code: string): Error {
  return Object.assign(new Error(code), { code });
}

// Real-world shape: comm may contain spaces and parens.
const STAT =
  '2203789 (claude (main) x) S 1 2203789 2203789 34816 2203789 4194304 1 2 3 4 5 6 7 8 20 0 12 0 9402548 1000 200';

describe('procStartFromStat', () => {
  it('reads field 22 after the last ")"', () => {
    expect(procStartFromStat(STAT)).toBe('9402548');
  });
  it('returns undefined for garbage', () => {
    expect(procStartFromStat('garbage')).toBeUndefined();
    expect(procStartFromStat('1 (x) S 1 2')).toBeUndefined();
  });
});

describe('isAlive', () => {
  const ok = (): void => {};

  it('treats a successful kill(pid,0) as alive', () => {
    expect(isAlive(42, undefined, { kill: ok, platform: 'darwin' })).toBe(true);
  });

  it('treats EPERM as alive (process exists, owned by another user)', () => {
    const kill = (): void => {
      throw errno('EPERM');
    };
    expect(isAlive(42, undefined, { kill, platform: 'darwin' })).toBe(true);
  });

  it('treats ESRCH as dead', () => {
    const kill = (): void => {
      throw errno('ESRCH');
    };
    expect(isAlive(42, '9402548', { kill, platform: 'linux', readProcStat: () => STAT })).toBe(false);
  });

  it('never signals pid <= 0 or non-integer pids', () => {
    let called = false;
    const kill = (): void => {
      called = true;
    };
    expect(isAlive(0, undefined, { kill })).toBe(false);
    expect(isAlive(-1, undefined, { kill })).toBe(false);
    expect(isAlive(1.5, undefined, { kill })).toBe(false);
    expect(called).toBe(false);
  });

  it('Linux: alive when procStart matches /proc stat field 22', () => {
    expect(isAlive(2203789, '9402548', { kill: ok, platform: 'linux', readProcStat: () => STAT })).toBe(true);
  });

  it('Linux: a reused PID (procStart mismatch) is treated as dead', () => {
    expect(isAlive(2203789, '1111111', { kill: ok, platform: 'linux', readProcStat: () => STAT })).toBe(
      false,
    );
  });

  it('Linux: unreadable stat falls back to the kill result', () => {
    expect(isAlive(2203789, '9402548', { kill: ok, platform: 'linux', readProcStat: () => null })).toBe(true);
  });

  it('macOS: ignores procStart', () => {
    const readProcStat = (): string => {
      throw new Error('must not be called');
    };
    expect(isAlive(42, '1111111', { kill: ok, platform: 'darwin', readProcStat })).toBe(true);
  });

  it('works against the real current process', () => {
    expect(isAlive(process.pid, undefined)).toBe(true);
  });

  it.runIf(process.platform === 'linux')('Linux: real /proc check for current process', () => {
    const stat = readFileSync(`/proc/${process.pid}/stat`, 'utf8');
    const start = procStartFromStat(stat);
    expect(start).toBeDefined();
    expect(isAlive(process.pid, start)).toBe(true);
    expect(isAlive(process.pid, '1')).toBe(false);
  });
});
