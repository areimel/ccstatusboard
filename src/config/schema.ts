import { z } from 'zod';
import { COLUMN_KEYS, SORT_KEYS, THEME_NAMES, type ColumnKey, type Config } from '../domain/types.js';

const DEFAULT_COLUMNS: ColumnKey[] = COLUMN_KEYS.filter((c) => c !== 'branch');

export const DEFAULT_CONFIG: Config = Object.freeze({
  theme: 'default',
  refreshMs: 1000,
  usagePollSeconds: 60,
  endedWindowHours: 0,
  idleCutoffMinutes: 60,
  columns: [...DEFAULT_COLUMNS],
  sort: 'project',
  showDetail: true,
  claudeDir: null,
  usageApi: true,
  subscriptionUSD: null,
  showSystem: true,
}) as Config;

export const configSchema = z.strictObject({
  theme: z.enum(THEME_NAMES).default(DEFAULT_CONFIG.theme),
  // Upper bounds keep timer delays below the 2^31-1 ms limit (larger values fire immediately).
  refreshMs: z.number().int().min(250).max(60_000).default(DEFAULT_CONFIG.refreshMs),
  usagePollSeconds: z.number().int().min(30).max(86_400).default(DEFAULT_CONFIG.usagePollSeconds),
  endedWindowHours: z.number().min(0).default(DEFAULT_CONFIG.endedWindowHours),
  idleCutoffMinutes: z.number().int().min(1).max(10_080).default(DEFAULT_CONFIG.idleCutoffMinutes),
  columns: z
    .array(z.enum(COLUMN_KEYS))
    .min(1)
    .default(() => [...DEFAULT_COLUMNS]),
  sort: z.enum(SORT_KEYS).default(DEFAULT_CONFIG.sort),
  showDetail: z.boolean().default(DEFAULT_CONFIG.showDetail),
  claudeDir: z.string().nullable().default(DEFAULT_CONFIG.claudeDir),
  usageApi: z.boolean().default(DEFAULT_CONFIG.usageApi),
  subscriptionUSD: z.number().positive().nullable().default(DEFAULT_CONFIG.subscriptionUSD),
  showSystem: z.boolean().default(DEFAULT_CONFIG.showSystem),
}) satisfies z.ZodType<Config>;
