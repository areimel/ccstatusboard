#!/bin/sh
# ccstatusboard installer.
#   curl -fsSL https://raw.githubusercontent.com/areimel/ccstatusboard/main/install.sh | sh
#   curl -fsSL https://raw.githubusercontent.com/areimel/ccstatusboard/main/install.sh | sh -s -- --uninstall
#
# Env:
#   CCSTATUSBOARD_VERSION        tag such as v0.2.0 (or 0.2.0); default: latest
#   CCSTATUSBOARD_INSTALL_DIR    default: $HOME/.local/bin
#   CCSTATUSBOARD_DOWNLOAD_BASE  default: https://github.com/areimel/ccstatusboard/releases
#
# All logic lives in functions and main runs on the last line, so a truncated
# download never executes partially.

set -eu

BIN_NAME="ccstatusboard"
TMP_DIR=""

say() { printf 'ccstatusboard: %s\n' "$*" >&2; }
warn() { printf 'ccstatusboard: warning: %s\n' "$*" >&2; }
die() {
  printf 'ccstatusboard: error: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat >&2 <<'USAGE'
Usage: install.sh [--uninstall] [--help]

Installs the ccstatusboard standalone binary.

Options:
  --uninstall   remove the installed binary
  --help        show this help

Environment:
  CCSTATUSBOARD_VERSION        release tag, e.g. v0.2.0 (default: latest)
  CCSTATUSBOARD_INSTALL_DIR    install directory (default: $HOME/.local/bin)
  CCSTATUSBOARD_DOWNLOAD_BASE  releases base URL (default: GitHub releases)
USAGE
}

cleanup() {
  if [ -n "$TMP_DIR" ] && [ -d "$TMP_DIR" ]; then
    rm -rf "$TMP_DIR"
  fi
}

npm_hint() {
  say "Alternative: sudo npm i -g ccstatusboard (requires Node 22+)"
}

install_dir() {
  if [ -n "${CCSTATUSBOARD_INSTALL_DIR:-}" ]; then
    printf '%s' "$CCSTATUSBOARD_INSTALL_DIR"
  else
    [ -n "${HOME:-}" ] || die "HOME is not set and CCSTATUSBOARD_INSTALL_DIR is empty"
    printf '%s' "$HOME/.local/bin"
  fi
}

detect_asset() {
  os=$(uname -s)
  arch=$(uname -m)
  case "$arch" in
    x86_64 | amd64) arch=x64 ;;
    arm64 | aarch64) arch=arm64 ;;
  esac
  case "$os-$arch" in
    Linux-x64) ASSET="ccstatusboard-linux-x64" ;;
    Darwin-arm64) ASSET="ccstatusboard-darwin-arm64" ;;
    Darwin-x64) ASSET="ccstatusboard-darwin-x64" ;;
    *)
      say "unsupported platform: $os $(uname -m)"
      say "prebuilt binaries: linux-x64, darwin-arm64, darwin-x64"
      npm_hint
      exit 1
      ;;
  esac
  OS_NAME="$os"
}

normalize_version() {
  v="${CCSTATUSBOARD_VERSION:-}"
  case "$v" in
    "" | latest) printf '' ;;
    v*) printf '%s' "$v" ;;
    *) printf 'v%s' "$v" ;;
  esac
}

# fetch URL DEST
fetch() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$2" "$1"
  else
    die "need curl or wget to download files"
  fi
}

sha_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d ' ' -f 1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d ' ' -f 1
  else
    die "need sha256sum or shasum to verify the download"
  fi
}

verify() {
  file="$1"
  sums="$2"
  expected=$(awk -v n="$ASSET" '$2 == n || $2 == "*" n { print $1; exit }' "$sums")
  [ -n "$expected" ] || die "no checksum entry for $ASSET in SHA256SUMS; aborting"
  actual=$(sha_of "$file")
  if [ "$expected" != "$actual" ]; then
    die "checksum mismatch for $ASSET (expected $expected, got $actual); aborting"
  fi
}

do_install() {
  detect_asset
  tag=$(normalize_version)
  base="${CCSTATUSBOARD_DOWNLOAD_BASE:-https://github.com/areimel/ccstatusboard/releases}"
  base="${base%/}"
  if [ -n "$tag" ]; then
    url_dir="$base/download/$tag"
  else
    url_dir="$base/latest/download"
  fi
  dir=$(install_dir)

  TMP_DIR=$(mktemp -d 2>/dev/null || mktemp -d -t ccstatusboard)
  trap cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  say "downloading $ASSET (${tag:-latest})"
  fetch "$url_dir/$ASSET" "$TMP_DIR/$ASSET" || die "download failed: $url_dir/$ASSET"
  fetch "$url_dir/SHA256SUMS" "$TMP_DIR/SHA256SUMS" || die "download failed: $url_dir/SHA256SUMS"

  say "verifying checksum"
  verify "$TMP_DIR/$ASSET" "$TMP_DIR/SHA256SUMS"

  mkdir -p "$dir" || die "cannot create $dir"
  chmod +x "$TMP_DIR/$ASSET"
  mv -f "$TMP_DIR/$ASSET" "$dir/$BIN_NAME" || die "cannot install to $dir/$BIN_NAME"
  if [ "$OS_NAME" = "Darwin" ]; then
    xattr -d com.apple.quarantine "$dir/$BIN_NAME" 2>/dev/null || true
  fi

  say "installed to $dir/$BIN_NAME"
  if ver=$("$dir/$BIN_NAME" --version 2>/dev/null); then
    say "version: $ver"
  else
    warn "installed binary did not run (--version failed)"
  fi

  case ":${PATH:-}:" in
    *":$dir:"*) ;;
    *)
      say "$dir is not in your PATH. Add it with:"
      say "  export PATH=\"$dir:\$PATH\""
      ;;
  esac
}

do_uninstall() {
  dir=$(install_dir)
  if [ -e "$dir/$BIN_NAME" ]; then
    rm -f "$dir/$BIN_NAME"
    say "removed $dir/$BIN_NAME"
  else
    say "nothing to remove ($dir/$BIN_NAME not found)"
  fi
}

main() {
  action=install
  for arg in "$@"; do
    case "$arg" in
      --uninstall) action=uninstall ;;
      -h | --help)
        usage
        return 0
        ;;
      *)
        usage
        die "unknown argument: $arg"
        ;;
    esac
  done
  if [ "$action" = uninstall ]; then
    do_uninstall
  else
    do_install
  fi
}

main "$@"
