import type { SystemStats } from '../../domain/types.js';
import { readText, type SysfsDeps } from './sysfs.js';

/** The `some avg10` figure from a /proc/pressure file. */
export function parsePressureSome(text: string): number | undefined {
  const m = /^some avg10=([\d.]+)/m.exec(text);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

export async function readPressure(deps: SysfsDeps): Promise<SystemStats['pressure']> {
  const read = async (name: string): Promise<number | undefined> => {
    const text = await readText(deps, `/proc/pressure/${name}`);
    return text === undefined ? undefined : parsePressureSome(text);
  };
  const [mem, cpu, io] = await Promise.all([read('memory'), read('cpu'), read('io')]);
  return mem === undefined && cpu === undefined && io === undefined ? undefined : { mem, cpu, io };
}
