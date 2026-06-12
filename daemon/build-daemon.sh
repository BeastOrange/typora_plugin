#!/bin/bash
# build-daemon.sh — 编译 Swift daemon（仅 arm64 / Apple Silicon）
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
SRC="$SCRIPT_DIR/main.swift"
OUT_DIR="$SCRIPT_DIR/build"
OUT="$OUT_DIR/typora-plugin-daemon"

mkdir -p "$OUT_DIR"

echo "Compiling daemon (arm64-apple-macos13)..."
swiftc -O -target arm64-apple-macos13 "$SRC" -o "$OUT"

echo "✓ Built: $OUT"
file "$OUT"
