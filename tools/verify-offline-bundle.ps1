param(
  [string]$ProjectRoot = (Resolve-Path "$PSScriptRoot\..").Path
)

$ErrorActionPreference = "Stop"
Set-Location $ProjectRoot

$required = @(
  "server\index.js",
  "public\app.bundle.js",
  "run-offline-win.ps1",
  "run-offline-linux.sh",
  "offline-bundle\runtimes\win-x64-node22\node.exe",
  "offline-bundle\runtimes\linux-x64-node22\bin\node",
  "offline-bundle\node_modules_bundles\win-x64-node22\node_modules",
  "offline-bundle\node_modules_bundles\linux-x64-node22\node_modules"
)

$missing = @()
foreach ($rel in $required) {
  $p = Join-Path $ProjectRoot $rel
  if (!(Test-Path $p)) { $missing += $rel }
}

if ($missing.Count -gt 0) {
  Write-Host "Offline bundle verification FAILED. Missing:" -ForegroundColor Red
  $missing | ForEach-Object { Write-Host " - $_" -ForegroundColor Red }
  exit 1
}

Write-Host "Offline bundle verification OK." -ForegroundColor Green
Write-Host "Windows runtime: offline-bundle\runtimes\win-x64-node22\node.exe"
Write-Host "Linux runtime:   offline-bundle\runtimes\linux-x64-node22\bin\node"
Write-Host "Windows modules: offline-bundle\node_modules_bundles\win-x64-node22\node_modules"
Write-Host "Linux modules:   offline-bundle\node_modules_bundles\linux-x64-node22\node_modules"
