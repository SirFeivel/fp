// src/polygon-draw.js
// Controller for drawing room polygons by clicking vertices

import { svgEl, roomPolygon, isPointInPolygon as _isPointInPolygon } from "./geometry.js";
import { t } from "./i18n.js";
import { createSurface } from "./surface.js";
import { pointerToSvgXY, svgPointToClient } from "./svg-coords.js";
import { computeStructuralBoundaries } from "./skeleton.js";
import { getWallNormal } from "./walls.js";

const MIN_POINTS = 3;
const CLOSE_THRESHOLD_PX = 15; // Pixels to detect closing click on first point
export const SNAP_GRID_CM = 0.5; // Grid snap increment in cm
export const VERTEX_SNAP_THRESHOLD_CM = 2; // Distance threshold for vertex snapping
export const EDGE_SNAP_THRESHOLD_CM = 2; // Distance threshold for edge snapping

/**
 * Get all vertices (corners) of existing rooms in floor coordinates
 * Returns array of { roomId, vertex: {x, y} }
 * @param {Object} floor - Floor object with rooms array
 * @returns {Array<{roomId: string, vertex: {x: number, y: number}}>}
 */
export function getRoomVertices(floor) {
  const vertices = [];
  if (!floor?.rooms || !Array.isArray(floor.rooms)) return vertices;

  for (const room of floor.rooms) {
    if (!room || !room.id) continue;
    // All rooms are real rooms (no wall child objects)
    const pos = room.floorPosition || { x: 0, y: 0 };

    let mp;
    try {
      mp = roomPolygon(room);
    } catch (e) {
      // Skip rooms with invalid geometry
      continue;
    }
    if (!mp || !Array.isArray(mp) || mp.length === 0) continue;

    // Extract vertices from the polygon
    // MultiPolygon format: [Polygon[Ring[Point]]]
    for (const polygon of mp) {
      if (!Array.isArray(polygon)) continue;
      for (const ring of polygon) {
        if (!Array.isArray(ring) || ring.length < 2) continue;
        // Skip the last point as it duplicates the first (closed ring)
        for (let i = 0; i < ring.length - 1; i++) {
          const pt = ring[i];
          if (!Array.isArray(pt) || pt.length < 2) continue;
          const x = Number(pt[0]);
          const y = Number(pt[1]);
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
          vertices.push({
            roomId: room.id,
            vertex: { x: x + pos.x, y: y + pos.y }
          });
        }
      }
    }
  }

  return vertices;
}

/**
 * Find the nearest vertex to the mouse position
 * @param {{x: number, y: number}} mousePoint - Current mouse position
 * @param {Array<{roomId: string, vertex: {x: number, y: number}}>} vertices - Array of vertices
 * @returns {{vertex: {x: number, y: number}, roomId: string, distance: number} | null}
 */
export function findNearestVertex(mousePoint, vertices) {
  if (!mousePoint || !Array.isArray(vertices) || vertices.length === 0) {
    return null;
  }

  const mx = Number(mousePoint.x);
  const my = Number(mousePoint.y);
  if (!Number.isFinite(mx) || !Number.isFinite(my)) return null;

  let nearest = null;
  let minDist = Infinity;

  for (const item of vertices) {
    if (!item?.vertex || !item?.roomId) continue;
    const vx = Number(item.vertex.x);
    const vy = Number(item.vertex.y);
    if (!Number.isFinite(vx) || !Number.isFinite(vy)) continue;

    const dist = Math.hypot(vx - mx, vy - my);

    if (dist < minDist) {
      minDist = dist;
      nearest = {
        vertex: { x: vx, y: vy },
        roomId: item.roomId,
        distance: dist
      };
    }
  }

  return nearest;
}

/**
 * Get all edges of existing rooms in floor coordinates
 * @param {Object} floor - Floor object with rooms array
 * @returns {Array<{roomId: string, edge: {p1: {x: number, y: number}, p2: {x: number, y: number}}}>}
 */
export function getRoomEdges(floor) {
  const edges = [];
  if (!floor?.rooms || !Array.isArray(floor.rooms)) return edges;

  for (const room of floor.rooms) {
    if (!room || !room.id) continue;
    // All rooms are real rooms (no wall child objects)
    const pos = room.floorPosition || { x: 0, y: 0 };

    let mp;
    try {
      mp = roomPolygon(room);
    } catch (e) {
      // Skip rooms with invalid geometry
      continue;
    }
    if (!mp || !Array.isArray(mp) || mp.length === 0) continue;

    // Extract edges from the polygon
    // MultiPolygon format: [Polygon[Ring[Point]]]
    for (const polygon of mp) {
      if (!Array.isArray(polygon)) continue;
      for (const ring of polygon) {
        if (!Array.isArray(ring) || ring.length < 2) continue;
        for (let i = 0; i < ring.length - 1; i++) {
          const pt1 = ring[i];
          const pt2 = ring[i + 1];
          if (!Array.isArray(pt1) || pt1.length < 2) continue;
          if (!Array.isArray(pt2) || pt2.length < 2) continue;

          const x1 = Number(pt1[0]), y1 = Number(pt1[1]);
          const x2 = Number(pt2[0]), y2 = Number(pt2[1]);
          if (!Number.isFinite(x1) || !Number.isFinite(y1)) continue;
          if (!Number.isFinite(x2) || !Number.isFinite(y2)) continue;

          edges.push({
            roomId: room.id,
            edge: {
              p1: { x: x1 + pos.x, y: y1 + pos.y },
              p2: { x: x2 + pos.x, y: y2 + pos.y }
            }
          });
        }
      }
    }
  }

  return edges;
}

/**
 * Find the closest point on a line segment to a given point
 * @param {{x: number, y: number}} point - Query point
 * @param {{x: number, y: number}} p1 - Segment start
 * @param {{x: number, y: number}} p2 - Segment end
 * @returns {{x: number, y: number, t: number} | null} - Closest point with parameter t
 */
export function closestPointOnSegment(point, p1, p2) {
  if (!point || !p1 || !p2) return null;

  const px = Number(point.x), py = Number(point.y);
  const x1 = Number(p1.x), y1 = Number(p1.y);
  const x2 = Number(p2.x), y2 = Number(p2.y);

  if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
  if (!Number.isFinite(x1) || !Number.isFinite(y1)) return null;
  if (!Number.isFinite(x2) || !Number.isFinite(y2)) return null;

  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    // Segment is a point
    return { x: x1, y: y1, t: 0 };
  }

  // Project point onto line, clamped to segment
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  return {
    x: x1 + t * dx,
    y: y1 + t * dy,
    t
  };
}

