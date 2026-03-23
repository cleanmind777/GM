# GM Full Offline PC Installation Guide

This document explains how to deploy and run `GM` on an offline Windows PC (no internet), including LAN and HTTPS setup.

## 1. Scope and assumptions

- Target OS: Windows 10/11.
- Offline runtime: internet is not required after preparation.
- Network: users connect over the same LAN.
- Project root example: `D:\HSK\GM`.

## 2. What must be prepared online first

You must prepare dependencies and binaries before moving to the offline machine.

- Node.js (same major version you will use offline).
- Python 3.x.
- Visual Studio Build Tools (C++ workload) for native module compatibility.
- Project dependencies (`node_modules`) already installed.
- Optional HTTPS certificate files (`key.pem`, `cert.pem`, optional `ca.pem`).

## 3. Required files/folders to copy to offline PC

Copy the full project directory, including:

- `server\`
- `public\`
- `package.json`
- `package-lock.json`
- `.env` (pre-configured)
- `node_modules\` (critical for offline usage)
- `key.pem` / `cert.pem` (or your `certs\` folder) if using HTTPS

Recommended: zip the folder on online PC, then extract on offline PC.

## 4. Compatibility requirements (important)

`node_modules` contains native components (mediasoup worker path), so online/offline machines must match:

- Windows -> Windows
- Same CPU architecture (x64 -> x64)
- Same Node.js major version

If these do not match, rebuild/install dependencies on the target machine (requires toolchain and usually internet).

## 5. Offline PC setup steps

### 5.1 Place project

- Extract/copy project to `D:\HSK\GM` (or your preferred path).

### 5.2 Configure `.env`

Set at least:

```env
PORT=3000
MEDIASOUP_ANNOUNCED_IP=192.168.1.10
```

Use the offline server LAN IP for `MEDIASOUP_ANNOUNCED_IP`.

### 5.3 Optional HTTPS config

If clients join using LAN IP and need camera/mic reliably, enable HTTPS:

```env
HTTPS_PORT=3443
SSL_KEY_PATH=./key.pem
SSL_CERT_PATH=./cert.pem
# SSL_CA_PATH=./ca.pem
```

Paths can be absolute or project-relative.

## 6. Running the server offline

Open PowerShell:

```powershell
Set-Location D:\HSK\GM
npm start
```

Expected access:

- Same machine: `http://localhost:3000`
- LAN clients (HTTPS recommended): `https://<SERVER_LAN_IP>:3443`

## 7. Firewall rules (Windows)

Allow inbound traffic:

- TCP `3000` (HTTP)
- TCP `3443` (HTTPS, if enabled)
- UDP `40000-49999` (mediasoup media ports)
- TCP `40000-49999` (recommended fallback/compatibility)

Apply to Private profile in Windows Defender Firewall.

## 8. Certificate preparation options

### Option A: Bring existing PEM files

If you already have:

- `key.pem`
- `cert.pem`
- optional CA chain

copy them to offline PC and configure `.env` paths.

### Option B: Generate before going offline

Use mkcert or OpenSSL on an online/prepared machine, then copy files.

Note: client devices must trust the CA/root used to sign the certificate.

## 9. Validation checklist

After startup:

1. Open app on server PC.
2. Create room and verify local camera/mic.
3. Join from another LAN device.
4. Verify audio/video, chat, whiteboard sync.
5. Verify private-room behavior (password and host-accept flows).

## 10. Troubleshooting

### App opens, but no media between devices

- Check `MEDIASOUP_ANNOUNCED_IP` matches server LAN IP.
- Check firewall ports `40000-49999` UDP/TCP.
- Restart server after `.env` changes.

### Camera/mic blocked on LAN URL

- Use HTTPS URL and trusted certificate.
- `http://localhost` works only on the same host.

### Join fails unexpectedly

- Confirm room ID is correct.
- For private room: use password if configured, otherwise wait for host approval.

## 11. Operational recommendations

- Keep one "golden" prepared package (zip) for rapid offline redeploy.
- Keep Node version documented and fixed across deployment PCs.
- Keep `.env` template per site with LAN IP and ports.
- Maintain backup certificates and CA trust instructions for clients.
