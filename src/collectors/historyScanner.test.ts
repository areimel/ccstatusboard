import { appendFile, mkdir, mkdtemp, open, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HistoryScanner } from './historyScanner.js';
import { aiTitleLine, assistantLine, jsonl, userLine } from '../../test/helpers/transcript.js';
import type { ScanProgress, TranscriptEvent } from '../domain/types.js';

let root: string;
let claudeDir: string;
let cacheDir: string;
let mainFile: string;
let subFile: string;
let oldFile: string;
const TS = new Date().toISOString();

async function realReadRange(p: string, start: number, end: number): Promise<Buffer> {
  const fh = await open(p, 'r');
  try {
    const buf = Buffer.alloc(end - start);
    const { bytesRead } = await fh.read(buf, 0, end - start, start);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ccsb-scan-'));
  claudeDir = join(root, 'claude');
  cacheDir = join(root, 'cache');
  const proj = join(claudeDir, 'projects', '-work-proj');
  await mkdir(join(proj, 'sess-a', 'subagents'), { recursive: true });
  await mkdir(join(claudeDir, 'projects', '-work-other'), { recursive: true });
  mainFile = join(proj, 'sess-a.jsonl');
  subFile = join(proj, 'sess-a', 'subagents', 'agent-1.jsonl');
  oldFile = join(claudeDir, 'projects', '-work-other', 'sess-old.jsonl');
  await writeFile(
    mainFile,
    jsonl(
      userLine(TS),
      // one API response split over two lines (same id) — scanner must NOT dedup
      assistantLine({ id: 'msg_1', requestId: 'r1', ts: TS, usage: { input_tokens: 10, output_tokens: 5 } }),
      assistantLine({ id: 'msg_1', requestId: 'r1', ts: TS, usage: { input_tokens: 10, output_tokens: 5 } }),
      '{malformed',
      aiTitleLine('Scan test'),
    ),
  );
  await writeFile(subFile, jsonl(assistantLine({ id: 'msg_s', ts: TS, usage: { output_tokens: 7 } })));
  await writeFile(join(proj, 'sess-a', 'subagents', 'agent-1.meta.json'), '{"agentType":"Explore"}');
  await writeFile(oldFile, jsonl(assistantLine({ id: 'msg_old', ts: TS, usage: { output_tokens: 1 } })));
  const forty = (Date.now() - 40 * 86_400_000) / 1000;
  await utimes(oldFile, forty, forty);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function makeScanner(readRange = vi.fn(realReadRange)) {
  const emitted: Array<{ sessionId: string; events: TranscriptEvent[]; file: string }> = [];
  const progress: ScanProgress[] = [];
  const scanner = new HistoryScanner({
    claudeDir,
    cacheDir,
    deps: { readRange },
    onEvents: (sessionId, events, file) => emitted.push({ sessionId, events, file }),
    onProgress: (p) => progress.push(p),
  });
  return { scanner, emitted, progress, readRange };
}

const usageKeys = (events: TranscriptEvent[]) =>
  events.flatMap((e) => (e.kind === 'usage' ? [e.record.key] : []));

describe('HistoryScanner', () => {
  it('lists recent main and subagent transcripts only', async () => {
    const { scanner } = makeScanner();
    expect((await scanner.listFiles()).sort()).toEqual([mainFile, subFile].sort());
  });

  it('emits parsed events per file, without deduping, with subagent events as sidechain', async () => {
    const { scanner, emitted, progress } = makeScanner();
    await scanner.run();
    const main = emitted.find((e) => e.file === mainFile)!;
    expect(main.sessionId).toBe('sess-a');
    expect(usageKeys(main.events)).toEqual(['msg_1:r1', 'msg_1:r1']);
    expect(main.events).toContainEqual({
      kind: 'title',
      timestamp: 0,
      title: 'Scan test',
      source: 'ai-title',
    });
    const sub = emitted.find((e) => e.file === subFile)!;
    expect(sub.sessionId).toBe('sess-a');
    const subUsage = sub.events.find((e) => e.kind === 'usage');
    expect(subUsage?.kind === 'usage' && subUsage.record.isSidechain).toBe(true);
    expect(progress.at(-1)).toEqual({ done: true, filesDone: 2, filesTotal: 2 });
    expect(progress.slice(0, -1).every((p) => !p.done)).toBe(true);
  });

  it('keeps only the last meta event per file', async () => {
    const { scanner, emitted } = makeScanner();
    await scanner.run();
    const main = emitted.find((e) => e.file === mainFile)!;
    expect(main.events.filter((e) => e.kind === 'meta')).toHaveLength(1);
  });

  it('serves unchanged files from the cache without reading them', async () => {
    await makeScanner().scanner.run();
    const second = makeScanner();
    await second.scanner.run();
    expect(second.readRange).not.toHaveBeenCalled();
    expect(usageKeys(second.emitted.find((e) => e.file === mainFile)!.events)).toEqual([
      'msg_1:r1',
      'msg_1:r1',
    ]);
  });

  it('reads only appended complete lines when a file grows', async () => {
    const first = makeScanner();
    await first.scanner.run();
    const sizeBefore = (await stat(mainFile)).size;
    await appendFile(
      mainFile,
      assistantLine({ id: 'msg_2', ts: TS, usage: { output_tokens: 3 } }) +
        '\n' +
        '{"type":"assistant","partial',
    );
    const third = makeScanner();
    await third.scanner.run();
    const mainCall = third.readRange.mock.calls.find((c) => c[0] === mainFile)!;
    expect(mainCall[1]).toBe(sizeBefore);
    expect(usageKeys(third.emitted.find((e) => e.file === mainFile)!.events)).toEqual([
      'msg_1:r1',
      'msg_1:r1',
      'msg_2',
    ]);
  });

  it('ignores a corrupt cache file and rescans', async () => {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(join(cacheDir, 'scan-cache.json'), '{corrupt');
    const { scanner, emitted } = makeScanner();
    await scanner.run();
    expect(emitted).toHaveLength(2);
  });

  it('handles a missing projects dir', async () => {
    await rm(join(claudeDir, 'projects'), { recursive: true, force: true });
    const { scanner, emitted, progress } = makeScanner();
    await scanner.run();
    expect(emitted).toEqual([]);
    expect(progress.at(-1)).toEqual({ done: true, filesDone: 0, filesTotal: 0 });
  });

  it('rescans from byte 0 when a file is rewritten smaller', async () => {
    await writeFile(
      mainFile,
      jsonl(assistantLine({ id: 'msg_1', ts: TS, usage: { output_tokens: 5 } })) + '{"partial',
    );
    await makeScanner().scanner.run();
    await writeFile(mainFile, jsonl(assistantLine({ id: 'msg_new', ts: TS, usage: { output_tokens: 1 } })));
    const again = makeScanner();
    await again.scanner.run();
    const call = again.readRange.mock.calls.find((c) => c[0] === mainFile)!;
    expect(call[1]).toBe(0);
    expect(usageKeys(again.emitted.find((e) => e.file === mainFile)!.events)).toEqual(['msg_new']);
  });

  it('drops malformed cache entries and rescans those files', async () => {
    await makeScanner().scanner.run();
    const cacheFile = join(cacheDir, 'scan-cache.json');
    const cache = JSON.parse(await readFile(cacheFile, 'utf8'));
    cache.files[mainFile] = { mtimeMs: 'x', size: 1, offset: 0 };
    await writeFile(cacheFile, JSON.stringify(cache));
    const again = makeScanner();
    await again.scanner.run();
    expect(again.readRange.mock.calls.map((c) => c[0])).toEqual([mainFile]);
    expect(usageKeys(again.emitted.find((e) => e.file === mainFile)!.events)).toEqual([
      'msg_1:r1',
      'msg_1:r1',
    ]);
  });
});
