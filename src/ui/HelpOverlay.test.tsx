import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { HelpOverlay } from './HelpOverlay.js';
import { stripAnsi } from '../../test/helpers/ansi.js';
import { renderSized } from '../../test/helpers/renderSized.js';

describe('HelpOverlay', () => {
  it('lists every key binding and the status legend', async () => {
    const r = render(<HelpOverlay />);
    await vi.waitFor(() => expect(stripAnsi(r.lastFrame())).toContain('Help'));
    const out = stripAnsi(r.lastFrame());
    for (const s of [
      'Help',
      'Move selection',
      'Toggle detail',
      'Top / bottom',
      'Cycle sort',
      'project',
      'Toggle filter',
      'Search',
      'Options',
      't / T',
      'Cycle theme',
      'Quit',
    ]) {
      expect(out).toContain(s);
    }
    for (const g of ['● waiting', '◐ busy', '○ idle', '· ended']) expect(out).toContain(g);
    expect(out).toContain('Dimmed rows are idle');
    expect(out).toContain('group headers and subagent rows');
  });
});

describe('HelpOverlay width', () => {
  it('fits a 60-column terminal when given width 60', async () => {
    const r = renderSized(<HelpOverlay width={60} />, { columns: 60, rows: 24 });
    try {
      await vi.waitFor(() => expect(r.lastFrame()).toContain('Help'));
      const lines = r.lastFrame().split('\n');
      for (const l of lines) expect(l.length).toBeLessThanOrEqual(60);
      expect(lines[0]).toMatch(/^╭.*╮$/);
      expect(lines.at(-1)).toMatch(/^╰─+╯$/);
    } finally {
      r.unmount();
    }
  });
});
