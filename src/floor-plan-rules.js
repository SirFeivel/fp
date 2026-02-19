// src/floor-plan-rules.js — Floor plan validation rules and polygon rectification
//
// Defines what a valid floor plan looks like in an editable config,
// and provides functions to enforce it at the polygon level (before
// rooms and walls are created).

/**
 * Editable config defining floor plan conventions.
 * Every validation/rectification function reads from this.
 */
export const FLOOR_PLAN_RULES = {
  // --- Edge angle rules ---
  // Standard angles that room edges follow (degrees).
  standardAngles: [0, 90, 180, 270],
  // Max deviation (degrees) from a standard angle before snapping.
  maxAngleDeviationDeg: 10,

  // --- Edge length rules ---
  // Edges shorter than this (cm) are detection noise — removed.
  minEdgeLengthCm: 5,

  // --- Wall thickness rules ---
  wallThickness: {
    minCm: 5,
    maxCm: 50,
  },

  // --- Cross-room alignment ---
  // Edges on nearly the same line (within this tolerance) are aligned.
  alignmentToleranceCm: 6,

  // --- Gap rules ---
  // Max gap between collinear wall segments as a factor of wall thickness.
  // Gaps within this are merged; gaps beyond are separate walls.
  mergeGapFactor: 1.5,
};

/**
 * Round to 1 decimal place (0.1 cm precision).
 */
function round1(v) {
  return Math.round(v * 10) / 10;
}

/**
 * Snap a detected polygon to axis-aligned edges and remove noise.
 *
 * Algorithm:
 *   1. Classify each edge as H (horizontal), V (vertical), or diagonal
 *      based on whether its angle is within maxAngleDeviationDeg of a
 *      standard angle.
 *   2. Remove edges shorter than minEdgeLengthCm (detection noise).
 *   3. Assign each remaining H edge a canonical Y (midpoint of endpoints)
 *      and each V edge a canonical X (midpoint of endpoints).
 *   4. Rebuild vertices at the intersection of consecutive edge constraints.
 *   5. Merge consecutive collinear vertices (same axis).
 *
 * @param {Array<{x: number, y: number}>} vertices - Room-local polygon vertices
 * @param {Object} [rules] - Floor plan rules (defaults to FLOOR_PLAN_RULES)
 * @returns {Array<{x: number, y: number}>} Rectified vertices
 */
