import { describe, expect, it } from 'vitest';
import { parseTranscriptLine, parseTranscriptRecord } from './transcriptParser.js';
import {
  agentNameLine,
  aiTitleLine,
  assistantLine,
  compactLine,
  costStateLine,
  permissionModeLine,
  userLine,
} from '../../test/helpers/transcript.js';
import type { TranscriptEvent } from '../domain/types.js';

const ctx = { sessionId: 'sess-1' };
const TS = '2026-10-11T14:00:00.000Z';
const T = Date.parse(TS);
const usageOf = (events: TranscriptEvent[]) => events.filter((e) => e.kind === 'usage');

describe('parseTranscriptLine — assistant usage', () => {
  it('emits a usage event with dedup key, tokens and context tokens, plus meta', () => {
    const events = parseTranscriptLine(
      assistantLine({
        id: 'msg_1',
        requestId: 'req_1',
        ts: TS,
        gitBranch: 'feat/x',
        usage: {
          input_tokens: 2,
          output_tokens: 256,
          cache_creation_input_tokens: 9368,
          cache_read_input_tokens: 15550,
        },
      }),
      ctx,
    );
    expect(events).toContainEqual({
      kind: 'usage',
      contextTokens: 2 + 9368 + 15550,
      record: {
        key: 'msg_1:req_1',
        sessionId: 'sess-1',
        timestamp: T,
        model: 'claude-opus-5-5',
        isSidechain: false,
        tokens: { input: 2, output: 256, cacheWrite5m: 9368, cacheWrite1h: 0, cacheRead: 15550 },
      },
    });
    expect(events).toContainEqual({
      kind: 'meta',
      timestamp: T,
      isSidechain: false,
      gitBranch: 'feat/x',
      cwd: '/work/proj',
      version: '2.1.296',
    });
  });

  it('uses the message id alone as key when requestId is missing', () => {
    const [u] = usageOf(
      parseTranscriptLine(assistantLine({ id: 'msg_2', ts: TS, usage: { output_tokens: 5 } }), ctx),
    );
    expect(u?.kind === 'usage' && u.record.key).toBe('msg_2');
  });

  it('splits cache writes using the ephemeral 5m/1h breakdown when present', () => {
    const [u] = usageOf(
      parseTranscriptLine(
        assistantLine({
          id: 'msg_3',
          ts: TS,
          usage: { output_tokens: 1, cache_creation_input_tokens: 300, eph5m: 100, eph1h: 200 },
        }),
        ctx,
      ),
    );
    expect(u?.kind === 'usage' && u.record.tokens).toMatchObject({ cacheWrite5m: 100, cacheWrite1h: 200 });
  });

  it('prices any cache-write remainder not covered by the breakdown as 5m', () => {
    const [u] = usageOf(
      parseTranscriptLine(
        assistantLine({
          id: 'msg_4',
          ts: TS,
          usage: { output_tokens: 1, cache_creation_input_tokens: 500, eph5m: 0, eph1h: 0 },
        }),
        ctx,
      ),
    );
    expect(u?.kind === 'usage' && u.record.tokens).toMatchObject({ cacheWrite5m: 500, cacheWrite1h: 0 });
  });

  it('skips synthetic and all-zero usage records', () => {
    expect(
      usageOf(
        parseTranscriptLine(
          assistantLine({ id: 'm', ts: TS, model: '<synthetic>', usage: { output_tokens: 9 } }),
          ctx,
        ),
      ),
    ).toEqual([]);
    expect(usageOf(parseTranscriptLine(assistantLine({ id: 'm', ts: TS }), ctx))).toEqual([]);
  });

  it('forceSidechain marks usage and meta as sidechain', () => {
    const events = parseTranscriptLine(assistantLine({ id: 'm5', ts: TS, usage: { output_tokens: 3 } }), {
      sessionId: 'parent',
      forceSidechain: true,
    });
    const u = usageOf(events)[0];
    expect(u?.kind === 'usage' && u.record).toMatchObject({ isSidechain: true, sessionId: 'parent' });
    expect(events.find((e) => e.kind === 'meta')).toMatchObject({ isSidechain: true });
  });

  it('honours isSidechain:true on the record itself', () => {
    const u = usageOf(
      parseTranscriptLine(
        assistantLine({ id: 'm6', ts: TS, sidechain: true, usage: { output_tokens: 3 } }),
        ctx,
      ),
    )[0];
    expect(u?.kind === 'usage' && u.record.isSidechain).toBe(true);
  });
});

