import { describe, expect, it } from 'vitest';
import { sanitizeText } from './sanitize.js';

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
