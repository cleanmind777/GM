import { io } from 'socket.io-client';
import { Device } from 'mediasoup-client';
import { normalizeRoomId } from '../server/roomId.js';
import { normalizeDisplayName } from '../server/displayName.js';

const displayNameInput = document.getElementById('displayName');
const roomInput = document.getElementById('roomId');
const createBtn = document.getElementById('createBtn');
const joinBtn = document.getElementById('joinBtn');
const leaveBtn = document.getElementById('leaveBtn');
const statusEl = document.getElementById('status');
const sessionInfo = document.getElementById('sessionInfo');
const activeRoomIdEl = document.getElementById('activeRoomId');
const copyRoomBtn = document.getElementById('copyRoomBtn');
const copyInviteBtn = document.getElementById('copyInviteBtn');
const chatPanel = document.getElementById('chatPanel');
const participantList = document.getElementById('participantList');
const peoplePanel = document.getElementById('peoplePanel');
const chatMessages = document.getElementById('chatMessages');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const chatSendBtn = document.getElementById('chatSendBtn');
const localVideo = document.getElementById('localVideo');
const localCameraTile = document.getElementById('localCameraTile');
const localScreenTile = document.getElementById('localScreenTile');
const localScreenVideo = document.getElementById('localScreenVideo');
const localViewOnlyLabel = document.getElementById('localViewOnlyLabel');
const localPeerLabel = document.getElementById('localPeerLabel');
const remoteVideos = document.getElementById('remoteVideos');
const remoteAudioSink = document.getElementById('remoteAudioSink');
const screenShareBtn = document.getElementById('screenShareBtn');
const micToggleBtn = document.getElementById('micToggleBtn');
const cameraToggleBtn = document.getElementById('cameraToggleBtn');
const meetControlBar = document.getElementById('meetControlBar');
const meetJoinRow = document.getElementById('meetJoinRow');
const chatToggleBtn = document.getElementById('chatToggleBtn');
const chatCloseBtn = document.getElementById('chatCloseBtn');
const secureContextBanner = document.getElementById('secureContextBanner');
const secureContextHost = document.getElementById('secureContextHost');
const roomVisibilityBadge = document.getElementById('roomVisibilityBadge');
const roomVisibilityText = document.getElementById('roomVisibilityText');
const joinRequestHostPanel = document.getElementById('joinRequestHostPanel');
const joinRequestHostList = document.getElementById('joinRequestHostList');
const whiteboardPanel = document.getElementById('whiteboardPanel');
const whiteboardToggleBtn = document.getElementById('whiteboardToggleBtn');
const whiteboardCloseBtn = document.getElementById('whiteboardCloseBtn');
const whiteboardCanvas = document.getElementById('whiteboardCanvas');
const whiteboardCanvasWrap = document.getElementById('whiteboardCanvasWrap');
const whiteboardColorInput = document.getElementById('whiteboardColor');
const whiteboardSizeInput = document.getElementById('whiteboardSize');
const whiteboardPenBtn = document.getElementById('whiteboardPenBtn');
const whiteboardEraserBtn = document.getElementById('whiteboardEraserBtn');
const whiteboardClearBtn = document.getElementById('whiteboardClearBtn');

/** @type {string | null} */
let activeRoomId = null;
/** True when this client is the meeting host (can remove others). Updated on hostChanged. */
let isRoomHost = false;

/** @type {import('socket.io-client').Socket | null} */
let socket = null;
/** @type {import('mediasoup-client').types.Device | null} */
let device = null;
/** @type {import('mediasoup-client').types.Transport | null} */
let sendTransport = null;
/** @type {import('mediasoup-client').types.Transport | null} */
let recvTransport = null;
/** @type {MediaStream | null} */
let localStream = null;

/** Remote video: one tile per producer (camera + screen are separate producers). */
/** @type {Map<string, HTMLVideoElement>} */
const remoteVideoByProducer = new Map();
/** @type {Map<string, MediaStream>} */
const remoteVideoStreams = new Map();
/** @type {Map<string, HTMLAudioElement>} */
const peerAudioEls = new Map();
/** @type {Map<string, MediaStream>} */
const peerAudioStreams = new Map();
/** @type {Map<string, string>} */
const peerDisplayNames = new Map();

/** Maps server producer id → peer id (for refresh when a producer closes without a video tile). */
/** @type {Map<string, string>} */
const producerIdToPeerId = new Map();

/** Per-remote-peer visibility for camera vs screen tiles (local UI only). */
/** @type {Map<string, { camera: boolean, screen: boolean }>} */
const peerTileVisibility = new Map();

/**
 * Derive camera / screen / mic status for a remote peer from current consumers and tiles.
 * @param {string} peerId
 */
function computePeerRemoteMedia(peerId) {
  let camera = false;
  let screen = false;
  if (remoteVideos) {
    for (const t of remoteVideos.querySelectorAll('.tile.remote-peer')) {
      if (t.dataset.peerId !== peerId) continue;
      if (t.classList.contains('remote-peer-screen')) {
        screen = true;
      } else if (t.classList.contains('remote-peer-placeholder')) {
        continue;
      } else {
        const vid = t.querySelector('video');
        const vs = vid?.srcObject;
        const vt = vs?.getVideoTracks?.()?.[0];
        if (!vt || vt.readyState !== 'live') continue;
        const sawMedia = t.dataset.cameraLive === '1';
        const senderPaused = sawMedia && (vt.muted || !vt.enabled);
        if (!senderPaused) camera = true;
      }
    }
  }
  const stream = peerAudioStreams.get(peerId);
  let micOn = false;
  let micMuted = false;
  if (stream) {
    for (const tr of stream.getAudioTracks()) {
      if (tr.kind === 'audio' && tr.readyState === 'live') {
        micOn = true;
        micMuted = Boolean(tr.muted || !tr.enabled);
        break;
      }
    }
  }
  return { camera, screen, micOn, micMuted };
}

function refreshPeerRemoteMedia(peerId) {
  const state = computePeerRemoteMedia(peerId);
  updateParticipantMediaIndicators(peerId, state);
}

/**
 * @param {string} peerId
 * @param {{ camera: boolean, screen: boolean, micOn: boolean, micMuted: boolean }} state
 */
function updateParticipantMediaIndicators(peerId, state) {
  if (!participantList) return;
  const row = [...participantList.querySelectorAll('li.participant-row-remote')].find(
    (el) => el.dataset.peerId === peerId,
  );
  if (!row) return;
  const cam = row.querySelector('[data-indicator="camera"]');
  const mic = row.querySelector('[data-indicator="mic"]');
  const scr = row.querySelector('[data-indicator="screen"]');
  if (cam) {
    cam.dataset.on = state.camera ? 'true' : 'false';
    cam.title = state.camera ? 'Camera on' : 'Camera off';
  }
  if (scr) {
    scr.dataset.on = state.screen ? 'true' : 'false';
    scr.title = state.screen ? 'Sharing screen' : 'Not sharing screen';
  }
  if (mic) {
    if (!state.micOn) {
      mic.dataset.on = 'false';
      mic.dataset.muted = 'false';
      mic.title = 'Mic off';
    } else {
      mic.dataset.on = 'true';
      mic.dataset.muted = state.micMuted ? 'true' : 'false';
      mic.title = state.micMuted ? 'Mic muted' : 'Mic on';
    }
  }
}

function getPeerTileVisibility(peerId) {
  let v = peerTileVisibility.get(peerId);
  if (!v) {
    v = { camera: true, screen: true };
    peerTileVisibility.set(peerId, v);
  }
  return v;
}

function applyPeerTileVisibility(peerId) {
  if (!remoteVideos) return;
  const v = getPeerTileVisibility(peerId);
  for (const tile of remoteVideos.querySelectorAll('.tile.remote-peer')) {
    if (tile.dataset.peerId !== peerId) continue;
    const isScreen = tile.classList.contains('remote-peer-screen');
    const show = isScreen ? v.screen : v.camera;
    tile.hidden = !show;
  }
}

/**
 * Camera tile: keep tile visible when the sender turns the camera off; show their name on the placeholder overlay.
 * @param {HTMLElement} tile
 * @param {string} peerId
 */
function applyRemoteCameraPlaceholder(tile, peerId) {
  if (tile.classList.contains('remote-peer-screen')) return;
  const baseName = peerDisplayNames.get(peerId) || `Peer ${peerId.slice(0, 8)}`;
  const ph = tile.querySelector('.remote-video-placeholder');
  if (!ph) return;
  const phWaiting = ph.querySelector('.remote-placeholder-waiting');
  const phOff = ph.querySelector('.remote-placeholder-off');
  const phName = ph.querySelector('.remote-placeholder-name');
  const label = tile.querySelector('.meet-tile-name');
  const vid = tile.querySelector('video');
  const vt = vid?.srcObject?.getVideoTracks?.()?.[0];

  if (label) label.textContent = baseName;

  if (!phWaiting || !phOff) {
    if (!vt || vt.readyState !== 'live') {
      ph.hidden = false;
      ph.textContent = 'Waiting for media…';
    } else {
      const sawMedia = tile.dataset.cameraLive === '1';
      const senderPaused = sawMedia && (vt.muted || !vt.enabled);
      if ((vt.muted || !vt.enabled) && !sawMedia) {
        ph.hidden = false;
        ph.textContent = 'Waiting for media…';
      } else if (senderPaused) {
        ph.hidden = false;
        ph.textContent = baseName;
      } else {
        ph.hidden = true;
      }
    }
    return;
  }

  if (phName) phName.textContent = baseName;

  if (!vt || vt.readyState !== 'live') {
    ph.hidden = false;
    phWaiting.hidden = false;
    phOff.hidden = true;
    if (label) label.hidden = false;
    return;
  }
  // Receiver tracks often start muted until the first frame; don't treat that as "camera off".
  const sawMedia = tile.dataset.cameraLive === '1';
  const senderPaused = (vt.muted || !vt.enabled) && sawMedia;
  if ((vt.muted || !vt.enabled) && !sawMedia) {
    ph.hidden = false;
    phWaiting.hidden = false;
    phOff.hidden = true;
    if (label) label.hidden = false;
    return;
  }
  if (senderPaused) {
    ph.hidden = false;
    phWaiting.hidden = true;
    phOff.hidden = false;
    if (label) label.hidden = true;
    return;
  }
  ph.hidden = true;
  phWaiting.hidden = false;
  phOff.hidden = true;
  if (label) label.hidden = false;
}

