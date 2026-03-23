# GM Code Explanation

This document explains how the current GM application works end-to-end.

## 1. High-level architecture

The app has two major parts:

- Server (`server/`) for room state, signaling, and mediasoup router/transport/producers/consumers.
- Client (`public/`) for UI, media capture, signaling actions, and rendering.

Main runtime technologies:

- Express static hosting
- Socket.IO signaling
- mediasoup SFU
- mediasoup-client in browser

## 2. Server flow (`server/index.js`)

### 2.1 Startup

- Loads `.env`.
- Creates mediasoup worker with configured media port range (`40000-49999`).
- Starts HTTP server and optional HTTPS server if `SSL_KEY_PATH`/`SSL_CERT_PATH` are configured.

### 2.2 Room and peer state

Room state is held in memory:

- peers
- host id
- private room settings
- pending join requests
- whiteboard lines and whiteboard presence

### 2.3 Join flow

`roomJoin` handles create/join behavior:

- `createIfMissing=true`: room can be created.
- `createIfMissing=false`: unknown room returns `ROOM_NOT_FOUND`.
- private room:
  - correct password -> direct join
  - otherwise -> pending host acceptance flow

### 2.4 Media signaling flow

Client requests:

1. `createTransport` (`send` and `recv`)
2. `connectTransport`
3. `produce` for camera/mic/screen
4. `consume` for remote producers
5. `resumeConsumer`

Server emits:

- `newProducer`
- `producerClosed`
- `peerJoined`
- `peerLeft`

### 2.5 Whiteboard signaling

- `whiteboardLine`: normalized stroke relay + room history append.
- `whiteboardClear`: clears room whiteboard history.
- `whiteboardPresence`: per-peer open/drawing state for indicators.

## 3. Client flow (`public/app.js`)

### 3.1 Join/Create UX

- Top bar has launcher buttons.
- Join/Create actions happen inside modal.
- Join checks room existence (no implicit create).
- Not-found join opens a dedicated Room Not Found modal.

### 3.2 Connection sequence

`joinRoom()` does:

1. local environment checks
2. acquire media promise
3. connect Socket.IO
4. send `roomJoin`
5. load mediasoup `Device`
6. create recv/send transports
7. publish local tracks (if available)
8. consume existing producers
9. bind runtime event listeners

### 3.3 Private room behavior

Private room supports two entry methods in one room:

- password
- host approval

Password is optional for host-created private room; without correct password, request goes to host queue.

### 3.4 Whiteboard UI and state

Client whiteboard features:

- drawing and erasing
- clear all
- replay from snapshot
- responsive resize
- live sync via socket events

Participant indicator behavior:

- whiteboard open -> blue
- whiteboard drawing -> red

## 4. UI structure (`public/index.html`, `public/styles.css`)

Main UI areas:

- top bar (brand, launch buttons, session strip, status)
- people panel
- stage (local + remote tiles)
- side panels (whiteboard/chat)
- bottom control bar
- modals (join/create, room not found)

Styling theme:

- dark UI with gradient accents
- rounded controls
- modal glass-like surface
- visual states for chat, whiteboard, mic/camera/screen

## 5. Offline bundle and runtime scripts

Offline packaging support files:

- `tools/prepare-offline-win-node22.ps1`
- `tools/prepare-offline-ubuntu-node22.sh`
- `tools/verify-offline-bundle.ps1`
- `tools/verify-offline-bundle.sh`
- `run-offline-win.ps1`
- `run-offline-linux.sh`

Purpose:

- produce OS-specific Node runtime + `node_modules`
- verify bundle completeness
- run server offline without global Node install

## 6. Current known limitations

- In-memory room state (no persistence across restart).
- No formal auth/rate-limiting layer yet.
- Limited automated test coverage for newer join branches and modal behavior.

## 7. Recommended next improvements

1. Add integration tests for create/join/private/not-found flows.
2. Add event payload schema validation.
3. Add basic rate limiting for signaling endpoints.
4. Add modal focus trap and focus return for accessibility.
