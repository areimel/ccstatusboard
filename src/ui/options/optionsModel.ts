import { configSchema } from '../../config/schema.js';
import { cycle } from '../../domain/cycle.js';
import { COLUMN_KEYS, SORT_KEYS, THEME_NAMES, type Config } from '../../domain/types.js';

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
      prefix?: string;
      suffix?: string;
    })
  | (Base & { kind: 'columns' })
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
  { key: 'columns', label: 'Columns', kind: 'columns' },
  { key: 'endedWindowHours', label: 'Ended window', kind: 'number', min: 0, step: 6, suffix: ' h' },
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

export function formatValue(config: Config, desc: OptionDescriptor): string {
  const v = config[desc.key];
  switch (desc.kind) {
    case 'bool':
      return v ? 'on' : 'off';
    case 'columns':
      return `${config.columns.length}/${COLUMN_KEYS.length} shown`;
    case 'number':
      return v === null ? 'unset' : `${desc.prefix ?? ''}${String(v)}${desc.suffix ?? ''}`;
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
  } else if (desc.kind === 'number') {
    const cur = config[key] as number | null;
    let next: number | null;
    if (cur === null) next = dir === 1 ? desc.min : null;
    else if (dir === 1) next = cur + desc.step;
    else next = cur - desc.step < desc.min ? (desc.nullable ? null : desc.min) : cur - desc.step;
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

function base(): Config {
  return configSchema.parse({});
}

/** Text to prefill the number editor with. */
export function editText(config: Config, desc: OptionDescriptor): string {
  const v = config[desc.key];
  return typeof v === 'number' ? String(v) : '';
}
