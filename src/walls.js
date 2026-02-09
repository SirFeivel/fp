// src/walls.js — Wall entities: single source of truth for wall data
import { uuid, DEFAULT_SKIRTING_CONFIG, DEFAULT_TILE_PRESET } from "./core.js";
import { findSharedEdgeMatches } from "./floor_geometry.js";
import { DEFAULT_WALL_THICKNESS_CM, DEFAULT_WALL_HEIGHT_CM, WALL_ADJACENCY_TOLERANCE_CM } from "./constants.js";

export const DEFAULT_WALL = {
  thicknessCm: DEFAULT_WALL_THICKNESS_CM,
  heightStartCm: DEFAULT_WALL_HEIGHT_CM,
  heightEndCm: DEFAULT_WALL_HEIGHT_CM,
};

const DEFAULT_SURFACE_TILE = {
  widthCm: DEFAULT_TILE_PRESET.widthCm,
  heightCm: DEFAULT_TILE_PRESET.heightCm,
  shape: DEFAULT_TILE_PRESET.shape,
  reference: "Standard",
};
const DEFAULT_SURFACE_GROUT = {
  widthCm: DEFAULT_TILE_PRESET.groutWidthCm,
  colorHex: DEFAULT_TILE_PRESET.groutColorHex,
};
const DEFAULT_SURFACE_PATTERN = {
  type: "grid",
  bondFraction: 0.5,
  rotationDeg: 0,
  offsetXcm: 0,
  offsetYcm: 0,
  origin: { preset: "tl", xCm: 0, yCm: 0 },
};

/**
 * Create a default wall entity.
 * @param {{ x: number, y: number }} start - Start point in floor coords
 * @param {{ x: number, y: number }} end - End point in floor coords
 * @param {{ roomId: string, edgeIndex: number } | null} roomEdge - Link to room edge (null for free-standing)
 * @param {Object} [defaults] - Override default properties
 * @returns {Object} Wall entity
 */
export function createDefaultWall(start, end, roomEdge, defaults = {}) {
  return {
    id: uuid(),
    start: { x: start.x, y: start.y },
    end: { x: end.x, y: end.y },
    thicknessCm: defaults.thicknessCm ?? DEFAULT_WALL.thicknessCm,
    heightStartCm: defaults.heightStartCm ?? DEFAULT_WALL.heightStartCm,
    heightEndCm: defaults.heightEndCm ?? DEFAULT_WALL.heightEndCm,
    roomEdge: roomEdge ? { roomId: roomEdge.roomId, edgeIndex: roomEdge.edgeIndex } : null,
    doorways: defaults.doorways ? defaults.doorways.map(d => ({ ...d })) : [],
    surfaces: defaults.surfaces || [],
  };
}

/**
 * Create a default surface entry for a wall side.
 */
function createDefaultSurface(side, roomId, edgeIndex, fromCm, toCm) {
  return {
    id: uuid(),
    side,
    roomId,
    edgeIndex,
    fromCm,
    toCm,
    tile: null,
    grout: null,
    pattern: null,
    exclusions: [],
    excludedTiles: [],
    skirting: null,
  };
}

/**
 * Index existing walls by their "roomId:edgeIndex" key for fast lookup.
 * @returns {Map<string, Object>}
 */
function indexWallsByEdge(walls) {
  const wallByEdgeKey = new Map();
  for (const wall of walls) {
    if (wall.roomEdge) {
      const key = `${wall.roomEdge.roomId}:${wall.roomEdge.edgeIndex}`;
      wallByEdgeKey.set(key, wall);
    }
  }
  return wallByEdgeKey;
}

/**
 * For each room edge, match an existing wall or create a new one.
 * Updates wall geometry for existing walls, creates surfaces for new walls.
 * @returns {Set<string>} IDs of all walls that correspond to valid room edges
 */