function refreshRemoteCameraPlaceholdersForPeer(peerId) {
  if (!remoteVideos) return;
  for (const t of remoteVideos.querySelectorAll('.tile.remote-peer')) {
    if (t.dataset.peerId !== peerId) continue;
    applyRemoteCameraPlaceholder(t, peerId);
  }
}

function hasRemoteCameraVideoTile(peerId) {
  if (!remoteVideos) return false;
  return [...remoteVideos.querySelectorAll('.tile.remote-peer')].some(
    (t) =>
      t.dataset.peerId === peerId &&
      !t.classList.contains('remote-peer-screen') &&
      !t.classList.contains('remote-peer-placeholder'),
  );
}

function updateRemotePeerPlaceholderTile(tile, peerId) {
  const baseName = peerDisplayNames.get(peerId) || `Peer ${peerId.slice(0, 8)}`;
  const label = tile.querySelector('.meet-tile-name');
  const nameEl = tile.querySelector('.remote-peer-placeholder-body .remote-placeholder-name');
  const sub = tile.querySelector('.remote-peer-placeholder-sub');
  if (label) label.textContent = baseName;
  if (nameEl) nameEl.textContent = baseName;
  if (sub) {
    const stream = peerAudioStreams.get(peerId);
    let hasLiveAudio = false;
    if (stream) {
      for (const tr of stream.getAudioTracks()) {
        if (tr.kind === 'audio' && tr.readyState === 'live') {
          hasLiveAudio = true;
          break;
        }
      }
    }
    sub.textContent = hasLiveAudio ? 'Mic on · no camera' : 'No camera or mic';
  }
}

function createRemotePeerPlaceholderTile(peerId) {
  if (!remoteVideos) return;
  const baseName = peerDisplayNames.get(peerId) || `Peer ${peerId.slice(0, 8)}`;
  const tile = document.createElement('section');
  tile.className = 'tile remote-peer remote-peer-placeholder remote-peer-camera';
  tile.dataset.peerId = peerId;
  tile.dataset.placeholder = 'true';
  tile.dataset.cameraSize = 'medium';

  const label = document.createElement('span');
  label.className = 'label meet-tile-name';
  label.textContent = baseName;

  const body = document.createElement('div');
  body.className = 'remote-peer-placeholder-body';
  const nameEl = document.createElement('span');
  nameEl.className = 'remote-placeholder-name';
  nameEl.textContent = baseName;
  const sub = document.createElement('span');
  sub.className = 'remote-placeholder-sub';
  sub.textContent = 'No camera or mic';

  body.appendChild(nameEl);
  body.appendChild(sub);

  tile.appendChild(label);
  tile.appendChild(body);
  attachTileSizeControls(tile, body, 'camera');
  remoteVideos.appendChild(tile);
  updateRemotePeerPlaceholderTile(tile, peerId);
  applyPeerTileVisibility(peerId);
}

/**
 * Show a grid tile for each remote peer who has not published a camera track (view-only, mic-only, etc.).
 */
function ensureRemotePeerPlaceholderTiles() {
  if (!remoteVideos || !socket) return;
  for (const [peerId] of peerDisplayNames) {
    if (peerId === socket.id) continue;
    if (hasRemoteCameraVideoTile(peerId)) {
      for (const t of remoteVideos.querySelectorAll('.tile.remote-peer[data-placeholder="true"]')) {
        if (t.dataset.peerId === peerId) t.remove();
      }
      continue;
    }
    let tile = null;
    for (const t of remoteVideos.querySelectorAll('.tile.remote-peer[data-placeholder="true"]')) {
      if (t.dataset.peerId === peerId) {
        tile = t;
        break;
      }
    }
    if (!tile) {
      createRemotePeerPlaceholderTile(peerId);
    } else {
      updateRemotePeerPlaceholderTile(tile, peerId);
    }
  }
  for (const t of [...remoteVideos.querySelectorAll('.tile.remote-peer[data-placeholder="true"]')]) {
    const id = t.dataset.peerId;
    if (!id || !peerDisplayNames.has(id)) t.remove();
  }
}

function updateParticipantToggleButtons(peerId) {
  if (!participantList) return;
  const v = getPeerTileVisibility(peerId);
  const row = [...participantList.querySelectorAll('li.participant-row-remote')].find(
    (el) => el.dataset.peerId === peerId,
  );
  if (!row) return;
  const cam = row.querySelector('[data-action="camera"]');
  const scr = row.querySelector('[data-action="screen"]');
  if (cam) cam.setAttribute('aria-pressed', v.camera ? 'true' : 'false');
  if (scr) scr.setAttribute('aria-pressed', v.screen ? 'true' : 'false');
}
/** mediasoup recv consumers keyed by remote producer id — close when server signals producerClosed. */
/** @type {Map<string, import('mediasoup-client').types.Consumer>} */
const consumerByProducerId = new Map();

/** @type {import('mediasoup-client').types.Producer | null} */
let screenProducer = null;
/** @type {import('mediasoup-client').types.Producer | null} */
let micProducer = null;
/** @type {import('mediasoup-client').types.Producer | null} */
let cameraProducer = null;
/** @type {MediaStream | null} */
let screenStream = null;

/** Shown in the participant list and local tile after join. */
let myDisplayName = 'You';

/** Prevents overlapping joinRoom() runs (e.g. double-click Create). */
let joinInProgress = false;

/** @type {((reason: string) => void) | null} */
let socketDisconnectHandler = null;

/** @type {((payload: { requestId: string, peerId: string, displayName: string, roomId: string }) => void) | null} */
let joinRequestListener = null;
/** @type {((payload: { requestId: string, peerId: string }) => void) | null} */
let joinRequestRemovedListener = null;
/** @type {((data: { hostId: string }) => void) | null} */
let hostChangedListener = null;
/** @type {((data: { reason?: string }) => void) | null} */
let kickedListener = null;

/** @type {Array<{ x0: number, y0: number, x1: number, y1: number, color: string, width: number, tool: string }>} */
let whiteboardStrokeLog = [];
/** @type {'pen' | 'eraser'} */
let whiteboardTool = 'pen';
let whiteboardDrawing = false;
/** @type {{ x: number, y: number } | null} */
let whiteboardLastNorm = null;
/** @type {AbortController | null} */
let whiteboardPointerAbort = null;
/** @type {ResizeObserver | null} */
let whiteboardResizeObserver = null;
/** @type {((data: { line: object }) => void) | null} */
let whiteboardLineListener = null;
/** @type {(() => void) | null} */
let whiteboardClearListener = null;

function getRoomVisibilityFromUi() {
  const el =
    typeof document !== 'undefined'
      ? document.querySelector('input[name="roomType"]:checked')
      : null;
  return el && el.value === 'private' ? 'private' : 'public';
}

function updateRoomVisibilityUi(visibility) {
  if (!roomVisibilityBadge || !roomVisibilityText) return;
  if (visibility === 'private') {
    roomVisibilityText.textContent = 'Private';
    roomVisibilityBadge.hidden = false;
  } else if (visibility === 'public') {
    roomVisibilityText.textContent = 'Public';
    roomVisibilityBadge.hidden = false;
  } else {
    roomVisibilityBadge.hidden = true;
  }
}

function syncJoinRequestPanelVisibility() {
  if (!joinRequestHostPanel || !joinRequestHostList) return;
  joinRequestHostPanel.hidden = joinRequestHostList.children.length === 0;
}

function appendJoinRequestRow({ requestId, displayName }) {
  if (!joinRequestHostList || !joinRequestHostPanel) return;
  const li = document.createElement('li');
  li.className = 'join-request-host-item';
  li.dataset.requestId = requestId;
  const name = document.createElement('span');
  name.className = 'join-request-host-name';
  name.textContent = displayName || 'Guest';
  const actions = document.createElement('div');
  actions.className = 'join-request-host-actions';
  const acc = document.createElement('button');
  acc.type = 'button';
  acc.className = 'meet-btn meet-btn-primary join-request-accept';
  acc.textContent = 'Accept';
  acc.addEventListener('click', () => {
    emitAck('acceptJoinRequest', { requestId })
      .then(() => {})
      .catch((e) => setStatus(e instanceof Error ? e.message : String(e)));
    li.remove();
    syncJoinRequestPanelVisibility();
  });
  const rej = document.createElement('button');
  rej.type = 'button';
  rej.className = 'meet-btn-text join-request-decline';
  rej.textContent = 'Decline';
  rej.addEventListener('click', () => {
    emitAck('rejectJoinRequest', { requestId })
      .then(() => {})
      .catch((e) => setStatus(e instanceof Error ? e.message : String(e)));
    li.remove();
    syncJoinRequestPanelVisibility();
  });
  actions.appendChild(acc);
  actions.appendChild(rej);
  li.appendChild(actions);
  li.appendChild(name);
  joinRequestHostList.appendChild(li);
  joinRequestHostPanel.hidden = false;
}

