import type { JSX } from 'react';
import { Box, Text } from 'ink';
import { displayWidth } from '../domain/format.js';
import { useTheme } from './theme.js';

const HINTS: Array<[string, string]> = [
  ['F1', 'Help'],
  ['↑↓', 'Select'],
  ['⏎', 'Detail'],
  ['s', 'Sort'],
  ['f', 'Filter'],
  ['/', 'Search'],
  ['q', 'Quit'],
];

const COLUMN_GAP = 2;
const PADDING_X = 1;

function hintsWidth(hints: Array<[string, string]>): number {
  const text = hints.reduce((n, [key, label]) => n + displayWidth(key) + displayWidth(label), 0);
  return text + COLUMN_GAP * (hints.length - 1) + PADDING_X * 2;
}

interface FooterProps {
  mode: 'normal' | 'search';
  search: string;
  /** Terminal width; the theme hint is omitted when it would not fit. Undefined means always show. */
  width?: number;
}

export function Footer({ mode, search, width }: FooterProps): JSX.Element {
  const theme = useTheme();
  if (mode === 'search') {
    return (
      <Box paddingX={1}>
        <Text>
          <Text color={theme.accent} bold>
            /{search}
          </Text>
          <Text color={theme.accent}>█</Text>
          <Text color={theme.dim}> ⏎ done · Esc clear</Text>
        </Text>
      </Box>
    );
  }
  const quit = HINTS.slice(-1);
  const withTheme: Array<[string, string]> = [...HINTS.slice(0, -1), ['t', theme.name], ...quit];
  const hints = width === undefined || hintsWidth(withTheme) <= width ? withTheme : HINTS;
  return (
    <Box paddingX={PADDING_X} columnGap={COLUMN_GAP}>
      {hints.map(([key, label]) => (
        <Text key={key}>
          <Text color={theme.text} bold>
            {key}
          </Text>
          <Text color={theme.accent}>{label}</Text>
        </Text>
      ))}
    </Box>
  );
}
