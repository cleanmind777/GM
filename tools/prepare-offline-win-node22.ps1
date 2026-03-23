param(
  [string]$ProjectRoot = (Resolve-Path "$PSScriptRoot\..").Path
)

$ErrorActionPreference = "Stop"

Set-Location $ProjectRoot

$bundleRoot = Join-Path $ProjectRoot "offline-bundle"
$runtimeDir = Join-Path $bundleRoot "runtimes\win-x64-node22"
$modulesDir = Join-Path $bundleRoot "node_modules_bundles\win-x64-node22"
$tmpDir = Join-Path $bundleRoot "_tmp"
$stagingDir = Join-Path $tmpDir "win-build-staging"

New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
New-Item -ItemType Directory -Force -Path $modulesDir | Out-Null
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null

$nodeVersion = "v22.22.1"
$nodeZip = "node-$nodeVersion-win-x64.zip"
$nodeUrl = "https://nodejs.org/dist/$nodeVersion/$nodeZip"
$zipPath = Join-Path $tmpDir $nodeZip

Write-Host "Downloading Node.js $nodeVersion for Windows x64..."
Invoke-WebRequest -Uri $nodeUrl -OutFile $zipPath

$extractDir = Join-Path $tmpDir "node-win-extract"
if (Test-Path $extractDir) { Remove-Item -Recurse -Force $extractDir }
New-Item -ItemType Directory -Force -Path $extractDir | Out-Null
Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force

$sourceNodeDir = Join-Path $extractDir "node-$nodeVersion-win-x64"
Write-Host "Copying runtime to offline bundle..."
Copy-Item -Recurse -Force "$sourceNodeDir\*" $runtimeDir

Write-Host "Preparing isolated staging workspace..."
if (Test-Path $stagingDir) { Remove-Item -Recurse -Force $stagingDir }
New-Item -ItemType Directory -Force -Path $stagingDir | Out-Null

# Robocopy excludes lock-prone/build artifact folders so npm ci runs cleanly.
$null = robocopy $ProjectRoot $stagingDir /MIR /XD node_modules offline-bundle .git
if ($LASTEXITCODE -gt 7) {
  throw "Failed to stage project files (robocopy exit code: $LASTEXITCODE)"
}

$npmCmd = Join-Path $runtimeDir "npm.cmd"
if (!(Test-Path $npmCmd)) {
  throw "npm.cmd not found in runtime: $npmCmd"
}

Write-Host "Installing project dependencies for Windows x64 (isolated)..."
& $npmCmd ci --prefix $stagingDir
if ($LASTEXITCODE -ne 0) {
  throw "npm ci failed in staging workspace."
}

Write-Host "Building client bundle..."
& $npmCmd run build:client --prefix $stagingDir
if ($LASTEXITCODE -ne 0) {
  throw "npm run build:client failed in staging workspace."
}

Write-Host "Syncing generated app bundle back to project..."
Copy-Item -Force (Join-Path $stagingDir "public\app.bundle.js") (Join-Path $ProjectRoot "public\app.bundle.js")

if (Test-Path $modulesDir) {
  Remove-Item -Recurse -Force $modulesDir
}
New-Item -ItemType Directory -Force -Path $modulesDir | Out-Null
Copy-Item -Recurse -Force (Join-Path $stagingDir "node_modules") (Join-Path $modulesDir "node_modules")

Write-Host ""
Write-Host "Windows bundle prepared:"
Write-Host "  $runtimeDir"
Write-Host "  $(Join-Path $modulesDir "node_modules")"
Write-Host ""
Write-Host "Next: run tools/prepare-offline-ubuntu-node22.sh on an Ubuntu x64 online machine."