function removeJoinRequestRowById(requestId) {
  if (!joinRequestHostList) return;
  for (const li of [...joinRequestHostList.querySelectorAll('li[data-request-id]')]) {
    if (li.dataset.requestId === requestId) li.remove();
  }
  syncJoinRequestPanelVisibility();
}

function registerJoinRequestSocketListeners() {
  if (!socket) return;
  removeJoinRequestSocketListeners();
  joinRequestListener = (payload) => {
    if (!payload || typeof payload.requestId !== 'string') return;
    appendJoinRequestRow({
      requestId: payload.requestId,
      displayName: payload.displayName,
    });
  };
  joinRequestRemovedListener = (payload) => {
    if (payload && typeof payload.requestId === 'string') {
      removeJoinRequestRowById(payload.requestId);
    }
  };
  socket.on('joinRequest', joinRequestListener);
  socket.on('joinRequestRemoved', joinRequestRemovedListener);
}

function removeJoinRequestSocketListeners() {
  if (!socket) return;
  if (joinRequestListener) socket.off('joinRequest', joinRequestListener);
  if (joinRequestRemovedListener) socket.off('joinRequestRemoved', joinRequestRemovedListener);
  joinRequestListener = null;
  joinRequestRemovedListener = null;
}

function teardownWhiteboardSession() {
  whiteboardStrokeLog = [];
  whiteboardDrawing = false;
  whiteboardLastNorm = null;
  if (whiteboardPointerAbort) {
    whiteboardPointerAbort.abort();
    whiteboardPointerAbort = null;
  }
  if (whiteboardResizeObserver && whiteboardCanvasWrap) {
    try {
      whiteboardResizeObserver.unobserve(whiteboardCanvasWrap);
    } catch {
      /* ignore */
    }
    whiteboardResizeObserver.disconnect();
    whiteboardResizeObserver = null;
  }
  if (socket) {
    if (whiteboardLineListener) socket.off('whiteboardLine', whiteboardLineListener);
    if (whiteboardClearListener) socket.off('whiteboardClear', whiteboardClearListener);
  }
  whiteboardLineListener = null;
  whiteboardClearListener = null;
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ x0: number, y0: number, x1: number, y1: number, color: string, width: number, tool: string }} line
 * @param {number} cw
 * @param {number} ch
 */
function drawWhiteboardLine(ctx, line, cw, ch) {
  const x0 = line.x0 * cw;
  const y0 = line.y0 * ch;
  const x1 = line.x1 * cw;
  const y1 = line.y1 * ch;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = line.width;
  if (line.tool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = 'rgba(0,0,0,1)';
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = line.color;
  }
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.restore();
}

function replayWhiteboardCanvas() {
  const canvas = whiteboardCanvas;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.width / dpr;
  const cssH = canvas.height / dpr;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (const line of whiteboardStrokeLog) {
    drawWhiteboardLine(ctx, line, cssW, cssH);
  }
}

function resizeWhiteboardCanvas() {
  const canvas = whiteboardCanvas;
  const wrap = whiteboardCanvasWrap;
  if (!canvas || !wrap) return;
  const r = wrap.getBoundingClientRect();
  let cssW = Math.max(1, Math.floor(r.width));
  let cssH = Math.max(1, Math.floor(r.height));
  if (cssW < 8 || cssH < 8) {
    cssW = 560;
    cssH = 360;
  }
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  replayWhiteboardCanvas();
}

/**
 * @param {unknown} snapshot
 */
function initWhiteboardSession(snapshot) {
  teardownWhiteboardSession();
  if (Array.isArray(snapshot) && snapshot.length) {
    whiteboardStrokeLog = snapshot.map((l) => (l && typeof l === 'object' ? { ...l } : null)).filter(Boolean);
  }
  if (!whiteboardCanvas || !socket) return;

  whiteboardLineListener = (data) => {
    const line = data && data.line;
    if (!line || typeof line !== 'object') return;
    const L = /** @type {{ x0: number, y0: number, x1: number, y1: number, color: string, width: number, tool: string }} */ (
      line
    );
    whiteboardStrokeLog.push(L);
    const ctx = whiteboardCanvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = whiteboardCanvas.width / dpr;
    const cssH = whiteboardCanvas.height / dpr;
    drawWhiteboardLine(ctx, L, cssW, cssH);
  };
  whiteboardClearListener = () => {
    whiteboardStrokeLog = [];
    const ctx = whiteboardCanvas.getContext('2d');
    if (!ctx || !whiteboardCanvas) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, whiteboardCanvas.width, whiteboardCanvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  socket.on('whiteboardLine', whiteboardLineListener);
  socket.on('whiteboardClear', whiteboardClearListener);

  whiteboardPointerAbort = new AbortController();
  const { signal } = whiteboardPointerAbort;

  function normFromPointer(e) {
    const c = whiteboardCanvas;
    if (!c) return { x: 0, y: 0 };
    const r = c.getBoundingClientRect();
    const x = (e.clientX - r.left) / Math.max(1, r.width);
    const y = (e.clientY - r.top) / Math.max(1, r.height);
    return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
  }

  function currentLineStyle() {
    const width = whiteboardSizeInput ? Number(whiteboardSizeInput.value) || 4 : 4;
    const color = whiteboardColorInput && whiteboardColorInput.value ? whiteboardColorInput.value : '#ffffff';
    const tool = whiteboardTool === 'eraser' ? 'eraser' : 'pen';
    return { width: Math.min(48, Math.max(1, width)), color, tool };
  }

  whiteboardCanvas.addEventListener(
    'pointerdown',
    (e) => {
      if (!socket || e.button !== 0) return;
      e.preventDefault();
      whiteboardDrawing = true;
      whiteboardLastNorm = normFromPointer(e);
      try {
        whiteboardCanvas.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    },
    { signal },
  );
  whiteboardCanvas.addEventListener(
    'pointermove',
    (e) => {
      if (!whiteboardDrawing || !socket || !whiteboardLastNorm) return;
      e.preventDefault();
      const p = normFromPointer(e);
      const st = currentLineStyle();
      const line = {
        x0: whiteboardLastNorm.x,
        y0: whiteboardLastNorm.y,
        x1: p.x,
        y1: p.y,
        color: st.color,
        width: st.width,
        tool: st.tool,
      };
      whiteboardLastNorm = p;
      whiteboardStrokeLog.push(line);
      const ctx = whiteboardCanvas.getContext('2d');
      if (ctx) {
        const dpr = window.devicePixelRatio || 1;
        const cssW = whiteboardCanvas.width / dpr;
        const cssH = whiteboardCanvas.height / dpr;
        drawWhiteboardLine(ctx, line, cssW, cssH);
      }
      emitAck('whiteboardLine', { line }).catch((err) => {
        setStatus(err instanceof Error ? err.message : String(err));
      });
    },
    { signal },
  );
  function endStroke(e) {
    if (!whiteboardDrawing) return;
    whiteboardDrawing = false;
    whiteboardLastNorm = null;
    try {
      if (whiteboardCanvas && e.pointerId != null) whiteboardCanvas.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }
  whiteboardCanvas.addEventListener('pointerup', endStroke, { signal });
  whiteboardCanvas.addEventListener('pointercancel', endStroke, { signal });
  whiteboardCanvas.addEventListener('lostpointercapture', endStroke, { signal });

  if (whiteboardCanvasWrap && typeof ResizeObserver !== 'undefined') {
    whiteboardResizeObserver = new ResizeObserver(() => {
      resizeWhiteboardCanvas();
    });
    whiteboardResizeObserver.observe(whiteboardCanvasWrap);
  }
  requestAnimationFrame(() => resizeWhiteboardCanvas());
}

/**
 * @param {import('socket.io-client').Socket} sock
 */
function waitForJoinApprovedOrRejected(sock) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const t = setTimeout(() => {
      if (settled) return;
      settled = true;
      sock.off('joinApproved', onOk);
      sock.off('joinRejected', onBad);
      sock.off('disconnect', onDisc);
      reject(new Error('Timed out waiting for host approval'));
    }, 120000);
    function done() {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      sock.off('joinApproved', onOk);
      sock.off('joinRejected', onBad);
      sock.off('disconnect', onDisc);
    }
    function onOk(payload) {
      done();
      resolve(payload);
    }
    function onBad(data) {
      done();
      reject(new Error((data && data.reason) || 'Request declined'));
    }
    function onDisc() {
      done();
      reject(new Error('Disconnected while waiting for host'));
    }
    sock.once('joinApproved', onOk);
    sock.once('joinRejected', onBad);
    sock.once('disconnect', onDisc);
  });
}

function setStatus(msg) {
  statusEl.textContent = msg;
}

