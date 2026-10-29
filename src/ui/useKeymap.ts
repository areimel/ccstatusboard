import { useInput, type Key } from 'ink';
import type { UiAction, UiMode, UiState } from './uiState.js';

export interface KeymapDeps {
  ui: UiState;
  dispatch: (a: UiAction) => void;
  onQuit: () => void;
}

type ModeHandler = (input: string, key: Key, deps: KeymapDeps) => void;

// F1 arrives as ESC O P; Ink may strip the leading ESC.
export const isF1 = (input: string): boolean => input === '\u001bOP' || input === 'OP';

const searchKeys: ModeHandler = (input, key, { dispatch }) => {
  if (key.escape) dispatch({ type: 'clearSearch' });
  else if (key.return) dispatch({ type: 'endSearch' });
  else if (key.backspace || key.delete) dispatch({ type: 'searchBackspace' });
  else if (input && !key.ctrl && !key.meta) dispatch({ type: 'searchInput', char: input });
};

const helpKeys: ModeHandler = (input, _key, { dispatch, onQuit }) => {
  if (input === 'q') return onQuit();
  dispatch({ type: 'toggleHelp' });
};

// OptionsMenu owns its own useInput; Ctrl-C is handled globally in useKeymap.
const optionsKeys: ModeHandler = () => {};

const normalKeys: ModeHandler = (input, key, { ui, dispatch, onQuit }) => {
  if (input === 'q') return onQuit();
  if (key.upArrow || input === 'k') dispatch({ type: 'up' });
  else if (key.downArrow || input === 'j') dispatch({ type: 'down' });
  else if (input === 'g') dispatch({ type: 'top' });
  else if (input === 'G') dispatch({ type: 'bottom' });
  else if (key.return) dispatch({ type: 'toggleDetail' });
  else if (input === 's') dispatch({ type: 'cycleSort' });
  else if (input === 'f') dispatch({ type: 'toggleFilter' });
  else if (input === 't') dispatch({ type: 'nextTheme' });
  else if (input === 'T') dispatch({ type: 'prevTheme' });
  else if (input === '/') dispatch({ type: 'startSearch' });
  else if (input === '?' || isF1(input)) dispatch({ type: 'toggleHelp' });
  else if (key.escape) dispatch(ui.search ? { type: 'clearSearch' } : { type: 'openOptions' });
};

/** One handler per mode: adding a mode is a one-entry change. */
export const MODE_KEYMAPS: Record<UiMode, ModeHandler> = {
  normal: normalKeys,
  search: searchKeys,
  help: helpKeys,
  options: optionsKeys,
};

export function useKeymap(deps: KeymapDeps): void {
  useInput((input, key) => {
    if (key.ctrl && input === 'c') return deps.onQuit();
    MODE_KEYMAPS[deps.ui.mode](input, key, deps);
  });
}
