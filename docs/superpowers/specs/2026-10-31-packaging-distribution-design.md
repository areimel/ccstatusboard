# Packaging & distribution design (npm + curl-installed binary)

Date: 2026-10-31. Status: approved.

## Context

ccstatusboard is a working Ink TUI (v0.1.0, merged to `main`) that has never been published. The goal is public distribution two ways:

1. **npm**: `npx ccstatusboard` / `npm i -g ccstatusboard` for people with Node 22+.
2. **curl one-liner** for people without Node: `curl -fsSL https://raw.githubusercontent.com/areimel/ccstatusboard/main/install.sh | sh`, which downloads a prebuilt standalone executable.

What already exists: `package.json` has `bin`, `files`, `engines`, `os` and a `prepublishOnly` gate. The npm name `ccstatusboard` is free (registry 404). There is no CI, no tags, no release tooling. `npm whoami` is not logged in. `gh` 2.45 is installed. Bun is not installed.

### Decisions the user made
- **No-Node path:** a standalone binary per platform, attached to GitHub Releases.
- **Releases:** a local release script the maintainer runs (no GitHub Actions).
- **Binary targets:** `linux-x64`, `darwin-arm64`, `darwin-x64`. (Linux arm64 users get pointed to npm.)
- **Script URL:** the raw GitHub file on `main`.

### Builder calls
- **Compile with `bun build --compile`.** It cross-compiles all three targets from one Linux machine, and Ink/React/yoga bundle cleanly. The build uses `bun` from PATH, or falls back to `npx -y bun@1.3` so no global install is required.
- **Version gets injected at build time.** `src/cli.tsx:13` reads `../package.json` at runtime, and a compiled binary has no package.json next to it. I'll replace this with a `__CCSB_VERSION__` build-time define (tsup `define` plus bun `--define`). Dev runs under `tsx` will still read package.json.
- **Ink devtools import.** `node_modules/ink/build/devtools.js` imports `react-devtools-core`, which isn't installed. Bun needs `--external react-devtools-core`. That code only loads when `DEV=true`.
- **The installer verifies checksums.** It downloads `SHA256SUMS` from the same release and checks it with `sha256sum` or `shasum -a 256`. It installs to `~/.local/bin` by default and warns if that folder isn't on PATH.
- **The first published version** is whatever the user passes to the release script. Suggested: `0.1.0` as-is, or `0.2.0`.
- **No CI workflow** in this pass, since the user chose local releases. A checks-only CI can be added later.

## Fixed contracts (so subagents can work in parallel)

| Thing | Value |
|---|---|
| Build output dir | `release/` (gitignored, prettier/eslint-ignored) |
| Asset names | `ccstatusboard-linux-x64`, `ccstatusboard-darwin-arm64`, `ccstatusboard-darwin-x64` |
| Checksums file | `release/SHA256SUMS`, `sha256sum` format (`<hex>  <name>`) |
| Binary build | `scripts/build-binaries.sh` → `npm run build:bin` |
| Release | `scripts/release.sh <version> [--dry-run]` → `npm run release -- <version>` |
| Installer | `install.sh` at repo root, POSIX `sh` |
| Installer env | `CCSTATUSBOARD_VERSION` (e.g. `v0.2.0`, default latest), `CCSTATUSBOARD_INSTALL_DIR` (default `$HOME/.local/bin`), `CCSTATUSBOARD_DOWNLOAD_BASE` (default `https://github.com/areimel/ccstatusboard/releases`; test hook, works with `file://`) |
| Download URL | latest: `$BASE/latest/download/<asset>`; pinned: `$BASE/download/<tag>/<asset>` |
| Version define | `__CCSB_VERSION__` (string) |

## Verification
1. `npm run typecheck && npm run lint && npm test && npm run build`, all green.
2. `node dist/cli.js --version` prints the package version (tsup define works).
3. `npm run build:bin` produces 3 binaries + `SHA256SUMS`; `sha256sum -c release/SHA256SUMS` passes; `file release/*` shows ELF x86-64 / Mach-O arm64 / Mach-O x86_64.
4. `release/ccstatusboard-linux-x64 --version` / `--help` work, and the TUI renders against the fixture claude dir (run skill / `script -qc` capture).
5. End-to-end installer, offline: `CCSTATUSBOARD_DOWNLOAD_BASE=file://$PWD/<fake-release-layout> CCSTATUSBOARD_INSTALL_DIR=$scratch sh install.sh`, then `$scratch/ccstatusboard --version`.
6. `npm pack --dry-run` lists only dist/, README.md, LICENSE, package.json.
7. `npm run release -- 0.1.0 --dry-run` completes and leaves the tree clean (needs `npm login` first; if not logged in, confirm preflight fails with a clear message).
8. The real publish is **not** run by me. The user runs `npm run release -- <version>` after reviewing, since it is public and irreversible.