export function rectifyPolygon(vertices, rules = FLOOR_PLAN_RULES) {
  if (!vertices || vertices.length < 3) return vertices;

  const n = vertices.length;

  // Step 1: Classify each edge
  const edges = [];
  for (let i = 0; i < n; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    const angleDeg = ((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360;

    let type = null; // H, V, or null (diagonal)
    let axisValue = null;

    for (const std of rules.standardAngles) {
      let dev = angleDeg - std;
      if (dev > 180) dev -= 360;
      if (dev < -180) dev += 360;
      if (Math.abs(dev) <= rules.maxAngleDeviationDeg) {
        if (std === 0 || std === 180) {
          type = "H";
          axisValue = (a.y + b.y) / 2;
        } else {
          type = "V";
          axisValue = (a.x + b.x) / 2;
        }
        break;
      }
    }

    edges.push({ idx: i, type, axisValue, len });
  }

  // Step 2: Remove noise edges — short AND diagonal (not snappable).
  // Short axis-aligned edges (e.g. a 4cm vertical step) are real features.
  const kept = [];
  for (let i = 0; i < n; i++) {
    const e = edges[i];
    if (e.len >= rules.minEdgeLengthCm || e.type !== null) {
      kept.push(e);
    }
  }

  if (kept.length < 3) return vertices;

  // Step 3: Rebuild vertices at intersections of consecutive edges
  const rebuilt = [];
  const m = kept.length;
  for (let j = 0; j < m; j++) {
    const prev = kept[(j - 1 + m) % m];
    const curr = kept[j];
    const origVtx = vertices[curr.idx];

    if (prev.type === "H" && curr.type === "V") {
      rebuilt.push({ x: round1(curr.axisValue), y: round1(prev.axisValue) });
    } else if (prev.type === "V" && curr.type === "H") {
      rebuilt.push({ x: round1(prev.axisValue), y: round1(curr.axisValue) });
    } else if (prev.type === "H" && curr.type === "H") {
      // Two consecutive horizontal edges — keep original X, use prev's Y
      rebuilt.push({ x: round1(origVtx.x), y: round1(prev.axisValue) });
    } else if (prev.type === "V" && curr.type === "V") {
      // Two consecutive vertical edges — use curr's X, keep original Y
      rebuilt.push({ x: round1(curr.axisValue), y: round1(origVtx.y) });
    } else {
      // Diagonal edge involved — keep original vertex
      rebuilt.push({ x: round1(origVtx.x), y: round1(origVtx.y) });
    }
  }

  // Step 4: Merge consecutive collinear vertices
  // A vertex is redundant if it lies on the same line as its neighbors
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < rebuilt.length && rebuilt.length > 3; i++) {
      const a = rebuilt[(i - 1 + rebuilt.length) % rebuilt.length];
      const b = rebuilt[i];
      const c = rebuilt[(i + 1) % rebuilt.length];

      // Collinear on horizontal line
      if (Math.abs(a.y - b.y) < 0.2 && Math.abs(b.y - c.y) < 0.2) {
        rebuilt.splice(i, 1);
        changed = true;
        break;
      }
      // Collinear on vertical line
      if (Math.abs(a.x - b.x) < 0.2 && Math.abs(b.x - c.x) < 0.2) {
        rebuilt.splice(i, 1);
        changed = true;
        break;
      }
    }
  }

  return rebuilt;
}

/**
 * Expand an axis-aligned polygon outward by a uniform distance.
 *
 * Detection traces the INNER room boundary. Expanding outward by half the
 * detected wall thickness places each edge at the wall centerline, so
 * adjacent rooms share edges and wall merging works naturally.
 *
 * Algorithm (axis-aligned only — requires rectifyPolygon first):
 *   1. Compute signed area to determine polygon winding.
 *   2. For each edge, compute outward normal (perpendicular away from interior).
 *   3. Offset each H edge's Y and each V edge's X by ±d.
 *   4. Recompute vertices as intersections of adjacent offset edges.
 *
 * @param {Array<{x: number, y: number}>} vertices - Axis-aligned polygon (floor-global cm)
 * @param {number} expansionCm - Distance to expand outward (typically wallThickness / 2)
 * @returns {Array<{x: number, y: number}>} Expanded polygon
 */
export function expandPolygonOutward(vertices, expansionCm) {
  if (!vertices || vertices.length < 3 || expansionCm <= 0) return vertices;

  const n = vertices.length;
  const d = expansionCm;

  // Signed area (shoelace) — positive means CW in screen coords (y-down)
  let signedArea2 = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    signedArea2 += vertices[i].x * vertices[j].y - vertices[j].x * vertices[i].y;
  }
  const sign = signedArea2 > 0 ? 1 : -1;

  // For each edge, compute the offset axis value.
  // Outward normal for sign>0: (dy/len, -dx/len); for sign<0: (-dy/len, dx/len)
  const edgeOffsets = [];
  for (let i = 0; i < n; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);

    if (Math.abs(dy) < 0.5 && len > 0.5) {
      // Horizontal edge — outward shifts Y
      const yShift = sign * (-dx / len) * d;
      edgeOffsets.push({ type: "H", value: round1((a.y + b.y) / 2 + yShift) });
    } else if (Math.abs(dx) < 0.5 && len > 0.5) {
      // Vertical edge — outward shifts X
      const xShift = sign * (dy / len) * d;
      edgeOffsets.push({ type: "V", value: round1((a.x + b.x) / 2 + xShift) });
    } else {
      // Non-axis-aligned fallback (shouldn't happen after rectification)
      edgeOffsets.push({ type: "D" });
    }
  }

  // Recompute each vertex as intersection of edge (i-1) and edge (i)
  const result = [];
  for (let i = 0; i < n; i++) {
    const prev = edgeOffsets[(i - 1 + n) % n];
    const curr = edgeOffsets[i];

    if (prev.type === "H" && curr.type === "V") {
      result.push({ x: curr.value, y: prev.value });
    } else if (prev.type === "V" && curr.type === "H") {
      result.push({ x: prev.value, y: curr.value });
    } else {
      // Fallback: keep original vertex
      result.push({ x: round1(vertices[i].x), y: round1(vertices[i].y) });
    }
  }

  return result;
}

