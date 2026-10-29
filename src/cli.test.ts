import { afterAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { THEME_NAMES } from './domain/types.js';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

// Never let the CLI see the developer's real config/cache dirs.
const isolated = await mkdtemp(join(tmpdir(), 'ccsb-env-'));
const env = { ...process.env, XDG_CONFIG_HOME: isolated, XDG_CACHE_HOME: isolated };
afterAll(() => rm(isolated, { recursive: true, force: true }));

function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ['--import', 'tsx', 'src/cli.tsx', ...args],
      { timeout: 15_000, env },
      (err, stdout, stderr) => {
        const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0;
        resolve({ code, stdout, stderr });
      },
    );
  });
}

describe('cli', () => {
  it('--version prints the package version', async () => {
    const r = await runCli(['--version']);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe(pkg.version);
    expect(r.stdout).not.toContain('\u001b[');
  });

  it('--help prints usage with key flags', async () => {
    const r = await runCli(['--help']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Usage: ccstatusboard');
    expect(r.stdout).toContain('--no-usage-api');
    for (const name of THEME_NAMES) expect(r.stdout).toContain(name);
    const themeLines = r.stdout.split('\n').filter((l) => l.startsWith(' '.repeat(24)));
    for (const line of themeLines) expect(line.length).toBeLessThanOrEqual(80);
    expect(r.stdout).not.toContain('\u001b[?1049');
  });

  it('unknown flag prints an error and exits 1', async () => {
    const r = await runCli(['--bogus']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('ccstatusboard:');
  });

  it('invalid config prints an error and exits 1 without touching the terminal', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ccsb-cfg-'));
    try {
      const cfg = join(dir, 'config.json');
      await writeFile(cfg, JSON.stringify({ theme: 'neon' }));
      const r = await runCli(['--config', cfg]);
      expect(r.code).toBe(1);
      expect(r.stderr).toContain('ccstatusboard:');
      expect(r.stdout).not.toContain('\u001b[?1049h');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('refuses to run without an interactive terminal', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ccsb-tty-'));
    try {
      const r = await runCli(['--claude-dir', dir, '--no-usage-api']);
      expect(r.code).toBe(1);
      expect(r.stderr).toContain('ccstatusboard needs an interactive terminal');
      expect(r.stdout).not.toContain('\u001b[?1049h');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
