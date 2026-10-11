import type { JSX } from 'react';
import { Box, Text } from 'ink';
import Gradient from 'ink-gradient';
import type { Snapshot } from '../domain/types.js';
import { formatClock } from '../domain/format.js';
import { useTheme } from './theme.js';

export function headerWarnings(snapshot: Snapshot): string[] {
  const out: string[] = [];
  if (snapshot.pricingStatus === 'stale') out.push('⚠ pricing stale');
  if (snapshot.unknownModels.length > 0) out.push(`⚠ unpriced: ${snapshot.unknownModels.join(', ')}`);
  out.push(...snapshot.warnings);
  return out;
}

export function Header({ snapshot }: { snapshot: Snapshot }): JSX.Element {
  const theme = useTheme();
  const live = snapshot.sessions.filter((s) => s.live).length;
  const ended = snapshot.sessions.length - live;
  const warnings = headerWarnings(snapshot);
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text>
        <Gradient colors={theme.gradient}>
          <Text bold>ccstatusboard</Text>
        </Gradient>
        <Text color={theme.dim}> · </Text>
        <Text color={theme.text}>
          {live} live / {ended} ended
        </Text>
        <Text color={theme.dim}> · </Text>
        <Text color={theme.text}>{formatClock(snapshot.now)}</Text>
      </Text>
      {warnings.length > 0 ? (
        <Text color={theme.warn} wrap="wrap">
          {warnings.join('  ')}
        </Text>
      ) : null}
    </Box>
  );
}