describe('parseTranscriptLine — other record types', () => {
  it('compact_boundary → compact event (and meta)', () => {
    expect(parseTranscriptLine(compactLine(TS, 41000), ctx)).toContainEqual({
      kind: 'compact',
      timestamp: T,
      postTokens: 41000,
      isSidechain: false,
    });
  });

  it('user line → meta with branch/cwd/version', () => {
    expect(parseTranscriptLine(userLine(TS, { gitBranch: 'dev' }), ctx)).toEqual([
      {
        kind: 'meta',
        timestamp: T,
        isSidechain: false,
        gitBranch: 'dev',
        cwd: '/work/proj',
        version: '2.1.296',
      },
    ]);
  });

  it('cost-state, ai-title, agent-name, permission-mode', () => {
    expect(parseTranscriptLine(costStateLine(1.25, TS), ctx)).toEqual([
      { kind: 'costState', timestamp: T, totalCostUSD: 1.25 },
    ]);
    expect(parseTranscriptLine(costStateLine(2), ctx)).toEqual([
      { kind: 'costState', timestamp: 0, totalCostUSD: 2 },
    ]);
    expect(parseTranscriptLine(aiTitleLine('Fix login bug'), ctx)).toEqual([
      { kind: 'title', timestamp: 0, title: 'Fix login bug', source: 'ai-title' },
    ]);
    expect(parseTranscriptLine(agentNameLine('reviewer'), ctx)).toEqual([
      { kind: 'title', timestamp: 0, title: 'reviewer', source: 'agent-name' },
    ]);
    expect(parseTranscriptLine(permissionModeLine('plan'), ctx)).toEqual([
      { kind: 'permissionMode', timestamp: 0, mode: 'plan' },
    ]);
  });
});

describe('parser robustness', () => {
  it('never throws on malformed input', () => {
    expect(parseTranscriptLine('{not json', ctx)).toEqual([]);
    expect(parseTranscriptLine('', ctx)).toEqual([]);
    expect(parseTranscriptRecord(null, ctx)).toEqual([]);
    expect(parseTranscriptRecord([1, 2], ctx)).toEqual([]);
    expect(parseTranscriptRecord({ type: 'assistant', message: 'x' }, ctx)).toEqual([]);
    expect(parseTranscriptRecord({ type: 'mystery', timestamp: TS }, ctx)).toEqual([]);
    expect(parseTranscriptRecord({ type: 'cost-state', totalCostUSD: 'lots' }, ctx)).toEqual([]);
  });

  it('assistant without message.id yields only meta', () => {
    const raw = JSON.parse(assistantLine({ id: 'x', ts: TS, usage: { output_tokens: 1 } }));
    delete raw.message.id;
    expect(parseTranscriptRecord(raw, ctx).map((e) => e.kind)).toEqual(['meta']);
  });

  it('assistant with an invalid timestamp yields no usage', () => {
    const raw = JSON.parse(assistantLine({ id: 'x', ts: 'not-a-date', usage: { output_tokens: 1 } }));
    expect(parseTranscriptRecord(raw, ctx)).toEqual([]);
  });
});

describe('subagent files (forceSidechain) never touch parent session metadata', () => {
  const ts = '2026-10-11T14:00:00Z';
  const records: Array<[string, Record<string, unknown>]> = [
    ['cost-state', { type: 'cost-state', timestamp: ts, totalCostUSD: 1.23 }],
    ['ai-title', { type: 'ai-title', timestamp: ts, aiTitle: 'Subagent title' }],
    ['agent-name', { type: 'agent-name', timestamp: ts, agentName: 'Explore' }],
    ['permission-mode', { type: 'permission-mode', timestamp: ts, permissionMode: 'plan' }],
  ];
  for (const [kind, raw] of records) {
    it(`drops ${kind} records from subagent files but keeps them in the main transcript`, () => {
      expect(parseTranscriptRecord(raw, { sessionId: 's', forceSidechain: true })).toEqual([]);
      expect(parseTranscriptRecord(raw, { sessionId: 's' })).toHaveLength(1);
    });
  }
});
