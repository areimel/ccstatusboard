import { describe, expect, it, vi } from 'vitest';
import { createProjectResolver } from './projectName.js';

const stub = (out: string) => vi.fn(async (_cmd: string, _args: string[]) => out);

describe('createProjectResolver', () => {
  it('names a worktree after the main repo (common dir is the main .git)', async () => {
    const exec = stub('/home/u/repo/.git\n');
    const resolve = createProjectResolver({ exec });
    await expect(resolve('/home/u/repo-wt')).resolves.toBe('repo');
    expect(exec).toHaveBeenCalledWith('git', [
      '-C',
      '/home/u/repo-wt',
      'rev-parse',
      '--path-format=absolute',
      '--git-common-dir',
    ]);
  });

  it('resolves a subfolder to the repo name', async () => {
    const resolve = createProjectResolver({ exec: stub('/home/u/repo/.git') });
    await expect(resolve('/home/u/repo/src/deep')).resolves.toBe('repo');
  });

  it('strips .git from a bare repo directory', async () => {
    const resolve = createProjectResolver({ exec: stub('/srv/git/foo.git\n') });
    await expect(resolve('/srv/git/foo.git')).resolves.toBe('foo');
  });

  it('falls back to the cwd basename on error or empty output', async () => {
    const bad = createProjectResolver({
      exec: vi.fn(async () => {
        throw new Error('not a repo');
      }),
    });
    await expect(bad('/tmp/scratch')).resolves.toBe('scratch');
    const empty = createProjectResolver({ exec: stub('  \n') });
    await expect(empty('/tmp/other')).resolves.toBe('other');
  });

  it('runs git once per cwd', async () => {
    const exec = stub('/home/u/repo/.git');
    const resolve = createProjectResolver({ exec });
    await Promise.all([resolve('/a'), resolve('/a')]);
    await resolve('/a');
    expect(exec).toHaveBeenCalledTimes(1);
    await resolve('/b');
    expect(exec).toHaveBeenCalledTimes(2);
  });
});
