// src/polygon-draw.js
// Controller for drawing room polygons by clicking vertices

import { svgEl, roomPolygon } from "./geometry.js";
import { uuid } from "./core.js";
import { t } from "./i18n.js";

const MIN_POINTS = 3;
const CLOSE_THRESHOLD_PX = 15; // Pixels to detect closing click on first point
const SNAP_GRID_CM = 0.5; // Grid snap increment in cm

/**
 * Get all edges of existing rooms in floor coordinates
 * Returns array of { roomId, edge: { p1: {x,y}, p2: {x,y} } }
 */
function getRoomEdges(floor) {
  const edges = [];
  if (!floor?.rooms) return edges;

  for (const room of floor.rooms) {
    const pos = room.floorPosition || { x: 0, y: 0 };

    // Get room polygon (handles both freeform and sections-based rooms)
    const mp = roomPolygon(room);
    if (!mp || mp.length === 0) continue;

    // Extract edges from the polygon
    // MultiPolygon format: [Polygon[Ring[Point]]]
    for (const polygon of mp) {
      for (const ring of polygon) {
        for (let i = 0; i < ring.length - 1; i++) {
          const p1 = { x: ring[i][0] + pos.x, y: ring[i][1] + pos.y };
          const p2 = { x: ring[i + 1][0] + pos.x, y: ring[i + 1][1] + pos.y };
          edges.push({ roomId: room.id, edge: { p1, p2 } });
        }
      }
    }
  }

  return edges;
}

/**
 * Find the closest point on a line segment to a given point
 */
