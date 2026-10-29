import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { Footer } from './Footer.js';
import { stripAnsi } from '../../test/helpers/ansi.js';

describe('Footer', () => {
  it('shows htop-style key hints in normal mode', () => {
    const out = stripAnsi(render(<Footer mode="normal" search="" />).lastFrame());
    for (const hint of ['F1Help', '↑↓Select', '⏎Detail', 'sSort', 'fFilter', '/Search', 'qQuit']) {
      expect(out).toContain(hint);
    }
  });

  it('shows the theme hint when width is unknown or wide, hides it at 60 columns', () => {
    expect(stripAnsi(render(<Footer mode="normal" search="" />).lastFrame())).toContain('tdefault');
    expect(stripAnsi(render(<Footer mode="normal" search="" width={120} />).lastFrame())).toContain(
      'tdefault',
    );
    const narrow = stripAnsi(render(<Footer mode="normal" search="" width={60} />).lastFrame());
    expect(narrow).not.toContain('tdefault');
    expect(narrow).toContain('qQuit');
  });

  it('shows the search prompt in search mode', () => {
    const out = stripAnsi(render(<Footer mode="search" search="pet" />).lastFrame());
    expect(out).toContain('/pet');
    expect(out).toContain('Esc');
  });
});
