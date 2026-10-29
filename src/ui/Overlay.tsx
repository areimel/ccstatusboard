import type { JSX, ReactNode } from 'react';
import { Box, Text } from 'ink';
import { Panel } from './Panel.js';
import { useTheme } from './theme.js';

export interface OverlayProps {
  title: string;
  width: number;
  children: ReactNode;
  /** Dim last line, e.g. "Esc close". */
  hint?: string;
}

/** Shared modal frame: a titled Panel holding a column of content and an optional dim hint. */
export function Overlay({ title, width, children, hint }: OverlayProps): JSX.Element {
  const theme = useTheme();
  return (
    <Panel title={title} width={width}>
      <Box flexDirection="column">
        {children}
        {hint ? <Text color={theme.dim}>{hint}</Text> : null}
      </Box>
    </Panel>
  );
}
