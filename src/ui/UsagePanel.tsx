import type { JSX } from 'react';
import { Box, Text } from 'ink';
import { Sparkline } from '@pppp606/ink-chart';
import { Spinner } from '@inkjs/ui';
import type { Limit, LimitsState, Snapshot } from '../domain/types.js';
import { formatDuration, formatResetsAt, formatUSD } from '../domain/format.js';
import { KeyValue } from './KeyValue.js';
import { BURN_RATE_ROWS, BurnRate } from './BurnRate.js';
import { MeterStack, type MeterRow } from './MeterStack.js';
import { splitColumns } from './layout.js';
import { Panel } from './Panel.js';
import { useTheme } from './theme.js';

const RIGHT_WIDTH = 20;
const COST_LABEL_WIDTH = 7;

const STATUS_MESSAGE: Partial<Record<LimitsState['status'], string>> = {
  loading: 'loading…',
  'no-credentials': 'login required',
  disabled: 'disabled',
  expired: 'expired — open Claude Code to refresh',
  error: 'limits unavailable',
};

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

/** Month cost as a multiple of the subscription price; undefined when not computable. */
function planRatio(snapshot: Snapshot, subscriptionUSD: number | null | undefined): number | undefined {
  const month = snapshot.costs.month.costUSD;
  if (subscriptionUSD == null || subscriptionUSD <= 0 || month === null) return undefined;
  return month / subscriptionUSD;
}

/** Exact rendered height of <UsagePanel>: 2 border rows + the taller of its two columns. */
export function usagePanelRows(snapshot: Snapshot, subscriptionUSD?: number | null): number {
  const { limits, scan } = snapshot;
  const limitLines = hasLimitValues(limits)
    ? meterRows(limits, snapshot.now).length + (isLimitsStale(limits) ? 1 : 0)
    : 1;
  const left = limitLines + (hasLimitValues(limits) ? BURN_RATE_ROWS : 0) + 1; // + burn/sparkline row
  const right = 4 + (planRatio(snapshot, subscriptionUSD) === undefined ? 0 : 1) + (scan.done ? 0 : 1);
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
  const isStale = isLimitsStale(limits);
  return (
    <Box flexDirection="column">
      <MeterStack rows={rows} leftWidth={leftWidth} />
      {isStale ? (
        <Text color={theme.dim} wrap="truncate-end">
          stale {limits.fetchedAt === undefined ? '?' : formatDuration(now - limits.fetchedAt)}
          {limits.status === 'expired' ? ` · ${STATUS_MESSAGE.expired}` : ''}
        </Text>
      ) : null}
    </Box>
  );
}

function CostColumn({
  snapshot,
  subscriptionUSD,
}: {
  snapshot: Snapshot;
  subscriptionUSD: number | null | undefined;
}) {
  const theme = useTheme();
  const ratio = planRatio(snapshot, subscriptionUSD);
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
        <KeyValue key={label} label={label} value={formatUSD(v)} labelWidth={COST_LABEL_WIDTH} />
      ))}
      {ratio === undefined ? null : (
        <KeyValue
          label="plan"
          value={`${ratio.toFixed(1)}×`}
          labelWidth={COST_LABEL_WIDTH}
          valueColor={ratio >= 1 ? theme.ok : theme.dim}
        />
      )}
      {scan.done ? null : <Spinner label={`scanning ${scan.filesDone}/${scan.filesTotal}…`} />}
    </Box>
  );
}

export function UsagePanel({
  snapshot,
  width,
  subscriptionUSD,
}: {
  snapshot: Snapshot;
  width: number;
  subscriptionUSD?: number | null;
}): JSX.Element {
  const theme = useTheme();
  const { leftWidth } = splitColumns(width, RIGHT_WIDTH);
  const burn = snapshot.costs.burnRatePerHour;
  const burnText = burn === null ? 'burn —' : `burn ${formatUSD(burn)}/h`;
  const sparkWidth = Math.max(8, Math.min(48, leftWidth - burnText.length - 8));
  return (
    <Panel title="Usage" width={width}>
      <Box flexDirection="row" columnGap={2}>
        <Box flexDirection="column" width={leftWidth}>
          <LimitsBlock limits={snapshot.limits} now={snapshot.now} leftWidth={leftWidth} />
          {hasLimitValues(snapshot.limits) ? (
            <BurnRate burn={snapshot.burn} now={snapshot.now} width={leftWidth} />
          ) : null}
          <Box columnGap={1}>
            <Text color={theme.text}>{burnText}</Text>
            <Text color={theme.dim}> 24h</Text>
            <Sparkline data={snapshot.costs.hourlySparkline} width={sparkWidth} />
          </Box>
        </Box>
        <CostColumn snapshot={snapshot} subscriptionUSD={subscriptionUSD} />
      </Box>
    </Panel>
  );
}
