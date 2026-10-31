# ccstatusboard

Standalone htop-style Ink TUI monitoring all Claude Code sessions. Spec: docs/superpowers/specs/2026-10-11-ccstatusboard-design.md. Plan: docs/superpowers/plans/2026-10-11-ccstatusboard.md.

- Commands: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run dev`, `npm run build:bin` (standalone binaries into release/), `npm run release -- <version> [--dry-run]` (see docs/RELEASING.md).
- Shared types live in `src/domain/types.ts`: change them there first.
- Collectors do IO and emit events; `store/` aggregates; `ui/` renders only (no IO in components).
- Never write under the Claude config dir, never open `*.key` files, never refresh OAuth tokens.
- Inject `now`, fs, fetch and exec for testability; tests use fixtures from `test/helpers/`.
