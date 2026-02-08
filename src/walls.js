// src/walls.js — Wall entities: single source of truth for wall data
import { uuid, DEFAULT_SKIRTING_CONFIG, DEFAULT_TILE_PRESET } from "./core.js";
import { findSharedEdgeMatches } from "./floor_geometry.js";

export const DEFAULT_WALL = {
  thicknessCm: 12,
  heightStartCm: 200,
  heightEndCm: 200,
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
    tile: { ...DEFAULT_SURFACE_TILE },
    grout: { ...DEFAULT_SURFACE_GROUT },
    pattern: {
      ...DEFAULT_SURFACE_PATTERN,
      origin: { ...DEFAULT_SURFACE_PATTERN.origin },
    },
    exclusions: [],
    excludedTiles: [],
    skirting: null,
  };
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

  // Build a set of room IDs for cleanup
  const roomIds = new Set(rooms.map(r => r.id));

  // 1. Index existing walls by roomEdge key
  const wallByEdgeKey = new Map();
  for (const wall of floor.walls) {
    if (wall.roomEdge) {
      const key = `${wall.roomEdge.roomId}:${wall.roomEdge.edgeIndex}`;
      wallByEdgeKey.set(key, wall);
    }
  }

  // 2. For each room edge, match or create a wall
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
      if (edgeLen < 1) continue;

      const key = `${room.id}:${i}`;
      let wall = wallByEdgeKey.get(key);

      if (wall) {
        // Update geometry
        wall.start = startPt;
        wall.end = endPt;
        touchedWallIds.add(wall.id);
      } else {
        // Create new wall
        wall = createDefaultWall(startPt, endPt, { roomId: room.id, edgeIndex: i });

        // Create a surface for this room (left side by convention for the owning room)
        const surface = createDefaultSurface("left", room.id, i, 0, edgeLen);
        wall.surfaces.push(surface);

        floor.walls.push(wall);
        wallByEdgeKey.set(key, wall);
        touchedWallIds.add(wall.id);
      }

      // Ensure the owning room has a surface on this wall
      const hasOwnSurface = wall.surfaces.some(
        s => s.roomId === room.id && s.edgeIndex === i
      );
      if (!hasOwnSurface) {
        wall.surfaces.push(createDefaultSurface("left", room.id, i, 0, edgeLen));
      } else {
        // Update surface range to match current edge length
        for (const s of wall.surfaces) {
          if (s.roomId === room.id && s.edgeIndex === i) {
            s.toCm = edgeLen;
          }
        }
      }
    }
  }

  // 3. Detect shared edges — add surfaces for adjacent rooms
  for (const room of rooms) {
    const verts = room.polygonVertices;
    if (!verts || verts.length < 3) continue;
    const n = verts.length;
    const otherRooms = rooms.filter(r => r.id !== room.id);

    for (let i = 0; i < n; i++) {
      const key = `${room.id}:${i}`;
      const wall = wallByEdgeKey.get(key);
      if (!wall) continue;

      const matches = findSharedEdgeMatches(room, i, otherRooms);
      for (const match of matches) {
        // Check if the other room already has a surface on this wall
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
          // Update overlap range
          existing.fromCm = match.overlapStartCm;
          existing.toCm = match.overlapEndCm;
        }

        // Mark the matching room's own wall for this edge as sharing
        // (the other room's edge might have its own wall — remove it if so,
        // since shared edges should be ONE wall)
        const otherKey = `${match.room.id}:${match.edgeIndex}`;
        const otherWall = wallByEdgeKey.get(otherKey);
        if (otherWall && otherWall.id !== wall.id) {
          // Merge doorways from the other wall into this wall
          for (const dw of otherWall.doorways) {
            if (!wall.doorways.some(d => d.id === dw.id)) {
              wall.doorways.push(dw);
            }
          }
          // Merge surfaces from the other wall (other room's own surface)
          for (const s of otherWall.surfaces) {
            if (!wall.surfaces.some(ws => ws.roomId === s.roomId && ws.edgeIndex === s.edgeIndex)) {
              wall.surfaces.push(s);
            }
          }
          // Remove the other wall
          const idx = floor.walls.indexOf(otherWall);
          if (idx !== -1) floor.walls.splice(idx, 1);
          wallByEdgeKey.delete(otherKey);
          touchedWallIds.delete(otherWall.id);
        }
      }
    }
  }

  // 4. Clean up surfaces whose rooms no longer exist or no longer touch the wall
  for (const wall of floor.walls) {
    wall.surfaces = wall.surfaces.filter(s => roomIds.has(s.roomId));
  }

  // 5. Remove walls with no surfaces and no roomEdge link to an existing room
  floor.walls = floor.walls.filter(wall => {
    if (wall.surfaces.length > 0) return true;
    if (wall.roomEdge && roomIds.has(wall.roomEdge.roomId)) return true;
    return false;
  });
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
  const hStart = wall.heightStartCm ?? 200;
  const hEnd = wall.heightEndCm ?? 200;

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
