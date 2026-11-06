import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexMonitor } from './codexMonitor.js';
import type { CodexSessionMetadata } from './codexParser.js';
import type { LimitsState, TranscriptEvent } from '../domain/types.js';
import { readRangeFromDisk } from './transcriptTailer.js';

// Synthetic records follow OpenAI Codex protocol/rollout source at commit
// 814347ecd21b49d25479f5499f168b9f7b7e1803 (2026-11-06); never real session content.
const TS = Date.parse('2026-11-06T12:00:00Z');
const ID = '00000000-0000-4000-8000-000000000001';
const cleanups: string[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
const line = (type: string, payload: unknown, time = TS) =>
  JSON.stringify({ type, payload, timestamp: new Date(time).toISOString() }) + '\n';
const meta = () =>
  line('session_meta', {
    id: ID,
    cwd: '/test/project',
    cli_version: '0.166.0',
    timestamp: new Date(TS).toISOString(),
  });
const context = () => line('turn_context', { turn_id: 't1', model: 'gpt-5.4' }, TS + 1);
const usage = (input = 100) =>
  line(
    'event_msg',
    {
      type: 'token_count',
      info: {
        total_token_usage: {
          input_tokens: input,
          cached_input_tokens: 30,
          output_tokens: 20,
          reasoning_output_tokens: 5,
          total_tokens: input + 20,
        },
        last_token_usage: {
          input_tokens: input,
          cached_input_tokens: 30,
          output_tokens: 20,
          reasoning_output_tokens: 5,
          total_tokens: input + 20,
        },
        model_context_window: 200000,
      },
    },
    TS + input,
  );
const countUsage = (events: TranscriptEvent[]) =>
  events.filter((e) => e.kind === 'usage').reduce((sum, e) => sum + e.record.tokens.input, 0);

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'ccstatus-codex-'));
  cleanups.push(root);
  const codexDir = join(root, 'codex');
  const cacheDir = join(root, 'cache');
  const directory = join(codexDir, 'sessions', '2026', '11', '06');
  await mkdir(directory, { recursive: true });
  const path = join(directory, `rollout-2026-11-06T12-00-00-${ID}.jsonl`);
  const sessions = new Map<string, { events: TranscriptEvent[]; metadata: CodexSessionMetadata }>();
  const onSession = vi.fn((id: string, events: TranscriptEvent[], metadata: CodexSessionMetadata) =>
    sessions.set(id, { events, metadata }),
  );
  const onLimits = vi.fn<(state: LimitsState) => void>();
  const onProgress = vi.fn();
  const onDirectory = vi.fn();
  const readRange = vi.fn(readRangeFromDisk);
  let time = TS;
  let modified = TS;
  const options = {
    codexDir,
    cacheDir,
    deps: { now: () => time, readRange },
    onSession,
    onLimits,
    onProgress,
    onDirectory,
  };
  const monitor = new CodexMonitor(options);
  const touch = async (file = path) => {
    modified += 1000;
    await utimes(file, new Date(modified), new Date(modified));
  };
  const write = async (text: string | Buffer, file = path) => {
    await writeFile(file, text);
    await touch(file);
  };
  return {
    root,
    codexDir,
    cacheDir,
    path,
    sessions,
    options,
    monitor,
    readRange,
    onSession,
    onLimits,
    onProgress,
    onDirectory,
    touch,
    write,
    setNow: (now: number) => {
      time = now;
    },
  };
}

// Valid Zstandard single-segment frame with one raw block; no compressor binary required.
function zstdFrame(text: string): Buffer {
  const body = Buffer.from(text);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0xfd2fb528, 0);
  header[4] = 0xa0;
  header.writeUInt32LE(body.length, 5);
  header.writeUIntLE((body.length << 3) | 1, 9, 3);
  return Buffer.concat([header, body]);
}

