import { describe, expect, it, vi } from 'vitest';
import chalk from 'chalk';
import { render } from 'ink-testing-library';
import type { ColumnKey, SessionView } from '../domain/types.js';
import { SessionTable } from './SessionTable.js';
import { makeSession, NOW } from '../../test/helpers/snapshot.js';
import { stripAnsi } from '../../test/helpers/ansi.js';

const ALL: ColumnKey[] = ['status', 'name', 'model', 'branch', 'ctx', 'cost', 'last', 'uptime'];

async function frame(sessions: SessionView[], over: Partial<Parameters<typeof SessionTable>[0]> = {}) {
  const r = render(
    <SessionTable
      sessions={sessions}
      selectedIndex={0}
      columns={ALL}
      width={100}
      maxRows={10}
      now={NOW}
      sort="status"
      filter="all"
      {...over}
    />,
  );
  // TitledBox only paints its title on the second render.
  await vi.waitFor(() => expect(stripAnsi(r.lastFrame())).toContain('Sessions'));
  return stripAnsi(r.lastFrame());
}

describe('SessionTable', () => {
  it('renders the header, status glyphs, ctx bar, cost and ages', async () => {
    const out = await frame([
      makeSession({ sessionId: 'w', name: 'ccstatusboard', status: 'waiting', contextPercent: 60 }),
      makeSession({
        sessionId: 'b',
        name: 'power-tools',
        status: 'busy',
        activeAgents: 2,
        model: 'claude-sonnet-5-5',
      }),
      makeSession({ sessionId: 'i', name: 'pet-tracker', status: 'idle', lastActivity: NOW - 18 * 60_000 }),
      makeSession({
        sessionId: 'e',
        name: 'blog',
        live: false,
        status: 'ended',
        lastActivity: NOW - 3 * 3_600_000,
        contextPercent: undefined,
        costUSD: 0.42,
      }),
    ]);
    expect(out).toContain('Sessions ── sort: status ── filter: all');
    for (const h of ['ST', 'NAME', 'MODEL', 'BRANCH', 'CTX', 'COST', 'LAST', 'UP']) expect(out).toContain(h);
    expect(out).toMatch(/●\s+ccstatusboard/);
    expect(out).toMatch(/◐ 2\s+power-tools/);
    expect(out).toMatch(/○\s+pet-tracker/);
    expect(out).toMatch(/·\s+blog/);
    expect(out).toContain('██████░░░░ 60%');
    expect(out).toContain('sonnet-5.5');
    expect(out).toContain('$0.42');
    expect(out).toContain('18m');
    expect(out).toContain('3h ago');
    expect(out).toContain('12m'); // uptime from makeSession startedAt
  });

  it('drops columns on a narrow terminal (Review Focus 5)', async () => {
    const out = await frame([makeSession()], { width: 70 });
    expect(out).toContain('CTX');
    expect(out).toContain('MODEL');
    expect(out).not.toContain('BRANCH');
    expect(out).not.toContain(' UP');
  });

  it('renders CPU and MEM for live sessions and em dashes for ended ones', async () => {
    const cols: ColumnKey[] = ['status', 'name', 'cpu', 'mem', 'cost'];
    const out = await frame(
      [
        makeSession({
          sessionId: 'live',
          name: 'worker',
          cpuPercent: 12.4,
          memBytes: 412 * 1024 * 1024,
        }),
        makeSession({
          sessionId: 'gone',
          name: 'blog',
          live: false,
          status: 'ended',
          cpuPercent: 50,
          memBytes: 1024 ** 3,
        }),
      ],
      { columns: cols, width: 120 },
    );
    const lines = out.split('\n');
    const header = lines.find((l) => l.includes('NAME')) ?? '';
    expect(header.indexOf('CPU')).toBeGreaterThan(header.indexOf('NAME'));
    expect(header.indexOf('MEM')).toBeGreaterThan(header.indexOf('CPU'));
    expect(header.indexOf('COST')).toBeGreaterThan(header.indexOf('MEM'));

    const live = lines.find((l) => l.includes('worker')) ?? '';
    expect(live).toContain('12%');
    expect(live).toContain('412M');

    const ended = lines.find((l) => l.includes('blog')) ?? '';
    expect(ended).toContain('—');
    expect(ended).not.toContain('50%');
    expect(ended).not.toContain('1G');
  });

  it('scrolls so the selected row stays visible', async () => {
    const sessions = Array.from({ length: 10 }, (_, i) =>
      makeSession({ sessionId: `s${i}`, name: `alpha-${i}` }),
    );
    const out = await frame(sessions, { maxRows: 3, selectedIndex: 7 });
    expect(out).toContain('alpha-5');
    expect(out).toContain('alpha-7');
    expect(out).not.toContain('alpha-4');
    expect(out).not.toContain('alpha-8');
  });

  it('shows the empty-state message', async () => {
    expect(await frame([], { emptyMessage: 'No Claude Code sessions in the last 6h' })).toContain(
      'No Claude Code sessions in the last 6h',
    );
    expect(await frame([])).toContain('No Claude Code sessions in the last 24h');
  });

  it('renders group headers (not selectable) when sorted by project', async () => {
    const out = await frame(
      [
        makeSession({ sessionId: 'a1', name: 'one', project: 'alpha' }),
        makeSession({ sessionId: 'a2', name: 'two', project: 'alpha' }),
        makeSession({ sessionId: 'b1', name: 'three', project: 'beta' }),
      ],
      { sort: 'project', selectedIndex: 2, columns: ['status', 'name', 'last'] },
    );
    expect(out).toContain('── alpha (2) ───');
    expect(out).toContain('── beta (1) ───');
    expect(out.indexOf('── alpha')).toBeLessThan(out.indexOf('one'));
    expect(out.indexOf('── beta')).toBeLessThan(out.indexOf('three'));
  });
  it('no group headers for other sorts', async () => {
    const out = await frame([makeSession({ project: 'alpha' })], { sort: 'status' });
    expect(out).not.toContain('── alpha');
  });

  it('renders subagent tree rows under their session', async () => {
    const out = await frame(
      [
        makeSession({
          sessionId: 'p',
          name: 'parent',
          project: 'alpha',
          subagents: [
            { id: '1', name: 'Explore', lastActivity: NOW - 5_000 },
            { id: '2', name: 'Plan', lastActivity: NOW - 120_000 },
          ],
        }),
        makeSession({ sessionId: 'q', name: 'other', project: 'alpha' }),
      ],
      { sort: 'project', columns: ['status', 'name', 'model', 'last'] },
    );
    const lines = out.split('\n');
    const at = (t: string) => lines.findIndex((l) => l.includes(t));
    expect(at('├─')).toBe(at('parent') + 1);
    expect(at('└─')).toBe(at('parent') + 2);
    expect(lines[at('├─')]).toContain('◐ Explore');
    expect(lines[at('└─')]).toMatch(/◐ Plan\s+2m/);
    expect(at('other')).toBe(at('└─') + 1);
  });
  it('dims stale live sessions only', async () => {
    const old = NOW - 61 * 60_000;
    const prevLevel = chalk.level;
    chalk.level = 1;
    const r = render(
      <SessionTable
        sessions={[
          makeSession({ sessionId: 'a', name: 'freshy' }),
          makeSession({ sessionId: 'b', name: 'stalely', lastActivity: old }),
        ]}
        selectedIndex={0}
        columns={['status', 'name']}
        width={60}
        maxRows={5}
        now={NOW}
        sort="status"
        filter="all"
        idleCutoffMinutes={60}
      />,
    );
    await vi.waitFor(() => expect(stripAnsi(r.lastFrame())).toContain('Sessions'));
    const raw = (r.lastFrame() ?? '').split('\n');
    chalk.level = prevLevel;
    // eslint-disable-next-line no-control-regex
    const dim = (t: string) => /\x1b\[2m/.test(raw.find((l) => l.includes(t)) ?? '');
    expect(dim('stalely')).toBe(true);
    expect(dim('freshy')).toBe(false);
  });
});
