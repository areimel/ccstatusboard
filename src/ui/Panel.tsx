import type { JSX, ReactNode } from 'react';
import { Box, Text } from 'ink';
import { TitledBox } from '@mishieck/ink-titled-box';
import { useTheme } from './theme.js';

/**
 * Single switch: set to false if @mishieck/ink-titled-box misbehaves on the
 * installed Ink version (Task 1 Step 7). If the package was uninstalled,
 * also delete the TitledBox import and the TitledBox branch below.
 */
export const USE_TITLED_BOX = true;

export interface PanelProps {
  title: string;
  children: ReactNode;
  /** Pass a number: the fallback border needs it to draw the top edge. */
  width?: number | string;
  flexGrow?: number;
}

/** Hand-drawn titled border: `╭─ Title ────╮` above a round box without a top edge. */
export function FallbackPanel({ title, children, width, flexGrow }: PanelProps): JSX.Element {
  const theme = useTheme();
  const head = '╭─ ';
  const titleText = `${title} `;
  const fill = typeof width === 'number' ? Math.max(0, width - head.length - titleText.length - 1) : 2;
  const close = typeof width === 'number' ? '╮' : '';
  return (
    <Box flexDirection="column" width={width} flexGrow={flexGrow}>
      <Text wrap="truncate-end">
        <Text color={theme.border}>{head}</Text>
        <Text color={theme.accent} bold>
          {title}
        </Text>
        <Text color={theme.border}>
          {' '}
          {'─'.repeat(fill)}
          {close}
        </Text>
      </Text>
      <Box
        borderStyle="round"
        borderTop={false}
        borderColor={theme.border}
        flexDirection="column"
        paddingX={1}
      >
        {children}
      </Box>
    </Box>
  );
}

export function Panel(props: PanelProps): JSX.Element {
  const theme = useTheme();
  if (!USE_TITLED_BOX) return <FallbackPanel {...props} />;
  return (
    <TitledBox
      borderStyle="round"
      titles={[props.title]}
      borderColor={theme.border}
      flexDirection="column"
      paddingX={1}
      width={props.width}
      flexGrow={props.flexGrow}
    >
      {props.children}
    </TitledBox>
  );
}
