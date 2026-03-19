// src/walls.js — Wall entities: single source of truth for wall data
import { uuid, DEFAULT_SKIRTING_CONFIG, DEFAULT_TILE_PRESET, resolvePresetTile, resolvePresetGrout } from "./core.js";
import { findSharedEdgeMatches } from "./floor_geometry.js";
import { DEFAULT_WALL_THICKNESS_CM, DEFAULT_WALL_HEIGHT_CM, WALL_ADJACENCY_TOLERANCE_CM, EPSILON } from "./constants.js";
import { computeSkirtingSegments, roomPolygon, computeAvailableArea, tilesForPreview, computeSurfaceContacts, exclusionToRegion } from "./geometry.js";
import polygonClipping from "polygon-clipping";
import { FLOOR_PLAN_RULES, snapToWallType } from "./floor-plan-rules.js";
import { enforceSkeletonWallProperties, computeStructuralBoundaries } from "./skeleton.js";

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
    dividers: [],
    zoneSettings: {},
  };
}

/**
 * Index existing walls by their "roomId:edgeIndex" key for fast lookup.
 * Indexes both by wall.roomEdge (owner) and by each surface (guests),
 * so shared walls are found for all rooms that reference them.
 * @returns {Map<string, Object>}
 */
function indexWallsByEdge(walls) {
  const wallByEdgeKey = new Map();
  for (const wall of walls) {
    if (wall.roomEdge) {
      const key = `${wall.roomEdge.roomId}:${wall.roomEdge.edgeIndex}`;
      wallByEdgeKey.set(key, wall);
    }
    for (const s of (wall.surfaces || [])) {
      const sKey = `${s.roomId}:${s.edgeIndex}`;
      if (!wallByEdgeKey.has(sKey)) {
        wallByEdgeKey.set(sKey, wall);
      } else if (wallByEdgeKey.get(sKey).id !== wall.id) {
        console.warn(`[walls] indexWallsByEdge: duplicate key ${sKey} — wall ${wall.id.slice(0,8)} shadowed by ${wallByEdgeKey.get(sKey).id.slice(0,8)}`);
      }
    }
  }
  return wallByEdgeKey;
}

/**
 * Validate a proposed wall that didn't match existing walls or envelope (step c).
 * Checks geometric validity and conflicts.
 * @returns {{ valid: boolean, action?: 'remove'|'adjust', reason?: string }}
 */
function validateProposedWall(startPt, endPt, existingWalls) {
  const dx = endPt.x - startPt.x, dy = endPt.y - startPt.y;
  const len = Math.hypot(dx, dy);

  // Geometric: too short
  if (len < 1) return { valid: false, action: 'remove', reason: 'too short' };

  // Geometric: non-axis-aligned (neither H nor V within 0.5cm)
  const isH = Math.abs(dy) < 0.5;
  const isV = Math.abs(dx) < 0.5;
  // Note: we don't reject diagonal edges — they're valid for non-rectangular rooms.
  // But we log a warning since they're unusual.

  // Conflict: closely parallels an existing wall on a different line
  const conflictTol = FLOOR_PLAN_RULES.alignmentToleranceCm;
  for (const w of existingWalls) {
    const wdx = w.end.x - w.start.x, wdy = w.end.y - w.start.y;
    const wLen = Math.hypot(wdx, wdy);
    if (wLen < 1) continue;

    if (isH && Math.abs(wdy) < 0.5) {
      // Both horizontal: check if Y is very close but not identical (parallel duplicate)
      const edgeY = (startPt.y + endPt.y) / 2;
      const wallY = (w.start.y + w.end.y) / 2;
      const dist = Math.abs(edgeY - wallY);
      const edgeMinX = Math.min(startPt.x, endPt.x);
      const edgeMaxX = Math.max(startPt.x, endPt.x);
      const wallMinX = Math.min(w.start.x, w.end.x);
      const wallMaxX = Math.max(w.start.x, w.end.x);
      const overlap = Math.min(edgeMaxX, wallMaxX) - Math.max(edgeMinX, wallMinX);
      if (dist > 0.5 && dist <= conflictTol && overlap > 1) {
        return { valid: false, action: 'remove', reason: `parallel conflict with wall ${w.id} (dist=${dist.toFixed(1)})` };
      }
    } else if (isV && Math.abs(wdx) < 0.5) {
      const edgeX = (startPt.x + endPt.x) / 2;
      const wallX = (w.start.x + w.end.x) / 2;
      const dist = Math.abs(edgeX - wallX);
      const edgeMinY = Math.min(startPt.y, endPt.y);
      const edgeMaxY = Math.max(startPt.y, endPt.y);
      const wallMinY = Math.min(w.start.y, w.end.y);
      const wallMaxY = Math.max(w.start.y, w.end.y);
      const overlap = Math.min(edgeMaxY, wallMaxY) - Math.max(edgeMinY, wallMinY);
      if (dist > 0.5 && dist <= conflictTol && overlap > 1) {
        return { valid: false, action: 'remove', reason: `parallel conflict with wall ${w.id} (dist=${dist.toFixed(1)})` };
      }
    }
  }

  return { valid: true };
}

/**
 * Check if a proposed edge aligns with an envelope/spanning wall boundary (step b).
 * Uses structural boundaries from computeStructuralBoundaries().
 * @returns {Object|null} Matching boundary target (with thickness, type) or null
 */
function findAlignedBoundary(hTargets, vTargets, startPt, endPt) {
  const dx = endPt.x - startPt.x, dy = endPt.y - startPt.y;
  const len = Math.hypot(dx, dy);

  // Angle-based H/V: < ~6° deviation from axis (handles polygon vertex imprecision)
  const isH = len > 0.5 && Math.abs(dy / len) < 0.1;
  const isV = len > 0.5 && Math.abs(dx / len) < 0.1;
  if (!isH && !isV) return null;

  const baseTolerance = FLOOR_PLAN_RULES.alignmentToleranceCm;

  // Use the max thickness across ALL targets as a floor for tolerance.
  // This handles cases where envelope re-detection changes wall measurements —
  // a room drawn at the inner face of a 30cm wall should still match even if
  // a later detection measures that wall as only 8.5cm.
  let maxThickness = 0;
  for (const t of hTargets) if (t.thickness > maxThickness) maxThickness = t.thickness;
  for (const t of vTargets) if (t.thickness > maxThickness) maxThickness = t.thickness;

  if (isH) {
    const edgeY = (startPt.y + endPt.y) / 2;
    const edgeMinX = Math.min(startPt.x, endPt.x);
    const edgeMaxX = Math.max(startPt.x, endPt.x);
    let best = null, bestDist = Infinity;
    for (const t of hTargets) {
      const tol = Math.max(baseTolerance, t.thickness, maxThickness);
      const dist = Math.abs(t.coord - edgeY);
      const overlap = Math.min(edgeMaxX, t.rangeMax) - Math.max(edgeMinX, t.rangeMin);
      console.log(`[walls] findAlignedBoundary H: edgeY=${edgeY.toFixed(1)} x=[${edgeMinX.toFixed(1)},${edgeMaxX.toFixed(1)}] vs target y=${t.coord.toFixed(1)} range=[${t.rangeMin.toFixed(1)},${t.rangeMax.toFixed(1)}] dist=${dist.toFixed(1)} tol=${tol.toFixed(1)} overlap=${overlap.toFixed(1)} → ${dist <= tol && overlap > 1 ? 'MATCH' : 'no'}`);
      if (dist <= tol && dist < bestDist && overlap > 1) {
        best = t; bestDist = dist;
      }
    }
    return best;
  } else {
    const edgeX = (startPt.x + endPt.x) / 2;
    const edgeMinY = Math.min(startPt.y, endPt.y);
    const edgeMaxY = Math.max(startPt.y, endPt.y);
    let best = null, bestDist = Infinity;
    for (const t of vTargets) {
      const tol = Math.max(baseTolerance, t.thickness, maxThickness);
      const dist = Math.abs(t.coord - edgeX);
      const overlap = Math.min(edgeMaxY, t.rangeMax) - Math.max(edgeMinY, t.rangeMin);
      console.log(`[walls] findAlignedBoundary V: edgeX=${edgeX.toFixed(1)} y=[${edgeMinY.toFixed(1)},${edgeMaxY.toFixed(1)}] vs target x=${t.coord.toFixed(1)} range=[${t.rangeMin.toFixed(1)},${t.rangeMax.toFixed(1)}] dist=${dist.toFixed(1)} tol=${tol.toFixed(1)} overlap=${overlap.toFixed(1)} → ${dist <= tol && overlap > 1 ? 'MATCH' : 'no'}`);
      if (dist <= tol && dist < bestDist && overlap > 1) {
        best = t; bestDist = dist;
      }
    }
    return best;
  }
}

/**
 * Search existing walls for one that aligns with a proposed edge (step a).
 * "Aligns" means: same orientation, same perpendicular coordinate ± tolerance,
 * overlapping or adjacent along the axis.
 * @returns {Object|null} Matching wall or null
 */
