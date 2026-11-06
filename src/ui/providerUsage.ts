import { emptyWindowTotals } from '../domain/types.js';
import type { Config, Provider, Snapshot } from '../domain/types.js';
import type { ProviderFilter } from './uiState.js';
import {
  DETAIL_MIN_ROWS,
  DETAIL_ROWS,
  FOOTER_ROWS,
  MIN_SESSION_ROWS,
  SPARE_ROWS,
  TABLE_CHROME_ROWS,
} from './layout.js';
import { usagePanelRows } from './UsagePanel.js';

export type UsageSnapshot = Snapshot & {
  accountingIncomplete?: boolean;
  hideBurn?: boolean;
  hiddenLimitCount?: number;
};
export interface UsageEntry {
  provider: Provider;
  snapshot: UsageSnapshot;
  subscriptionUSD: number | null;
  width: number;
}

export function providerUsage(snapshot: Snapshot, provider: Provider): UsageSnapshot {
  const data = snapshot.providers?.[provider];
  if (data)
    return {
      ...snapshot,
      ...data,
      accountingIncomplete: data.accountingIncomplete || data.unknownModels.length > 0,
    };
  if (provider === 'claude' && !snapshot.providers) return snapshot;
  const empty = () => ({ ...emptyWindowTotals(), costUSD: null });
  return {
    ...snapshot,
    limits: { status: 'error', perModelWeekly: [] },
    costs: {
      block: empty(),
      today: empty(),
      week: empty(),
      month: empty(),
      burnRatePerHour: null,
      hourlySparkline: [],
    },
    scan: { done: true, filesDone: 0, filesTotal: 0 },
    burn: {},
    unknownModels: [],
    pricingStatus: 'unavailable',
  };
}

/** Keep three session rows and the requested detail pane before stacking usage panels. */
export function usageLayout(
  snapshot: Snapshot,
  config: Config,
  filter: ProviderFilter,
  selected: Provider,
  columns: number,
  rows: number,
  headerRows: number,
): { entries: UsageEntry[]; horizontal: boolean; height: number } {
  const available = (['claude', 'codex'] as const).filter((p) =>
    snapshot.providers ? snapshot.providers[p]?.enabled && snapshot.providers[p]?.found : p === 'claude',
  );
  const providers: Provider[] =
    filter !== 'all'
      ? [filter]
      : available.length
        ? [...available]
        : config.providers?.includes('codex') && !config.providers.includes('claude')
          ? ['codex']
          : ['claude'];
  const make = (provider: Provider, width: number): UsageEntry => ({
    provider,
    snapshot: providerUsage(snapshot, provider),
    subscriptionUSD: provider === 'codex' ? config.codexSubscriptionUSD : config.subscriptionUSD,
    width,
  });
  let horizontal = providers.length > 1 && columns >= 122;
  let entries = providers.map((p, i) =>
    make(p, horizontal ? (i === 0 ? Math.floor((columns - 2) / 2) : Math.ceil((columns - 2) / 2)) : columns),
  );
  const heights = entries.map((e) => usagePanelRows(e.snapshot, e.subscriptionUSD, e.provider));
  let height = horizontal ? Math.max(...heights) : heights.reduce((a, b) => a + b, 0);
  const detail = config.showDetail && rows >= DETAIL_MIN_ROWS ? DETAIL_ROWS : 0;
  const budget = rows - headerRows - FOOTER_ROWS - SPARE_ROWS - TABLE_CHROME_ROWS - MIN_SESSION_ROWS - detail;
  if (!horizontal && entries.length > 1 && height > budget) {
    const provider = providers.includes(selected) ? selected : providers[0]!;
    entries = [make(provider, columns)];
    height = usagePanelRows(entries[0]!.snapshot, entries[0]!.subscriptionUSD, provider);
    horizontal = false;
  }
  if (entries.length === 1 || horizontal) {
    entries = entries.map((entry) => compactUsage(entry, Math.max(6, budget)));
    height = Math.max(
      ...entries.map((entry) => usagePanelRows(entry.snapshot, entry.subscriptionUSD, entry.provider)),
    );
  }
  return { entries, horizontal, height };
}

function compactUsage(entry: UsageEntry, budget: number): UsageEntry {
  if (usagePanelRows(entry.snapshot, entry.subscriptionUSD, entry.provider) <= budget) return entry;
  const snapshot: UsageSnapshot = { ...entry.snapshot, hideBurn: true, limits: { ...entry.snapshot.limits } };
  while (usagePanelRows(snapshot, entry.subscriptionUSD, entry.provider) > budget) {
    if (snapshot.limits.windows && snapshot.limits.windows.length > 1)
      snapshot.limits.windows = snapshot.limits.windows.slice(0, -1);
    else if (snapshot.limits.perModelWeekly.length)
      snapshot.limits.perModelWeekly = snapshot.limits.perModelWeekly.slice(0, -1);
    else break;
    snapshot.hiddenLimitCount = (snapshot.hiddenLimitCount ?? 0) + 1;
  }
  return { ...entry, snapshot };
}
