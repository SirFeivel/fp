// src/polygon-draw.js
// Controller for drawing room polygons by clicking vertices

import { svgEl, roomPolygon } from "./geometry.js";
import { t } from "./i18n.js";
import { createSurface } from "./surface.js";
import { pointerToSvgXY, svgPointToClient } from "./svg-coords.js";

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
 * Check if a point is inside a polygon using ray casting algorithm
 */
function isPointInPolygon(point, polygon) {
  let inside = false;
  const n = polygon.length;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];

    if (((yi > point.y) !== (yj > point.y)) &&
        (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }

  return inside;
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
 * Snap a point to the grid, optionally constraining angle to 45° increments
 */
function snapPoint(point, lastPoint, shiftKey) {
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
  }

  return snapped;
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
  edgeThreshold = EDGE_SNAP_THRESHOLD_CM
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

  // Fall back to grid snapping
  return {
    point: snapPoint(normalizedPoint, lastPoint, shiftKey),
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

  function startDrawing(options) {
    const svg = getSvg();
    if (!svg) return false;

    // Support both function and options object
    if (typeof options === 'function') {
      onComplete = options;
      onCancel = null;
    } else {
      onComplete = options?.onComplete || null;
      onCancel = options?.onCancel || null;
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
    edgeSnapMode = hasExistingRooms && !options?.disableEdgeSnap;

    if (edgeSnapMode) {
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
    if (edgeSnapMode) {
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
      // Call onCancel callback if provided
      if (onCancel) {
        onCancel();
      }
    }
    // Always clear callbacks
    onComplete = null;
    onCancel = null;
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

    // Use geometry snapping if we have existing rooms
    if (edgeSnapMode && roomVertices.length > 0) {
      const snapResult = snapToRoomGeometry(svgPoint, roomVertices, roomEdges, lastPoint, e.shiftKey);
      snappedPoint = snapResult.point;
    } else {
      snappedPoint = snapPoint(svgPoint, lastPoint, e.shiftKey);
    }

    // For room view (exclusions): restrict clicks to within room bounds
    if (roomBoundsPolygon && !isPointInPolygon(snappedPoint, roomBoundsPolygon)) {
      // Point is outside room bounds - don't add it
      return;
    }

    // Reject clicks inside existing rooms (floor view)
    if (cachedFloor && isPointInsideAnyRoom(snappedPoint, cachedFloor) !== null) {
      // Point is inside a room - don't add it
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
    // But allow snapping preview even with 0 points if we have geometry
    if (points.length === 0 && !edgeSnapMode) return;

    const lastPoint = points.length > 0 ? points[points.length - 1] : null;

    // When we have enough points to close and Shift is held,
    // find a point where BOTH edges are snapped:
    // - Edge from lastPoint to newPoint (snapped angle)
    // - Edge from newPoint to firstPoint (snapped angle)
    let snappedPoint;
    let snapType = "grid";

    // First try geometry snapping if we have existing rooms
    if (edgeSnapMode && roomVertices.length > 0) {
      const snapResult = snapToRoomGeometry(svgPoint, roomVertices, roomEdges, lastPoint, e.shiftKey);
      if (snapResult.type !== "grid") {
        snappedPoint = snapResult.point;
        snapType = snapResult.type;
      }
    }

    // If no geometry snap, use angle constraint or grid snap
    if (!snappedPoint) {
      // Shift snaps angle to previous point only - no dual-constraint
      // To close the polygon, click near the first point
      snappedPoint = snapPoint(svgPoint, lastPoint, e.shiftKey);
    }

    // Check if the snapped point is inside any existing room
    currentMousePoint = snappedPoint;
    currentSnapType = snapType;
    isMouseInsideRoom = cachedFloor ? isPointInsideAnyRoom(snappedPoint, cachedFloor) !== null : false;

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
      // Draw the edge snap marker (green circle)
      const snapCircle = svgEl("circle", {
        cx: currentEdgeSnapPoint.x,
        cy: currentEdgeSnapPoint.y,
        r: 8,
        fill: "#22c55e",
        stroke: "#fff",
        "stroke-width": 2,
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

    if (points.length === 0) return;

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
      // Show red marker if inside a room, green if snapped to geometry, blue otherwise
      const isInvalid = isMouseInsideRoom;
      const isSnapped = currentSnapType === "vertex" || currentSnapType === "edge";

      // Choose appearance based on state
      let fillColor, strokeColor, radius, strokeWidth;
      if (isInvalid) {
        fillColor = "rgba(239, 68, 68, 0.7)";
        strokeColor = "#dc2626";
        radius = 6;
        strokeWidth = 2;
      } else if (isSnapped) {
        // Green marker for geometry snaps
        fillColor = "#22c55e";
        strokeColor = "#fff";
        radius = currentSnapType === "vertex" ? 8 : 6;
        strokeWidth = 2;
      } else {
        fillColor = "rgba(59, 130, 246, 0.5)";
        strokeColor = "#3b82f6";
        radius = 4;
        strokeWidth = 1;
      }

      const mouseCircle = svgEl("circle", {
        cx: mousePoint.x,
        cy: mousePoint.y,
        r: radius,
        fill: fillColor,
        stroke: strokeColor,
        "stroke-width": strokeWidth
      });
      previewGroup.appendChild(mouseCircle);

      // Add snap type indicator for vertex snaps (diamond shape)
      if (currentSnapType === "vertex") {
        const diamond = svgEl("path", {
          d: `M ${mousePoint.x} ${mousePoint.y - 12} L ${mousePoint.x + 5} ${mousePoint.y - 7} L ${mousePoint.x} ${mousePoint.y - 2} L ${mousePoint.x - 5} ${mousePoint.y - 7} Z`,
          fill: "#22c55e",
          stroke: "#fff",
          "stroke-width": 1
        });
        previewGroup.appendChild(diamond);
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

  function completePolygon() {
    if (points.length < MIN_POINTS) return;

    const polygonPoints = [...points];
    const callback = onComplete;

    stopDrawing();

    if (callback) {
      callback(polygonPoints);
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
