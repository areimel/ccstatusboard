/** The filesystem surface the Linux metric readers need; injected for tests. */
export interface SysfsDeps {
  readFile: (path: string) => Promise<string>;
  readdir: (path: string) => Promise<string[]>;
}

/** Trimmed file contents; undefined when missing or unreadable (sysfs reads can fail per-attribute). */
export async function readText(deps: SysfsDeps, path: string): Promise<string | undefined> {
  try {
    return (await deps.readFile(path)).trim();
  } catch {
    return undefined;
  }
}

export async function readNum(deps: SysfsDeps, path: string): Promise<number | undefined> {
  const text = await readText(deps, path);
  if (text === undefined || text === '') return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
}

/** Directory entries in natural order (hwmon2 before hwmon10); empty when missing. */
export async function listDir(deps: SysfsDeps, path: string): Promise<string[]> {
  try {
    return (await deps.readdir(path)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  } catch {
    return [];
  }
}

/** Reading attributes of a runtime-suspended device can wake it, so callers must skip those. */
export async function isSuspended(deps: SysfsDeps, devicePath: string): Promise<boolean> {
  return (await readText(deps, `${devicePath}/power/runtime_status`)) === 'suspended';
}
