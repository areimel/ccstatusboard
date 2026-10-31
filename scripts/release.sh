#!/usr/bin/env bash
# Release ccstatusboard: verify, build, publish to npm, push, create GitHub release.
# Usage: npm run release -- <version> [--dry-run]
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: npm run release -- <version> [--dry-run]
       bash scripts/release.sh <version> [--dry-run]

  <version>   semver, e.g. 0.2.0 or 0.3.0-rc.1. A leading "v" is stripped (v0.2.0 -> 0.2.0).
              Prerelease versions are published to the npm "next" dist-tag.
  --dry-run   Run every check and build, but publish/commit/tag/push nothing.
              package.json and package-lock.json are restored afterwards.
              The npm-login, gh-auth, on-main and up-to-date-with-origin checks
              become warnings so a dry run works before login or from a branch.
  -h, --help  Show this help.
USAGE
}

VERSION=""
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    -h|--help) usage; exit 0 ;;
    --dry-run) DRY_RUN=1 ;;
    -*) echo "error: unknown option: $arg" >&2; usage >&2; exit 2 ;;
    *)
      if [ -n "$VERSION" ]; then echo "error: more than one version given" >&2; usage >&2; exit 2; fi
      VERSION="$arg" ;;
  esac
done

if [ -z "$VERSION" ]; then echo "error: version required" >&2; usage >&2; exit 2; fi
VERSION="${VERSION#v}"
SEMVER_RE='^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$'
if ! [[ "$VERSION" =~ $SEMVER_RE ]]; then
  echo "error: '$VERSION' is not a valid semver version (expected e.g. 0.2.0)" >&2
  exit 2
fi
TAG="v$VERSION"
NPM_TAG="latest"
case "$VERSION" in *-*) NPM_TAG="next" ;; esac

cd "$(dirname "${BASH_SOURCE[0]}")/.."

step() { printf '\n==> %s\n' "$*"; }
warn() { printf 'warning: %s\n' "$*" >&2; }
fail() { printf 'error: %s\n' "$*" >&2; exit 1; }
# Hard error in a real run, warning in a dry run.
soft() { if [ "$DRY_RUN" -eq 1 ]; then warn "$* (ignored in --dry-run)"; else fail "$*"; fi; }

# ---------------------------------------------------------------- 1. preflight
step "1/5 Preflight checks for $TAG$([ "$DRY_RUN" -eq 1 ] && echo ' (dry run)')"

[ -z "$(git status --porcelain)" ] || fail "working tree is not clean; commit or stash changes first"

branch="$(git rev-parse --abbrev-ref HEAD)"
[ "$branch" = "main" ] || soft "current branch is '$branch', releases must be cut from main"

if git fetch origin main --quiet 2>/dev/null; then
  if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
    soft "HEAD is not equal to origin/main; push or pull first"
  fi
else
  soft "could not 'git fetch origin main'"
fi

if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  fail "tag $TAG already exists locally"
fi
remote_tags="$(git ls-remote --tags origin "refs/tags/$TAG" 2>/dev/null)" \
  || fail "could not query tags on origin (git ls-remote failed)"
[ -z "$remote_tags" ] || fail "tag $TAG already exists on origin"

npm whoami >/dev/null 2>&1 || soft "not logged in to npm; run 'npm login'"
gh auth status >/dev/null 2>&1 || soft "not logged in to GitHub CLI; run 'gh auth login'"

if ! command -v bun >/dev/null 2>&1 && ! command -v npx >/dev/null 2>&1; then
  fail "neither bun nor npx found on PATH (needed to build binaries); install bun or Node/npm"
fi

if npm view "ccstatusboard@$VERSION" version >/dev/null 2>&1; then
  fail "ccstatusboard@$VERSION already exists on npm"
fi
echo "preflight ok"

# --------------------------------------------------- restore trap (pre-commit)
restore_files() {
  git checkout -- package.json 2>/dev/null || true
  [ -f package-lock.json ] && git checkout -- package-lock.json 2>/dev/null || true
}
RESTORE_ARMED=1
on_exit() {
  local rc=$?
  if [ "$RESTORE_ARMED" -eq 1 ]; then
    echo
    if [ "$rc" -ne 0 ]; then echo "release failed; restoring package.json and package-lock.json" >&2
    else echo "restoring package.json and package-lock.json"; fi
    restore_files
  fi
}
trap on_exit EXIT

