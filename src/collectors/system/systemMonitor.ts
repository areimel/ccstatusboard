import { readFile as fsReadFile, statfs as fsStatfs } from 'node:fs/promises';
import os from 'node:os';
import { runCommand } from '../../core/exec.js';
import type { SystemStats } from '../../domain/types.js';
import { cpuUsage, type CpuTimes } from './cpu.js';
import { readDisk, type DiskDeps } from './disk.js';
import { readMemory } from './memory.js';
import { netRates, parseNetstatIbn, parseProcNetDev, type NetCounters } from './network.js';

export interface SystemMonitorDeps {
  platform: NodeJS.Platform;
  cpus: () => CpuTimes;
  loadavg: () => number[];
  totalmem: () => number;
  freemem: () => number;
  readFile: (path: string) => Promise<string>;
  statfs: DiskDeps['statfs'];
  exec: (cmd: string, args: string[]) => Promise<string>;
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export interface SystemMonitorOptions {
  intervalMs?: number;
  mount?: string;
  onUpdate: (stats: SystemStats) => void;
}

const realDeps: SystemMonitorDeps = {
  platform: process.platform,
  cpus: () => os.cpus().map((c) => c.times),
  loadavg: () => os.loadavg(),
  totalmem: () => os.totalmem(),
  freemem: () => os.freemem(),
  readFile: (p) => fsReadFile(p, 'utf8'),
  statfs: (p) => fsStatfs(p),
  exec: (cmd, args) => runCommand(cmd, args, { timeoutMs: 2000 }),
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout),
};

export class SystemMonitor {
  private readonly deps: SystemMonitorDeps;
  private readonly intervalMs: number;
  private readonly mount: string;
  private readonly onUpdate: (stats: SystemStats) => void;
  private prevCpu: CpuTimes | undefined;
  private prevNet: NetCounters | undefined;
  private prevAt: number | undefined;
  private timer: unknown;
  private running = false;

  constructor(options: SystemMonitorOptions, deps: Partial<SystemMonitorDeps> = {}) {
    this.deps = { ...realDeps, ...deps };
    this.intervalMs = options.intervalMs ?? 2000;
    this.mount = options.mount ?? '/';
    this.onUpdate = options.onUpdate;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.tick();
  }

  stop(): void {
    this.running = false;
    if (this.timer !== undefined) this.deps.clearTimeout(this.timer);
    this.timer = undefined;
  }

  private async tick(): Promise<void> {
    try {
      const stats = await this.sample();
      if (this.running) this.onUpdate(stats);
    } catch {
      // sample() never rejects in practice; stay alive regardless
    }
    if (this.running) this.timer = this.deps.setTimeout(() => void this.tick(), this.intervalMs);
  }

  async sample(): Promise<SystemStats> {
    const d = this.deps;
    const sampledAt = d.now();

    let cpu = { total: 0, perCore: [] as number[] };
    try {
      const curr = d.cpus();
      cpu = cpuUsage(this.prevCpu, curr);
      this.prevCpu = curr;
    } catch {
      // keep zeros
    }

    let mem = { used: 0, total: 0 };
    let swap = { used: 0, total: 0 };
    try {
      ({ mem, swap } = await readMemory(d));
    } catch {
      // keep zeros
    }

    let disk = { used: 0, total: 0, mount: this.mount };
    try {
      disk = await readDisk(this.mount, d);
    } catch {
      // keep zeros
    }

    let net = { rxPerSec: 0, txPerSec: 0 };
    try {
      const curr = await this.readNet();
      if (curr) {
        net = netRates(this.prevNet, curr, sampledAt - (this.prevAt ?? sampledAt));
        this.prevNet = curr;
        this.prevAt = sampledAt;
      }
    } catch {
      // keep zeros
    }

    let load: [number, number, number] = [0, 0, 0];
    try {
      const l = d.loadavg();
      load = [l[0] ?? 0, l[1] ?? 0, l[2] ?? 0];
    } catch {
      // keep zeros
    }

    return { sampledAt, cpu, mem, swap, disk, net, load };
  }

  private async readNet(): Promise<NetCounters | undefined> {
    const d = this.deps;
    if (d.platform === 'linux') return parseProcNetDev(await d.readFile('/proc/net/dev'));
    if (d.platform === 'darwin') return parseNetstatIbn(await d.exec('netstat', ['-ibn']));
    return undefined;
  }
}
