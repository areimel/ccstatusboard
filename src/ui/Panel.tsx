import type { JSX, ReactNode } from 'react';
import { Box, Text } from 'ink';
import { TitledBox } from '@mishieck/ink-titled-box';
import { displayWidth, truncateDisplay } from '../domain/format.js';
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
  const fill = typeof width === 'number' ? Math.max(0, width - head.length - displayWidth(title) - 2) : 2;
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

/** Room for the title in a `width`-column border: corners, padding and some border either side. */
const TITLE_CHROME = 6;

export function Panel(props: PanelProps): JSX.Element {
  const theme = useTheme();
  // TitledBox drops a title that doesn't fit, so truncate it first (by terminal columns).
  const title =
    typeof props.width === 'number' ? truncateDisplay(props.title, props.width - TITLE_CHROME) : props.title;
  // TitledBox measures titles by .length, so wide (CJK/emoji) titles would overflow its top edge:
  // draw those with the column-aware fallback border instead.
  if (!USE_TITLED_BOX || displayWidth(title) !== title.length)
    return <FallbackPanel {...props} title={title} />;
  return (
    <TitledBox
      borderStyle="round"
      titles={[title]}
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
