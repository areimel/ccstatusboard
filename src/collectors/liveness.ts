import { readFileSync } from 'node:fs';

export interface LivenessDeps {
  kill?: (pid: number, sig: 0) => void;
  readProcStat?: (pid: number) => string | null;
  platform?: NodeJS.Platform;
}

function defaultReadProcStat(pid: number): string | null {
  try {
    return readFileSync(`/proc/${pid}/stat`, 'utf8');
  } catch {
    return null;
  }
}

/** Returns /proc/<pid>/stat field 22 (starttime in clock ticks). */
export function procStartFromStat(stat: string): string | undefined {
  const close = stat.lastIndexOf(')');
  if (close === -1) return undefined;
  // Fields after "comm)" start at field 3 (state); field 22 is index 19.
  const fields = stat
    .slice(close + 1)
    .trim()
    .split(/\s+/);
  const value = fields[19];
  return value !== undefined && /^\d+$/.test(value) ? value : undefined;
}

export function isAlive(pid: number, procStart: string | undefined, deps: LivenessDeps = {}): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  const kill = deps.kill ?? ((p: number, s: 0) => void process.kill(p, s));
  try {
    kill(pid, 0);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EPERM') return false;
  }
  const platform = deps.platform ?? process.platform;
  if (platform !== 'linux' || !procStart) return true;
  const stat = (deps.readProcStat ?? defaultReadProcStat)(pid);
  if (stat === null) return true;
  const start = procStartFromStat(stat);
  return start === undefined ? true : start === procStart;
}
