# GM Offline/LAN Install Guide (Windows)

This guide explains how to run this project on a local network without internet access during usage.

## 1) What requires internet vs what does not

- Runtime calls (meeting, chat, whiteboard) on your LAN: **no internet required**.
- Initial dependency setup (`npm install`) usually needs internet unless you prepare an offline package/cache first.

## 2) Prerequisites (one-time)

Install these on the server machine:

- Node.js LTS
- Python 3.x
- Visual Studio Build Tools (C++ workload) for `node-gyp` / mediasoup worker build

Project path examples in this guide use:

- `D:\HSK\GM`

## 3) First-time project setup

Open PowerShell:

```powershell
Set-Location D:\HSK\GM
npm install
Copy-Item .env.example .env
```

Edit `.env` and set:

```env
PORT=3000
MEDIASOUP_ANNOUNCED_IP=192.168.1.10
```

Replace `192.168.1.10` with your server machine LAN IPv4 (`ipconfig` to check).

## 4) Optional but recommended: HTTPS for LAN camera/mic

Browsers usually block camera/mic on plain `http://<LAN-IP>`.
For other devices on your LAN, use HTTPS:

```env
HTTPS_PORT=3443
SSL_KEY_PATH=./certs/key.pem
SSL_CERT_PATH=./certs/cert.pem
```

Generate certs with mkcert (recommended) and trust the local CA on each client device.

## 5) Firewall rules (important)

Allow inbound on the server machine:

- Web ports: TCP `3000` (HTTP), `3443` (HTTPS if used)
- mediasoup ports: UDP `40000-49999`
- mediasoup fallback/transport: TCP `40000-49999` (recommended to allow)

If signaling works but media does not, firewall/port rules are the first thing to verify.

## 6) Run the server

```powershell
Set-Location D:\HSK\GM
npm start
```

Open from clients:

- Same PC: `http://localhost:3000`
- Other LAN devices (recommended): `https://<SERVER_LAN_IP>:3443`

## 7) Offline install strategy for additional machines

If a machine has no internet, you must pre-stage dependencies:

- Option A: Copy project with `node_modules` from a machine with the same OS/arch and same Node major version.
- Option B: Prepare npm offline cache/tarballs on an internet machine, then install from that cache internally.

Do not mix binaries across different OS/Node versions for mediasoup native modules.

## 8) Troubleshooting quick checks

- Page not opening: server down, wrong IP/port, or TCP firewall blocked.
- Chat works but no media: wrong `MEDIASOUP_ANNOUNCED_IP` or `40000-49999` blocked.
- Camera permission denied on LAN IP: use HTTPS and trusted certificate.

## 9) Minimal startup checklist

1. `npm install` done at least once with dependencies available.
2. `.env` exists and `MEDIASOUP_ANNOUNCED_IP` is correct.
3. Firewall allows required TCP/UDP ports.
4. Start server with `npm start`.
5. Clients join same room ID.
