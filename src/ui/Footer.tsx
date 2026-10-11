import type { JSX } from 'react';
import { Box, Text } from 'ink';
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

export function Footer({ mode, search }: { mode: 'normal' | 'search'; search: string }): JSX.Element {
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
  return (
    <Box paddingX={1} columnGap={2}>
      {HINTS.map(([key, label]) => (
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
