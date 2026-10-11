import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { FallbackPanel, Panel } from './Panel.js';
import { stripAnsi } from '../../test/helpers/ansi.js';
import { renderSized } from '../../test/helpers/renderSized.js';
import { displayWidth } from '../domain/format.js';

describe('Panel', () => {
  it('renders the title in the top border and the children inside', async () => {
    const { lastFrame } = render(
      <Panel title="Usage" width={40}>
        <Text>hello</Text>
      </Panel>,
    );
    // TitledBox measures its width in an effect, so the title row appears on the second render.
    await vi.waitFor(() => expect(lastFrame()).toContain('Usage'));
    const out = stripAnsi(lastFrame());
    const lines = out.split('\n');
    expect(lines[0]).toContain('Usage');
    expect(lines[0]).toMatch(/^╭/);
    expect(out).toContain('hello');
  });

  it('FallbackPanel draws its own titled border at the exact width', () => {
    const out = stripAnsi(
      render(
        <FallbackPanel title="Sessions" width={30}>
          <Text>row</Text>
        </FallbackPanel>,
      ).lastFrame(),
    );
    const [top] = out.split('\n');
    expect(top).toBe('╭─ Sessions ─────────────────╮');
    expect(top?.length).toBe(30);
    expect(out).toContain('row');
    expect(out).toMatch(/╰─+╯/);
  });
});

describe('Panel titles that do not fit', () => {
  const titles = [
    `Detail: ${'very-long-session-name-'.repeat(4)}`,
    'Detail: 日本語のセッション名前日本語のセッション名前',
    'Detail: 🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀',
  ];
  for (const title of titles) {
    it(`truncates "${title.slice(0, 14)}…" by display width and keeps the border intact`, async () => {
      const r = renderSized(
        <Panel title={title} width={30}>
          <Text>hi</Text>
        </Panel>,
        { columns: 30, rows: 20 },
      );
      try {
        await vi.waitFor(() => expect(r.lastFrame()).toContain('Detail'));
        const lines = r.lastFrame().split('\n');
        expect(lines).toHaveLength(3);
        expect(lines[0]).toMatch(/^╭.*Detail.*….*╮$/);
        for (const l of lines) expect(displayWidth(l)).toBe(30);
      } finally {
        r.unmount();
      }
    });
  }
});
