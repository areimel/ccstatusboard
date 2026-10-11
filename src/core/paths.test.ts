import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cacheDir,
  configDir,
  encodeProjectDir,
  findTranscript,
  projectsDir,
  resolveClaudeDir,
  sessionIdFromTranscriptPath,
  sessionsDir,
  subagentsDir,
  transcriptPath,
} from './paths.js';

describe('resolveClaudeDir', () => {
  const home = '/home/u';
  it('prefers flag > config > env > ~/.claude', () => {
    const env = { CLAUDE_CONFIG_DIR: '/env/claude' };
    expect(resolveClaudeDir({ flag: '/flag', config: '/cfg', env, home })).toBe('/flag');
    expect(resolveClaudeDir({ flag: null, config: '/cfg', env, home })).toBe('/cfg');
    expect(resolveClaudeDir({ env, home })).toBe('/env/claude');
    expect(resolveClaudeDir({ env: {}, home })).toBe('/home/u/.claude');
  });
  it('expands a leading ~/', () => {
    expect(resolveClaudeDir({ flag: '~/alt', env: {}, home })).toBe('/home/u/alt');
  });
  it('ignores empty strings', () => {
    expect(resolveClaudeDir({ flag: '', config: '', env: { CLAUDE_CONFIG_DIR: '' }, home })).toBe(
      '/home/u/.claude',
    );
  });
});

describe('encodeProjectDir', () => {
  it('replaces every non-alphanumeric char with -', () => {
    expect(encodeProjectDir('/home/alec/code_projects/x.y')).toBe('-home-alec-code-projects-x-y');
    expect(encodeProjectDir('/a/b c/worktrees/T2')).toBe('-a-b-c-worktrees-T2');
  });
});

describe('path builders', () => {
  it('builds sessions/projects/transcript/subagents paths', () => {
    expect(sessionsDir('/c')).toBe('/c/sessions');
    expect(projectsDir('/c')).toBe('/c/projects');
    expect(transcriptPath('/c', '/w/p', 'sid')).toBe('/c/projects/-w-p/sid.jsonl');
    expect(subagentsDir('/c', '/w/p', 'sid')).toBe('/c/projects/-w-p/sid/subagents');
  });
});

describe('sessionIdFromTranscriptPath', () => {
  it('handles main transcripts', () => {
    expect(sessionIdFromTranscriptPath('/c/projects/-w-p/abc-123.jsonl')).toEqual({
      sessionId: 'abc-123',
      isSubagent: false,
    });
  });
  it('handles subagent transcripts', () => {
    expect(sessionIdFromTranscriptPath('/c/projects/-w-p/abc-123/subagents/agent-x1.jsonl')).toEqual({
      sessionId: 'abc-123',
      isSubagent: true,
    });
  });
});

describe('configDir / cacheDir', () => {
  it('uses XDG vars when set', () => {
    const env = { XDG_CONFIG_HOME: '/xdg/c', XDG_CACHE_HOME: '/xdg/k' };
    expect(configDir(env, '/h', 'linux')).toBe('/xdg/c/ccstatusboard');
    expect(cacheDir(env, '/h', 'darwin')).toBe('/xdg/k/ccstatusboard');
  });
  it('falls back per platform', () => {
    expect(configDir({}, '/h', 'linux')).toBe('/h/.config/ccstatusboard');
    expect(configDir({}, '/h', 'darwin')).toBe('/h/.config/ccstatusboard');
    expect(cacheDir({}, '/h', 'linux')).toBe('/h/.cache/ccstatusboard');
    expect(cacheDir({}, '/h', 'darwin')).toBe('/h/Library/Caches/ccstatusboard');
  });
});

describe('findTranscript', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ccsb-paths-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns the direct path when it exists', async () => {
    const p = transcriptPath(dir, '/w/p', 'sid1');
    await mkdir(join(dir, 'projects', '-w-p'), { recursive: true });
    await writeFile(p, '');
    expect(await findTranscript(dir, '/w/p', 'sid1')).toBe(p);
  });
  it('falls back to scanning projects/*/<sid>.jsonl (cwd changed mid-session)', async () => {
    await mkdir(join(dir, 'projects', '-other'), { recursive: true });
    const p = join(dir, 'projects', '-other', 'sid2.jsonl');
    await writeFile(p, '');
    expect(await findTranscript(dir, '/w/p', 'sid2')).toBe(p);
  });
  it('returns null when nothing matches or projects/ is missing', async () => {
    expect(await findTranscript(dir, '/w/p', 'nope')).toBeNull();
  });
});
