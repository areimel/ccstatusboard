import { z } from 'zod';
import type { ExtraUsage, Limit, LimitsState } from '../domain/types.js';
import { readCredentials as defaultReadCredentials, type CredentialsResult } from './credentials.js';

export const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';

const MIN_INTERVAL_S = 30;
const DEFAULT_RETRY_AFTER_S = 300;
const BACKOFF_BASE_MS = 60_000;
const BACKOFF_CAP_MS = 600_000;
const REQUEST_TIMEOUT_MS = 5_000;

// ---------- response parsing ----------

const nullableNum = z.number().nullable().optional().catch(undefined);
const nullableStr = z.string().nullable().optional().catch(undefined);

const bucketSchema = z
  .looseObject({ utilization: nullableNum, resets_at: nullableStr })
  .nullable()
  .optional()
  .catch(undefined);

const limitSchema = z.looseObject({
  kind: nullableStr,
  percent: nullableNum,
  resets_at: nullableStr,
  scope: z
    .looseObject({
      model: z.looseObject({ display_name: nullableStr }).nullable().optional().catch(undefined),
    })
    .nullable()
    .optional()
    .catch(undefined),
});

const responseSchema = z.looseObject({
  five_hour: bucketSchema,
  seven_day: bucketSchema,
  seven_day_sonnet: bucketSchema,
  seven_day_opus: bucketSchema,
  limits: z.array(limitSchema).nullable().optional().catch(undefined),
  extra_usage: z
    .looseObject({
      is_enabled: z.boolean().nullable().optional().catch(undefined),
      monthly_limit: nullableNum,
      used_credits: nullableNum,
      utilization: nullableNum,
      currency: nullableStr,
    })
    .nullable()
    .optional()
    .catch(undefined),
});

type Bucket = z.infer<typeof bucketSchema>;
type ApiLimit = z.infer<typeof limitSchema>;

function toMs(iso: string | null | undefined): number | undefined {
  if (!iso) return undefined;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? undefined : ms;
}

function makeLimit(label: string, percent: number, resetsAt: number | undefined): Limit {
  return resetsAt === undefined ? { label, percent } : { label, percent, resetsAt };
}

function fromBucket(label: string, b: Bucket): Limit | undefined {
  if (!b || typeof b.utilization !== 'number') return undefined;
  return makeLimit(label, b.utilization, toMs(b.resets_at));
}

function modelName(l: ApiLimit): string | undefined {
  const n = l.scope?.model?.display_name;
  return n ? n : undefined;
}

function isPlaceholder(l: ApiLimit): boolean {
  if (modelName(l)) return false;
  return (l.percent ?? 0) === 0 && !l.resets_at;
}

function fromApiLimit(label: string, l: ApiLimit | undefined): Limit | undefined {
  if (!l || isPlaceholder(l) || typeof l.percent !== 'number') return undefined;
  return makeLimit(label, l.percent, toMs(l.resets_at));
}

/** Flat bucket first; limits[] entry fills the value or a missing reset time. */
function pick(label: string, flat: Bucket, entry: ApiLimit | undefined): Limit | undefined {
  const a = fromBucket(label, flat);
  const b = fromApiLimit(label, entry);
  if (!a) return b;
  if (a.resetsAt === undefined && b?.resetsAt !== undefined) return { ...a, resetsAt: b.resetsAt };
  return a;
}

function familyLabel(displayName: string): string {
  const m = /(opus|sonnet|haiku|fable)/i.exec(displayName);
  if (!m) return displayName.trim();
  const f = m[1]!.toLowerCase();
  return f[0]!.toUpperCase() + f.slice(1);
}

export function parseUsageResponse(json: unknown): Omit<LimitsState, 'status' | 'fetchedAt'> {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return { perModelWeekly: [] };
  const parsed = responseSchema.safeParse(json);
  if (!parsed.success) return { perModelWeekly: [] };
  const r = parsed.data;
  const limits = r.limits ?? [];
  const byKind = (kind: string) => limits.find((l) => l.kind === kind);

  const out: Omit<LimitsState, 'status' | 'fetchedAt'> = { perModelWeekly: [] };
  const block = pick('5h', r.five_hour, byKind('session'));
  if (block) out.block = block;
  const weekly = pick('Week', r.seven_day, byKind('weekly_all'));
  if (weekly) out.weekly = weekly;

  const perModel = new Map<string, Limit>();
  const opus = fromBucket('Opus', r.seven_day_opus);
  if (opus) perModel.set('Opus', opus);
  const sonnet = fromBucket('Sonnet', r.seven_day_sonnet);
  if (sonnet) perModel.set('Sonnet', sonnet);
  for (const l of limits) {
    if (l.kind !== 'weekly_scoped') continue;
    const name = modelName(l);
    if (!name) continue;
    const label = familyLabel(name);
    if (perModel.has(label)) continue;
    const lim = fromApiLimit(label, l);
    if (lim) perModel.set(label, lim);
  }
  out.perModelWeekly = [...perModel.values()];

  const x = r.extra_usage;
  if (x && typeof x.is_enabled === 'boolean') {
    const extra: ExtraUsage = { enabled: x.is_enabled };
    if (typeof x.monthly_limit === 'number') extra.limitAmount = x.monthly_limit / 100;
    if (typeof x.used_credits === 'number') extra.usedAmount = x.used_credits / 100;
    if (typeof x.utilization === 'number') extra.percent = x.utilization;
    if (x.currency) extra.currency = x.currency;
    out.extra = extra;
  }
  return out;
}

