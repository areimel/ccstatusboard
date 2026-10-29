import { describe, expect, it } from 'vitest';
import { cycle } from './cycle.js';

describe('cycle', () => {
  const list = ['a', 'b', 'c'] as const;

  it('steps forward and backward', () => {
    expect(cycle(list, 'a', 1)).toBe('b');
    expect(cycle(list, 'c', -1)).toBe('b');
  });

  it('wraps at both ends', () => {
    expect(cycle(list, 'c', 1)).toBe('a');
    expect(cycle(list, 'a', -1)).toBe('c');
  });

  it('falls back to the first (forward) or last (backward) item for an unknown current', () => {
    expect(cycle(list, 'z' as 'a', 1)).toBe('a');
    expect(cycle(list, 'z' as 'a', -1)).toBe('c');
  });

  it('returns the only item of a single-item list', () => {
    expect(cycle(['x'], 'x', 1)).toBe('x');
    expect(cycle(['x'], 'x', -1)).toBe('x');
  });
});
