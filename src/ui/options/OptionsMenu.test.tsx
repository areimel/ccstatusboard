import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'ink-testing-library';
import { OptionsMenu } from './OptionsMenu.js';
import { DEFAULT_CONFIG } from '../../config/schema.js';
import type { Config } from '../../domain/types.js';
import { stripAnsi } from '../../../test/helpers/ansi.js';

afterEach(cleanup);
const delay = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const DOWN = '\u001B[B';
const RIGHT = '\u001B[C';

function setup() {
  const onChange = vi.fn();
  const onClose = vi.fn();
  function Harness(): React.JSX.Element {
    const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
    return (
      <OptionsMenu
        config={config}
        width={60}
        onChange={(p) => {
          onChange(p);
          setConfig((c) => ({ ...c, ...p }));
        }}
        onClose={onClose}
      />
    );
  }
  const r = render(<Harness />);
  const press = async (...keys: string[]) => {
    for (const k of keys) {
      r.stdin.write(k);
      await delay();
    }
  };
  const frame = () => stripAnsi(r.lastFrame() ?? '');
  return { r, press, frame, onChange, onClose };
}

describe('OptionsMenu', () => {
  it('renders all rows with restart badges on readonly ones', async () => {
    const { frame } = setup();
    await vi.waitFor(() => expect(frame()).toContain('Options'));
    expect(frame()).toContain('Theme');
    expect(frame()).toContain('Usage API');
    expect(frame().match(/restart/gi)).toHaveLength(2);
    expect(frame().match(/restart/gi)).toHaveLength(2);
  });
  it('Esc closes', async () => {
    const { press, onClose } = setup();
    await delay();
    await press('\u001B');
    expect(onClose).toHaveBeenCalled();
  });
  it('right on theme cycles theme', async () => {
    const { press, frame, onChange } = setup();
    await delay();
    await press(RIGHT);
    expect(onChange).toHaveBeenCalledWith({ theme: 'mono' });
    expect(frame()).toContain('mono');
  });
  it('down then right changes sort', async () => {
    const { press, frame, onChange } = setup();
    await delay();
    await press(DOWN, DOWN, RIGHT);
    expect(onChange).toHaveBeenCalledWith({ sort: 'activity' });
    expect(frame()).toContain('activity');
  });
  it('Enter on subscription, type 200, Enter', async () => {
    const { press, frame, onChange } = setup();
    await delay();
    await press(DOWN, '\r', '2', '0', '0', '\r');
    expect(onChange).toHaveBeenCalledWith({ subscriptionUSD: 200 });
    expect(frame()).toContain('$200/mo');
  });
  it('invalid number input is ignored and Esc cancels the edit', async () => {
    const { press, onChange, onClose } = setup();
    await delay();
    await press(DOWN, DOWN, DOWN, DOWN, DOWN, DOWN, DOWN, '\r', 'x', '\r');
    expect(onChange).not.toHaveBeenCalled();
    await press('\u001B');
    expect(onClose).not.toHaveBeenCalled();
  });
  it('readonly row ignores right', async () => {
    const { press, onChange } = setup();
    await delay();
    for (let i = 0; i < 9; i++) await press(DOWN);
    await press(RIGHT, '\r');
    expect(onChange).not.toHaveBeenCalled();
  });
  it('columns editor: deselect one and submit', async () => {
    const { press, onChange } = setup();
    await delay();
    await press(DOWN, DOWN, DOWN, DOWN, DOWN, '\r', ' ', '\r');
    expect(onChange).toHaveBeenCalledWith({ columns: expect.not.arrayContaining(['status']) });
  });
});