function findAlignedWall(walls, startPt, endPt, tolerance, excludeRoomId) {
  const dx = endPt.x - startPt.x, dy = endPt.y - startPt.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return null;

  // Angle-based H/V: < ~6° deviation from axis (handles polygon vertex imprecision)
  const isH = Math.abs(dy / len) < 0.1;
  const isV = Math.abs(dx / len) < 0.1;
  if (!isH && !isV) return null; // diagonal — no matching

  // Gap tolerance along the axis: rooms separated by a wall have a gap equal to
  // wall thickness. Use the max thickness of any existing wall (+1cm margin) so
  // that edges on the same structural line but separated by a spanning wall or
  // thick envelope wall are still matched to the same wall.
  let maxThick = DEFAULT_WALL_THICKNESS_CM;
  for (const w of walls) {
    const t = w.thicknessCm ?? DEFAULT_WALL_THICKNESS_CM;
    if (t > maxThick) maxThick = t;
  }
  const gapTolerance = maxThick + 1;

  let bestWall = null, bestDist = Infinity;

  for (const w of walls) {
    // Skip walls owned by the same room — each room's edges get separate walls
    if (excludeRoomId && w.roomEdge && w.roomEdge.roomId === excludeRoomId) continue;
    const wdx = w.end.x - w.start.x, wdy = w.end.y - w.start.y;
    const wLen = Math.hypot(wdx, wdy);
    if (wLen < 1) continue;

    const wIsH = Math.abs(wdy / wLen) < 0.1;
    const wIsV = Math.abs(wdx / wLen) < 0.1;

    if (isH && wIsH) {
      // Both horizontal: compare Y coords and check range overlap/adjacency
      const edgeY = (startPt.y + endPt.y) / 2;
      const wallY = (w.start.y + w.end.y) / 2;
      const dist = Math.abs(edgeY - wallY);
      const edgeMinX = Math.min(startPt.x, endPt.x);
      const edgeMaxX = Math.max(startPt.x, endPt.x);
      const wallMinX = Math.min(w.start.x, w.end.x);
      const wallMaxX = Math.max(w.start.x, w.end.x);
      const gap = Math.max(edgeMinX, wallMinX) - Math.min(edgeMaxX, wallMaxX);
      if (dist <= tolerance && dist < bestDist && gap <= gapTolerance) {
        bestWall = w; bestDist = dist;
      }
    } else if (isV && wIsV) {
      // Both vertical: compare X coords and check range overlap/adjacency
      const edgeX = (startPt.x + endPt.x) / 2;
      const wallX = (w.start.x + w.end.x) / 2;
      const dist = Math.abs(edgeX - wallX);
      const edgeMinY = Math.min(startPt.y, endPt.y);
      const edgeMaxY = Math.max(startPt.y, endPt.y);
      const wallMinY = Math.min(w.start.y, w.end.y);
      const wallMaxY = Math.max(w.start.y, w.end.y);
      const gap = Math.max(edgeMinY, wallMinY) - Math.min(edgeMaxY, wallMaxY);
      if (dist <= tolerance && dist < bestDist && gap <= gapTolerance) {
        bestWall = w; bestDist = dist;
      }
    }
  }

  return bestWall;
}

/**
 * Extend a wall's geometry to cover a new edge (union, never shrinks).
 * H walls: extend X range, keep Y. V walls: extend Y range, keep X.
 */
function extendWallGeometry(wall, startPt, endPt) {
  const wdx = wall.end.x - wall.start.x;
  const wdy = wall.end.y - wall.start.y;
  const wLen = Math.hypot(wdx, wdy);

  // Use angle-based classification: a wall is H/V if its deviation from
  // the axis is < ~6° (sin < 0.1). This handles polygon-drawn walls with
  // small vertex deviations (e.g. 1cm over 400cm).
  const isH = wLen > 0.5 && Math.abs(wdy / wLen) < 0.1;
  const isV = wLen > 0.5 && Math.abs(wdx / wLen) < 0.1;

  if (isH) {
    // Horizontal wall: extend X range
    const minX = Math.min(wall.start.x, wall.end.x, startPt.x, endPt.x);
    const maxX = Math.max(wall.start.x, wall.end.x, startPt.x, endPt.x);
    if (wall.start.x <= wall.end.x) {
      wall.start.x = minX; wall.end.x = maxX;
    } else {
      wall.start.x = maxX; wall.end.x = minX;
    }
  } else if (isV) {
    // Vertical wall: extend Y range
    const minY = Math.min(wall.start.y, wall.end.y, startPt.y, endPt.y);
    const maxY = Math.max(wall.start.y, wall.end.y, startPt.y, endPt.y);
    if (wall.start.y <= wall.end.y) {
      wall.start.y = minY; wall.end.y = maxY;
    } else {
      wall.start.y = maxY; wall.end.y = minY;
    }
  }
  // Diagonal walls: no extension (shouldn't happen for axis-aligned rooms)
}

/**
 * For each room edge, match an existing wall or create a new one.
 * Updates wall geometry for existing walls, creates surfaces for new walls.
 * @returns {Set<string>} IDs of all walls that correspond to valid room edges
 */
/**
 * Re-project all surface fromCm/toCm onto their wall's current axis.
 * Call after wall geometry is finalized to fix stale projections from
 * intermediate wall states (H2) or position shifts (M5).
 */
function reprojectAllSurfaces(floor) {
  for (const wall of floor.walls) {
    const wallLen = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
    if (wallLen < 0.5) continue;
    const dirX = (wall.end.x - wall.start.x) / wallLen;
    const dirY = (wall.end.y - wall.start.y) / wallLen;
    for (const s of wall.surfaces) {
      const room = floor.rooms?.find(r => r.id === s.roomId);
      if (!room?.polygonVertices) continue;
      const pos = room.floorPosition || { x: 0, y: 0 };
      const verts = room.polygonVertices;
      if (s.edgeIndex >= verts.length) continue;
      const A = verts[s.edgeIndex];
      const B = verts[(s.edgeIndex + 1) % verts.length];
      const sx = pos.x + A.x, sy = pos.y + A.y;
      const ex = pos.x + B.x, ey = pos.y + B.y;
      let from = (sx - wall.start.x) * dirX + (sy - wall.start.y) * dirY;
      let to = (ex - wall.start.x) * dirX + (ey - wall.start.y) * dirY;
      if (from > to) [from, to] = [to, from];
      const oldFrom = s.fromCm, oldTo = s.toCm;
      s.fromCm = from;
      s.toCm = to;
      if (Math.abs(from - oldFrom) > 0.5 || Math.abs(to - oldTo) > 0.5) {
        console.log(`[walls] reprojectAllSurfaces: ${s.roomId.slice(0,8)}:e${s.edgeIndex} on wall ${wall.id.slice(0,8)} from=${oldFrom.toFixed(1)}→${from.toFixed(1)} to=${oldTo.toFixed(1)}→${to.toFixed(1)}`);
      }
    }
  }
}

function ensureWallsForEdges(rooms, floor, wallByEdgeKey, envelope) {
  const touchedWallIds = new Set();
  const tolerance = FLOOR_PLAN_RULES.alignmentToleranceCm;

  // Compute structural boundaries once for step (b)
  const { hTargets, vTargets } = computeStructuralBoundaries(envelope);

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
      console.log(`[walls] edge ${room.id.slice(0,8)}:e${i}: (${startPt.x.toFixed(1)},${startPt.y.toFixed(1)})→(${endPt.x.toFixed(1)},${endPt.y.toFixed(1)}) len=${edgeLen.toFixed(1)} ${wall ? `existing=${wall.id.slice(0,8)}` : 'no wall'}`);

      if (wall) {
        const isOwner = wall.roomEdge &&
          wall.roomEdge.roomId === room.id && wall.roomEdge.edgeIndex === i;

        if (isOwner) {
          // Owner room: SET geometry to this room's edge (source of truth)
          const oldLen = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
          console.log(`[walls] edge ${room.id.slice(0,8)}:e${i}: owner update wall ${wall.id.slice(0,8)} (${wall.start.x.toFixed(1)},${wall.start.y.toFixed(1)})→(${wall.end.x.toFixed(1)},${wall.end.y.toFixed(1)}) → (${startPt.x.toFixed(1)},${startPt.y.toFixed(1)})→(${endPt.x.toFixed(1)},${endPt.y.toFixed(1)})`);

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

          // Re-extend to cover guest rooms that were already processed
          // (their edges may extend beyond the owner's edge range)
          for (const s of wall.surfaces) {
            if (s.roomId === room.id) continue;
            const guestRoom = rooms.find(r => r.id === s.roomId);
            if (!guestRoom) continue;
            const gPos = guestRoom.floorPosition || { x: 0, y: 0 };
            const gVerts = guestRoom.polygonVertices;
            if (!gVerts || s.edgeIndex >= gVerts.length) continue;
            const gA = gVerts[s.edgeIndex];
            const gB = gVerts[(s.edgeIndex + 1) % gVerts.length];
            const gStart = { x: gPos.x + gA.x, y: gPos.y + gA.y };
            const gEnd = { x: gPos.x + gB.x, y: gPos.y + gB.y };
            extendWallGeometry(wall, gStart, gEnd);
          }
        }
        else {
          // Guest room (found via surface key): EXTEND geometry to cover this edge
          console.log(`[walls] edge ${room.id.slice(0,8)}:e${i}: guest extend wall ${wall.id.slice(0,8)}`);
          extendWallGeometry(wall, startPt, endPt);
        }
        touchedWallIds.add(wall.id);
      } else {
        // Decision tree: (a) → (b) → (c) → (d)
        // Skip walls owned by this room — same room's edges should stay separate
        const aligned = findAlignedWall(floor.walls, startPt, endPt, tolerance, room.id);

        if (aligned) {
          // (a) Extend existing wall
          wall = aligned;
          extendWallGeometry(wall, startPt, endPt);
          wallByEdgeKey.set(key, wall);
          touchedWallIds.add(wall.id);
          console.log(`[walls] edge ${room.id}:e${i} → (a) extended wall ${wall.id} (${JSON.stringify(wall.start)}→${JSON.stringify(wall.end)})`);
        } else {
          const boundary = findAlignedBoundary(hTargets, vTargets, startPt, endPt);

          if (boundary) {
            // (b) Create wall with envelope/spanning wall properties
            const { snappedCm } = snapToWallType(boundary.thickness, floor.layout?.wallDefaults?.types);
            wall = createDefaultWall(startPt, endPt, { roomId: room.id, edgeIndex: i }, { thicknessCm: snappedCm });
            const surface = createDefaultSurface("left", room.id, i, 0, edgeLen);
            wall.surfaces.push(surface);
            floor.walls.push(wall);
            wallByEdgeKey.set(key, wall);
            touchedWallIds.add(wall.id);
            console.log(`[walls] edge ${room.id}:e${i} → (b) new wall from ${boundary.type} (thick=${snappedCm}cm)`);
          } else {
            const validation = validateProposedWall(startPt, endPt, floor.walls);

            if (!validation.valid) {
              // (c) Rule violation — skip this edge
              console.log(`[walls] edge ${room.id}:e${i} → (c) ${validation.action}: ${validation.reason}`);
              continue;
            }

            // (d) Create wall with defaults
            wall = createDefaultWall(startPt, endPt, { roomId: room.id, edgeIndex: i });
            const surface = createDefaultSurface("left", room.id, i, 0, edgeLen);
            wall.surfaces.push(surface);
            floor.walls.push(wall);
            wallByEdgeKey.set(key, wall);
            touchedWallIds.add(wall.id);
            console.log(`[walls] edge ${room.id}:e${i} → (d) new wall with defaults`);
          }
        }
      }

      // Compute surface fromCm/toCm by projecting room edge onto wall axis
      const wallLen = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
      let surfaceFrom, surfaceTo;
      if (wallLen > 0.5) {
        const dirX = (wall.end.x - wall.start.x) / wallLen;
        const dirY = (wall.end.y - wall.start.y) / wallLen;
        surfaceFrom = (startPt.x - wall.start.x) * dirX + (startPt.y - wall.start.y) * dirY;
        surfaceTo = (endPt.x - wall.start.x) * dirX + (endPt.y - wall.start.y) * dirY;
        // Ensure from < to for consistent surface ranges
        if (surfaceFrom > surfaceTo) {
          [surfaceFrom, surfaceTo] = [surfaceTo, surfaceFrom];
        }
      } else {
        surfaceFrom = 0;
        surfaceTo = edgeLen;
      }

      const hasOwnSurface = wall.surfaces.some(
        s => s.roomId === room.id && s.edgeIndex === i
      );
      if (!hasOwnSurface) {
        wall.surfaces.push(createDefaultSurface("left", room.id, i, surfaceFrom, surfaceTo));
        console.log(`[walls] edge ${room.id.slice(0,8)}:e${i}: new surface on wall ${wall.id.slice(0,8)} from=${surfaceFrom.toFixed(1)} to=${surfaceTo.toFixed(1)}`);
      } else {
        for (const s of wall.surfaces) {
          if (s.roomId === room.id && s.edgeIndex === i) {
            s.fromCm = surfaceFrom;
            s.toCm = surfaceTo;
          }
        }
        console.log(`[walls] edge ${room.id.slice(0,8)}:e${i}: update surface on wall ${wall.id.slice(0,8)} from=${surfaceFrom.toFixed(1)} to=${surfaceTo.toFixed(1)}`);
      }
    }
  }

  // Re-project all surfaces onto final wall geometry (H2 fix)
  reprojectAllSurfaces(floor);

  return touchedWallIds;
}

