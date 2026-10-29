import { useEffect, useState } from 'react';
import { useStdout } from 'ink';

export const MIN_COLUMNS = 60;
export const MIN_ROWS = 16;
export const DETAIL_MIN_ROWS = 24;
export const DETAIL_ROWS = 6;
export const TABLE_CHROME_ROWS = 3;
export const FOOTER_ROWS = 1;
export const SPARE_ROWS = 1;

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