/**
 * Find the nearest point on any room edge to the mouse position
 * @param {{x: number, y: number}} mousePoint - Current mouse position
 * @param {Array<{roomId: string, edge: {p1: {x,y}, p2: {x,y}}}>} edges - Array of edges
 * @returns {{point: {x: number, y: number}, roomId: string, edge: Object, distance: number} | null}
 */
export function findNearestEdgePoint(mousePoint, edges) {
  if (!mousePoint || !Array.isArray(edges) || edges.length === 0) {
    return null;
  }

  const mx = Number(mousePoint.x);
  const my = Number(mousePoint.y);
  if (!Number.isFinite(mx) || !Number.isFinite(my)) return null;

  let nearest = null;
  let minDist = Infinity;

  for (const item of edges) {
    if (!item?.edge?.p1 || !item?.edge?.p2 || !item?.roomId) continue;

    const closest = closestPointOnSegment({ x: mx, y: my }, item.edge.p1, item.edge.p2);
    if (!closest) continue;

    const dist = Math.hypot(closest.x - mx, closest.y - my);

    if (dist < minDist) {
      minDist = dist;
      nearest = {
        point: { x: closest.x, y: closest.y },
        roomId: item.roomId,
        edge: item.edge,
        distance: dist
      };
    }
  }

  return nearest;
}

/**
 * Find the nearest point on edges of a specific room
 */
function findNearestEdgePointOnRoom(mousePoint, edges, roomId) {
  const roomEdges = edges.filter(e => e.roomId === roomId);
  return findNearestEdgePoint(mousePoint, roomEdges);
}

/**
 * Find the nearest point on any structural boundary (envelope/spanning wall) to the cursor.
 * H targets snap the Y coordinate; V targets snap the X coordinate.
 * @param {{x: number, y: number}} point - Cursor position in floor coords
 * @param {Array} hTargets - Horizontal boundary targets from computeStructuralBoundaries
 * @param {Array} vTargets - Vertical boundary targets from computeStructuralBoundaries
 * @param {number} threshold - Max distance to snap
 * @returns {{point: {x: number, y: number}, type: string, thickness: number, distance: number} | null}
 */
export function findNearestBoundaryPoint(point, hTargets, vTargets, threshold) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;

  let best = null;
  let bestDist = Infinity;

  // Check H targets (lines at y=coord, x in [rangeMin, rangeMax])
  if (Array.isArray(hTargets)) {
    for (const t of hTargets) {
      const clampedX = Math.max(t.rangeMin, Math.min(t.rangeMax, point.x));
      const dist = Math.hypot(clampedX - point.x, t.coord - point.y);
      if (dist <= threshold && dist < bestDist) {
        bestDist = dist;
        best = { point: { x: clampedX, y: t.coord }, type: t.type, thickness: t.thickness, distance: dist };
      }
    }
  }

  // Check V targets (lines at x=coord, y in [rangeMin, rangeMax])
  if (Array.isArray(vTargets)) {
    for (const t of vTargets) {
      const clampedY = Math.max(t.rangeMin, Math.min(t.rangeMax, point.y));
      const dist = Math.hypot(t.coord - point.x, clampedY - point.y);
      if (dist <= threshold && dist < bestDist) {
        bestDist = dist;
        best = { point: { x: t.coord, y: clampedY }, type: t.type, thickness: t.thickness, distance: dist };
      }
    }
  }

  return best;
}

/**
 * Find the nearest H/V boundary intersection (corner) to the cursor.
 * A corner exists at (v.coord, h.coord) when each boundary's range includes the other axis's coord.
 * @param {{x: number, y: number}} point - Cursor position in floor coords
 * @param {Array} hTargets - Horizontal boundary targets
 * @param {Array} vTargets - Vertical boundary targets
 * @param {number} threshold - Max distance to snap
 * @returns {{point: {x: number, y: number}, type: string, distance: number} | null}
 */
export function findNearestCornerPoint(point, hTargets, vTargets, threshold) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  if (!Array.isArray(hTargets) || !Array.isArray(vTargets)) return null;

  let best = null;
  let bestDist = Infinity;

  for (const h of hTargets) {
    for (const v of vTargets) {
      // Corner exists only when each boundary's range includes the other's coord
      if (v.coord < h.rangeMin || v.coord > h.rangeMax) continue;
      if (h.coord < v.rangeMin || h.coord > v.rangeMax) continue;

      const corner = { x: v.coord, y: h.coord };
      const dist = Math.hypot(corner.x - point.x, corner.y - point.y);
      if (dist <= threshold && dist < bestDist) {
        bestDist = dist;
        best = { point: corner, type: "corner", distance: dist };
      }
    }
  }

  return best;
}

/**
 * Compute outer face snap targets from existing room walls.
 * For each axis-aligned wall, the outer face is at wallCoord + normal * thickness —
 * i.e. the position where an adjacent room's inner edge should sit.
 * Returns targets in the same { hTargets, vTargets } format as computeStructuralBoundaries.
 * @param {Object} floor - Floor with rooms[] and walls[]
 * @returns {{ hTargets: Array, vTargets: Array }}
 */
export function computeRoomWallOuterFaces(floor) {
  const hTargets = [];
  const vTargets = [];
  if (!floor?.walls?.length || !floor?.rooms?.length) return { hTargets, vTargets };

  for (const wall of floor.walls) {
    const thick = wall.thicknessCm;
    if (!thick || thick <= 0) continue;

    const dx = wall.end.x - wall.start.x;
    const dy = wall.end.y - wall.start.y;

    const normal = getWallNormal(wall, floor);

    if (Math.abs(dy) < 0.5 && Math.abs(dx) > 1) {
      // H wall — outer face offset in Y
      const wallY = (wall.start.y + wall.end.y) / 2;
      const outerY = wallY + normal.y * thick;
      const rangeMin = Math.min(wall.start.x, wall.end.x);
      const rangeMax = Math.max(wall.start.x, wall.end.x);
      hTargets.push({ coord: outerY, thickness: thick, type: 'room-outer', rangeMin, rangeMax });
      console.log(`[poly-draw] room outer H: y=${outerY.toFixed(1)} (inner=${wallY.toFixed(1)}, thick=${thick}cm)`);
    } else if (Math.abs(dx) < 0.5 && Math.abs(dy) > 1) {
      // V wall — outer face offset in X
      const wallX = (wall.start.x + wall.end.x) / 2;
      const outerX = wallX + normal.x * thick;
      const rangeMin = Math.min(wall.start.y, wall.end.y);
      const rangeMax = Math.max(wall.start.y, wall.end.y);
      vTargets.push({ coord: outerX, thickness: thick, type: 'room-outer', rangeMin, rangeMax });
      console.log(`[poly-draw] room outer V: x=${outerX.toFixed(1)} (inner=${wallX.toFixed(1)}, thick=${thick}cm)`);
    }
    // Diagonal walls skipped — don't occur in rectified assisted-mode floor plans
  }

  return { hTargets, vTargets };
}

