import { basename, dirname } from 'node:path';
import { runCommand } from '../core/exec.js';

export interface ProjectResolverDeps {
  exec?: (cmd: string, args: string[]) => Promise<string>;
}

const GIT_TIMEOUT_MS = 2_000;

/** Resolves a cwd to its git repo name (worktree/subfolder aware); falls back to the cwd basename. Cached per cwd. */
export function createProjectResolver(deps: ProjectResolverDeps = {}): (cwd: string) => Promise<string> {
  const exec = deps.exec ?? ((cmd, args) => runCommand(cmd, args, { timeoutMs: GIT_TIMEOUT_MS }));
  const cache = new Map<string, Promise<string>>();

  const resolve = async (cwd: string): Promise<string> => {
    try {
      const out = (
        await exec('git', ['-C', cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir'])
      ).trim();
      if (out) {
        const name = out.endsWith('/.git') ? basename(dirname(out)) : basename(out).replace(/\.git$/, '');
        if (name) return name;
      }
    } catch {
      // not a repo, git missing or timed out: fall through
    }
    return basename(cwd);
  };

  return (cwd) => {
    let p = cache.get(cwd);
    if (!p) {
      p = resolve(cwd);
      cache.set(cwd, p);
    }
    return p;
  };
}
