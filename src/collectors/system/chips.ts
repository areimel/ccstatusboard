import type { GpuStats, SystemStats } from '../../domain/types.js';
import { isSuspended, listDir, readNum, readText, type SysfsDeps } from './sysfs.js';

const CPUS = '/sys/devices/system/cpu';
const DRM = '/sys/class/drm';

/** Fastest core right now, and the rated maximum. */
export async function readCpuFreq(deps: SysfsDeps): Promise<SystemStats['cpuFreq']> {
  const cpus = (await listDir(deps, CPUS)).filter((n) => /^cpu\d+$/.test(n));
  const khz = await Promise.all(cpus.map((c) => readNum(deps, `${CPUS}/${c}/cpufreq/scaling_cur_freq`)));
  const known = khz.filter((k) => k !== undefined);
  if (known.length === 0) return undefined;
  const max = cpus[0] ? await readNum(deps, `${CPUS}/${cpus[0]}/cpufreq/cpuinfo_max_freq`) : undefined;
  return { curHz: Math.max(...known) * 1000, maxHz: max === undefined ? undefined : max * 1000 };
}

export async function readPowerProfile(deps: SysfsDeps): Promise<string | undefined> {
  return (await readText(deps, '/sys/firmware/acpi/platform_profile')) || undefined;
}

async function readCard(deps: SysfsDeps, card: string): Promise<GpuStats | undefined> {
  const device = `${DRM}/${card}/device`;
  if (await isSuspended(deps, device)) return undefined;
  const [hwmon] = await listDir(deps, `${device}/hwmon`);
  const sensor = hwmon ? `${device}/hwmon/${hwmon}` : undefined;
  const busyPercent = await readNum(deps, `${device}/gpu_busy_percent`);
  const vramUsed = await readNum(deps, `${device}/mem_info_vram_used`);
  const hz = sensor ? await readNum(deps, `${sensor}/freq1_input`) : undefined;
  const intelMhz = await readNum(deps, `${DRM}/${card}/gt_cur_freq_mhz`);
  const clockHz = hz ?? (intelMhz === undefined ? undefined : intelMhz * 1e6);
  const microwatts = sensor
    ? ((await readNum(deps, `${sensor}/power1_input`)) ?? (await readNum(deps, `${sensor}/power1_average`)))
    : undefined;
  const watts = microwatts === undefined ? undefined : microwatts / 1e6;
  const found = [busyPercent, vramUsed, clockHz, watts].some((v) => v !== undefined);
  return found ? { busyPercent, vramUsed, clockHz, watts } : undefined;
}

/** The first awake GPU with readable stats. `cardN-*` entries are display connectors, not GPUs. */
export async function readGpu(deps: SysfsDeps): Promise<GpuStats | undefined> {
  const cards = (await listDir(deps, DRM)).filter((n) => /^card\d+$/.test(n));
  for (const card of cards) {
    const stats = await readCard(deps, card);
    if (stats) return stats;
  }
  return undefined;
}
