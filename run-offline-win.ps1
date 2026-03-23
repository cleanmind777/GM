param(
  [string]$ProjectRoot = (Resolve-Path $PSScriptRoot).Path
)

$ErrorActionPreference = "Stop"
Set-Location $ProjectRoot

$runtimeNode = Join-Path $ProjectRoot "offline-bundle\runtimes\win-x64-node22\node.exe"
$bundledModules = Join-Path $ProjectRoot "offline-bundle\node_modules_bundles\win-x64-node22\node_modules"
$projectModules = Join-Path $ProjectRoot "node_modules"

if (!(Test-Path $runtimeNode)) {
  throw "Missing runtime: $runtimeNode"
}
if (!(Test-Path $bundledModules)) {
  throw "Missing bundled node_modules: $bundledModules"
}

if (!(Test-Path $projectModules)) {
  Write-Host "Restoring node_modules from offline bundle (first run)..."
  Copy-Item -Recurse -Force $bundledModules $projectModules
}

Write-Host "Starting server with bundled Node runtime..."
& $runtimeNode "$ProjectRoot\server\index.js"
