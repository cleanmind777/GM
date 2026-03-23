'use strict';

/** Codecs advertised by each room router (must match client capabilities). */
const mediaCodecs = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: 'video',
    mimeType: 'video/VP8',
    clockRate: 90000,
    parameters: {
      'x-google-start-bitrate': 1000,
    },
  },
];

/**
 * LAN IP or hostname clients use to reach mediasoup ICE candidates.
 * Set MEDIASOUP_ANNOUNCED_IP (e.g. 192.168.1.10) when not using localhost.
 */
function getAnnouncedIp() {
  return process.env.MEDIASOUP_ANNOUNCED_IP || '127.0.0.1';
}

function getListenIps() {
  return [{ ip: '0.0.0.0', announcedIp: getAnnouncedIp() }];
}

module.exports = { mediaCodecs, getListenIps, getAnnouncedIp };
