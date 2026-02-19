// src/viewport.js
// Module-level state for zoom/pan (not persisted, not in undo stack)

const viewports = new Map();

const DEFAULT_VIEWPORT = {
  zoom: 1,
  panX: 0,
  panY: 0,
  baseViewBox: null
};

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 50;

export function getViewport(roomId) {
  if (!roomId) return { ...DEFAULT_VIEWPORT };
  if (!viewports.has(roomId)) {
    viewports.set(roomId, { ...DEFAULT_VIEWPORT });
  }
  return viewports.get(roomId);
}

export function setViewport(roomId, updates) {
  if (!roomId) return;
  const current = getViewport(roomId);
  const next = { ...current, ...updates };

  // Clamp zoom to valid range
  next.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next.zoom));

  viewports.set(roomId, next);
  return next;
}

export function resetViewport(roomId) {
  if (!roomId) return;
  const current = getViewport(roomId);
  viewports.set(roomId, {
    ...DEFAULT_VIEWPORT,
    baseViewBox: current.baseViewBox
  });
  return getViewport(roomId);
}

export function setBaseViewBox(roomId, viewBox) {
  if (!roomId) return;
  const current = getViewport(roomId);
  viewports.set(roomId, { ...current, baseViewBox: viewBox });
}

export function calculateEffectiveViewBox(roomId) {
  const vp = getViewport(roomId);
  const base = vp.baseViewBox;
  if (!base) return null;

  const { minX, minY, width, height } = base;
  const { zoom, panX, panY } = vp;

  // Zooming shrinks viewBox dimensions
  const newWidth = width / zoom;
  const newHeight = height / zoom;

  // Center the zoom
  const centerX = minX + width / 2;
  const centerY = minY + height / 2;

  // Calculate new origin (centered, then apply pan)
  const newMinX = centerX - newWidth / 2 + panX;
  const newMinY = centerY - newHeight / 2 + panY;

  return {
    minX: newMinX,
    minY: newMinY,
    width: newWidth,
    height: newHeight
  };
}