function ensureWallsForEdges(rooms, floor, wallByEdgeKey) {
  const touchedWallIds = new Set();

  for (const room of rooms) {
    const pos = room.floorPosition || { x: 0, y: 0 };
    const verts = room.polygonVertices;
    const n = verts.length;

    for (let i = 0; i < n; i++) {
      const A = verts[i];
      const B = verts[(i + 1) % n];
      const startPt = { x: pos.x + A.x, y: pos.y + A.y };
      const endPt = { x: pos.x + B.x, y: pos.y + B.y };
      const edgeLen = Math.hypot(endPt.x - startPt.x, endPt.y - startPt.y);
      // < 1 cm: skip visually insignificant edges (too short to render a wall)
      if (edgeLen < 1) continue;

      const key = `${room.id}:${i}`;
      let wall = wallByEdgeKey.get(key);

      if (wall) {
        wall.start = startPt;
        wall.end = endPt;
        touchedWallIds.add(wall.id);
      } else {
        wall = createDefaultWall(startPt, endPt, { roomId: room.id, edgeIndex: i });
        const surface = createDefaultSurface("left", room.id, i, 0, edgeLen);
        wall.surfaces.push(surface);
        floor.walls.push(wall);
        wallByEdgeKey.set(key, wall);
        touchedWallIds.add(wall.id);
      }

      const hasOwnSurface = wall.surfaces.some(
        s => s.roomId === room.id && s.edgeIndex === i
      );
      if (!hasOwnSurface) {
        wall.surfaces.push(createDefaultSurface("left", room.id, i, 0, edgeLen));
      } else {
        // Update surface range to match current edge length.
        // Reset fromCm=0 because wall.start was just set to this room's edge start;
        // mergeSharedEdgeWalls will shift it if the wall gets extended for shared edges.
        for (const s of wall.surfaces) {
          if (s.roomId === room.id && s.edgeIndex === i) {
            s.fromCm = 0;
            s.toCm = edgeLen;
          }
        }
      }
    }
  }

  return touchedWallIds;
}

/**
 * Detect shared edges between rooms — merge duplicate walls and add surfaces
 * for adjacent rooms onto the surviving wall.
 */
function mergeSharedEdgeWalls(rooms, floor, wallByEdgeKey, touchedWallIds) {
  for (const room of rooms) {
    const verts = room.polygonVertices;
    if (!verts || verts.length < 3) continue;
    const n = verts.length;
    const otherRooms = rooms.filter(r => r.id !== room.id);

    for (let i = 0; i < n; i++) {
      const key = `${room.id}:${i}`;
      const wall = wallByEdgeKey.get(key);
      if (!wall) continue;

      // + 1 cm: adjacency detection tolerance beyond wall thickness
      const wallTolerance = (wall.thicknessCm ?? DEFAULT_WALL_THICKNESS_CM) + 1;
      const matches = findSharedEdgeMatches(room, i, otherRooms, wallTolerance);
      for (const match of matches) {
        const existing = wall.surfaces.find(
          s => s.roomId === match.room.id && s.edgeIndex === match.edgeIndex
        );
        if (!existing) {
          const surface = createDefaultSurface(
            "right",
            match.room.id,
            match.edgeIndex,
            match.overlapStartCm,
            match.overlapEndCm
          );
          wall.surfaces.push(surface);
        } else {
          existing.fromCm = match.overlapStartCm;
          existing.toCm = match.overlapEndCm;
        }

        // Shared edges should be ONE wall — merge the other room's wall into this one
        const otherKey = `${match.room.id}:${match.edgeIndex}`;
        const otherWall = wallByEdgeKey.get(otherKey);
        if (otherWall && otherWall.id !== wall.id) {
          for (const dw of otherWall.doorways) {
            if (!wall.doorways.some(d => d.id === dw.id)) {
              wall.doorways.push(dw);
            }
          }
          for (const s of otherWall.surfaces) {
            if (!wall.surfaces.some(ws => ws.roomId === s.roomId && ws.edgeIndex === s.edgeIndex)) {
              wall.surfaces.push(s);
            }
          }

          // Extend the surviving wall to cover the union of both walls
          const wdx = wall.end.x - wall.start.x;
          const wdy = wall.end.y - wall.start.y;
          const wLen = Math.hypot(wdx, wdy);
          // >= 1 cm: wall must have meaningful length for safe direction computation
          if (wLen >= 1) {
            const wDirX = wdx / wLen, wDirY = wdy / wLen;
            const t1 = (otherWall.start.x - wall.start.x) * wDirX + (otherWall.start.y - wall.start.y) * wDirY;
            const t2 = (otherWall.end.x - wall.start.x) * wDirX + (otherWall.end.y - wall.start.y) * wDirY;

            const newMin = Math.min(0, t1, t2);
            const newMax = Math.max(wLen, t1, t2);
            const shift = -newMin;

            if (shift > 0.5 || newMax > wLen + 0.5) {
              if (shift > 0.5) {
                for (const s of wall.surfaces) {
                  s.fromCm += shift;
                  s.toCm += shift;
                }
                for (const dw of wall.doorways) {
                  dw.offsetCm += shift;
                }
              }
              const sx = wall.start.x, sy = wall.start.y;
              wall.start = { x: sx + wDirX * newMin, y: sy + wDirY * newMin };
              wall.end = { x: sx + wDirX * newMax, y: sy + wDirY * newMax };
            }

            const otherFrom = Math.min(t1, t2) + shift;
            const otherTo = Math.max(t1, t2) + shift;
            const sharedSurf = wall.surfaces.find(
              s => s.roomId === match.room.id && s.edgeIndex === match.edgeIndex
            );
            if (sharedSurf) {
              sharedSurf.fromCm = otherFrom;
              sharedSurf.toCm = otherTo;
            }
          }

          const idx = floor.walls.indexOf(otherWall);
          if (idx !== -1) floor.walls.splice(idx, 1);
          wallByEdgeKey.delete(otherKey);
          touchedWallIds.delete(otherWall.id);
        }
      }
    }
  }
}

