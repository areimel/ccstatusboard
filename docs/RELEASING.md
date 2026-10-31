# Releasing ccstatusboard

Releases are cut locally with `scripts/release.sh`. There is no CI release workflow.

## One-time setup

- npm account with publish rights: `npm login` (check with `npm whoami`).
- GitHub CLI: `gh auth login` (check with `gh auth status`).
- Optional: install [bun](https://bun.sh). Without it the binary build falls back to `npx`.
- Be on `main`, up to date with `origin/main`, with a clean working tree.

## Release flow

```sh
npm run release -- 0.2.0 --dry-run   # always first
npm run release -- 0.2.0             # real release
```

The version is semver; a leading `v` is stripped. Prerelease versions (`0.3.0-rc.1`) are published under the npm `next` dist-tag.

Dry run runs every check and build, then restores `package.json`/`package-lock.json` and exits. The npm-login, gh-auth, on-main and up-to-date checks only warn in a dry run, so it works before login or from a branch. A dirty tree, an existing tag, or an already-published npm version always fails.

Steps, in order (everything that can fail locally happens before the first irreversible step, `npm publish`):

1. Preflight: clean tree, on `main`, HEAD equals `origin/main`, tag `v<version>` absent locally and on origin, `npm whoami`, `gh auth status`, bun or npx available, version not on npm.
2. `npm version --no-git-tag-version`, then typecheck, lint, test, build.
3. `npm run build:bin`, checksum verification, `--version` smoke test of the host binary, `npm pack --dry-run`.
4. Commit `chore(release): v<version>` (skipped when `package.json` is already at that version, e.g. the first `0.1.0` release, in which case HEAD is tagged as-is), annotated tag, `npm publish`, `git push origin main --follow-tags`, `gh release create`.

If a step fails before the release commit, the package files are restored automatically.

## What gets published where

- npm: package `ccstatusboard` (`npm install -g ccstatusboard`).
- GitHub Release `v<version>`: `ccstatusboard-linux-x64`, `ccstatusboard-darwin-arm64`, `ccstatusboard-darwin-x64` and `SHA256SUMS`. These are what the installer downloads:

  ```sh
  curl -fsSL https://raw.githubusercontent.com/areimel/ccstatusboard/main/install.sh | sh
  ```

  `install.sh` lives on `main` and is not versioned with releases.

## Recovery from partial failures

The script prints the exact resume commands on failure. Manually, with `<v>` the version:

- Publish succeeded, push failed:
  ```sh
  git push origin main --follow-tags
  gh release create v<v> release/ccstatusboard-* release/SHA256SUMS --title v<v> --generate-notes  # add --prerelease for x.y.z-rc.N
  ```
- Push succeeded, `gh release create` failed: run only the `gh release create` line (the `release/` directory must still exist; otherwise run `npm run build:bin` from the tagged commit).
- Publish itself failed: `npm publish` again (add `--tag next` for prereleases). Nothing is public yet; the local commit and tag can be reused.
- Abandoning before anything is public: `git tag -d v<v>` and `git reset --hard HEAD~1`.
- Unpublishing: `npm unpublish ccstatusboard@<v>` only works within 72 hours of publish (and subject to npm's dependents policy). The version number can never be reused, so prefer fixing forward with a new patch release, optionally `npm deprecate ccstatusboard@<v> "reason"`.

## Testing the installer locally

Lay out a fake release and point the installer at it:

```sh
npm run build:bin
base=$(mktemp -d)
mkdir -p "$base/latest/download" "$base/download/v0.2.0"
cp release/* "$base/latest/download/"
cp release/* "$base/download/v0.2.0/"
dest=$(mktemp -d)
CCSTATUSBOARD_DOWNLOAD_BASE="file://$base" CCSTATUSBOARD_INSTALL_DIR="$dest" sh install.sh
"$dest/ccstatusboard" --version
# pinned: add CCSTATUSBOARD_VERSION=v0.2.0
```