describe('passive Codex monitor', () => {
  it('discovers nested rollouts, emits replacements, and incrementally reads appends', async () => {
    const f = await fixture();
    await f.write(meta() + context() + usage());
    await f.monitor.pollOnce();
    expect(f.onDirectory).toHaveBeenLastCalledWith(true);
    expect(countUsage(f.sessions.get(ID)!.events)).toBe(70);
    expect(f.onProgress).toHaveBeenLastCalledWith({ done: true, filesDone: 1, filesTotal: 1 });
    f.readRange.mockClear();
    await f.monitor.pollOnce();
    expect(f.readRange).not.toHaveBeenCalled();
    expect(f.onSession).toHaveBeenCalledTimes(1);
    await appendFile(f.path, usage(150));
    await f.touch();
    await f.monitor.pollOnce();
    expect(countUsage(f.sessions.get(ID)!.events)).toBe(120);
    expect(f.readRange.mock.calls.some(([, start]) => start > 0)).toBe(true);
  });

  it('holds partial JSON and split UTF-8 until the next complete newline', async () => {
    const f = await fixture();
    await f.write(meta() + context());
    const bytes = Buffer.from(usage());
    await appendFile(f.path, bytes.subarray(0, bytes.length - 3));
    await f.touch();
    await f.monitor.pollOnce();
    expect(countUsage(f.sessions.get(ID)!.events)).toBe(0);
    await appendFile(f.path, bytes.subarray(bytes.length - 3));
    await f.touch();
    await f.monitor.pollOnce();
    expect(countUsage(f.sessions.get(ID)!.events)).toBe(70);
  });

  it('rebuilds truncated or rewritten files and clears removed sessions', async () => {
    const f = await fixture();
    await f.write(meta() + context() + usage(300));
    await f.monitor.pollOnce();
    await f.write(meta() + context() + usage());
    await f.monitor.pollOnce();
    expect(countUsage(f.sessions.get(ID)!.events)).toBe(70);
    await rm(f.path);
    await f.monitor.pollOnce();
    expect(f.sessions.get(ID)!.events).toEqual([]);
  });

  it('uses sanitized app cache across restarts without rereading unchanged logs', async () => {
    const f = await fixture();
    await f.write(meta() + context() + usage() + line('response_item', { text: 'DO NOT CACHE THIS' }));
    await f.monitor.pollOnce();
    const cache = await readFile(join(f.cacheDir, 'codex-scan-cache.json'), 'utf8');
    expect(cache).not.toContain('DO NOT CACHE THIS');
    f.readRange.mockClear();
    const restarted = new CodexMonitor(f.options);
    await restarted.pollOnce();
    expect(f.readRange).not.toHaveBeenCalled();
    expect(countUsage(f.sessions.get(ID)!.events)).toBe(70);
  });

  it('rejects corrupted cached observations and forged file paths', async () => {
    const f = await fixture();
    await f.write(meta() + context() + usage());
    await f.monitor.pollOnce();
    const cachePath = join(f.cacheDir, 'codex-scan-cache.json');
    const cache = JSON.parse(await readFile(cachePath, 'utf8'));
    cache.files[f.path].observations[1].model = { unsafe: true };
    cache.files[join(f.root, 'private.key')] = cache.files[f.path];
    await writeFile(cachePath, JSON.stringify(cache));
    f.readRange.mockClear();
    await new CodexMonitor(f.options).pollOnce();
    expect(f.readRange).toHaveBeenCalled();
    expect(f.readRange.mock.calls.every(([path]) => path === f.path)).toBe(true);
    expect(f.sessions.get(ID)!.metadata.model).toBe('gpt-5.4');
  });

  it('does not rewrite the cache or emit replacements on an unchanged poll', async () => {
    const f = await fixture();
    await f.write(meta() + context() + usage());
    const writer = vi.fn(async (path: string, data: string) => {
      await writeFile(path, data);
    });
    const monitor = new CodexMonitor({ ...f.options, deps: { ...f.options.deps, writeFile: writer } });
    await monitor.pollOnce();
    writer.mockClear();
    f.onSession.mockClear();
    await monitor.pollOnce();
    expect(writer).not.toHaveBeenCalled();
    expect(f.onSession).not.toHaveBeenCalled();
  });

  it('marks known invalid usage incomplete even when it is valid JSON', async () => {
    const f = await fixture();
    await f.write(
      meta() +
        context() +
        usage() +
        line('token_usage_record', {
          thread_id: ID,
          response_id: 'r1',
          usage: { input_tokens: -1 },
        }),
    );
    await f.monitor.pollOnce();
    expect(f.sessions.get(ID)!.metadata.accountingIncomplete).toBe(true);
  });

  it('reads compressed archives in memory and deduplicates active/archive copies', async () => {
    const f = await fixture();
    const archiveDir = join(f.codexDir, 'archived_sessions');
    await mkdir(archiveDir);
    const archive = join(archiveDir, `rollout-2026-11-06T12-00-00-${ID}.jsonl.zst`);
    const text = meta() + context() + usage();
    await f.write(zstdFrame(text), archive);
    await f.monitor.pollOnce();
    expect(countUsage(f.sessions.get(ID)!.events)).toBe(70);
    expect(f.sessions.get(ID)!.metadata.observedStatus).toBe('ended');
    await f.write(text);
    await f.monitor.pollOnce();
    expect(countUsage(f.sessions.get(ID)!.events)).toBe(70);
    expect(f.sessions.get(ID)!.metadata.observedStatus).toBe('unknown');
    expect(await readFile(archive)).toEqual(zstdFrame(text));
  });

  it('prefers a plain sibling over its compressed representation', async () => {
    const f = await fixture();
    await f.write(meta() + context() + usage());
    await f.write(zstdFrame(meta() + context() + usage(200)), f.path + '.zst');
    await f.monitor.pollOnce();
    expect(countUsage(f.sessions.get(ID)!.events)).toBe(70);
    expect(f.readRange.mock.calls.every(([path]) => !path.endsWith('.zst'))).toBe(true);
  });

  it('does not follow symlinks, inspect unrelated secrets, or create source directories', async () => {
    const f = await fixture();
    await f.write(meta() + context() + usage());
    await writeFile(join(f.codexDir, 'sessions', 'private.key'), 'secret');
    await symlink(f.path, join(f.codexDir, 'sessions', 'rollout-link.jsonl'));
    await f.monitor.pollOnce();
    expect(f.readRange.mock.calls.every(([path]) => path === f.path)).toBe(true);
    await rm(f.codexDir, { recursive: true });
    await f.monitor.pollOnce();
    expect(f.onDirectory).toHaveBeenLastCalledWith(false);
  });

  it('disables cache writes when cache is configured under Codex home', async () => {
    const f = await fixture();
    await f.write(meta() + context() + usage());
    const writeFile = vi.fn();
    const monitor = new CodexMonitor({
      ...f.options,
      cacheDir: join(f.codexDir, 'cache'),
      deps: { ...f.options.deps, writeFile },
    });
    await monitor.pollOnce();
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('retains last-known usage on transient read failures and isolates malformed files', async () => {
    const f = await fixture();
    await f.write(meta() + context() + usage());
    await f.monitor.pollOnce();
    await appendFile(f.path, usage(150));
    await f.touch();
    f.readRange.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EACCES' }));
    await f.monitor.pollOnce();
    expect(countUsage(f.sessions.get(ID)!.events)).toBe(70);
    await f.monitor.pollOnce();
    expect(countUsage(f.sessions.get(ID)!.events)).toBe(120);
    await appendFile(f.path, '{bad json}\n' + usage(200));
    await f.touch();
    await f.monitor.pollOnce();
    expect(f.sessions.get(ID)!.metadata.accountingIncomplete).toBe(true);
  });

  it('honors the history window and removes expired projections', async () => {
    const f = await fixture();
    await f.write(meta() + context() + usage());
    await f.monitor.pollOnce();
    f.setNow(TS + 36 * 86400000);
    await f.monitor.pollOnce();
    expect(f.sessions.get(ID)!.events).toEqual([]);
  });

  it('preserves usage through archive moves and suppresses callbacks after stop', async () => {
    const f = await fixture();
    await f.write(meta() + context() + usage());
    await f.monitor.pollOnce();
    await mkdir(join(f.codexDir, 'archived_sessions'));
    await rename(f.path, join(f.codexDir, 'archived_sessions', `rollout-${ID}.jsonl`));
    await f.monitor.pollOnce();
    expect(countUsage(f.sessions.get(ID)!.events)).toBe(70);
    expect(f.sessions.get(ID)!.metadata.observedStatus).toBe('ended');
    f.monitor.stop();
    f.onSession.mockClear();
    await f.monitor.pollOnce();
    expect(f.onSession).not.toHaveBeenCalled();
  });
});
