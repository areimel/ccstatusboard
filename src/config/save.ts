import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ThemeName } from '../domain/types.js';
import { isEnoent } from './load.js';

export interface SaverFs {
  readFile(p: string): Promise<string>;
  writeFile(p: string, data: string): Promise<void>;
  rename(a: string, b: string): Promise<void>;
  mkdir(p: string, opts: { recursive: true }): Promise<unknown>;
}

const realFs: SaverFs = {
  readFile: (p) => readFile(p, 'utf8'),
  writeFile: (p, data) => writeFile(p, data, 'utf8'),
  rename,
  mkdir,
};

export interface ThemeSaver {
  (name: ThemeName): void;
  /** Resolves once no write is in flight or pending. Never rejects. For tests. */
  flush(): Promise<void>;
}

async function writeTheme(path: string, name: ThemeName, fs: SaverFs): Promise<void> {
  let existing: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(path));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return;
    existing = parsed as Record<string, unknown>;
  } catch (e) {
    if (!isEnoent(e)) return; // unreadable or invalid JSON: never clobber the user's file
  }
  const tmp = `${path}.tmp`;
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(tmp, `${JSON.stringify({ ...existing, theme: name }, null, 2)}\n`);
  await fs.rename(tmp, path);
}

/**
 * Fire-and-forget persistence of the theme into the config file. Writes are
 * serialized with latest-wins coalescing; errors are swallowed.
 */
export function createThemeSaver(opts: { path: string; fs?: SaverFs }): ThemeSaver {
  const fs = opts.fs ?? realFs;
  let pending: ThemeName | undefined;
  let running: Promise<void> | undefined;

  async function drain(): Promise<void> {
    while (pending !== undefined) {
      const name = pending;
      pending = undefined;
      try {
        await writeTheme(opts.path, name, fs);
      } catch {
        // no stderr surface in the TUI; a later save may succeed
      }
    }
    running = undefined;
  }

  const save = ((name: ThemeName): void => {
    pending = name;
    running ??= drain();
  }) as ThemeSaver;
  save.flush = async () => {
    await running;
  };
  return save;
}
