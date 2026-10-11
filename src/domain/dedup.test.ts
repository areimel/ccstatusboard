import { describe, expect, it } from 'vitest';
import { DedupSet, dedupKey } from './dedup.js';

describe('dedupKey', () => {
  it('joins message id and request id with a colon', () => {
    expect(dedupKey('msg_1', 'req_9')).toBe('msg_1:req_9');
  });
  it('uses the message id alone when request id is missing or empty', () => {
    expect(dedupKey('msg_1')).toBe('msg_1');
    expect(dedupKey('msg_1', '')).toBe('msg_1');
  });
});

describe('DedupSet', () => {
  it('add returns true only the first time a key is seen', () => {
    const s = new DedupSet();
    expect(s.add('a')).toBe(true);
    expect(s.add('a')).toBe(false);
    expect(s.add('b')).toBe(true);
    expect(s.size).toBe(2);
  });
  it('has reflects added keys', () => {
    const s = new DedupSet();
    expect(s.has('x')).toBe(false);
    s.add('x');
    expect(s.has('x')).toBe(true);
  });
});
