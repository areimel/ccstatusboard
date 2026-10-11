import type { JSX } from 'react';
import { Text } from 'ink';
import { levelColor, useTheme } from './theme.js';

export interface MeterProps {
  label: string;
  percent: number | undefined;
  /** Total width of the bracketed bar, including both brackets. */
  width: number;
  suffix?: string;
  labelWidth?: number;
}

/** htop-style meter: `Label [|||||||     58%] suffix`. */
export function Meter({ label, percent, width, suffix, labelWidth }: MeterProps): JSX.Element {
  const theme = useTheme();
  const inner = Math.max(6, width - 2);
  const labelText = label.padEnd(labelWidth ?? label.length);
  const suffixEl = suffix ? <Text color={theme.dim}> {suffix}</Text> : null;

  if (percent === undefined || !Number.isFinite(percent)) {
    const left = Math.floor((inner - 1) / 2);
    return (
      <Text wrap="truncate-end">
        <Text color={theme.accent} bold>
          {labelText}
        </Text>{' '}
        <Text color={theme.border}>[</Text>
        <Text color={theme.dim}>
          {' '.repeat(left)}—{' '.repeat(inner - 1 - left)}
        </Text>
        <Text color={theme.border}>]</Text>
        {suffixEl}
      </Text>
    );
  }

  const clamped = Math.min(100, Math.max(0, percent));
  const pctText = `${Math.round(percent)}%`;
  const filled = Math.round((inner * clamped) / 100);
  const barRoom = Math.max(0, inner - pctText.length);
  const bars = Math.min(filled, barRoom);
  const spaces = barRoom - bars;

  return (
    <Text wrap="truncate-end">
      <Text color={theme.accent} bold>
        {labelText}
      </Text>{' '}
      <Text color={theme.border}>[</Text>
      <Text color={levelColor(theme, percent)}>{'|'.repeat(bars)}</Text>
      {' '.repeat(spaces)}
      <Text color={theme.text} bold>
        {pctText}
      </Text>
      <Text color={theme.border}>]</Text>
      {suffixEl}
    </Text>
  );
}
