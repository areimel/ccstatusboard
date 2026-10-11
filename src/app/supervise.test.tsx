import { describe, expect, it, vi } from 'vitest';
import { Text } from 'ink';
import { superviseInk } from './supervise.js';
import { renderSized } from '../../test/helpers/renderSized.js';

function Boom(): never {
  throw new Error('kaboom');
}

describe('superviseInk', () => {
  it('routes a component render error to onCrash (Ink only rejects waitUntilExit)', async () => {
    const onExit = vi.fn();
    const onCrash = vi.fn();
    const r = renderSized(<Boom />, { columns: 80, rows: 24 });
    superviseInk(r.instance, { onExit, onCrash });
    await vi.waitFor(() => expect(onCrash).toHaveBeenCalledTimes(1));
    expect((onCrash.mock.calls[0]![0] as Error).message).toBe('kaboom');
    expect(onExit).not.toHaveBeenCalled();
  });

  it('calls onExit when the app unmounts normally', async () => {
    const onExit = vi.fn();
    const onCrash = vi.fn();
    const r = renderSized(<Text>ok</Text>, { columns: 80, rows: 24 });
    superviseInk(r.instance, { onExit, onCrash });
    r.unmount();
    await vi.waitFor(() => expect(onExit).toHaveBeenCalledTimes(1));
    expect(onCrash).not.toHaveBeenCalled();
  });
});
