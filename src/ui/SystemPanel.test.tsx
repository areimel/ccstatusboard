import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'ink-testing-library';
import { SystemPanel, systemPanelRows } from './SystemPanel.js';
import { makeSnapshot } from '../../test/helpers/snapshot.js';
import { renderSized } from '../../test/helpers/renderSized.js';
import { stripAnsi } from '../../test/helpers/ansi.js';
import { makeSystemStats } from '../../test/helpers/system.js';
import type { Snapshot, SystemStats } from '../domain/types.js';

afterEach(cleanup);

const SYSTEM = makeSystemStats();
const snap = (system?: SystemStats | null): Snapshot =>
  makeSnapshot({
    ...(system === null ? {} : { system: system ?? SYSTEM }),
    systemHistory: { cpu: [1, 2, 3], rx: [1, 5, 2, 8], tx: [0, 1, 0, 2] },
  });

async function frame(s: Snapshot): Promise<string> {
  const { lastFrame } = render(<SystemPanel snapshot={s} width={100} />);
  await vi.waitFor(() => expect(stripAnsi(lastFrame())).toContain('System'));
  return stripAnsi(lastFrame());
}

describe('SystemPanel', () => {
  it('renders cpu, mem, swap and disk meters', async () => {
    const out = await frame(snap());
    expect(out).toMatch(/CPU\s+\[\|+\s*42%\]\s+load 1\.2 0\.9 0\.8/);
    expect(out).toMatch(/Mem\s+\[\|+\s*33%\]\s+5\.1G\/15\.6G/);
    expect(out).toMatch(/Swap\s+\[\|+\s*25%\]\s+512M\/2G/);
    expect(out).toMatch(/Disk\s+\[\|+\s*20%\]\s+100G\/500G \//);
  });

  it('omits the swap row when swap total is 0', async () => {
    const out = await frame(snap({ ...SYSTEM, swap: { used: 0, total: 0 } }));
    expect(out).not.toContain('Swap');
  });

  it('shows sampling state without system stats', async () => {
    const out = await frame(snap(null));
    expect(out).toContain('sampling…');
    expect(out).not.toContain('CPU');
  });

  it('shows net rates and per-core blocks', async () => {
    const out = await frame(snap());
    expect(out).toContain('↓ 1.2M/s');
    expect(out).toContain('↑ 34K/s');
    expect(out).toContain('cores ▁▅██');
  });

  it.each([
    ['full', snap()],
    ['wide rates', snap({ ...SYSTEM, net: { rxPerSec: 1023 * 1024 ** 2, txPerSec: 1000 * 1024 } })],
    ['no swap', snap({ ...SYSTEM, swap: { used: 0, total: 0 } })],
    ['sampling', snap(null)],
  ])('systemPanelRows matches rendered height (%s)', async (_n, s) => {
    const r = renderSized(<SystemPanel snapshot={s} width={100} />, { columns: 100, rows: 40 });
    await vi.waitFor(() => expect(r.lastFrame()).toContain('System'));
    expect(r.lastFrame().split('\n')).toHaveLength(systemPanelRows(s));
    r.unmount();
  });
});
