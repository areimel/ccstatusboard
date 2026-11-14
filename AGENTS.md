# Repository Guidelines

## Project Structure & Module Organization

ccstatusboard is a TypeScript/React Ink terminal dashboard for Claude Code sessions. `src/cli.tsx` is the entry point. `src/collectors/` performs I/O and emits events, `src/store/` aggregates state, and `src/ui/` renders without I/O. `src/app/` coordinates runtime behavior; `src/domain/` holds calculations and shared types (`types.ts`); `src/config/` and `src/core/` provide configuration and utilities.

Unit tests sit beside source files; `test/integration/` covers runtime integration, and `test/helpers/` supplies fixtures and rendering utilities. `site/` is a separate Astro website, with pages/components under `site/src/` and static assets under `site/public/`. `scripts/` handles packaging and releases; `docs/` contains design documents and release instructions.

## Build, Test, and Development Commands

Use Node.js 22+ on Linux or macOS. Install root dependencies with `npm ci`.

- `npm run dev`: launch the TUI directly through tsx.
- `npm run build`: bundle the CLI into `dist/cli.js` with tsup.
- `npm test`: run all Vitest tests; `npm run test:watch` watches changes.
- `npm run typecheck`: check TypeScript without emitting files.
- `npm run lint`: run ESLint and Prettier checks.
- `npm run format`: apply Prettier formatting.
- Website: run `npm --prefix site ci`, then `npm run site-dev`; validate with `npm --prefix site run check` and `npm --prefix site run build`.

## Coding Style & Naming Conventions

Use strict TypeScript, two-space indentation, single quotes, semicolons, trailing commas, and Prettier's 110-column width. Follow existing `.js` import specifiers in TypeScript. Use PascalCase for React components and camelCase for functions/variables. Update shared types in `src/domain/types.ts` first. Root lint/format checks exclude `site/`.

## Testing Guidelines

Use Vitest and ink-testing-library. Name tests `*.test.ts` or `*.test.tsx`. Inject clocks, filesystem access, fetch, and exec; reuse temporary Claude-directory fixtures rather than real user data. No coverage threshold is configured. Before submitting, run tests, typecheck, lint, and build.

## Commit & Pull Request Guidelines

Prefer the history's scoped conventions: `feat(system): ...`, `feat(site): ...`, and `chore(release): v...`. Keep commits focused. PRs should describe behavior changes, link relevant issues, list validation, and include terminal captures or screenshots for visual changes.

## Security & Configuration

Never write under the Claude configuration directory, open `*.key` files, or refresh OAuth tokens. See `docs/RELEASING.md` before release work.
