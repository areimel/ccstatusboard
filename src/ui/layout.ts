import { useEffect, useState } from 'react';
import { useStdout } from 'ink';

export const MIN_COLUMNS = 60;
export const MIN_ROWS = 16;
export const DETAIL_MIN_ROWS = 24;
export const SYSTEM_MIN_ROWS = 30;
export const DETAIL_ROWS = 6;
export const TABLE_CHROME_ROWS = 3;
export const FOOTER_ROWS = 1;
export const SPARE_ROWS = 1;
/** At this width the System panel adds a third column; below it, extras stack as rows. */
export const SYSTEM_WIDE_COLUMNS = 100;
/** Session rows the System panel's optional groups must leave free. */
export const MIN_SESSION_ROWS = 3;

/** Panel inner width and left-column width beside a fixed-width right column. */
export function splitColumns(
  width: number,
  rightWidth: number,
  gap = 2,
): { inner: number; leftWidth: number } {
  const inner = Math.max(20, width - 4);
  return { inner, leftWidth: Math.max(20, inner - rightWidth - gap) };
}

export interface PanelRows {
  rows: number;
}

export interface LayoutInput {
  rows: number;
  columns: number;
  showDetail: boolean;
  /** Fixed-height panels above the table (header, usage, system, ...). */
  panels: PanelRows[];
}

export interface Layout {
  tooSmall: boolean;
  detailShown: boolean;
  maxRows: number;
  fixedRows: number;
}

export function computeLayout({ rows, columns, showDetail, panels }: LayoutInput): Layout {
  const tooSmall = columns < MIN_COLUMNS || rows < MIN_ROWS;
  // panels + table borders (2) + table header (1) + footer (1) + 1 spare row,
  // so the frame stays strictly shorter than the terminal (Ink full-clears at exact height).
  const fixedRows = panels.reduce((n, p) => n + p.rows, 0) + TABLE_CHROME_ROWS + FOOTER_ROWS + SPARE_ROWS;
  const detailShown = showDetail && rows >= DETAIL_MIN_ROWS && rows - fixedRows - DETAIL_ROWS >= 1;
  const maxRows = Math.max(1, rows - fixedRows - (detailShown ? DETAIL_ROWS : 0));
  return { tooSmall, detailShown, maxRows, fixedRows };
}

/** Most rows the System panel may use while leaving the Detail pane and minimum session rows. */
export function systemPanelBudget(rows: number, otherPanelRows: number, showDetail: boolean): number {
  const detail = showDetail && rows >= DETAIL_MIN_ROWS ? DETAIL_ROWS : 0;
  return rows - otherPanelRows - TABLE_CHROME_ROWS - FOOTER_ROWS - SPARE_ROWS - detail - MIN_SESSION_ROWS;
}

export function useTerminalSize(override?: { columns: number; rows: number }): {
  columns: number;
  rows: number;
} {
  const { stdout } = useStdout();
  const read = () => ({ columns: stdout.columns || 80, rows: stdout.rows || 24 });
  const [size, setSize] = useState(read);
  useEffect(() => {
    if (override) return;
    const onResize = () => setSize(read());
    stdout.on('resize', onResize);
    return () => {
      stdout.off('resize', onResize);
    };
  }, [stdout, override]);
  return override ?? size;
}