// Adapter: geometry.js isPointInPolygon uses {x,y} format; ring arrays here are [x,y] format.
function isPointInPolygon(point, polygon) {
  return _isPointInPolygon(point, polygon.map(([x, y]) => ({ x, y })));
}

/**
 * Check if a point is inside any existing room
 * Returns the room ID if inside a room, null otherwise
 */
function isPointInsideAnyRoom(point, floor) {
  if (!floor?.rooms) return null;

  for (const room of floor.rooms) {
    const pos = room.floorPosition || { x: 0, y: 0 };
    const mp = roomPolygon(room);
    if (!mp || mp.length === 0) continue;

    // Transform point to room-local coordinates
    const localPoint = { x: point.x - pos.x, y: point.y - pos.y };

    // Check each polygon in the multipolygon
    for (const polygon of mp) {
      // Check outer ring (first ring)
      if (polygon.length > 0 && isPointInPolygon(localPoint, polygon[0])) {
        // Check if point is in any hole (subsequent rings)
        let inHole = false;
        for (let i = 1; i < polygon.length; i++) {
          if (isPointInPolygon(localPoint, polygon[i])) {
            inHole = true;
            break;
          }
        }
        if (!inHole) {
          return room.id;
        }
      }
    }
  }

  return null;
}

/**
 * Snap a value to the nearest grid increment
 * @param {number} value - Value to snap
 * @param {number} [gridSize=SNAP_GRID_CM] - Grid size
 * @returns {number} - Snapped value
 */
export function snapToGrid(value, gridSize = SNAP_GRID_CM) {
  const v = Number(value);
  const g = Number(gridSize);
  if (!Number.isFinite(v)) return 0;
  if (!Number.isFinite(g) || g <= 0) return v;
  return Math.round(v / g) * g;
}

/**
 * Snap a point to the grid, optionally constraining angle.
 * - Shift key: constrain to 15° increments (manual mode)
 * - validAngles: always constrain to envelope angles (assisted mode)
 * - Shift + validAngles: Shift takes priority (finer control)
 * @param {{x: number, y: number}} point
 * @param {{x: number, y: number} | null} lastPoint
 * @param {boolean} shiftKey
 * @param {number[] | null} [validAngles=null] - Envelope angles in degrees (e.g. [0,90,180,270])
 */
