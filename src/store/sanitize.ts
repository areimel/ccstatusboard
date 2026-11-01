import { sumCost } from '../domain/cost.js';
import {
  addTokens,
  type Limit,
  type LimitsState,
  type ModelTotals,
  type SystemStats,
  type WindowTotals,
} from '../domain/types.js';

// Strings from disk/network are rendered raw by the UI; strip control characters
// so a crafted session file cannot inject ANSI/OSC escape sequences into the terminal.

function isControl(code: number): boolean {
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
}

/** Removes C0 controls (tab becomes a space), DEL and C1 controls. */
export function sanitizeText(s: string): string {
  let out = '';
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 0x09) out += ' ';
    else if (!isControl(code)) out += ch;
  }
  return out;
}

export function sanitizeOptional(s: string | undefined): string | undefined {
  return s === undefined ? undefined : sanitizeText(s);
}

/** Sanitizes model-name keys; keys that collide after sanitizing are merged (tokens added, costs via sumCost). */
export function sanitizeKeys(byModel: Record<string, ModelTotals>): Record<string, ModelTotals> {
  const out: Record<string, ModelTotals> = {};
  for (const [model, totals] of Object.entries(byModel)) {
    const key = sanitizeText(model);
    const prev = out[key];
    out[key] = prev
      ? { costUSD: sumCost(prev.costUSD, totals.costUSD), tokens: addTokens(prev.tokens, totals.tokens) }
      : totals;
  }
  return out;
}

export function sanitizeWindowTotals(w: WindowTotals): WindowTotals {
  return { ...w, byModel: sanitizeKeys(w.byModel) };
}

export const nonNeg = (n: number): number => (Number.isFinite(n) && n > 0 ? n : 0);

/** Optional OS-sourced number: non-negative, or undefined. Never a false 0 for a missing reading. */
const optNonNeg = (n: number | undefined): number | undefined =>
  n !== undefined && Number.isFinite(n) && n >= 0 ? n : undefined;
const optFinite = (n: number | undefined): number | undefined =>
  n !== undefined && Number.isFinite(n) ? n : undefined;

/** Sanitizes a whole optional group; `fn` only runs when the group is present. */
const opt = <T>(v: T | undefined, fn: (v: T) => T): T | undefined => (v === undefined ? undefined : fn(v));

/** Network-/OS-sourced numbers: finite and non-negative. Strings from sysfs lose control characters. */
export function sanitizeSystem(s: SystemStats): SystemStats {
  return {
    ...s,
    temps: s.temps
      ?.filter((t) => Number.isFinite(t.celsius))
      .map((t) => ({
        ...t,
        label: sanitizeText(t.label),
        warn: optFinite(t.warn),
        crit: optFinite(t.crit),
      })),
    battery: opt(s.battery, (b) => ({
      percent: Math.min(100, nonNeg(b.percent)),
      status: sanitizeText(b.status),
      watts: optNonNeg(b.watts),
      secondsLeft: optNonNeg(b.secondsLeft),
      healthPercent: optNonNeg(b.healthPercent),
      cycles: optNonNeg(b.cycles),
    })),
    uptimeSec: optNonNeg(s.uptimeSec),
    cpuFreq: opt(s.cpuFreq, (f) => ({ curHz: nonNeg(f.curHz), maxHz: optNonNeg(f.maxHz) })),
    powerProfile: opt(s.powerProfile, sanitizeText),
    gpu: opt(s.gpu, (g) => ({
      busyPercent: optNonNeg(g.busyPercent),
      vramUsed: optNonNeg(g.vramUsed),
      clockHz: optNonNeg(g.clockHz),
      watts: optNonNeg(g.watts),
    })),
    pressure: opt(s.pressure, (p) => ({
      mem: optNonNeg(p.mem),
      cpu: optNonNeg(p.cpu),
      io: optNonNeg(p.io),
    })),
    diskIo: opt(s.diskIo, (d) => ({ readPerSec: nonNeg(d.readPerSec), writePerSec: nonNeg(d.writePerSec) })),
    procs: opt(s.procs, (p) => ({ processes: optNonNeg(p.processes), threads: optNonNeg(p.threads) })),
    link: opt(s.link, (l) => ({
      iface: opt(l.iface, sanitizeText),
      ip: opt(l.ip, sanitizeText),
      signalDbm: optFinite(l.signalDbm),
      vpn: opt(l.vpn, sanitizeText),
    })),
    cpu: {
      total: Math.min(100, nonNeg(s.cpu.total)),
      perCore: s.cpu.perCore.map((c) => Math.min(100, nonNeg(c))),
    },
    mem: { used: nonNeg(s.mem.used), total: nonNeg(s.mem.total) },
    swap: { used: nonNeg(s.swap.used), total: nonNeg(s.swap.total) },
    disk: { used: nonNeg(s.disk.used), total: nonNeg(s.disk.total), mount: sanitizeText(s.disk.mount) },
    net: { rxPerSec: nonNeg(s.net.rxPerSec), txPerSec: nonNeg(s.net.txPerSec) },
    load: [nonNeg(s.load[0]), nonNeg(s.load[1]), nonNeg(s.load[2])],
  };
}

function sanitizeLimit(l: Limit): Limit {
  return { ...l, label: sanitizeText(l.label) };
}

/** Limits come from the network; strip control chars from every string the UI may render. */
export function sanitizeLimits(l: LimitsState): LimitsState {
  return {
    ...l,
    ...(l.block ? { block: sanitizeLimit(l.block) } : {}),
    ...(l.weekly ? { weekly: sanitizeLimit(l.weekly) } : {}),
    perModelWeekly: l.perModelWeekly.map(sanitizeLimit),
    ...(l.extra ? { extra: { ...l.extra, currency: sanitizeOptional(l.extra.currency) } } : {}),
    ...(l.error !== undefined ? { error: sanitizeText(l.error) } : {}),
  };
}
