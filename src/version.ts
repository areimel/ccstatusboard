import { readFileSync } from 'node:fs';

declare const __CCSB_VERSION__: string | undefined;

/**
 * Injected at build time via `define` (tsup / bun). Falls back to reading
 * package.json (src/ and dist/ are both one level below it) for dev and tests.
 */
export const VERSION: string =
  typeof __CCSB_VERSION__ !== 'undefined'
    ? __CCSB_VERSION__
    : (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string })
        .version;