function setSessionUiVisible(visible) {
  const on = Boolean(visible);
  document.querySelector('.meet-shell')?.classList.toggle('meet-in-call', on);
  sessionInfo.hidden = !on;
  if (meetControlBar) meetControlBar.hidden = !on;
  if (meetJoinRow) meetJoinRow.hidden = on;
  if (peoplePanel) peoplePanel.hidden = !on;
  chatPanel.hidden = !on;
  if (chatToggleBtn) {
    chatToggleBtn.setAttribute('aria-pressed', !chatPanel.hidden ? 'true' : 'false');
    chatToggleBtn.setAttribute('aria-label', chatPanel.hidden ? 'Open chat' : 'Close chat');
  }
  roomInput.disabled = on;
  if (displayNameInput) displayNameInput.disabled = on;
  if (on) {
    createBtn.hidden = true;
    joinBtn.hidden = true;
  } else {
    createBtn.hidden = false;
    joinBtn.hidden = false;
    createBtn.disabled = false;
    joinBtn.disabled = false;
  }
  chatInput.disabled = !on;
  chatSendBtn.disabled = !on;
  chatInput.placeholder = on ? 'Send a message to everyone' : 'Join a room to chat';
  if (!on) {
    activeRoomId = null;
    activeRoomIdEl.textContent = '';
    chatMessages.innerHTML = '';
    if (participantList) participantList.innerHTML = '';
    if (whiteboardPanel) whiteboardPanel.hidden = true;
    if (whiteboardToggleBtn) {
      whiteboardToggleBtn.setAttribute('aria-pressed', 'false');
      whiteboardToggleBtn.setAttribute('aria-label', 'Open whiteboard');
    }
  }
}

function renderParticipantList() {
  if (!participantList) return;
  participantList.innerHTML = '';
  const selfLi = document.createElement('li');
  selfLi.className = 'participant-row participant-self';
  const selfName = document.createElement('span');
  selfName.className = 'participant-name';
  selfName.textContent = `${myDisplayName} `;
  const selfTag = document.createElement('span');
  selfTag.className = 'participant-you';
  selfTag.textContent = '(you)';
  selfLi.appendChild(selfName);
  selfLi.appendChild(selfTag);
  if (isRoomHost) {
    const hostBadge = document.createElement('span');
    hostBadge.className = 'participant-host-badge';
    hostBadge.textContent = 'Creator';
    hostBadge.title = 'Meeting creator — you can remove others from the list';
    selfLi.appendChild(hostBadge);
  }
  participantList.appendChild(selfLi);
  if (!socket) return;
  for (const [peerId, name] of peerDisplayNames) {
    if (peerId === socket.id) continue;
    const v = getPeerTileVisibility(peerId);
    const li = document.createElement('li');
    li.className = 'participant-row participant-row-remote';
    li.dataset.peerId = peerId;

    const nameSpan = document.createElement('span');
    nameSpan.className = 'participant-name';
    nameSpan.textContent = name;
    nameSpan.title = name;

    if (isRoomHost && socket && peerId !== socket.id) {
      const kickBtn = document.createElement('button');
      kickBtn.type = 'button';
      kickBtn.className = 'participant-kick-btn';
      kickBtn.textContent = 'Remove';
      kickBtn.title = 'Remove this person from the meeting (host only)';
      kickBtn.setAttribute('aria-label', `Remove ${name} from the meeting`);
      kickBtn.addEventListener('click', () => {
        emitAck('kickPeer', { peerId })
          .then(() => {})
          .catch((e) => setStatus(e instanceof Error ? e.message : String(e)));
      });
      li.appendChild(nameSpan);
      li.appendChild(kickBtn);
    } else {
      li.appendChild(nameSpan);
    }

    const toggles = document.createElement('div');
    toggles.className = 'participant-tile-toggles';
    toggles.setAttribute('role', 'group');
    toggles.setAttribute('aria-label', `Tiles for ${name}`);

    const camBtn = document.createElement('button');
    camBtn.type = 'button';
    camBtn.className = 'participant-toggle-btn';
    camBtn.dataset.peerId = peerId;
    camBtn.dataset.action = 'camera';
    camBtn.textContent = 'Cam';
    camBtn.title = 'Show or hide this person’s camera tile';
    camBtn.setAttribute('aria-pressed', v.camera ? 'true' : 'false');

    const scrBtn = document.createElement('button');
    scrBtn.type = 'button';
    scrBtn.className = 'participant-toggle-btn';
    scrBtn.dataset.peerId = peerId;
    scrBtn.dataset.action = 'screen';
    scrBtn.textContent = 'Scr';
    scrBtn.title = 'Show or hide this person’s screen share tile';
    scrBtn.setAttribute('aria-pressed', v.screen ? 'true' : 'false');

    toggles.appendChild(camBtn);
    toggles.appendChild(scrBtn);

    const indicators = document.createElement('div');
    indicators.className = 'participant-media-indicators';
    indicators.setAttribute('aria-label', `Media for ${name}`);
    for (const { key, label, title } of [
      { key: 'camera', label: 'Cam', title: 'Camera' },
      { key: 'mic', label: 'Mic', title: 'Microphone' },
      { key: 'screen', label: 'Scr', title: 'Screen' },
    ]) {
      const span = document.createElement('span');
      span.className = 'pmi';
      span.dataset.indicator = key;
      span.textContent = label;
      span.title = title;
      indicators.appendChild(span);
    }

    li.appendChild(toggles);
    li.appendChild(indicators);
    participantList.appendChild(li);
  }
  if (socket) {
    for (const [peerId] of peerDisplayNames) {
      if (peerId === socket.id) continue;
      refreshPeerRemoteMedia(peerId);
      refreshRemoteCameraPlaceholdersForPeer(peerId);
    }
  }
  ensureRemotePeerPlaceholderTiles();
  if (socket) {
    for (const [peerId] of peerDisplayNames) {
      if (peerId === socket.id) continue;
      applyPeerTileVisibility(peerId);
    }
  }
}

function appendChatLine({ peerId, displayName, text, ts }) {
  if (!socket) return;
  const row = document.createElement('div');
  row.className = 'chat-msg';
  const meta = document.createElement('div');
  meta.className = 'chat-msg-meta';
  const from = document.createElement('span');
  from.className = 'chat-from';
  const isSelf = peerId === socket.id;
  if (isSelf) {
    from.classList.add('self');
    from.textContent = 'You';
  } else {
    from.textContent = displayName || peerDisplayNames.get(peerId) || `Peer ${peerId.slice(0, 8)}`;
  }
  const time = document.createElement('time');
  time.dateTime = new Date(ts).toISOString();
  time.textContent = new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  meta.appendChild(from);
  meta.appendChild(time);
  const body = document.createElement('div');
  body.className = 'chat-text';
  body.textContent = text;
  row.appendChild(meta);
  row.appendChild(body);
  chatMessages.appendChild(row);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function emitAck(event, payload) {
  return new Promise((resolve, reject) => {
    if (!socket) {
      reject(new Error('Not connected'));
      return;
    }
    socket.emit(event, payload, (res) => {
      if (res && res.error) reject(new Error(res.error));
      else if (res === undefined) reject(new Error('No response from server'));
      else resolve(res);
    });
  });
}

function withTimeout(ms, message) {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(message)), ms);
  });
}

function isLocalhostHostname(hostname) {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1'
  );
}

/**
 * Browsers only expose getUserMedia on a "secure context": https:// or http://localhost (and 127.0.0.1).
 * http://192.168.x.x or http://public-ip will not get camera/mic — room setup then fails.
 */
function assertMediaEnvironment() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('This browser does not support camera/microphone access.');
  }
  const h = typeof window !== 'undefined' ? window.location?.hostname || '' : '';
  if (!window.isSecureContext && !isLocalhostHostname(h)) {
    throw new Error(
      `Camera/mic are not allowed on http://${h}. Use https:// on this host, or open http://localhost:PORT on this PC only.`,
    );
  }
}

function showInsecureOriginBanner() {
  if (!secureContextBanner || !secureContextHost || typeof window === 'undefined' || !window.location) {
    return;
  }
  const h = window.location.hostname || '';
  secureContextHost.textContent = `${window.location.protocol}//${h}${window.location.port ? `:${window.location.port}` : ''}`;
  if (window.isSecureContext || isLocalhostHostname(h)) {
    secureContextBanner.hidden = true;
  } else {
    secureContextBanner.hidden = false;
  }
}

/**
 * Try A+V, then audio-only, then video-only so a missing device does not kill the whole join.
 * @returns {Promise<MediaStream>}
 */
async function acquireLocalMedia() {
  const videoConstraints = { width: { ideal: 1280 }, height: { ideal: 720 } };
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: videoConstraints,
    });
  } catch (e1) {
    setStatus('Trying microphone only…');
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch {
      setStatus('Trying camera only…');
      try {
        return await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
      } catch {
        throw e1;
      }
    }
  }
}

showInsecureOriginBanner();

/** Build shareable URL so another tab can pre-fill the room (?room=). */
function getInviteUrlForRoom(roomId) {
  if (typeof window === 'undefined' || !window.location) return '';
  const path = window.location.pathname || '/';
  const u = new URL(path, window.location.origin);
  u.searchParams.set('room', roomId);
  return u.toString();
}

