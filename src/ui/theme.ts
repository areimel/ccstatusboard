import { createContext, useContext } from 'react';
import { defaultTheme, extendTheme, type Theme as InkUiTheme } from '@inkjs/ui';
import type { ThemeName } from '../domain/types.js';

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

export const THEMES: Record<ThemeName, Theme> = {
  default: {
    name: 'default',
    accent: 'cyan',
    text: 'white',
    dim: 'gray',
    ok: 'green',
    warn: 'yellow',
    danger: 'red',
    border: 'gray',
    selectedBg: 'blue',
    selectedFg: 'white',
    gradient: ['#5ee7df', '#b490ca'],
  },
  mono: {
    name: 'mono',
    accent: 'white',
    text: 'white',
    dim: 'gray',
    ok: 'white',
    warn: 'white',
    danger: 'white',
    border: 'gray',
    selectedBg: 'white',
    selectedFg: 'black',
    gradient: ['#ffffff', '#8a8a8a'],
  },
  dracula: {
    name: 'dracula',
    accent: '#bd93f9',
    text: '#f8f8f2',
    dim: '#6272a4',
    ok: '#50fa7b',
    warn: '#f1fa8c',
    danger: '#ff5555',
    border: '#6272a4',
    selectedBg: '#44475a',
    selectedFg: '#f8f8f2',
    gradient: ['#ff79c6', '#bd93f9'],
  },
  solarized: {
    name: 'solarized',
    accent: '#268bd2',
    text: '#93a1a1',
    dim: '#586e75',
    ok: '#859900',
    warn: '#b58900',
    danger: '#dc322f',
    border: '#586e75',
    selectedBg: '#073642',
    selectedFg: '#eee8d5',
    gradient: ['#b58900', '#cb4b16'],
  },
};

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
