import type { BatteryStats } from '../../domain/types.js';
import { listDir, readNum, readText, type SysfsDeps } from './sysfs.js';

const SUPPLIES = '/sys/class/power_supply';
const pos = (n: number | undefined): number | undefined => (n !== undefined && n > 0 ? n : undefined);

async function readSupply(deps: SysfsDeps, dir: string): Promise<BatteryStats | undefined> {
  const num = (f: string) => readNum(deps, `${dir}/${f}`);
  // Drivers report either energy (µWh, µW) or charge (µAh, µA); both give the same ratios.
  const energyNow = await num('energy_now');
  const prefix = energyNow !== undefined ? 'energy' : 'charge';
  const now = energyNow ?? (await num('charge_now'));
  const full = pos(await num(`${prefix}_full`));
  const design = pos(await num(`${prefix}_full_design`));
  const volts = await num('voltage_now');
  const current = await num('current_now');
  const rate =
    prefix === 'energy'
      ? pos(await num('power_now'))
      : pos(current === undefined ? undefined : Math.abs(current));
  const watts =
    rate === undefined
      ? undefined
      : prefix === 'energy'
        ? rate / 1e6
        : volts === undefined
          ? undefined
          : (rate * volts) / 1e12;

  const percent = (await num('capacity')) ?? (now !== undefined && full ? (now / full) * 100 : undefined);
  if (percent === undefined) return undefined;

  const status = (await readText(deps, `${dir}/status`)) ?? 'Unknown';
  let secondsLeft: number | undefined;
  if (rate !== undefined && now !== undefined) {
    if (status === 'Discharging') secondsLeft = (now / rate) * 3600;
    else if (status === 'Charging' && full !== undefined)
      secondsLeft = (Math.max(0, full - now) / rate) * 3600;
  }
  return {
    percent,
    status,
    watts,
    secondsLeft,
    healthPercent: full && design ? (full / design) * 100 : undefined,
    cycles: pos(await num('cycle_count')),
  };
}

/** The first system battery; `scope=Device` marks peripherals such as wireless mice. */
export async function readBattery(deps: SysfsDeps): Promise<BatteryStats | undefined> {
  for (const name of await listDir(deps, SUPPLIES)) {
    const dir = `${SUPPLIES}/${name}`;
    if ((await readText(deps, `${dir}/type`)) !== 'Battery') continue;
    if ((await readText(deps, `${dir}/scope`)) === 'Device') continue;
    const stats = await readSupply(deps, dir);
    if (stats) return stats;
  }
  return undefined;
}
