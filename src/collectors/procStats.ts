import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import type { ProcStats } from '../domain/types.js';

const execFileAsync = promisify(execFile);

export interface ProcStatsDeps {
  platform: NodeJS.Platform;
  readFile(path: string): Promise<string>;
  exec(cmd: string, args: string[]): Promise<string>;
  /** Epoch milliseconds. */
  now(): number;
  /** Kernel USER_HZ used by /proc utime/stime. */
  clockTicks?: number;
  pageSize?: number;
}

interface CpuSample {
  ticks: number;
  wallMs: number;
}

const DEFAULT_CLOCK_TICKS = 100;
const DEFAULT_PAGE_SIZE = 4096;
const PS_TIMEOUT_MS = 2000;

/** Returns utime (field 14) and stime (field 15) in clock ticks from /proc/<pid>/stat. */
export function parseProcStat(text: string): { utime: number; stime: number } | undefined {
  const close = text.lastIndexOf(')');
  if (close === -1) return undefined;
  // Fields after "comm)" start at field 3 (state), so field N is index N - 3.
  const fields = text
    .slice(close + 1)
    .trim()
    .split(/\s+/);
  const utime = fields[11];
  const stime = fields[12];
  if (utime === undefined || stime === undefined) return undefined;
  if (!/^\d+$/.test(utime) || !/^\d+$/.test(stime)) return undefined;
  return { utime: Number(utime), stime: Number(stime) };
}

/** Returns resident set size in bytes from /proc/<pid>/statm (2nd field, in pages). */
export function parseStatm(text: string, pageSize: number): number | undefined {
  const resident = text.trim().split(/\s+/)[1];
  if (resident === undefined || !/^\d+$/.test(resident)) return undefined;
  return Number(resident) * pageSize;
}

/** Parses `ps -o pid=,%cpu=,rss= -p ...` output; rss is in KiB. */
export function parsePsOutput(text: string): Map<number, ProcStats> {
  const out = new Map<number, ProcStats>();
  for (const line of text.split('\n')) {
    const [pid, cpu, rss] = line.trim().split(/\s+/);
    if (pid === undefined || cpu === undefined || rss === undefined) continue;
    const cpuPercent = Number(cpu);
    const rssKiB = Number(rss);
    if (!/^\d+$/.test(pid) || !Number.isFinite(cpuPercent) || !Number.isFinite(rssKiB)) continue;
    out.set(Number(pid), { cpuPercent, rssBytes: rssKiB * 1024 });
  }
  return out;
}

const defaultDeps: ProcStatsDeps = {
  platform: process.platform,
  readFile: (path) => readFile(path, 'utf8'),
  // `ps -p` exits 1 when any listed pid is gone; keep the rows it did print.
  exec: async (cmd, args) => {
    try {
      return (await execFileAsync(cmd, args, { timeout: PS_TIMEOUT_MS })).stdout;
    } catch (e) {
      const stdout = (e as { stdout?: unknown }).stdout;
      if (typeof stdout === 'string' && stdout.trim() !== '') return stdout;
      throw e;
    }
  },
  now: () => Date.now(),
};

/**
 * Samples per-process CPU% and RSS. CPU% on Linux is a delta between two
 * samples of the same pid, so the first sample for a pid reports 0.
 */
export class ProcStatsSampler {
  private readonly deps: ProcStatsDeps;
  private prev = new Map<number, CpuSample>();

  constructor(deps: Partial<ProcStatsDeps> = {}) {
    this.deps = { ...defaultDeps, ...deps };
  }

  async sample(pids: number[]): Promise<Map<number, ProcStats>> {
    if (this.deps.platform === 'linux') return this.sampleLinux(pids);
    if (this.deps.platform === 'darwin') return this.sampleDarwin(pids);
    this.prev = new Map();
    return new Map();
  }

  private async sampleLinux(pids: number[]): Promise<Map<number, ProcStats>> {
    const { readFile, now } = this.deps;
    const clockTicks = this.deps.clockTicks ?? DEFAULT_CLOCK_TICKS;
    const pageSize = this.deps.pageSize ?? DEFAULT_PAGE_SIZE;
    const wallMs = now();
    const out = new Map<number, ProcStats>();
    const next = new Map<number, CpuSample>();

    const results = await Promise.all(
      pids.map(async (pid) => {
        try {
          const [statText, statmText] = await Promise.all([
            readFile(`/proc/${pid}/stat`),
            readFile(`/proc/${pid}/statm`),
          ]);
          const stat = parseProcStat(statText);
          const rssBytes = parseStatm(statmText, pageSize);
          if (!stat || rssBytes === undefined) return undefined;
          return { pid, ticks: stat.utime + stat.stime, rssBytes };
        } catch {
          return undefined;
        }
      }),
    );

    for (const r of results) {
      if (!r) continue;
      const before = this.prev.get(r.pid);
      let cpuPercent = 0;
      if (before && wallMs > before.wallMs) {
        const cpuSeconds = (r.ticks - before.ticks) / clockTicks;
        const wallSeconds = (wallMs - before.wallMs) / 1000;
        cpuPercent = Math.max(0, (cpuSeconds / wallSeconds) * 100);
      }
      out.set(r.pid, { cpuPercent, rssBytes: r.rssBytes });
      next.set(r.pid, { ticks: r.ticks, wallMs });
    }

    this.prev = next;
    return out;
  }

  private async sampleDarwin(pids: number[]): Promise<Map<number, ProcStats>> {
    if (pids.length === 0) return new Map();
    try {
      const stdout = await this.deps.exec('ps', ['-o', 'pid=,%cpu=,rss=', '-p', pids.join(',')]);
      return parsePsOutput(stdout);
    } catch {
      return new Map();
    }
  }
}
