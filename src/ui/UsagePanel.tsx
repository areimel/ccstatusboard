import type { JSX } from 'react';
import { Box, Text } from 'ink';
import { Sparkline } from '@pppp606/ink-chart';
import { Spinner } from '@inkjs/ui';
import type { Limit, LimitsState, Snapshot } from '../domain/types.js';
import { formatDuration, formatResetsAt, formatUSD } from '../domain/format.js';
import { Meter } from './Meter.js';
import { Panel } from './Panel.js';
import { useTheme } from './theme.js';

const RIGHT_WIDTH = 20;
const SUFFIX_WIDTH = 18;

const STATUS_MESSAGE: Partial<Record<LimitsState['status'], string>> = {
  loading: 'loading…',
  'no-credentials': 'login required',
  disabled: 'disabled',
  expired: 'expired — open Claude Code to refresh',
  error: 'limits unavailable',
};

interface MeterRow {
  label: string;
  percent: number | undefined;
  suffix?: string;
}

function meterRows(limits: LimitsState, now: number): MeterRow[] {
  const toRow = (l: Limit): MeterRow => ({
    label: l.label,
    percent: l.percent,
    ...(l.resetsAt === undefined ? {} : { suffix: formatResetsAt(l.resetsAt, now) }),
  });
  const rows: MeterRow[] = [];
  if (limits.block) rows.push(toRow({ ...limits.block, label: '5h' }));
  if (limits.weekly) rows.push(toRow({ ...limits.weekly, label: 'Week' }));
  for (const l of limits.perModelWeekly) rows.push(toRow(l));
  const extra = limits.extra;
  if (extra?.enabled) {
    const amounts =
      extra.usedAmount !== undefined && extra.limitAmount !== undefined
        ? `${extra.usedAmount.toFixed(2)}/${extra.limitAmount.toFixed(2)} ${extra.currency ?? ''}`.trim()
        : undefined;
    rows.push({ label: 'Extra', percent: extra.percent, ...(amounts ? { suffix: amounts } : {}) });
  }
  return rows;
}

const hasLimitValues = (limits: LimitsState): boolean =>
  limits.block !== undefined || limits.weekly !== undefined;
const isLimitsStale = (limits: LimitsState): boolean =>
  limits.status === 'stale' || limits.status === 'error' || limits.status === 'expired';

/** Exact rendered height of <UsagePanel>: 2 border rows + the taller of its two columns. */
export function usagePanelRows(snapshot: Snapshot): number {
  const { limits, scan } = snapshot;
  const limitLines = hasLimitValues(limits)
    ? meterRows(limits, snapshot.now).length + (isLimitsStale(limits) ? 1 : 0)
    : 1;
  const left = limitLines + 1; // + burn/sparkline row
  const right = 4 + (scan.done ? 0 : 1); // cost rows + optional spinner
  return 2 + Math.max(left, right);
}

function LimitsBlock({ limits, now, leftWidth }: { limits: LimitsState; now: number; leftWidth: number }) {
  const theme = useTheme();
  const hasValues = hasLimitValues(limits);
  const message = STATUS_MESSAGE[limits.status];
  if (!hasValues) {
    return (
      <Text wrap="truncate-end">
        <Text color={theme.accent} bold>
          5h / Week{' '}
        </Text>
        <Text color={limits.status === 'disabled' ? theme.dim : theme.warn}>{message ?? 'no data'}</Text>
      </Text>
    );
  }
  const rows = meterRows(limits, now);
  const labelWidth = Math.max(...rows.map((r) => r.label.length));
  const meterWidth = Math.max(10, Math.min(60, leftWidth - labelWidth - 1 - SUFFIX_WIDTH - 1));
  const isStale = isLimitsStale(limits);
  return (
    <Box flexDirection="column">
      {rows.map((r) => (
        <Meter
          key={r.label}
          label={r.label}
          labelWidth={labelWidth}
          percent={r.percent}
          width={meterWidth}
          {...(r.suffix ? { suffix: r.suffix } : {})}
        />
      ))}
      {isStale ? (
        <Text color={theme.dim} wrap="truncate-end">
          stale {limits.fetchedAt === undefined ? '?' : formatDuration(now - limits.fetchedAt)}
          {limits.status === 'expired' ? ` · ${STATUS_MESSAGE.expired}` : ''}
        </Text>
      ) : null}
    </Box>
  );
}

function CostColumn({ snapshot }: { snapshot: Snapshot }) {
  const theme = useTheme();
  const { costs, scan } = snapshot;
  const rows: Array<[string, number | null]> = [
    ['block', costs.block.costUSD],
    ['week', costs.week.costUSD],
    ['today', costs.today.costUSD],
    ['month', costs.month.costUSD],
  ];
  return (
    <Box flexDirection="column" width={RIGHT_WIDTH}>
      {rows.map(([label, v]) => (
        <Text key={label} wrap="truncate-end">
          <Text color={theme.dim}>{label.padEnd(7)}</Text>
          <Text color={theme.text} bold>
            {formatUSD(v)}
          </Text>
        </Text>
      ))}
      {scan.done ? null : <Spinner label={`scanning ${scan.filesDone}/${scan.filesTotal}…`} />}
    </Box>
  );
}

export function UsagePanel({ snapshot, width }: { snapshot: Snapshot; width: number }): JSX.Element {
  const theme = useTheme();
  const inner = Math.max(20, width - 4);
  const leftWidth = Math.max(20, inner - RIGHT_WIDTH - 2);
  const burn = snapshot.costs.burnRatePerHour;
  const burnText = burn === null ? 'burn —' : `burn ${formatUSD(burn)}/h`;
  const sparkWidth = Math.max(8, Math.min(48, leftWidth - burnText.length - 8));
  return (
    <Panel title="Usage" width={width}>
      <Box flexDirection="row" columnGap={2}>
        <Box flexDirection="column" width={leftWidth}>
          <LimitsBlock limits={snapshot.limits} now={snapshot.now} leftWidth={leftWidth} />
          <Box columnGap={1}>
            <Text color={theme.text}>{burnText}</Text>
            <Text color={theme.dim}> 24h</Text>
            <Sparkline data={snapshot.costs.hourlySparkline} width={sparkWidth} />
          </Box>
        </Box>
        <CostColumn snapshot={snapshot} />
      </Box>
    </Panel>
  );
}
