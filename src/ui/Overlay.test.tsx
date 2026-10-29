import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { Overlay } from './Overlay.js';
import { stripAnsi } from '../../test/helpers/ansi.js';
import { renderSized } from '../../test/helpers/renderSized.js';

describe('Overlay', () => {
  it('frames children in a titled panel', async () => {
    const r = render(
      <Overlay title="Options" width={40}>
        <Text>body line</Text>
      </Overlay>,
    );
    // TitledBox renders its title only after the second render.
    await vi.waitFor(() => expect(stripAnsi(r.lastFrame())).toContain('Options'));
    const out = stripAnsi(r.lastFrame());
    expect(out.split('\n')[0]).toMatch(/^╭/);
    expect(out).toContain('body line');
    expect(out).not.toContain('Esc close');
  });

  it('renders the hint as the last line', async () => {
    const r = render(
      <Overlay title="Options" width={40} hint="Esc close">
        <Text>body line</Text>
      </Overlay>,
    );
    await vi.waitFor(() => expect(stripAnsi(r.lastFrame())).toContain('Options'));
    const lines = stripAnsi(r.lastFrame()).split('\n');
    const content = lines.slice(0, -1).join('\n');
    expect(content).toContain('body line');
    expect(lines.at(-2)).toContain('Esc close');
  });

  it('fits the requested width', async () => {
    const r = renderSized(
      <Overlay title="Help" width={30}>
        <Text>row</Text>
      </Overlay>,
      { columns: 30, rows: 10 },
    );
    try {
      await vi.waitFor(() => expect(r.lastFrame()).toContain('Help'));
      for (const l of r.lastFrame().split('\n')) expect(l.length).toBeLessThanOrEqual(30);
    } finally {
      r.unmount();
    }
  });
});
