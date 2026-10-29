import type { Config, SortKey, ThemeName } from '../domain/types.js';
import { SORT_KEYS } from '../domain/types.js';
import { cycle } from '../domain/cycle.js';
import { cycleTheme } from './theme.js';

export type UiMode = 'normal' | 'search' | 'help';

export interface UiState {
  selectedIndex: number;
  sort: SortKey;
  filter: 'all' | 'live';
  search: string;
  mode: UiMode;
  showDetail: boolean;
  theme: ThemeName;
}

export type UiAction =
  | {
      type:
        | 'up'
        | 'down'
        | 'top'
        | 'bottom'
        | 'toggleDetail'
        | 'cycleSort'
        | 'toggleFilter'
        | 'startSearch'
        | 'endSearch'
        | 'clearSearch'
        | 'toggleHelp'
        | 'nextTheme'
        | 'prevTheme';
    }
  | { type: 'searchInput'; char: string }
  | { type: 'searchBackspace' };

export function initialUiState(config: Config): UiState {
  return {
    selectedIndex: 0,
    sort: config.sort,
    filter: 'all',
    search: '',
    mode: 'normal',
    showDetail: config.showDetail,
    theme: config.theme,
  };
}

export function clamp(i: number, rowCount: number): number {
  if (rowCount <= 0) return 0;
  return Math.min(Math.max(i, 0), rowCount - 1);
}

export function uiReducer(s: UiState, a: UiAction, rowCount: number): UiState {
  switch (a.type) {
    case 'up':
      return { ...s, selectedIndex: clamp(s.selectedIndex - 1, rowCount) };
    case 'down':
      return { ...s, selectedIndex: clamp(s.selectedIndex + 1, rowCount) };
    case 'top':
      return { ...s, selectedIndex: 0 };
    case 'bottom':
      return { ...s, selectedIndex: clamp(rowCount - 1, rowCount) };
    case 'toggleDetail':
      return { ...s, showDetail: !s.showDetail };
    case 'cycleSort': {
      return { ...s, sort: cycle(SORT_KEYS, s.sort, 1), selectedIndex: 0 };
    }
    case 'toggleFilter':
      return { ...s, filter: s.filter === 'all' ? 'live' : 'all', selectedIndex: 0 };
    case 'startSearch':
      return { ...s, mode: 'search' };
    case 'endSearch':
      return { ...s, mode: 'normal' };
    case 'clearSearch':
      return { ...s, mode: 'normal', search: '', selectedIndex: 0 };
    case 'toggleHelp':
      return { ...s, mode: s.mode === 'help' ? 'normal' : 'help' };
    case 'nextTheme':
      return { ...s, theme: cycleTheme(s.theme, 1) };
    case 'prevTheme':
      return { ...s, theme: cycleTheme(s.theme, -1) };
    case 'searchInput':
      return { ...s, search: s.search + a.char, selectedIndex: 0 };
    case 'searchBackspace':
      return { ...s, search: s.search.slice(0, -1), selectedIndex: 0 };
  }
}
