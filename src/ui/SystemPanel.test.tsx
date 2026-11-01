import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'ink-testing-library';
import { SystemPanel, systemPanelRows } from './SystemPanel.js';
import { makeSnapshot } from '../../test/helpers/snapshot.js';
import { renderSized } from '../../test/helpers/renderSized.js';
import { stripAnsi } from '../../test/helpers/ansi.js';
import { makeFullSystemStats, makeSystemStats } from '../../test/helpers/system.js';
import {
  SYSTEM_METRIC_KEYS,
  type Snapshot,
  type SystemMetricKey,
  type SystemStats,
} from '../domain/types.js';

afterEach(cleanup);

const SYSTEM = makeSystemStats();
const snap = (system?: SystemStats | null): Snapshot =>
  makeSnapshot({
    ...(system === null ? {} : { system: system ?? SYSTEM }),
    systemHistory: { cpu: [1, 2, 3], rx: [1, 5, 2, 8], tx: [0, 1, 0, 2] },
  });

async function frame(s: Snapshot): Promise<string> {
  const { lastFrame } = render(<SystemPanel snapshot={s} width={100} groups={[]} />);
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
    const r = renderSized(<SystemPanel snapshot={s} width={100} groups={[]} />, { columns: 100, rows: 40 });
    await vi.waitFor(() => expect(r.lastFrame()).toContain('System'));
    expect(r.lastFrame().split('\n')).toHaveLength(systemPanelRows(s, 100, []));
    r.unmount();
  });

  describe('extra metrics', () => {
    const FULL = makeFullSystemStats();
    const ALL = [...SYSTEM_METRIC_KEYS];

    async function sized(
      s: Snapshot,
      columns: number,
      groups: SystemMetricKey[],
    ): Promise<{ text: string; lines: string[] }> {
      const r = renderSized(<SystemPanel snapshot={s} width={columns} groups={groups} />, {
        columns,
        rows: 40,
      });
      await vi.waitFor(() => expect(r.lastFrame()).toContain('System'));
      const lines = stripAnsi(r.lastFrame()).split('\n');
      r.unmount();
      for (const l of lines) expect(l.length).toBeLessThanOrEqual(columns);
      return { text: lines.join('\n'), lines };
    }

    it('shows every group in columns at 100 wide', async () => {
      const { text, lines } = await sized(snap(FULL), 100, ALL);
      const row = (needle: string) => lines.find((l) => l.includes(needle)) ?? '';
      expect(text).toContain('CPU 66°');
      expect(text).toContain('SSD 34°');
      expect(text).toContain('98%');
      expect(text).toContain('up 1h9m');
      expect(text).toContain('4.17GHz');
      expect(text).toContain('balanced');
      expect(text).toContain('Press');
      expect(text).toContain('wlp2s0');
      expect(text).toContain('192.168.1.160');
      // The third column sits beside the meters, not below them.
      expect(row('Mem')).toContain('↑');
      expect(row('CPU 66°')).toContain('load');
    });

    it('stacks extras under the base columns at 99 wide', async () => {
      const { lines } = await sized(snap(FULL), 99, ALL);
      const temp = lines.find((l) => l.includes('CPU 66°')) ?? '';
      expect(temp).toMatch(/Temp\s+CPU 66°/);
      expect(temp).not.toContain('load');
      expect(lines.some((l) => /Link\s+wlp2s0/.test(l))).toBe(true);
    });

    it.each(ALL)('removes only %s content when that group is off', async (off) => {
      const needles: Record<SystemMetricKey, string> = {
        temps: 'CPU 66°',
        power: '98%',
        chips: '4.17GHz',
        pressure: 'Press',
        network: 'wlp2s0',
      };
      const { text } = await sized(
        snap(FULL),
        120,
        ALL.filter((k) => k !== off),
      );
      expect(text).not.toContain(needles[off]);
      for (const k of ALL) if (k !== off) expect(text).toContain(needles[k]);
    });

    it.each([60, 80, 99, 100, 120, 160])('systemPanelRows matches rendered height at %i wide', async (w) => {
      for (const groups of [ALL, [], ['temps'], ['network'], ['pressure', 'chips']] as SystemMetricKey[][]) {
        const { lines } = await sized(snap(FULL), w, groups);
        expect(lines).toHaveLength(systemPanelRows(snap(FULL), w, groups));
      }
    });

    it('keeps its height when live values change', async () => {
      const unplugged = makeFullSystemStats({
        battery: {
          percent: 41,
          status: 'Discharging',
          watts: 12.3,
          secondsLeft: 7200,
          healthPercent: 92,
          cycles: 40,
        },
        gpu: { busyPercent: 100, vramUsed: 3 * 1024 ** 3, clockHz: 1.8e9, watts: 45 },
        link: { iface: 'enx00e04c680001', ip: '192.168.100.200', signalDbm: -100, vpn: 'tailscale0' },
      });
      const offline = makeFullSystemStats({ gpu: undefined, link: {} });
      for (const w of [80, 100]) {
        const base = (await sized(snap(FULL), w, ALL)).lines.length;
        expect((await sized(snap(unplugged), w, ALL)).lines).toHaveLength(base);
        expect((await sized(snap(offline), w, ALL)).lines).toHaveLength(base);
      }
    });

    it('shows offline when there is no default route', async () => {
      const { text } = await sized(snap(makeFullSystemStats({ link: {} })), 100, ALL);
      expect(text).toContain('offline');
    });
  });
});
