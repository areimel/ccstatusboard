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
  const codex = snapshot.providers?.codex;
  if (codex?.enabled && codex.pricingStatus === 'stale') out.push('⚠ Codex pricing stale');
  if (codex?.enabled && codex.unknownModels.length)
    out.push(`⚠ Codex unpriced: ${codex.unknownModels.join(', ')}`);
  if (codex?.accountingIncomplete) out.push('⚠ Codex costs partial');
  out.push(...snapshot.warnings);
  return out;
}

export function Header({ snapshot }: { snapshot: Snapshot }): JSX.Element {
  const theme = useTheme();
  const live = snapshot.sessions.filter((s) => s.live).length;
  const observed = snapshot.sessions.filter((s) => !s.live && s.recentlyObserved).length;
  const ended = snapshot.sessions.filter((s) => s.status === 'ended').length;
  const warnings = headerWarnings(snapshot);
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text>
        <Gradient colors={theme.gradient}>
          <Text bold>ccstatusboard</Text>
        </Gradient>
        <Text color={theme.dim}> · </Text>
        <Text color={theme.text}>
          {live} live{observed > 0 ? ` / ${observed} recent` : ''} / {ended} ended
        </Text>
        <Text color={theme.dim}> · </Text>
        <Text color={theme.text}>{formatClock(snapshot.now)}</Text>
      </Text>
      {warnings.length > 0 ? (
        <Text color={theme.warn} wrap="truncate-end">
          {warnings.join('  ')}
        </Text>
      ) : null}
    </Box>
  );
}
