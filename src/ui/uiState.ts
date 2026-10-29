import type { Config } from '../domain/types.js';
import { SORT_KEYS } from '../domain/types.js';
import { cycle } from '../domain/cycle.js';
import { cycleTheme } from './theme.js';

export type UiMode = 'normal' | 'search' | 'help' | 'options';

export interface UiState {
  selectedIndex: number;
  filter: 'all' | 'live';
  search: string;
  mode: UiMode;
  /** Live config; theme, sort and showDetail are read from here (single source of truth). */
  config: Config;
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
        | 'openOptions'
        | 'closeOptions'
        | 'nextTheme'
        | 'prevTheme';
    }
  | { type: 'searchInput'; char: string }
  | { type: 'searchBackspace' }
  | { type: 'applyConfig'; patch: Partial<Config> };

export function initialUiState(config: Config): UiState {
  return {
    selectedIndex: 0,
    filter: 'all',
    search: '',
    mode: 'normal',
    config,
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
      return { ...s, config: { ...s.config, showDetail: !s.config.showDetail } };
    case 'cycleSort': {
      return { ...s, config: { ...s.config, sort: cycle(SORT_KEYS, s.config.sort, 1) }, selectedIndex: 0 };
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
    case 'openOptions':
      return { ...s, mode: 'options' };
    case 'closeOptions':
      return { ...s, mode: 'normal' };
    case 'applyConfig':
      return { ...s, config: { ...s.config, ...a.patch } };
    case 'nextTheme':
      return { ...s, config: { ...s.config, theme: cycleTheme(s.config.theme, 1) } };
    case 'prevTheme':
      return { ...s, config: { ...s.config, theme: cycleTheme(s.config.theme, -1) } };
    case 'searchInput':
      return { ...s, search: s.search + a.char, selectedIndex: 0 };
    case 'searchBackspace':
      return { ...s, search: s.search.slice(0, -1), selectedIndex: 0 };
  }
}