function snapPoint(point, lastPoint, shiftKey, validAngles = null) {
  let snapped = {
    x: snapToGrid(point.x),
    y: snapToGrid(point.y)
  };

  // If Shift held and we have a previous point, constrain angle to 15° increments
  if (shiftKey && lastPoint) {
    const dx = snapped.x - lastPoint.x;
    const dy = snapped.y - lastPoint.y;
    const angle = Math.atan2(dy, dx);
    const snappedAngle = Math.round(angle / (Math.PI / 12)) * (Math.PI / 12);
    const dist = Math.hypot(dx, dy);
    snapped = {
      x: lastPoint.x + Math.cos(snappedAngle) * dist,
      y: lastPoint.y + Math.sin(snappedAngle) * dist
    };
    // Re-snap to grid after angle constraint
    snapped.x = snapToGrid(snapped.x);
    snapped.y = snapToGrid(snapped.y);
  } else if (validAngles && validAngles.length > 0 && lastPoint) {
    // Assisted mode: constrain to envelope valid angles
    const dx = snapped.x - lastPoint.x;
    const dy = snapped.y - lastPoint.y;
    const angleDeg = ((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360;
    const dist = Math.hypot(dx, dy);

    // Find nearest valid angle
    let bestAngle = validAngles[0];
    let bestDelta = Infinity;
    for (const va of validAngles) {
      let delta = Math.abs(angleDeg - va);
      if (delta > 180) delta = 360 - delta;
      if (delta < bestDelta) {
        bestDelta = delta;
        bestAngle = va;
      }
    }

    const bestRad = bestAngle * Math.PI / 180;
    snapped = {
      x: lastPoint.x + Math.cos(bestRad) * dist,
      y: lastPoint.y + Math.sin(bestRad) * dist
    };
    snapped.x = snapToGrid(snapped.x);
    snapped.y = snapToGrid(snapped.y);
  }

  return snapped;
}

/**
 * Find the nearest valid angle (degrees) to the vector (dx, dy).
 * @param {number} dx
 * @param {number} dy
 * @param {number[]} validAngles - e.g. [0, 90, 180, 270]
 * @returns {number} Nearest valid angle in degrees
 */
function _nearestValidAngle(dx, dy, validAngles) {
  const angleDeg = ((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360;
  let bestAngle = validAngles[0];
  let bestDelta = Infinity;
  for (const va of validAngles) {
    let delta = Math.abs(angleDeg - va);
    if (delta > 180) delta = 360 - delta;
    if (delta < bestDelta) {
      bestDelta = delta;
      bestAngle = va;
    }
  }
  return bestAngle;
}

/**
 * Try to snap a point to existing room geometry (vertices first, then edges)
 * @param {{x: number, y: number}} point - Point to snap
 * @param {Array} vertices - Array of room vertices
 * @param {Array} edges - Array of room edges
 * @param {{x: number, y: number} | null} lastPoint - Previous point for angle constraint
 * @param {boolean} shiftKey - Whether shift key is held for angle constraint
 * @param {number} [vertexThreshold=VERTEX_SNAP_THRESHOLD_CM] - Vertex snap threshold
 * @param {number} [edgeThreshold=EDGE_SNAP_THRESHOLD_CM] - Edge snap threshold
 * @returns {{point: {x: number, y: number}, type: 'vertex'|'edge'|'grid', roomId?: string}}
 */
export function snapToRoomGeometry(
  point,
  vertices,
  edges,
  lastPoint,
  shiftKey,
  vertexThreshold = VERTEX_SNAP_THRESHOLD_CM,
  edgeThreshold = EDGE_SNAP_THRESHOLD_CM,
  boundaryTargets = null,
  validAngles = null
) {
  // Validate input point
  if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) {
    return {
      point: { x: 0, y: 0 },
      type: "grid"
    };
  }

  const normalizedPoint = { x: Number(point.x), y: Number(point.y) };

  // First try vertex snapping (highest priority)
  if (Array.isArray(vertices) && vertices.length > 0) {
    const nearestVertex = findNearestVertex(normalizedPoint, vertices);
    if (nearestVertex && Number.isFinite(nearestVertex.distance) &&
        nearestVertex.distance <= vertexThreshold) {
      return {
        point: nearestVertex.vertex,
        type: "vertex",
        roomId: nearestVertex.roomId
      };
    }
  }

  // Then try edge snapping
  if (Array.isArray(edges) && edges.length > 0) {
    const nearestEdge = findNearestEdgePoint(normalizedPoint, edges);
    if (nearestEdge && Number.isFinite(nearestEdge.distance) &&
        nearestEdge.distance <= edgeThreshold) {
      return {
        point: nearestEdge.point,
        type: "edge",
        roomId: nearestEdge.roomId
      };
    }
  }

  // Then try corner snapping (H∩V intersection — wider threshold, stronger pull)
  if (boundaryTargets) {
    const CORNER_THRESHOLD = edgeThreshold * 1.5;
    const nearestCorner = findNearestCornerPoint(
      normalizedPoint, boundaryTargets.hTargets, boundaryTargets.vTargets, CORNER_THRESHOLD
    );
    if (nearestCorner && nearestCorner.distance <= CORNER_THRESHOLD) {
      return { point: nearestCorner.point, type: "corner" };
    }
  }

  // Then try boundary snapping (envelope/spanning wall faces)
  if (boundaryTargets) {
    const nearestBoundary = findNearestBoundaryPoint(
      normalizedPoint, boundaryTargets.hTargets, boundaryTargets.vTargets, edgeThreshold
    );
    if (nearestBoundary && nearestBoundary.distance <= edgeThreshold) {
      const bp = { ...nearestBoundary.point };

      // When snapping to a boundary, also constrain the free axis to valid angles.
      // H boundary fixes y → constrain x from lastPoint. V boundary fixes x → constrain y.
      if (lastPoint && validAngles && validAngles.length > 0) {
        const dx = bp.x - lastPoint.x;
        const dy = bp.y - lastPoint.y;
        const isHsnap = Math.abs(bp.y - normalizedPoint.y) > Math.abs(bp.x - normalizedPoint.x);

        if (isHsnap) {
          // H boundary locked y — find best valid angle and compute x from it
          const bestAngle = _nearestValidAngle(dx, dy, validAngles);
          const bestRad = bestAngle * Math.PI / 180;
          const sinA = Math.sin(bestRad);
          // If angle is horizontal (sin≈0), x is free; otherwise x = lastPoint.x + dy/tan(angle)
          if (Math.abs(sinA) > 0.01) {
            bp.x = snapToGrid(lastPoint.x + dy / Math.tan(bestRad));
          }
        } else {
          // V boundary locked x — find best valid angle and compute y from it
          const bestAngle = _nearestValidAngle(dx, dy, validAngles);
          const bestRad = bestAngle * Math.PI / 180;
          const cosA = Math.cos(bestRad);
          // If angle is vertical (cos≈0), y is free; otherwise y = lastPoint.y + dx*tan(angle)
          if (Math.abs(cosA) > 0.01) {
            bp.y = snapToGrid(lastPoint.y + dx * Math.tan(bestRad));
          }
        }
      }

      return {
        point: bp,
        type: "boundary"
      };
    }
  }

  // Fall back to grid snapping (with angle constraint in assisted mode)
  return {
    point: snapPoint(normalizedPoint, lastPoint, shiftKey, validAngles),
    type: "grid"
  };
}

/**
 * Creates a polygon drawing controller for floor view
 */
export function createPolygonDrawController({
  getSvg,
  getState,
  commit,
  render,
  getCurrentFloor
}) {
  let isDrawing = false;
  let points = []; // Array of { x, y } in SVG coordinates
  let previewGroup = null;
  let onComplete = null;
  let onCancel = null;
  let continuous = false; // Stay in draw mode after completing a room
  let persistentOnCancel = null; // onCancel preserved across rooms in continuous mode

  // Edge snapping state
  let edgeSnapMode = false; // True when existing rooms exist and we need to snap first two points
  let roomEdges = []; // Cached edges of all rooms
  let roomVertices = []; // Cached vertices of all rooms
  let snapTargetRoomId = null; // Room ID that first point was placed on (second point must be on same room)
  let currentEdgeSnapPoint = null; // Current snapped point for preview
  let currentSnapType = null; // Type of current snap: 'vertex', 'edge', or 'grid'
  let cachedFloor = null; // Cached floor for inside-room checks
  let isMouseInsideRoom = false; // True when mouse is inside an existing room
  let currentMousePoint = null; // Current mouse position for preview
  let roomBoundsPolygon = null; // For room view: restrict clicks to within room polygon
  let assistedMode = false; // True when envelope + calibrated background exist
  let boundaryTargets = { hTargets: [], vTargets: [] }; // Structural boundaries for snapping
  let assistedAngles = null; // Valid angles from envelope (e.g. [0, 90, 180, 270])

  function startDrawing(options) {
    const svg = getSvg();
    if (!svg) return false;

    // Support both function and options object
    if (typeof options === 'function') {
      onComplete = options;
      onCancel = null;
      continuous = false;
      persistentOnCancel = null;
    } else {
      onComplete = options?.onComplete || null;
      onCancel = options?.onCancel || null;
      continuous = !!(options?.continuous);
      persistentOnCancel = continuous ? (options?.onCancel || null) : null;
    }

    isDrawing = true;
    points = [];
    snapTargetRoomId = null;
    currentEdgeSnapPoint = null;
    currentSnapType = null;
    isMouseInsideRoom = false;
    currentMousePoint = null;
    roomBoundsPolygon = options?.roomBoundsPolygon || null;

    // Check if there are existing rooms - if so, enable edge snap mode
    // UNLESS disableEdgeSnap is set (for exclusions which don't need shared edges)
    const floor = getCurrentFloor();
    cachedFloor = floor;
    const hasExistingRooms = floor?.rooms?.length > 0;

    // Assisted mode: enabled by user toggle (requires envelope + calibrated)
    const envelope = floor?.layout?.envelope;
    const calibrated = floor?.layout?.background?.scale?.calibrated;
    assistedMode = !!(envelope && calibrated && floor?.layout?.assistedTracing);
    if (assistedMode) {
      boundaryTargets = computeStructuralBoundaries(envelope);
      if (floor.walls?.length > 0) {
        const roomOuter = computeRoomWallOuterFaces(floor);
        boundaryTargets.hTargets.push(...roomOuter.hTargets);
        boundaryTargets.vTargets.push(...roomOuter.vTargets);
        console.log(`[poly-draw] room outer faces: ${roomOuter.hTargets.length} H + ${roomOuter.vTargets.length} V added`);
      }
      assistedAngles = Array.isArray(envelope.validAngles) && envelope.validAngles.length > 0
        ? envelope.validAngles : null;
      console.log(`[poly-draw] assisted mode: ${boundaryTargets.hTargets.length} H + ${boundaryTargets.vTargets.length} V boundary targets, angles=${JSON.stringify(assistedAngles)}`);
    } else {
      boundaryTargets = { hTargets: [], vTargets: [] };
      assistedAngles = null;
    }

    // In assisted mode: skip forced edge snap, but still cache room geometry
    edgeSnapMode = hasExistingRooms && !options?.disableEdgeSnap && !assistedMode;

    if (edgeSnapMode || (assistedMode && hasExistingRooms)) {
      // Cache all room edges and vertices for snapping
      roomEdges = getRoomEdges(floor);
      roomVertices = getRoomVertices(floor);
    } else {
      roomEdges = [];
      roomVertices = [];
    }

    // Create preview group for visualization
    previewGroup = svgEl("g", { class: "polygon-draw-preview" });
    svg.appendChild(previewGroup);

    // Add hint overlay
    if (assistedMode) {
      updateHint("Trace room inner edges • Shift for 15° • Snapping to envelope + rooms");
    } else if (edgeSnapMode) {
      updateHint("Click on an existing room edge to start • Move along edge to position");
    } else {
      updateHint("Click to place first corner point (Shift for 15° angles)");
    }

    // Change cursor
    svg.classList.add("drawing-polygon");

    // Attach event listeners
    svg.addEventListener("click", handleClick);
    svg.addEventListener("mousemove", handleMouseMove);
    svg.addEventListener("contextmenu", handleRightClick);
    svg.addEventListener("wheel", handleWheel, { passive: true });
    svg.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return true;
  }

  function stopDrawing(cancelled = false) {
    const svg = getSvg();

    isDrawing = false;

    // Reset edge snap state
    edgeSnapMode = false;
    roomEdges = [];
    roomVertices = [];
    snapTargetRoomId = null;
    currentEdgeSnapPoint = null;
    currentSnapType = null;
    cachedFloor = null;
    isMouseInsideRoom = false;
    currentMousePoint = null;
    roomBoundsPolygon = null;
    assistedMode = false;
    boundaryTargets = { hTargets: [], vTargets: [] };
    assistedAngles = null;

    if (previewGroup) {
      previewGroup.remove();
      previewGroup = null;
    }

    if (svg) {
      svg.classList.remove("drawing-polygon");
      svg.removeEventListener("click", handleClick);
      svg.removeEventListener("mousemove", handleMouseMove);
      svg.removeEventListener("contextmenu", handleRightClick);
      svg.removeEventListener("wheel", handleWheel);
      svg.removeEventListener("pointerdown", handlePointerDown);
    }
    document.removeEventListener("keydown", handleKeyDown);
    // Clean up any active panning listeners
    document.removeEventListener("pointermove", handlePanningMove);
    document.removeEventListener("pointerup", handlePanningEnd);

    removeHint();

    if (cancelled) {
      points = [];
      const cancelCb = persistentOnCancel || onCancel;
      if (cancelCb) cancelCb();
    }
    // Always clear callbacks and mode flags
    onComplete = null;
    onCancel = null;
    continuous = false;
    persistentOnCancel = null;
  }

  function handleClick(e) {
    if (!isDrawing) return;

    const svg = getSvg();
    if (!svg) return;

    // Ignore clicks on UI elements
    if (e.target.closest(".quick-controls, button, input, select")) return;

    e.preventDefault();
    e.stopPropagation();

    const svgPoint = pointerToSvgXY(svg, e.clientX, e.clientY);

    // Check if clicking near first point to close
    if (points.length >= MIN_POINTS) {
      const firstPoint = points[0];
      const firstClient = svgPointToClient(svg, firstPoint.x, firstPoint.y);
      const dx = e.clientX - firstClient.x;
      const dy = e.clientY - firstClient.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < CLOSE_THRESHOLD_PX) {
        completePolygon();
        return;
      }
    }

    // Edge snapping for first two points when in edge snap mode
    if (edgeSnapMode && points.length < 2) {
      let edgePoint;

      if (points.length === 0) {
        // First point: snap to any room edge
        const nearest = findNearestEdgePoint(svgPoint, roomEdges);
        if (!nearest) return; // No edges available
        edgePoint = nearest.point;
        snapTargetRoomId = nearest.roomId;
      } else {
        // Second point: must be on same room's edge
        const nearest = findNearestEdgePointOnRoom(svgPoint, roomEdges, snapTargetRoomId);
        if (!nearest) return;
        edgePoint = nearest.point;
      }

      points.push(edgePoint);
      currentEdgeSnapPoint = null;
      updatePreview();

      if (points.length === 1) {
        updateHint("Click on the same room edge for second point • This defines the shared wall");
      } else if (points.length === 2) {
        updateHint("Now draw freely • Shift for 15° angles • Right-click to undo");
      }
      return;
    }

    // Normal snapping for subsequent points - try geometry snap, then grid
    const lastPoint = points.length > 0 ? points[points.length - 1] : null;
    let snappedPoint;
    let snapType = "grid";

    // Use geometry snapping if we have existing rooms or assisted mode
    if ((edgeSnapMode || assistedMode) && (roomVertices.length > 0 || boundaryTargets.hTargets.length > 0 || boundaryTargets.vTargets.length > 0)) {
      const snapResult = snapToRoomGeometry(svgPoint, roomVertices, roomEdges, lastPoint, e.shiftKey,
        VERTEX_SNAP_THRESHOLD_CM, EDGE_SNAP_THRESHOLD_CM, assistedMode ? boundaryTargets : null, assistedAngles);
      snappedPoint = snapResult.point;
      snapType = snapResult.type;
    } else {
      snappedPoint = snapPoint(svgPoint, lastPoint, e.shiftKey, assistedAngles);
    }

    // For room view (exclusions): restrict clicks to within room bounds
    if (roomBoundsPolygon && !isPointInPolygon(snappedPoint, roomBoundsPolygon)) {
      // Point is outside room bounds - don't add it
      return;
    }

    // Reject clicks strictly inside existing rooms (floor view).
    // Points snapped to room geometry (vertex or edge) sit on a boundary and
    // are intentionally allowed — they connect the new room to an existing one.
    if (cachedFloor && snapType === "grid" && isPointInsideAnyRoom(snappedPoint, cachedFloor) !== null) {
      return;
    }

    // Add snapped point
    points.push(snappedPoint);
    currentSnapType = null;
    updatePreview();

    if (points.length === 1) {
      updateHint("Click to add more points • Hold Shift for 15° angles • Right-click to undo");
    } else if (points.length >= MIN_POINTS) {
      updateHint("Click near start to close • Shift for 15° • Right-click to undo • Enter to complete");
    }
  }

  function handleMouseMove(e) {
    if (!isDrawing) return;

    const svg = getSvg();
    if (!svg) return;

    const svgPoint = pointerToSvgXY(svg, e.clientX, e.clientY);

    // Edge snapping mode for first two points
    if (edgeSnapMode && points.length < 2) {
      let nearest;
      if (points.length === 0) {
        // First point: snap to any room edge
        nearest = findNearestEdgePoint(svgPoint, roomEdges);
      } else {
        // Second point: snap only to the same room's edges
        nearest = findNearestEdgePointOnRoom(svgPoint, roomEdges, snapTargetRoomId);
      }

      if (nearest) {
        currentEdgeSnapPoint = nearest.point;
      } else {
        currentEdgeSnapPoint = null;
      }

      updatePreview();
      return;
    }

    // No preview until we have at least one point (for free drawing without edge snap)
    // But allow snapping preview even with 0 points if we have geometry or assisted mode
    if (points.length === 0 && !edgeSnapMode && !assistedMode) return;

    const lastPoint = points.length > 0 ? points[points.length - 1] : null;

    // When we have enough points to close and Shift is held,
    // find a point where BOTH edges are snapped:
    // - Edge from lastPoint to newPoint (snapped angle)
    // - Edge from newPoint to firstPoint (snapped angle)
    let snappedPoint;
    let snapType = "grid";

    // First try geometry snapping if we have existing rooms or assisted mode
    if ((edgeSnapMode || assistedMode) && (roomVertices.length > 0 || boundaryTargets.hTargets.length > 0 || boundaryTargets.vTargets.length > 0)) {
      const snapResult = snapToRoomGeometry(svgPoint, roomVertices, roomEdges, lastPoint, e.shiftKey,
        VERTEX_SNAP_THRESHOLD_CM, EDGE_SNAP_THRESHOLD_CM, assistedMode ? boundaryTargets : null, assistedAngles);
      if (snapResult.type !== "grid") {
        snappedPoint = snapResult.point;
        snapType = snapResult.type;
      }
    }

    if (!snappedPoint) {
      snappedPoint = snapPoint(svgPoint, lastPoint, e.shiftKey, assistedAngles);
    }

    // Mark as inside-room only when NOT snapped to geometry — a snapped vertex
    // or edge point is on a boundary and is a valid placement target.
    currentMousePoint = snappedPoint;
    currentSnapType = snapType;
    isMouseInsideRoom = cachedFloor && snapType === "grid"
      ? isPointInsideAnyRoom(snappedPoint, cachedFloor) !== null
      : false;

    updatePreview(snappedPoint);
  }

  /**
   * Find intersection point of two lines defined by point + angle
   */
  function findLineIntersection(p1, angle1, p2, angle2) {
    const cos1 = Math.cos(angle1);
    const sin1 = Math.sin(angle1);
    const cos2 = Math.cos(angle2);
    const sin2 = Math.sin(angle2);

    // Check if lines are parallel
    const det = cos1 * sin2 - sin1 * cos2;
    if (Math.abs(det) < 0.0001) return null;

    // Solve for intersection
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const t = (dx * sin2 - dy * cos2) / det;

    return {
      x: p1.x + t * cos1,
      y: p1.y + t * sin1
    };
  }

  /**
   * Dual-constraint closing snap: when the polygon is closable, find the point Q
   * where the incoming edge (lastPoint→Q at a valid angle) meets the closing edge
   * (Q→points[0] at a valid angle). Returns the nearest valid Q within DUAL_SNAP_CM,
   * or null if none found.
   *
   * Direction escape: after finding the best Q, verify that the cursor's direction
   * from lastPoint is within ESCAPE_ANGLE_DEG of the direction toward Q. If the
   * user is pulling in a different valid direction (e.g. perpendicular to lay an
   * intermediate edge), the snap releases and returns null.
   * Skipped when cursor is very close to lastPoint (direction is undefined).
   */
  /**
   * Find the best closing corner candidate: the intersection of a valid incoming
   * edge from lastPoint and a valid closing edge from P0, nearest to the cursor.
   * Returns a grid-snapped point or null. No cursor forcing — for display only.
   */
  function _findBestClosingQ(svgPoint, lastPoint, P0, validAngles) {
    const MAX_DIST_CM = 80;
    let bestQ = null;
    let bestDist = Infinity;

    for (const inAngle of validAngles) {
      const inRad = inAngle * Math.PI / 180;
      for (const closeAngle of validAngles) {
        const closeRad = ((closeAngle + 180) % 360) * Math.PI / 180;
        const Q = findLineIntersection(lastPoint, inRad, P0, closeRad);
        if (!Q || !Number.isFinite(Q.x) || !Number.isFinite(Q.y)) continue;
        const dist = Math.hypot(Q.x - svgPoint.x, Q.y - svgPoint.y);
        if (dist < MAX_DIST_CM && dist < bestDist) { bestDist = dist; bestQ = Q; }
      }
    }

    return bestQ ? { x: snapToGrid(bestQ.x), y: snapToGrid(bestQ.y) } : null;
  }

  function handleRightClick(e) {
    if (!isDrawing) return;

    e.preventDefault();
    e.stopPropagation();

    if (points.length > 0) {
      // Remove last point
      points.pop();

      // Reset edge snap state if we're back to needing first point
      if (edgeSnapMode) {
        if (points.length === 0) {
          snapTargetRoomId = null;
          updateHint("Click on an existing room edge to start • Move along edge to position");
        } else if (points.length === 1) {
          updateHint("Click on the same room edge for second point • This defines the shared wall");
        }
      } else {
        if (points.length === 0) {
          updateHint("Click to place first corner point");
        } else if (points.length < MIN_POINTS) {
          updateHint("Click to add more points • Right-click or Escape to cancel");
        }
      }

      updatePreview();
    } else {
      // Cancel drawing
      stopDrawing(true);
    }
  }

  function handleWheel() {
    if (!isDrawing) return;
    // After wheel zoom, the render cycle clears the SVG and removes our previewGroup.
    // Schedule updatePreview after the zoom-pan controller finishes its render.
    requestAnimationFrame(() => {
      updatePreview(currentMousePoint);
    });
  }

  function handlePointerDown(e) {
    if (!isDrawing) return;
    // Middle mouse button starts panning - we need to keep preview alive during pan
    if (e.button === 1) {
      document.addEventListener("pointermove", handlePanningMove);
      document.addEventListener("pointerup", handlePanningEnd);
    }
  }

  function handlePanningMove() {
    if (!isDrawing) return;
    // During panning, the render cycle clears the SVG and removes our previewGroup.
    // Use requestAnimationFrame to redraw after the zoom-pan controller finishes its render.
    requestAnimationFrame(() => {
      updatePreview(currentMousePoint);
    });
  }

  function handlePanningEnd(e) {
    if (e.button === 1) {
      document.removeEventListener("pointermove", handlePanningMove);
      document.removeEventListener("pointerup", handlePanningEnd);
      // Final update after panning ends
      requestAnimationFrame(() => {
        updatePreview(currentMousePoint);
      });
    }
  }

  function handleKeyDown(e) {
    if (!isDrawing) return;

    if (e.key === "Escape") {
      e.preventDefault();
      stopDrawing(true);
    } else if (e.key === "Enter" && points.length >= MIN_POINTS) {
      e.preventDefault();
      completePolygon();
    } else if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      if (points.length > 0) {
        points.pop();
        updatePreview();
      }
    }
  }

  // Append a dimension label for an edge (p1→p2) to group.
  // Label sits at the midpoint, offset 8cm perpendicular to the edge, rotated to match the edge.
  function _addEdgeLengthLabel(group, p1, p2) {
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.5) return;
    const mx = (p1.x + p2.x) / 2;
    const my = (p1.y + p2.y) / 2;
    const nx = -dy / len, ny = dx / len;
    const offset = 8;
    const x = mx + nx * offset;
    const y = my + ny * offset;
    let angle = Math.atan2(dy, dx) * 180 / Math.PI;
    if (angle > 90) angle -= 180;
    else if (angle < -90) angle += 180;
    const text = `${Number(len.toFixed(1))} cm`;
    const g = svgEl("g");
    if (angle) g.setAttribute("transform", `rotate(${angle} ${x} ${y})`);
    const t = svgEl("text", {
      x, y,
      fill: "rgba(231,238,252,0.95)",
      stroke: "rgba(20,20,20,0.75)",
      "stroke-width": 3,
      "paint-order": "stroke fill",
      "font-size": 9,
      "font-family": "system-ui, -apple-system, Segoe UI, Roboto, Arial",
      "text-anchor": "middle",
      "dominant-baseline": "middle"
    });
    t.textContent = text;
    g.appendChild(t);
    group.appendChild(g);
  }

  function updatePreview(mousePoint = null) {
    if (!isDrawing) return;

    const svg = getSvg();
    if (!svg) return;

    // Check if previewGroup was removed (e.g., by a render cycle during scroll/zoom)
    // If so, re-create and re-attach it
    if (!previewGroup || !previewGroup.parentNode) {
      previewGroup = svgEl("g", { class: "polygon-draw-preview" });
      svg.appendChild(previewGroup);
    }

    // Clear previous preview
    previewGroup.innerHTML = "";

    // Edge snap mode preview (before any points or with one point)
    if (edgeSnapMode && points.length < 2 && currentEdgeSnapPoint) {
      // Draw the edge snap marker
      const snapCircle = svgEl("circle", {
        cx: currentEdgeSnapPoint.x,
        cy: currentEdgeSnapPoint.y,
        r: 7, fill: "#22c55e", "fill-opacity": 0.2,
        stroke: "#22c55e", "stroke-width": 1.5, "stroke-opacity": 0.8,
        class: "edge-snap-marker"
      });
      previewGroup.appendChild(snapCircle);

      // If we have one point, draw line from first point to snap point
      if (points.length === 1) {
        const linePath = svgEl("path", {
          d: `M ${points[0].x} ${points[0].y} L ${currentEdgeSnapPoint.x} ${currentEdgeSnapPoint.y}`,
          fill: "none",
          stroke: "#22c55e",
          "stroke-width": 2,
          "stroke-dasharray": "5,5"
        });
        previewGroup.appendChild(linePath);
        _addEdgeLengthLabel(previewGroup, points[0], currentEdgeSnapPoint);

        // Draw first point
        const firstCircle = svgEl("circle", {
          cx: points[0].x,
          cy: points[0].y,
          r: 6,
          fill: "#22c55e",
          stroke: "#fff",
          "stroke-width": 2
        });
        previewGroup.appendChild(firstCircle);
      }
      return;
    }

    // When no points placed yet, show only the snap indicator so the user
    // can see where the first click will land (critical in assisted mode).
    if (points.length === 0) {
      if (mousePoint && (assistedMode || edgeSnapMode || roomVertices.length > 0)) {
        const isSnapped = currentSnapType === "vertex" || currentSnapType === "edge";
        const isBoundary = currentSnapType === "boundary";
        const isCorner = currentSnapType === "corner";
        const snapColor = isCorner ? "#eab308" : isBoundary ? "#f97316" : isSnapped ? "#22c55e" : "#3b82f6";
        previewGroup.appendChild(svgEl("circle", {
          cx: mousePoint.x, cy: mousePoint.y,
          r: 7, fill: snapColor, "fill-opacity": 0.2,
          stroke: snapColor, "stroke-width": 1.5, "stroke-opacity": 0.8
        }));
        if (isCorner) {
          const arm = 11;
          previewGroup.appendChild(svgEl("path", {
            d: `M ${mousePoint.x - arm} ${mousePoint.y} L ${mousePoint.x + arm} ${mousePoint.y} M ${mousePoint.x} ${mousePoint.y - arm} L ${mousePoint.x} ${mousePoint.y + arm}`,
            stroke: snapColor, "stroke-width": 1.5, fill: "none", opacity: 0.8
          }));
        }
      }
      return;
    }

    // Draw lines between points
    const allPoints = [...points];
    if (mousePoint) {
      allPoints.push(mousePoint);
    }

    // Draw polygon outline
    if (allPoints.length >= 2) {
      const pathParts = allPoints.map((p, i) =>
        `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`
      );

      // Add closing line preview if we have enough points
      if (points.length >= MIN_POINTS && mousePoint) {
        pathParts.push(`L ${points[0].x} ${points[0].y}`);
      }

      const linePath = svgEl("path", {
        d: pathParts.join(" "),
        fill: "none",
        stroke: "#3b82f6",
        "stroke-width": 2,
        "stroke-dasharray": "5,5"
      });
      previewGroup.appendChild(linePath);
    }

    // Edge length labels: committed edges, live edge, and closing-edge preview
    for (let i = 0; i < points.length - 1; i++) {
      _addEdgeLengthLabel(previewGroup, points[i], points[i + 1]);
    }
    if (mousePoint && points.length >= 1) {
      _addEdgeLengthLabel(previewGroup, points[points.length - 1], mousePoint);
    }
    if (points.length >= MIN_POINTS && mousePoint) {
      _addEdgeLengthLabel(previewGroup, mousePoint, points[0]);
    }

    // Draw filled polygon preview if closing
    if (points.length >= MIN_POINTS) {
      const closedPath = points.map((p, i) =>
        `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`
      ).join(" ") + " Z";

      const fillPath = svgEl("path", {
        d: closedPath,
        fill: "rgba(59, 130, 246, 0.15)",
        stroke: "none"
      });
      previewGroup.insertBefore(fillPath, previewGroup.firstChild);
    }

    // Ghost closing-corner indicator: show where the polygon can close with valid
    // angles on both the incoming and closing edge. Visual guide only — no cursor forcing.
    if (points.length >= MIN_POINTS && mousePoint && assistedAngles?.length > 0) {
      const lastPt = points[points.length - 1];
      const ghostQ = _findBestClosingQ(mousePoint, lastPt, points[0], assistedAngles);
      if (ghostQ) {
        previewGroup.appendChild(svgEl("circle", {
          cx: ghostQ.x, cy: ghostQ.y,
          r: 7, fill: "#22c55e", "fill-opacity": 0.1,
          stroke: "#22c55e", "stroke-width": 1, "stroke-dasharray": "3,2", "stroke-opacity": 0.5
        }));
        const arm = 5;
        previewGroup.appendChild(svgEl("path", {
          d: `M ${ghostQ.x - arm} ${ghostQ.y} L ${ghostQ.x + arm} ${ghostQ.y} M ${ghostQ.x} ${ghostQ.y - arm} L ${ghostQ.x} ${ghostQ.y + arm}`,
          stroke: "#22c55e", "stroke-width": 1, "stroke-opacity": 0.5, fill: "none"
        }));
      }
    }

    // Draw vertex circles
    points.forEach((p, i) => {
      const isFirst = i === 0;
      // First two points in edge snap mode are green (shared edge)
      const isSharedEdge = edgeSnapMode && i < 2;
      const circle = svgEl("circle", {
        cx: p.x,
        cy: p.y,
        r: isFirst && points.length >= MIN_POINTS ? 8 : 5,
        fill: isSharedEdge ? "#22c55e" : (isFirst ? "#22c55e" : "#3b82f6"),
        stroke: "#fff",
        "stroke-width": 2,
        class: isFirst ? "close-target" : ""
      });
      previewGroup.appendChild(circle);
    });

    // Draw mouse position marker
    if (mousePoint) {
      const isInvalid = isMouseInsideRoom;
      const isSnapped = currentSnapType === "vertex" || currentSnapType === "edge";
      const isBoundary = currentSnapType === "boundary";
      const isCorner = currentSnapType === "corner";

      // Unified snap color — ring style so cursor crosshair stays visible
      const snapColor = isInvalid ? "#ef4444"
        : isCorner    ? "#eab308"
        : isBoundary  ? "#f97316"
        : isSnapped   ? "#22c55e"
        :               "#3b82f6";

      previewGroup.appendChild(svgEl("circle", {
        cx: mousePoint.x, cy: mousePoint.y,
        r: 7, fill: snapColor, "fill-opacity": 0.2,
        stroke: snapColor, "stroke-width": 1.5, "stroke-opacity": 0.8
      }));

      // Crosshair lines for corner snaps (both axes locked)
      if (isCorner) {
        const arm = 11;
        previewGroup.appendChild(svgEl("path", {
          d: `M ${mousePoint.x - arm} ${mousePoint.y} L ${mousePoint.x + arm} ${mousePoint.y} M ${mousePoint.x} ${mousePoint.y - arm} L ${mousePoint.x} ${mousePoint.y + arm}`,
          stroke: snapColor, "stroke-width": 1.5, fill: "none", opacity: 0.8
        }));
      }
    }
  }

  function updateHint(text) {
    let hintEl = document.getElementById("polygonDrawHint");
    if (!hintEl) {
      hintEl = document.createElement("div");
      hintEl.id = "polygonDrawHint";
      hintEl.className = "polygon-draw-hint";
      document.querySelector(".svgWrap.planning-svg")?.appendChild(hintEl);
    }
    hintEl.textContent = text;
  }

  function removeHint() {
    const hintEl = document.getElementById("polygonDrawHint");
    if (hintEl) hintEl.remove();
  }

  function _refreshSnapCache() {
    const floor = getCurrentFloor?.();
    if (!floor) return;
    cachedFloor = floor;
    if (assistedMode || edgeSnapMode) {
      roomEdges = getRoomEdges(floor);
      roomVertices = getRoomVertices(floor);
    }
    if (assistedMode) {
      const envelope = floor?.layout?.envelope;
      boundaryTargets = computeStructuralBoundaries(envelope);
      if (floor.walls?.length > 0) {
        const roomOuter = computeRoomWallOuterFaces(floor);
        boundaryTargets.hTargets.push(...roomOuter.hTargets);
        boundaryTargets.vTargets.push(...roomOuter.vTargets);
      }
      console.log(`[poly-draw] snap cache refreshed: ${boundaryTargets.hTargets.length}H + ${boundaryTargets.vTargets.length}V targets, ${roomVertices.length} room vertices`);
    }
  }

  function completePolygon() {
    if (points.length < MIN_POINTS) return;

    const polygonPoints = [...points];
    const callback = onComplete;

    if (continuous) {
      // Reset draw state, fire callback (commits new room), then refresh snap cache
      points = [];
      snapTargetRoomId = null;
      currentEdgeSnapPoint = null;
      currentSnapType = null;
      isMouseInsideRoom = false;
      currentMousePoint = null;
      if (callback) callback(polygonPoints);
      _refreshSnapCache();
      updateHint(assistedMode
        ? "Trace room inner edges • Shift for 15° • Snapping to envelope + rooms"
        : "Click to place first corner point (Shift for 15° angles)");
      updatePreview(null);
    } else {
      stopDrawing();
      if (callback) callback(polygonPoints);
    }
  }

  /**
   * Convert drawn polygon to a room
   */
  function createRoomFromPolygon(polygonPoints) {
    if (!polygonPoints || polygonPoints.length < MIN_POINTS) return null;

    let minX = Infinity, minY = Infinity;
    for (const p of polygonPoints) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
    }

    const localVertices = polygonPoints.map(p => ({
      x: Math.round(p.x - minX),
      y: Math.round(p.y - minY),
    }));

    return createSurface({
      name: t("room.newRoom") || "New Room",
      polygonVertices: localVertices,
      floorPosition: { x: Math.round(minX), y: Math.round(minY) },
    });
  }

  return {
    startDrawing,
    stopDrawing,
    isDrawing: () => isDrawing,
    createRoomFromPolygon
  };
}
