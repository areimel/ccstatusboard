# Live theme cycling — design

Date: 2026-10-29 · Branch: feat/themes (off feat/v1)

## Context
ccstatusboard already has a theme system: `src/ui/theme.ts` defines a `Theme` token set (accent, text, dim, ok, warn, danger, border, selectedBg, selectedFg, gradient), 4 palettes (default, mono, dracula, solarized) and `ThemeContext`/`useTheme()`, and every component already reads colors through it. The theme is chosen only at startup (`--theme` or `config.json`) and stays fixed while the app runs. The user wants popular IDE palettes added and wants to switch them live: `t` goes to the next theme, `T` to the previous one. The choice is saved so the next launch uses it.

### Decisions (user)
- **Cycle (12 themes):** default, mono, dracula, solarized, solarized-light, monokai, gruvbox, nord, tokyonight, catppuccin (Mocha), onedark, cyberpunk (bold neon).
- **Persistence:** save to the ccstatusboard config file (`~/.config/ccstatusboard/config.json`, or the `--config` path). Never write to the Claude dir.
- **Indicator:** the active theme name shows in the footer hint.
- **Foreground only:** no background painting, same as today.

### My calls (flag if wrong)
- The light theme is **solarized-light**, the counterpart of the existing solarized. On a dark terminal it will look low-contrast, which is expected when only foreground colors change.
- Cycle order is the list order above, and it wraps around in both directions.
- Saving is best-effort. If the existing config file contains invalid JSON, we **skip the save rather than overwrite it**. Write errors are swallowed silently, because the TUI has no stderr surface. Other keys in the file are preserved.
- If `--theme` was passed, it still wins at startup, and pressing `t` still saves.
- The footer hint for the theme is dropped when the terminal is too narrow, because the current hints already fill 60 columns. The help overlay always lists `t / T`.

## Design

### 1. Single source of theme names (DRY)
The theme names are hardcoded in 4 places today: `types.ts`, `schema.ts`, the `cli.tsx` help text, and the tests.
- `src/domain/types.ts`: `export const THEME_NAMES = [...] as const; export type ThemeName = typeof THEME_NAMES[number];`
- `src/config/schema.ts`: `theme: z.enum(THEME_NAMES)`
- `src/cli.tsx` help line built from `THEME_NAMES.join(' | ')`

### 2. Palettes split out (keeps files <300 lines)
- New `src/ui/palettes.ts`: `export const THEMES: Record<ThemeName, Theme>` holding all 12 palettes. The data uses each theme's canonical hex values. Cyberpunk uses neon cyan `#00fff9`, pink `#ff2a6d`, green `#05ffa1`, yellow `#f9f002` and purple `#711c91` on deep-indigo `selectedBg`.
- `src/ui/theme.ts` keeps the `Theme` interface, context, `useTheme`, `levelColor` and `inkUiTheme`, re-exports `THEMES`, and adds `cycleTheme(name, step: 1 | -1): ThemeName` built on a generic helper.
- New tiny helper `src/domain/cycle.ts`: `cycle<T>(list: readonly T[], current: T, step: 1 | -1): T` (wraps both ways). It is reused by both `cycleSort` in `App.tsx` (replacing its inline modulo math) and `cycleTheme`.

### 3. UI state + keys (`src/ui/App.tsx`)
- `UiState.theme: ThemeName`, initialized from `config.theme`. New actions `nextTheme` / `prevTheme` call `cycleTheme`.
- `useInput` in normal mode: `input === 't'` sends `nextTheme`, and `input === 'T'` sends `prevTheme`. In search mode, `t` stays a search character.
- The providers use `THEMES[ui.theme]`, and `inkUiTheme(...)` is wrapped in `useMemo`.
- New optional prop `onThemeChange?: (name: ThemeName) => void`, called from a `useEffect` on `ui.theme` that skips the first render. That keeps IO out of the component.
- Check App.tsx line count after the change (232 now). If it goes over ~300, move `uiReducer`/`UiState`/`initialUiState` into `src/ui/uiState.ts`.

### 4. Footer + Help
- `Footer`: add the hint `t` + current theme name (from `useTheme().name`). Add a `width` prop (App passes `columns`) and leave out the theme hint when it doesn't fit (55 columns of hints plus the theme hint length plus a gap).
- `HelpOverlay` KEYS: add `['t / T', 'Cycle theme (next / previous)']`. Check that the help panel still fits within `rows` for MIN_ROWS (see `App.height.test.tsx`).

### 5. Persist (`src/config/`)
- Pull `resolveConfigPath(flags, env?, home?)` out of `loadConfig` in `load.ts` and use it in both places.
- New `src/config/save.ts`: `createThemeSaver({ path, fs: { readFile, writeFile, rename, mkdir } })`. It returns `(name) => void` and writes serially with latest-wins coalescing, so a burst of `t` presses produces at most one write in flight and one pending. Each write reads the file (ENOENT means `{}`; invalid JSON or a non-object means skip), merges `{ theme }`, `mkdir -p`s the directory, writes `path.tmp`, then renames it into place. fs is injected for tests.
- `src/cli.tsx`: build the saver with the same path as `loadConfig` and pass `onThemeChange={saver}` to `<App>`.

