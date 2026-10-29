import { describe, expect, it } from 'vitest';
import { parseMeminfo, parseSwapUsage, readMemory } from './memory.js';

const MEMINFO = `MemTotal:       16000000 kB
MemFree:         1000000 kB
MemAvailable:    6000000 kB
Buffers:          100000 kB
SwapTotal:       2000000 kB
SwapFree:        1500000 kB
`;

describe('parseMeminfo', () => {
  it('converts kB to bytes and derives used', () => {
    const r = parseMeminfo(MEMINFO);
    expect(r.mem).toEqual({ total: 16_000_000 * 1024, used: 10_000_000 * 1024 });
    expect(r.swap).toEqual({ total: 2_000_000 * 1024, used: 500_000 * 1024 });
  });
  it('returns zeros for garbage', () => {
    expect(parseMeminfo('nope')).toEqual({ mem: { used: 0, total: 0 }, swap: { used: 0, total: 0 } });
  });
});

describe('parseSwapUsage', () => {
  it('parses darwin sysctl output', () => {
    const r = parseSwapUsage('total = 2048.00M  used = 1024.50M  free = 1023.50M  (encrypted)');
    expect(r.total).toBe(2048 * 1024 ** 2);
    expect(r.used).toBe(Math.round(1024.5 * 1024 ** 2));
  });
  it('returns zeros for garbage', () => {
    expect(parseSwapUsage('')).toEqual({ used: 0, total: 0 });
  });
});

describe('readMemory', () => {
  const base = {
    totalmem: () => 1000,
    freemem: () => 400,
    readFile: async () => MEMINFO,
    exec: async () => 'total = 1.00G  used = 0.50G  free = 0.50G  (encrypted)',
  };
  it('reads /proc/meminfo on linux', async () => {
    expect((await readMemory({ ...base, platform: 'linux' })).mem.total).toBe(16_000_000 * 1024);
  });
  it('uses os memory and sysctl on darwin', async () => {
    const r = await readMemory({ ...base, platform: 'darwin' });
    expect(r.mem).toEqual({ used: 600, total: 1000 });
    expect(r.swap).toEqual({ used: 0.5 * 1024 ** 3, total: 1024 ** 3 });
  });
  it('tolerates sysctl failure on darwin', async () => {
    const exec = async (): Promise<string> => {
      throw new Error('x');
    };
    expect((await readMemory({ ...base, platform: 'darwin', exec })).swap).toEqual({ used: 0, total: 0 });
  });
});
