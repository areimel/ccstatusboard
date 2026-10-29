export interface MemUsage {
  used: number;
  total: number;
}

export interface MemoryReading {
  mem: MemUsage;
  swap: MemUsage;
}

export interface MemoryDeps {
  platform: NodeJS.Platform;
  totalmem: () => number;
  freemem: () => number;
  readFile: (path: string) => Promise<string>;
  exec: (cmd: string, args: string[]) => Promise<string>;
}

function kb(text: string, key: string): number | undefined {
  const m = new RegExp(`^${key}:\\s+(\\d+)\\s*kB`, 'm').exec(text);
  return m?.[1] === undefined ? undefined : Number(m[1]) * 1024;
}

/** Parse Linux /proc/meminfo. used = MemTotal - MemAvailable. */
export function parseMeminfo(text: string): MemoryReading {
  const total = kb(text, 'MemTotal') ?? 0;
  const available = kb(text, 'MemAvailable') ?? kb(text, 'MemFree') ?? total;
  const swapTotal = kb(text, 'SwapTotal') ?? 0;
  const swapFree = kb(text, 'SwapFree') ?? swapTotal;
  return {
    mem: { used: Math.max(0, total - available), total },
    swap: { used: Math.max(0, swapTotal - swapFree), total: swapTotal },
  };
}

const UNITS: Record<string, number> = { K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 };

/** Parse darwin `sysctl -n vm.swapusage` output. */
export function parseSwapUsage(text: string): MemUsage {
  const get = (key: string): number => {
    const m = new RegExp(`${key}\\s*=\\s*([\\d.]+)([KMGT])`).exec(text);
    return m?.[1] === undefined ? 0 : Math.round(Number(m[1]) * (UNITS[m[2] ?? 'M'] ?? 1));
  };
  return { used: get('used'), total: get('total') };
}

export async function readMemory(deps: MemoryDeps): Promise<MemoryReading> {
  if (deps.platform === 'linux') return parseMeminfo(await deps.readFile('/proc/meminfo'));
  const total = deps.totalmem();
  const mem = { used: Math.max(0, total - deps.freemem()), total };
  if (deps.platform !== 'darwin') return { mem, swap: { used: 0, total: 0 } };
  let swap: MemUsage = { used: 0, total: 0 };
  try {
    swap = parseSwapUsage(await deps.exec('sysctl', ['-n', 'vm.swapusage']));
  } catch {
    // swap unavailable: leave zeros
  }
  return { mem, swap };
}
