# GM Offline Installation Guide

This is the primary offline installation document for this repository.

Use this guide if target machines have no internet and you must run from a pre-prepared folder.

## 1. Supported offline target matrix

Current maintained offline bundle target:

- Windows x64, Node 22
- Ubuntu x64, Node 22

Reference bundle doc: `docs/offline-bundle-win-ubuntu-node22.md`.

## 2. Preparation strategy

Because this project uses native components (mediasoup worker), dependencies must be prepared per OS/runtime pair.

Do not reuse:

- Windows `node_modules` on Ubuntu
- Ubuntu `node_modules` on Windows
- Node 22 bundle for a different Node major version

## 3. Pre-reqs on online build machines

### Windows build machine

- PowerShell
- Internet access
- Project source

### Ubuntu build machine

- `curl`, `tar`, and internet access
- Project source

## 4. Build offline bundle artifacts

### 4.1 Build Windows artifacts

```powershell
Set-Location D:\HSK\GM
powershell -ExecutionPolicy Bypass -File .\tools\prepare-offline-win-node22.ps1
```

### 4.2 Build Ubuntu artifacts

```bash
cd /path/to/GM
chmod +x ./tools/prepare-offline-ubuntu-node22.sh
./tools/prepare-offline-ubuntu-node22.sh
```

### 4.3 Verify bundle completeness

```powershell
Set-Location D:\HSK\GM
powershell -ExecutionPolicy Bypass -File .\tools\verify-offline-bundle.ps1
```

or

```bash
cd /path/to/GM
chmod +x ./tools/verify-offline-bundle.sh
./tools/verify-offline-bundle.sh
```

## 5. Files required in transfer package

At minimum include:

- `server/`
- `public/`
- `tools/`
- `run-offline-win.ps1`
- `run-offline-linux.sh`
- `.env` and `.env.example`
- `package.json`, `package-lock.json`
- `offline-bundle/` (runtimes + node_modules bundles)
- optional TLS files (`key.pem`, `cert.pem`, optional CA file)

## 6. Offline run commands

### Windows offline PC

```powershell
Set-Location D:\GM
powershell -ExecutionPolicy Bypass -File .\run-offline-win.ps1
```

### Ubuntu offline PC

```bash
cd /opt/GM
chmod +x ./run-offline-linux.sh
./run-offline-linux.sh
```

## 7. Required `.env` values

Set at least:

```env
PORT=3000
MEDIASOUP_ANNOUNCED_IP=<SERVER_LAN_IP>
```

If using HTTPS:

```env
HTTPS_PORT=3443
SSL_KEY_PATH=./key.pem
SSL_CERT_PATH=./cert.pem
# SSL_CA_PATH=./ca.pem
```

## 8. Network and firewall

Allow:

- TCP 3000 (HTTP)
- TCP 3443 (HTTPS, if enabled)
- UDP 40000-49999 (mediasoup media)
- TCP 40000-49999 (recommended fallback)

## 9. Runtime validation checklist

1. Start server on offline target machine.
2. Open local URL (`http://localhost:3000` or HTTPS LAN URL).
3. Create room and verify camera/mic.
4. Join from another device; verify A/V.
5. Verify private room flows:
   - password join
   - host-accept join
   - join non-existing room shows Room Not Found modal
6. Verify whiteboard:
   - open/draw sync
   - status indicator updates

## 10. Common issues

### Join works but media fails

- Wrong `MEDIASOUP_ANNOUNCED_IP`
- Firewall blocks media port range

### Camera/mic blocked on LAN URL

- Use HTTPS + trusted cert
- `http://localhost` only works securely on same host

### Offline run script says missing runtime/modules

- `offline-bundle` is incomplete
- run verifier scripts before packaging
