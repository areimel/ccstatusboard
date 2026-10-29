import { describe, expect, it } from 'vitest';
import { readDisk } from './disk.js';

describe('readDisk', () => {
  it('computes used and total from statfs', async () => {
    const statfs = async (): Promise<{ blocks: number; bfree: number; bsize: number }> => ({
      blocks: 1000,
      bfree: 250,
      bsize: 4096,
    });
    expect(await readDisk('/data', { statfs })).toEqual({
      used: 750 * 4096,
      total: 1000 * 4096,
      mount: '/data',
    });
  });
  it('accepts bigint fields', async () => {
    const statfs = async (): Promise<{ blocks: bigint; bfree: bigint; bsize: bigint }> => ({
      blocks: 10n,
      bfree: 4n,
      bsize: 2n,
    });
    expect((await readDisk('/', { statfs })).used).toBe(12);
  });
});
