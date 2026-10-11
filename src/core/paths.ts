import { access, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';

function nonEmpty(v: string | null | undefined): v is string {
  return typeof v === 'string' && v.length > 0;
}

function expandHome(p: string, home: string): string {
  if (p === '~') return home;
  if (p.startsWith('~/')) return join(home, p.slice(2));
  return p;
}

export function resolveClaudeDir(opts: {
  flag?: string | null;
  config?: string | null;
  env?: NodeJS.ProcessEnv;
  home?: string;
}): string {
  const home = opts.home ?? homedir();
  const env = opts.env ?? process.env;
  const chosen = [opts.flag, opts.config, env.CLAUDE_CONFIG_DIR].find(nonEmpty);
  return chosen ? expandHome(chosen, home) : join(home, '.claude');
}

export function encodeProjectDir(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, '-');
}

export function sessionsDir(claudeDir: string): string {
  return join(claudeDir, 'sessions');
}

export function projectsDir(claudeDir: string): string {
  return join(claudeDir, 'projects');
}

export function transcriptPath(claudeDir: string, cwd: string, sessionId: string): string {
  return join(projectsDir(claudeDir), encodeProjectDir(cwd), `${sessionId}.jsonl`);
}

export function subagentsDir(claudeDir: string, cwd: string, sessionId: string): string {
  return join(projectsDir(claudeDir), encodeProjectDir(cwd), sessionId, 'subagents');
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export async function findTranscript(
  claudeDir: string,
  cwd: string,
  sessionId: string,
): Promise<string | null> {
  const direct = transcriptPath(claudeDir, cwd, sessionId);
  if (await exists(direct)) return direct;
  let dirs: string[];
  try {
    dirs = await readdir(projectsDir(claudeDir));
  } catch {
    return null;
  }
  for (const d of dirs) {
    const candidate = join(projectsDir(claudeDir), d, `${sessionId}.jsonl`);
    if (await exists(candidate)) return candidate;
  }
  return null;
}

export function configDir(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
  _platform: NodeJS.Platform = process.platform,
): string {
  const base = nonEmpty(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : join(home, '.config');
  return join(base, 'ccstatusboard');
}

export function cacheDir(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
  platform: NodeJS.Platform = process.platform,
): string {
  if (nonEmpty(env.XDG_CACHE_HOME)) return join(env.XDG_CACHE_HOME, 'ccstatusboard');
  if (platform === 'darwin') return join(home, 'Library', 'Caches', 'ccstatusboard');
  return join(home, '.cache', 'ccstatusboard');
}

export function sessionIdFromTranscriptPath(file: string): { sessionId: string; isSubagent: boolean } {
  const parent = dirname(file);
  if (basename(parent) === 'subagents') {
    return { sessionId: basename(dirname(parent)), isSubagent: true };
  }
  return { sessionId: basename(file, '.jsonl'), isSubagent: false };
}