/**
 * Remove surfaces whose rooms no longer exist or whose room edges are
 * geometrically too far from the wall's line.
 */
function pruneOrphanSurfaces(floor, rooms, roomIds) {
  for (const wall of floor.walls) {
    const wdx = wall.end.x - wall.start.x;
    const wdy = wall.end.y - wall.start.y;
    const wLen = Math.hypot(wdx, wdy);
    // < 0.01: numerical degeneracy guard — avoid division by near-zero length
    const wnx = wLen > 0.01 ? wdx / wLen : 0;
    const wny = wLen > 0.01 ? wdy / wLen : 0;

    wall.surfaces = wall.surfaces.filter(s => {
      if (!roomIds.has(s.roomId)) return false;
      const sRoom = rooms.find(r => r.id === s.roomId);
      if (!sRoom) return false;
      const sVerts = sRoom.polygonVertices;
      if (!sVerts || s.edgeIndex >= sVerts.length) return false;
      const sPos = sRoom.floorPosition || { x: 0, y: 0 };
      const eA = sVerts[s.edgeIndex];
      const eMid = {
        x: sPos.x + eA.x + (sVerts[(s.edgeIndex + 1) % sVerts.length].x - eA.x) * 0.5,
        y: sPos.y + eA.y + (sVerts[(s.edgeIndex + 1) % sVerts.length].y - eA.y) * 0.5,
      };
      const vx = eMid.x - wall.start.x, vy = eMid.y - wall.start.y;
      const perpDist = Math.abs(vx * wny - vy * wnx);
      // + 2 cm: slightly wider tolerance than wall thickness for adjacency detection
      const maxDist = (wall.thicknessCm ?? DEFAULT_WALL_THICKNESS_CM) + 2;
      return perpDist <= maxDist;
    });
  }
}

/**
 * Remove stale walls: those linked to degenerate (zero-length) edges not
 * processed in ensureWallsForEdges, and orphaned walls with no surfaces.
 */
function removeStaleWalls(floor, touchedWallIds, roomIds) {
  floor.walls = floor.walls.filter(wall => {
    if (wall.roomEdge && !touchedWallIds.has(wall.id)) return false;
    if (wall.surfaces.length > 0) return true;
    if (wall.roomEdge && roomIds.has(wall.roomEdge.roomId)) return true;
    return false;
  });
}

/**
 * Enforce adjacent room positions for shared walls.
 * The adjacent room's touching edge must sit at the wall's outer edge
 * (perpendicular distance from inner edge = wall thickness).
 */
function enforceAdjacentPositions(floor) {
  for (const wall of floor.walls) {
    if (wall.surfaces.length < 2) continue;
    const ownerRoomId = wall.roomEdge?.roomId;
    if (!ownerRoomId) continue;

    const normal = getWallNormal(wall, floor);
    const thick = wall.thicknessCm ?? DEFAULT_WALL_THICKNESS_CM;

    const adjSurf = wall.surfaces.find(s => s.roomId !== ownerRoomId);
    if (!adjSurf) continue;

    const adjRoom = floor.rooms.find(r => r.id === adjSurf.roomId);
    if (!adjRoom?.polygonVertices?.length) continue;

    const adjPos = adjRoom.floorPosition || { x: 0, y: 0 };
    const adjVertex = adjRoom.polygonVertices[adjSurf.edgeIndex];
    if (!adjVertex) continue;

    const currentDist =
      (adjPos.x + adjVertex.x - wall.start.x) * normal.x +
      (adjPos.y + adjVertex.y - wall.start.y) * normal.y;

    const delta = thick - currentDist;
    if (Math.abs(delta) < 0.5) continue;

    adjRoom.floorPosition = {
      x: adjPos.x + normal.x * delta,
      y: adjPos.y + normal.y * delta,
    };
  }
}

