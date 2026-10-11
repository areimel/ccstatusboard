import { describe, expect, it } from 'vitest';
import { LineSplitter, safeParse } from './jsonl.js';

describe('LineSplitter', () => {
  it('returns complete lines and buffers the partial tail', () => {
    const s = new LineSplitter();
    expect(s.push('{"a":1}\n{"b":')).toEqual(['{"a":1}']);
    expect(s.pending).toBe('{"b":');
    expect(s.push('2}\n')).toEqual(['{"b":2}']);
    expect(s.pending).toBe('');
  });

  it('handles a line split across many chunks without emitting it early', () => {
    const s = new LineSplitter();
    const line = '{"type":"assistant","message":{"id":"m1"}}';
    const out: string[] = [];
    for (const ch of line) out.push(...s.push(ch));
    expect(out).toEqual([]);
    out.push(...s.push('\n'));
    expect(out).toEqual([line]);
  });

  it('skips empty lines and strips CR', () => {
    const s = new LineSplitter();
    expect(s.push('a\r\n\n  \nb\n')).toEqual(['a', 'b']);
  });

  it('flush returns the remainder once and clears it', () => {
    const s = new LineSplitter();
    s.push('x\ny');
    expect(s.flush()).toEqual(['y']);
    expect(s.flush()).toEqual([]);
    expect(s.pending).toBe('');
  });
});

describe('safeParse', () => {
  it('parses valid JSON', () => {
    expect(safeParse('{"a":1}')).toEqual({ a: 1 });
  });
  it('returns undefined for invalid JSON instead of throwing', () => {
    expect(safeParse('{"a":')).toBeUndefined();
    expect(safeParse('')).toBeUndefined();
    expect(safeParse('not json')).toBeUndefined();
  });
});
