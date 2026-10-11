import type { JSX } from 'react';
import { Box, Text } from 'ink';
import { Panel } from './Panel.js';
import { useTheme } from './theme.js';

const KEYS: Array<[string, string]> = [
  ['↑/↓  j/k', 'Move selection'],
  ['⏎', 'Toggle detail pane'],
  ['g / G', 'Top / bottom'],
  ['s', 'Cycle sort (status → activity → cost → ctx → name)'],
  ['f', 'Toggle filter (all / live)'],
  ['/', 'Search by name or cwd (Esc clears)'],
  ['? / F1', 'Toggle this help'],
  ['q / Ctrl-C', 'Quit'],
];

const LEGEND = ['● waiting', '◐ busy', '○ idle', '· ended'];

/** `width` defaults to 64; App passes `Math.min(64, columns)` so the border fits narrow terminals. */
export function HelpOverlay({ width = 64 }: { width?: number } = {}): JSX.Element {
  const theme = useTheme();
  return (
    <Panel title="Help" width={width}>
      {KEYS.map(([key, label]) => (
        <Box key={key}>
          <Box width={14}>
            <Text color={theme.accent} bold>
              {key}
            </Text>
          </Box>
          <Text color={theme.text}>{label}</Text>
        </Box>
      ))}
      <Box marginTop={1} columnGap={3}>
        {LEGEND.map((l) => (
          <Text key={l} color={theme.dim}>
            {l}
          </Text>
        ))}
      </Box>
    </Panel>
  );
}
