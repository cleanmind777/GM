#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$PROJECT_ROOT"

required=(
  "server/index.js"
  "public/app.bundle.js"
  "run-offline-win.ps1"
  "run-offline-linux.sh"
  "offline-bundle/runtimes/win-x64-node22/node.exe"
  "offline-bundle/runtimes/linux-x64-node22/bin/node"
  "offline-bundle/node_modules_bundles/win-x64-node22/node_modules"
  "offline-bundle/node_modules_bundles/linux-x64-node22/node_modules"
)

missing=()
for rel in "${required[@]}"; do
  if [[ ! -e "$PROJECT_ROOT/$rel" ]]; then
    missing+=("$rel")
  fi
done

if (( ${#missing[@]} > 0 )); then
  echo "Offline bundle verification FAILED. Missing:" >&2
  for m in "${missing[@]}"; do
    echo " - $m" >&2
  done
  exit 1
fi

echo "Offline bundle verification OK."
echo "Windows runtime: offline-bundle/runtimes/win-x64-node22/node.exe"
echo "Linux runtime:   offline-bundle/runtimes/linux-x64-node22/bin/node"
echo "Windows modules: offline-bundle/node_modules_bundles/win-x64-node22/node_modules"
echo "Linux modules:   offline-bundle/node_modules_bundles/linux-x64-node22/node_modules"