/**
 * Detect shared edges between rooms — merge duplicate walls and add surfaces
 * for adjacent rooms onto the surviving wall.
 */
function mergeSharedEdgeWalls(rooms, floor, wallByEdgeKey, touchedWallIds) {
  // Merge tolerance: edges on opposite faces of the same wall can be up to
  // maxThick apart. Use max thickness across all walls AND wallDefaults types + margin.
  let maxThick = DEFAULT_WALL_THICKNESS_CM;
  for (const w of floor.walls) {
    const t = w.thicknessCm ?? DEFAULT_WALL_THICKNESS_CM;
    if (t > maxThick) maxThick = t;
  }
  const wallTypes = floor.layout?.wallDefaults?.types;
  if (wallTypes) {
    for (const t of wallTypes) {
      if (t.thicknessCm > maxThick) maxThick = t.thicknessCm;
    }
  }
  const mergeTolerance = maxThick + 1;

  for (const room of rooms) {
    const verts = room.polygonVertices;
    if (!verts || verts.length < 3) continue;
    const n = verts.length;
    const otherRooms = rooms.filter(r => r.id !== room.id);

    for (let i = 0; i < n; i++) {
      const key = `${room.id}:${i}`;
      const wall = wallByEdgeKey.get(key);
      if (!wall) continue;

      const matches = findSharedEdgeMatches(room, i, otherRooms, mergeTolerance);
      for (const match of matches) {
        // If the other room's edge already points to THIS wall (wall reuse from
        // ensureWallsForEdges), the wall is already shared — skip merge.
        const matchKey = `${match.room.id}:${match.edgeIndex}`;
        const matchWall = wallByEdgeKey.get(matchKey);
        if (matchWall && matchWall.id === wall.id) continue;

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
          console.log(`[walls] merge: wall ${wall.id.slice(0,8)} absorbs ${otherWall.id.slice(0,8)} (room ${match.room.id.slice(0,8)}:e${match.edgeIndex}, perpDist=${match.perpDist?.toFixed(1)}cm, overlap=${match.overlapStartCm?.toFixed(1)}-${match.overlapEndCm?.toFixed(1)})`);

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
              console.log(`[walls] merge geometry: wall ${wall.id.slice(0,8)} shift=${shift.toFixed(1)} newLen=${newMax.toFixed(1)} (was ${wLen.toFixed(1)})`);
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

          // Preserve classified thickness: a non-default thickness was set by
          // assignWallTypesFromClassification and should not be overwritten by
          // a new wall that still has the default 12cm.
          const prevThick = wall.thicknessCm ?? DEFAULT_WALL_THICKNESS_CM;
          const otherThick = otherWall.thicknessCm ?? DEFAULT_WALL_THICKNESS_CM;
          const prevClassified = prevThick !== DEFAULT_WALL_THICKNESS_CM;
          const otherClassified = otherThick !== DEFAULT_WALL_THICKNESS_CM;
          if (prevClassified && !otherClassified) {
            wall.thicknessCm = prevThick;
            console.log(`[walls] mergeSharedEdgeWalls: keeping classified ${prevThick}cm over default ${otherThick}cm for wall ${wall.id}`);
          } else if (!prevClassified && otherClassified) {
            wall.thicknessCm = otherThick;
            console.log(`[walls] mergeSharedEdgeWalls: keeping classified ${otherThick}cm over default ${prevThick}cm for wall ${wall.id}`);
          } else if (prevClassified && otherClassified) {
            wall.thicknessCm = Math.max(prevThick, otherThick);
            console.log(`[walls] mergeSharedEdgeWalls: both classified, taking max(${prevThick}, ${otherThick})cm for wall ${wall.id}`);
          } else {
            // Both default thickness — try gap-based inference from perpDist
            const gap = match.perpDist;
            if (gap > 0.5) {
              const wallTypes = floor.layout?.wallDefaults?.types;
              const { snappedCm } = snapToWallType(gap, wallTypes);
              const delta = Math.abs(gap - snappedCm);
              const GAP_SNAP_TOLERANCE_CM = 3;
              if (delta <= GAP_SNAP_TOLERANCE_CM) {
                wall.thicknessCm = snappedCm;
                console.log(`[walls] mergeSharedEdgeWalls: gap-inferred thickness: gap=${gap.toFixed(1)} → ${snappedCm}cm (delta=${delta.toFixed(1)}) for wall ${wall.id}`);
              } else {
                wall.thicknessCm = Math.round(gap);
                console.log(`[walls] mergeSharedEdgeWalls: gap-inferred thickness: gap=${gap.toFixed(1)} → ${Math.round(gap)}cm (delta=${delta.toFixed(1)}, exceeded tolerance) for wall ${wall.id}`);
              }
            } else {
              wall.thicknessCm = prevThick;
              console.log(`[walls] mergeSharedEdgeWalls: both default ${prevThick}cm for wall ${wall.id}`);
            }
          }

          const idx = floor.walls.indexOf(otherWall);
          if (idx !== -1) floor.walls.splice(idx, 1);
          // Repoint all wallByEdgeKey entries referencing the absorbed wall to the surviving wall.
          // otherWall may be indexed under multiple keys (owner roomEdge + guest surface keys).
          for (const [key, val] of wallByEdgeKey) {
            if (val === otherWall) {
              wallByEdgeKey.set(key, wall);
              console.log(`[walls] merge: repointed key ${key} → surviving wall ${wall.id.slice(0,8)}`);
            }
          }
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
      if (!roomIds.has(s.roomId)) {
        console.log(`[walls] pruneOrphanSurfaces: remove surface room=${s.roomId.slice(0,8)}:e${s.edgeIndex} from wall ${wall.id?.slice(0,8)} (room gone)`);
        return false;
      }
      const sRoom = rooms.find(r => r.id === s.roomId);
      if (!sRoom) {
        console.log(`[walls] pruneOrphanSurfaces: remove surface room=${s.roomId.slice(0,8)}:e${s.edgeIndex} from wall ${wall.id?.slice(0,8)} (room not found)`);
        return false;
      }
      const sVerts = sRoom.polygonVertices;
      if (!sVerts || s.edgeIndex >= sVerts.length) {
        console.log(`[walls] pruneOrphanSurfaces: remove surface room=${s.roomId.slice(0,8)}:e${s.edgeIndex} from wall ${wall.id?.slice(0,8)} (edge index out of range)`);
        return false;
      }
      const sPos = sRoom.floorPosition || { x: 0, y: 0 };
      const eA = sVerts[s.edgeIndex];
      const eMid = {
        x: sPos.x + eA.x + (sVerts[(s.edgeIndex + 1) % sVerts.length].x - eA.x) * 0.5,
        y: sPos.y + eA.y + (sVerts[(s.edgeIndex + 1) % sVerts.length].y - eA.y) * 0.5,
      };
      const vx = eMid.x - wall.start.x, vy = eMid.y - wall.start.y;
      const perpDist = Math.abs(vx * wny - vy * wnx);
      // After gap-based merge, the guest surface sits at the true gap distance which
      // may exceed the snapped wall thickness (e.g. 14cm gap snapped to 11.5cm).
      // Use GAP_SNAP_TOLERANCE_CM (3) + 2cm margin beyond wall thickness to avoid
      // pruning legitimate surfaces that were just merged.
      const maxDist = (wall.thicknessCm ?? DEFAULT_WALL_THICKNESS_CM) + 5;
      if (perpDist > maxDist) {
        console.log(`[walls] pruneOrphanSurfaces: remove surface room=${s.roomId.slice(0,8)}:e${s.edgeIndex} from wall ${wall.id?.slice(0,8)} (drift=${perpDist.toFixed(1)}cm > ${maxDist.toFixed(1)}cm)`);
        return false;
      }
      return true;
    });

    // Reassign roomEdge if the owner room was deleted but surviving surfaces exist
    if (wall.roomEdge && !roomIds.has(wall.roomEdge.roomId) && wall.surfaces.length > 0) {
      const newOwner = wall.surfaces[0];
      const oldOwner = wall.roomEdge;
      wall.roomEdge = { roomId: newOwner.roomId, edgeIndex: newOwner.edgeIndex };
      console.log(`[walls] pruneOrphanSurfaces: reassign wall ${wall.id?.slice(0,8)} owner from deleted room ${oldOwner.roomId.slice(0,8)}:e${oldOwner.edgeIndex} → ${newOwner.roomId.slice(0,8)}:e${newOwner.edgeIndex}`);
    }
  }
}

