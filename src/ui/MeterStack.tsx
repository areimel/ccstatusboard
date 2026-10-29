import type { JSX } from 'react';
import { Box } from 'ink';
import { Meter } from './Meter.js';

export const SUFFIX_WIDTH = 18;

export interface MeterRow {
  label: string;
  percent: number | undefined;
  suffix?: string;
}

/** A column of meters sharing one label width and one bar width. */
export function MeterStack({ rows, leftWidth }: { rows: MeterRow[]; leftWidth: number }): JSX.Element {
  const labelWidth = Math.max(...rows.map((r) => r.label.length));
  const meterWidth = Math.max(10, Math.min(60, leftWidth - labelWidth - 1 - SUFFIX_WIDTH - 1));
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
    </Box>
  );
}
