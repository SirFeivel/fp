// src/walls.js — Wall entities: single source of truth for wall data
import { uuid, DEFAULT_SKIRTING_CONFIG, DEFAULT_TILE_PRESET } from "./core.js";
import { findSharedEdgeMatches } from "./floor_geometry.js";
import { DEFAULT_WALL_THICKNESS_CM, DEFAULT_WALL_HEIGHT_CM, WALL_ADJACENCY_TOLERANCE_CM, EPSILON } from "./constants.js";
import { computeSkirtingSegments, roomPolygon } from "./geometry.js";

export const DEFAULT_WALL = {
  thicknessCm: DEFAULT_WALL_THICKNESS_CM,
  heightStartCm: DEFAULT_WALL_HEIGHT_CM,
  heightEndCm: DEFAULT_WALL_HEIGHT_CM,
};

export const DEFAULT_SURFACE_TILE = {
  widthCm: DEFAULT_TILE_PRESET.widthCm,
  heightCm: DEFAULT_TILE_PRESET.heightCm,
  shape: DEFAULT_TILE_PRESET.shape,
  reference: "Standard",
};
export const DEFAULT_SURFACE_GROUT = {
  widthCm: DEFAULT_TILE_PRESET.groutWidthCm,
  colorHex: DEFAULT_TILE_PRESET.groutColorHex,
};
export const DEFAULT_SURFACE_PATTERN = {
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
        // Delete doorways when wall geometry changes (room drag/resize)
        // to avoid complex offset compensation and ghost doorways
        const oldLen = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
        const geometryChanged = oldLen > 1 && (
          Math.abs(wall.start.x - startPt.x) > 0.5 ||
          Math.abs(wall.start.y - startPt.y) > 0.5 ||
          Math.abs(wall.end.x - endPt.x) > 0.5 ||
          Math.abs(wall.end.y - endPt.y) > 0.5
        );
        if (geometryChanged && wall.doorways.length > 0) {
          wall.doorways = [];
        }
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
              // Wall is being extended/shifted — delete all doorways instead of compensating
              if (wall.doorways.length > 0) {
                wall.doorways = [];
              }
              if (shift > 0.5) {
                for (const s of wall.surfaces) {
                  s.fromCm += shift;
                  s.toCm += shift;
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
 * Get ALL walls that have a surface for a specific room edge.
 * Unlike getWallForEdge (singular), this returns every wall — needed when
 * multiple walls cover parts of the same room edge (e.g. adjacent rooms
 * each owning a wall that shares a surface with a third room's edge).
 */
export function getWallsForEdge(floor, roomId, edgeIndex) {
  if (!floor?.walls) return [];
  return floor.walls.filter(
    w => w.surfaces.some(s => s.roomId === roomId && s.edgeIndex === edgeIndex)
  );
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
 * Check if a specific room edge has active (non-excluded) skirting pieces.
 *
 * @param {Object} room - Room entity with skirting configuration
 * @param {number} edgeIndex - Index of the edge to check
 * @param {Object} floor - Floor entity for doorway intervals
 * @returns {boolean} true if edge has at least one active skirting piece
 */
export function edgeHasActiveSkirting(room, edgeIndex, floor) {
  if (!room || !room.skirting || room.skirting.enabled === false || edgeIndex == null) {
    return false;
  }

  // Get room polygon vertices
  const poly = roomPolygon(room);
  if (!poly || poly.length === 0 || !poly[0] || poly[0].length === 0) return false;

  const verts = poly[0][0]; // Outer ring (multipolygon format: [[[ring]]])
  if (!verts || verts.length < 3) return false;

  // Get edge endpoints
  const v1 = verts[edgeIndex];
  const v2 = verts[(edgeIndex + 1) % verts.length];
  if (!v1 || !v2) return false;

  // Get all skirting segments (including excluded ones)
  const segments = computeSkirtingSegments(room, true, floor);

  // Check if any segment lies on this edge and is NOT excluded
  for (const seg of segments) {
    if (seg.excluded) continue; // Skip excluded segments

    // Check if segment is collinear with edge
    const [p1x, p1y] = seg.p1;
    const [p2x, p2y] = seg.p2;

    // Vector from v1 to v2
    const edgeDx = v2[0] - v1[0];
    const edgeDy = v2[1] - v1[1];
    const edgeLen = Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy);
    if (edgeLen < EPSILON) continue;

    // Check if p1 is on the line from v1 to v2
    const p1Dx = p1x - v1[0];
    const p1Dy = p1y - v1[1];
    const crossProduct1 = Math.abs(edgeDx * p1Dy - edgeDy * p1Dx);

    // Check if p2 is on the line from v1 to v2
    const p2Dx = p2x - v1[0];
    const p2Dy = p2y - v1[1];
    const crossProduct2 = Math.abs(edgeDx * p2Dy - edgeDy * p2Dx);

    // If both cross products are near zero, segment is collinear with edge
    if (crossProduct1 < EPSILON * edgeLen && crossProduct2 < EPSILON * edgeLen) {
      // Check if segment is within edge bounds (not beyond v1-v2)
      const t1 = (p1Dx * edgeDx + p1Dy * edgeDy) / (edgeLen * edgeLen);
      const t2 = (p2Dx * edgeDx + p2Dy * edgeDy) / (edgeLen * edgeLen);

      // Segment must be within [0, 1] range of edge
      if ((t1 >= -EPSILON && t1 <= 1 + EPSILON) ||
          (t2 >= -EPSILON && t2 <= 1 + EPSILON)) {
        return true; // Found at least one active segment on this edge
      }
    }
  }

  return false;
}

/**
 * Compute wall tiling offset due to floor skirting.
 * Single source of truth for skirting offset calculation.
 *
 * @param {Object} room - Room entity with skirting configuration
 * @param {number} edgeIndex - Index of the edge this wall surface belongs to
 * @param {Object} floor - Floor entity for doorway intervals
 * @param {number} groutWidth - Grout width in cm
 * @returns {number} Offset in cm from floor where wall tiles should start
 */
export function computeWallSkirtingOffset(room, edgeIndex, floor, groutWidth) {
  // If skirting disabled globally for room, no offset
  if (!room || room.skirting?.enabled === false) {
    return 0;
  }

  // Check if this specific edge has active skirting
  if (!edgeHasActiveSkirting(room, edgeIndex, floor)) {
    return 0;
  }

  // Calculate offset: skirting height + grout above and below
  const skirtingHeight = room.skirting.heightCm || 0;
  return skirtingHeight + 2 * (groutWidth || 0);
}

/**
 * Converts a wall surface into a 2D "room-like" region for tile computation.
 *
 * Coordinate space:
 *   X: 0 at surface start, increasing along wall to surface width
 *   Y: 0 at ceiling (top of SVG), increasing downward to maxH at floor
 *      (Y is flipped from world coords where 0 = floor)
 *
 * This convention matches SVG's top-left origin. The three-view.js wall mapper
 * (createWallMapper) implicitly un-flips via bilinear interpolation from the
 * polygon vertices.
 *
 * Consumers: main.js prepareFloorWallData (3D data), main.js surface editor
 *
 * @param {Object} wall - Wall entity
 * @param {number} surfaceIdx - Index into wall.surfaces[]
 * @param {Object} options - Optional { room, floor } for skirting offset calculation
 * @returns {Object} { polygonVertices, widthCm, heightCm, tile, grout, pattern, exclusions, excludedTiles, skirtingOffset }
 */
export function wallSurfaceToTileableRegion(wall, surfaceIdx, options = {}) {
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

  // Compute skirting offset if room context is provided
  const room = options?.room;
  const floor = options?.floor;
  const edgeIndex = surface?.edgeIndex;
  const groutWidth = surface?.grout?.widthCm ?? 0;

  let skirtingOffset = 0;
  if (room && edgeIndex != null) {
    skirtingOffset = computeWallSkirtingOffset(room, edgeIndex, floor, groutWidth);
  }

  // Trapezoid for sloped walls, rectangle for uniform
  // NOTE: Y-coordinates are flipped so floor (y=0 in world) renders at top of SVG
  // Apply skirtingOffset to floor vertices (shift up from maxH)
  const polygonVertices = (Math.abs(surfaceHStart - surfaceHEnd) > 0.1)
    ? [
        { x: 0, y: maxH - skirtingOffset },           // floor-left
        { x: width, y: maxH - skirtingOffset },       // floor-right
        { x: width, y: maxH - surfaceHEnd },          // ceiling-right
        { x: 0, y: maxH - surfaceHStart },            // ceiling-left
      ]
    : [
        { x: 0, y: maxH - skirtingOffset },           // floor-left
        { x: width, y: maxH - skirtingOffset },       // floor-right
        { x: width, y: 0 },                           // ceiling-right
        { x: 0, y: 0 },                               // ceiling-left
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
    // Flip Y-coordinates so floor is at top of SVG
    const yBottom = maxH - elev;
    const yTop = maxH - (elev + dw.heightCm);

    doorwayExclusions.push({
      type: "freeform",
      vertices: [
        { x: localStart, y: yBottom },
        { x: localEnd, y: yBottom },
        { x: localEnd, y: yTop },
        { x: localStart, y: yTop },
      ],
      skirtingEnabled: false, // No skirting in wall surface views
    });
  }

  // Disable skirting on all exclusions in wall surface views
  const surfaceExclusions = (surface.exclusions || []).map(ex => ({
    ...ex,
    skirtingEnabled: false
  }));
  const allExclusions = [...doorwayExclusions, ...surfaceExclusions];

  // Compute skirting segments for wall surface view rendering
  let skirtingSegments = [];
  let skirtingConfig = null;

  if (room && room.skirting?.enabled && skirtingOffset > 0 && edgeIndex != null) {
    const allSegments = computeSkirtingSegments(room, true, floor); // include excluded
    const poly = roomPolygon(room);

    if (poly && poly[0] && poly[0][0]) {
      const verts = poly[0][0];
      if (edgeIndex < verts.length) {
        const v1 = verts[edgeIndex];
        const v2 = verts[(edgeIndex + 1) % verts.length];
        const edgeDx = v2[0] - v1[0];
        const edgeDy = v2[1] - v1[1];
        const edgeLen = Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy);

        if (edgeLen > 0.01) {
          for (const seg of allSegments) {
            const [p1x, p1y] = seg.p1;
            const [p2x, p2y] = seg.p2;

            // Check if segment is on this edge
            const p1Dx = p1x - v1[0];
            const p1Dy = p1y - v1[1];
            const p2Dx = p2x - v1[0];
            const p2Dy = p2y - v1[1];

            const cross1 = Math.abs(edgeDx * p1Dy - edgeDy * p1Dx);
            const cross2 = Math.abs(edgeDx * p2Dy - edgeDy * p2Dx);

            if (cross1 < EPSILON * edgeLen && cross2 < EPSILON * edgeLen) {
              const t1 = (p1Dx * edgeDx + p1Dy * edgeDy) / (edgeLen * edgeLen);
              const t2 = (p2Dx * edgeDx + p2Dy * edgeDy) / (edgeLen * edgeLen);

              const x1 = t1 * edgeLen - fromCm;
              const x2 = t2 * edgeLen - fromCm;

              if ((x1 >= -0.1 && x1 <= width + 0.1) ||
                  (x2 >= -0.1 && x2 <= width + 0.1)) {
                skirtingSegments.push({
                  x1,
                  x2,
                  id: seg.id,
                  excluded: seg.excluded || false
                });
              }
            }
          }
        }
      }
    }

    skirtingConfig = {
      ...room.skirting,
      tile: room.tile // Need tile info for piece length calculation
    };
  }

  return {
    id: surface.id,
    polygonVertices,
    widthCm: width,
    heightCm: maxH,
    tile: surface.tile ? { ...surface.tile } : null,
    grout: surface.grout ? { ...surface.grout } : null,
    pattern: surface.pattern ? { ...surface.pattern } : null,
    exclusions: allExclusions,
    excludedTiles: surface.excludedTiles || [],
    skirting: { enabled: false }, // Wall surfaces don't have floor skirting
    skirtingOffset, // Offset in cm from floor where wall tiles start
    skirtingSegments, // Segments in wall surface coordinates for rendering
    skirtingConfig, // Skirting configuration for rendering
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

/**
 * Compute geometry descriptors for ALL walls on a floor, once per render cycle.
 * Every consumer reads from this instead of re-deriving normals, extensions, etc.
 *
 * @param {Object} floor - Floor object with rooms[] and walls[]
 * @returns {Map<string, Object>} wallId → WallDescriptor
 */
export function computeFloorWallGeometry(floor) {
  const result = new Map();
  if (!floor?.walls?.length) return result;

  // Cache extensions per room
  const extCache = new Map();
  function getExts(roomId) {
    if (!extCache.has(roomId)) extCache.set(roomId, computeWallExtensions(floor, roomId));
    return extCache.get(roomId);
  }

  for (const wall of floor.walls) {
    const dx = wall.end.x - wall.start.x;
    const dy = wall.end.y - wall.start.y;
    const edgeLength = Math.hypot(dx, dy);
    if (edgeLength < 1) continue;

    const dirX = dx / edgeLength;
    const dirY = dy / edgeLength;
    const normal = getWallNormal(wall, floor);
    const thick = wall.thicknessCm ?? DEFAULT_WALL_THICKNESS_CM;

    // Per-room extensions
    const extensions = new Map();
    const re = wall.roomEdge;
    if (re) {
      const roomExts = getExts(re.roomId);
      const ext = roomExts.get(re.edgeIndex) ?? { extStart: thick, extEnd: thick };
      extensions.set(re.roomId, ext);
    }
    // Also compute extensions for non-owner surface rooms
    for (const s of wall.surfaces) {
      if (!extensions.has(s.roomId)) {
        const roomExts = getExts(s.roomId);
        const ext = roomExts.get(s.edgeIndex) ?? { extStart: thick, extEnd: thick };
        extensions.set(s.roomId, ext);
      }
    }

    // Use OWNER room's extensions for canonical geometry
    const ownerExt = re ? (extensions.get(re.roomId) ?? { extStart: thick, extEnd: thick })
                        : { extStart: thick, extEnd: thick };
    const extStart = ownerExt.extStart;
    const extEnd = ownerExt.extEnd;

    const extStartPt = { x: wall.start.x - dirX * extStart, y: wall.start.y - dirY * extStart };
    const extEndPt = { x: wall.end.x + dirX * extEnd, y: wall.end.y + dirY * extEnd };
    const outerStartPt = { x: extStartPt.x + normal.x * thick, y: extStartPt.y + normal.y * thick };
    const outerEndPt = { x: extEndPt.x + normal.x * thick, y: extEndPt.y + normal.y * thick };
    const totalLength = edgeLength + extStart + extEnd;

    // Pre-shifted doorways (offsetCm += owner extStart)
    const extDoorways = (wall.doorways || []).map(dw => ({
      ...dw,
      offsetCm: dw.offsetCm + extStart,
    }));

    result.set(wall.id, {
      wall,
      edgeLength,
      dirX,
      dirY,
      normal,
      extensions,
      extStart,
      extEnd,
      extStartPt,
      extEndPt,
      outerStartPt,
      outerEndPt,
      totalLength,
      extDoorways,
    });
  }

  return result;
}

/**
 * Compute the directional relationship between a room's edge and a wall.
 * Shared by getDoorwaysInEdgeSpace (forward) and edgeOffsetToWallOffset (reverse).
 *
 * @returns {{ sameDir: boolean, roomEdgeStartOnWall: number }} or null if invalid
 */
function getEdgeWallProjection(wallDesc, room, edgeIndex) {
  const verts = room.polygonVertices;
  const n = verts?.length;
  if (!n || edgeIndex < 0 || edgeIndex >= n) return null;

  const A = verts[edgeIndex];
  const B = verts[(edgeIndex + 1) % n];
  const edgeDx = B.x - A.x;
  const edgeDy = B.y - A.y;
  const edgeLen = Math.hypot(edgeDx, edgeDy);
  if (edgeLen < 1) return null;

  const dot = (edgeDx / edgeLen) * wallDesc.dirX + (edgeDy / edgeLen) * wallDesc.dirY;
  const sameDir = dot >= 0;

  const pos = room.floorPosition || { x: 0, y: 0 };
  const roomEdgeStartOnWall =
    (pos.x + A.x - wallDesc.wall.start.x) * wallDesc.dirX +
    (pos.y + A.y - wallDesc.wall.start.y) * wallDesc.dirY;

  return { sameDir, roomEdgeStartOnWall };
}

/**
 * Map doorway offsets from wall-direction to a specific room's edge direction.
 * Fixes the direction flip bug for non-owner rooms on shared walls.
 *
 * @param {Object} wallDesc - WallDescriptor from computeFloorWallGeometry
 * @param {Object} room - Room object with polygonVertices
 * @param {number} edgeIndex - Index of the edge in room.polygonVertices
 * @returns {Array} Doorways with offsetCm in edge-local space (shifted by room's extStart)
 */
export function getDoorwaysInEdgeSpace(wallDesc, room, edgeIndex) {
  if (!wallDesc.wall.doorways?.length) return [];

  const proj = getEdgeWallProjection(wallDesc, room, edgeIndex);
  if (!proj) return [];

  const { sameDir, roomEdgeStartOnWall } = proj;
  const roomExt = wallDesc.extensions.get(room.id) ?? { extStart: 0, extEnd: 0 };
  const roomExtStart = roomExt.extStart;

  return wallDesc.wall.doorways.map(dw => {
    let edgeOffset = sameDir
      ? dw.offsetCm - roomEdgeStartOnWall
      : roomEdgeStartOnWall - dw.offsetCm - dw.widthCm;
    edgeOffset += roomExtStart;
    return { ...dw, offsetCm: edgeOffset };
  });
}

/**
 * Convert an edge-local offset back to wall-space offset (inverse of getDoorwaysInEdgeSpace).
 * Used by form write-back to store doorway positions in the canonical wall coordinate frame.
 *
 * @param {Object} wallDesc - WallDescriptor from computeFloorWallGeometry
 * @param {Object} room - Room object with polygonVertices
 * @param {number} edgeIndex - Index of the edge in room.polygonVertices
 * @param {number} edgeOffset - Offset in room-edge-local space (without extStart)
 * @param {number} width - Doorway width in cm
 * @returns {number} Offset in wall-space
 */
export function edgeOffsetToWallOffset(wallDesc, room, edgeIndex, edgeOffset, width) {
  const proj = getEdgeWallProjection(wallDesc, room, edgeIndex);
  if (!proj) return edgeOffset;
  const { sameDir, roomEdgeStartOnWall } = proj;
  return sameDir
    ? edgeOffset + roomEdgeStartOnWall
    : roomEdgeStartOnWall - edgeOffset - width;
}

/**
 * Get parametric render helpers for drawing wall segments.
 * All renderers use these for consistent wall drawing.
 *
 * @param {Object} wallDesc - WallDescriptor from computeFloorWallGeometry
 * @param {string} roomId - Room ID for room-specific extensions
 * @returns {{ A, B, OA, OB, L, innerAt, outerAt, normal, dirX, dirY }}
 */
export function getWallRenderHelpers(wallDesc, roomId) {
  const thick = wallDesc.wall.thicknessCm ?? DEFAULT_WALL_THICKNESS_CM;
  const normal = wallDesc.normal;

  // Use room-specific extensions if available, fall back to owner
  const roomExt = wallDesc.extensions.get(roomId) ?? { extStart: wallDesc.extStart, extEnd: wallDesc.extEnd };
  const extStart = roomExt.extStart;
  const extEnd = roomExt.extEnd;

  const A = {
    x: wallDesc.wall.start.x - wallDesc.dirX * extStart,
    y: wallDesc.wall.start.y - wallDesc.dirY * extStart,
  };
  const B = {
    x: wallDesc.wall.end.x + wallDesc.dirX * extEnd,
    y: wallDesc.wall.end.y + wallDesc.dirY * extEnd,
  };
  const OA = { x: A.x + normal.x * thick, y: A.y + normal.y * thick };
  const OB = { x: B.x + normal.x * thick, y: B.y + normal.y * thick };
  const L = wallDesc.edgeLength + extStart + extEnd;

  const eDx = B.x - A.x, eDy = B.y - A.y;
  const oDx = OB.x - OA.x, oDy = OB.y - OA.y;
  const innerAt = (t) => ({ x: A.x + t * eDx, y: A.y + t * eDy });
  const outerAt = (t) => ({ x: OA.x + t * oDx, y: OA.y + t * oDy });

  return { A, B, OA, OB, L, innerAt, outerAt, normal, dirX: wallDesc.dirX, dirY: wallDesc.dirY };
}

/**
 * Compute rectangular floor patches for ground-level doorways on walls owned by a room.
 * Replaces the duplicate functions in main.js and render.js.
 *
 * @param {Object} room - Room with polygonVertices
 * @param {Object} floor - Floor with walls[]
 * @param {Map} wallGeometry - Result of computeFloorWallGeometry (optional, will compute if null)
 * @param {"vertices"|"multipolygon"} format - Output format
 * @returns {Array} Patches in requested format
 */
export function computeDoorwayFloorPatches(room, floor, wallGeometry, format = "vertices") {
  if (!floor?.walls?.length || !room?.polygonVertices?.length) return [];
  const patches = [];
  const verts = room.polygonVertices;
  const n = verts.length;

  const wg = wallGeometry || computeFloorWallGeometry(floor);

  for (const wall of floor.walls) {
    if (wall.roomEdge?.roomId !== room.id) continue;
    if (!wall.doorways?.length) continue;

    const edgeIndex = wall.roomEdge.edgeIndex;
    const start = verts[edgeIndex];
    const end = verts[(edgeIndex + 1) % n];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) continue;

    const dirX = dx / len;
    const dirY = dy / len;

    // Use pre-computed wall geometry for normal and doorway conversion
    const desc = wg.get(wall.id);
    const normal = desc ? desc.normal : getWallNormal(wall, floor);
    const thick = wall.thicknessCm ?? DEFAULT_WALL_THICKNESS_CM;

    // Use centralized getDoorwaysInEdgeSpace for wall→edge-local conversion,
    // then subtract extStart (floor patches are in room-local, not rendering coords)
    const edgeDoorways = desc
      ? getDoorwaysInEdgeSpace(desc, room, edgeIndex)
      : wall.doorways;
    const ext = desc?.extensions?.get(room.id) ?? { extStart: 0, extEnd: 0 };

    for (const dw of edgeDoorways) {
      if ((dw.elevationCm || 0) > 0.1) continue;
      const off = dw.offsetCm - ext.extStart;
      // Skip doorways that fall outside this room's edge
      if (off + dw.widthCm <= 0 || off >= len) continue;
      const w = dw.widthCm;
      const p1x = start.x + off * dirX;
      const p1y = start.y + off * dirY;
      const p2x = start.x + (off + w) * dirX;
      const p2y = start.y + (off + w) * dirY;
      const p3x = p2x + thick * normal.x;
      const p3y = p2y + thick * normal.y;
      const p4x = p1x + thick * normal.x;
      const p4y = p1y + thick * normal.y;

      if (format === "multipolygon") {
        patches.push([[[p1x, p1y], [p2x, p2y], [p3x, p3y], [p4x, p4y], [p1x, p1y]]]);
      } else {
        patches.push([
          { x: p1x, y: p1y },
          { x: p2x, y: p2y },
          { x: p3x, y: p3y },
          { x: p4x, y: p4y },
        ]);
      }
    }
  }
  return patches;
}
