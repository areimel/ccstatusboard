import { describe, expect, it, vi } from 'vitest';
import { createThemeSaver, type SaverFs } from './save.js';

const path = '/cfg/ccstatusboard/config.json';

function memFs(initial: Record<string, string> = {}, opts: { gate?: Promise<void> } = {}) {
  const files = { ...initial };
  const log: string[] = [];
  const fs = {
    files,
    log,
    readFile: vi.fn(async (p: string) => {
      const v = files[p];
      if (v === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return v;
    }),
    writeFile: vi.fn(async (p: string, d: string) => {
      log.push(`write:${p}`);
      if (opts.gate) await opts.gate;
      files[p] = d;
    }),
    rename: vi.fn(async (a: string, b: string) => {
      log.push(`rename:${a}->${b}`);
      files[b] = files[a] as string;
      delete files[a];
    }),
    mkdir: vi.fn(async () => undefined),
  };
  return fs satisfies SaverFs & Record<string, unknown>;
}

describe('createThemeSaver', () => {
  it('merges theme and preserves other keys', async () => {
    const fs = memFs({ [path]: '{"refreshMs":500,"theme":"default"}' });
    const save = createThemeSaver({ path, fs });
    save('dracula');
    await save.flush();
    expect(JSON.parse(fs.files[path] as string)).toEqual({ refreshMs: 500, theme: 'dracula' });
    expect(fs.files[path]).toMatch(/\n$/);
  });

  it('creates the file and directory on ENOENT', async () => {
    const fs = memFs();
    const save = createThemeSaver({ path, fs });
    save('mono');
    await save.flush();
    expect(fs.mkdir).toHaveBeenCalledWith('/cfg/ccstatusboard', { recursive: true });
    expect(JSON.parse(fs.files[path] as string)).toEqual({ theme: 'mono' });
  });

  it('skips invalid JSON', async () => {
    const fs = memFs({ [path]: '{oops' });
    const save = createThemeSaver({ path, fs });
    save('mono');
    await save.flush();
    expect(fs.writeFile).not.toHaveBeenCalled();
    expect(fs.files[path]).toBe('{oops');
  });

  it.each(['[1]', 'null', '42', '"x"'])('skips non-object JSON %s', async (text) => {
    const fs = memFs({ [path]: text });
    const save = createThemeSaver({ path, fs });
    save('mono');
    await save.flush();
    expect(fs.writeFile).not.toHaveBeenCalled();
    expect(fs.files[path]).toBe(text);
  });

  it('coalesces rapid calls to the latest name with at most 2 writes', async () => {
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const fs = memFs({}, { gate });
    const save = createThemeSaver({ path, fs });
    save('default');
    save('mono');
    save('solarized');
    save('dracula');
    open();
    await save.flush();
    expect(fs.writeFile.mock.calls.length).toBeLessThanOrEqual(2);
    expect(JSON.parse(fs.files[path] as string).theme).toBe('dracula');
  });

  it('writes via .tmp then renames', async () => {
    const fs = memFs();
    const save = createThemeSaver({ path, fs });
    save('mono');
    await save.flush();
    expect(fs.log).toEqual([`write:${path}.tmp`, `rename:${path}.tmp->${path}`]);
    expect(fs.files[`${path}.tmp`]).toBeUndefined();
  });

  it('swallows write errors and keeps working', async () => {
    const fs = memFs();
    fs.writeFile.mockRejectedValueOnce(new Error('EACCES'));
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    const save = createThemeSaver({ path, fs });
    save('mono');
    await save.flush();
    save('dracula');
    await save.flush();
    await new Promise((r) => setImmediate(r));
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
    expect(JSON.parse(fs.files[path] as string).theme).toBe('dracula');
  });
});
