import { readFile as fsReadFile, readdir as fsReaddir, statfs as fsStatfs } from 'node:fs/promises';
import os from 'node:os';
import { runCommand } from '../../core/exec.js';
import type { SystemStats } from '../../domain/types.js';
import { readBattery } from './battery.js';
import { readCpuFreq, readGpu, readPowerProfile } from './chips.js';
import { cpuUsage, type CpuTimes } from './cpu.js';
import { readDisk, type DiskDeps } from './disk.js';
import { diskRates, parseDiskstats, type DiskCounters } from './diskIo.js';
import { readLink, type NetIfaces } from './link.js';
import { readMemory } from './memory.js';
import { netRates, parseNetstatIbn, parseProcNetDev, type NetCounters } from './network.js';
import { readPressure } from './pressure.js';
import { readProcs } from './procs.js';
import { readTemps } from './temps.js';

export interface SystemMonitorDeps {
  platform: NodeJS.Platform;
  cpus: () => CpuTimes;
  loadavg: () => number[];
  totalmem: () => number;
  freemem: () => number;
  readFile: (path: string) => Promise<string>;
  readdir: (path: string) => Promise<string[]>;
  uptime: () => number;
  networkInterfaces: () => NetIfaces;
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
  readdir: (p) => fsReaddir(p),
  uptime: () => os.uptime(),
  networkInterfaces: () => os.networkInterfaces(),
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
  private prevDisk: DiskCounters | undefined;
  private prevDiskAt: number | undefined;
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

    let uptimeSec: number | undefined;
    try {
      uptimeSec = d.uptime();
    } catch {
      // leave unset
    }

    const base: SystemStats = { sampledAt, cpu, mem, swap, disk, net, load, uptimeSec };
    return d.platform === 'linux' ? { ...base, ...(await this.sampleLinux(sampledAt)) } : base;
  }

  /** Metrics read from /sys and /proc. Each group fails on its own, leaving just that field unset. */
  private async sampleLinux(sampledAt: number): Promise<Partial<SystemStats>> {
    const d = this.deps;
    const safe = <T>(read: () => Promise<T>): Promise<T | undefined> => read().catch(() => undefined);
    const [temps, battery, cpuFreq, powerProfile, gpu, pressure, procs, link, diskIo] = await Promise.all([
      safe(() => readTemps(d)),
      safe(() => readBattery(d)),
      safe(() => readCpuFreq(d)),
      safe(() => readPowerProfile(d)),
      safe(() => readGpu(d)),
      safe(() => readPressure(d)),
      safe(() => readProcs(d)),
      safe(() => readLink(d)),
      safe(() => this.readDiskIo(sampledAt)),
    ]);
    return { temps, battery, cpuFreq, powerProfile, gpu, pressure, procs, link, diskIo };
  }

  private async readDiskIo(sampledAt: number): Promise<SystemStats['diskIo']> {
    const curr = parseDiskstats(await this.deps.readFile('/proc/diskstats'));
    const rates = diskRates(this.prevDisk, curr, sampledAt - (this.prevDiskAt ?? sampledAt));
    this.prevDisk = curr;
    this.prevDiskAt = sampledAt;
    return rates;
  }

  private async readNet(): Promise<NetCounters | undefined> {
    const d = this.deps;
    if (d.platform === 'linux') return parseProcNetDev(await d.readFile('/proc/net/dev'));
    if (d.platform === 'darwin') return parseNetstatIbn(await d.exec('netstat', ['-ibn']));
    return undefined;
  }
}