/**
 * Core sync algorithm. Called after any room change.
 * Ensures floor.walls[] matches the current room geometry.
 *
 * @param {Object} floor - Floor object with rooms[] and walls[]
 */
export function syncFloorWalls(floor) {
  if (!floor) return;
  if (!floor.walls) floor.walls = [];

  const rooms = (floor.rooms || []).filter(
    r => r.polygonVertices?.length >= 3 && !(r.circle?.rx > 0)
  );
  const roomIds = new Set(rooms.map(r => r.id));

  const wallByEdgeKey = indexWallsByEdge(floor.walls);
  const touchedWallIds = ensureWallsForEdges(rooms, floor, wallByEdgeKey);
  mergeSharedEdgeWalls(rooms, floor, wallByEdgeKey, touchedWallIds);
  pruneOrphanSurfaces(floor, rooms, roomIds);
  removeStaleWalls(floor, touchedWallIds, roomIds);
  enforceAdjacentPositions(floor);
}

/**
 * Get all walls that have a surface facing a given room.
 * @param {Object} floor
 * @param {string} roomId
 * @returns {Array} Array of wall objects
 */
export function getWallsForRoom(floor, roomId) {
  if (!floor?.walls) return [];
  return floor.walls.filter(
    w => w.surfaces.some(s => s.roomId === roomId) ||
         (w.roomEdge && w.roomEdge.roomId === roomId)
  );
}

/**
 * Get the wall linked to a specific room edge.
 * @param {Object} floor
 * @param {string} roomId
 * @param {number} edgeIndex
 * @returns {Object|null} Wall entity or null
 */
export function getWallForEdge(floor, roomId, edgeIndex) {
  if (!floor?.walls) return null;
  return floor.walls.find(
    w => w.roomEdge && w.roomEdge.roomId === roomId && w.roomEdge.edgeIndex === edgeIndex
  ) || floor.walls.find(
    w => w.surfaces.some(s => s.roomId === roomId && s.edgeIndex === edgeIndex)
  ) || null;
}

/**
 * Get a wall by its ID.
 */
export function getWallById(floor, wallId) {
  if (!floor?.walls) return null;
  return floor.walls.find(w => w.id === wallId) || null;
}

/**
 * Compute the outward normal direction for a wall based on its owning room's polygon winding.
 * Returns a unit vector {x, y} pointing away from the room interior.
 */
export function getWallNormal(wall, floor) {
  const re = wall.roomEdge;
  if (!re) return { x: 0, y: -1 };
  const room = (floor.rooms || []).find(r => r.id === re.roomId);
  if (!room?.polygonVertices || room.polygonVertices.length < 3) return { x: 0, y: -1 };

  const verts = room.polygonVertices;
  let area2 = 0;
  for (let i = 0; i < verts.length; i++) {
    const j = (i + 1) % verts.length;
    area2 += verts[i].x * verts[j].y - verts[j].x * verts[i].y;
  }
  const sign = area2 > 0 ? 1 : -1;

  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const len = Math.hypot(dx, dy);
  if (len < 0.001) return { x: 0, y: -1 };

  return { x: sign * dy / len, y: -sign * dx / len };
}

/**
 * Compute corner extensions for all edges of a room so that adjacent wall
 * outer edges meet properly at corners, regardless of angle.
 *
 * For right-angle corners the extension equals the neighbor wall's thickness.
 * For other angles it computes where the outer edge lines intersect.
 *
 * @param {Object} floor - Floor containing walls[]
 * @param {string} roomId - The room whose edges to compute extensions for
 * @returns {Map<number, {extStart: number, extEnd: number}>} edgeIndex → extensions
 */
