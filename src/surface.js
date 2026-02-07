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

export function unfoldRoomWalls(room, heightCm) {
  const verts = room.polygonVertices;
  if (!verts || verts.length < 3) return [];

  const pos = room.floorPosition || { x: 0, y: 0 };
  const n = verts.length;

  // Signed area to determine winding (shoelace)
  let area2 = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area2 += verts[i].x * verts[j].y - verts[j].x * verts[i].y;
  }
  const sign = area2 > 0 ? 1 : -1;

  const walls = [];
  for (let i = 0; i < n; i++) {
    const A = verts[i];
    const B = verts[(i + 1) % n];
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const L = Math.sqrt(dx * dx + dy * dy);
    if (L < 1) continue;

    // Per-edge heights from edgeProperties (fallback to uniform heightCm)
    const ep = room.edgeProperties?.[i];
    const hStart = ep?.heightStartCm ?? heightCm;
    const hEnd = ep?.heightEndCm ?? heightCm;

    const nx = sign * dy / L;
    const ny = sign * -dx / L;

    const corners = [
      { x: pos.x + A.x, y: pos.y + A.y },
      { x: pos.x + B.x, y: pos.y + B.y },
      { x: pos.x + B.x + nx * hEnd, y: pos.y + B.y + ny * hEnd },
      { x: pos.x + A.x + nx * hStart, y: pos.y + A.y + ny * hStart },
    ];

    let minX = Infinity, minY = Infinity;
    for (const c of corners) {
      if (c.x < minX) minX = c.x;
      if (c.y < minY) minY = c.y;
    }
    const localVerts = corners.map(c => ({ x: c.x - minX, y: c.y - minY }));

    // Inject doorway exclusions into wall surface
    // Doorway offsetCm is distance along the edge; transform to local coords
    // localVerts: [0]=A@ground, [1]=B@ground, [2]=B@height, [3]=A@height
    const doorwayExclusions = [];
    if (ep?.doorways?.length > 0) {
      const lA = localVerts[0];
      const lB = localVerts[1];
      const lTop = localVerts[3];
      // Edge direction in local space (along wall)
      const edx = (lB.x - lA.x) / L;
      const edy = (lB.y - lA.y) / L;
      // Height direction in local space (up the wall)
      const hLen = Math.hypot(lTop.x - lA.x, lTop.y - lA.y) || 1;
      const hdx = (lTop.x - lA.x) / hLen;
      const hdy = (lTop.y - lA.y) / hLen;

      for (const dw of ep.doorways) {
        const elev = dw.elevationCm || 0;
        // Bottom-left corner of doorway in local coords
        const blx = lA.x + edx * dw.offsetCm + hdx * elev;
        const bly = lA.y + edy * dw.offsetCm + hdy * elev;
        doorwayExclusions.push({
          type: "freeform",
          vertices: [
            { x: blx, y: bly },
            { x: blx + edx * dw.widthCm, y: bly + edy * dw.widthCm },
            { x: blx + edx * dw.widthCm + hdx * dw.heightCm, y: bly + edy * dw.widthCm + hdy * dw.heightCm },
            { x: blx + hdx * dw.heightCm, y: bly + hdy * dw.heightCm }
          ]
        });
      }
    }

    const wall = createSurface({
      name: room.name + " · Wall " + (i + 1),
      polygonVertices: localVerts,
      exclusions: doorwayExclusions,
    });
    wall.sourceRoomId = room.id;
    wall.wallEdgeIndex = i;
    wall.heightStartCm = hStart;
    wall.heightEndCm = hEnd;
    wall.floorPosition = { x: minX, y: minY };
    walls.push(wall);
  }
  return walls;
}

/**
 * Ensure room has correct wall surfaces matching its current geometry
 * Idempotent: safe to call multiple times
 * @param {Object} room - The floor room to generate walls for
 * @param {Object} floor - The floor object containing rooms array
 * @param {Object} options - Options { forceRegenerate: boolean }
 * @returns {Object} { addedWalls: Array, removedWalls: Array, needsPatternGroup: boolean }
 */
