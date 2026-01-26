/**
 * @param {any} value
 * @param {number} min
 * @param {number} max
 * @param {number} defaultValue
 * @returns {number}
 */
export function sanitizeNumber(value, min = -Infinity, max = Infinity, defaultValue = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return defaultValue;
  return Math.max(min, Math.min(max, num));
}

/**
 * @param {any} value
 * @param {number} min
 * @param {number} defaultValue
 * @returns {number}
 */
export function sanitizePositiveNumber(value, min = 0, defaultValue = 0) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < min) return defaultValue;
  return num;
}

/**
 * @param {any} value
 * @param {number} maxLength
 * @returns {string}
 */
export function sanitizeString(value, maxLength = 1000) {
  const str = String(value || '');
  return str.slice(0, maxLength);
}

/**
 * @param {any} value
 * @param {number} step
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function sanitizeRotation(value, step = 45, min = 0, max = 360) {
  let num = sanitizeNumber(value, min, max, 0);
  num = Math.round(num / step) * step;
  if (num >= max) num = 0;
  return num;
}

/**
 * @param {Object} rect
 * @returns {{x: number, y: number, w: number, h: number} | null}
 */
export function sanitizeRect(rect) {
  if (!rect || typeof rect !== 'object') return null;
  const x = sanitizeNumber(rect.x, 0, Infinity, 0);
  const y = sanitizeNumber(rect.y, 0, Infinity, 0);
  const w = sanitizePositiveNumber(rect.w, 0.1, 0.1);
  const h = sanitizePositiveNumber(rect.h, 0.1, 0.1);
  return { x, y, w, h };
}

/**
 * @param {Object} circle
 * @returns {{cx: number, cy: number, r: number} | null}
 */
export function sanitizeCircle(circle) {
  if (!circle || typeof circle !== 'object') return null;
  const cx = sanitizeNumber(circle.cx, 0, Infinity, 0);
  const cy = sanitizeNumber(circle.cy, 0, Infinity, 0);
  const r = sanitizePositiveNumber(circle.r, 0.1, 1);
  return { cx, cy, r };
}

/**
 * @param {Object} point
 * @returns {{x: number, y: number}}
 */
export function sanitizePoint(point) {
  if (!point || typeof point !== 'object') return { x: 0, y: 0 };
  return {
    x: sanitizeNumber(point.x, -Infinity, Infinity, 0),
    y: sanitizeNumber(point.y, -Infinity, Infinity, 0)
  };
}