/**
 * Remove stale walls: those linked to degenerate (zero-length) edges not
 * processed in ensureWallsForEdges, and orphaned walls with no surfaces.
 */
function removeStaleWalls(floor, touchedWallIds, roomIds) {
  floor.walls = floor.walls.filter(wall => {
    if (wall.roomEdge && !touchedWallIds.has(wall.id)) {
      console.log(`[walls] removeStaleWalls: remove wall ${wall.id?.slice(0,8)} (untouched owner edge ${wall.roomEdge.roomId.slice(0,8)}:e${wall.roomEdge.edgeIndex})`);
      return false;
    }
    if (wall.surfaces.length > 0) return true;
    if (wall.roomEdge && roomIds.has(wall.roomEdge.roomId)) return true;
    console.log(`[walls] removeStaleWalls: remove wall ${wall.id?.slice(0,8)} (no surfaces, no valid owner)`);
    return false;
  });
}

/**
 * Enforce adjacent room positions for shared walls.
 * The adjacent room's touching edge must sit at the wall's outer edge
 * (perpendicular distance from inner edge = wall thickness).
 */
export function enforceAdjacentPositions(floor) {
  for (const wall of floor.walls) {
    if (wall.surfaces.length < 2) continue;
    const ownerRoomId = wall.roomEdge?.roomId;
    if (!ownerRoomId) continue;

    const normal = getWallNormal(wall, floor);
    const thick = wall.thicknessCm ?? DEFAULT_WALL_THICKNESS_CM;

    // Process ALL non-owner surfaces, not just the first one
    const adjSurfaces = wall.surfaces.filter(s => s.roomId !== ownerRoomId);
    for (const adjSurf of adjSurfaces) {
      const adjRoom = floor.rooms.find(r => r.id === adjSurf.roomId);
      if (!adjRoom?.polygonVertices?.length) continue;

      const adjPos = adjRoom.floorPosition || { x: 0, y: 0 };
      const adjVertex = adjRoom.polygonVertices[adjSurf.edgeIndex];
      if (!adjVertex) continue;

      const currentDist =
        (adjPos.x + adjVertex.x - wall.start.x) * normal.x +
        (adjPos.y + adjVertex.y - wall.start.y) * normal.y;

      // Skip if adjacent room is on the SAME side as the owner room.
      // Same-side: |currentDist| ≈ 0 (both touching inner face)
      // Opposite-side: |currentDist| ≈ thick (should be at outer face)
      if (Math.abs(currentDist) < thick / 2) {
        console.log(`[walls] enforceAdjacentPositions: skip same-side room ${adjRoom.id?.slice(0,8)} on wall ${wall.id?.slice(0,8)}, dist=${currentDist.toFixed(1)}, thick=${thick}`);
        continue;
      }
      const delta = thick - currentDist;
      if (Math.abs(delta) < 0.5) continue;

      adjRoom.floorPosition = {
        x: adjPos.x + normal.x * delta,
        y: adjPos.y + normal.y * delta,
      };
      console.log(`[walls] enforceAdjacentPositions: shift room ${adjRoom.id?.slice(0,8)} by (${(normal.x * delta).toFixed(1)},${(normal.y * delta).toFixed(1)}) (delta=${delta.toFixed(1)}, thick=${thick}, wall ${wall.id?.slice(0,8)})`);
    }
  }
}

/**
 * Merge collinear wall segments from different rooms that form a continuous
 * building wall. Designed for rectified (axis-aligned) polygons.
 *
 * Groups walls by axis line, then sweeps to merge overlapping/close segments.
 * Gap tolerance comes from FLOOR_PLAN_RULES.mergeGapFactor × wall thickness.
 *
 * @param {Object} floor - Floor object with walls[]
 */
export function mergeCollinearWalls(floor) {
  if (!floor?.walls || floor.walls.length < 2) return;

  // Find max thickness for gap tolerance
  let maxThick = DEFAULT_WALL_THICKNESS_CM;
  for (const w of floor.walls) {
    const t = w.thicknessCm ?? DEFAULT_WALL_THICKNESS_CM;
    if (t > maxThick) maxThick = t;
  }
  const gapTolerance = Math.round(maxThick * FLOOR_PLAN_RULES.mergeGapFactor);

  // Merge loop: restart after each merge (indices shift)
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < floor.walls.length && !merged; i++) {
      const wA = floor.walls[i];
      if (!wA.roomEdge) continue;
      const dxA = wA.end.x - wA.start.x;
      const dyA = wA.end.y - wA.start.y;
      const lenA = Math.hypot(dxA, dyA);
      if (lenA < 1) continue;
      const dirAx = dxA / lenA, dirAy = dyA / lenA;

      for (let j = i + 1; j < floor.walls.length && !merged; j++) {
        const wB = floor.walls[j];
        if (!wB.roomEdge) continue;
        if (wB.roomEdge.roomId === wA.roomEdge.roomId) continue;

        const dxB = wB.end.x - wB.start.x;
        const dyB = wB.end.y - wB.start.y;
        const lenB = Math.hypot(dxB, dyB);
        if (lenB < 1) continue;
        const dirBx = dxB / lenB, dirBy = dyB / lenB;

        // Must be parallel
        const cross = dirAx * dirBy - dirAy * dirBx;
        if (Math.abs(cross) > 0.02) continue;

        // Must be on the same line (perpendicular distance < 2 cm)
        const vx = wB.start.x - wA.start.x;
        const vy = wB.start.y - wA.start.y;
        const perpDist = Math.abs(vx * (-dirAy) + vy * dirAx);
        if (perpDist > 2) continue;

        // Project B onto A's axis
        const bStart = vx * dirAx + vy * dirAy;
        const bEnd = (wB.end.x - wA.start.x) * dirAx + (wB.end.y - wA.start.y) * dirAy;
        const bMin = Math.min(bStart, bEnd);
        const bMax = Math.max(bStart, bEnd);

        // Check overlap or close gap
        const gap = Math.max(0, Math.max(bMin - lenA, 0 - bMax));
        if (gap > gapTolerance) continue;

        // Merge: extend A to cover union of both
        wA.thicknessCm = Math.max(
          wA.thicknessCm ?? DEFAULT_WALL_THICKNESS_CM,
          wB.thicknessCm ?? DEFAULT_WALL_THICKNESS_CM
        );

        const newMin = Math.min(0, bMin);
        const newMax = Math.max(lenA, bMax);
        const shift = -newMin;

        if (shift > 0.5) {
          for (const s of wA.surfaces) { s.fromCm += shift; s.toCm += shift; }
          for (const d of wA.doorways) { d.offsetCm += shift; }
        }

        wA.start = {
          x: wA.start.x + dirAx * newMin,
          y: wA.start.y + dirAy * newMin
        };
        wA.end = {
          x: wA.start.x + dirAx * (newMax - newMin),
          y: wA.start.y + dirAy * (newMax - newMin)
        };

        // Transfer surfaces and doorways from B to A
        for (const s of wB.surfaces) {
          if (!wA.surfaces.some(ws => ws.roomId === s.roomId && ws.edgeIndex === s.edgeIndex)) {
            const sFrom = Math.min(bStart, bEnd) + shift;
            const sTo = sFrom + (s.toCm - s.fromCm);
            wA.surfaces.push({ ...s, fromCm: Math.max(0, sFrom), toCm: sTo });
          }
        }
        for (const dw of wB.doorways) {
          const bStartOnA = Math.min(bStart, bEnd) + shift;
          wA.doorways.push({ ...dw, offsetCm: dw.offsetCm + bStartOnA });
        }

        // Delete all doorways when wall geometry changes significantly
        if (shift > 0.5 || newMax > lenA + 0.5) {
          wA.doorways = [];
        }

        floor.walls.splice(j, 1);
        merged = true;
      }
    }
  }
}

/**
 * Merge parallel walls that sit within wall thickness distance of each other,
 * even if they belong to the same room — provided both are on envelope edges.
 *
 * This enforces constraint #3: "one physical wall = one wall entity."
 * Regular mergeCollinearWalls skips same-room walls; this handles the remaining
 * case where two edges of the same room both lie on the same envelope boundary.
 *
 * @param {Object} floor - Floor with walls[], layout.envelope
 */
