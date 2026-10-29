import { mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Config } from '../domain/types.js';
import { isEnoent } from './load.js';

export interface SaverFs {
  readFile(p: string): Promise<string>;
  writeFile(p: string, data: string): Promise<void>;
  rename(a: string, b: string): Promise<void>;
  mkdir(p: string, opts: { recursive: true }): Promise<unknown>;
  realpath(p: string): Promise<string>;
  rm(p: string, opts: { force: true }): Promise<void>;
}

const realFs: SaverFs = {
  readFile: (p) => readFile(p, 'utf8'),
  writeFile: (p, data) => writeFile(p, data, 'utf8'),
  rename,
  mkdir,
  realpath,
  rm,
};

export interface ConfigSaver {
  (patch: Partial<Config>): void;
  /** Resolves once no write is in flight or pending. Never rejects. For tests. */
  flush(): Promise<void>;
}

/** Resolve symlinks (dotfile managers) so the rename replaces the real file, not the link. */
async function resolveTarget(path: string, fs: SaverFs): Promise<string> {
  try {
    return await fs.realpath(path);
  } catch {
    return path;
  }
}

async function writePatch(configPath: string, patch: Partial<Config>, fs: SaverFs): Promise<void> {
  const path = await resolveTarget(configPath, fs);
  let existing: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(path));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return;
    existing = parsed as Record<string, unknown>;
  } catch (e) {
    if (!isEnoent(e)) return; // unreadable or invalid JSON: never clobber the user's file
  }
  // Per-process temp name so two running instances never interleave writes.
  const tmp = `${path}.${process.pid}.tmp`;
  await fs.mkdir(dirname(path), { recursive: true });
  try {
    await fs.writeFile(tmp, `${JSON.stringify({ ...existing, ...patch }, null, 2)}\n`);
    await fs.rename(tmp, path);
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw e;
  }
}

/**
 * Fire-and-forget persistence of config patches into the config file. Writes
 * are serialized; pending patches coalesce with latest-wins per key; errors are
 * swallowed.
 */
export function createConfigSaver(opts: { path: string; fs?: SaverFs }): ConfigSaver {
  const fs = opts.fs ?? realFs;
  let pending: Partial<Config> | undefined;
  let running: Promise<void> | undefined;

  async function drain(): Promise<void> {
    while (pending !== undefined) {
      const patch = pending;
      pending = undefined;
      try {
        await writePatch(opts.path, patch, fs);
      } catch {
        // no stderr surface in the TUI; a later save may succeed
      }
    }
    running = undefined;
  }

  const save = ((patch: Partial<Config>): void => {
    const defined = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    ) as Partial<Config>;
    if (Object.keys(defined).length === 0) return;
    pending = { ...pending, ...defined };
    running ??= drain();
  }) as ConfigSaver;
  save.flush = async () => {
    await running;
  };
  return save;
}
