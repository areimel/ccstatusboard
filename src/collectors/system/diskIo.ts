import { netRates } from './network.js';

export interface DiskCounters {
  read: number;
  written: number;
}

const SECTOR_BYTES = 512; // /proc/diskstats always counts 512-byte sectors, whatever the hardware uses
const WHOLE_DISK = /^(nvme\d+n\d+|sd[a-z]+|vd[a-z]+|mmcblk\d+)$/;

/** Total bytes read and written on whole disks; partitions would double count. */
export function parseDiskstats(text: string): DiskCounters {
  let read = 0;
  let written = 0;
  for (const line of text.split('\n')) {
    const f = line.trim().split(/\s+/);
    if (!f[2] || !WHOLE_DISK.test(f[2])) continue;
    const r = Number(f[5]);
    const w = Number(f[9]);
    if (Number.isFinite(r)) read += r * SECTOR_BYTES;
    if (Number.isFinite(w)) written += w * SECTOR_BYTES;
  }
  return { read, written };
}

export function diskRates(
  prev: DiskCounters | undefined,
  curr: DiskCounters,
  dtMs: number,
): { readPerSec: number; writePerSec: number } {
  const r = netRates(prev && { rx: prev.read, tx: prev.written }, { rx: curr.read, tx: curr.written }, dtMs);
  return { readPerSec: r.rxPerSec, writePerSec: r.txPerSec };
}
