'use strict';

/**
 * Trim, sanitize, and cap length for display names shown in UI and chat.
 * @param {unknown} raw
 * @returns {string}
 */
function normalizeDisplayName(raw) {
  if (raw == null || raw === '') return 'Guest';
  let s = String(raw).trim().replace(/[\x00-\x1f\x7f]/g, '');
  if (s.length > 40) s = s.slice(0, 40);
  if (!s.length) return 'Guest';
  return s;
}

module.exports = { normalizeDisplayName };
