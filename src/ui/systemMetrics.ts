import {
  displayWidth,
  formatBytes,
  formatDuration,
  formatPercent,
  formatRate,
  truncateDisplay,
} from '../domain/format.js';
import {
  SYSTEM_METRIC_KEYS,
  type SystemMetricKey,
  type SystemStats,
  type TempReading,
} from '../domain/types.js';
import { SYSTEM_WIDE_COLUMNS, splitColumns } from './layout.js';

/** Width of the network column. */
export const SYSTEM_MIDDLE_WIDTH = 26;
const NET_BASE_ROWS = 3; // rx, tx, cores
const THIRD_MIN_WIDTH = 30;
const THIRD_MAX_WIDTH = 44;
const SEGMENT_GAP = 2;
const COLUMN_GAP = 2;
const TITLE_WIDTH = 5;
const TEMPS_ROWS = 2;
const CHIPS_ROWS = 2;
const NETWORK_ROWS = 2;
/** First to go when the terminal runs out of height. */
const DROP_ORDER: SystemMetricKey[] = ['network', 'pressure', 'chips', 'power', 'temps'];

export interface Segment {
  label?: string;
  value: string;
  /** Colors the value by level. */
  heat?: { value: number; thresholds: [number, number] };
  /** Renders as a row heading. */
  title?: boolean;
}
export type Row = Segment[];

export interface SystemLayout {
  /** Width of the third column; 0 when it is not drawn. */
  thirdWidth: number;
  /** Rows under the meters. */
  left: Row[];
  /** Rows under rx, tx and cores. */
  middle: Row[];
  /** Third column rows. */
  right: Row[];
  /** Full-width rows under the columns, for narrow terminals. */
  below: Row[];
}

const segmentText = (s: Segment): string => (s.label === undefined ? s.value : `${s.label} ${s.value}`);

export const rowText = (row: Row): string => row.map(segmentText).join(' '.repeat(SEGMENT_GAP));

/** Flows segments across exactly `count` rows. What doesn't fit is dropped, so height never changes. */
export function fillRows(segments: Segment[], width: number, count: number): Row[] {
  const rows: Row[] = Array.from({ length: count }, () => []);
  let r = 0;
  let used = 0;
  for (const seg of segments) {
    if (r >= count) break;
    let w = displayWidth(segmentText(seg));
    if (used > 0 && used + SEGMENT_GAP + w > width) {
      r++;
      used = 0;
      if (r >= count) break;
    }
    let placed = seg;
    if (w > width) {
      const room = width - (seg.label === undefined ? 0 : displayWidth(seg.label) + 1);
      placed = { ...seg, value: truncateDisplay(seg.value, room) };
      w = width;
    }
    rows[r]!.push(placed);
    used += (used > 0 ? SEGMENT_GAP : 0) + w;
  }
  return rows;
}

export function tempThresholds(t: TempReading): [number, number] {
  const hot = /^(CPU|GPU)/.test(t.label);
  const crit = t.crit ?? (hot ? 95 : 85);
  const warn = t.warn ?? (hot ? 85 : 70);
  return [Math.min(warn, crit), crit];
}

const trimZero = (s: string): string => s.replace(/\.0$/, '');
const formatHz = (hz: number): string =>
  hz >= 1e9 ? `${(hz / 1e9).toFixed(2)}GHz` : `${Math.round(hz / 1e6)}MHz`;

/** Adds `seg` only when its reading exists, so a missing metric is omitted, never shown as a dash. */
const when = <T>(v: T | undefined, seg: (v: T) => Segment): Segment[] => (v === undefined ? [] : [seg(v)]);

function tempSegments(s: SystemStats): Segment[] {
  return (s.temps ?? []).map((t) => ({
    label: t.label,
    value: `${Math.round(t.celsius)}°`,
    heat: { value: t.celsius, thresholds: tempThresholds(t) },
  }));
}

function batteryState(status: string, hasWatts: boolean): Segment[] {
  if (status === 'Charging') return [{ value: 'chg' }];
  if (status === 'Full' || status === 'Not charging') return [{ value: 'AC' }];
  if (status === 'Discharging' && !hasWatts) return [{ value: 'bat' }];
  return [];
}