export function enforceNoParallelWalls(floor) {
  if (!floor?.walls || floor.walls.length < 2) return;
  const envelope = floor?.layout?.envelope;
  const envelopePoly = envelope?.detectedPolygonCm || envelope?.polygonCm;
  if (!envelopePoly || envelopePoly.length < 3) {
    console.log(`[walls] enforceNoParallelWalls: no envelope polygon, skipping`);
    return;
  }
  console.log(`[walls] enforceNoParallelWalls: using ${envelope.detectedPolygonCm ? 'detected' : 'recomputed'} polygon (${envelopePoly.length} verts)`);

  // Identify which walls are on envelope edges
  const onEnvelope = new Set();
  for (const w of floor.walls) {
    const mid = {
      x: (w.start.x + w.end.x) / 2,
      y: (w.start.y + w.end.y) / 2,
    };
    const dx = w.end.x - w.start.x;
    const dy = w.end.y - w.start.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) continue;

    const nx = dx / len, ny = dy / len;

    for (let i = 0; i < envelopePoly.length; i++) {
      const C = envelopePoly[i];
      const D = envelopePoly[(i + 1) % envelopePoly.length];
      const edx = D.x - C.x, edy = D.y - C.y;
      const elen = Math.hypot(edx, edy);
      if (elen < 1) continue;
      const enx = edx / elen, eny = edy / elen;

      const cross = nx * eny - ny * enx;
      if (Math.abs(cross) > 0.02) continue;

      const vx = C.x - mid.x, vy = C.y - mid.y;
      const perpDist = Math.abs(vx * ny - vy * nx);
      if (perpDist <= (w.thicknessCm || DEFAULT_WALL_THICKNESS_CM) + 2) {
        onEnvelope.add(w.id);
        console.log(`[walls] enforceNoParallelWalls: wall ${w.id} (room=${w.roomEdge?.roomId}:e${w.roomEdge?.edgeIndex}) is on envelope edge ${i}`);
        break;
      }
    }
  }

  // Now check for parallel pairs among envelope walls from the same room
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < floor.walls.length && !merged; i++) {
      const wA = floor.walls[i];
      if (!onEnvelope.has(wA.id)) continue;
      if (!wA.roomEdge) continue;

      const dxA = wA.end.x - wA.start.x;
      const dyA = wA.end.y - wA.start.y;
      const lenA = Math.hypot(dxA, dyA);
      if (lenA < 1) continue;
      const dirAx = dxA / lenA, dirAy = dyA / lenA;

      for (let j = i + 1; j < floor.walls.length && !merged; j++) {
        const wB = floor.walls[j];
        if (!onEnvelope.has(wB.id)) continue;
        if (!wB.roomEdge) continue;
        // Only handle same-room case (cross-room is already in mergeCollinearWalls)
        if (wB.roomEdge.roomId !== wA.roomEdge.roomId) continue;

        const dxB = wB.end.x - wB.start.x;
        const dyB = wB.end.y - wB.start.y;
        const lenB = Math.hypot(dxB, dyB);
        if (lenB < 1) continue;
        const dirBx = dxB / lenB, dirBy = dyB / lenB;

        const cross = dirAx * dirBy - dirAy * dirBx;
        if (Math.abs(cross) > 0.02) continue;

        // Perpendicular distance between the wall lines
        const vx = wB.start.x - wA.start.x;
        const vy = wB.start.y - wA.start.y;
        const perpDist = Math.abs(vx * (-dirAy) + vy * dirAx);

        // Only merge if within wall thickness distance
        const maxThick = Math.max(wA.thicknessCm || 12, wB.thicknessCm || 12);
        if (perpDist > maxThick + 2) continue;

        // Must overlap or be close along the axis
        const bStart = vx * dirAx + vy * dirAy;
        const bEnd = (wB.end.x - wA.start.x) * dirAx + (wB.end.y - wA.start.y) * dirAy;
        const bMin = Math.min(bStart, bEnd);
        const bMax = Math.max(bStart, bEnd);
        const gap = Math.max(0, Math.max(bMin - lenA, 0 - bMax));
        if (gap > maxThick * FLOOR_PLAN_RULES.mergeGapFactor) continue;

        // Merge B into A — extend A, transfer surfaces
        wA.thicknessCm = Math.max(wA.thicknessCm || 12, wB.thicknessCm || 12);

        const newMin = Math.min(0, bMin);
        const newMax = Math.max(lenA, bMax);
        const shift = -newMin;

        if (shift > 0.5) {
          for (const s of wA.surfaces) { s.fromCm += shift; s.toCm += shift; }
          for (const d of wA.doorways) { d.offsetCm += shift; }
        }

        wA.start = {
          x: wA.start.x + dirAx * newMin,
          y: wA.start.y + dirAy * newMin
        };
        wA.end = {
          x: wA.start.x + dirAx * (newMax - newMin),
          y: wA.start.y + dirAy * (newMax - newMin)
        };

        for (const s of wB.surfaces) {
          if (!wA.surfaces.some(ws => ws.roomId === s.roomId && ws.edgeIndex === s.edgeIndex)) {
            const sFrom = Math.min(bStart, bEnd) + shift;
            const sTo = sFrom + (s.toCm - s.fromCm);
            wA.surfaces.push({ ...s, fromCm: Math.max(0, sFrom), toCm: sTo });
          }
        }

        floor.walls.splice(j, 1);
        merged = true;
      }
    }
  }
}

/**
 * Core sync algorithm. Called after any room change.
 * Ensures floor.walls[] matches the current room geometry.
 *
 * @param {Object} floor - Floor object with rooms[] and walls[]
 */
export function syncFloorWalls(floor, { enforcePositions = true } = {}) {
  if (!floor) return;
  if (!floor.walls) floor.walls = [];
  const rooms = (floor.rooms || []).filter(
    r => r.polygonVertices?.length >= 3 && !(r.circle?.rx > 0)
  );
  const roomIds = new Set(rooms.map(r => r.id));
  console.log(`[walls] syncFloorWalls: enforcePositions=${enforcePositions}, rooms=${rooms.length}, walls_before=${floor.walls.length}`);

  const wallByEdgeKey = indexWallsByEdge(floor.walls);
  const envelope = floor.layout?.envelope;
  const touchedWallIds = ensureWallsForEdges(rooms, floor, wallByEdgeKey, envelope);
  console.log(`[walls] syncFloorWalls: after ensureWallsForEdges → ${floor.walls.length} walls`);
  mergeSharedEdgeWalls(rooms, floor, wallByEdgeKey, touchedWallIds);
  console.log(`[walls] syncFloorWalls: after mergeSharedEdgeWalls → ${floor.walls.length} walls`);
  pruneOrphanSurfaces(floor, rooms, roomIds);
  removeStaleWalls(floor, touchedWallIds, roomIds);
  console.log(`[walls] syncFloorWalls: after removeStaleWalls → ${floor.walls.length} walls`);
  if (enforcePositions) {
    enforceAdjacentPositions(floor);
    reprojectAllSurfaces(floor); // M5 fix: re-project after position shifts
  }

  // Top-down skeleton enforcement: force skeleton thickness + height on boundary-aligned walls
  enforceSkeletonWallProperties(floor);
  console.log(`[walls] syncFloorWalls done: ${floor.walls.length} walls total`);
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
    w => (w.surfaces || []).some(s => s.roomId === roomId) ||
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
  if (!re) {
    console.warn(`[walls] getWallNormal: fallback {0,-1} — wall ${wall.id?.slice(0,8)} has no roomEdge`);
    return { x: 0, y: -1 };
  }
  const room = (floor.rooms || []).find(r => r.id === re.roomId);
  if (!room?.polygonVertices || room.polygonVertices.length < 3) {
    console.warn(`[walls] getWallNormal: fallback {0,-1} — room ${re.roomId?.slice(0,8)} not found or has <3 vertices`);
    return { x: 0, y: -1 };
  }

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
  if (len < 0.001) {
    console.warn(`[walls] getWallNormal: fallback {0,-1} — wall ${wall.id?.slice(0,8)} has zero length`);
    return { x: 0, y: -1 };
  }

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
        const rawStart = -tB;
        const clampStart = Math.max(thickPrev, thick) * 2;
        extStart = Math.max(0, Math.min(rawStart, clampStart));
        if (rawStart > clampStart) {
          console.log(`[walls] computeWallExtensions: clamped e${i} extStart from ${rawStart.toFixed(1)} to ${clampStart.toFixed(1)}`);
        }
      } else if (dA.x * dB.x + dA.y * dB.y > 0) {
        // Parallel, same direction (co-linear continuation): walls just continue each other
        extStart = 0;
      } else {
        // Parallel, opposite direction (hairpin/180° turn): walls overlap, no extension needed
        extStart = 0;
        console.log(`[walls] computeWallExtensions: hairpin at e${i} start, ext=0`);
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
        const rawEnd = t;
        const clampEnd = Math.max(thickNext, thick) * 2;
        extEnd = Math.max(0, Math.min(rawEnd, clampEnd));
        if (rawEnd > clampEnd) {
          console.log(`[walls] computeWallExtensions: clamped e${i} extEnd from ${rawEnd.toFixed(1)} to ${clampEnd.toFixed(1)}`);
        }
      } else if (dB.x * dC.x + dB.y * dC.y > 0) {
        // Parallel, same direction (co-linear continuation): walls just continue each other
        extEnd = 0;
      } else {
        // Parallel, opposite direction (hairpin/180° turn): walls overlap, no extension needed
        extEnd = 0;
        console.log(`[walls] computeWallExtensions: hairpin at e${i} end, ext=0`);
      }
    }

    result.set(i, { extStart, extEnd });
    console.log(`[walls] computeWallExtensions room=${roomId.slice(0,8)} e${i}: extStart=${extStart.toFixed(1)} extEnd=${extEnd.toFixed(1)} thick=${thick}`);
  }

  return result;
}

