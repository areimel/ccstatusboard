import type { JSX } from 'react';
import { Box, Text } from 'ink';
import { displayWidth } from '../domain/format.js';
import { THEME_NAMES } from '../domain/types.js';
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
// Fit-check against the longest name so the hint doesn't flicker in and out while cycling.
const LONGEST_THEME = THEME_NAMES.reduce((a, b) => (b.length > a.length ? b : a));

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
  const withTheme = (label: string): Array<[string, string]> => [
    ...HINTS.slice(0, -1),
    ['t', label],
    ...HINTS.slice(-1),
  ];
  const fits = width === undefined || hintsWidth(withTheme(LONGEST_THEME)) <= width;
  const hints = fits ? withTheme(theme.name) : HINTS;
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
