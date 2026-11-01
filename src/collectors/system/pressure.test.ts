import { describe, expect, it } from 'vitest';
import { fakeSysfs } from '../../../test/helpers/system.js';
import { parsePressureSome, readPressure } from './pressure.js';

const psi = (some: number): string =>
  `some avg10=${some} avg60=0.31 avg300=0.24 total=22990698\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=0\n`;

describe('parsePressureSome', () => {
  it('takes some avg10, not full', () => {
    expect(parsePressureSome(psi(0.57))).toBe(0.57);
  });
  it('returns undefined for junk', () => {
    expect(parsePressureSome('nope')).toBeUndefined();
  });
});

describe('readPressure', () => {
  it('reads all three resources', async () => {
    const out = await readPressure(
      fakeSysfs({
        '/proc/pressure/memory': psi(0.63),
        '/proc/pressure/cpu': psi(0.57),
        '/proc/pressure/io': psi(0),
      }),
    );
    expect(out).toEqual({ mem: 0.63, cpu: 0.57, io: 0 });
  });
  it('returns undefined when the kernel has no PSI', async () => {
    expect(await readPressure(fakeSysfs({}))).toBeUndefined();
  });
});