/**
 * Check if a specific room edge has skirting pieces configured (active or excluded).
 * Returns true as long as the edge has skirting pieces, even if all are currently excluded.
 * This ensures the skirting offset is preserved so excluded pieces can be re-activated.
 *
 * @param {Object} room - Room entity with skirting configuration
 * @param {number} edgeIndex - Index of the edge to check
 * @param {Object} floor - Floor entity for doorway intervals
 * @returns {boolean} true if edge has at least one skirting piece (active or excluded)
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

  // Check if any segment lies on this edge (excluded or not — offset must be reserved
  // even when all pieces are excluded so they can be re-activated)
  let foundOnEdge = 0, foundActive = 0;
  for (const seg of segments) {

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
        foundOnEdge++;
        if (!seg.excluded) foundActive++;
      }
    }
  }

  return foundOnEdge > 0; // True if any piece (active or excluded) is on this edge
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
  const surface = wall.surfaces?.[surfaceIdx];
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
    // Wall surfaces default to bottom-left origin so tiles stack from the skirting
    // boundary upward — full tiles at the bottom, clipping (if any) at the ceiling.
    // Inherits the room's pattern type/settings but forces origin to bl.
    // An explicit surface pattern (user-set) is used as-is.
    pattern: (() => {
      const base = surface.pattern ? { ...surface.pattern }
        : (room?.pattern ? { ...room.pattern } : null);
      const origin = skirtingOffset > 0 ? { preset: 'bl', xCm: 0, yCm: 0 } : base?.origin;
      return base ? { ...base, origin } : null;
    })(),
    exclusions: allExclusions,
    excludedTiles: surface.excludedTiles || [],
    dividers: surface.dividers || [],
    zoneSettings: surface.zoneSettings || {},
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

  // Second pass: detect reflex-vertex corner gaps and record fill triangles.
  // A gap exists when two adjacent walls' outer faces don't meet
  // (outerEndPt_A ≠ outerStartPt_B). This happens at reflex vertices where the
  // extension formula correctly returns 0 but leaves the outer corner open.
  const edgeLookup = new Map(); // "roomId:edgeIndex" → descriptor
  for (const desc of result.values()) {
    const re = desc.wall.roomEdge;
    if (re) edgeLookup.set(`${re.roomId}:${re.edgeIndex}`, desc);
  }

  for (const desc of result.values()) {
    const re = desc.wall.roomEdge;
    if (!re) continue;
    const room = (floor.rooms || []).find(r => r.id === re.roomId);
    if (!room?.polygonVertices?.length) continue;
    const nextIdx = (re.edgeIndex + 1) % room.polygonVertices.length;
    const nextDesc = edgeLookup.get(`${re.roomId}:${nextIdx}`);
    if (!nextDesc) continue;
    const dx = nextDesc.outerStartPt.x - desc.outerEndPt.x;
    const dy = nextDesc.outerStartPt.y - desc.outerEndPt.y;
    if (dx * dx + dy * dy > 0.01) { // gap > 0.1 cm
      desc.endCornerFill = {
        p1: desc.outerEndPt,       // outer face end of this wall
        p2: nextDesc.outerStartPt, // outer face start of next wall
        p3: desc.extEndPt,         // shared inner vertex
        h: desc.wall.heightEndCm ?? DEFAULT_WALL_HEIGHT_CM,
      };
    }
  }

  // Third pass: detect cross-room outer corner gaps and add quad fill prisms.
  // When two walls from different wall-IDs have outer faces that don't yet meet at a corner,
  // extend each outer face line until they intersect and fill the gap with a prism.
  {
    const CORNER_MAX_GAP_CM = 50; // max extension distance to consider a valid corner

    // Intersect two lines (p1+t*d1, p2+s*d2); return corner point if both
    // t and s are in (0.1, CORNER_MAX_GAP_CM] (gap exists and isn't huge).
    const outerLineIntersect = (p1, d1, p2, d2) => {
      const cross = d1.x * d2.y - d1.y * d2.x;
      if (Math.abs(cross) < 0.001) return null; // parallel walls
      const dx = p2.x - p1.x, dy = p2.y - p1.y;
      const t = (dx * d2.y - dy * d2.x) / cross;
      const s = (dx * d1.y - dy * d1.x) / cross;
      if (t <= 0.1 || s <= 0.1) return null; // already meeting or wrong direction
      if (t > CORNER_MAX_GAP_CM || s > CORNER_MAX_GAP_CM) return null; // gap too large
      return { x: p1.x + t * d1.x, y: p1.y + t * d1.y };
    };

    // Unbounded line intersection: find where two infinite lines cross.
    // No directional constraint — inner faces may overlap at corners.
    const lineLineIntersect = (p1, d1, p2, d2) => {
      const cross = d1.x * d2.y - d1.y * d2.x;
      if (Math.abs(cross) < 0.001) return null; // parallel
      const t = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / cross;
      return { x: p1.x + t * d1.x, y: p1.y + t * d1.y };
    };

    // Each outer endpoint: { wallId, desc, isEnd, outerPt, innerPt, dir, h }
    // "isEnd=true"  → outer face extends forward (+dir) past outerEndPt
    // "isEnd=false" → outer face extends backward (-dir) past outerStartPt
    const eps = [];
    for (const [wallId, desc] of result) {
      const h = desc.wall.heightEndCm ?? DEFAULT_WALL_HEIGHT_CM;
      eps.push({ wallId, desc, isEnd: true,
        outerPt: desc.outerEndPt, innerPt: desc.extEndPt,
        dir: { x: desc.dirX, y: desc.dirY }, h });
      eps.push({ wallId, desc, isEnd: false,
        outerPt: desc.outerStartPt, innerPt: desc.extStartPt,
        dir: { x: -desc.dirX, y: -desc.dirY }, h });
    }

    for (let i = 0; i < eps.length; i++) {
      for (let j = i + 1; j < eps.length; j++) {
        const eA = eps[i], eB = eps[j];
        if (eA.wallId === eB.wallId) continue;

        const pCorner = outerLineIntersect(eA.outerPt, eA.dir, eB.outerPt, eB.dir);
        if (!pCorner) continue;

        // Inner corner: intersect infinite inner face lines (no directional constraint)
        const pInner = lineLineIntersect(eA.innerPt, eA.dir, eB.innerPt, eB.dir);

        // Quad fill: p1=eA outer endpoint, p2=eB outer endpoint,
        // p4=outer corner, p3=inner corner (line intersection, fallback to parallelogram)
        const fill = {
          p1: eA.outerPt,
          p2: eB.outerPt,
          p3: pInner ?? { x: eA.outerPt.x + eB.outerPt.x - pCorner.x,
                          y: eA.outerPt.y + eB.outerPt.y - pCorner.y },
          p4: pCorner,
          h: Math.max(eA.h, eB.h),
        };

        // Assign to eA only (avoid duplicating the fill on both walls)
        if (eA.isEnd) {
          if (!eA.desc.endCornerFill) {
            eA.desc.endCornerFill = fill;
            console.log(`[walls] cross-room corner fill: end of ${eA.wallId.slice(0, 8)} + ${eB.isEnd ? 'end' : 'start'} of ${eB.wallId.slice(0, 8)}, outer=(${pCorner.x.toFixed(1)},${pCorner.y.toFixed(1)}) inner=(${fill.p3.x.toFixed(1)},${fill.p3.y.toFixed(1)})`);
          }
        } else {
          if (!eA.desc.startCornerFill) {
            eA.desc.startCornerFill = fill;
            console.log(`[walls] cross-room corner fill: start of ${eA.wallId.slice(0, 8)} + ${eB.isEnd ? 'end' : 'start'} of ${eB.wallId.slice(0, 8)}, outer=(${pCorner.x.toFixed(1)},${pCorner.y.toFixed(1)}) inner=(${fill.p3.x.toFixed(1)},${fill.p3.y.toFixed(1)})`);
          }
        }
      }
    }
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
 * Rebuild a wall descriptor for room-level 3D by anchoring geometry to the
 * room's own polygon vertices — the same approach the 2D renderer uses
 * (render.js:1579-1601). This avoids building-spanning wall geometry by
 * starting from the room's edge and extending outward by room-specific amounts.
 *
 * @param {Object} assembled - Wall descriptor from prepareFloorWallData
 * @param {Object} rawDesc - WallDescriptor from computeFloorWallGeometry
 * @param {Object} room - Room object with polygonVertices and floorPosition
 * @returns {Object} Rebuilt wall descriptor anchored to the room's edge
 */
