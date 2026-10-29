import { describe, expect, it } from 'vitest';
import { ProcStatsSampler, parsePsOutput, parseProcStat, parseStatm } from './procStats.js';

// comm contains spaces and parens; utime=50, stime=10 are fields 14 and 15.
const STAT =
  '4242 (my (weird) proc) S 1 4242 4242 34816 4242 4194304 1 2 3 4 50 10 7 8 20 0 12 0 9402548 1000 200';

function enoent(path: string): Error {
  return Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
}

describe('parseProcStat', () => {
  it('reads utime and stime after the last ")"', () => {
    expect(parseProcStat(STAT)).toEqual({ utime: 50, stime: 10 });
  });

  it('handles a plain comm', () => {
    expect(parseProcStat('1 (node) R 0 1 1 0 -1 0 0 0 0 0 7 3 0 0 20 0 1 0 1 1 1')).toEqual({
      utime: 7,
      stime: 3,
    });
  });

  it('returns undefined for garbage or truncated input', () => {
    expect(parseProcStat('garbage')).toBeUndefined();
    expect(parseProcStat('1 (x) S 1 2')).toBeUndefined();
    expect(parseProcStat('1 (x) S 1 2 3 4 5 6 7 8 9 10 abc 3')).toBeUndefined();
  });
});

describe('parseStatm', () => {
  it('returns resident pages times page size', () => {
    expect(parseStatm('12000 300 100 5 0 900 0\n', 4096)).toBe(300 * 4096);
  });

  it('returns undefined for garbage', () => {
    expect(parseStatm('', 4096)).toBeUndefined();
    expect(parseStatm('12000 x', 4096)).toBeUndefined();
  });
});

describe('parsePsOutput', () => {
  it('parses pid, %cpu and rss (KiB -> bytes), skipping bad lines', () => {
    const text = '  1   0.0   18160\n  2  12.5  204800\nnot a line\n';
    const map = parsePsOutput(text);
    expect(map.get(1)).toEqual({ cpuPercent: 0, rssBytes: 18160 * 1024 });
    expect(map.get(2)).toEqual({ cpuPercent: 12.5, rssBytes: 204800 * 1024 });
    expect(map.size).toBe(2);
  });
});

describe('ProcStatsSampler (linux)', () => {
  function fakeFs(files: Record<string, string>) {
    return async (path: string): Promise<string> => {
      const v = files[path];
      if (v === undefined) throw enoent(path);
      return v;
    };
  }

  it('first sample for a pid reports 0 CPU but real RSS', async () => {
    const sampler = new ProcStatsSampler({
      platform: 'linux',
      readFile: fakeFs({ '/proc/4242/stat': STAT, '/proc/4242/statm': '12000 300 100 5 0 900 0' }),
      exec: async () => '',
      now: () => 1000,
      clockTicks: 100,
      pageSize: 4096,
    });
    const first = await sampler.sample([4242]);
    expect(first.get(4242)).toEqual({ cpuPercent: 0, rssBytes: 300 * 4096 });
  });

  it('computes CPU% from the tick delta over wall time', async () => {
    let t = 1000;
    let stat = STAT; // utime+stime = 60
    const sampler = new ProcStatsSampler({
      platform: 'linux',
      readFile: async (path) => {
        if (path === '/proc/4242/stat') return stat;
        if (path === '/proc/4242/statm') return '12000 300 100 5 0 900 0';
        throw enoent(path);
      },
      exec: async () => '',
      now: () => t,
      clockTicks: 100,
    });
    await sampler.sample([4242]);

    // utime+stime goes 60 -> 110 (+50 ticks) over 1s at 100 ticks/s = 50%.
    stat = STAT.replace(' 50 10 ', ' 100 10 ');
    t += 1000;
    const second = await sampler.sample([4242]);
    expect(second.get(4242)?.cpuPercent).toBeCloseTo(50, 6);
  });

  it('scales CPU% so that 100 means one full core', async () => {
    let t = 0;
    let utime = 0;
    const sampler = new ProcStatsSampler({
      platform: 'linux',
      readFile: async (path) => {
        if (path === '/proc/7/stat') return `7 (x) S 1 7 7 0 0 0 0 0 0 0 0 ${utime} 0 0 0 20 0 1 0 1 1 1`;
        if (path === '/proc/7/statm') return '1 1 1 1 1 1 1';
        throw enoent(path);
      },
      exec: async () => '',
      now: () => t,
      clockTicks: 100,
    });
    await sampler.sample([7]);
    utime = 200; // 2 CPU-seconds
    t = 1000; // over 1 wall-second => two cores busy
    const result = await sampler.sample([7]);
    expect(result.get(7)?.cpuPercent).toBeCloseTo(200, 6);
  });

  it('omits pids whose files cannot be read', async () => {
    const sampler = new ProcStatsSampler({
      platform: 'linux',
      readFile: fakeFs({
        '/proc/1/stat': STAT,
        '/proc/1/statm': '1 1 1 1 1 1 1',
      }),
      exec: async () => '',
      now: () => 0,
    });
    const map = await sampler.sample([1, 999]);
    expect([...map.keys()]).toEqual([1]);
  });

  it('forgets CPU state for pids no longer in the list', async () => {
    let t = 0;
    const sampler = new ProcStatsSampler({
      platform: 'linux',
      readFile: fakeFs({
        '/proc/5/stat': STAT,
        '/proc/5/statm': '1 1 1 1 1 1 1',
      }),
      exec: async () => '',
      now: () => t,
      clockTicks: 100,
    });
    await sampler.sample([5]);
    await sampler.sample([]);
    t = 1000;
    // Previous state was dropped, so this is a "first sample" again.
    const again = await sampler.sample([5]);
    expect(again.get(5)?.cpuPercent).toBe(0);
  });
});

describe('ProcStatsSampler (darwin)', () => {
  it('parses one ps call for all pids', async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const sampler = new ProcStatsSampler({
      platform: 'darwin',
      readFile: async () => {
        throw new Error('must not read /proc on darwin');
      },
      exec: async (cmd, args) => {
        calls.push({ cmd, args });
        return '  10   3.5   51200\n  11   0.0   1024\n';
      },
      now: () => 0,
    });
    const map = await sampler.sample([10, 11]);
    expect(calls).toEqual([{ cmd: 'ps', args: ['-o', 'pid=,%cpu=,rss=', '-p', '10,11'] }]);
    expect(map.get(10)).toEqual({ cpuPercent: 3.5, rssBytes: 51200 * 1024 });
    expect(map.get(11)).toEqual({ cpuPercent: 0, rssBytes: 1024 * 1024 });
  });

  it('does not exec for an empty pid list', async () => {
    let called = false;
    const sampler = new ProcStatsSampler({
      platform: 'darwin',
      readFile: async () => '',
      exec: async () => {
        called = true;
        return '';
      },
      now: () => 0,
    });
    expect((await sampler.sample([])).size).toBe(0);
    expect(called).toBe(false);
  });

  it('returns an empty map when ps fails', async () => {
    const sampler = new ProcStatsSampler({
      platform: 'darwin',
      readFile: async () => '',
      exec: async () => {
        throw new Error('ps failed');
      },
      now: () => 0,
    });
    expect((await sampler.sample([1])).size).toBe(0);
  });
});
