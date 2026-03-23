'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const express = require('express');
const mediasoup = require('mediasoup');
const { Server } = require('socket.io');
const { mediaCodecs, getListenIps, getAnnouncedIp } = require('./config');
const { Room } = require('./room');
const { normalizeRoomId } = require('./roomId');
const { normalizeDisplayName } = require('./displayName');

function resolvePort() {
  const arg = process.argv[2];
  if (arg !== undefined && /^\d+$/.test(arg)) {
    const n = Number(arg);
    if (n >= 1 && n <= 65535) return n;
  }
  const env = process.env.PORT;
  if (env !== undefined && env !== '') {
    const n = Number(env);
    if (Number.isInteger(n) && n >= 1 && n <= 65535) return n;
  }
  return 3000;
}

function resolveHttpsPort() {
  const env = process.env.HTTPS_PORT;
  if (env !== undefined && env !== '') {
    const n = Number(env);
    if (Number.isInteger(n) && n >= 1 && n <= 65535) return n;
  }
  return 3443;
}

const PORT = resolvePort();

/** @type {import('mediasoup').types.Worker | null} */
let worker = null;
/** @type {Map<string, Room>} */
const rooms = new Map();
/** @type {Map<string, string>} */
const socketToRoom = new Map();
/** Pending private-room join: socket id → { roomId, requestId } (not yet in socketToRoom). */
/** @type {Map<string, { roomId: string, requestId: string }>} */
const pendingJoinBySocket = new Map();

function getRoom(socketId) {
  const roomId = socketToRoom.get(socketId);
  if (!roomId) return null;
  return rooms.get(roomId) || null;
}

function getPeer(socketId) {
  const room = getRoom(socketId);
  if (!room) return null;
  return room.peers.get(socketId) || null;
}

async function getOrCreateRoom(roomId) {
  if (!worker) {
    throw new Error('mediasoup worker not ready');
  }
  let room = rooms.get(roomId);
  if (!room) {
    const router = await worker.createRouter({ mediaCodecs });
    room = new Room(roomId, router);
    rooms.set(roomId, room);
  }
  return room;
}

