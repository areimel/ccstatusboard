import { describe, expect, it } from 'vitest';
import { makeFullSystemStats, makeSystemStats } from '../../test/helpers/system.js';
import { sanitizeSystem, sanitizeText } from './sanitize.js';

describe('sanitizeText', () => {
  it('strips ESC from SGR sequences', () => {
    expect(sanitizeText('\x1b[31mred\x1b[0m')).toBe('[31mred[0m');
  });
  it('strips ESC and BEL from OSC 8 hyperlinks', () => {
    expect(sanitizeText('\x1b]8;;http://x\x07link')).toBe(']8;;http://xlink');
  });
  it('strips C1 controls such as the 8-bit CSI', () => {
    expect(sanitizeText('a\x9b2Jb\x80\x9fc')).toBe('a2Jbc');
  });
  it('strips other C0 controls and DEL', () => {
    expect(sanitizeText('a\x00b\nc\rd\x7fe')).toBe('abcde');
  });
  it('replaces tab with a space', () => {
    expect(sanitizeText('a\tb')).toBe('a b');
  });
  it('preserves normal unicode', () => {
    expect(sanitizeText('café 🚀 日本')).toBe('café 🚀 日本');
  });
});

const ESC = '\u001B[31m';

describe('sanitizeSystem extra metrics', () => {
  it('strips control characters from every sysfs string', () => {
    const s = sanitizeSystem(
      makeFullSystemStats({
        temps: [{ label: `evil${ESC}`, celsius: 40 }],
        battery: { percent: 50, status: `Disch${ESC}` },
        powerProfile: `bal${ESC}`,
        link: { iface: `wl${ESC}`, ip: `1.1${ESC}`, vpn: `wg${ESC}` },
      }),
    );
    expect(s.temps?.[0]?.label).toBe('evil[31m');
    expect(s.battery?.status).toBe('Disch[31m');
    expect(s.powerProfile).toBe('bal[31m');
    expect(s.link).toEqual({ iface: 'wl[31m', ip: '1.1[31m', vpn: 'wg[31m' });
  });

  it('keeps negative temperatures and signal levels', () => {
    const s = sanitizeSystem(
      makeFullSystemStats({
        temps: [{ label: 'Board', celsius: -5 }],
        link: { signalDbm: -47 },
      }),
    );
    expect(s.temps?.[0]?.celsius).toBe(-5);
    expect(s.link?.signalDbm).toBe(-47);
  });

  it('drops non-finite temperatures', () => {
    const s = sanitizeSystem(makeFullSystemStats({ temps: [{ label: 'CPU', celsius: Number.NaN }] }));
    expect(s.temps).toEqual([]);
  });

  it('leaves missing optional numbers undefined instead of showing a false zero', () => {
    const s = sanitizeSystem(
      makeFullSystemStats({ gpu: { busyPercent: 1 }, battery: { percent: 50, status: 'Full' } }),
    );
    expect(s.gpu?.vramUsed).toBeUndefined();
    expect(s.gpu?.watts).toBeUndefined();
    expect(s.battery?.healthPercent).toBeUndefined();
  });

  it('cleans bad numbers to undefined or zero', () => {
    const s = sanitizeSystem(
      makeFullSystemStats({
        gpu: { busyPercent: Number.NaN, watts: -4 },
        diskIo: { readPerSec: Number.NaN, writePerSec: -1 },
        battery: { percent: 140, status: 'Full' },
      }),
    );
    expect(s.gpu?.busyPercent).toBeUndefined();
    expect(s.gpu?.watts).toBeUndefined();
    expect(s.diskIo).toEqual({ readPerSec: 0, writePerSec: 0 });
    expect(s.battery?.percent).toBe(100);
  });

  it('keeps absent groups absent', () => {
    const s = sanitizeSystem(makeSystemStats());
    for (const k of [
      'temps',
      'battery',
      'uptimeSec',
      'cpuFreq',
      'gpu',
      'pressure',
      'diskIo',
      'procs',
      'link',
    ] as const) {
      expect(s[k]).toBeUndefined();
    }
  });
});
