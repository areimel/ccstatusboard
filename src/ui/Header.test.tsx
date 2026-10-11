import { describe, expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { Header } from './Header.js';
import { makeSession, makeSnapshot, NOW } from '../../test/helpers/snapshot.js';
import { formatClock } from '../domain/format.js';
import { stripAnsi } from '../../test/helpers/ansi.js';

describe('Header', () => {
  it('shows app name, live/ended counts and the clock', () => {
    const snap = makeSnapshot({
      sessions: [
        makeSession({ sessionId: 'a' }),
        makeSession({ sessionId: 'b' }),
        makeSession({ sessionId: 'c', live: false, status: 'ended' }),
      ],
    });
    const out = stripAnsi(render(<Header snapshot={snap} />).lastFrame());
    expect(out).toContain('ccstatusboard');
    expect(out).toContain('2 live / 1 ended');
    expect(out).toContain(formatClock(NOW));
  });

  it('shows pricing, unpriced-model and runtime warnings verbatim', () => {
    const snap = makeSnapshot({
      pricingStatus: 'stale',
      unknownModels: ['claude-mystery-9'],
      warnings: ['⚠ untested Claude Code v2.2.0'],
    });
    const out = stripAnsi(render(<Header snapshot={snap} />).lastFrame());
    expect(out).toContain('⚠ pricing stale');
    expect(out).toContain('⚠ unpriced: claude-mystery-9');
    expect(out).toContain('⚠ untested Claude Code v2.2.0');
  });
});
