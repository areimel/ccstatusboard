import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { HelpOverlay } from './HelpOverlay.js';
import { stripAnsi } from '../../test/helpers/ansi.js';

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
      'Toggle filter',
      'Search',
      'Quit',
    ]) {
      expect(out).toContain(s);
    }
    for (const g of ['● waiting', '◐ busy', '○ idle', '· ended']) expect(out).toContain(g);
  });
});