export function ensureRoomWalls(room, floor, options = {}) {
  const { forceRegenerate = false } = options;

  // Skip if not a polygon floor room
  if (!room?.polygonVertices || room.polygonVertices.length < 3 || room.sourceRoomId) {
    return { addedWalls: [], removedWalls: [], needsPatternGroup: false };
  }

  const expectedWallCount = room.polygonVertices.length;
  const existingWalls = floor.rooms.filter(r => r.sourceRoomId === room.id);

  // Check if regeneration needed
  const needsRegeneration = forceRegenerate ||
    existingWalls.length !== expectedWallCount ||
    !wallGeometriesMatch(room, existingWalls);

  if (!needsRegeneration) {
    return { addedWalls: [], removedWalls: [], needsPatternGroup: false };
  }

  // Remove old walls
  const removedWalls = [...existingWalls];
  for (const wall of existingWalls) {
    const idx = floor.rooms.indexOf(wall);
    if (idx !== -1) floor.rooms.splice(idx, 1);
  }

  // Generate and add new walls
  const wallHeight = room.wallHeightCm ?? 200;
  const newWalls = unfoldRoomWalls(room, wallHeight);

  for (const wall of newWalls) {
    floor.rooms.push(wall);
  }

  return {
    addedWalls: newWalls,
    removedWalls,
    needsPatternGroup: newWalls.length > 0
  };
}

/**
 * Check if existing walls match the expected geometry for a room
 * @param {Object} room - The floor room
 * @param {Array} walls - Array of wall surfaces
 * @returns {boolean} True if walls match expected geometry
 */
function wallGeometriesMatch(room, walls) {
  if (!walls || walls.length === 0) return false;
  const expectedCount = room.polygonVertices.length;
  if (walls.length !== expectedCount) return false;

  const wallsByEdge = new Map();
  for (const wall of walls) {
    if (wall.wallEdgeIndex === undefined) return false;
    wallsByEdge.set(wall.wallEdgeIndex, wall);
  }

  for (let i = 0; i < expectedCount; i++) {
    if (!wallsByEdge.has(i)) return false;
  }

  return true;
}

/**
 * Transform exclusions from parallelogram wall-surface coords to axis-aligned
 * rectangular coords.  The stored wall surface has parallelogram vertices
 * (P0,P1,P2,P3).  We decompose each point into parametric (t,s) coordinates
 * within the parallelogram, then map to (t * edgeLength, s * wallH).
 * Every exclusion type is normalised to a freeform polygon.
 */
export function transformWallExclusions(exclusions, surfaceVerts, edgeLength, wallH) {
  if (!exclusions?.length || !surfaceVerts || surfaceVerts.length < 4) return [];
  if (edgeLength <= 0 || wallH <= 0) return [];

  const P0 = surfaceVerts[0];
  const U = { x: surfaceVerts[1].x - P0.x, y: surfaceVerts[1].y - P0.y };
  const V = { x: surfaceVerts[3].x - P0.x, y: surfaceVerts[3].y - P0.y };
  const det = U.x * V.y - U.y * V.x;
  if (Math.abs(det) < 0.001) return [];
  const invDet = 1 / det;

  function mapPoint(px, py) {
    const dx = px - P0.x, dy = py - P0.y;
    const t = (V.y * dx - V.x * dy) * invDet;
    const s = (-U.y * dx + U.x * dy) * invDet;
    return { x: t * edgeLength, y: s * wallH };
  }

  return exclusions.map(ex => {
    let vertices;
    if (ex.type === "rect") {
      vertices = [
        mapPoint(ex.x, ex.y),
        mapPoint(ex.x + ex.w, ex.y),
        mapPoint(ex.x + ex.w, ex.y + ex.h),
        mapPoint(ex.x, ex.y + ex.h),
      ];
    } else if (ex.type === "tri") {
      vertices = [mapPoint(ex.p1.x, ex.p1.y), mapPoint(ex.p2.x, ex.p2.y), mapPoint(ex.p3.x, ex.p3.y)];
    } else if (ex.type === "circle") {
      const rx = ex.rx || ex.r || 10;
      const ry = ex.ry || ex.r || 10;
      vertices = [];
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * Math.PI * 2;
        vertices.push(mapPoint(ex.cx + rx * Math.cos(a), ex.cy + ry * Math.sin(a)));
      }
    } else if (ex.type === "freeform" && ex.vertices?.length >= 3) {
      vertices = ex.vertices.map(v => mapPoint(v.x, v.y));
    } else {
      return null;
    }
    return { type: "freeform", vertices };
  }).filter(Boolean);
}

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
    wallHeightCm: opts.wallHeightCm ?? 200,
    skirting,
    floorPosition,
    patternLink,
  };
}
