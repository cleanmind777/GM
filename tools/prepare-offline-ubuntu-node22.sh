#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$PROJECT_ROOT"

BUNDLE_ROOT="$PROJECT_ROOT/offline-bundle"
RUNTIME_DIR="$BUNDLE_ROOT/runtimes/linux-x64-node22"
MODULES_DIR="$BUNDLE_ROOT/node_modules_bundles/linux-x64-node22"
TMP_DIR="$BUNDLE_ROOT/_tmp"

mkdir -p "$RUNTIME_DIR" "$MODULES_DIR" "$TMP_DIR"

NODE_VERSION="v22.22.1"
NODE_TAR="node-${NODE_VERSION}-linux-x64.tar.xz"
NODE_URL="https://nodejs.org/dist/${NODE_VERSION}/${NODE_TAR}"
TAR_PATH="$TMP_DIR/$NODE_TAR"

echo "Downloading Node.js ${NODE_VERSION} for Linux x64..."
curl -fsSL "$NODE_URL" -o "$TAR_PATH"

EXTRACT_DIR="$TMP_DIR/node-linux-extract"
rm -rf "$EXTRACT_DIR"
mkdir -p "$EXTRACT_DIR"
tar -xJf "$TAR_PATH" -C "$EXTRACT_DIR"

SOURCE_NODE_DIR="$EXTRACT_DIR/node-${NODE_VERSION}-linux-x64"
echo "Copying runtime to offline bundle..."
cp -a "$SOURCE_NODE_DIR/." "$RUNTIME_DIR/"

echo "Installing project dependencies for Linux x64..."
npm ci

echo "Building client bundle..."
npm run build:client

rm -rf "$MODULES_DIR"
mkdir -p "$MODULES_DIR"
cp -a "$PROJECT_ROOT/node_modules" "$MODULES_DIR/node_modules"

echo
echo "Linux bundle prepared:"
echo "  $RUNTIME_DIR"
echo "  $MODULES_DIR/node_modules"
echo
echo "Next: package the full folder and transfer to offline PCs."
