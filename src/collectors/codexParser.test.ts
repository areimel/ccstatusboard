import { describe, expect, it } from 'vitest';
import { codexLimits, parseCodexLine, parseCodexRecord, projectCodexSession } from './codexParser.js';
import type { CodexObservation } from './codexParser.js';

const TS = Date.parse('2026-11-06T12:00:00Z');
const raw = (type: string, payload: unknown, t = TS) => ({
  type,
  timestamp: new Date(t).toISOString(),
  payload,
});
const usage = (input = 100, output = 20, cached = 30) => ({
  input_tokens: input,
  output_tokens: output,
  cached_input_tokens: cached,
  reasoning_output_tokens: 5,
  total_tokens: input + output,
});
const parse = (type: string, payload: unknown, t = TS): CodexObservation =>
  parseCodexRecord(raw(type, payload, t))!;
const session = (extra = {}) =>
  parse('session_meta', { id: 's1', cwd: '/project', cli_version: '0.166.0', ...extra });
const context = (turn = 't1') => parse('turn_context', { turn_id: turn, model: 'gpt-5.4' }, TS + 1);
const snapshot = (value: Record<string, unknown> = usage(), t = TS + 2) =>
  parse(
    'event_msg',
    {
      type: 'token_count',
      info: { total_token_usage: value, last_token_usage: usage(), model_context_window: 200000 },
    },
    t,
  );
const records = (observations: CodexObservation[], options = {}) =>
  projectCodexSession(observations, { sessionId: 's1', ...options });
const billed = (observations: CodexObservation[], options = {}) =>
  records(observations, options).events.filter((e) => e.kind === 'usage');