/** Ordered by importance, because the end of the row is dropped first. */
function powerSegments(s: SystemStats): Segment[] {
  const b = s.battery;
  const percent: Segment[] = !b
    ? []
    : [
        {
          value: formatPercent(b.percent),
          // Only a low battery that is draining needs attention.
          ...(b.status === 'Discharging'
            ? { heat: { value: 100 - b.percent, thresholds: [80, 90] as [number, number] } }
            : {}),
        },
      ];
  return [
    ...percent,
    ...(b ? batteryState(b.status, b.watts !== undefined) : []),
    ...when(b?.watts, (w) => ({ value: `${w.toFixed(1)}W` })),
    ...when(b?.secondsLeft, (sec) => ({ value: formatDuration(sec * 1000) })),
    ...when(s.uptimeSec, (up) => ({ label: 'up', value: formatDuration(up * 1000) })),
    ...when(b?.healthPercent, (h) => ({ label: 'health', value: formatPercent(h) })),
    ...when(b?.cycles, (c) => ({ value: `${c}cyc` })),
  ];
}

function chipSegments(s: SystemStats): Segment[] {
  const g = s.gpu;
  return [
    ...when(s.cpuFreq, (f) => ({ value: formatHz(f.curHz) })),
    ...when(s.powerProfile, (p) => ({ value: p })),
    ...when(g?.busyPercent, (b) => ({ label: 'GPU', value: formatPercent(b) })),
    ...when(g?.vramUsed, (v) => ({ label: 'VRAM', value: formatBytes(v) })),
    ...when(g?.clockHz, (hz) => ({ value: formatHz(hz) })),
    ...when(g?.watts, (w) => ({ value: `${Math.round(w)}W` })),
  ];
}

function pressureSegments(s: SystemStats): Segment[] {
  const stall = (label: string, pct: number | undefined): Segment[] =>
    when(pct, (p) => ({
      label,
      value: `${trimZero(p.toFixed(1))}%`,
      heat: { value: p, thresholds: [10, 30] },
    }));
  return [...stall('mem', s.pressure?.mem), ...stall('cpu', s.pressure?.cpu), ...stall('io', s.pressure?.io)];
}

function diskSegments(s: SystemStats): Segment[] {
  return [
    ...when(s.diskIo, (d) => ({ label: 'R', value: formatRate(d.readPerSec) })),
    ...when(s.diskIo, (d) => ({ label: 'W', value: formatRate(d.writePerSec) })),
    ...when(s.procs?.processes, (p) => ({ value: `${p}p` })),
    ...when(s.procs?.threads, (t) => ({ value: `${t}t` })),
  ];
}

function networkSegments(s: SystemStats): Segment[] {
  const l = s.link;
  return [
    { value: l?.iface ?? 'offline' },
    ...when(l?.signalDbm, (d) => ({ value: `${Math.round(d)}dBm` })),
    ...when(l?.ip, (ip) => ({ value: ip })),
    ...when(l?.vpn, (v) => ({ value: v })),
  ];
}

const groupSegments: Record<SystemMetricKey, (s: SystemStats) => Segment[]> = {
  temps: tempSegments,
  power: powerSegments,
  chips: chipSegments,
  pressure: (s) => [...pressureSegments(s), ...diskSegments(s)],
  network: networkSegments,
};

const TITLES: Record<SystemMetricKey, string> = {
  temps: 'Temp',
  power: 'Power',
  chips: 'Chip',
  pressure: 'Press',
  network: 'Link',
};

const hasData: Record<SystemMetricKey, (s: SystemStats) => boolean> = {
  temps: (s) => (s.temps?.length ?? 0) > 0,
  power: (s) => s.battery !== undefined || s.uptimeSec !== undefined,
  chips: (s) => s.cpuFreq !== undefined || s.powerProfile !== undefined || s.gpu !== undefined,
  pressure: (s) => s.pressure !== undefined || s.diskIo !== undefined || s.procs !== undefined,
  network: (s) => s.link !== undefined,
};

