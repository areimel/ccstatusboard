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

/** Network-/OS-sourced numbers: finite and non-negative. */
export function sanitizeSystem(s: SystemStats): SystemStats {
  return {
    ...s,
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
