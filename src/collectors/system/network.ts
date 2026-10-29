export interface NetCounters {
  rx: number;
  tx: number;
}

/** Sum rx/tx bytes over all interfaces except `lo` from /proc/net/dev. */
export function parseProcNetDev(text: string): NetCounters {
  let rx = 0;
  let tx = 0;
  for (const line of text.split('\n')) {
    const i = line.indexOf(':');
    if (i === -1) continue;
    if (line.slice(0, i).trim() === 'lo') continue;
    const f = line
      .slice(i + 1)
      .trim()
      .split(/\s+/);
    const r = Number(f[0]);
    const t = Number(f[8]);
    if (Number.isFinite(r)) rx += r;
    if (Number.isFinite(t)) tx += t;
  }
  return { rx, tx };
}

/** Sum Ibytes/Obytes of `<Link#` rows (one per interface) from darwin `netstat -ibn`, skipping lo0. */
export function parseNetstatIbn(text: string): NetCounters {
  let rx = 0;
  let tx = 0;
  const seen = new Set<string>();
  for (const line of text.split('\n')) {
    const f = line.trim().split(/\s+/);
    const name = f[0];
    if (!name || name === 'Name' || name === 'lo0' || seen.has(name)) continue;
    if (!f[2]?.startsWith('<Link#')) continue;
    // Address may be blank, so index from the end: ... Ibytes Opkts Oerrs Obytes Coll
    const r = Number(f[f.length - 5]);
    const t = Number(f[f.length - 2]);
    if (!Number.isFinite(r) || !Number.isFinite(t)) continue;
    seen.add(name);
    rx += r;
    tx += t;
  }
  return { rx, tx };
}

/** Bytes per second between two counter samples; resets or zero intervals yield 0. */
export function netRates(
  prev: NetCounters | undefined,
  curr: NetCounters,
  dtMs: number,
): { rxPerSec: number; txPerSec: number } {
  if (!prev || !(dtMs > 0)) return { rxPerSec: 0, txPerSec: 0 };
  const rate = (a: number, b: number): number => (b < a ? 0 : ((b - a) * 1000) / dtMs);
  return { rxPerSec: rate(prev.rx, curr.rx), txPerSec: rate(prev.tx, curr.tx) };
}