const isWide = (columns: number): boolean => columns >= SYSTEM_WIDE_COLUMNS;
const meterRowCount = (s: SystemStats): number => (s.swap.total > 0 ? 4 : 3);

/** Rows inside the panel border: the tallest column, plus stacked rows when narrow. */
export function systemContentRows(s: SystemStats, groups: SystemMetricKey[], columns: number): number {
  const on = (k: SystemMetricKey, n: number): number => (groups.includes(k) ? n : 0);
  const meters = meterRowCount(s);
  if (!isWide(columns)) return Math.max(meters, NET_BASE_ROWS) + groups.length;
  return Math.max(
    meters + on('pressure', 1),
    NET_BASE_ROWS + on('network', NETWORK_ROWS) + on('pressure', 1),
    on('temps', TEMPS_ROWS) + on('power', 1) + on('chips', CHIPS_ROWS),
  );
}

/**
 * The groups to draw: enabled, with data on this machine, and fitting `maxPanelRows`.
 * Slots depend only on these inputs, never on live values, so the panel holds its height.
 */
export function visibleSystemGroups(
  s: SystemStats,
  metrics: SystemMetricKey[],
  columns: number,
  maxPanelRows: number,
): SystemMetricKey[] {
  const canonical = (keys: SystemMetricKey[]): SystemMetricKey[] =>
    SYSTEM_METRIC_KEYS.filter((k) => keys.includes(k));
  const fits = (keys: SystemMetricKey[]): boolean => 2 + systemContentRows(s, keys, columns) <= maxPanelRows;

  let kept = canonical(metrics).filter((k) => hasData[k](s));
  const dropped: SystemMetricKey[] = [];
  for (const k of DROP_ORDER) {
    if (fits(kept)) break;
    if (!kept.includes(k)) continue;
    kept = kept.filter((g) => g !== k);
    dropped.push(k);
  }
  // A later drop can make room that an earlier one no longer needed; take those back, best first.
  for (const k of dropped.reverse()) {
    if (fits(canonical([...kept, k]))) kept = canonical([...kept, k]);
  }
  return kept;
}

export function buildSystemLayout(s: SystemStats, groups: SystemMetricKey[], columns: number): SystemLayout {
  const on = (k: SystemMetricKey): boolean => groups.includes(k);
  if (!isWide(columns)) {
    const inner = splitColumns(columns, 0).inner;
    return {
      thirdWidth: 0,
      left: [],
      middle: [],
      right: [],
      below: groups.map((k) => {
        const title: Segment = { value: TITLES[k].padEnd(TITLE_WIDTH), title: true };
        return [title, ...fillRows(groupSegments[k](s), inner - TITLE_WIDTH - SEGMENT_GAP, 1)[0]!];
      }),
    };
  }

  const hasThird = on('temps') || on('power') || on('chips');
  const thirdWidth = hasThird
    ? Math.min(THIRD_MAX_WIDTH, THIRD_MIN_WIDTH + Math.floor((columns - SYSTEM_WIDE_COLUMNS) / 2))
    : 0;
  const { leftWidth } = splitColumns(columns, SYSTEM_MIDDLE_WIDTH + (hasThird ? COLUMN_GAP + thirdWidth : 0));
  const title: Segment = { value: TITLES.pressure, title: true };
  return {
    thirdWidth,
    left: on('pressure') ? fillRows([title, ...pressureSegments(s)], leftWidth, 1) : [],
    middle: [
      ...(on('network') ? fillRows(networkSegments(s), SYSTEM_MIDDLE_WIDTH, NETWORK_ROWS) : []),
      ...(on('pressure') ? fillRows(diskSegments(s), SYSTEM_MIDDLE_WIDTH, 1) : []),
    ],
    right: [
      ...(on('temps') ? fillRows(tempSegments(s), thirdWidth, TEMPS_ROWS) : []),
      ...(on('power') ? fillRows(powerSegments(s), thirdWidth, 1) : []),
      ...(on('chips') ? fillRows(chipSegments(s), thirdWidth, CHIPS_ROWS) : []),
    ],
    below: [],
  };
}
