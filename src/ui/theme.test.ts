import { describe, expect, it } from 'vitest';
import { inkUiTheme, levelColor, THEMES } from './theme.js';

describe('theme', () => {
  it('defines every token for every theme', () => {
    const keys = ['accent', 'text', 'dim', 'ok', 'warn', 'danger', 'border', 'selectedBg', 'selectedFg'];
    for (const [name, t] of Object.entries(THEMES)) {
      expect(t.name).toBe(name);
      for (const k of keys) expect(typeof (t as unknown as Record<string, unknown>)[k]).toBe('string');
      expect(t.gradient.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('levelColor uses [50,80] by default and accepts custom thresholds', () => {
    const t = THEMES.default;
    expect(levelColor(t, 10)).toBe(t.ok);
    expect(levelColor(t, 50)).toBe(t.warn);
    expect(levelColor(t, 80)).toBe(t.danger);
    expect(levelColor(t, 59, [60, 80])).toBe(t.ok);
    expect(levelColor(t, 60, [60, 80])).toBe(t.warn);
  });

  it('inkUiTheme maps the accent onto @inkjs/ui Spinner and ProgressBar', () => {
    const t = THEMES.dracula;
    const ui = inkUiTheme(t);
    const spinner = ui.components.Spinner?.styles?.frame?.();
    const bar = ui.components.ProgressBar?.styles?.completed?.();
    expect(spinner).toMatchObject({ color: t.accent });
    expect(bar).toMatchObject({ color: t.accent });
  });
});
