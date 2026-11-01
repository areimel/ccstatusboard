import { describe, expect, it } from 'vitest';
import { diskRates, parseDiskstats } from './diskIo.js';

const row = (name: string, read: number, written: number): string =>
  ` 259 0 ${name} 411312 368801 ${read} 123873 152973 714574 ${written} 551580 0 47439 682987 0 0 0 0 15093 7533`;

describe('parseDiskstats', () => {
  it('sums whole disks as bytes and skips loops, partitions and device mapper', () => {
    const text = [
      row('nvme0n1', 100, 200),
      row('nvme0n1p6', 90, 190),
      row('sda', 10, 20),
      row('sda1', 5, 5),
      row('mmcblk0', 1, 2),
      row('mmcblk0p1', 1, 1),
      row('vdb', 3, 4),
      row('loop7', 999, 999),
      row('dm-0', 999, 999),
    ].join('\n');
    expect(parseDiskstats(text)).toEqual({ read: 114 * 512, written: 226 * 512 });
  });
  it('handles empty text', () => {
    expect(parseDiskstats('')).toEqual({ read: 0, written: 0 });
  });
});

describe('diskRates', () => {
  it('is zero on the first sample', () => {
    expect(diskRates(undefined, { read: 5, written: 5 }, 2000)).toEqual({ readPerSec: 0, writePerSec: 0 });
  });
  it('computes bytes per second and treats resets as zero', () => {
    expect(diskRates({ read: 0, written: 500 }, { read: 4000, written: 100 }, 2000)).toEqual({
      readPerSec: 2000,
      writePerSec: 0,
    });
  });
});
