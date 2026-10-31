#!/usr/bin/env bash
# Builds standalone ccstatusboard executables with `bun build --compile`.
# Usage: scripts/build-binaries.sh [--target <os-arch>]
# Output: release/ccstatusboard-<os>-<arch> and release/SHA256SUMS
set -euo pipefail

BUN_VERSION="1.3.14"
ALL_TARGETS=(linux-x64 darwin-arm64 darwin-x64)

cd "$(dirname "${BASH_SOURCE[0]}")/.."

only=""
while [ $# -gt 0 ]; do
  case "$1" in
    --target)
      [ $# -ge 2 ] || { echo "error: --target needs a value" >&2; exit 2; }
      only="$2"
      shift 2
      ;;
    -h | --help)
      echo "Usage: $0 [--target linux-x64|darwin-arm64|darwin-x64]"
      exit 0
      ;;
    *)
      echo "error: unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

targets=("${ALL_TARGETS[@]}")
if [ -n "$only" ]; then
  valid=0
  for t in "${ALL_TARGETS[@]}"; do [ "$t" = "$only" ] && valid=1; done
  [ "$valid" = 1 ] || { echo "error: unknown target '$only' (valid: ${ALL_TARGETS[*]})" >&2; exit 2; }
  targets=("$only")
fi

if command -v bun >/dev/null 2>&1; then
  BUN=(bun)
else
  BUN=(npx -y "bun@${BUN_VERSION}")
fi

version="$(node -p "require('./package.json').version")"

if [ -z "$only" ]; then rm -rf release; fi
mkdir -p release

for t in "${targets[@]}"; do
  echo "==> building ccstatusboard-$t (v$version)"
  "${BUN[@]}" scripts/bun-compile.mjs "$t" "$version" "release/ccstatusboard-$t"
done

cd release
if command -v sha256sum >/dev/null 2>&1; then SUM=(sha256sum); else SUM=(shasum -a 256); fi
# Only list binaries that exist (partial --target builds).
: > SHA256SUMS.tmp
for f in ccstatusboard-*; do "${SUM[@]}" "$f" >> SHA256SUMS.tmp; done
mv SHA256SUMS.tmp SHA256SUMS
echo "==> done"
ls -l
cat SHA256SUMS
