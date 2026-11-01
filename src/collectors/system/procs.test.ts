import { describe, expect, it } from 'vitest';
import { fakeSysfs } from '../../../test/helpers/system.js';
import { readProcs } from './procs.js';

describe('readProcs', () => {
  it('counts numeric /proc entries and takes threads from loadavg', async () => {
    const out = await readProcs(
      fakeSysfs({
        '/proc/loadavg': '1.75 1.36 1.49 2/2926 195361\n',
        '/proc/1/stat': 'x',
        '/proc/42/stat': 'x',
        '/proc/sys/kernel': 'x',
      }),
    );
    expect(out).toEqual({ processes: 2, threads: 2926 });
  });
  it('returns undefined when /proc is unreadable', async () => {
    expect(await readProcs(fakeSysfs({}))).toBeUndefined();
  });
});
