import type { JSX } from 'react';
import { Box, Text } from 'ink';
import { Sparkline } from '@pppp606/ink-chart';
import { formatPair, formatRate, ratioPercent } from '../domain/format.js';
import type { Snapshot, SystemStats } from '../domain/types.js';
import { MeterStack, type MeterRow } from './MeterStack.js';
import { splitColumns } from './layout.js';
import { Panel } from './Panel.js';
import { levelColor, useTheme } from './theme.js';

const RIGHT_WIDTH = 26;
const RATE_WIDTH = 10; // '↑ 1023K/s' is the widest rate label
const BLOCKS = '▁▂▃▄▅▆▇█';

const fmt1 = (n: number): string => n.toFixed(1);

function meterRows(s: SystemStats): MeterRow[] {
  const rows: MeterRow[] = [
    { label: 'CPU', percent: s.cpu.total, suffix: `load ${s.load.map(fmt1).join(' ')}` },
    {
      label: 'Mem',
      percent: ratioPercent(s.mem.used, s.mem.total),
      suffix: formatPair(s.mem.used, s.mem.total),
    },
  ];
  if (s.swap.total > 0) {
    rows.push({
      label: 'Swap',
      percent: ratioPercent(s.swap.used, s.swap.total),
      suffix: formatPair(s.swap.used, s.swap.total),
    });
  }
  rows.push({
    label: 'Disk',
    percent: ratioPercent(s.disk.used, s.disk.total),
    suffix: `${formatPair(s.disk.used, s.disk.total)} ${s.disk.mount}`,
  });
  return rows;
}

const RIGHT_ROWS = 3; // rx, tx, cores

/** Exact rendered height of <SystemPanel>: 2 border rows + the taller of its two columns. */
export function systemPanelRows(snapshot: Snapshot): number {
  const { system } = snapshot;
  return 2 + (system ? Math.max(meterRows(system).length, RIGHT_ROWS) : 1);
}

function coreBlocks(perCore: number[], max: number): string {
  return perCore
    .slice(0, max)
    .map((p) => BLOCKS[Math.min(BLOCKS.length - 1, Math.max(0, Math.floor((p / 100) * BLOCKS.length)))])
    .join('');
}

function NetRow({ arrow, rate, data }: { arrow: string; rate: number; data: number[] }) {
  const theme = useTheme();
  const sparkWidth = RIGHT_WIDTH - RATE_WIDTH - 1;
  return (
    <Box columnGap={1}>
      <Box width={RATE_WIDTH} flexShrink={0}>
        <Text color={theme.text} bold wrap="truncate-end">
          {`${arrow} ${formatRate(rate)}`}
        </Text>
      </Box>
      <Box width={sparkWidth} flexShrink={0}>
        {data.length > 0 ? <Sparkline data={data.slice(-sparkWidth)} width={sparkWidth} /> : null}
      </Box>
    </Box>
  );
}

function NetColumn({ system, history }: { system: SystemStats; history: Snapshot['systemHistory'] }) {
  const theme = useTheme();
  const { perCore } = system.cpu;
  const maxCore = perCore.length > 0 ? Math.max(...perCore) : 0;
  return (
    <Box flexDirection="column" width={RIGHT_WIDTH}>
      <NetRow arrow="↓" rate={system.net.rxPerSec} data={history.rx} />
      <NetRow arrow="↑" rate={system.net.txPerSec} data={history.tx} />
      <Text wrap="truncate-end">
        <Text color={theme.dim}>{'cores '}</Text>
        <Text color={levelColor(theme, maxCore)}>{coreBlocks(perCore, RIGHT_WIDTH - 6)}</Text>
      </Text>
    </Box>
  );
}

export function SystemPanel({ snapshot, width }: { snapshot: Snapshot; width: number }): JSX.Element {
  const theme = useTheme();
  const { system } = snapshot;
  if (!system) {
    return (
      <Panel title="System" width={width}>
        <Text color={theme.dim}>sampling…</Text>
      </Panel>
    );
  }
  const { leftWidth } = splitColumns(width, RIGHT_WIDTH);
  return (
    <Panel title="System" width={width}>
      <Box flexDirection="row" columnGap={2}>
        <Box flexDirection="column" width={leftWidth}>
          <MeterStack rows={meterRows(system)} leftWidth={leftWidth} />
        </Box>
        <NetColumn system={system} history={snapshot.systemHistory} />
      </Box>
    </Panel>
  );
}
