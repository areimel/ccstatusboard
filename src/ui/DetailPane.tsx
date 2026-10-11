import type { JSX } from 'react';
import { Box, Text } from 'ink';
import { BarChart } from '@pppp606/ink-chart';
import type { SessionView } from '../domain/types.js';
import { formatAgo, formatDuration, formatTokens, formatUSD, shortModel } from '../domain/format.js';
import { Panel } from './Panel.js';
import { useTheme } from './theme.js';

function statusText(s: SessionView, now: number): string {
  switch (s.status) {
    case 'waiting':
      return s.waitingFor ? `waiting: ${s.waitingFor}` : 'waiting';
    case 'busy':
      return 'busy';
    case 'idle':
      return s.rawStatus ? `idle (${s.rawStatus})` : 'idle';
    case 'ended':
      return `ended ${formatAgo(s.lastActivity, now)}`;
  }
}

export function DetailPane({
  session,
  now,
  width,
}: {
  session: SessionView | undefined;
  now: number;
  width: number;
}): JSX.Element {
  const theme = useTheme();
  if (!session) {
    return (
      <Panel title="Detail" width={width}>
        <Text color={theme.dim}>No session selected</Text>
      </Panel>
    );
  }
  const s = session;
  const chartWidth = Math.max(16, Math.min(36, Math.floor(width / 3)));
  const leftWidth = Math.max(20, width - 4 - chartWidth - 2);
  const line1 = [
    statusText(s, now),
    s.cwd,
    s.permissionMode ? `${s.permissionMode} mode` : undefined,
    s.version ? `v${s.version}` : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
  const t = s.tokens;
  const line2 = `in ${formatTokens(t.input)}  out ${formatTokens(t.output)}  cache-w ${formatTokens(
    t.cacheWrite5m + t.cacheWrite1h,
  )}  cache-r ${formatTokens(t.cacheRead)}`;
  const ctx =
    s.contextTokens !== undefined && s.contextWindow !== undefined
      ? `ctx ${formatTokens(s.contextTokens)} / ${formatTokens(s.contextWindow)} (${s.contextPercent ?? 0}%)`
      : 'ctx —';
  const up = s.live && s.startedAt !== undefined ? ` · up ${formatDuration(now - s.startedAt)}` : '';
  const agents =
    s.activeAgents > 0
      ? `agents: ${s.activeAgents} active${s.agentNames.length ? ` (${s.agentNames.join(', ')})` : ''}`
      : 'agents: none active';
  const chartData = Object.entries(s.byModel)
    .filter(([, m]) => (m.costUSD ?? 0) > 0)
    .map(([model, m]) => ({ label: shortModel(model), value: m.costUSD ?? 0 }));

  return (
    <Panel title={`Detail: ${s.name}`} width={width}>
      <Box flexDirection="row" columnGap={2}>
        <Box flexDirection="column" width={leftWidth}>
          <Text color={s.status === 'waiting' ? theme.warn : theme.text} wrap="truncate-middle">
            {line1}
          </Text>
          <Text color={theme.text}>{line2}</Text>
          <Text color={theme.text}>
            {ctx}
            {up}
            {' · '}
            {formatUSD(s.costUSD, s.costApprox)}
          </Text>
          <Text color={theme.dim}>{agents}</Text>
        </Box>
        <Box width={chartWidth} flexDirection="column">
          {chartData.length > 0 ? (
            <BarChart
              data={chartData}
              width={chartWidth}
              showValue="right"
              sort="desc"
              color={theme.accent}
              format={(v) => formatUSD(v)}
            />
          ) : (
            <Text color={theme.dim}>no model costs yet</Text>
          )}
        </Box>
      </Box>
    </Panel>
  );
}
