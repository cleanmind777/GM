# GM

Local-network video meetings: **mediasoup** (SFU) with **Socket.IO** signaling. No Docker required.

## Camera / microphone not working?

Browsers **only** allow `getUserMedia` on a **secure context**:

- **`https://`** (any hostname), or  
- **`http://localhost`**, **`http://127.0.0.1`**, **`http://[::1]`** only.

If you open **`http://192.168.x.x`** or **`http://<public-ip>`** (plain HTTP on a LAN or VPS IP), **Chrome/Edge/Firefox will block camera and microphone**. Create/join will fail after connecting because the app cannot acquire media.

**What to do:** use **`http://localhost:PORT` on the PC that runs the server**, or use **HTTPS**.

### Testing with HTTP only (no HTTPS)

For local testing you can stay on **plain HTTP** — you do **not** need `SSL_KEY_PATH`, `SSL_CERT_PATH`, or `HTTPS_PORT`.

1. Run `npm start` (default **http://localhost:3000**).
2. Open **`http://localhost:3000`** in the browser (or `http://127.0.0.1:3000`). That is a **secure enough** address for camera/mic.
3. Use **Create room** / **Join** in **two tabs** or two windows on **this same PC** so both use the same `localhost` URL.

Do **not** use `http://<LAN-IP>:3000` for testing camera/mic unless you add HTTPS or a tunnel — the browser will block media on plain HTTP for non-localhost hosts.

### HTTPS built into this server (optional)

The Node process can listen on **HTTP** and **HTTPS** at the same time:

- **HTTP:** `PORT` (default 3000) — fine for `localhost`.
- **HTTPS:** set **`SSL_KEY_PATH`** and **`SSL_CERT_PATH`** in `.env` (PEM files). The server also listens on **`HTTPS_PORT`** (default **3443**). Open **`https://<your-ip>:3443`** on phones or other PCs so the browser allows camera/mic.

Example `.env` lines (after you create or copy cert/key files):

```env
SSL_KEY_PATH=./certs/key.pem
SSL_CERT_PATH=./certs/cert.pem
HTTPS_PORT=3443
```

You can use **[mkcert](https://github.com/FiloSottile/mkcert)** to generate a local CA and certs for your LAN hostname/IP.

## Requirements

- **Node.js** LTS
- **Windows:** [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) (C++ workload) and Python 3.x so `mediasoup` can compile its worker (`node-gyp`). See [mediasoup installation](https://mediasoup.org/documentation/v3/mediasoup/installation/).

## Setup

```bash
npm install
cp .env.example .env   # optional: edit .env for PORT and MEDIASOUP_ANNOUNCED_IP
npm start
```

On Windows, copy `.env.example` to `.env` in Explorer or: `copy .env.example .env`

Open `http://localhost:3000` (or set the port). The client bundle is built automatically on `npm install` (`postinstall`).

**Port:** `PORT` env var, or pass a number: `npm start -- 3001`. On PowerShell you can also use `$env:PORT=3001; npm start` (no `npm start -port` — that is not an npm option).

## How to create a room and join

A **room** is a string ID (like a meeting code). Use **Create room** for a random id, or type your own and use **Join**.

1. **Start the server** (`npm start`) and open the app in a browser (for example `http://localhost:3000`, or `http://<your-LAN-IP>:3000` on other devices).

2. **Pick a room id** — type a label in the **Room** field (for example `team-sync` or `my room`). Spaces are turned into hyphens; only letters, numbers, `_`, and `-` are kept (up to 64 characters). Two tabs must end up with the **same** id to be in one call.

3. **Create room** — click **Create room** to get a random room id and connect (share or copy that id for others). Or type an id yourself and click **Join**. The first person to use an id **creates** the room on the server; anyone else using the **same** id **joins** the same call.

4. After **Join**, a **Connected** bar shows the **room id** you are in (and **Copy id**). Use the **Chat** panel to send text to everyone in that room — if two tabs share the same id, messages should appear in both.

5. You should see **You** (your camera) and, when others are in the same room, their video tiles. Use **Leave** to stop your camera and disconnect.

**Quick test with two people**

- **Same PC:** open two browser windows (or one normal window and one private/incognito), go to the same URL. In the first tab click **Create room**, then **Copy id** (or note the id). In the second tab paste that id into **Room** and click **Join** — or type the same id manually in both and **Join** each.

- **Different devices on the LAN:** set `MEDIASOUP_ANNOUNCED_IP` in `.env`, then on each device open `http://<server-PC-LAN-IP>:PORT`, enter the **same** room id, and click **Join**.

## LAN / other devices

1. Set **`MEDIASOUP_ANNOUNCED_IP`** to this machine’s IPv4 address on the LAN (e.g. `192.168.1.10`). Otherwise mediasoup may advertise `127.0.0.1` and other devices cannot complete WebRTC.

2. Open `http://<that-ip>:3000` from other PCs or phones on the same network.

3. Browsers often require **HTTPS** for camera/mic when not on `localhost`. For strict environments, put the app behind HTTPS (reverse proxy or dev certs).

## Public server (VPS / cloud)

Set **`MEDIASOUP_ANNOUNCED_IP`** to the **public IPv4** clients use to reach this host (matches ICE candidates in browser devtools, e.g. `95.x.x.x`). Open the host firewall and cloud security group for **UDP and TCP** on the mediasoup port range (**40000–49999** by default in `server/index.js`). Without that, signaling can succeed (`roomJoin`, `createTransport`) while media never connects.

## Scripts

| Script        | Action                                      |
|---------------|---------------------------------------------|
| `npm start`   | Run `server/index.js`                       |
| `npm run dev` | Rebuild client bundle, then start server    |
| `npm run build:client` | Rebuild `public/app.bundle.js` only |
