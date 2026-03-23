'use strict';

class Room {
  /**
   * @param {string} roomId
   * @param {import('mediasoup').types.Router} router
   */
  constructor(roomId, router) {
    this.roomId = roomId;
    this.router = router;
    this.peers = new Map();
    /** @type {boolean} */
    this.isPrivate = false;
    /** @type {string | null} */
    this.hostId = null;
    /** @type {Map<string, { socketId: string, displayName: string }>} */
    this.pendingJoins = new Map();
    /** Normalized stroke segments for whiteboard sync (capped on server). */
    /** @type {Array<{ x0: number, y0: number, x1: number, y1: number, color: string, width: number, tool: string }>} */
    this.whiteboardLines = [];
  }

  /**
   * @param {string} peerId
   * @param {string} displayName
   */
  addPeer(peerId, displayName = 'Guest') {
    this.peers.set(peerId, {
      displayName: displayName || 'Guest',
      transports: new Map(),
      producers: new Map(),
      consumers: new Map(),
    });
  }

  /**
   * Map of peerId → displayName for everyone in the room except `excludePeerId`.
   * @param {string} excludePeerId
   * @returns {Record<string, string>}
   */
  getPeerDisplayNames(excludePeerId) {
    const o = {};
    for (const [peerId, peer] of this.peers) {
      if (peerId === excludePeerId) continue;
      o[peerId] = peer.displayName || 'Guest';
    }
    return o;
  }

  /**
   * @param {string} peerId
   */
  removePeer(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    for (const transport of peer.transports.values()) {
      transport.close();
    }
    this.peers.delete(peerId);
  }

  getExistingProducersFor(excludePeerId) {
    const list = [];
    for (const [peerId, peer] of this.peers) {
      if (peerId === excludePeerId) continue;
      for (const [producerId, producer] of peer.producers) {
        list.push({
          peerId,
          producerId,
          kind: producer.kind,
          appData: producer.appData && typeof producer.appData === 'object' ? producer.appData : {},
        });
      }
    }
    return list;
  }

  findProducerById(producerId) {
    for (const peer of this.peers.values()) {
      const p = peer.producers.get(producerId);
      if (p) return p;
    }
    return null;
  }
}

module.exports = { Room };
