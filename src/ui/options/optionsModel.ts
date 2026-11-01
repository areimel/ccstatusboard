import { configSchema } from '../../config/schema.js';
import { cycle } from '../../domain/cycle.js';
import { COLUMN_KEYS, SORT_KEYS, SYSTEM_METRIC_KEYS, THEME_NAMES, type Config } from '../../domain/types.js';

interface Base {
  key: keyof Config;
  label: string;
}
export type OptionDescriptor =
  | (Base & { kind: 'enum'; values: readonly string[] })
  | (Base & { kind: 'bool' })
  | (Base & {
      kind: 'number';
      min: number;
      step: number;
      /** Stepping below `min` yields null ("unset"). */
      nullable?: boolean;
      /** Display text used instead of `<value><suffix>` when the value is 0. */
      zeroLabel?: string;
      prefix?: string;
      suffix?: string;
    })
  /** Whole minutes, edited and displayed as e.g. `1h 30m`. */
  | (Base & { kind: 'duration'; min: number; step: number })
  | (Base & { kind: 'columns' })
  | (Base & { kind: 'metrics' })
  | (Base & { kind: 'readonly' });

export const OPTIONS: OptionDescriptor[] = [
  { key: 'theme', label: 'Theme', kind: 'enum', values: THEME_NAMES },
  {
    key: 'subscriptionUSD',
    label: 'Subscription',
    kind: 'number',
    min: 10,
    step: 10,
    nullable: true,
    prefix: '$',
    suffix: '/mo',
  },
  { key: 'sort', label: 'Sort', kind: 'enum', values: SORT_KEYS },
  { key: 'showDetail', label: 'Detail pane', kind: 'bool' },
  { key: 'showSystem', label: 'System panel', kind: 'bool' },
  { key: 'systemMetrics', label: 'System metrics', kind: 'metrics' },
  { key: 'columns', label: 'Columns', kind: 'columns' },
  { key: 'idleCutoffMinutes', label: 'Dim idle after', kind: 'duration', min: 1, step: 15 },
  {
    key: 'endedWindowHours',
    label: 'Keep exited',
    kind: 'number',
    min: 0,
    step: 1,
    zeroLabel: 'off',
    suffix: ' h',
  },
  { key: 'refreshMs', label: 'Refresh', kind: 'number', min: 250, step: 250, suffix: ' ms' },
  { key: 'usagePollSeconds', label: 'Usage poll', kind: 'number', min: 30, step: 30, suffix: ' s' },
  { key: 'claudeDir', label: 'Claude dir', kind: 'readonly' },
  { key: 'usageApi', label: 'Usage API', kind: 'readonly' },
];

export function findOption(key: keyof Config): OptionDescriptor | undefined {
  return OPTIONS.find((o) => o.key === key);
}

/** Whether `config` with `patch` applied still satisfies the config schema. */
export function isValidPatch(config: Config, patch: Partial<Config>): boolean {
  return configSchema.safeParse({ ...config, ...patch }).success;
}

/** Formats whole minutes as `45m`, `1h`, `1h 30m`. */
export function formatMinutes(m: number): string {
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r}m`;
  if (r === 0) return `${h}h`;
  return `${h}h ${r}m`;
}

export function formatValue(config: Config, desc: OptionDescriptor): string {
  const v = config[desc.key];
  switch (desc.kind) {
    case 'bool':
      return v ? 'on' : 'off';
    case 'columns':
      return `${config.columns.length}/${COLUMN_KEYS.length} shown`;
    case 'metrics':
      return `${config.systemMetrics.length}/${SYSTEM_METRIC_KEYS.length} shown`;
    case 'duration':
      return formatMinutes(v as number);
    case 'number':
      if (v === null) return 'unset';
      if (v === 0 && desc.zeroLabel !== undefined) return desc.zeroLabel;
      return `${desc.prefix ?? ''}${String(v)}${desc.suffix ?? ''}`;
    case 'readonly':
      if (typeof v === 'boolean') return v ? 'on' : 'off';
      return v === null ? 'auto' : String(v);
    default:
      return String(v);
  }
}

/** Patch for stepping option `key` one step; {} when not steppable or the result is invalid. */
export function adjust(config: Config, key: keyof Config, dir: 1 | -1): Partial<Config> {
  const desc = findOption(key);
  if (!desc) return {};
  let patch: Partial<Config> = {};
  if (desc.kind === 'enum') {
    patch = { [key]: cycle(desc.values, config[key] as string, dir) };
  } else if (desc.kind === 'bool') {
    patch = { [key]: !config[key] };
  } else if (desc.kind === 'number' || desc.kind === 'duration') {
    const cur = config[key] as number | null;
    let next: number | null;
    if (cur === null) next = dir === 1 ? desc.min : null;
    else if (dir === 1) next = cur + desc.step;
    else
      next =
        cur - desc.step < desc.min
          ? desc.kind === 'number' && desc.nullable
            ? null
            : desc.min
          : cur - desc.step;
    if (next === cur) return {};
    patch = { [key]: next };
  }
  return isValidPatch(config, patch) ? patch : {};
}

/** Parse typed numeric input: number, null (nullable + empty), or undefined when invalid. */
export function parseNumberInput(desc: OptionDescriptor, text: string): number | null | undefined {
  if (desc.kind !== 'number') return undefined;
  const t = text.trim().replace(/^\$/, '');
  if (t === '') return desc.nullable ? null : undefined;
  if (!/^\d+(\.\d+)?$/.test(t)) return undefined;
  const n = Number(t);
  const probe = { ...base(), [desc.key]: n };
  return configSchema.safeParse(probe).success ? n : undefined;
}

const NUM = '(\\d+(?:\\.\\d+)?)';
const MINUTES_RE = new RegExp(`^${NUM}\\s*m?$`);
const HOURS_RE = new RegExp(`^${NUM}\\s*h$`);
const HOURS_MINUTES_RE = /^(\d+)\s*h\s*(\d+)\s*m$/;

/**
 * Parse typed duration input into whole minutes: `45` or `45m` (minutes), `2h`, `1.5h`,
 * `1h 30m` / `1h30m`. Case-insensitive. Undefined when unparseable, non-integer minutes,
 * or outside the config schema's range.
 */
export function parseDurationInput(text: string): number | undefined {
  const t = text.trim().toLowerCase();
  let total: number | undefined;
  let m: RegExpMatchArray | null;
  if ((m = MINUTES_RE.exec(t))) total = Number(m[1]);
  else if ((m = HOURS_RE.exec(t))) total = Number(m[1]) * 60;
  else if ((m = HOURS_MINUTES_RE.exec(t))) total = Number(m[1]) * 60 + Number(m[2]);
  if (total === undefined) return undefined;
  // Round away float noise (e.g. 1.1h * 60) before the integer check.
  const minutes = Math.round(total * 1e6) / 1e6;
  if (!Number.isInteger(minutes)) return undefined;
  const probe = { ...base(), idleCutoffMinutes: minutes };
  return configSchema.safeParse(probe).success ? minutes : undefined;
}

function base(): Config {
  return configSchema.parse({});
}

/** Text to prefill the number or duration editor with. */
export function editText(config: Config, desc: OptionDescriptor): string {
  const v = config[desc.key];
  if (typeof v !== 'number') return '';
  return desc.kind === 'duration' ? formatMinutes(v) : String(v);
}