# ------------------------------------------------------- 2. version + checks
step "2/5 Set version $VERSION and run checks"
current="$(node -p "require('./package.json').version")"
if [ "$current" = "$VERSION" ]; then
  npm version "$VERSION" --no-git-tag-version --allow-same-version
else
  npm version "$VERSION" --no-git-tag-version
fi
npm run typecheck
npm run lint
npm test
npm run build

# ------------------------------------------------------------ 3. binaries
step "3/5 Build and verify standalone binaries"
npm run build:bin

(
  cd release
  if command -v sha256sum >/dev/null 2>&1; then sha256sum -c SHA256SUMS
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 -c SHA256SUMS
  else echo "error: neither sha256sum nor shasum available" >&2; exit 1; fi
)

os="$(uname -s)"; arch="$(uname -m)"
host_bin=""
case "$os-$arch" in
  Linux-x86_64) host_bin="ccstatusboard-linux-x64" ;;
  Darwin-arm64) host_bin="ccstatusboard-darwin-arm64" ;;
  Darwin-x86_64) host_bin="ccstatusboard-darwin-x64" ;;
esac
if [ -n "$host_bin" ] && [ -x "release/$host_bin" ]; then
  got="$("release/$host_bin" --version)"
  [ "$got" = "$VERSION" ] || fail "smoke test: release/$host_bin --version printed '$got', expected '$VERSION'"
  echo "smoke test ok: $host_bin --version -> $got"
else
  warn "no runnable binary for host $os-$arch; skipping smoke test"
fi

npm pack --dry-run

# ------------------------------------------------------------- 4. dry run
if [ "$DRY_RUN" -eq 1 ]; then
  step "4/5 Dry run complete"
  cat <<SUMMARY
A real run of 'npm run release -- $VERSION' would now:
  - commit package.json + package-lock.json as "chore(release): $TAG"
  - create annotated tag $TAG
  - npm publish --tag $NPM_TAG
  - git push origin main --follow-tags
  - gh release create $TAG release/ccstatusboard-* release/SHA256SUMS --title $TAG --generate-notes
Nothing was committed, tagged, published or pushed.
SUMMARY
  exit 0   # EXIT trap restores package files
fi

# --------------------------------------------------------------- 5. release
step "5/5 Commit, tag, publish, push, GitHub release"
git add package.json
[ -f package-lock.json ] && git add package-lock.json
git commit -m "chore(release): $TAG"
RESTORE_ARMED=0   # release commit exists; do not revert files anymore
git tag -a "$TAG" -m "$TAG"

STAGE="npm publish"
resume() {
  local rc=$?
  trap - ERR
  cat >&2 <<RESUME

error: release step '$STAGE' failed (exit $rc). Local commit and tag $TAG exist.
Resume by running the remaining commands from this point:
RESUME
  case "$STAGE" in
    "npm publish")
      echo "  npm publish --tag $NPM_TAG" >&2
      echo "  git push origin main --follow-tags" >&2
      echo "  gh release create $TAG release/ccstatusboard-* release/SHA256SUMS --title $TAG --generate-notes" >&2 ;;
    "git push")
      echo "  git push origin main --follow-tags" >&2
      echo "  gh release create $TAG release/ccstatusboard-* release/SHA256SUMS --title $TAG --generate-notes" >&2 ;;
    *)
      echo "  gh release create $TAG release/ccstatusboard-* release/SHA256SUMS --title $TAG --generate-notes" >&2 ;;
  esac
  exit "$rc"
}
trap resume ERR

STAGE="npm publish";    npm publish --tag "$NPM_TAG"
STAGE="git push";       git push origin main --follow-tags
STAGE="gh release";     gh release create "$TAG" release/ccstatusboard-* release/SHA256SUMS --title "$TAG" --generate-notes
trap - ERR

step "Released $TAG"
cat <<DONE
npm:    npm install -g ccstatusboard@$VERSION
binary: curl -fsSL https://raw.githubusercontent.com/areimel/ccstatusboard/main/install.sh | sh
DONE