describe('Codex rollout parser', () => {
  it('retains monitoring metadata without retaining instructions or output', () => {
    const value = session({
      base_instructions: { text: 'secret prompt' },
      git: { branch: 'main' },
      source: { subagent: { thread_spawn: { parent_thread_id: 'parent' } } },
    });
    expect(value).toMatchObject({
      sessionId: 's1',
      parentSessionId: 'parent',
      gitBranch: 'main',
      cwd: '/project',
    });
    expect(JSON.stringify(value)).not.toContain('secret');
  });

  it('ignores malformed, unknown, and invalid timestamp records', () => {
    for (const line of [
      '',
      '{',
      'null',
      '[]',
      JSON.stringify({ type: 'session_meta', payload: { id: 's1' } }),
    ]) {
      expect(parseCodexLine(line)).toBeUndefined();
    }
    expect(parseCodexRecord(raw('response_item', { text: 'not retained' }))).toBeUndefined();
    for (const type of ['__proto__', 'constructor', 'toString']) {
      expect(parseCodexRecord(raw('event_msg', { type }))).toBeUndefined();
    }
  });

  it('normalizes cached input and reasoning subsets without double counting', () => {
    const events = billed([session(), context(), snapshot()]);
    expect(events).toHaveLength(1);
    expect(events[0]?.record.tokens).toEqual({
      input: 70,
      output: 20,
      cacheRead: 30,
      cacheWrite5m: 0,
      cacheWrite1h: 0,
    });
    expect(records([session(), context(), snapshot()]).metadata).toMatchObject({
      contextTokens: 120,
      contextWindow: 200000,
    });
  });

  it('normalizes generic cache writes as part of the input total', () => {
    const events = billed([session(), context(), snapshot({ ...usage(), cache_write_input_tokens: 10 })]);
    expect(events[0]?.record.tokens).toMatchObject({ input: 60, cacheRead: 30, cacheWrite5m: 10 });
  });

  it('keeps mixed historical legacy turns and newer per-response turns', () => {
    const response = parse(
      'token_usage_record',
      { thread_id: 's1', turn_id: 't2', response_id: 'r2', usage: usage(50, 10, 10) },
      TS + 4,
    );
    const events = billed([
      session(),
      context('t1'),
      snapshot(),
      context('t2'),
      snapshot(usage(150, 30, 40)),
      response,
    ]);
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.record.tokens.input)).toEqual([70, 40]);
  });

  it('rebases when a reset returns to a previously observed cumulative vector', () => {
    const observations = [
      session(),
      context(),
      snapshot(),
      snapshot(usage(200, 40, 60)),
      snapshot(),
      snapshot(usage(150, 30, 40)),
    ];
    const events = billed(observations);
    expect(events).toHaveLength(3);
    expect(events[2]?.record.tokens).toMatchObject({ input: 40, output: 10, cacheRead: 10 });
    expect(records(observations).metadata.accountingIncomplete).toBe(true);
  });

  it('attributes usage to the model selected at each turn', () => {
    const events = billed([
      session(),
      context(),
      snapshot(),
      parse('turn_context', { turn_id: 't2', model: 'gpt-5.4-mini' }),
      snapshot(usage(150, 30, 40)),
    ]);
    expect(events.map((e) => e.record.model)).toEqual(['gpt-5.4', 'gpt-5.4-mini']);
  });

  it('derives cumulative deltas and ignores repeated totals on resume', () => {
    const events = billed([
      session(),
      context(),
      snapshot(),
      snapshot(),
      snapshot(usage(150, 30, 40), TS + 3),
    ]);
    expect(events).toHaveLength(2);
    expect(events[1]?.record.tokens).toMatchObject({ input: 40, output: 10, cacheRead: 10 });
  });

  it('replaces provisional token_count data with response records in the same turn', () => {
    const response = parse(
      'token_usage_record',
      { thread_id: 's1', turn_id: 't1', response_id: 'r1', usage: usage() },
      TS + 3,
    );
    const events = billed([session(), context(), snapshot(), response, response]);
    expect(events).toHaveLength(1);
    expect(events[0]?.record.key).toBe('response:s1:r1');
  });

  it('does not attribute copied response records to their enclosing fork', () => {
    const response = parse('token_usage_record', {
      thread_id: 'parent',
      turn_id: 't1',
      response_id: 'r1',
      usage: usage(),
    });
    expect(billed([session({ forked_from_id: 'parent' }), response])).toEqual([]);
  });

  it('excludes inherited fork turns, maintaining their baseline for new work', () => {
    const observations = [
      session({ forked_from_id: 'parent' }),
      context('inherited'),
      snapshot(),
      context('new'),
      snapshot(usage(150, 30, 40), TS + 4),
    ];
    const events = billed(observations, { parentTurnIds: new Set(['inherited']) });
    expect(events).toHaveLength(1);
    expect(events[0]?.record.tokens).toMatchObject({ input: 40, output: 10, cacheRead: 10 });
    expect(billed(observations)).toHaveLength(0);
    expect(records(observations).metadata.accountingIncomplete).toBe(true);
  });

  it('rebases a decreasing counter and marks accounting incomplete', () => {
    const observations = [
      session(),
      context(),
      snapshot(),
      snapshot(usage(20, 10, 5)),
      snapshot(usage(30, 15, 5)),
    ];
    const events = billed(observations);
    expect(events).toHaveLength(2);
    expect(events[1]?.record.tokens).toMatchObject({ input: 10, output: 5 });
    expect(records(observations).metadata.accountingIncomplete).toBe(true);
  });

  it('does not count an initial snapshot from incomplete history', () => {
    expect(billed([context(), snapshot()])).toEqual([]);
    expect(records([context(), snapshot()]).metadata.accountingIncomplete).toBe(true);
  });

  it('rejects negative/nonfinite/noninteger counters and impossible subsets', () => {
    for (const input of [-1, NaN, Infinity, 2.4]) {
      expect(snapshot({ ...usage(), input_tokens: input }).usage).toBeUndefined();
    }
    expect(snapshot(usage(10, 20, 30)).usage).toBeUndefined();
  });

  it('reads lifecycle observations without pretending to know process existence', () => {
    const result = records([
      session(),
      parse('event_msg', { type: 'turn_started', turn_id: 't1' }),
      parse('event_msg', { type: 'task_complete', turn_id: 't1' }, TS + 1),
    ]);
    expect(result.metadata.observedStatus).toBe('idle');
    expect(result.metadata).not.toHaveProperty('pid');
  });

  it('keeps rate buckets separate and selects the newest observation for each', () => {
    const limit = (id: string, percent: number, t: number) =>
      parse(
        'event_msg',
        {
          type: 'token_count',
          info: null,
          rate_limits: {
            limit_id: id,
            primary: { used_percent: percent, window_minutes: 300, resets_at: (TS + 3600000) / 1000 },
          },
        },
        t,
      );
    const observations = [limit('codex', 15, TS), limit('codex', 20, TS + 1), limit('fast', 60, TS + 2)];
    const limits = codexLimits(observations, TS + 3);
    expect(limits.status).toBe('ok');
    expect(limits.windows?.map((w) => w.percent)).toEqual([20, 60]);
    expect(limits.windows?.[0]).toMatchObject({
      id: 'codex:primary',
      windowMinutes: 300,
      durationMs: 18000000,
    });
    expect(codexLimits(observations, TS + 6 * 60000).status).toBe('stale');
    expect(codexLimits(observations, TS + 3600001).status).toBe('stale');
    expect(codexLimits([limit('old', 10, TS - 3600000), limit('fresh', 5, TS)], TS + 3).status).toBe('stale');
    expect(limits.block?.id).toBe('codex:primary');
  });
});