/**
 * Adjust a new room's floor position so its edges align with existing rooms.
 *
 * For each axis-aligned edge of the new room, check if an existing room
 * has an edge on nearly the same line (within alignmentToleranceCm).
 * If so, shift the new room's floorPosition to match.
 *
 * Only the floorPosition is adjusted — vertices stay unchanged.
 *
 * @param {Array<{x: number, y: number}>} newVertices - Rectified polygon (room-local)
 * @param {{x: number, y: number}} newFloorPos - Proposed floor position
 * @param {Array} existingRooms - Rooms already on the floor
 * @param {Object} [rules] - Floor plan rules
 * @returns {{ vertices: Array, floorPosition: {x: number, y: number} }}
 */
export function alignToExistingRooms(newVertices, newFloorPos, existingRooms, rules = FLOOR_PLAN_RULES) {
  if (!existingRooms?.length || !newVertices?.length) {
    return { vertices: newVertices, floorPosition: newFloorPos };
  }

  const tol = rules.alignmentToleranceCm;

  // Collect floor-global axis values from existing rooms' edges
  const existingHLines = []; // { y, len } for horizontal edges
  const existingVLines = []; // { x, len } for vertical edges

  for (const room of existingRooms) {
    const pos = room.floorPosition || { x: 0, y: 0 };
    const verts = room.polygonVertices;
    if (!verts || verts.length < 3) continue;

    for (let i = 0; i < verts.length; i++) {
      const a = verts[i];
      const b = verts[(i + 1) % verts.length];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 1) continue;

      if (Math.abs(dy) < 0.5) {
        existingHLines.push({ y: pos.y + (a.y + b.y) / 2, len });
      } else if (Math.abs(dx) < 0.5) {
        existingVLines.push({ x: pos.x + (a.x + b.x) / 2, len });
      }
    }
  }

  // Find best Y and X alignment deltas (largest matched edge wins)
  let bestDeltaY = 0, bestYScore = 0;
  let bestDeltaX = 0, bestXScore = 0;

  for (let i = 0; i < newVertices.length; i++) {
    const a = newVertices[i];
    const b = newVertices[(i + 1) % newVertices.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) continue;

    if (Math.abs(dy) < 0.5) {
      // Horizontal new edge at floor-global Y
      const newY = newFloorPos.y + (a.y + b.y) / 2;
      for (const line of existingHLines) {
        const delta = line.y - newY;
        if (Math.abs(delta) > 0.1 && Math.abs(delta) <= tol) {
          const score = Math.min(len, line.len);
          if (score > bestYScore) {
            bestDeltaY = delta;
            bestYScore = score;
          }
        }
      }
    } else if (Math.abs(dx) < 0.5) {
      // Vertical new edge at floor-global X
      const newX = newFloorPos.x + (a.x + b.x) / 2;
      for (const line of existingVLines) {
        const delta = line.x - newX;
        if (Math.abs(delta) > 0.1 && Math.abs(delta) <= tol) {
          const score = Math.min(len, line.len);
          if (score > bestXScore) {
            bestDeltaX = delta;
            bestXScore = score;
          }
        }
      }
    }
  }

  return {
    vertices: newVertices,
    floorPosition: {
      x: round1(newFloorPos.x + bestDeltaX),
      y: round1(newFloorPos.y + bestDeltaY),
    },
  };
}
