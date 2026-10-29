import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { Footer } from './Footer.js';
import { stripAnsi } from '../../test/helpers/ansi.js';

const ESSENTIALS = ['F1Help', '↑↓Select', '⏎Detail', 'sSort', 'fFilter', '/Search', 'qQuit'];

describe('Footer', () => {
  it('shows htop-style key hints in normal mode', () => {
    const out = stripAnsi(render(<Footer mode="normal" search="" />).lastFrame());
    for (const hint of ESSENTIALS) expect(out).toContain(hint);
  });

  it('shows the options hint after Search and before Quit', () => {
    const out = stripAnsi(render(<Footer mode="normal" search="" />).lastFrame());
    expect(out).toContain('escOptions');
    expect(out.indexOf('/Search')).toBeLessThan(out.indexOf('escOptions'));
    expect(out.indexOf('escOptions')).toBeLessThan(out.indexOf('qQuit'));
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

  it('drops the theme hint before the options hint, and the options hint before essentials', () => {
    const wide = stripAnsi(render(<Footer mode="normal" search="" width={100} />).lastFrame());
    expect(wide).toContain('tdefault');
    expect(wide).toContain('escOptions');
    const mid = stripAnsi(render(<Footer mode="normal" search="" width={80} />).lastFrame());
    expect(mid).not.toContain('tdefault');
    expect(mid).toContain('escOptions');
    const narrow = stripAnsi(render(<Footer mode="normal" search="" width={60} />).lastFrame());
    expect(narrow).not.toContain('escOptions');
    for (const hint of ESSENTIALS) expect(narrow).toContain(hint);
  });

  it('shows the search prompt in search mode', () => {
    const out = stripAnsi(render(<Footer mode="search" search="pet" />).lastFrame());
    expect(out).toContain('/pet');
    expect(out).toContain('Esc');
    expect(out).not.toContain('escOptions');
  });
});
