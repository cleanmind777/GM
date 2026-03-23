#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
cd "$PROJECT_ROOT"

RUNTIME_NODE="$PROJECT_ROOT/offline-bundle/runtimes/linux-x64-node22/bin/node"
BUNDLED_MODULES="$PROJECT_ROOT/offline-bundle/node_modules_bundles/linux-x64-node22/node_modules"
PROJECT_MODULES="$PROJECT_ROOT/node_modules"

if [[ ! -x "$RUNTIME_NODE" ]]; then
  echo "Missing runtime: $RUNTIME_NODE" >&2
  exit 1
fi
if [[ ! -d "$BUNDLED_MODULES" ]]; then
  echo "Missing bundled node_modules: $BUNDLED_MODULES" >&2
  exit 1
fi

if [[ ! -d "$PROJECT_MODULES" ]]; then
  echo "Restoring node_modules from offline bundle (first run)..."
  cp -a "$BUNDLED_MODULES" "$PROJECT_MODULES"
fi

echo "Starting server with bundled Node runtime..."
exec "$RUNTIME_NODE" "$PROJECT_ROOT/server/index.js"