/** Read ?room= from the address bar and fill the input (second tab / shared link). */
function applyRoomFromUrl() {
  if (typeof window === 'undefined' || !roomInput) return;
  try {
    const u = new URL(window.location.href);
    const raw = u.searchParams.get('room');
    if (!raw) return;
    const n = normalizeRoomId(raw);
    if (!n.ok) {
      setStatus(n.error);
      return;
    }
    roomInput.value = n.id;
    setStatus('Room loaded from link — click Join to enter (use a new tab if this tab is already in a call).');
  } catch {
    /* ignore */
  }
}

applyRoomFromUrl();

try {
  const saved = localStorage.getItem('gm_displayName');
  if (saved && displayNameInput && !displayNameInput.value.trim()) {
    displayNameInput.value = saved;
  }
} catch {
  /* ignore */
}

/**
 * S / M / L / XL + fullscreen — screen share tiles use data-screen-size; camera tiles use data-camera-size.
 * @param {HTMLElement} tile
 * @param {HTMLElement} insertBeforeEl
 * @param {'screen' | 'camera'} mode
 */
function attachTileSizeControls(tile, insertBeforeEl, mode) {
  if (tile.querySelector('.remote-tile-screen-controls')) return;

  const sizeKey = mode === 'screen' ? 'screenSize' : 'cameraSize';
  const ariaLabel = mode === 'screen' ? 'Screen size' : 'Camera tile size';
  const fsLabel =
    mode === 'screen' ? 'Fullscreen this screen' : 'Fullscreen this camera tile';

  const controls = document.createElement('div');
  controls.className = 'remote-tile-screen-controls';
  controls.setAttribute('role', 'group');
  controls.setAttribute('aria-label', ariaLabel);

  const sizePresets = [
    { key: 'compact', label: 'S', title: 'Small tile' },
    { key: 'medium', label: 'M', title: 'Medium tile' },
    { key: 'large', label: 'L', title: 'Large tile' },
    { key: 'fill', label: 'XL', title: 'Tall (uses most of the viewport height)' },
  ];

  let initial = tile.dataset[sizeKey] || 'medium';
  tile.dataset[sizeKey] = initial;

  for (const { key, label: lbl, title } of sizePresets) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'remote-tile-size-btn';
    btn.textContent = lbl;
    btn.dataset.size = key;
    btn.title = title;
    btn.setAttribute('aria-pressed', key === initial ? 'true' : 'false');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      tile.dataset[sizeKey] = key;
      for (const b of controls.querySelectorAll('.remote-tile-size-btn')) {
        b.setAttribute('aria-pressed', b.dataset.size === key ? 'true' : 'false');
      }
    });
    controls.appendChild(btn);
  }

  const fsBtn = document.createElement('button');
  fsBtn.type = 'button';
  fsBtn.className = 'remote-tile-fs-btn';
  fsBtn.textContent = '⛶';
  fsBtn.title = fsLabel;
  fsBtn.setAttribute('aria-label', fsLabel);
  fsBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      if (document.fullscreenElement === tile) {
        await document.exitFullscreen();
      } else if (tile.requestFullscreen) {
        await tile.requestFullscreen();
      }
    } catch {
      /* ignore */
    }
  });
  controls.appendChild(fsBtn);

  tile.insertBefore(controls, insertBeforeEl);
}

/**
 * @param {HTMLElement} tile
 * @param {HTMLElement} insertBeforeEl
 */
function attachScreenShareSizeControls(tile, insertBeforeEl) {
  attachTileSizeControls(tile, insertBeforeEl, 'screen');
}

function ensureLocalScreenSizeControls() {
  if (!localScreenTile || !localScreenVideo) return;
  if (!localScreenTile.dataset.screenSize) localScreenTile.dataset.screenSize = 'medium';
  attachTileSizeControls(localScreenTile, localScreenVideo, 'screen');
}

function ensureLocalCameraSizeControls() {
  if (!localCameraTile || !localVideo) return;
  localCameraTile.classList.add('local-camera-tile');
  if (!localCameraTile.dataset.cameraSize) localCameraTile.dataset.cameraSize = 'medium';
  attachTileSizeControls(localCameraTile, localVideo, 'camera');
}

/** Keep local camera tile always visible (even view-only / no camera); show screen tile when sharing. */
function updateLocalVideoChrome() {
  if (!localViewOnlyLabel) return;
  const vids = localStream?.getVideoTracks?.() || [];
  const hasVideoTrack = vids.length > 0;
  const videoLive = hasVideoTrack && vids[0].readyState === 'live' && vids[0].enabled;
  localViewOnlyLabel.hidden = Boolean(videoLive);
  if (!localStream) {
    localViewOnlyLabel.textContent = 'No camera or mic — view only';
  } else if (!hasVideoTrack) {
    localViewOnlyLabel.textContent = 'No camera';
  } else if (!videoLive) {
    localViewOnlyLabel.textContent = 'Camera off';
  }
}

function syncMicCameraButtonUi() {
  if (micToggleBtn) {
    micToggleBtn.disabled = !micProducer;
    const on = Boolean(micProducer && !micProducer.paused);
    micToggleBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (on) micToggleBtn.removeAttribute('data-muted');
    else micToggleBtn.setAttribute('data-muted', '1');
    micToggleBtn.title = on ? 'Mute microphone' : 'Unmute microphone';
    micToggleBtn.setAttribute('aria-label', on ? 'Mute microphone' : 'Unmute microphone');
  }
  if (cameraToggleBtn) {
    cameraToggleBtn.disabled = !cameraProducer;
    const on = Boolean(cameraProducer && !cameraProducer.paused);
    cameraToggleBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (on) cameraToggleBtn.removeAttribute('data-off');
    else cameraToggleBtn.setAttribute('data-off', '1');
    cameraToggleBtn.title = on ? 'Turn camera off' : 'Turn camera on';
    cameraToggleBtn.setAttribute('aria-label', on ? 'Turn camera off' : 'Turn camera on');
  }
}

function toggleMic() {
  if (!micProducer) return;
  if (micProducer.paused) micProducer.resume();
  else micProducer.pause();
  syncMicCameraButtonUi();
}

function toggleCamera() {
  if (!cameraProducer) return;
  if (cameraProducer.paused) cameraProducer.resume();
  else cameraProducer.pause();
  updateLocalVideoChrome();
  syncMicCameraButtonUi();
}

function syncLocalLayout() {
  if (localCameraTile) localCameraTile.hidden = false;
  updateLocalVideoChrome();
  ensureLocalCameraSizeControls();
  if (localScreenTile && localScreenVideo) {
    const showScreen = Boolean(screenStream);
    localScreenTile.hidden = !showScreen;
    localScreenVideo.srcObject = showScreen ? screenStream : null;
    if (showScreen) {
      ensureLocalScreenSizeControls();
    }
  }
}

function stopScreenShare() {
  const screenProducerId = screenProducer?.id;
  if (screenProducer) {
    try {
      screenProducer.close();
    } catch {
      /* ignore */
    }
    screenProducer = null;
  }
  if (screenStream) {
    screenStream.getTracks().forEach((t) => t.stop());
    screenStream = null;
  }
  if (screenShareBtn) {
    screenShareBtn.removeAttribute('data-active');
    screenShareBtn.title = 'Present now';
  }
  syncLocalLayout();
  if (socket && screenProducerId) {
    emitAck('closeProducer', { producerId: screenProducerId }).catch(() => {});
  }
}

async function startScreenShare() {
  if (!sendTransport) return;
  if (screenProducer) stopScreenShare();
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 30, max: 60 } },
      audio: false,
    });
  } catch (e) {
    setStatus(e instanceof Error ? e.message : 'Could not share screen');
    return;
  }
  const track = screenStream.getVideoTracks()[0];
  if (!track) {
    screenStream.getTracks().forEach((t) => t.stop());
    screenStream = null;
    syncLocalLayout();
    return;
  }
  track.addEventListener('ended', () => stopScreenShare());
  try {
    screenProducer = await sendTransport.produce({
      track,
      appData: { source: 'screen' },
    });
  } catch (e) {
    setStatus(e instanceof Error ? e.message : 'Could not publish screen');
    screenStream.getTracks().forEach((t) => t.stop());
    screenStream = null;
    syncLocalLayout();
    return;
  }
  if (screenShareBtn) {
    screenShareBtn.dataset.active = '1';
    screenShareBtn.title = 'Stop presenting';
  }
  syncLocalLayout();
}

