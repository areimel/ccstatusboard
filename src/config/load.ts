import { readFile as fsReadFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { configDir } from '../core/paths.js';
import type { Config } from '../domain/types.js';
import { configSchema } from './schema.js';

export interface CliFlags {
  theme?: string;
  refresh?: string;
  endedHours?: string;
  sort?: string;
  claudeDir?: string;
  usageApi?: boolean;
  config?: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

function isEnoent(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'ENOENT';
}

async function readConfigFile(
  path: string,
  explicit: boolean,
  readFile: (p: string) => Promise<string>,
): Promise<Record<string, unknown>> {
  let text: string;
  try {
    text = await readFile(path);
  } catch (e) {
    if (isEnoent(e) && !explicit) return {};
    throw new ConfigError(`Cannot read config file ${path}: ${(e as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new ConfigError(`Invalid JSON in ${path}: ${(e as Error).message}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ConfigError(`Config file ${path} must contain a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function flagOverrides(flags: CliFlags): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  if (flags.theme !== undefined) o.theme = flags.theme;
  if (flags.refresh !== undefined) o.refreshMs = Number(flags.refresh);
  if (flags.endedHours !== undefined) o.endedWindowHours = Number(flags.endedHours);
  if (flags.sort !== undefined) o.sort = flags.sort;
  if (flags.claudeDir !== undefined) o.claudeDir = flags.claudeDir;
  if (flags.usageApi !== undefined) o.usageApi = flags.usageApi;
  return o;
}

export async function loadConfig(opts: {
  flags: CliFlags;
  env?: NodeJS.ProcessEnv;
  home?: string;
  readFile?: (p: string) => Promise<string>;
}): Promise<Config> {
  const readFile = opts.readFile ?? ((p: string) => fsReadFile(p, 'utf8'));
  const explicit = opts.flags.config !== undefined;
  const path = opts.flags.config ?? join(configDir(opts.env, opts.home), 'config.json');
  const fileValues = await readConfigFile(path, explicit, readFile);
  const result = configSchema.safeParse({ ...fileValues, ...flagOverrides(opts.flags) });
  if (!result.success) {
    throw new ConfigError(`Invalid configuration (${path}):\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

export function parseCliArgs(argv: string[]): { flags: CliFlags; help: boolean; version: boolean } {
  let values: Record<string, string | boolean | undefined>;
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: {
        theme: { type: 'string' },
        refresh: { type: 'string' },
        'ended-hours': { type: 'string' },
        sort: { type: 'string' },
        'claude-dir': { type: 'string' },
        'no-usage-api': { type: 'boolean' },
        config: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    }));
  } catch (e) {
    throw new ConfigError((e as Error).message);
  }
  const flags: CliFlags = {};
  const str = (k: string): string | undefined =>
    typeof values[k] === 'string' ? (values[k] as string) : undefined;
  const set = <K extends keyof CliFlags>(key: K, v: CliFlags[K] | undefined): void => {
    if (v !== undefined) flags[key] = v;
  };
  set('theme', str('theme'));
  set('refresh', str('refresh'));
  set('endedHours', str('ended-hours'));
  set('sort', str('sort'));
  set('claudeDir', str('claude-dir'));
  set('config', str('config'));
  if (values['no-usage-api'] === true) flags.usageApi = false;
  return { flags, help: values.help === true, version: values.version === true };
}
