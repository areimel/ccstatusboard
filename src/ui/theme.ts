import { createContext, useContext } from 'react';
import { defaultTheme, extendTheme, type Theme as InkUiTheme } from '@inkjs/ui';
import { THEME_NAMES, type ThemeName } from '../domain/types.js';
import { cycle } from '../domain/cycle.js';
import { THEMES } from './palettes.js';

export interface Theme {
  name: ThemeName;
  accent: string;
  text: string;
  dim: string;
  ok: string;
  warn: string;
  danger: string;
  border: string;
  selectedBg: string;
  selectedFg: string;
  gradient: string[];
}

export { THEMES };

/** Next/previous theme in THEME_NAMES order, wrapping at both ends. */
export function cycleTheme(name: ThemeName, step: 1 | -1): ThemeName {
  return cycle(THEME_NAMES, name, step);
}

export const ThemeContext = createContext<Theme>(THEMES.default);

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

/** ok below thresholds[0], warn below thresholds[1], danger at/above thresholds[1]. */
export function levelColor(theme: Theme, percent: number, thresholds: [number, number] = [50, 80]): string {
  if (percent >= thresholds[1]) return theme.danger;
  if (percent >= thresholds[0]) return theme.warn;
  return theme.ok;
}

/** @inkjs/ui theme (for <ThemeProvider>) derived from our color tokens. */
export function inkUiTheme(theme: Theme): InkUiTheme {
  return extendTheme(defaultTheme, {
    components: {
      Spinner: { styles: { frame: () => ({ color: theme.accent }) } },
      ProgressBar: { styles: { completed: () => ({ color: theme.accent }) } },
      Badge: { styles: { label: () => ({ color: theme.selectedFg }) } },
    },
  });
}