async function cleanup() {
  isRoomHost = false;
  teardownWhiteboardSession();
  stopScreenShare();

  if (micProducer) {
    try {
      micProducer.close();
    } catch {
      /* ignore */
    }
    micProducer = null;
  }
  if (cameraProducer) {
    try {
      cameraProducer.close();
    } catch {
      /* ignore */
    }
    cameraProducer = null;
  }

  for (const c of consumerByProducerId.values()) {
    try {
      if (!c.closed) c.close();
    } catch {
      /* ignore */
    }
  }
  consumerByProducerId.clear();

  remoteVideoStreams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
  remoteVideoStreams.clear();
  remoteVideoByProducer.clear();
  peerAudioStreams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
  peerAudioStreams.clear();
  peerAudioEls.forEach((el) => el.remove());
  peerAudioEls.clear();
  remoteVideos.innerHTML = '';
  if (remoteAudioSink) remoteAudioSink.innerHTML = '';

  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }
  localVideo.srcObject = null;
  if (localScreenVideo) localScreenVideo.srcObject = null;
  if (localScreenTile) localScreenTile.hidden = true;
  if (localCameraTile) localCameraTile.hidden = false;
  if (localViewOnlyLabel) {
    localViewOnlyLabel.hidden = true;
    localViewOnlyLabel.textContent = 'No camera or mic — view only';
  }
  if (localPeerLabel) localPeerLabel.textContent = 'You';
  myDisplayName = 'You';
  peerDisplayNames.clear();
  peerTileVisibility.clear();
  producerIdToPeerId.clear();
  if (participantList) participantList.innerHTML = '';
  if (joinRequestHostList) joinRequestHostList.innerHTML = '';
  if (joinRequestHostPanel) joinRequestHostPanel.hidden = true;
  updateRoomVisibilityUi(null);

  sendTransport = null;
  recvTransport = null;
  device = null;

  if (socket) {
    removeJoinRequestSocketListeners();
    if (hostChangedListener) {
      socket.off('hostChanged', hostChangedListener);
      hostChangedListener = null;
    }
    if (kickedListener) {
      socket.off('kicked', kickedListener);
      kickedListener = null;
    }
    socket.off('newProducer');
    socket.off('producerClosed');
    socket.off('peerJoined');
    socket.off('peerLeft');
    socket.off('chatMessage');
    if (socketDisconnectHandler) {
      socket.off('disconnect', socketDisconnectHandler);
      socketDisconnectHandler = null;
    }
    socket.disconnect();
    socket = null;
  }

  leaveBtn.disabled = true;
  if (micToggleBtn) {
    micToggleBtn.disabled = true;
    micToggleBtn.removeAttribute('data-muted');
    micToggleBtn.title = 'Microphone';
  }
  if (cameraToggleBtn) {
    cameraToggleBtn.disabled = true;
    cameraToggleBtn.removeAttribute('data-off');
    cameraToggleBtn.title = 'Camera';
  }
  if (screenShareBtn) {
    screenShareBtn.disabled = true;
    screenShareBtn.removeAttribute('data-active');
    screenShareBtn.title = 'Present now';
  }
  // Do not clear status here — callers set the message after cleanup on error, or Leave clears it.
  try {
    const u = new URL(window.location.href);
    u.searchParams.delete('room');
    const qs = u.searchParams.toString();
    history.replaceState({}, '', u.pathname + (qs ? `?${qs}` : '') + u.hash);
  } catch {
    /* ignore */
  }
  setSessionUiVisible(false);
}

function ensureRemoteAudio(peerId) {
  let a = peerAudioEls.get(peerId);
  if (a) return a;
  a = document.createElement('audio');
  a.autoplay = true;
  a.playsInline = true;
  a.dataset.peerId = peerId;
  if (remoteAudioSink) remoteAudioSink.appendChild(a);
  else document.body.appendChild(a);
  peerAudioEls.set(peerId, a);
  return a;
}

function teardownRemoteVideoForProducer(producerId) {
  const video = remoteVideoByProducer.get(producerId);
  const tile =
    video?.closest('.tile') || remoteVideos.querySelector(`.tile[data-producer-id="${producerId}"]`);
  const peerIdFromTile = tile?.dataset?.peerId;
  const peerIdFromMap = producerIdToPeerId.get(producerId);
  const peerId = peerIdFromTile || peerIdFromMap || null;
  if (tile) tile.remove();
  const stream = remoteVideoStreams.get(producerId);
  stream?.getTracks().forEach((t) => t.stop());
  remoteVideoByProducer.delete(producerId);
  remoteVideoStreams.delete(producerId);
  consumerByProducerId.delete(producerId);
  producerIdToPeerId.delete(producerId);
  if (peerId) refreshPeerRemoteMedia(peerId);
  ensureRemotePeerPlaceholderTiles();
}

function removePeerMedia(peerId) {
  for (const [pid, pPeer] of [...producerIdToPeerId]) {
    if (pPeer === peerId) producerIdToPeerId.delete(pid);
  }
  if (remoteVideos) {
    for (const t of [...remoteVideos.querySelectorAll('.tile.remote-peer[data-placeholder="true"]')]) {
      if (t.dataset.peerId === peerId) t.remove();
    }
  }
  peerDisplayNames.delete(peerId);
  const ael = peerAudioEls.get(peerId);
  if (ael) {
    ael.remove();
    peerAudioEls.delete(peerId);
  }
  peerAudioStreams.delete(peerId);
  for (const [prodId, vid] of [...remoteVideoByProducer]) {
    const tile = vid.closest('.tile');
    if (tile && tile.dataset.peerId === peerId) {
      const c = consumerByProducerId.get(prodId);
      if (c && !c.closed) c.close();
      teardownRemoteVideoForProducer(prodId);
    }
  }
}

/**
 * @param {import('mediasoup-client').types.Device} dev
 */
async function createSendTransport(dev) {
  const res = await emitAck('createTransport', { direction: 'send' });
  const transport = dev.createSendTransport({
    id: res.transportId,
    iceParameters: res.iceParameters,
    iceCandidates: res.iceCandidates,
    dtlsParameters: res.dtlsParameters,
  });

  transport.on('connect', ({ dtlsParameters }, callback, errback) => {
    emitAck('connectTransport', { transportId: transport.id, dtlsParameters })
      .then(() => callback())
      .catch((e) => errback(e));
  });

  transport.on('produce', ({ kind, rtpParameters, appData }, callback, errback) => {
    emitAck('produce', {
      transportId: transport.id,
      kind,
      rtpParameters,
      appData: appData && typeof appData === 'object' && !Array.isArray(appData) ? appData : {},
    })
      .then((r) => callback({ id: r.id }))
      .catch((e) => errback(e));
  });

  return transport;
}

/**
 * @param {import('mediasoup-client').types.Device} dev
 */
async function createRecvTransport(dev) {
  const res = await emitAck('createTransport', { direction: 'recv' });
  const transport = dev.createRecvTransport({
    id: res.transportId,
    iceParameters: res.iceParameters,
    iceCandidates: res.iceCandidates,
    dtlsParameters: res.dtlsParameters,
  });

  transport.on('connect', ({ dtlsParameters }, callback, errback) => {
    emitAck('connectTransport', { transportId: transport.id, dtlsParameters })
      .then(() => callback())
      .catch((e) => errback(e));
  });

  return transport;
}

/**
 * @param {string} peerId
 * @param {string} producerId
 * @param {{ appData?: Record<string, unknown> }} [meta]
 */
