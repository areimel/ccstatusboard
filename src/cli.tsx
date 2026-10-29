import React from 'react';
import { readFileSync } from 'node:fs';
import { render, type Instance } from 'ink';
import { ConfigError, loadConfig, parseCliArgs, resolveConfigPath } from './config/load.js';
import { createThemeSaver } from './config/save.js';
import { THEME_NAMES, type Config } from './domain/types.js';
import { cacheDir, resolveClaudeDir } from './core/paths.js';
import { createRuntime } from './app/runtime.js';
import { superviseInk } from './app/supervise.js';
import { App } from './ui/App.js';

// dist/cli.js (bundled) and src/cli.tsx are both one level below package.json.
const VERSION = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
).version;

const SAVE_FLUSH_MS = 500;

/** Joins names with ' | ' and wraps them so no line exceeds `width` columns. */
function wrapNames(names: readonly string[], indent: string, width: number): string {
  const lines: string[] = [];
  let line = '';
  for (const name of names) {
    const next = line ? `${line} | ${name}` : name;
    if (line && indent.length + next.length + 2 > width) {
      lines.push(`${indent}${line} |`);
      line = name;
    } else {
      line = next;
    }
  }
  if (line) lines.push(`${indent}${line}`);
  return lines.join('\n');
}

const HELP = `Usage: ccstatusboard [options]

htop-style dashboard for all Claude Code sessions, usage limits and costs.

Options:
  --theme <name>        start theme (t / T cycles; saved to config)
${wrapNames(THEME_NAMES, ' '.repeat(24), 78)}
  --refresh <ms>        UI refresh interval (default 1000, min 250)
  --ended-hours <n>     show ended sessions from the last n hours (default 24)
  --sort <key>          status | activity | cost | ctx | name
  --claude-dir <path>   Claude Code config dir (default $CLAUDE_CONFIG_DIR or ~/.claude)
  --no-usage-api        do not call the Anthropic usage API (limits show "disabled")
  --config <path>       config file (default ~/.config/ccstatusboard/config.json)
  -v, --version         print version
  -h, --help            print this help

Keys: ↑↓/jk select  ⏎ detail  s sort  f filter  / search  ? help  q quit
`;

const ENTER_ALT = '\u001b[?1049h\u001b[H';
const LEAVE_ALT = '\u001b[?1049l';

let altActive = false;
const leaveAltScreen = () => {
  if (!altActive) return;
  altActive = false;
  process.stdout.write(LEAVE_ALT);
};
// Last line of defence: whatever path exits the process, the terminal comes back.
process.on('exit', leaveAltScreen);

async function main(argv: string[]): Promise<number | undefined> {
  let parsed: ReturnType<typeof parseCliArgs>;
  try {
    parsed = parseCliArgs(argv);
  } catch (err) {
    process.stderr.write(`ccstatusboard: ${(err as Error).message}\nRun 'ccstatusboard --help' for usage.\n`);
    return 1;
  }
  if (parsed.version) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  if (parsed.help) {
    process.stdout.write(HELP);
    return 0;
  }

  let config: Config;
  try {
    config = await loadConfig({ flags: parsed.flags });
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`ccstatusboard: ${err.message}\n`);
      return 1;
    }
    throw err;
  }

  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    process.stderr.write('ccstatusboard needs an interactive terminal (TTY).\n');
    return 1;
  }

  const saveTheme = createThemeSaver({ path: resolveConfigPath(parsed.flags) });
  const claudeDir = resolveClaudeDir({ flag: parsed.flags.claudeDir ?? null, config: config.claudeDir });
  const runtime = createRuntime({ config, claudeDir, cacheDir: cacheDir(), version: VERSION });

  const ink: { instance?: Instance } = {};
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    try {
      runtime.stop();
      ink.instance?.unmount();
    } finally {
      leaveAltScreen();
    }
  };
  const shutdown = (code: number) => {
    restore();
    // Let a just-made theme save land, but never let a slow disk hold up quitting.
    const timeout = new Promise<void>((r) => setTimeout(r, SAVE_FLUSH_MS));
    void Promise.race([saveTheme.flush(), timeout]).finally(() => process.exit(code));
  };
  const crash = (err: unknown) => {
    try {
      restore();
    } catch {
      leaveAltScreen();
    }
    process.stderr.write(
      `ccstatusboard crashed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
    );
    process.exit(1);
  };

  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));
  process.on('uncaughtException', crash);
  process.on('unhandledRejection', crash);

  process.stdout.write(ENTER_ALT);
  altActive = true;
  ink.instance = render(
    <App store={runtime.store} config={config} onQuit={() => shutdown(0)} onThemeChange={saveTheme} />,
    {
      exitOnCtrlC: false,
    },
  );
  // A render error unmounts Ink and only rejects waitUntilExit(): restore the terminal and exit 1.
  superviseInk(ink.instance, { onExit: () => shutdown(0), onCrash: crash });
  await runtime.start(); // render first so the loading state is visible immediately
  return undefined; // keep running until quit
}

main(process.argv.slice(2)).then(
  (code) => {
    if (code !== undefined) process.exit(code);
  },
  (err: unknown) => {
    leaveAltScreen();
    process.stderr.write(`ccstatusboard: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  },
);
