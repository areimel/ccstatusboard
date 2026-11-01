import type { TempReading } from '../../domain/types.js';
import { isSuspended, listDir, readNum, readText, type SysfsDeps } from './sysfs.js';

const HWMON = '/sys/class/hwmon';
const MIN_READING = -20;
const MAX_PLAUSIBLE = 150;

/** Known chips in display order. `prefer` picks the one sensor to show, best first. */
const CHIPS: { match: RegExp; label: string; prefer: RegExp[] }[] = [
  { match: /^(k10temp|coretemp|zenpower)/, label: 'CPU', prefer: [/^Tdie$/, /^Tctl$/, /^Package/] },
  { match: /^(amdgpu|radeon|i915|xe|nouveau)/, label: 'GPU', prefer: [/^edge$/] },
  { match: /^acpitz/, label: 'Board', prefer: [] },
  { match: /^(mt7|iwlwifi|ath|rtw|brcm)/, label: 'WiFi', prefer: [] },
  { match: /^nvme/, label: 'SSD', prefer: [/^Composite$/] },
];

interface Sensor {
  id: string;
  label: string | undefined;
}

function chooseSensor(sensors: Sensor[], prefer: RegExp[]): Sensor | undefined {
  for (const re of prefer) {
    const hit = sensors.find((s) => s.label !== undefined && re.test(s.label));
    if (hit) return hit;
  }
  return sensors[0];
}

/** Millidegree limit file to °C, dropping nonsense such as the 65,261°C some NVMe drives report. */
async function readLimit(deps: SysfsDeps, path: string): Promise<number | undefined> {
  const raw = await readNum(deps, path);
  if (raw === undefined) return undefined;
  const c = raw / 1000;
  return c > 0 && c <= MAX_PLAUSIBLE ? c : undefined;
}

async function readChip(deps: SysfsDeps, dir: string): Promise<(TempReading & { rank: number }) | undefined> {
  const name = await readText(deps, `${dir}/name`);
  if (!name) return undefined;
  if (await isSuspended(deps, `${dir}/device`)) return undefined;
  const ids = (await listDir(deps, dir)).flatMap((f) => /^(temp\d+)_input$/.exec(f)?.[1] ?? []);
  if (ids.length === 0) return undefined;

  const rank = CHIPS.findIndex((c) => c.match.test(name));
  const chip = CHIPS[rank];
  const sensors = await Promise.all(
    ids.map(async (id) => ({ id, label: await readText(deps, `${dir}/${id}_label`) })),
  );
  const sensor = chooseSensor(sensors, chip?.prefer ?? []);
  if (!sensor) return undefined;

  const raw = await readNum(deps, `${dir}/${sensor.id}_input`);
  if (raw === undefined) return undefined;
  const celsius = raw / 1000;
  if (celsius < MIN_READING || celsius > MAX_PLAUSIBLE) return undefined;
  return {
    rank: chip ? rank : CHIPS.length,
    label: chip?.label ?? name,
    celsius,
    warn: await readLimit(deps, `${dir}/${sensor.id}_max`),
    crit: await readLimit(deps, `${dir}/${sensor.id}_crit`),
  };
}

/** One reading per temperature chip, in a stable display order. */
export async function readTemps(deps: SysfsDeps): Promise<TempReading[]> {
  const dirs = await listDir(deps, HWMON);
  const chips = await Promise.all(dirs.map((d) => readChip(deps, `${HWMON}/${d}`)));
  const seen = new Map<string, number>();
  return chips
    .filter((c) => c !== undefined)
    .sort((a, b) => a.rank - b.rank)
    .map(({ rank: _rank, label, ...rest }) => {
      const n = (seen.get(label) ?? 0) + 1;
      seen.set(label, n);
      return { label: n === 1 ? label : `${label}${n}`, ...rest };
    });
}