async function consumeProducer(peerId, producerId, meta = {}) {
  if (!device || !recvTransport) return;

  /** mediasoup-client v3: ask server first, then pass returned params into transport.consume(). */
  const res = await emitAck('consume', {
    transportId: recvTransport.id,
    producerId,
    rtpCapabilities: device.rtpCapabilities,
  });

  const consumer = await recvTransport.consume({
    id: res.id,
    producerId: res.producerId,
    kind: res.kind,
    rtpParameters: res.rtpParameters,
  });

  await emitAck('resumeConsumer', { consumerId: consumer.id });

  producerIdToPeerId.set(producerId, peerId);

  const appData = meta.appData && typeof meta.appData === 'object' ? meta.appData : {};

  if (consumer.kind === 'audio') {
    consumerByProducerId.set(producerId, consumer);
    const stream = peerAudioStreams.get(peerId) || new MediaStream();
    peerAudioStreams.set(peerId, stream);
    if (consumer.track) stream.addTrack(consumer.track);
    const audioEl = ensureRemoteAudio(peerId);
    audioEl.srcObject = stream;
    void audioEl.play().catch(() => {});
    consumer.on('trackended', () => {
      consumerByProducerId.delete(producerId);
      producerIdToPeerId.delete(producerId);
      const s = peerAudioStreams.get(peerId);
      if (s && consumer.track && s.getTracks().some((t) => t === consumer.track)) {
        try {
          s.removeTrack(consumer.track);
        } catch {
          /* ignore */
        }
      }
      if (s && s.getTracks().length === 0) {
        peerAudioStreams.delete(peerId);
        const el = peerAudioEls.get(peerId);
        if (el) el.srcObject = null;
      }
      refreshPeerRemoteMedia(peerId);
    });
    if (consumer.track) {
      consumer.track.addEventListener('mute', () => refreshPeerRemoteMedia(peerId));
      consumer.track.addEventListener('unmute', () => refreshPeerRemoteMedia(peerId));
    }
    refreshPeerRemoteMedia(peerId);
    ensureRemotePeerPlaceholderTiles();
    return;
  }

  // video
  const isScreen = appData.source === 'screen';
  if (!isScreen && remoteVideos) {
    for (const t of remoteVideos.querySelectorAll('.tile.remote-peer[data-placeholder="true"]')) {
      if (t.dataset.peerId === peerId) t.remove();
    }
  }
  const baseName = peerDisplayNames.get(peerId) || `Peer ${peerId.slice(0, 8)}`;
  const labelText = isScreen ? `${baseName} — Screen` : baseName;

  const tile = document.createElement('section');
  tile.className = 'tile remote-peer';
  tile.dataset.peerId = peerId;
  tile.dataset.producerId = producerId;

  const label = document.createElement('span');
  label.className = 'label meet-tile-name';
  label.textContent = labelText;

  const placeholder = document.createElement('div');
  placeholder.className = 'remote-video-placeholder';
  if (isScreen) {
    placeholder.textContent = 'Waiting for media…';
  } else {
    const phWaiting = document.createElement('span');
    phWaiting.className = 'remote-placeholder-waiting';
    phWaiting.textContent = 'Waiting for media…';
    const phOff = document.createElement('div');
    phOff.className = 'remote-placeholder-off';
    phOff.hidden = true;
    const phName = document.createElement('span');
    phName.className = 'remote-placeholder-name';
    phName.textContent = baseName;
    const phSub = document.createElement('span');
    phSub.className = 'remote-placeholder-sub';
    phSub.textContent = 'Camera off';
    phOff.appendChild(phName);
    phOff.appendChild(phSub);
    placeholder.appendChild(phWaiting);
    placeholder.appendChild(phOff);
  }

  const video = document.createElement('video');
  video.playsInline = true;
  video.autoplay = true;
  video.setAttribute('playsinline', '');
  // Remote video must stay muted on the <video> element: audio is played via separate <audio>
  // elements; without muted=true many browsers block autoplay and never show the other person's video.
  video.muted = true;

  const stream = new MediaStream();
  if (consumer.track) stream.addTrack(consumer.track);
  video.srcObject = stream;

  tile.appendChild(label);
  tile.appendChild(placeholder);
  if (isScreen) {
    tile.classList.add('remote-peer-screen');
    tile.dataset.screenSize = 'medium';
    attachScreenShareSizeControls(tile, placeholder);
  } else {
    tile.classList.add('remote-peer-camera');
    if (!tile.dataset.cameraSize) tile.dataset.cameraSize = 'medium';
    attachTileSizeControls(tile, placeholder, 'camera');
  }

  tile.appendChild(video);
  remoteVideos.appendChild(tile);

  remoteVideoByProducer.set(producerId, video);
  remoteVideoStreams.set(producerId, stream);
  consumerByProducerId.set(producerId, consumer);

  if (isScreen) {
    video.classList.add('remote-screen-video');
  } else {
    video.classList.add('remote-camera-video');
  }

  if (stream.getTracks().length > 0) {
    if (isScreen) {
      placeholder.hidden = true;
    }
    void video.play().catch(() => {});
  }
  if (!isScreen) {
    applyRemoteCameraPlaceholder(tile, peerId);
  }

  let staleScreenMuteTimer = null;
  if (isScreen && consumer.track) {
    consumer.track.addEventListener('mute', () => {
      if (staleScreenMuteTimer) clearTimeout(staleScreenMuteTimer);
      // If screen sharing stopped but signaling was delayed/lost, this prevents black stale tiles.
      staleScreenMuteTimer = setTimeout(() => {
        teardownRemoteVideoForProducer(producerId);
      }, 1500);
    });
    consumer.track.addEventListener('unmute', () => {
      if (staleScreenMuteTimer) {
        clearTimeout(staleScreenMuteTimer);
        staleScreenMuteTimer = null;
      }
    });
  }

  consumer.on('trackended', () => {
    if (staleScreenMuteTimer) clearTimeout(staleScreenMuteTimer);
    teardownRemoteVideoForProducer(producerId);
  });

  if (consumer.track && !isScreen) {
    consumer.track.addEventListener('mute', () => {
      refreshPeerRemoteMedia(peerId);
      applyRemoteCameraPlaceholder(tile, peerId);
    });
    consumer.track.addEventListener('unmute', () => {
      tile.dataset.cameraLive = '1';
      refreshPeerRemoteMedia(peerId);
      applyRemoteCameraPlaceholder(tile, peerId);
    });
    video.addEventListener('playing', () => {
      tile.dataset.cameraLive = '1';
      applyRemoteCameraPlaceholder(tile, peerId);
    });
  } else if (consumer.track) {
    consumer.track.addEventListener('mute', () => refreshPeerRemoteMedia(peerId));
    consumer.track.addEventListener('unmute', () => refreshPeerRemoteMedia(peerId));
  }

  applyPeerTileVisibility(peerId);
  refreshPeerRemoteMedia(peerId);
}

async function joinRoom(roomId) {
  if (typeof window !== 'undefined' && window.location?.protocol === 'file:') {
    throw new Error('Open this app via http://localhost (run npm start), not as a file.');
  }
  if (joinInProgress) {
    setStatus('Already connecting…');
    return;
  }

  try {
    assertMediaEnvironment();
  } catch (e) {
    setStatus(e instanceof Error ? e.message : String(e));
    return;
  }

  joinInProgress = true;
  createBtn.disabled = true;
  joinBtn.disabled = true;

  /** Set true only after the full join path succeeds (do not rely on activeRoomId — cleanup clears it). */
  let joinSucceeded = false;

  try {
    setStatus('Connecting… Allow camera/microphone if the browser asks.');
    // Start getUserMedia in the same user-activation turn as Create/Join. If we only call it
    // after await connect + roomJoin, Chrome/Edge may treat the gesture as expired and block
    // or fail the prompt — the room "joins" in signaling but the call never finishes.
    const streamPromise = acquireLocalMedia();

    // NOTE: /^https?:$/i does NOT match window.location.protocol ("http:" / "https:") — always use explicit origin.
    const origin =
      typeof window !== 'undefined' &&
      window.location?.protocol &&
      window.location.protocol.startsWith('http')
        ? window.location.origin
        : undefined;

    socket = io(origin, {
      path: '/socket.io',
      forceNew: true,
      transports: ['websocket', 'polling'],
    });

    await Promise.race([
      new Promise((resolve, reject) => {
        if (socket.connected) {
          resolve();
          return;
        }
        socket.once('connect', resolve);
        socket.once('connect_error', (err) => {
          reject(err instanceof Error ? err : new Error(err?.message || 'Could not connect to server'));
        });
      }),
      withTimeout(25000, 'Connection timed out — is the server running on this URL?'),
    ]);

    socketDisconnectHandler = (reason) => {
      const inSession = Boolean(activeRoomId);
      const midJoin = joinInProgress && !activeRoomId;
      if (!inSession && !midJoin) return;
      void (async () => {
        await cleanup();
        setStatus(
          midJoin
            ? `Disconnected during setup (${reason}). Try again — check that the server is reachable and the page URL matches it (same host/port).`
            : `Disconnected (${reason}). If this was right after joining, check camera permission, firewall, or use HTTPS on LAN.`,
        );
      })();
    };
    socket.on('disconnect', socketDisconnectHandler);

    registerJoinRequestSocketListeners();

    hostChangedListener = ({ hostId }) => {
      if (!socket) return;
      isRoomHost = socket.id === hostId;
      renderParticipantList();
    };
    socket.on('hostChanged', hostChangedListener);

    kickedListener = (data) => {
      void (async () => {
        setStatus((data && data.reason) || 'Removed from the meeting');
        await cleanup();
      })();
    };
    socket.on('kicked', kickedListener);

    const displayName = normalizeDisplayName(displayNameInput?.value);
    const visibility = getRoomVisibilityFromUi();

    let joinPayload = await Promise.race([
      emitAck('roomJoin', { roomId, displayName, visibility }),
      withTimeout(15000, 'Join request timed out'),
    ]);

    if (joinPayload.pending) {
      setStatus('Waiting for host to let you in…');
      try {
        joinPayload = await waitForJoinApprovedOrRejected(socket);
      } catch (e) {
        streamPromise
          .then((s) => s.getTracks().forEach((t) => t.stop()))
          .catch(() => {});
        removeJoinRequestSocketListeners();
        await cleanup();
        throw e instanceof Error ? e : new Error(String(e));
      }
    }

    isRoomHost = Boolean(joinPayload.isHost);

    device = new Device();
    try {
      await device.load({ routerRtpCapabilities: joinPayload.routerRtpCapabilities });
    } catch (e) {
      streamPromise
        .then((s) => s.getTracks().forEach((t) => t.stop()))
        .catch(() => {});
      throw e;
    }

    try {
      localStream = await streamPromise;
    } catch (e) {
      const err = e && typeof e === 'object' ? e : { message: String(e) };
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        throw new Error(
          'Camera/microphone was blocked. Allow access for this site and click Join again.',
        );
      }
      const notFound =
        err.name === 'NotFoundError' ||
        /not found|no device|no input/i.test(String(err.message || ''));
      if (notFound) {
        // VM, privacy lockdown, or machine with no mic/camera — still join to receive others + chat.
        localStream = null;
        setStatus('No camera/mic detected — joining in view-only mode (receive & chat; you won’t send media).');
      } else {
        throw e instanceof Error ? e : new Error(String(e));
      }
    }
    localVideo.srcObject = localStream;
    updateLocalVideoChrome();

    recvTransport = await createRecvTransport(device);
    const canSend =
      localStream &&
      (localStream.getVideoTracks().length > 0 || localStream.getAudioTracks().length > 0);
    // Always create send transport so we can publish screen (getDisplayMedia) even in view‑only / no camera.
    sendTransport = await createSendTransport(device);

    socket.on('newProducer', async ({ peerId, producerId, displayName: remoteName, appData }) => {
      try {
        if (remoteName) peerDisplayNames.set(peerId, remoteName);
        await consumeProducer(peerId, producerId, { appData: appData || {} });
        renderParticipantList();
      } catch (e) {
        console.error('consume', e);
        setStatus(e.message || 'Failed to subscribe');
      }
    });

    socket.on('producerClosed', ({ producerId }) => {
      if (typeof producerId !== 'string') return;
      const c = consumerByProducerId.get(producerId);
      if (c && !c.closed) {
        const kind = c.kind;
        const audioPeerId = producerIdToPeerId.get(producerId);
        const track = kind === 'audio' ? c.track : null;
        try {
          c.close();
        } catch {
          /* ignore */
        }
        if (kind === 'audio' && audioPeerId && track) {
          const s = peerAudioStreams.get(audioPeerId);
          if (s) {
            try {
              s.removeTrack(track);
            } catch {
              /* ignore */
            }
            if (s.getTracks().length === 0) {
              peerAudioStreams.delete(audioPeerId);
              const el = peerAudioEls.get(audioPeerId);
              if (el) el.srcObject = null;
            }
          }
        }
      }
      teardownRemoteVideoForProducer(producerId);
    });

    socket.on('peerJoined', ({ peerId, displayName: joinedName }) => {
      if (!socket || peerId === socket.id) return;
      peerDisplayNames.set(peerId, joinedName || 'Guest');
      renderParticipantList();
    });

    socket.on('peerLeft', ({ peerId }) => {
      removePeerMedia(peerId);
      renderParticipantList();
    });

    socket.on('chatMessage', (payload) => {
      appendChatLine(payload);
    });

    const myName = joinPayload.yourName || displayName;
    myDisplayName = myName;
    updateRoomVisibilityUi(joinPayload.roomVisibility === 'private' ? 'private' : 'public');

    const names = joinPayload.peerNames || {};
    for (const [pid, pname] of Object.entries(names)) {
      peerDisplayNames.set(pid, pname);
    }
    renderParticipantList();

    for (const p of joinPayload.existingProducers || []) {
      await consumeProducer(p.peerId, p.producerId, { appData: p.appData || {} });
    }
    renderParticipantList();

    micProducer = null;
    cameraProducer = null;
    if (sendTransport && localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      const audioTrack = localStream.getAudioTracks()[0];
      if (videoTrack) {
        cameraProducer = await sendTransport.produce({
          track: videoTrack,
          appData: { source: 'camera' },
        });
      }
      if (audioTrack) {
        micProducer = await sendTransport.produce({ track: audioTrack, appData: { source: 'mic' } });
      }
    }

    syncMicCameraButtonUi();
    updateLocalVideoChrome();

    if (screenShareBtn) {
      screenShareBtn.disabled = false;
    }

    const canonicalRoomId = joinPayload.roomId || roomId;
    activeRoomId = canonicalRoomId;
    activeRoomIdEl.textContent = canonicalRoomId;
    if (canonicalRoomId !== roomId) {
      roomInput.value = canonicalRoomId;
    }
    if (localPeerLabel) localPeerLabel.textContent = myName;
    try {
      localStorage.setItem('gm_displayName', myName);
    } catch {
      /* ignore */
    }
    setSessionUiVisible(true);
    syncLocalLayout();
    initWhiteboardSession(joinPayload.whiteboardSnapshot);
    try {
      const u = new URL(window.location.href);
      u.searchParams.set('room', canonicalRoomId);
      history.replaceState({}, '', u.toString());
    } catch {
      /* ignore */
    }
    const viewOnly = !localStream;
    setStatus(
      viewOnly
        ? `Connected (view-only) — room “${canonicalRoomId}”. You can still share your screen (Share screen). Add a mic/camera and rejoin to send camera/mic.`
        : `Connected — room “${canonicalRoomId}”. Copy invite link for another tab, or open this URL in a new tab and click Join.`,
    );
    leaveBtn.disabled = false;
    chatInput.focus();
    joinSucceeded = true;
  } finally {
    joinInProgress = false;
    if (!joinSucceeded) {
      createBtn.disabled = false;
      joinBtn.disabled = false;
    }
  }
}

