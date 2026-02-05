// src/surface.js — Universal tileable surface factory
import { uuid, DEFAULT_TILE_PRESET, DEFAULT_SKIRTING_CONFIG } from "./core.js";

const DEFAULT_PATTERN = {
  type: "grid",
  bondFraction: 0.5,
  rotationDeg: 0,
  offsetXcm: 0,
  offsetYcm: 0,
};

const DEFAULT_ORIGIN = { preset: "tl", xCm: 0, yCm: 0 };

const FLOOR_TYPES = ["floor"];

export function createSurface(opts = {}) {
  // Resolved lazily to support circular imports (core.js → surface.js → core.js)
  const DEFAULT_TILE = {
    widthCm: DEFAULT_TILE_PRESET.widthCm,
    heightCm: DEFAULT_TILE_PRESET.heightCm,
    shape: DEFAULT_TILE_PRESET.shape,
    reference: "Standard",
  };
  const DEFAULT_GROUT = {
    widthCm: DEFAULT_TILE_PRESET.groutWidthCm,
    colorHex: DEFAULT_TILE_PRESET.groutColorHex,
  };
  // --- Shape resolution ---
  let polygonVertices;
  let widthCm;
  let heightCm;
  let circle = null;

  if (opts.circleRadius > 0) {
    const r = opts.circleRadius;
    widthCm = 2 * r;
    heightCm = 2 * r;
    circle = { cx: r, cy: r, rx: r, ry: r };
    polygonVertices = null;
  } else if (opts.polygonVertices && opts.polygonVertices.length >= 3) {
    polygonVertices = opts.polygonVertices.map(p => ({ x: p.x, y: p.y }));
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of polygonVertices) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    widthCm = maxX - minX;
    heightCm = maxY - minY;
  } else if (opts.widthCm > 0 && opts.heightCm > 0) {
    widthCm = opts.widthCm;
    heightCm = opts.heightCm;
    polygonVertices = [
      { x: 0, y: 0 },
      { x: widthCm, y: 0 },
      { x: widthCm, y: heightCm },
      { x: 0, y: heightCm },
    ];
  } else if (opts.polygonVertices && opts.polygonVertices.length < 3) {
    throw new Error("polygonVertices must have at least 3 points");
  } else {
    throw new Error("Surface needs a shape: provide polygonVertices or widthCm+heightCm");
  }

  // --- Deep-merge sub-objects ---
  const tile = { ...DEFAULT_TILE, ...opts.tile };
  const grout = { ...DEFAULT_GROUT, ...opts.grout };
  const pattern = {
    ...DEFAULT_PATTERN,
    ...opts.pattern,
    origin: { ...DEFAULT_ORIGIN, ...opts.pattern?.origin },
  };

  // --- Surface type ---
  const surfaceType = opts.surfaceType || "floor";
  const isFloor = FLOOR_TYPES.includes(surfaceType);

  // --- Skirting resolution ---
  let skirting;
  if ("skirting" in opts) {
    skirting = opts.skirting === null ? null : { ...DEFAULT_SKIRTING_CONFIG, ...opts.skirting };
  } else {
    skirting = isFloor ? { ...DEFAULT_SKIRTING_CONFIG } : null;
  }

  // --- Floor-specific fields ---
  let floorPosition;
  if ("floorPosition" in opts) {
    floorPosition = opts.floorPosition;
  } else {
    floorPosition = isFloor ? { x: 0, y: 0 } : null;
  }

  let patternLink;
  if ("patternLink" in opts) {
    patternLink = opts.patternLink;
  } else {
    patternLink = isFloor ? { mode: "independent", linkedRoomId: null } : null;
  }

  return {
    id: uuid(),
    name: opts.name || "Surface",
    surfaceType,
    circle,
    polygonVertices,
    widthCm,
    heightCm,
    tile,
    grout,
    pattern,
    exclusions: opts.exclusions || [],
    excludedTiles: opts.excludedTiles || [],
    excludedSkirts: opts.excludedSkirts || [],
    skirting,
    floorPosition,
    patternLink,
  };
}