export function computeWallExtensions(floor, roomId) {
  const room = (floor.rooms || []).find(r => r.id === roomId);
  if (!room?.polygonVertices?.length) return new Map();

  const verts = room.polygonVertices;
  const n = verts.length;
  if (n < 3) return new Map();

  // Compute winding sign (screen-coords: positive signed area = CW visually)
  let area2 = 0;
  for (let k = 0; k < n; k++) {
    const kn = (k + 1) % n;
    area2 += verts[k].x * verts[kn].y - verts[kn].x * verts[k].y;
  }
  const windingSign = area2 > 0 ? 1 : -1;

  // Build edge → thickness map from floor walls
  const edgeThick = new Map();
  for (const w of (floor.walls || [])) {
    const re = w.roomEdge;
    if (re?.roomId === roomId) {
      edgeThick.set(re.edgeIndex, w.thicknessCm ?? DEFAULT_WALL_THICKNESS_CM);
    }
  }

  // Detect "guest" shared edges: edges of this room that live on walls owned by other rooms.
  // Extensions at corners meeting guest shared edges should be zero to avoid
  // reaching into the adjacent room.
  const guestSharedEdges = new Set();
  for (const w of (floor.walls || [])) {
    if (w.roomEdge?.roomId !== roomId) {
      for (const s of w.surfaces) {
        if (s.roomId === roomId) guestSharedEdges.add(s.edgeIndex);
      }
    }
  }

  // Pre-compute normalized edge directions
  const dirs = [];
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    const dx = verts[next].x - verts[i].x;
    const dy = verts[next].y - verts[i].y;
    const len = Math.hypot(dx, dy);
    dirs.push(len > 0.01 ? { x: dx / len, y: dy / len, len } : { x: 0, y: 0, len: 0 });
  }

  const result = new Map();

  for (let i = 0; i < n; i++) {
    const prev = (i - 1 + n) % n;
    const next = (i + 1) % n;
    const thick = edgeThick.get(i) ?? DEFAULT_WALL_THICKNESS_CM;
    const thickPrev = edgeThick.get(prev) ?? DEFAULT_WALL_THICKNESS_CM;
    const thickNext = edgeThick.get(next) ?? DEFAULT_WALL_THICKNESS_CM;

    const dB = dirs[i];     // current wall direction
    const dA = dirs[prev];  // previous wall direction
    const dC = dirs[next];  // next wall direction

    let extStart = thickPrev; // fallback for degenerate cases
    let extEnd = thickNext;

    // Don't extend past guest shared edges (would reach into adjacent room)
    if (guestSharedEdges.has(prev)) {
      extStart = 0;
    } else if (dA.len > 0.01 && dB.len > 0.01) {
      // extStart: intersection of wall A's outer edge with wall B's outer edge at vertex[i]
      const crossAB = dA.x * dB.y - dA.y * dB.x;
      if (Math.abs(crossAB) > 0.01) {
        const dotAB = dA.x * dB.x + dA.y * dB.y;
        const tB = windingSign * (thick * dotAB - thickPrev) / crossAB;
        extStart = Math.max(0, Math.min(-tB, Math.max(thickPrev, thick) * 3));
      }
    }

    if (guestSharedEdges.has(next)) {
      extEnd = 0;
    } else if (dB.len > 0.01 && dC.len > 0.01) {
      // extEnd: intersection of wall B's outer edge with wall C's outer edge at vertex[next]
      const crossBC = dB.x * dC.y - dB.y * dC.x;
      if (Math.abs(crossBC) > 0.01) {
        const dotBC = dB.x * dC.x + dB.y * dC.y;
        const t = windingSign * (thickNext - thick * dotBC) / crossBC;
        extEnd = Math.max(0, Math.min(t, Math.max(thickNext, thick) * 3));
      }
    }

    result.set(i, { extStart, extEnd });
  }

  return result;
}

/**
 * Adapter: convert a wall surface into a tileable region compatible with
 * the existing tiling pipeline (tilesForPreview, computeAvailableArea).
 *
 * @param {Object} wall - Wall entity
 * @param {number} surfaceIdx - Index into wall.surfaces[]
 * @returns {Object} { polygonVertices, widthCm, heightCm, tile, grout, pattern, exclusions, excludedTiles }
 */