/** Random id (lowercase + digits) — always valid for normalizeRoomId. */
function generateRandomRoomId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint32Array(12);
  crypto.getRandomValues(bytes);
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    s += chars[bytes[i] % chars.length];
  }
  return s;
}

async function enterRoomFromInput() {
  const normalized = normalizeRoomId(roomInput.value);
  if (!normalized.ok) {
    setStatus(normalized.error);
    return;
  }
  const roomId = normalized.id;
  roomInput.value = roomId;
  try {
    await joinRoom(roomId);
  } catch (e) {
    console.error(e);
    await cleanup();
    setStatus(e.message || 'Could not join');
  }
}

createBtn.addEventListener('click', async () => {
  const id = generateRandomRoomId();
  roomInput.value = id;
  setStatus('Creating room…');
  try {
    await joinRoom(id);
  } catch (e) {
    console.error(e);
    await cleanup();
    setStatus(e.message || 'Could not create room');
  }
});

joinBtn.addEventListener('click', () => {
  enterRoomFromInput();
});

leaveBtn.addEventListener('click', async () => {
  await cleanup();
  setStatus('');
});

copyRoomBtn.addEventListener('click', async () => {
  if (!activeRoomId) return;
  try {
    await navigator.clipboard.writeText(activeRoomId);
    setStatus(`Copied room id “${activeRoomId}”`);
  } catch {
    setStatus('Could not copy (clipboard)');
  }
});

copyInviteBtn.addEventListener('click', async () => {
  if (!activeRoomId) return;
  const url = getInviteUrlForRoom(activeRoomId);
  try {
    await navigator.clipboard.writeText(url);
    setStatus('Copied invite link — open it in a new tab, then click Join.');
  } catch {
    setStatus('Could not copy (clipboard)');
  }
});

if (micToggleBtn) {
  micToggleBtn.addEventListener('click', () => {
    toggleMic();
  });
}
if (cameraToggleBtn) {
  cameraToggleBtn.addEventListener('click', () => {
    toggleCamera();
  });
}
if (screenShareBtn) {
  screenShareBtn.addEventListener('click', async () => {
    if (!sendTransport) return;
    if (screenProducer) {
      stopScreenShare();
      return;
    }
    await startScreenShare();
  });
}

chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = (chatInput.value || '').trim();
  if (!text || !socket) return;
  chatInput.value = '';
  emitAck('chatMessage', { text })
    .then(() => {})
    .catch((err) => {
      if (typeof err === 'object' && err && err.message) setStatus(err.message);
      else setStatus('Could not send chat');
    });
});

if (chatToggleBtn && chatPanel) {
  chatToggleBtn.addEventListener('click', () => {
    chatPanel.hidden = !chatPanel.hidden;
    chatToggleBtn.setAttribute('aria-pressed', chatPanel.hidden ? 'false' : 'true');
    chatToggleBtn.setAttribute('aria-label', chatPanel.hidden ? 'Open chat' : 'Close chat');
  });
}

if (chatCloseBtn && chatPanel) {
  chatCloseBtn.addEventListener('click', () => {
    chatPanel.hidden = true;
    if (chatToggleBtn) {
      chatToggleBtn.setAttribute('aria-pressed', 'false');
      chatToggleBtn.setAttribute('aria-label', 'Open chat');
    }
  });
}

if (whiteboardToggleBtn && whiteboardPanel) {
  whiteboardToggleBtn.addEventListener('click', () => {
    whiteboardPanel.hidden = !whiteboardPanel.hidden;
    const pressed = !whiteboardPanel.hidden;
    whiteboardToggleBtn.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    whiteboardToggleBtn.setAttribute('aria-label', pressed ? 'Close whiteboard' : 'Open whiteboard');
    if (pressed) requestAnimationFrame(() => resizeWhiteboardCanvas());
  });
}

if (whiteboardCloseBtn && whiteboardPanel) {
  whiteboardCloseBtn.addEventListener('click', () => {
    whiteboardPanel.hidden = true;
    if (whiteboardToggleBtn) {
      whiteboardToggleBtn.setAttribute('aria-pressed', 'false');
      whiteboardToggleBtn.setAttribute('aria-label', 'Open whiteboard');
    }
  });
}

if (whiteboardPenBtn && whiteboardEraserBtn) {
  whiteboardPenBtn.addEventListener('click', () => {
    whiteboardTool = 'pen';
    whiteboardPenBtn.classList.add('wb-mode-active');
    whiteboardEraserBtn.classList.remove('wb-mode-active');
  });
  whiteboardEraserBtn.addEventListener('click', () => {
    whiteboardTool = 'eraser';
    whiteboardEraserBtn.classList.add('wb-mode-active');
    whiteboardPenBtn.classList.remove('wb-mode-active');
  });
}

if (whiteboardClearBtn) {
  whiteboardClearBtn.addEventListener('click', () => {
    if (!socket) return;
    emitAck('whiteboardClear', {})
      .then(() => {})
      .catch((e) => setStatus(e instanceof Error ? e.message : String(e)));
  });
}

if (participantList) {
  participantList.addEventListener('click', (e) => {
    const btn = e.target.closest('.participant-toggle-btn');
    if (!btn || !socket) return;
    const peerId = btn.dataset.peerId;
    const action = btn.dataset.action;
    if (!peerId || (action !== 'camera' && action !== 'screen')) return;
    const v = getPeerTileVisibility(peerId);
    if (action === 'camera') v.camera = !v.camera;
    else v.screen = !v.screen;
    applyPeerTileVisibility(peerId);
    updateParticipantToggleButtons(peerId);
  });
}
