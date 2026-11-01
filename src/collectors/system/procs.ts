import type { SystemStats } from '../../domain/types.js';
import { listDir, readText, type SysfsDeps } from './sysfs.js';

export async function readProcs(deps: SysfsDeps): Promise<SystemStats['procs']> {
  const entries = await listDir(deps, '/proc');
  const processes = entries.filter((e) => /^\d+$/.test(e)).length;
  // /proc/loadavg's fourth field is running/total scheduling entities (threads).
  const field = (await readText(deps, '/proc/loadavg'))?.split(/\s+/)[3];
  const threads = Number(field?.split('/')[1]);
  const hasThreads = Number.isFinite(threads) && field !== undefined;
  if (processes === 0 && !hasThreads) return undefined;
  return {
    processes: processes > 0 ? processes : undefined,
    threads: hasThreads ? threads : undefined,
  };
}
