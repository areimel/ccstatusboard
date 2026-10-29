import type { JSX } from 'react';
import { Box, Text } from 'ink';
import { displayWidth } from '../domain/format.js';
import { THEME_NAMES } from '../domain/types.js';
import { useTheme } from './theme.js';

type Hint = [string, string];

/** Always-shown hints, in display order. Quit is last. */
const HINTS: Hint[] = [
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

function hintsWidth(hints: Hint[]): number {
  const text = hints.reduce((n, [key, label]) => n + displayWidth(key) + displayWidth(label), 0);
  return text + COLUMN_GAP * (hints.length - 1) + PADDING_X * 2;
}

/**
 * Normal-mode hints. Optional hints sit around the essentials: `esc Options` after
 * Search, and the theme hint just before Quit.
 */
function normalHints(theme: string | undefined, esc: boolean): Hint[] {
  const hints = HINTS.slice(0, -1);
  if (esc) hints.push(['esc', 'Options']);
  if (theme !== undefined) hints.push(['t', theme]);
  hints.push(HINTS.slice(-1)[0]);
  return hints;
}

// Optional-hint variants, most wanted first. The options hint is the way to reach
// theme editing, so it outlasts the theme hint when the terminal is narrow.
const VARIANTS = [
  { theme: true, esc: true },
  { theme: false, esc: true },
  { theme: true, esc: false },
  { theme: false, esc: false },
];

interface FooterProps {
  mode: 'normal' | 'search';
  search: string;
  /** Terminal width; optional hints are omitted when they would not fit. Undefined means always show. */
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
  const fits = (v: { theme: boolean; esc: boolean }): boolean =>
    hintsWidth(normalHints(v.theme ? LONGEST_THEME : undefined, v.esc)) <= (width ?? Infinity);
  const v = VARIANTS.find(fits) ?? VARIANTS[VARIANTS.length - 1];
  const hints = normalHints(v.theme ? theme.name : undefined, v.esc);
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