export function rebuildWallForRoom(assembled, rawDesc, room) {
  const roomId = room.id;
  const verts = room.polygonVertices;
  const pos = room.floorPosition || { x: 0, y: 0 };
  if (!verts?.length) return assembled;

  // Find the surface for this room to get edgeIndex
  const roomSurf = assembled.surfaces.find(s => s.roomId === roomId);
  if (!roomSurf) {
    console.log(`[walls] rebuildWallForRoom: wall ${assembled.id} no surface for room ${roomId} → skip`);
    return assembled;
  }
  const edgeIdx = roomSurf.edgeIndex;
  if (edgeIdx == null || edgeIdx < 0 || edgeIdx >= verts.length) return assembled;

  const n = verts.length;
  const thick = assembled.thicknessCm;

  // Room edge vertices in floor coordinates (same as 2D renderer)
  const origA = { x: pos.x + verts[edgeIdx].x, y: pos.y + verts[edgeIdx].y };
  const origB = { x: pos.x + verts[(edgeIdx + 1) % n].x, y: pos.y + verts[(edgeIdx + 1) % n].y };
  const edgeDx = origB.x - origA.x;
  const edgeDy = origB.y - origA.y;
  const origL = Math.hypot(edgeDx, edgeDy);
  if (origL < 1) return assembled;

  const edgeDirX = edgeDx / origL;
  const edgeDirY = edgeDy / origL;

  // Room-specific extensions (exactly like 2D: render.js:1597)
  const roomExt = rawDesc.extensions.get(roomId) ?? { extStart: thick, extEnd: thick };
  const extStart = roomExt.extStart;
  const extEnd = roomExt.extEnd;

  // Build A/B/OA/OB from room vertices + extensions (render.js:1600-1604)
  const normal = rawDesc.normal;
  const A = { x: origA.x - edgeDirX * extStart, y: origA.y - edgeDirY * extStart };
  const B = { x: origB.x + edgeDirX * extEnd, y: origB.y + edgeDirY * extEnd };
  const L = origL + extStart + extEnd;
  const OA = { x: A.x + normal.x * thick, y: A.y + normal.y * thick };
  const OB = { x: B.x + normal.x * thick, y: B.y + normal.y * thick };

  // Remap doorways into extended-wall-local space using the existing API.
  // getDoorwaysInEdgeSpace already includes extStart in the offset, so no extra shift needed.
  const doorways = getDoorwaysInEdgeSpace(rawDesc, room, edgeIdx);

  // Interpolate height at this edge's position along the original wall
  const hStart = assembled.hStart;
  const hEnd = assembled.hEnd;

  // Surface fracs: the room's surface spans the extended wall from extStart to extStart+origL
  const surfaces = assembled.surfaces.map(s => {
    if (s.roomId === roomId) {
      return { ...s, fromFrac: L > 0 ? extStart / L : 0, toFrac: L > 0 ? (extStart + origL) / L : 1 };
    }
    // Other surfaces: keep but mark as covering the same range (they share the wall)
    return { ...s, fromFrac: L > 0 ? extStart / L : 0, toFrac: L > 0 ? (extStart + origL) / L : 1 };
  });

  console.log(`[walls] rebuildWallForRoom: wall ${assembled.id} for room ${roomId} edge=${edgeIdx} ownerLen=${assembled.edgeLength.toFixed(1)}→roomLen=${L.toFixed(1)} A=(${A.x.toFixed(1)},${A.y.toFixed(1)}) B=(${B.x.toFixed(1)},${B.y.toFixed(1)}) ext=${extStart.toFixed(1)}/${extEnd.toFixed(1)} doorways=${doorways.length}`);

  return {
    ...assembled,
    start: A,
    end: B,
    outerStart: OA,
    outerEnd: OB,
    edgeLength: L,
    hStart,
    hEnd,
    doorways,
    surfaces,
    // Discard corner fills — they belong to owner geometry, not room-local
    startCornerFill: null,
    endCornerFill: null,
  };
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

/**
 * Canonical tile computation pipeline for any tileable surface.
 * Both 2D (renderPlanSvg, renderFloorCanvas) and 3D (prepareRoom3DData,
 * prepareFloorWallData) must call this function — never call
 * computeAvailableArea + tilesForPreview directly in renderers.
 *
 * @param {Object} state - Full app state
 * @param {Object} region - Room, wall surface region, or face region (must have polygonVertices)
 * @param {Object|null} floor - Floor object (needed for doorway patches and pattern context)
 * @param {Object} options
 * @param {Array}   options.exclusions             - Exclusions to subtract (required)
 * @param {boolean} options.includeDoorwayPatches  - Union doorway floor patches into available area (floor rooms only)
 * @param {Object|null} options.wallGeometry       - Pre-computed wall geometry map (avoids redundant compute)
 * @param {Object|null} options.effectiveSettings  - { tile, grout, pattern } — pass from getEffectiveTileSettings()
 * @param {Object|null} options.originOverride     - Pattern origin — pass from computePatternGroupOrigin()
 * @param {boolean} options.isRemovalMode          - Whether removal mode is active
 * @returns {{ tiles: Array, groutColor: string, error: string|null }}
 */
export function computeSurfaceTiles(state, region, floor, options = {}) {
  const {
    exclusions = [],
    includeDoorwayPatches = false,
    wallGeometry = null,
    effectiveSettings = null,
    originOverride = null,
    isRemovalMode = false,
  } = options;

  console.log(`[computeSurfaceTiles] region=${region?.id || 'anon'} excl=${exclusions.length} doorways=${includeDoorwayPatches} removalMode=${isRemovalMode}`);

  const avail = computeAvailableArea(region, exclusions);
  console.log(`[computeSurfaceTiles] avail mp=${avail.mp?.length ?? 0} polygons error=${avail.error || 'none'}`);

  if (avail.error) return { tiles: [], groutColor: '#ffffff', error: avail.error };
  if (!avail.mp) return { tiles: [], groutColor: '#ffffff', error: null };

  let mp = avail.mp;

  if (includeDoorwayPatches && floor) {
    const patches = computeDoorwayFloorPatches(region, floor, wallGeometry, 'multipolygon');
    for (const patch of patches) {
      try {
        mp = polygonClipping.union(mp, patch);
      } catch (_) { /* ignore degenerate patches */ }
    }
  }

  const result = tilesForPreview(state, mp, region, isRemovalMode, floor, {
    originOverride,
    effectiveSettings,
  });

  const groutColor = effectiveSettings?.grout?.colorHex || region?.grout?.colorHex || '#ffffff';
  console.log(`[computeSurfaceTiles] result tiles=${result.tiles?.length ?? 0} error=${result.error || 'none'}`);

  return { tiles: result.tiles || [], groutColor, error: result.error || null };
}

export function computeSubSurfaceTiles(state, exclusions, floor, opts = {}) {
  const { isRemovalMode = false } = opts;
  const results = [];
  console.log(`[walls:computeSubSurfaceTiles] checking ${(exclusions || []).length} exclusions for sub-surfaces`);
  for (const excl of (exclusions || [])) {
    if (!excl.tile) continue;
    const region = exclusionToRegion(excl, state);
    if (!region) {
      console.warn(`[walls:computeSubSurfaceTiles] excl=${excl.id} type=${excl.type}: exclusionToRegion returned null`);
      continue;
    }
    const r = computeSurfaceTiles(state, region, floor, {
      exclusions: [],
      includeDoorwayPatches: false,
      effectiveSettings: { tile: region.tile, grout: region.grout, pattern: region.pattern },
      isRemovalMode,
    });
    console.log(`[walls:subSurface] excl=${excl.id} type=${excl.type} tiles=${r.tiles.length} error=${r.error || 'none'}`);
    results.push({ exclusionId: excl.id, tiles: r.tiles, groutColor: r.groutColor, error: r.error });
  }
  return results;
}

/**
 * Compute tiles for each skirting zone on a wall surface or 3D object face.
 *
 * Each zone is a rect in surface-local coords:
 *   { x1, x2, h, tile, grout, pattern }  (wall surface zones)
 *   { h, tile, grout, pattern }           (3D object face zone — full-width, x1=0)
 *
 * `surfaceWidthCm` is required for full-width zones (when x1/x2 are absent).
 * Returns [{ zoneIdx, x1, x2, tiles, groutColor, error }].
 */
export function computeSkirtingZoneTiles(state, skirtingZones, surfaceWidthCm, floor, opts = {}) {
  const { isRemovalMode = false } = opts;
  const results = [];
  console.log(`[walls:computeSkirtingZoneTiles] checking ${(skirtingZones || []).length} zones surfaceW=${surfaceWidthCm}`);
  for (let i = 0; i < (skirtingZones || []).length; i++) {
    const zone = skirtingZones[i];
    const x1 = zone.x1 ?? 0;
    const x2 = zone.x2 ?? surfaceWidthCm;
    const w = x2 - x1;
    const h = zone.h;
    if (w <= 0 || h <= 0) {
      console.warn(`[walls:skirtingZone] idx=${i} degenerate w=${w} h=${h} — skipped`);
      continue;
    }
    const resolvedZoneTile = resolvePresetTile(zone.tile, state);
    const resolvedZoneGrout = zone.tile?.reference
      ? resolvePresetGrout(zone.grout, zone.tile.reference, state)
      : (zone.grout || { widthCm: 0.2, colorHex: '#ffffff' });
    const region = {
      widthCm: w,
      heightCm: h,
      polygonVertices: [
        { x: x1, y: 0 },
        { x: x2, y: 0 },
        { x: x2, y: h },
        { x: x1, y: h },
      ],
      tile: resolvedZoneTile,
      grout: resolvedZoneGrout || { widthCm: 0.2, colorHex: '#ffffff' },
      pattern: zone.pattern || { type: 'grid', bondFraction: 0.5, rotationDeg: 0, offsetXcm: 0, offsetYcm: 0 },
      exclusions: [],
    };
    // All zones on the same surface share one origin — centered on the full surface width.
    // This ensures equal cuts on both ends of the wall edge.
    const originOverride = { x: surfaceWidthCm / 2, y: zone.h / 2 };
    const r = computeSurfaceTiles(state, region, floor, {
      exclusions: [],
      includeDoorwayPatches: false,
      effectiveSettings: { tile: region.tile, grout: region.grout, pattern: region.pattern },
      originOverride,
      isRemovalMode,
    });
    console.log(`[walls:skirtingZone] idx=${i} x=[${x1.toFixed(1)},${x2.toFixed(1)}] h=${h} origin=(${originOverride.x.toFixed(1)},${originOverride.y.toFixed(1)}) tiles=${r.tiles.length} error=${r.error || 'none'}`);
    results.push({ zoneIdx: i, x1, x2, tiles: r.tiles, groutColor: r.groutColor, error: r.error });
  }
  return results;
}

/**
 * Prepare a wall surface region with contact exclusions injected.
 * Single entry point for both the 3D pipeline and the 2D wall editor.
 * Returns the region (with contact exclusions) or null.
 */
/**
 * Derives the tile/grout/pattern spec for skirting zones from room skirting settings.
 * Returns null if cutout type and no floor tile is configured (zone should be suppressed).
 *
 * Cutout: long side of floor tile becomes skirting tile width; skirting.heightCm is height.
 * Bought: boughtWidthCm × heightCm tile with neutral grout.
 */
function deriveSkirtingTileSpec(room) {
  const skirting = room.skirting || {};
  const h = skirting.heightCm || DEFAULT_SKIRTING_CONFIG.heightCm;
  const grout = room.grout || { widthCm: 0.2, colorHex: '#ffffff' };
  const pattern = {
    type: 'grid',
    bondFraction: 0.5,
    rotationDeg: 0,
    offsetXcm: 0,
    offsetYcm: 0,
    origin: { preset: 'center', xCm: 0, yCm: 0 },
  };

  if (skirting.type === 'bought') {
    const w = Number(skirting.boughtWidthCm) || DEFAULT_SKIRTING_CONFIG.boughtWidthCm;
    return {
      tile: { widthCm: w, heightCm: h, shape: 'rect', reference: null },
      grout,
      pattern,
    };
  }

  // Cutout: derive from floor tile
  const floorTile = room.tile;
  if (!floorTile) {
    console.log(`[skirting:deriveSpec] room=${room.id} cutout but no floor tile — skipping`);
    return null;
  }
  const longSide = Math.max(floorTile.widthCm, floorTile.heightCm);
  return {
    tile: { widthCm: longSide, heightCm: h, shape: floorTile.shape || 'rect', reference: floorTile.reference || null },
    grout,
    pattern,
  };
}

/**
 * Projects skirting segments (room-local coords) onto a wall surface,
 * returning an array of { x1, x2, h } in wall-surface-local coordinates.
 *
 * Reuses the same projection math already present in wallSurfaceToTileableRegion
 * (lines 1526-1555) — cross-product collinearity test + parametric projection.
 *
 * @param {Array} segments - from computeSkirtingSegments, p1/p2 in room-local coords
 * @param {Object} surface - wall.surfaces[n], needs .edgeIndex, .fromCm
 * @param {Object} room - for polygonVertices
 * @param {Object} wall - for fromCm fallback
 * @returns {Array<{x1, x2, h}>}
 */
function projectSegmentsToSurface(segments, surface, room, wall) {
  const edgeIndex = surface.edgeIndex;
  if (edgeIndex == null) return [];

  const poly = roomPolygon(room);
  if (!poly?.[0]?.[0]) return [];
  const verts = poly[0][0];
  if (edgeIndex >= verts.length) return [];

  const v1 = verts[edgeIndex];
  const v2 = verts[(edgeIndex + 1) % verts.length];
  const edgeDx = v2[0] - v1[0];
  const edgeDy = v2[1] - v1[1];
  const edgeLen = Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy);
  if (edgeLen < 0.01) return [];

  const fromCm = surface.fromCm || 0;
  const skirtH = room.skirting?.heightCm || DEFAULT_SKIRTING_CONFIG.heightCm;
  const zones = [];

  for (const seg of segments) {
    const [p1x, p1y] = seg.p1;
    const [p2x, p2y] = seg.p2;

    // Check collinearity: cross product of edge direction with (pt - v1) must be near zero
    const p1Dx = p1x - v1[0], p1Dy = p1y - v1[1];
    const p2Dx = p2x - v1[0], p2Dy = p2y - v1[1];
    const cross1 = Math.abs(edgeDx * p1Dy - edgeDy * p1Dx);
    const cross2 = Math.abs(edgeDx * p2Dy - edgeDy * p2Dx);

    if (cross1 > EPSILON * edgeLen || cross2 > EPSILON * edgeLen) continue;

    // Parametric position along edge (0..edgeLen)
    const t1 = (p1Dx * edgeDx + p1Dy * edgeDy) / (edgeLen * edgeLen);
    const t2 = (p2Dx * edgeDx + p2Dy * edgeDy) / (edgeLen * edgeLen);

    // Convert to surface-local x (offset by surface start)
    const x1 = t1 * edgeLen - fromCm;
    const x2 = t2 * edgeLen - fromCm;
    const surfWidth = (surface.toCm || edgeLen) - fromCm;

    // Only include segments that overlap this surface's x range
    if (Math.min(x1, x2) > surfWidth + 0.1 || Math.max(x1, x2) < -0.1) continue;

    zones.push({ x1: Math.min(x1, x2), x2: Math.max(x1, x2), h: skirtH });
  }

  return zones;
}

