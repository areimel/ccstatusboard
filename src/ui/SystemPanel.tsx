import type { JSX } from 'react';
import { Box, Text } from 'ink';
import { Sparkline } from '@pppp606/ink-chart';
import { formatPair, formatRate, ratioPercent } from '../domain/format.js';
import type { Snapshot, SystemMetricKey, SystemStats } from '../domain/types.js';
import { MeterStack, type MeterRow } from './MeterStack.js';
import { splitColumns } from './layout.js';
import { Panel } from './Panel.js';
import {
  buildSystemLayout,
  systemContentRows,
  SYSTEM_MIDDLE_WIDTH as RIGHT_WIDTH,
  type Row,
  type Segment,
} from './systemMetrics.js';
import { levelColor, useTheme } from './theme.js';

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

/** Exact rendered height of <SystemPanel>: 2 border rows + its tallest column and stacked rows. */
export function systemPanelRows(snapshot: Snapshot, width: number, groups: SystemMetricKey[]): number {
  const { system } = snapshot;
  return 2 + (system ? systemContentRows(system, groups, width) : 1);
}

function SegmentText({ segment }: { segment: Segment }) {
  const theme = useTheme();
  if (segment.title) {
    return (
      <Text color={theme.accent} bold>
        {segment.value}
      </Text>
    );
  }
  const color = segment.heat ? levelColor(theme, segment.heat.value, segment.heat.thresholds) : theme.text;
  return (
    <>
      {segment.label === undefined ? null : <Text color={theme.dim}>{`${segment.label} `}</Text>}
      <Text color={color}>{segment.value}</Text>
    </>
  );
}

/** One fixed line; an empty row still takes its line so slots keep their height. */
function MetricRow({ row }: { row: Row }) {
  if (row.length === 0) return <Text> </Text>;
  return (
    <Text wrap="truncate-end">
      {row.map((segment, i) => (
        <Text key={i}>
          {i > 0 ? '  ' : ''}
          <SegmentText segment={segment} />
        </Text>
      ))}
    </Text>
  );
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

function NetColumn({
  system,
  history,
  extra,
}: {
  system: SystemStats;
  history: Snapshot['systemHistory'];
  extra: Row[];
}) {
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
      {extra.map((row, i) => (
        <MetricRow key={i} row={row} />
      ))}
    </Box>
  );
}

export function SystemPanel({
  snapshot,
  width,
  groups,
}: {
  snapshot: Snapshot;
  width: number;
  groups: SystemMetricKey[];
}): JSX.Element {
  const theme = useTheme();
  const { system } = snapshot;
  if (!system) {
    return (
      <Panel title="System" width={width}>
        <Text color={theme.dim}>sampling…</Text>
      </Panel>
    );
  }
  const layout = buildSystemLayout(system, groups, width);
  const third = layout.thirdWidth > 0 ? layout.thirdWidth + 2 : 0;
  const { leftWidth } = splitColumns(width, RIGHT_WIDTH + third);
  return (
    <Panel title="System" width={width}>
      <Box flexDirection="row" columnGap={2}>
        <Box flexDirection="column" width={leftWidth}>
          <MeterStack
            rows={meterRows(system)}
            leftWidth={leftWidth}
            minLabelWidth={layout.left.length > 0 ? 'Press'.length : 0}
          />
          {layout.left.map((row, i) => (
            <MetricRow key={i} row={row} />
          ))}
        </Box>
        <NetColumn system={system} history={snapshot.systemHistory} extra={layout.middle} />
        {layout.thirdWidth > 0 ? (
          <Box flexDirection="column" width={layout.thirdWidth}>
            {layout.right.map((row, i) => (
              <MetricRow key={i} row={row} />
            ))}
          </Box>
        ) : null}
      </Box>
      {layout.below.map((row, i) => (
        <MetricRow key={i} row={row} />
      ))}
    </Panel>
  );
}