export function wallSurfaceToTileableRegion(wall, surfaceIdx) {
  const surface = wall.surfaces[surfaceIdx];
  if (!surface) return null;

  const wallLen = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
  const fromCm = surface.fromCm || 0;
  const toCm = surface.toCm || wallLen;
  const width = toCm - fromCm;
  const hStart = wall.heightStartCm ?? DEFAULT_WALL_HEIGHT_CM;
  const hEnd = wall.heightEndCm ?? DEFAULT_WALL_HEIGHT_CM;

  // For partial surfaces, interpolate heights
  const tStart = wallLen > 0 ? fromCm / wallLen : 0;
  const tEnd = wallLen > 0 ? toCm / wallLen : 1;
  const surfaceHStart = hStart + (hEnd - hStart) * tStart;
  const surfaceHEnd = hStart + (hEnd - hStart) * tEnd;
  const maxH = Math.max(surfaceHStart, surfaceHEnd);

  // Trapezoid for sloped walls, rectangle for uniform
  const polygonVertices = (Math.abs(surfaceHStart - surfaceHEnd) > 0.1)
    ? [
        { x: 0, y: 0 },
        { x: width, y: 0 },
        { x: width, y: surfaceHEnd },
        { x: 0, y: surfaceHStart },
      ]
    : [
        { x: 0, y: 0 },
        { x: width, y: 0 },
        { x: width, y: maxH },
        { x: 0, y: maxH },
      ];

  // Map doorway exclusions that fall within this surface's range
  const doorwayExclusions = [];
  for (const dw of wall.doorways) {
    const dwStart = dw.offsetCm;
    const dwEnd = dw.offsetCm + dw.widthCm;
    // Check if doorway overlaps this surface's range
    const overlapStart = Math.max(dwStart, fromCm);
    const overlapEnd = Math.min(dwEnd, toCm);
    if (overlapEnd - overlapStart < 1) continue;

    const localStart = overlapStart - fromCm;
    const localEnd = overlapEnd - fromCm;
    const elev = dw.elevationCm || 0;
    doorwayExclusions.push({
      type: "freeform",
      vertices: [
        { x: localStart, y: elev },
        { x: localEnd, y: elev },
        { x: localEnd, y: elev + dw.heightCm },
        { x: localStart, y: elev + dw.heightCm },
      ],
    });
  }

  const allExclusions = [...doorwayExclusions, ...(surface.exclusions || [])];

  return {
    id: surface.id,
    polygonVertices,
    widthCm: width,
    heightCm: maxH,
    tile: surface.tile || { ...DEFAULT_SURFACE_TILE },
    grout: surface.grout || { ...DEFAULT_SURFACE_GROUT },
    pattern: surface.pattern || { ...DEFAULT_SURFACE_PATTERN },
    exclusions: allExclusions,
    excludedTiles: surface.excludedTiles || [],
  };
}

/**
 * Add a doorway to a wall.
 */
export function addDoorwayToWall(wall, doorway) {
  if (!wall || !doorway) return;
  if (!wall.doorways) wall.doorways = [];
  wall.doorways.push(doorway);
}

/**
 * Remove a doorway from a wall by ID.
 */
export function removeDoorwayFromWall(wall, doorwayId) {
  if (!wall?.doorways) return;
  wall.doorways = wall.doorways.filter(d => d.id !== doorwayId);
}

/**
 * Find the wall containing a specific doorway by doorway ID.
 * @param {Object} floor
 * @param {string} doorwayId
 * @returns {{ wall: Object, doorway: Object } | null}
 */
export function findWallByDoorwayId(floor, doorwayId) {
  if (!floor?.walls) return null;
  for (const wall of floor.walls) {
    const dw = wall.doorways?.find(d => d.id === doorwayId);
    if (dw) return { wall, doorway: dw };
  }
  return null;
}

/**
 * Get all doorways that affect a specific room edge, including doorways
 * from shared walls (cross-room doorways).
 * @param {Object} floor
 * @param {string} roomId
 * @param {number} edgeIndex
 * @returns {Array} Doorway objects with offset in the room edge's coordinate space
 */
export function getEdgeDoorways(floor, roomId, edgeIndex) {
  const wall = getWallForEdge(floor, roomId, edgeIndex);
  if (!wall) return [];

  // All doorways on this wall are visible from both sides
  return (wall.doorways || []).map(dw => ({
    id: dw.id,
    offsetCm: dw.offsetCm,
    widthCm: dw.widthCm,
    heightCm: dw.heightCm,
    elevationCm: dw.elevationCm || 0,
  }));
}
