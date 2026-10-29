import { trimSamples } from '../domain/burn-rate-formula.js';
import type { BurnWindowKind, Limit, LimitSample } from '../domain/types.js';

/** A reset time moving by more than this means a new limit window started. */
const NEW_WINDOW_MS = 60_000;

interface Buffer {
  resetsAt: number | undefined;
  samples: LimitSample[];
}

/** Per-kind buffers of limit utilization samples that feed burn-rate projections. */
export class LimitHistory {
  private readonly buffers: Record<BurnWindowKind, Buffer> = {
    block: { resetsAt: undefined, samples: [] },
    week: { resetsAt: undefined, samples: [] },
  };

  /** Records `limit` observed at `t`; no-op without a finite percent and reset time. */
  record(kind: BurnWindowKind, limit: Limit | undefined, t: number, now: number): void {
    const buf = this.buffers[kind];
    if (!limit || limit.resetsAt === undefined || !Number.isFinite(limit.percent) || !Number.isFinite(t)) {
      return;
    }
    if (buf.resetsAt !== undefined && Math.abs(limit.resetsAt - buf.resetsAt) > NEW_WINDOW_MS) {
      buf.samples = [];
    }
    buf.resetsAt = limit.resetsAt;
    if (!buf.samples.some((s) => s.t === t)) buf.samples.push({ t, pct: limit.percent });
    buf.samples = trimSamples(
      [...buf.samples].sort((a, b) => a.t - b.t),
      Math.max(now, t),
      kind,
    );
  }

  samples(kind: BurnWindowKind): readonly LimitSample[] {
    return this.buffers[kind].samples;
  }
}
