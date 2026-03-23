'use strict';

/**
 * Normalize and validate room ids so common input (spaces, etc.) still works.
 * @param {unknown} raw
 * @returns {{ ok: true, id: string } | { ok: false, error: string }}
 */
function normalizeRoomId(raw) {
  if (raw === undefined || raw === null) {
    return { ok: false, error: 'Room id required' };
  }
  const str = String(raw).trim();
  if (!str) {
    return { ok: false, error: 'Room id cannot be empty' };
  }
  let s = str
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (s.length > 64) {
    s = s.slice(0, 64).replace(/-+$/g, '');
  }
  if (!s.length) {
    return {
      ok: false,
      error: 'Use letters, numbers, underscores (_), or hyphens (-) only',
    };
  }
  return { ok: true, id: s };
}

module.exports = { normalizeRoomId };
