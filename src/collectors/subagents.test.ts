import { describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { scanSubagents, type SubagentDeps } from './subagents.js';

const DIR = '/c/projects/-work-proj/sess-1/subagents';
const NOW = 1_000_000_000;

function deps(files: Record<string, { mtimeMs?: number; content?: string }>): SubagentDeps {
  return {
    readdir: vi.fn(async () => Object.keys(files)),
    stat: vi.fn(async (p: string) => {
      const f = files[p.slice(DIR.length + 1)];
      if (!f || f.mtimeMs === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return { mtimeMs: f.mtimeMs };
    }),
    readFile: vi.fn(async (p: string) => {
      const f = files[p.slice(DIR.length + 1)];
      if (!f || f.content === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return f.content;
    }),
  };
}

describe('scanSubagents', () => {
  it('returns empty activity when the dir is missing', async () => {
    const d: SubagentDeps = {
      readdir: async () => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      },
    };
    await expect(scanSubagents(DIR, NOW, d)).resolves.toEqual({
      activeCount: 0,
      names: [],
      files: [],
      agents: [],
    });
  });

  it('lists all agent jsonl files and counts only recently modified ones as active', async () => {
    const d = deps({
      'agent-b.jsonl': { mtimeMs: NOW - 5_000 },
      'agent-b.meta.json': { content: JSON.stringify({ agentType: 'Explore', description: 'x' }) },
      'agent-a.jsonl': { mtimeMs: NOW - 31_000 },
      'agent-a.meta.json': { content: JSON.stringify({ agentType: 'Plan' }) },
      'agent-c.jsonl': { mtimeMs: NOW },
      'notes.txt': { mtimeMs: NOW },
    });
    const r = await scanSubagents(DIR, NOW, d);
    expect(r.files).toEqual([
      join(DIR, 'agent-a.jsonl'),
      join(DIR, 'agent-b.jsonl'),
      join(DIR, 'agent-c.jsonl'),
    ]);
    expect(r.activeCount).toBe(2);
    expect(r.names).toEqual(['Explore', 'agent']);
    expect(r.agents).toEqual([
      { id: 'b', name: 'Explore', lastActivity: NOW - 5_000 },
      { id: 'c', name: 'agent', lastActivity: NOW },
    ]);
  });

  it('honors a custom active window', async () => {
    const d = deps({ 'agent-a.jsonl': { mtimeMs: NOW - 50_000 } });
    expect((await scanSubagents(DIR, NOW, d, 60_000)).activeCount).toBe(1);
    expect((await scanSubagents(DIR, NOW, d, 30_000)).activeCount).toBe(0);
  });

  it('falls back to "agent" for malformed or missing meta, and skips files whose stat fails', async () => {
    const d = deps({
      'agent-a.jsonl': { mtimeMs: NOW },
      'agent-a.meta.json': { content: '{bad' },
      'agent-gone.jsonl': {},
    });
    const r = await scanSubagents(DIR, NOW, d);
    expect(r.activeCount).toBe(1);
    expect(r.names).toEqual(['agent']);
    expect(r.files).toEqual([join(DIR, 'agent-a.jsonl'), join(DIR, 'agent-gone.jsonl')]);
  });
});
