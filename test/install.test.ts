import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const SCRIPT = resolve(__dirname, '..', 'install.sh');
const have = (cmd: string): boolean =>
  spawnSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' }).status === 0;
const available = have('sh') && have('curl');

const FAKE_BIN = '#!/bin/sh\necho 9.9.9\n';
const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
const ASSETS = ['ccstatusboard-linux-x64', 'ccstatusboard-darwin-arm64', 'ccstatusboard-darwin-x64'];

let root: string;
let release: string;
let shimDir: string;

function writeRelease(dir: string, opts: { sums?: string } = {}): void {
  mkdirSync(dir, { recursive: true });
  for (const a of ASSETS) writeFileSync(join(dir, a), FAKE_BIN);
  const sums = opts.sums ?? ASSETS.map((a) => `${sha(FAKE_BIN)}  ${a}\n`).join('');
  writeFileSync(join(dir, 'SHA256SUMS'), sums);
}

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
  installDir: string;
  bin: string;
}

function run(
  opts: {
    os?: string;
    arch?: string;
    version?: string;
    base?: string;
    args?: string[];
    installDir?: string;
  } = {},
): Run {
  const home = mkdtempSync(join(root, 'home-'));
  const installDir = opts.installDir ?? join(home, 'bin');
  const env: Record<string, string> = {
    PATH: `${shimDir}:${process.env.PATH ?? ''}`,
    HOME: home,
    FAKE_UNAME_S: opts.os ?? 'Linux',
    FAKE_UNAME_M: opts.arch ?? 'x86_64',
    CCSTATUSBOARD_INSTALL_DIR: installDir,
    CCSTATUSBOARD_DOWNLOAD_BASE: opts.base ?? `file://${release}`,
  };
  if (opts.version) env.CCSTATUSBOARD_VERSION = opts.version;
  const r = spawnSync('sh', [SCRIPT, ...(opts.args ?? [])], { env, encoding: 'utf8' });
  return {
    status: r.status,
    stdout: r.stdout,
    stderr: r.stderr,
    installDir,
    bin: join(installDir, 'ccstatusboard'),
  };
}

describe.skipIf(!available)('install.sh', () => {
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'ccsb-install-'));
    release = join(root, 'release');
    writeRelease(join(release, 'latest', 'download'));
    writeRelease(join(release, 'download', 'v1.2.3'));
    shimDir = join(root, 'shim');
    mkdirSync(shimDir);
    const shim = join(shimDir, 'uname');
    writeFileSync(
      shim,
      '#!/bin/sh\ncase "${1:-}" in -s) echo "$FAKE_UNAME_S";; -m) echo "$FAKE_UNAME_M";; *) echo "$FAKE_UNAME_S";; esac\n',
    );
    chmodSync(shim, 0o755);
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('installs linux-x64 and the binary runs', () => {
    const r = run();
    expect(r.status, r.stderr).toBe(0);
    expect(existsSync(r.bin)).toBe(true);
    const out = spawnSync(r.bin, ['--version'], { encoding: 'utf8' });
    expect(out.stdout.trim()).toBe('9.9.9');
    expect(r.stderr).toContain('9.9.9');
  });

  it('picks the darwin-arm64 asset', () => {
    const dir = join(root, 'distinct');
    writeRelease(join(dir, 'latest', 'download'));
    const arm = '#!/bin/sh\necho arm-binary\n';
    writeFileSync(join(dir, 'latest', 'download', 'ccstatusboard-darwin-arm64'), arm);
    const sums = ASSETS.map(
      (a) => `${sha(a === 'ccstatusboard-darwin-arm64' ? arm : FAKE_BIN)}  ${a}\n`,
    ).join('');
    writeFileSync(join(dir, 'latest', 'download', 'SHA256SUMS'), sums);
    const r = run({ os: 'Darwin', arch: 'arm64', base: `file://${dir}` });
    expect(r.status, r.stderr).toBe(0);
    expect(spawnSync(r.bin, [], { encoding: 'utf8' }).stdout.trim()).toBe('arm-binary');
  });

  it('aborts on checksum mismatch and installs nothing', () => {
    const dir = join(root, 'badsum');
    writeRelease(join(dir, 'latest', 'download'), {
      sums: `${'0'.repeat(64)}  ccstatusboard-linux-x64\n`,
    });
    const r = run({ base: `file://${dir}` });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('checksum mismatch');
    expect(existsSync(r.bin)).toBe(false);
  });

  it('fails when SHA256SUMS has no entry for the asset', () => {
    const dir = join(root, 'noentry');
    writeRelease(join(dir, 'latest', 'download'), {
      sums: `${sha(FAKE_BIN)}  ccstatusboard-darwin-x64\n`,
    });
    const r = run({ base: `file://${dir}` });
    expect(r.status).not.toBe(0);
    expect(existsSync(r.bin)).toBe(false);
  });

  it('rejects unsupported platforms with an npm hint', () => {
    const r = run({ os: 'Linux', arch: 'aarch64' });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('npm');
    expect(existsSync(r.bin)).toBe(false);
  });

  it.each(['v1.2.3', '1.2.3'])('uses the pinned download path for %s', (version) => {
    const r = run({ version });
    expect(r.status, r.stderr).toBe(0);
    expect(existsSync(r.bin)).toBe(true);
    // Only the pinned layout for v1.2.3 exists in a dedicated base, proving the path used.
    const only = join(root, `pinned-${version}`);
    writeRelease(join(only, 'download', 'v1.2.3'));
    const r2 = run({ version, base: `file://${only}` });
    expect(r2.status, r2.stderr).toBe(0);
    const latestOnly = join(root, `latest-only-${version}`);
    writeRelease(join(latestOnly, 'latest', 'download'));
    expect(run({ version, base: `file://${latestOnly}` }).status).not.toBe(0);
  });

  it('--uninstall removes the binary', () => {
    const r = run();
    expect(existsSync(r.bin)).toBe(true);
    const u = run({ args: ['--uninstall'], installDir: r.installDir });
    expect(u.status, u.stderr).toBe(0);
    expect(existsSync(r.bin)).toBe(false);
    const again = run({ args: ['--uninstall'], installDir: r.installDir });
    expect(again.status).toBe(0);
  });

  it('rejects unknown arguments', () => {
    expect(run({ args: ['--bogus'] }).status).not.toBe(0);
  });
});
