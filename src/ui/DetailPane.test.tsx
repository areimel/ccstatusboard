import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { DetailPane } from './DetailPane.js';
import { makeSession, NOW } from '../../test/helpers/snapshot.js';
import { stripAnsi } from '../../test/helpers/ansi.js';
import { ZERO_TOKENS } from '../domain/types.js';

describe('DetailPane', () => {
  it('shows status, cwd, mode, version, token breakdown, context, agents and per-model costs', async () => {
    const session = makeSession({
      name: 'ccstatusboard',
      status: 'waiting',
      waitingFor: 'input needed',
      permissionMode: 'plan',
      version: '2.1.296',
      activeAgents: 2,
      agentNames: ['Explore', 'Plan'],
      tokens: {
        input: 12_300,
        output: 48_100,
        cacheWrite5m: 200_000,
        cacheWrite1h: 10_000,
        cacheRead: 3_100_000,
      },
      byModel: {
        'claude-opus-5-5': { costUSD: 3.9, tokens: { ...ZERO_TOKENS } },
        'claude-haiku-5-5': { costUSD: 0.3, tokens: { ...ZERO_TOKENS } },
      },
    });
    const r = render(<DetailPane session={session} now={NOW} width={100} />);
    await vi.waitFor(() => expect(stripAnsi(r.lastFrame())).toContain('Detail: ccstatusboard'));
    const out = stripAnsi(r.lastFrame());
    expect(out).toContain('Detail: ccstatusboard');
    expect(out).toContain('waiting: input needed');
    expect(out).toContain('/work/proj');
    expect(out).toContain('plan mode');
    expect(out).toContain('v2.1.296');
    expect(out).toContain('in 12.3k');
    expect(out).toContain('out 48.1k');
    expect(out).toContain('cache-w 210k');
    expect(out).toContain('cache-r 3.1M');
    expect(out).toContain('ctx 120k / 200k (60%)');
    expect(out).toContain('agents: 2 active (Explore, Plan)');
    expect(out).toContain('opus-5.5');
    expect(out).toContain('haiku-5.5');
  });

  it('handles no selection and ended sessions', () => {
    expect(stripAnsi(render(<DetailPane session={undefined} now={NOW} width={80} />).lastFrame())).toContain(
      'No session selected',
    );
    const ended = makeSession({
      live: false,
      status: 'ended',
      lastActivity: NOW - 3 * 3_600_000,
      byModel: {},
    });
    const out = stripAnsi(render(<DetailPane session={ended} now={NOW} width={80} />).lastFrame());
    expect(out).toContain('ended 3h ago');
    expect(out).toContain('agents: none active');
  });
});