async function bootstrap() {
  worker = await mediasoup.createWorker({
    rtcMinPort: 40000,
    rtcMaxPort: 49999,
    logLevel: 'warn',
    logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp'],
  });

  worker.on('died', () => {
    console.error('mediasoup worker died, exiting');
    process.exit(1);
  });

  const app = express();
  app.use(express.static(path.join(__dirname, '..', 'public')));

  const socketIoOpts = { cors: { origin: true, credentials: true } };

  /** @type {import('socket.io').Server | null} */
  let ioHttp = null;
  /** @type {import('socket.io').Server | null} */
  let ioHttps = null;

  function emitRoomExcept(roomId, event, payload, exceptSocketId) {
    if (ioHttp) ioHttp.to(roomId).except(exceptSocketId).emit(event, payload);
    if (ioHttps) ioHttps.to(roomId).except(exceptSocketId).emit(event, payload);
  }

  function emitRoomAll(roomId, event, payload) {
    if (ioHttp) ioHttp.to(roomId).emit(event, payload);
    if (ioHttps) ioHttps.to(roomId).emit(event, payload);
  }

  function randomRequestId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
  }

  /** @param {unknown} raw */
  function normalizeWhiteboardLine(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const o = {};
    for (const k of ['x0', 'y0', 'x1', 'y1']) {
      const n = Number(/** @type {Record<string, unknown>} */ (raw)[k]);
      if (!Number.isFinite(n) || n < 0 || n > 1) return null;
      o[k] = n;
    }
    let color = typeof /** @type {Record<string, unknown>} */ (raw).color === 'string' ? String(raw.color).trim() : '#ffffff';
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) color = '#ffffff';
    const w = Number(/** @type {Record<string, unknown>} */ (raw).width);
    const width = Number.isFinite(w) ? Math.min(48, Math.max(1, w)) : 3;
    const tool = /** @type {Record<string, unknown>} */ (raw).tool === 'eraser' ? 'eraser' : 'pen';
    return { ...o, color, width, tool };
  }

  function whiteboardSnapshotForRoom(room) {
    const max = 4500;
    if (room.whiteboardLines.length <= max) return room.whiteboardLines.slice();
    return room.whiteboardLines.slice(-max);
  }

  /**
   * @param {unknown} raw
   * @returns {{ open: boolean, drawing: boolean } | null}
   */
  function normalizeWhiteboardPresence(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const src = /** @type {Record<string, unknown>} */ (raw);
    return {
      open: Boolean(src.open),
      drawing: Boolean(src.drawing),
    };
  }

  /**
   * @param {unknown} raw
   * @returns {string}
   */
  function normalizePrivatePassword(raw) {
    if (typeof raw !== 'string') return '';
    return raw.trim().slice(0, 128);
  }

  function getSocketById(id) {
    if (ioHttp) {
      const s = ioHttp.sockets.sockets.get(id);
      if (s) return s;
    }
    if (ioHttps) {
      const s = ioHttps.sockets.sockets.get(id);
      if (s) return s;
    }
    return undefined;
  }

  function emitToHost(hostId, event, payload) {
    if (ioHttp) ioHttp.to(hostId).emit(event, payload);
    if (ioHttps) ioHttps.to(hostId).emit(event, payload);
  }

  function rejectAllPendingJoins(room, reason) {
    if (!room.pendingJoins.size) return;
    for (const [, p] of room.pendingJoins) {
      pendingJoinBySocket.delete(p.socketId);
      const s = getSocketById(p.socketId);
      if (s) s.emit('joinRejected', { reason: reason || 'Request cancelled' });
    }
    room.pendingJoins.clear();
  }

  function bindConnectionHandlers(io) {
    io.on('connection', (socket) => {
    // Named roomJoin — avoid confusion with Socket.IO's socket.join(room) room API.
    socket.on(
      'roomJoin',
      async (
        {
          roomId: rawRoomId,
          displayName: rawDisplayName,
          visibility: rawVisibility,
          privatePassword: rawPrivatePassword,
          createIfMissing: rawCreateIfMissing,
        },
        callback,
      ) => {
        if (typeof callback !== 'function') return;
        const normalized = normalizeRoomId(rawRoomId);
        if (!normalized.ok) {
          callback({ error: normalized.error });
          return;
        }
        const roomId = normalized.id;
        if (socketToRoom.has(socket.id) || pendingJoinBySocket.has(socket.id)) {
          callback({ error: 'Already in a room' });
          return;
        }
        const displayName = normalizeDisplayName(rawDisplayName);
        const visibility = rawVisibility === 'private' ? 'private' : 'public';
        const privatePassword = normalizePrivatePassword(rawPrivatePassword);
        const createIfMissing = Boolean(rawCreateIfMissing);
        try {
          let room = rooms.get(roomId) || null;
          if (!room && !createIfMissing) {
            callback({ error: 'Room not found', code: 'ROOM_NOT_FOUND' });
            return;
          }
          if (!room) {
            room = await getOrCreateRoom(roomId);
          }

          if (room.peers.size === 0) {
            room.isPrivate = visibility === 'private';
            room.privatePassword = room.isPrivate ? privatePassword : '';
            room.hostId = socket.id;
          } else if (room.isPrivate && socket.id !== room.hostId) {
            const passwordJoinOk = !!room.privatePassword && privatePassword === room.privatePassword;
            if (!passwordJoinOk) {
              const requestId = randomRequestId();
              room.pendingJoins.set(requestId, { socketId: socket.id, displayName });
              pendingJoinBySocket.set(socket.id, { roomId, requestId });
              emitToHost(room.hostId, 'joinRequest', {
                requestId,
                peerId: socket.id,
                displayName,
                roomId,
              });
              callback({ pending: true, requestId });
              return;
            }
          }

          room.addPeer(socket.id, displayName);
          socket.join(roomId);
          socketToRoom.set(socket.id, roomId);

          const existingProducers = room.getExistingProducersFor(socket.id);
          const peerNames = room.getPeerDisplayNames(socket.id);
          emitRoomExcept(roomId, 'peerJoined', { peerId: socket.id, displayName }, socket.id);

          callback({
            roomId,
            yourName: displayName,
            peerNames,
            routerRtpCapabilities: room.router.rtpCapabilities,
            existingProducers,
            isHost: room.hostId === socket.id,
            roomVisibility: room.isPrivate ? 'private' : 'public',
            hasPrivatePassword: room.isPrivate ? Boolean(room.privatePassword) : false,
            whiteboardSnapshot: whiteboardSnapshotForRoom(room),
            whiteboardPresence: room.getWhiteboardPresence(socket.id),
          });
        } catch (err) {
          console.error('join error', err);
          callback({ error: err.message || 'join failed' });
        }
      },
    );

    socket.on('acceptJoinRequest', ({ requestId }, callback) => {
      if (typeof callback !== 'function') return;
      const roomId = socketToRoom.get(socket.id);
      const room = roomId ? rooms.get(roomId) : null;
      if (!room || room.hostId !== socket.id) {
        callback({ error: 'Only the host can accept' });
        return;
      }
      if (typeof requestId !== 'string' || !room.pendingJoins.has(requestId)) {
        callback({ error: 'Request not found' });
        return;
      }
      const pending = room.pendingJoins.get(requestId);
      if (!pending) {
        callback({ error: 'Request not found' });
        return;
      }
      const pendingSocket = getSocketById(pending.socketId);
      if (!pendingSocket) {
        room.pendingJoins.delete(requestId);
        pendingJoinBySocket.delete(pending.socketId);
        callback({ error: 'User disconnected' });
        return;
      }
      room.pendingJoins.delete(requestId);
      pendingJoinBySocket.delete(pending.socketId);

      room.addPeer(pending.socketId, pending.displayName);
      pendingSocket.join(roomId);
      socketToRoom.set(pending.socketId, roomId);

      const peerNames = room.getPeerDisplayNames(pending.socketId);
      const existingProducers = room.getExistingProducersFor(pending.socketId);
      pendingSocket.emit('joinApproved', {
        roomId,
        yourName: pending.displayName,
        peerNames,
        routerRtpCapabilities: room.router.rtpCapabilities,
        existingProducers,
        isHost: false,
        roomVisibility: room.isPrivate ? 'private' : 'public',
        hasPrivatePassword: room.isPrivate ? Boolean(room.privatePassword) : false,
        whiteboardSnapshot: whiteboardSnapshotForRoom(room),
        whiteboardPresence: room.getWhiteboardPresence(pending.socketId),
      });
      emitRoomExcept(
        roomId,
        'peerJoined',
        { peerId: pending.socketId, displayName: pending.displayName },
        pending.socketId,
      );
      callback({});
    });

    socket.on('rejectJoinRequest', ({ requestId }, callback) => {
      if (typeof callback !== 'function') return;
      const roomId = socketToRoom.get(socket.id);
      const room = roomId ? rooms.get(roomId) : null;
      if (!room || room.hostId !== socket.id) {
        callback({ error: 'Only the host can reject' });
        return;
      }
      if (typeof requestId !== 'string' || !room.pendingJoins.has(requestId)) {
        callback({ error: 'Request not found' });
        return;
      }
      const pending = room.pendingJoins.get(requestId);
      if (!pending) {
        callback({ error: 'Request not found' });
        return;
      }
      room.pendingJoins.delete(requestId);
      pendingJoinBySocket.delete(pending.socketId);
      const pendingSocket = getSocketById(pending.socketId);
      if (pendingSocket) {
        pendingSocket.emit('joinRejected', { reason: 'Host declined your request' });
      }
      callback({});
    });

    socket.on('kickPeer', ({ peerId: targetPeerId }, callback) => {
      if (typeof callback !== 'function') return;
      const roomId = socketToRoom.get(socket.id);
      const room = roomId ? rooms.get(roomId) : null;
      if (!room || room.hostId !== socket.id) {
        callback({ error: 'Only the host can remove participants' });
        return;
      }
      if (typeof targetPeerId !== 'string' || targetPeerId === socket.id) {
        callback({ error: 'Invalid participant' });
        return;
      }
      if (targetPeerId === room.hostId) {
        callback({ error: 'Cannot remove the host' });
        return;
      }
      if (!room.peers.has(targetPeerId)) {
        callback({ error: 'Participant not in room' });
        return;
      }
      const targetSocket = getSocketById(targetPeerId);
      socketToRoom.delete(targetPeerId);
      room.removePeer(targetPeerId);
      emitRoomExcept(roomId, 'peerLeft', { peerId: targetPeerId }, targetPeerId);
      if (targetSocket) {
        targetSocket.leave(roomId);
        targetSocket.emit('kicked', { reason: 'The host removed you from the meeting' });
      }
      callback({});
    });

    socket.on('whiteboardLine', (payload, callback) => {
      if (typeof callback !== 'function') return;
      const roomId = socketToRoom.get(socket.id);
      const room = roomId ? rooms.get(roomId) : null;
      if (!room || !getPeer(socket.id)) {
        callback({ error: 'Not in a room' });
        return;
      }
      const line = normalizeWhiteboardLine(payload && payload.line);
      if (!line) {
        callback({ error: 'Invalid stroke' });
        return;
      }
      room.whiteboardLines.push(line);
      if (room.whiteboardLines.length > 5000) {
        room.whiteboardLines.splice(0, room.whiteboardLines.length - 5000);
      }
      emitRoomExcept(roomId, 'whiteboardLine', { line, peerId: socket.id }, socket.id);
      callback({});
    });

    socket.on('whiteboardClear', (_, callback) => {
      if (typeof callback !== 'function') return;
      const roomId = socketToRoom.get(socket.id);
      const room = roomId ? rooms.get(roomId) : null;
      if (!room || !getPeer(socket.id)) {
        callback({ error: 'Not in a room' });
        return;
      }
      room.whiteboardLines = [];
      emitRoomAll(roomId, 'whiteboardClear', {});
      callback({});
    });

    socket.on('whiteboardPresence', (payload, callback) => {
      if (typeof callback !== 'function') return;
      const roomId = socketToRoom.get(socket.id);
      const room = roomId ? rooms.get(roomId) : null;
      if (!room || !getPeer(socket.id)) {
        callback({ error: 'Not in a room' });
        return;
      }
      const presence = normalizeWhiteboardPresence(payload);
      if (!presence) {
        callback({ error: 'Invalid whiteboard state' });
        return;
      }
      room.setWhiteboardPresence(socket.id, presence);
      emitRoomExcept(roomId, 'whiteboardPresence', { peerId: socket.id, ...presence }, socket.id);
      callback({});
    });

    socket.on('createTransport', async ({ direction }, callback) => {
      if (typeof callback !== 'function') return;
      const room = getRoom(socket.id);
      const peer = getPeer(socket.id);
      if (!room || !peer) {
        callback({ error: 'Not in a room' });
        return;
      }
      if (direction !== 'send' && direction !== 'recv') {
        callback({ error: 'Invalid direction' });
        return;
      }
      try {
        const transport = await room.router.createWebRtcTransport({
          listenIps: getListenIps(),
          enableUdp: true,
          enableTcp: true,
          preferUdp: true,
        });
        peer.transports.set(transport.id, transport);
        transport.on('dtlsstatechange', (dtlsState) => {
          if (dtlsState === 'closed') transport.close();
        });
        transport.on('@close', () => {
          peer.transports.delete(transport.id);
        });
        callback({
          direction,
          transportId: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters,
        });
      } catch (err) {
        console.error('createTransport', err);
        callback({ error: err.message || 'createTransport failed' });
      }
    });

    socket.on('connectTransport', async ({ transportId, dtlsParameters }, callback) => {
      if (typeof callback !== 'function') return;
      const peer = getPeer(socket.id);
      if (!peer) {
        callback({ error: 'Not in a room' });
        return;
      }
      const transport = peer.transports.get(transportId);
      if (!transport) {
        callback({ error: 'Transport not found' });
        return;
      }
      try {
        await transport.connect({ dtlsParameters });
        callback({});
      } catch (err) {
        console.error('connectTransport', err);
        callback({ error: err.message || 'connectTransport failed' });
      }
    });

    socket.on('produce', async ({ transportId, kind, rtpParameters, appData: rawAppData }, callback) => {
      if (typeof callback !== 'function') return;
      const room = getRoom(socket.id);
      const peer = getPeer(socket.id);
      if (!room || !peer) {
        callback({ error: 'Not in a room' });
        return;
      }
      const transport = peer.transports.get(transportId);
      if (!transport) {
        callback({ error: 'Transport not found' });
        return;
      }
      const appData =
        rawAppData && typeof rawAppData === 'object' && !Array.isArray(rawAppData) ? rawAppData : {};
      try {
        const producer = await transport.produce({ kind, rtpParameters, appData });
        peer.producers.set(producer.id, producer);
        producer.on('transportclose', () => {
          peer.producers.delete(producer.id);
        });
        producer.observer.once('close', () => {
          peer.producers.delete(producer.id);
          emitRoomExcept(
            room.roomId,
            'producerClosed',
            { peerId: socket.id, producerId: producer.id },
            socket.id,
          );
        });
        emitRoomExcept(
          room.roomId,
          'newProducer',
          {
            peerId: socket.id,
            producerId: producer.id,
            kind: producer.kind,
            displayName: peer.displayName || 'Guest',
            appData: producer.appData || {},
          },
          socket.id,
        );
        callback({ id: producer.id });
      } catch (err) {
        console.error('produce', err);
        callback({ error: err.message || 'produce failed' });
      }
    });

    /** Browser producer.close() does not always sync to the Node Producer — peers need this to tear down consumers. */
    socket.on('closeProducer', ({ producerId }, callback) => {
      if (typeof callback !== 'function') return;
      const room = getRoom(socket.id);
      const peer = getPeer(socket.id);
      if (!room || !peer) {
        callback({ error: 'Not in a room' });
        return;
      }
      if (typeof producerId !== 'string') {
        callback({ error: 'Invalid producerId' });
        return;
      }
      const producer = peer.producers.get(producerId);
      if (!producer || producer.closed) {
        callback({});
        return;
      }
      try {
        producer.close();
        callback({});
      } catch (err) {
        console.error('closeProducer', err);
        callback({ error: err.message || 'closeProducer failed' });
      }
    });

    socket.on('consume', async ({ transportId, producerId, rtpCapabilities }, callback) => {
      if (typeof callback !== 'function') return;
      const room = getRoom(socket.id);
      const peer = getPeer(socket.id);
      if (!room || !peer) {
        callback({ error: 'Not in a room' });
        return;
      }
      const transport = peer.transports.get(transportId);
      if (!transport) {
        callback({ error: 'Transport not found' });
        return;
      }
      const producer = room.findProducerById(producerId);
      if (!producer) {
        callback({ error: 'Producer not found' });
        return;
      }
      try {
        if (
          !room.router.canConsume({
            producerId,
            rtpCapabilities,
          })
        ) {
          callback({ error: 'Cannot consume' });
          return;
        }
        const consumer = await transport.consume({
          producerId,
          rtpCapabilities,
          paused: true,
        });
        peer.consumers.set(consumer.id, consumer);
        consumer.on('transportclose', () => {
          peer.consumers.delete(consumer.id);
        });
        callback({
          id: consumer.id,
          producerId,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
          type: consumer.type,
          producerPaused: consumer.producerPaused,
        });
      } catch (err) {
        console.error('consume', err);
        callback({ error: err.message || 'consume failed' });
      }
    });

    socket.on('resumeConsumer', async ({ consumerId }, callback) => {
      if (typeof callback !== 'function') return;
      const peer = getPeer(socket.id);
      if (!peer) {
        callback({ error: 'Not in a room' });
        return;
      }
      const consumer = peer.consumers.get(consumerId);
      if (!consumer) {
        callback({ error: 'Consumer not found' });
        return;
      }
      try {
        await consumer.resume();
        callback({});
      } catch (err) {
        console.error('resumeConsumer', err);
        callback({ error: err.message || 'resumeConsumer failed' });
      }
    });

    socket.on('chatMessage', ({ text }, callback) => {
      if (typeof callback !== 'function') return;
      const roomId = socketToRoom.get(socket.id);
      if (!roomId) {
        callback({ error: 'Not in a room' });
        return;
      }
      const peer = getPeer(socket.id);
      const t = typeof text === 'string' ? text.trim() : '';
      if (!t || t.length > 2000) {
        callback({ error: 'Invalid message' });
        return;
      }
      emitRoomAll(roomId, 'chatMessage', {
        peerId: socket.id,
        displayName: peer ? peer.displayName || 'Guest' : 'Guest',
        text: t,
        ts: Date.now(),
      });
      callback({});
    });

    socket.on('disconnect', () => {
      const pend = pendingJoinBySocket.get(socket.id);
      if (pend) {
        pendingJoinBySocket.delete(socket.id);
        const room = rooms.get(pend.roomId);
        if (room) {
          room.pendingJoins.delete(pend.requestId);
          if (room.hostId) {
            emitToHost(room.hostId, 'joinRequestRemoved', {
              requestId: pend.requestId,
              peerId: socket.id,
            });
          }
        }
        return;
      }

      const roomId = socketToRoom.get(socket.id);
      if (!roomId) return;
      const room = rooms.get(roomId);
      if (!room) {
        socketToRoom.delete(socket.id);
        return;
      }

      const wasHost = room.hostId === socket.id;

      socketToRoom.delete(socket.id);
      room.removePeer(socket.id);
      emitRoomExcept(roomId, 'peerLeft', { peerId: socket.id }, socket.id);

      if (room.peers.size === 0) {
        rejectAllPendingJoins(room, 'Room closed');
        room.router.close();
        rooms.delete(roomId);
        return;
      }

      if (wasHost) {
        const nextHost = [...room.peers.keys()][0];
        room.hostId = nextHost;
        emitRoomAll(roomId, 'hostChanged', { hostId: room.hostId });
        for (const [rid, p] of [...room.pendingJoins]) {
          emitToHost(room.hostId, 'joinRequest', {
            requestId: rid,
            peerId: p.socketId,
            displayName: p.displayName,
            roomId,
          });
        }
      }
    });
  });
  }

  const httpServer = http.createServer(app);
  ioHttp = new Server(httpServer, socketIoOpts);
  bindConnectionHandlers(ioHttp);

  const keyPath = process.env.SSL_KEY_PATH;
  const certPath = process.env.SSL_CERT_PATH;
  if (keyPath && certPath) {
    const httpsPort = resolveHttpsPort();
    if (httpsPort === PORT) {
      console.warn('HTTPS_PORT equals PORT; use different ports for HTTP and HTTPS.');
    }
    try {
      const key = fs.readFileSync(path.resolve(keyPath));
      const cert = fs.readFileSync(path.resolve(certPath));
      const caPath = process.env.SSL_CA_PATH;
      /** @type {import('https').ServerOptions} */
      const opts = { key, cert };
      if (caPath) {
        opts.ca = fs.readFileSync(path.resolve(caPath));
      }
      const httpsServer = https.createServer(opts, app);
      ioHttps = new Server(httpsServer, socketIoOpts);
      bindConnectionHandlers(ioHttps);
      httpsServer.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.error(`HTTPS port ${httpsPort} is already in use.`);
          process.exit(1);
        }
        throw err;
      });
      httpsServer.listen(httpsPort, () => {
        console.log(`HTTPS + Socket.IO on https://localhost:${httpsPort}`);
      });
    } catch (err) {
      console.error('Could not start HTTPS (check SSL_KEY_PATH / SSL_CERT_PATH):', err.message);
      ioHttps = null;
    }
  }

  httpServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use.`);
      console.error('Pick another port, e.g. npm start -- 3001');
      console.error('(PowerShell: $env:PORT=3001; npm start)');
      process.exit(1);
    }
    throw err;
  });

  httpServer.listen(PORT, () => {
    console.log(`HTTP + Socket.IO on http://localhost:${PORT}`);
    if (!ioHttps) {
      console.log('(Optional) Set SSL_KEY_PATH + SSL_CERT_PATH for HTTPS on HTTPS_PORT (default 3443).');
    }
    console.log(`mediasoup announced ICE IP: ${getAnnouncedIp()} (set MEDIASOUP_ANNOUNCED_IP for LAN clients)`);
  });
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