/**
 * Rebuilds all skirting zones across the entire state in-place.
 * Called after every commit so stored skirtingZones stay current.
 *
 * Wall surfaces: skirtingZones[] contains positioned rect specs (x1, x2, h, tile, grout, pattern).
 * 3D object faces: skirtingZone contains full-width band spec (h, tile, grout, pattern).
 *
 * Circle rooms are skipped (no wall edges).
 */
/**
 * Merges adjacent skirting zones (same h) into continuous runs.
 * Piece-level segments from computeSkirtingSegments are pre-divided by tile width;
 * merging them restores the full continuous run so the tiler can apply
 * centered origin across the whole run (equal cuts on both ends).
 * Zones interrupted by doorways or 3D objects produce separate runs.
 */
function mergeAdjacentZones(zones) {
  if (!zones.length) return [];
  const sorted = [...zones].sort((a, b) => a.x1 - b.x1);
  const merged = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    if (Math.abs(sorted[i].x1 - last.x2) < 0.5) {
      last.x2 = sorted[i].x2;
    } else {
      merged.push({ ...sorted[i] });
    }
  }
  return merged;
}

export function rebuildAllSkirtingZones(state) {
  let totalZones = 0;
  for (const floor of (state.floors || [])) {
    for (const room of (floor.rooms || [])) {

      // Clear existing zones on all wall surfaces belonging to this room
      for (const wall of (floor.walls || [])) {
        for (const s of (wall.surfaces || [])) {
          if (s.roomId === room.id) s.skirtingZones = [];
        }
      }
      // Clear on 3D object faces
      for (const obj of (room.objects3d || [])) {
        for (const s of (obj.surfaces || [])) s.skirtingZone = null;
      }

      // Circle rooms have no wall edges — skip
      if (room.circle?.rx > 0) continue;

      if (!room.skirting?.enabled) continue;

      const tileSpec = deriveSkirtingTileSpec(room);
      if (!tileSpec) continue; // cutout with no floor tile

      const segments = computeSkirtingSegments(room, false, floor);
      console.log(`[skirting:rebuild] room=${room.id} segments=${segments.length} tile=${tileSpec.tile.widthCm}×${tileSpec.tile.heightCm}`);

      // Wall surfaces: project room-wall segments onto each surface
      for (const wall of (floor.walls || [])) {
        for (let i = 0; i < (wall.surfaces || []).length; i++) {
          const s = wall.surfaces[i];
          if (s.roomId !== room.id) continue;

          const rawZones = projectSegmentsToSurface(segments, s, room, wall);
          // Merge adjacent zones into continuous runs so the tile engine
          // can apply centering across the full run, not per-piece.
          const zones = mergeAdjacentZones(rawZones);
          s.skirtingZones = zones.map(z => ({ ...z, ...tileSpec }));
          totalZones += s.skirtingZones.length;

          if (s.skirtingZones.length) {
            console.log(`[skirting:rebuild] wall=${wall.id.slice(0,8)} surf=${i} edgeIdx=${s.edgeIndex} zones=${s.skirtingZones.length} x=[${s.skirtingZones.map(z => `${z.x1.toFixed(1)}-${z.x2.toFixed(1)}`).join(',')}]`);
          }
        }
      }

      // 3D object faces: full-width bottom band (no x1/x2 — spans entire face)
      for (const obj of (room.objects3d || [])) {
        if (!obj.skirtingEnabled) continue;
        const h = Math.min(tileSpec.tile.heightCm, obj.heightCm || 100);
        for (const s of (obj.surfaces || [])) {
          if (s.face === 'top') continue;
          s.skirtingZone = { h, tile: { ...tileSpec.tile, heightCm: h }, grout: tileSpec.grout, pattern: tileSpec.pattern };
          console.log(`[skirting:rebuild] obj=${obj.id.slice(0,8)} face=${s.face} h=${h}`);
        }
      }
    }
  }
  console.log(`[skirting:rebuild] done — ${totalZones} total skirting zones across all surfaces`);
}

export function prepareWallSurface(wall, idx, room, floor, state) {
  const region = wallSurfaceToTileableRegion(wall, idx, { room, floor });
  if (!region || !room) return region;

  // Resolve tile dimensions and grout from preset (single source of truth)
  if (region.tile?.reference && state) {
    region.tile = resolvePresetTile(region.tile, state);
    region.grout = resolvePresetGrout(region.grout, region.tile.reference, state) || region.grout;
  }

  const surface = wall.surfaces[idx];
  const surfFromCm = surface?.fromCm || 0;
  const surfToCm = surface?.toCm ?? (wall.lengthCm || 0);
  const maxH = region.heightCm;

  const contacts = computeSurfaceContacts(room, wall);
  const contactExclusions = contacts
    .filter(c => c.overlapEnd > surfFromCm && c.overlapStart < surfToCm)
    .map(c => {
      const localX1 = Math.max(0, c.overlapStart - surfFromCm);
      const localX2 = Math.min(surfToCm - surfFromCm, c.overlapEnd - surfFromCm);
      return { type: 'rect', x: localX1, y: maxH - c.contactH, w: localX2 - localX1, h: c.contactH, _isContact: true };
    });

  if (contactExclusions.length) {
    console.log(`[prepareWallSurface] wall=${wall.id} surface=${idx}: ${contactExclusions.length} contact exclusion(s)`);
    region.exclusions = [...(region.exclusions || []), ...contactExclusions];
  }

  // Expose pre-computed skirting zones so the 2D renderer can tile them
  region.skirtingZones = wall.surfaces[idx]?.skirtingZones || [];

  return region;
}