function closestPointOnSegment(point, p1, p2) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    // Segment is a point
    return { x: p1.x, y: p1.y, t: 0 };
  }

  // Project point onto line, clamped to segment
  let t = ((point.x - p1.x) * dx + (point.y - p1.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  return {
    x: p1.x + t * dx,
    y: p1.y + t * dy,
    t
  };
}

/**
 * Find the nearest point on any room edge to the mouse position
 * Returns { point: {x,y}, roomId, edge, distance } or null
 */
function findNearestEdgePoint(mousePoint, edges) {
  let nearest = null;
  let minDist = Infinity;

  for (const { roomId, edge } of edges) {
    const closest = closestPointOnSegment(mousePoint, edge.p1, edge.p2);
    const dist = Math.hypot(closest.x - mousePoint.x, closest.y - mousePoint.y);

    if (dist < minDist) {
      minDist = dist;
      nearest = {
        point: { x: closest.x, y: closest.y },
        roomId,
        edge,
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
 */
function snapToGrid(value, gridSize = SNAP_GRID_CM) {
  return Math.round(value / gridSize) * gridSize;
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

  // Edge snapping state
  let edgeSnapMode = false; // True when existing rooms exist and we need to snap first two points
  let roomEdges = []; // Cached edges of all rooms
  let snapTargetRoomId = null; // Room ID that first point was placed on (second point must be on same room)
  let currentEdgeSnapPoint = null; // Current snapped point for preview
  let cachedFloor = null; // Cached floor for inside-room checks
  let isMouseInsideRoom = false; // True when mouse is inside an existing room
  let currentMousePoint = null; // Current mouse position for preview

  function pointerToSvgXY(svg, clientX, clientY) {
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const inv = ctm.inverse();
    const p = pt.matrixTransform(inv);
    return { x: p.x, y: p.y };
  }

  function startDrawing(completeCb) {
    const svg = getSvg();
    if (!svg) return false;

    isDrawing = true;
    points = [];
    onComplete = completeCb;
    snapTargetRoomId = null;
    currentEdgeSnapPoint = null;
    isMouseInsideRoom = false;
    currentMousePoint = null;

    // Check if there are existing rooms - if so, enable edge snap mode
    const floor = getCurrentFloor();
    cachedFloor = floor;
    const hasExistingRooms = floor?.rooms?.length > 0;
    edgeSnapMode = hasExistingRooms;

    if (edgeSnapMode) {
      // Cache all room edges for snapping
      roomEdges = getRoomEdges(floor);
    } else {
      roomEdges = [];
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
    document.addEventListener("keydown", handleKeyDown);

    return true;
  }

  function stopDrawing(cancelled = false) {
    const svg = getSvg();

    isDrawing = false;

    // Reset edge snap state
    edgeSnapMode = false;
    roomEdges = [];
    snapTargetRoomId = null;
    currentEdgeSnapPoint = null;
    cachedFloor = null;
    isMouseInsideRoom = false;
    currentMousePoint = null;

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
    }
    document.removeEventListener("keydown", handleKeyDown);

    removeHint();

    if (cancelled) {
      points = [];
      onComplete = null;
    }
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
      const dx = e.clientX - svgToClientX(svg, firstPoint.x);
      const dy = e.clientY - svgToClientY(svg, firstPoint.y);
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

    // Normal snapping for subsequent points
    const lastPoint = points.length > 0 ? points[points.length - 1] : null;
    const snappedPoint = snapPoint(svgPoint, lastPoint, e.shiftKey);

    // Reject clicks inside existing rooms
    if (cachedFloor && isPointInsideAnyRoom(snappedPoint, cachedFloor) !== null) {
      // Point is inside a room - don't add it
      return;
    }

    // Add snapped point
    points.push(snappedPoint);
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

    // No preview until we have at least one point
    if (points.length === 0) return;

    const lastPoint = points[points.length - 1];

    // When we have enough points to close and Shift is held,
    // find a point where BOTH edges are snapped:
    // - Edge from lastPoint to newPoint (snapped angle)
    // - Edge from newPoint to firstPoint (snapped angle)
    let snappedPoint;
    if (e.shiftKey && points.length >= MIN_POINTS) {
      const firstPoint = points[0];

      // Calculate snapped angles from both endpoints toward the mouse
      const angleFromLast = Math.atan2(svgPoint.y - lastPoint.y, svgPoint.x - lastPoint.x);
      const snappedAngleFromLast = Math.round(angleFromLast / (Math.PI / 12)) * (Math.PI / 12);

      const angleFromFirst = Math.atan2(svgPoint.y - firstPoint.y, svgPoint.x - firstPoint.x);
      const snappedAngleFromFirst = Math.round(angleFromFirst / (Math.PI / 12)) * (Math.PI / 12);

      // Find intersection of two lines:
      // Line 1: from lastPoint at snappedAngleFromLast
      // Line 2: from firstPoint at snappedAngleFromFirst
      const intersection = findLineIntersection(
        lastPoint, snappedAngleFromLast,
        firstPoint, snappedAngleFromFirst
      );

      if (intersection) {
        snappedPoint = {
          x: snapToGrid(intersection.x),
          y: snapToGrid(intersection.y)
        };
      } else {
        // Lines are parallel, fall back to normal snap
        snappedPoint = snapPoint(svgPoint, lastPoint, true);
      }
    } else {
      snappedPoint = snapPoint(svgPoint, lastPoint, e.shiftKey);
    }

    // Check if the snapped point is inside any existing room
    currentMousePoint = snappedPoint;
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
      updatePreview();
    });
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

  function svgToClientX(svg, svgX) {
    const ctm = svg.getScreenCTM();
    if (!ctm) return 0;
    const pt = svg.createSVGPoint();
    pt.x = svgX;
    pt.y = 0;
    return pt.matrixTransform(ctm).x;
  }

  function svgToClientY(svg, svgY) {
    const ctm = svg.getScreenCTM();
    if (!ctm) return 0;
    const pt = svg.createSVGPoint();
    pt.x = 0;
    pt.y = svgY;
    return pt.matrixTransform(ctm).y;
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
      // Show red marker if inside a room, blue otherwise
      const isInvalid = isMouseInsideRoom;
      const mouseCircle = svgEl("circle", {
        cx: mousePoint.x,
        cy: mousePoint.y,
        r: isInvalid ? 6 : 4,
        fill: isInvalid ? "rgba(239, 68, 68, 0.7)" : "rgba(59, 130, 246, 0.5)",
        stroke: isInvalid ? "#dc2626" : "#3b82f6",
        "stroke-width": isInvalid ? 2 : 1
      });
      previewGroup.appendChild(mouseCircle);
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
   * Convert drawn polygon to room with sections
   */
  function createRoomFromPolygon(polygonPoints) {
    if (!polygonPoints || polygonPoints.length < MIN_POINTS) return null;

    // Calculate bounding box
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;

    for (const p of polygonPoints) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }

    const width = maxX - minX;
    const height = maxY - minY;

    // For now, create a room with widthCm/heightCm matching the bounding box
    // and store the polygon vertices for future rendering
    // The sections-based approach would need to decompose the polygon into rectangles

    const room = {
      id: uuid(),
      name: t("room.newRoom") || "New Room",
      widthCm: Math.round(width),
      heightCm: Math.round(height),
      exclusions: [],
      tile: { widthCm: 60, heightCm: 30, shape: "rect" },
      grout: { widthCm: 0.3, color: "#999999" },
      pattern: { type: "grid", offsetPercent: 50, angle: 0, startCorner: "topLeft" },
      floorPosition: { x: Math.round(minX), y: Math.round(minY) },
      // Store polygon vertices relative to floorPosition
      polygonVertices: polygonPoints.map(p => ({
        x: Math.round(p.x - minX),
        y: Math.round(p.y - minY)
      }))
    };

    return room;
  }

  return {
    startDrawing,
    stopDrawing,
    isDrawing: () => isDrawing,
    createRoomFromPolygon
  };
}
