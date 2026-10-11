import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TranscriptTailer } from './transcriptTailer.js';

let dir: string;
let file: string;
let got: string[];
let tailers: TranscriptTailer[];
const collect = (_f: string, lines: string[]) => {
  got.push(...lines);
};
const make = (...args: ConstructorParameters<typeof TranscriptTailer>): TranscriptTailer => {
  const t = new TranscriptTailer(...args);
  tailers.push(t);
  return t;
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ccsb-tail-'));
  file = join(dir, 'sess.jsonl');
  got = [];
  tailers = [];
});
afterEach(async () => {
  for (const t of tailers) t.stop();
  await rm(dir, { recursive: true, force: true });
});

async function until(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('timeout waiting for condition');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('TranscriptTailer', () => {
  it('emits existing complete lines on the first poll, tagged with the file', async () => {
    await writeFile(file, '{"a":1}\n{"a":2}\n');
    const calls: Array<[string, string[]]> = [];
    const t = make({ onLines: (f, l) => calls.push([f, l]) });
    t.add(file);
    await t.pollOnce();
    expect(calls).toEqual([[file, ['{"a":1}', '{"a":2}']]]);
  });

  it('buffers a half-written line and emits it exactly once when completed (Review Focus 1)', async () => {
    await writeFile(file, '{"a":1}\n{"b":');
    const t = make({ onLines: collect });
    t.add(file);
    await t.pollOnce();
    expect(got).toEqual(['{"a":1}']);
    await appendFile(file, '2}\n');
    await t.pollOnce();
    expect(got).toEqual(['{"a":1}', '{"b":2}']);
    await t.pollOnce(); // nothing new
    expect(got).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('resets to offset 0 when the file is truncated', async () => {
    await writeFile(file, '{"n":1}\n{"n":2}\n{"n":3}\n');
    const t = make({ onLines: collect });
    t.add(file);
    await t.pollOnce();
    await writeFile(file, '{"z":9}\n');
    await t.pollOnce();
    expect(got).toEqual(['{"n":1}', '{"n":2}', '{"n":3}', '{"z":9}']);
  });

  it('honours startOffset', async () => {
    const first = '{"skip":true}\n';
    await writeFile(file, first + '{"keep":true}\n');
    const t = make({ onLines: collect });
    t.add(file, Buffer.byteLength(first));
    await t.pollOnce();
    expect(got).toEqual(['{"keep":true}']);
  });

  it('tolerates a missing file and picks it up once created', async () => {
    const t = make({ onLines: collect });
    t.add(file);
    await expect(t.pollOnce()).resolves.toBeUndefined();
    await writeFile(file, '{"late":1}\n');
    await t.pollOnce();
    expect(got).toEqual(['{"late":1}']);
  });

  it('decodes a multi-byte character split across reads', async () => {
    const full = Buffer.from('{"t":"é"}\n', 'utf8');
    let content = full.subarray(0, 7); // cuts the 2-byte "é" in half
    const t = make({
      onLines: collect,
      deps: {
        stat: async () => ({ size: content.length, mtimeMs: 0 }),
        readRange: async (_p, start, end) => content.subarray(start, end),
      },
    });
    t.add('/virtual.jsonl');
    await t.pollOnce();
    expect(got).toEqual([]);
    content = full;
    await t.pollOnce();
    expect(got).toEqual(['{"t":"é"}']);
  });

  it('add is idempotent, remove stops reading, has reflects membership', async () => {
    await writeFile(file, '{"a":1}\n');
    const t = make({ onLines: collect });
    t.add(file);
    t.add(file);
    expect(t.has(file)).toBe(true);
    await t.pollOnce();
    expect(got).toEqual(['{"a":1}']);
    t.remove(file);
    expect(t.has(file)).toBe(false);
    await appendFile(file, '{"a":2}\n');
    await t.pollOnce();
    expect(got).toEqual(['{"a":1}']);
  });

  it('coalesces concurrent polls without double-reading', async () => {
    await writeFile(file, '{"a":1}\n');
    const t = make({ onLines: collect });
    t.add(file);
    await Promise.all([t.pollOnce(), t.pollOnce(), t.pollOnce()]);
    expect(got).toEqual(['{"a":1}']);
  });

  it('start() polls on an interval until stop()', async () => {
    await writeFile(file, '');
    const t = make({ onLines: collect, pollMs: 20 });
    t.add(file);
    t.start();
    await appendFile(file, '{"live":1}\n');
    await until(() => got.length === 1);
    t.stop();
    await appendFile(file, '{"live":2}\n');
    await new Promise((r) => setTimeout(r, 80));
    expect(got).toEqual(['{"live":1}']);
  });
});
