import { z } from 'zod';
import { COLUMN_KEYS, SORT_KEYS, THEME_NAMES, type Config } from '../domain/types.js';

const ALL_COLUMNS = COLUMN_KEYS;

export const DEFAULT_CONFIG: Config = Object.freeze({
  theme: 'default',
  refreshMs: 1000,
  usagePollSeconds: 60,
  endedWindowHours: 24,
  columns: [...ALL_COLUMNS],
  sort: 'status',
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
  columns: z
    .array(z.enum(COLUMN_KEYS))
    .min(1)
    .default(() => [...ALL_COLUMNS]),
  sort: z.enum(SORT_KEYS).default(DEFAULT_CONFIG.sort),
  showDetail: z.boolean().default(DEFAULT_CONFIG.showDetail),
  claudeDir: z.string().nullable().default(DEFAULT_CONFIG.claudeDir),
  usageApi: z.boolean().default(DEFAULT_CONFIG.usageApi),
  subscriptionUSD: z.number().positive().nullable().default(DEFAULT_CONFIG.subscriptionUSD),
  showSystem: z.boolean().default(DEFAULT_CONFIG.showSystem),
}) satisfies z.ZodType<Config>;
