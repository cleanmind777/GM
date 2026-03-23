# Offline Bundle Guide (Windows x64 + Ubuntu x64, Node 22)

This guide creates a self-contained folder for offline deployment on:

- Windows x64
- Ubuntu x64
- Node.js 22

## 1) What this prepares

Inside this project, the scripts build:

- `offline-bundle/runtimes/win-x64-node22` (portable Node runtime)
- `offline-bundle/runtimes/linux-x64-node22` (portable Node runtime)
- `offline-bundle/node_modules_bundles/win-x64-node22/node_modules`
- `offline-bundle/node_modules_bundles/linux-x64-node22/node_modules`

Runtime launchers:

- `run-offline-win.ps1`
- `run-offline-linux.sh`

## 2) Prepare Windows bundle (online Windows x64)

From PowerShell in project root:

```powershell
Set-Location D:\HSK\GM
powershell -ExecutionPolicy Bypass -File .\tools\prepare-offline-win-node22.ps1
```

This downloads Node 22 Windows runtime, installs deps, builds client, and stores Windows `node_modules` bundle.

## 3) Prepare Ubuntu bundle (online Ubuntu x64)

Copy this same project to Ubuntu x64 (online), then run:

```bash
cd /path/to/GM
chmod +x ./tools/prepare-offline-ubuntu-node22.sh
./tools/prepare-offline-ubuntu-node22.sh
```

This downloads Node 22 Linux runtime and builds Linux `node_modules` bundle.

## 4) Merge and package

After both preparations, ensure one folder contains both runtime/module bundles.

Verify completeness before archiving:

- Windows PowerShell:
  ```powershell
  Set-Location D:\HSK\GM
  powershell -ExecutionPolicy Bypass -File .\tools\verify-offline-bundle.ps1
  ```
- Ubuntu:
  ```bash
  cd /path/to/GM
  chmod +x ./tools/verify-offline-bundle.sh
  ./tools/verify-offline-bundle.sh
  ```

Create archive:

- Windows:
  ```powershell
  Set-Location D:\
  Compress-Archive -Path .\HSK\GM\* -DestinationPath .\GM-offline-win-ubuntu-node22.zip -Force
  ```
- Ubuntu:
  ```bash
  cd /path/to
  tar -czf GM-offline-win-ubuntu-node22.tar.gz GM
  ```

## 5) Run on offline Windows x64

```powershell
Set-Location D:\GM
powershell -ExecutionPolicy Bypass -File .\run-offline-win.ps1
```

## 6) Run on offline Ubuntu x64

```bash
cd /opt/GM
chmod +x ./run-offline-linux.sh
./run-offline-linux.sh
```

## 7) Environment config (`.env`)

Set at minimum:

```env
PORT=3000
MEDIASOUP_ANNOUNCED_IP=<SERVER_LAN_IP>
```

Optional HTTPS:

```env
HTTPS_PORT=3443
SSL_KEY_PATH=./key.pem
SSL_CERT_PATH=./cert.pem
# SSL_CA_PATH=./ca.pem
```

## 8) Notes

- Do not use Windows `node_modules` on Ubuntu or vice versa.
- Keep Node major fixed to 22 for this bundle.
- First offline run copies bundled `node_modules` into project root if missing.
