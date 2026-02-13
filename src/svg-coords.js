// src/svg-coords.js — Single source of truth for SVG coordinate utilities

/**
 * Convert client (screen) coordinates to SVG user-space coordinates.
 * Uses the SVG element's CTM (current transformation matrix) to account
 * for viewBox, zoom, pan, and any CSS transforms.
 */
export function pointerToSvgXY(svg, clientX, clientY) {
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const inv = ctm.inverse();
  const p = pt.matrixTransform(inv);
  return { x: p.x, y: p.y };
}

/**
 * Convert SVG user-space coordinates to client (screen) coordinates.
 */
export function svgPointToClient(svg, x, y) {
  const pt = svg.createSVGPoint();
  pt.x = x;
  pt.y = y;
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const p = pt.matrixTransform(ctm);
  return { x: p.x, y: p.y };
}

/**
 * Snap a value to the nearest millimeter (0.1 cm).
 */
export function snapToMm(value) {
  return Math.round(value * 10) / 10;
}

/**
 * Snap a value to the nearest half-centimeter (0.5 cm).
 */
export function snapToHalfCm(value) {
  return Math.round(value / 0.5) * 0.5;
}

/**
 * Format a cm value for display: integers as "5", decimals as "5.3".
 */
export function formatCm(value) {
  const rounded = Math.round(value * 10) / 10;
  if (!Number.isFinite(rounded)) return "0";
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/**
 * Euclidean distance between two points.
 */
export function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
