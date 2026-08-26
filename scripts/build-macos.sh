#!/usr/bin/env bash
# Delta — local build script for macOS.
#
# Use this when the downloaded .dmg from the GitHub Releases page refuses to
# open ("Delta is damaged and can't be opened" / "cannot be opened because
# the developer cannot be verified"). That .dmg isn't signed with a paid
# Apple Developer certificate (Delta has none), and recent macOS versions
# block unsigned, downloaded apps outright via Gatekeeper's quarantine
# check — a locally-built app is never quarantined in the first place
# (quarantine is only ever applied to files a browser/download manager
# fetched from the internet), so building it yourself sidesteps the problem
# entirely instead of needing to fight Gatekeeper after the fact.
#
# This script installs everything needed (Homebrew packages, Rust, the
# Tauri CLI, frontend deps) and produces a native .app + .dmg for the
# machine it runs on.

set -euo pipefail

if ! command -v brew &>/dev/null; then
  echo "Homebrew is required but wasn't found."
  echo "Install it from https://brew.sh, then re-run this script."
  exit 1
fi

echo "==> Installing Node.js (needed for the frontend build)..."
brew install node

if ! command -v cargo &>/dev/null; then
  echo "==> Rust not found — installing it via rustup..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  # shellcheck disable=SC1091
  source "$HOME/.cargo/env"
fi

echo "==> Installing the Tauri CLI (cargo tauri)..."
cargo install tauri-cli --version "^2" --locked

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "==> Installing frontend dependencies..."
npm ci --prefix frontend

echo "==> Building Delta — this can take several minutes the first time..."
cargo tauri build

BUNDLE_DIR="src-tauri/target/release/bundle"
echo ""
echo "==> Done. Built app:"
echo "    $BUNDLE_DIR/macos/Delta.app"
echo "    $BUNDLE_DIR/dmg/"*.dmg 2>/dev/null || true
echo ""
echo "This build is unsigned too, so the FIRST time you open it macOS may still"
echo "show a Gatekeeper warning. Right-click (Control-click) Delta.app, choose"
echo "\"Open\", then confirm \"Open\" in the dialog that appears — needed only once."