// ---------- poller ----------

export interface UsagePollerDeps {
  fetch?: typeof fetch;
  readCredentials?: (claudeDir: string) => Promise<CredentialsResult>;
  now?: () => number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

export class UsagePoller {
  private readonly claudeDir: string;
  private readonly intervalMs: number;
  private readonly userAgent: string;
  private readonly enabled: boolean;
  private readonly onUpdate: (s: LimitsState) => void;
  private readonly fetchFn: typeof fetch;
  private readonly readCreds: (claudeDir: string) => Promise<CredentialsResult>;
  private readonly now: () => number;
  private readonly setT: (fn: () => void, ms: number) => unknown;
  private readonly clearT: (handle: unknown) => void;
  private lastGood: LimitsState | null = null;
  private failures = 0;
  private timer: unknown = null;
  private stopped = false;

  constructor(opts: {
    claudeDir: string;
    intervalSeconds: number;
    version: string;
    enabled: boolean;
    deps?: UsagePollerDeps;
    onUpdate: (s: LimitsState) => void;
  }) {
    const d = opts.deps ?? {};
    this.claudeDir = opts.claudeDir;
    this.intervalMs = Math.max(MIN_INTERVAL_S, opts.intervalSeconds) * 1000;
    this.userAgent = `ccstatusboard/${opts.version}`;
    this.enabled = opts.enabled;
    this.onUpdate = opts.onUpdate;
    this.fetchFn = d.fetch ?? fetch;
    this.readCreds = d.readCredentials ?? ((dir) => defaultReadCredentials(dir));
    this.now = d.now ?? Date.now;
    this.setT = d.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearT = d.clearTimeout ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  /** One poll. Emits a state and returns the delay in ms until the next poll. */
  async pollOnce(): Promise<number> {
    const creds = await this.readCreds(this.claudeDir);
    if (creds.kind === 'missing') {
      this.onUpdate({ status: 'no-credentials', perModelWeekly: [] });
      return this.intervalMs;
    }
    if (creds.kind === 'expired') {
      this.onUpdate({ ...(this.lastGood ?? { perModelWeekly: [] }), status: 'expired' });
      return this.intervalMs;
    }

    let res: Response;
    try {
      res = await this.fetchFn(USAGE_URL, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${creds.accessToken}`,
          'anthropic-beta': 'oauth-2025-04-20',
          'User-Agent': this.userAgent,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      return this.fail(err instanceof Error ? err.message : 'network error');
    }

    if (res.status === 429) {
      const ra = Number.parseInt(res.headers.get('retry-after') ?? '', 10);
      this.emitFailure('rate limited');
      return (Number.isFinite(ra) && ra >= 0 ? ra : DEFAULT_RETRY_AFTER_S) * 1000;
    }
    if (!res.ok) return this.fail(`HTTP ${res.status}`);

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      return this.fail('invalid JSON');
    }
    if (!json || typeof json !== 'object' || Array.isArray(json)) return this.fail('unexpected response');

    this.failures = 0;
    this.lastGood = { ...parseUsageResponse(json), status: 'ok', fetchedAt: this.now() };
    this.onUpdate(this.lastGood);
    return this.intervalMs;
  }

  private fail(error: string): number {
    this.failures += 1;
    this.emitFailure(error);
    return Math.min(BACKOFF_BASE_MS * 2 ** (this.failures - 1), BACKOFF_CAP_MS);
  }

  private emitFailure(error: string): void {
    if (this.lastGood) this.onUpdate({ ...this.lastGood, status: 'stale', error });
    else this.onUpdate({ status: 'error', perModelWeekly: [], error });
  }

  start(): void {
    this.stopped = false;
    if (!this.enabled) {
      this.onUpdate({ status: 'disabled', perModelWeekly: [] });
      return;
    }
    this.onUpdate({ status: 'loading', perModelWeekly: [] });
    const run = async (): Promise<void> => {
      let delay: number;
      try {
        delay = await this.pollOnce();
      } catch (err) {
        delay = this.fail(err instanceof Error ? err.message : 'poll failed');
      }
      if (!this.stopped) this.timer = this.setT(() => void run(), delay);
    };
    this.timer = this.setT(() => void run(), 0);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) this.clearT(this.timer);
    this.timer = null;
  }
}
