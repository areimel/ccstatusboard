import type { JSX } from 'react';
import { Text } from 'ink';
import { useTheme } from './theme.js';

export interface KeyValueProps {
  label: string;
  value: string;
  /** Columns the dim label is padded to. Defaults to label.length + 1. */
  labelWidth?: number;
  /** Defaults to theme.text. */
  valueColor?: string;
  bold?: boolean;
}

/** One `label  value` line: dim padded label, then the value. */
export function KeyValue({ label, value, labelWidth, valueColor, bold = true }: KeyValueProps): JSX.Element {
  const theme = useTheme();
  return (
    <Text wrap="truncate-end">
      <Text color={theme.dim}>{label.padEnd(labelWidth ?? label.length + 1)}</Text>
      <Text color={valueColor ?? theme.text} bold={bold}>
        {value}
      </Text>
    </Text>
  );
}
