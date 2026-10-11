import { z } from 'zod';
import type { ColumnKey, Config } from '../domain/types.js';

const ALL_COLUMNS: readonly ColumnKey[] = [
  'status',
  'name',
  'model',
  'branch',
  'ctx',
  'cost',
  'last',
  'uptime',
];

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
}) as Config;

export const configSchema = z.strictObject({
  theme: z.enum(['default', 'mono', 'dracula', 'solarized']).default(DEFAULT_CONFIG.theme),
  refreshMs: z.number().int().min(250).default(DEFAULT_CONFIG.refreshMs),
  usagePollSeconds: z.number().int().min(30).default(DEFAULT_CONFIG.usagePollSeconds),
  endedWindowHours: z.number().min(0).default(DEFAULT_CONFIG.endedWindowHours),
  columns: z
    .array(z.enum(['status', 'name', 'model', 'branch', 'ctx', 'cost', 'last', 'uptime']))
    .min(1)
    .default(() => [...ALL_COLUMNS]),
  sort: z.enum(['status', 'activity', 'cost', 'ctx', 'name']).default(DEFAULT_CONFIG.sort),
  showDetail: z.boolean().default(DEFAULT_CONFIG.showDetail),
  claudeDir: z.string().nullable().default(DEFAULT_CONFIG.claudeDir),
  usageApi: z.boolean().default(DEFAULT_CONFIG.usageApi),
}) satisfies z.ZodType<Config>;
