import type { JSX } from 'react';
import { Box, Text } from 'ink';
import type { BurnBand, BurnProjection, Snapshot } from '../domain/types.js';
import { formatClock, formatPercent, formatWeekdayTime } from '../domain/format.js';
import { useTheme, type Theme } from './theme.js';

/** Heading + one row per window (5h, Week). */
export const BURN_RATE_ROWS = 3;
/** Rendered height of <BurnRate>. */
export const burnRateRows = (_burn?: Snapshot['burn']): number => BURN_RATE_ROWS;

const BAND_LABEL: Record<BurnBand, string> = {
  under: 'UNDER',
  near: 'NEAR LIMIT',
  over: 'OVER',
  critical: 'CRITICAL',
};
const LABEL_WIDTH = 5;
const PROJ_WIDTH = 10;
const BAND_WIDTH = 11;

function bandColor(theme: Theme, band: BurnBand): string {
  if (band === 'under') return theme.ok;
  if (band === 'near') return theme.warn;
  return theme.danger;
}

function hitsText(p: BurnProjection, now: number, kind: 'block' | 'week'): string {
  if (p.hitAt === undefined) return 'hits n/a';
  if (p.hitAt <= now) return 'limit reached';
  const when = kind === 'block' ? formatClock(p.hitAt) : formatWeekdayTime(p.hitAt);
  const pct = p.hitWindowPct === undefined ? '' : ` (${formatPercent(p.hitWindowPct)} of ${kind})`;
  return `hits ${when}${pct}`;
}

function Row({
  label,
  kind,
  p,
  now,
}: {
  label: string;
  kind: 'block' | 'week';
  p: BurnProjection | undefined;
  now: number;
}) {
  const theme = useTheme();
  const color = p ? bandColor(theme, p.band) : theme.dim;
  return (
    <Text wrap="truncate-end">
      <Text color={theme.dim}>{label.padEnd(LABEL_WIDTH)}</Text>
      {p ? (
        <>
          <Text color={color}>{`proj ${formatPercent(p.projectedPct)}`.padEnd(PROJ_WIDTH)}</Text>
          <Text color={color} bold>
            {BAND_LABEL[p.band]}
          </Text>
          <Text>{' '.repeat(Math.max(1, BAND_WIDTH - BAND_LABEL[p.band].length))}</Text>
          <Text color={theme.text}>{hitsText(p, now, kind)}</Text>
        </>
      ) : (
        <Text color={theme.dim}>—</Text>
      )}
    </Text>
  );
}

export function BurnRate({
  burn,
  now,
  width,
}: {
  burn: Snapshot['burn'];
  now: number;
  width: number;
}): JSX.Element {
  const theme = useTheme();
  return (
    <Box flexDirection="column" width={width}>
      <Text color={theme.accent} bold wrap="truncate-end">
        Burn Rate
      </Text>
      <Row label="5h" kind="block" p={burn.block} now={now} />
      <Row label="Week" kind="week" p={burn.week} now={now} />
    </Box>
  );
}
