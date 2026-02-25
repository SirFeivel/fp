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
 * Extract the set of valid wall angles from a polygon and optional spanning walls.
 *
 * For each polygon edge and each spanning wall segment, computes the angle
 * (nearest integer degree in [0, 360)), accumulates total length per angle,
 * and keeps only angles whose total length meets the minimum threshold.
 * Each surviving angle gets its complement (a + 180) % 360 added (walls are
 * bidirectional). Falls back to FLOOR_PLAN_RULES.standardAngles when no
 * angles survive filtering.
 *
 * @param {Array<{x: number, y: number}>} polygonCm - Polygon vertices (floor-global cm)
 * @param {Array<{startCm: {x,y}, endCm: {x,y}}>} [spanningWalls=[]] - Spanning wall segments
 * @param {{ minEdgeLengthCm?: number }} [options={}] - Override minimum edge length
 * @returns {number[]} Sorted array of valid angles in [0, 360)
 */
export function extractValidAngles(polygonCm, spanningWalls = [], options = {}) {
  const minLen = options.minEdgeLengthCm ?? FLOOR_PLAN_RULES.minEdgeLengthCm;

  // Accumulate total edge length per integer angle
  const lengthByAngle = new Map();

  function addSegment(ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    if (len < 0.1) return; // degenerate
    const angleDeg = Math.round(((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360) % 360;
    lengthByAngle.set(angleDeg, (lengthByAngle.get(angleDeg) || 0) + len);
  }

  // Polygon edges
  if (polygonCm && polygonCm.length >= 3) {
    for (let i = 0; i < polygonCm.length; i++) {
      const a = polygonCm[i];
      const b = polygonCm[(i + 1) % polygonCm.length];
      addSegment(a.x, a.y, b.x, b.y);
    }
  }

  // Spanning walls
  for (const wall of spanningWalls) {
    if (wall.startCm && wall.endCm) {
      addSegment(wall.startCm.x, wall.startCm.y, wall.endCm.x, wall.endCm.y);
    }
  }

  // Filter: keep angles with total length >= minLen
  const surviving = new Set();
  for (const [angle, totalLen] of lengthByAngle) {
    if (totalLen >= minLen) {
      surviving.add(angle);
    }
  }

  // Add complements: walls are bidirectional
  for (const angle of [...surviving]) {
    surviving.add((angle + 180) % 360);
  }

  // Fallback
  if (surviving.size === 0) {
    return [...FLOOR_PLAN_RULES.standardAngles];
  }

  return [...surviving].sort((a, b) => a - b);
}

/**
 * Predefined wall type defaults.
 * Ordered by ascending thickness. User-configurable later.
 */
export const DEFAULT_WALL_TYPES = [
  { id: "partition",  thicknessCm: 11.5 },
  { id: "structural", thicknessCm: 24 },
  { id: "outer",      thicknessCm: 30 },
];

/** Default floor height for detection-created walls. */
export const DEFAULT_FLOOR_HEIGHT_CM = 240;

/**
 * Snap a measured wall thickness to the nearest predefined wall type.
 *
 * For each type (sorted by thickness), the snap region is bounded by
 * midpoints to adjacent types. Edge types use wallThickness min/max
 * as outer bounds. If the measurement falls in a type's region, returns
 * that type's thickness. Otherwise returns raw value (rounded).
 *
 * @param {number} measuredCm - Measured wall thickness in cm
 * @param {Array<{id: string, thicknessCm: number}>} [types=DEFAULT_WALL_TYPES]
 * @returns {{ snappedCm: number, typeId: string|null }}
 */
export function snapToWallType(measuredCm, types = DEFAULT_WALL_TYPES) {
  if (!types || types.length === 0) {
    return { snappedCm: Math.round(measuredCm), typeId: null };
  }

  // Sort ascending by thickness
  const sorted = [...types].sort((a, b) => a.thicknessCm - b.thicknessCm);
  const { minCm, maxCm } = FLOOR_PLAN_RULES.wallThickness;

  for (let i = 0; i < sorted.length; i++) {
    const lower = i === 0
      ? minCm
      : (sorted[i - 1].thicknessCm + sorted[i].thicknessCm) / 2;
    const upper = i === sorted.length - 1
      ? maxCm + 1 // last type captures everything up to and including maxCm
      : (sorted[i].thicknessCm + sorted[i + 1].thicknessCm) / 2;

    if (measuredCm >= lower && measuredCm < upper) {
      return { snappedCm: sorted[i].thicknessCm, typeId: sorted[i].id };
    }
  }

  return { snappedCm: Math.round(measuredCm), typeId: null };
}

/**
 * Cluster measured wall thicknesses into distinct wall types.
 *
 * Algorithm:
 *   1. Filter valid measurements (within [minCm, maxCm])
 *   2. Sort ascending
 *   3. Compute gap threshold from minimum gap between adjacent defaults / 2
 *   4. Split at consecutive gaps > threshold → groups
 *   5. Each group → type with centroid = median of group
 *   6. Snap each centroid to nearest predefined default via snapToWallType
 *   7. Deduplicate (two clusters may snap to the same type)
 *
 * @param {number[]} thicknesses - Measured wall thicknesses (cm)
 * @param {Array<{id: string, thicknessCm: number}>} [defaultTypes=DEFAULT_WALL_TYPES]
 * @returns {Array<{id: string, thicknessCm: number}>} Discovered types, ascending
 */
export function classifyWallTypes(thicknesses, defaultTypes = DEFAULT_WALL_TYPES) {
  const { minCm, maxCm } = FLOOR_PLAN_RULES.wallThickness;

  // 1. Filter valid measurements
  const valid = thicknesses.filter(t => Number.isFinite(t) && t >= minCm && t <= maxCm);
  if (valid.length === 0) return [];

  // 2. Sort ascending
  valid.sort((a, b) => a - b);

  // 3. Gap threshold from defaults
  let gapThreshold = FLOOR_PLAN_RULES.alignmentToleranceCm; // fallback: 6cm
  if (defaultTypes && defaultTypes.length >= 2) {
    const sorted = [...defaultTypes].sort((a, b) => a.thicknessCm - b.thicknessCm);
    let minGap = Infinity;
    for (let i = 1; i < sorted.length; i++) {
      minGap = Math.min(minGap, sorted[i].thicknessCm - sorted[i - 1].thicknessCm);
    }
    if (Number.isFinite(minGap) && minGap > 0) {
      gapThreshold = minGap / 2;
    }
  }

  // 4. Split at gaps > threshold
  const groups = [[valid[0]]];
  for (let i = 1; i < valid.length; i++) {
    if (valid[i] - valid[i - 1] > gapThreshold) {
      groups.push([valid[i]]);
    } else {
      groups[groups.length - 1].push(valid[i]);
    }
  }

  // 5-6. Median centroid → snap to default type
  const seen = new Set();
  const result = [];

  for (const group of groups) {
    // Median
    const mid = Math.floor(group.length / 2);
    const centroid = group.length % 2 === 1
      ? group[mid]
      : (group[mid - 1] + group[mid]) / 2;

    const { snappedCm, typeId } = snapToWallType(centroid, defaultTypes);
    const id = typeId || `custom_${Math.round(snappedCm)}`;

    // 7. Deduplicate
    if (!seen.has(id)) {
      seen.add(id);
      result.push({ id, thicknessCm: snappedCm });
    }
  }

  // Sort ascending by thickness
  result.sort((a, b) => a.thicknessCm - b.thicknessCm);
  return result;
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

  // Step 1b: Merge nearby axis values for consecutive same-type edge runs.
  // When multiple V edges at similar x (or H edges at similar y) appear
  // consecutively — possibly separated by short diagonal edges — they
  // represent the same wall line with detection noise. Merge their axis
  // values to a length-weighted average and reclassify sandwiched diagonals.
  // Only consecutive runs are merged; edges separated by long edges of the
  // other type (like in an L-shaped step) are preserved.
  const mergeTol = rules.alignmentToleranceCm;

  function mergeAxisRuns(edgeType) {
    // Find a starting edge that breaks any potential run (other type or long diagonal)
    let anchor = -1;
    for (let i = 0; i < n; i++) {
      const e = edges[i];
      if (e.type !== edgeType && (e.type !== null || e.len >= mergeTol * 3)) {
        anchor = i;
        break;
      }
    }
    if (anchor === -1) return; // all edges are same type — no runs to merge

    // Walk from anchor+1, collecting runs of {edgeType edges + short diagonals}
    let run = [];
    for (let offset = 1; offset <= n; offset++) {
      const i = (anchor + offset) % n;
      const e = edges[i];
      const inRun = e.type === edgeType || (e.type === null && e.len < mergeTol * 3);

      if (inRun) {
        run.push(i);
      }

      if (!inRun || offset === n) {
        // Process completed run
        if (run.length >= 2) {
          const typed = run.filter(j => edges[j].type === edgeType);
          if (typed.length >= 2) {
            const vals = typed.map(j => edges[j].axisValue);
            if (Math.max(...vals) - Math.min(...vals) <= mergeTol) {
              // Merge: weighted average of axis values
              let sumWV = 0, sumW = 0;
              for (const j of typed) {
                sumWV += edges[j].axisValue * edges[j].len;
                sumW += edges[j].len;
              }
              const merged = sumWV / sumW;
              for (const j of typed) edges[j].axisValue = merged;

              // Reclassify short diagonals in the run
              for (const j of run) {
                if (edges[j].type !== null) continue;
                const a = vertices[j];
                const b = vertices[(j + 1) % n];
                if (edgeType === "V" && Math.abs(b.x - a.x) <= mergeTol) {
                  edges[j].type = "V";
                  edges[j].axisValue = merged;
                } else if (edgeType === "H" && Math.abs(b.y - a.y) <= mergeTol) {
                  edges[j].type = "H";
                  edges[j].axisValue = merged;
                }
              }
            }
          }
        }
        run = [];
      }
    }
  }
  mergeAxisRuns("V");
  mergeAxisRuns("H");

  // Step 1c: Correct axis values for wide nearly-aligned edges.
  // An edge classified as V by angle (e.g. 4° off vertical) may have endpoints
  // on different wall faces (dx=26cm). Its axisValue = average of endpoints is
  // wrong — it should inherit from an adjacent same-type edge whose position
  // is actually established (endpoint matches the adjacent edge's axisValue).
  const WIDE_TOL = 1.0; // cm — edges with spread > this need correction
  for (let i = 0; i < n; i++) {
    const e = edges[i];
    if (e.type !== "V" && e.type !== "H") continue;
    const a = vertices[i];
    const b = vertices[(i + 1) % n];
    const isV = e.type === "V";
    const spread = isV ? Math.abs(b.x - a.x) : Math.abs(b.y - a.y);
    if (spread <= WIDE_TOL) continue; // truly axis-aligned, no correction needed

    const prev = edges[(i - 1 + n) % n];
    const next = edges[(i + 1) % n];

    if (isV) {
      // Check if start endpoint matches previous V edge's position
      const prevMatch = prev.type === "V" && Math.abs(prev.axisValue - a.x) < WIDE_TOL;
      const prevLen = prevMatch ? prev.len : 0;
      // Check if end endpoint matches next V edge's position
      const nextMatch = next.type === "V" && Math.abs(next.axisValue - b.x) < WIDE_TOL;
      const nextLen = nextMatch ? next.len : 0;
      if (prevMatch && nextMatch) {
        e.axisValue = prevLen >= nextLen ? prev.axisValue : next.axisValue;
      } else if (prevMatch) {
        e.axisValue = prev.axisValue;
      } else if (nextMatch) {
        e.axisValue = next.axisValue;
      }
    } else {
      const prevMatch = prev.type === "H" && Math.abs(prev.axisValue - a.y) < WIDE_TOL;
      const prevLen = prevMatch ? prev.len : 0;
      const nextMatch = next.type === "H" && Math.abs(next.axisValue - b.y) < WIDE_TOL;
      const nextLen = nextMatch ? next.len : 0;
      if (prevMatch && nextMatch) {
        e.axisValue = prevLen >= nextLen ? prev.axisValue : next.axisValue;
      } else if (prevMatch) {
        e.axisValue = prev.axisValue;
      } else if (nextMatch) {
        e.axisValue = next.axisValue;
      }
    }
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

  // Step 5: Enforce all edges axis-aligned — snap any surviving diagonals.
  // After rebuild + collinear merge, some edges may still be diagonal (from
  // type=null edges that kept original vertices). Force-snap each to H or V.
  // When an adjacent edge is already axis-aligned on the same axis, use its
  // established coordinate instead of blindly averaging the two endpoints.
  const SNAP_TOL = 1.0; // cm — edges within this are already axis-aligned

  function pickAdjacentAxisValue(pts, idx, axis, tol) {
    const n = pts.length;
    const ptA = pts[idx];
    const ptB = pts[(idx + 1) % n];
    const cross = axis === 'x' ? 'y' : 'x';
    const prev = pts[(idx - 1 + n) % n];
    const prevAligned = Math.abs(prev[axis] - ptA[axis]) < tol;
    const prevLen = prevAligned ? Math.abs(prev[cross] - ptA[cross]) : 0;
    const next = pts[(idx + 2) % n];
    const nextAligned = Math.abs(ptB[axis] - next[axis]) < tol;
    const nextLen = nextAligned ? Math.abs(ptB[cross] - next[cross]) : 0;
    if (prevAligned && nextAligned) return prevLen >= nextLen ? ptA[axis] : ptB[axis];
    if (prevAligned) return ptA[axis];
    if (nextAligned) return ptB[axis];
    return null;
  }

  changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < rebuilt.length && rebuilt.length > 3; i++) {
      const a = rebuilt[i];
      const b = rebuilt[(i + 1) % rebuilt.length];
      const dx = Math.abs(b.x - a.x);
      const dy = Math.abs(b.y - a.y);
      if (dx < SNAP_TOL || dy < SNAP_TOL) continue; // already axis-aligned
      if (dx >= dy) {
        // More horizontal → snap to H
        const snapY = pickAdjacentAxisValue(rebuilt, i, 'y', SNAP_TOL)
                      ?? round1((a.y + b.y) / 2);
        rebuilt[i] = { x: a.x, y: snapY };
        rebuilt[(i + 1) % rebuilt.length] = { x: b.x, y: snapY };
      } else {
        // More vertical → snap to V
        const snapX = pickAdjacentAxisValue(rebuilt, i, 'x', SNAP_TOL)
                      ?? round1((a.x + b.x) / 2);
        rebuilt[i] = { x: snapX, y: a.y };
        rebuilt[(i + 1) % rebuilt.length] = { x: snapX, y: b.y };
      }
      console.log(`[rectifyPolygon] enforcement: snapped diagonal edge ${i} (dx=${dx.toFixed(1)}, dy=${dy.toFixed(1)}) to axis-aligned`);
      changed = true;
      break; // restart — snapping may create new collinear vertices
    }
    // Re-merge collinear after each snap
    if (changed) {
      let merged = true;
      while (merged) {
        merged = false;
        for (let i = 0; i < rebuilt.length && rebuilt.length > 3; i++) {
          const a = rebuilt[(i - 1 + rebuilt.length) % rebuilt.length];
          const b = rebuilt[i];
          const c = rebuilt[(i + 1) % rebuilt.length];
          if (Math.abs(a.y - b.y) < 0.2 && Math.abs(b.y - c.y) < 0.2) {
            rebuilt.splice(i, 1); merged = true; break;
          }
          if (Math.abs(a.x - b.x) < 0.2 && Math.abs(b.x - c.x) < 0.2) {
            rebuilt.splice(i, 1); merged = true; break;
          }
        }
      }
    }
  }

  return rebuilt;
}

/**
 * After rectifyPolygon, the polygon may contain small rectangular notches
 * caused by external structures (retaining walls, stairs) that are
 * morphologically connected to the building. These bumps are shorter than
 * the median wall thickness and are not real architectural features.
 *
 * A bump is 3 consecutive edges forming a U-shape:
 *   leg1 → short outer wall → leg2
 * where the outer wall length (bump depth) is < maxBumpDepthCm and the
 * two legs are parallel (both H or both V) and go in opposite directions.
 * Collapsing removes the two interior vertices and re-merges collinear vertices.
 *
 * @param {Array<{x: number, y: number}>} vertices - Rectified polygon vertices
 * @param {number} maxBumpDepthCm - Maximum bump depth to remove (default 30)
 * @returns {Array<{x: number, y: number}>} Cleaned polygon
 */
export function removePolygonMicroBumps(vertices, maxBumpDepthCm = FLOOR_PLAN_RULES.wallThickness.maxCm) {
  if (!vertices || vertices.length < 5) return vertices; // need at least 5 vertices for a bump

  let pts = vertices.map(p => ({ x: p.x, y: p.y }));

  let changed = true;
  while (changed) {
    changed = false;
    const n = pts.length;
    if (n < 5) break;

    for (let i = 0; i < n; i++) {
      // Three consecutive edges: leg1 (prev→i), outer (i→next), leg2 (next→next2)
      const iPrev = (i - 1 + n) % n;
      const iNext = (i + 1) % n;
      const iNext2 = (i + 2) % n;

      const A = pts[iPrev]; // before bump
      const B = pts[i];     // bump vertex 1 (start of outer wall)
      const C = pts[iNext]; // bump vertex 2 (end of outer wall)
      const D = pts[iNext2]; // after bump

      // Edge B→C is the outer wall (should be short = bump depth)
      const outerLen = Math.hypot(C.x - B.x, C.y - B.y);
      if (outerLen >= maxBumpDepthCm || outerLen < 0.1) continue;

      // Classify legs: A→B (leg1) and C→D (leg2)
      const leg1IsH = Math.abs(A.y - B.y) < 0.5;
      const leg1IsV = Math.abs(A.x - B.x) < 0.5;
      const leg2IsH = Math.abs(C.y - D.y) < 0.5;
      const leg2IsV = Math.abs(C.x - D.x) < 0.5;

      // Both legs must be parallel (both H or both V)
      const { minCm: minWallCm } = FLOOR_PLAN_RULES.wallThickness;
      if (leg1IsH && leg2IsH) {
        // Legs are H, outer wall (B→C) should be V (perpendicular)
        if (Math.abs(B.x - C.x) >= 0.5) continue;
        const dir1 = B.x - A.x;
        const dir2 = D.x - C.x;
        if (dir1 === 0 || dir2 === 0) continue; // degenerate
        if (dir1 * dir2 > 0) {
          // Same-direction step: only remove if narrower than min wall thickness (artifact)
          if (outerLen >= minWallCm) continue;
          console.log(`[removePolygonMicroBumps] removed artifact step at vertex ${i}: depth=${outerLen.toFixed(1)}cm (< minWall=${minWallCm}cm)`);
        }
        // dir1 * dir2 < 0: U-bump, always remove (outerLen already checked above)
      } else if (leg1IsV && leg2IsV) {
        // Legs are V, outer wall (B→C) should be H (perpendicular)
        if (Math.abs(B.y - C.y) >= 0.5) continue;
        const dir1 = B.y - A.y;
        const dir2 = D.y - C.y;
        if (dir1 === 0 || dir2 === 0) continue; // degenerate
        if (dir1 * dir2 > 0) {
          // Same-direction step: only remove if narrower than min wall thickness (artifact)
          if (outerLen >= minWallCm) continue;
          console.log(`[removePolygonMicroBumps] removed artifact step at vertex ${i}: depth=${outerLen.toFixed(1)}cm (< minWall=${minWallCm}cm)`);
        }
        // dir1 * dir2 < 0: U-bump, always remove (outerLen already checked above)
      } else {
        continue;
      }

      // Collapse: remove B and C, snap D to align with A on the main wall axis.
      if (leg1IsH) {
        // Legs are H → main wall is V. Snap D's x to A's x (or vice versa).
        // Pick the side with the longer adjacent main-wall edge.
        // A's x comes from the main wall before the bump.
        pts[iNext2] = { x: A.x, y: D.y };
      } else {
        // Legs are V → main wall is H. Snap D's y to A's y.
        pts[iNext2] = { x: D.x, y: A.y };
      }

      // Remove B and C (higher index first)
      if (iNext > i) {
        pts.splice(iNext, 1);
        pts.splice(i, 1);
      } else {
        pts.splice(i, 1);
        pts.splice(iNext, 1);
      }
      changed = true;
      break;
    }
  }

  // ── Pass 2: Rectangular step-notch removal (5-vertex, 4-edge pattern) ──
  // Detects patterns like: ...A→B (H)→C (V,down)→D (H,short)→E (V,up)→F (H)...
  // where the perpendicular jog (B→C, D→E) is small and the notch width (C→D)
  // is also small. Both depth and width must be < maxBumpDepthCm.
  changed = true;
  while (changed) {
    changed = false;
    const n = pts.length;
    if (n < 6) break; // need at least 6 vertices (5 for notch + 1 remaining)

    for (let i = 0; i < n; i++) {
      const iB = i;
      const iC = (i + 1) % n;
      const iD = (i + 2) % n;
      const iE = (i + 3) % n;
      const iA = (i - 1 + n) % n;

      const A = pts[iA];
      const B = pts[iB];
      const C = pts[iC];
      const D = pts[iD];
      const E = pts[iE];

      // B→C: perpendicular leg (depth)
      // C→D: parallel to main axis (notch width)
      // D→E: perpendicular return (must be opposite direction of B→C)

      const bcIsV = Math.abs(B.x - C.x) < 0.5;
      const bcIsH = Math.abs(B.y - C.y) < 0.5;
      const deIsV = Math.abs(D.x - E.x) < 0.5;
      const deIsH = Math.abs(D.y - E.y) < 0.5;

      // B→C and D→E must be same orientation (both V or both H)
      if (bcIsV && deIsV) {
        // Perpendicular legs are V → main axis is H
        // A→B should be H, E→next should be H
        if (Math.abs(A.y - B.y) >= 0.5) continue;
        // C→D should be H (notch width)
        if (Math.abs(C.y - D.y) >= 0.5) continue;

        const depth = Math.abs(C.y - B.y);  // V jog
        const width = Math.abs(D.x - C.x);  // H width
        if (depth >= maxBumpDepthCm || depth < 0.1) continue;
        if (width >= maxBumpDepthCm || width < 0.1) continue;

        // B→C and D→E must go in opposite directions (one down, one up)
        const bcDir = C.y - B.y;
        const deDir = E.y - D.y;
        if (bcDir * deDir >= 0) continue;

        console.log(`[removePolygonMicroBumps] removed rectangular notch at vertex ${iB}: depth=${depth.toFixed(1)}cm, width=${width.toFixed(1)}cm`);

        // Collapse: remove B, C, D. Snap E to A's y-axis value.
        pts[iE] = { x: E.x, y: A.y };

        // Remove B, C, D (descending index order to avoid shifts)
        const indices = [iB, iC, iD].sort((a, b) => b - a);
        for (const idx of indices) pts.splice(idx, 1);
        changed = true;
        break;
      } else if (bcIsH && deIsH) {
        // Perpendicular legs are H → main axis is V
        if (Math.abs(A.x - B.x) >= 0.5) continue;
        // C→D should be V (notch width)
        if (Math.abs(C.x - D.x) >= 0.5) continue;

        const depth = Math.abs(C.x - B.x);  // H jog
        const width = Math.abs(D.y - C.y);  // V width
        if (depth >= maxBumpDepthCm || depth < 0.1) continue;
        if (width >= maxBumpDepthCm || width < 0.1) continue;

        // B→C and D→E must go in opposite directions
        const bcDir = C.x - B.x;
        const deDir = E.x - D.x;
        if (bcDir * deDir >= 0) continue;

        console.log(`[removePolygonMicroBumps] removed rectangular notch at vertex ${iB}: depth=${depth.toFixed(1)}cm, width=${width.toFixed(1)}cm`);

        // Collapse: remove B, C, D. Snap E to A's x-axis value.
        pts[iE] = { x: A.x, y: E.y };

        const indices = [iB, iC, iD].sort((a, b) => b - a);
        for (const idx of indices) pts.splice(idx, 1);
        changed = true;
        break;
      }
    }
  }

  // Re-merge collinear vertices.
  // Use a slightly larger tolerance than rectifyPolygon (1.0 cm vs 0.2 cm)
  // because bump removal may combine vertices from slightly misaligned sides.
  const COLLINEAR_TOL = 1.0;
  changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < pts.length && pts.length > 3; i++) {
      const a = pts[(i - 1 + pts.length) % pts.length];
      const b = pts[i];
      const c = pts[(i + 1) % pts.length];

      if (Math.abs(a.y - b.y) < COLLINEAR_TOL && Math.abs(b.y - c.y) < COLLINEAR_TOL) {
        pts.splice(i, 1);
        changed = true;
        break;
      }
      if (Math.abs(a.x - b.x) < COLLINEAR_TOL && Math.abs(b.x - c.x) < COLLINEAR_TOL) {
        pts.splice(i, 1);
        changed = true;
        break;
      }
    }
  }

  return pts;
}

/**
 * Remove stacked (parallel overlapping) wall segments from an envelope polygon.
 *
 * A "stacked wall" is two parallel edges of the polygon that:
 *   1. Share the same orientation (both H or both V)
 *   2. Overlap when projected onto their shared axis
 *   3. Are closer together on the perpendicular axis than maxGapCm
 *
 * This happens when the contour traces both sides of a wall or picks up an
 * interior wall running parallel to the outer boundary. The fix collapses
 * the stacked pair by removing the inner (shorter) edge and connecting its
 * neighbors to the outer edge.
 *
 * Perpendicular crossings (e.g. a spanning wall crossing an outer wall) are
 * NOT affected — only parallel overlaps are removed.
 *
 * @param {Array<{x:number,y:number}>} vertices - Polygon vertices (cm)
 * @param {number} [maxGapCm] - Max perpendicular distance to consider stacked
 * @returns {Array<{x:number,y:number}>} Cleaned polygon
 */
export function removeStackedWalls(vertices, maxGapCm = FLOOR_PLAN_RULES.wallThickness.maxCm) {
  if (!vertices || vertices.length < 5) return vertices;

  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i], b = vertices[(i + 1) % vertices.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    console.log(`  edge ${i}: (${a.x.toFixed(1)},${a.y.toFixed(1)}) → (${b.x.toFixed(1)},${b.y.toFixed(1)}) len=${len.toFixed(1)}cm`);
  }

  const ALIGN_TOL = 1.0; // cm tolerance for axis-alignment
  let pts = vertices.map(p => ({ x: p.x, y: p.y }));

  // Classify edges as H, V, or diagonal
  function classifyEdge(a, b) {
    if (Math.abs(a.y - b.y) < ALIGN_TOL) return 'H';
    if (Math.abs(a.x - b.x) < ALIGN_TOL) return 'V';
    return null;
  }

  // Projection overlap check: do [a1,a2] and [b1,b2] overlap on a 1D axis?
  function rangesOverlap(a1, a2, b1, b2) {
    const aMin = Math.min(a1, a2), aMax = Math.max(a1, a2);
    const bMin = Math.min(b1, b2), bMax = Math.max(b1, b2);
    return aMin < bMax && bMin < aMax;
  }

  let changed = true;
  while (changed) {
    changed = false;
    const n = pts.length;
    if (n < 5) break;

    for (let i = 0; i < n && !changed; i++) {
      const a1 = pts[i], a2 = pts[(i + 1) % n];
      const typeA = classifyEdge(a1, a2);
      if (!typeA) continue;
      const lenA = Math.hypot(a2.x - a1.x, a2.y - a1.y);

      for (let j = i + 2; j < n && !changed; j++) {
        if (j === (i - 1 + n) % n) continue; // skip adjacent
        const b1 = pts[j], b2 = pts[(j + 1) % n];
        const typeB = classifyEdge(b1, b2);
        if (typeB !== typeA) continue;

        const lenB = Math.hypot(b2.x - b1.x, b2.y - b1.y);

        if (typeA === 'H') {
          // Both horizontal — check perpendicular (Y) gap and X overlap
          const gap = Math.abs(((a1.y + a2.y) / 2) - ((b1.y + b2.y) / 2));
          if (gap >= maxGapCm) continue;
          if (!rangesOverlap(a1.x, a2.x, b1.x, b2.x)) continue;
        } else {
          // Both vertical — check perpendicular (X) gap and Y overlap
          const gap = Math.abs(((a1.x + a2.x) / 2) - ((b1.x + b2.x) / 2));
          if (gap >= maxGapCm) continue;
          if (!rangesOverlap(a1.y, a2.y, b1.y, b2.y)) continue;
        }

        // Stacked pair found — remove the shorter edge
        const removeIdx = lenA <= lenB ? i : j;
        const keepIdx = lenA <= lenB ? j : i;
        const keep1 = pts[keepIdx], keep2 = pts[(keepIdx + 1) % n];
        const rem1 = pts[removeIdx], rem2 = pts[(removeIdx + 1) % n];

        // Snap the removed edge's neighbors to the kept edge's axis
        const prevIdx = (removeIdx - 1 + n) % n;
        const nextIdx = (removeIdx + 2) % n;
        const prevBefore = { ...pts[prevIdx] };
        const nextBefore = { ...pts[nextIdx] };
        if (typeA === 'H') {
          // Kept edge is H — snap neighbors' Y to the kept edge's Y
          const keepY = (keep1.y + keep2.y) / 2;
          pts[prevIdx] = { x: pts[prevIdx].x, y: keepY };
          pts[nextIdx] = { x: pts[nextIdx].x, y: keepY };
        } else {
          // Kept edge is V — snap neighbors' X to the kept edge's X
          const keepX = (keep1.x + keep2.x) / 2;
          pts[prevIdx] = { x: keepX, y: pts[prevIdx].y };
          pts[nextIdx] = { x: keepX, y: pts[nextIdx].y };
        }
        console.log(`  [stacked] ${typeA} remove (${rem1.x.toFixed(1)},${rem1.y.toFixed(1)})→(${rem2.x.toFixed(1)},${rem2.y.toFixed(1)}) keep (${keep1.x.toFixed(1)},${keep1.y.toFixed(1)})→(${keep2.x.toFixed(1)},${keep2.y.toFixed(1)}) | snap prev (${prevBefore.x.toFixed(1)},${prevBefore.y.toFixed(1)})→(${pts[prevIdx].x.toFixed(1)},${pts[prevIdx].y.toFixed(1)}) next (${nextBefore.x.toFixed(1)},${nextBefore.y.toFixed(1)})→(${pts[nextIdx].x.toFixed(1)},${pts[nextIdx].y.toFixed(1)}) | ${n}→${n-2} pts`);

        // Remove the two vertices of the shorter edge
        const r1 = removeIdx;
        const r2 = (removeIdx + 1) % n;
        if (r1 < r2) {
          pts.splice(r2, 1);
          pts.splice(r1, 1);
        } else {
          pts.splice(r1, 1);
          pts.splice(r2, 1);
        }

        changed = true;
      }
    }
  }

  // Clean up: remove collinear vertices (strict axis-aligned check).
  // Uses H/V checks matching rectifyPolygon Step 4 and removePolygonMicroBumps.
  // Do NOT use cross-product tolerance — it treats vertices at x=531 and x=557
  // as "nearly collinear" on long edges, merging distinct wall faces.
  const COLLINEAR_TOL = 1.0;
  changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < pts.length && pts.length > 3; i++) {
      const a = pts[(i - 1 + pts.length) % pts.length];
      const b = pts[i];
      const c = pts[(i + 1) % pts.length];

      if (Math.abs(a.y - b.y) < COLLINEAR_TOL && Math.abs(b.y - c.y) < COLLINEAR_TOL) {
        pts.splice(i, 1);
        changed = true;
        break;
      }
      if (Math.abs(a.x - b.x) < COLLINEAR_TOL && Math.abs(b.x - c.x) < COLLINEAR_TOL) {
        pts.splice(i, 1);
        changed = true;
        break;
      }
    }
  }

  return pts;
}

/**
 * Unified polygon enforcement: runs rectification, bump removal, and stacked
 * wall removal in a fixpoint loop until all edges are axis-aligned.
 *
 * Individual post-processing steps (removePolygonMicroBumps, removeStackedWalls)
 * can violate axis-alignment established by rectifyPolygon. This function
 * guarantees the output polygon has only H/V edges by re-checking after each
 * pass and looping if violations are found.
 *
 * @param {Array<{x: number, y: number}>} vertices - Raw polygon vertices
 * @param {Object} [options]
 * @param {Object} [options.rules=FLOOR_PLAN_RULES] - Rectification rules
 * @param {number|null} [options.bumpThresholdCm=null] - Max bump depth; null to skip
 * @param {number|null} [options.stackedWallGapCm=null] - Max stacked wall gap; null to skip
 * @param {number} [options.maxIterations=3] - Max fixpoint iterations
 * @returns {Array<{x: number, y: number}>} Polygon with all edges axis-aligned
 */
export function enforcePolygonRules(vertices, {
  rules = FLOOR_PLAN_RULES,
  bumpThresholdCm = null,
  stackedWallGapCm = null,
  maxIterations = 3,
} = {}) {
  if (!vertices || vertices.length < 3) return vertices;

  const AXIS_TOL = 1.0; // cm — edge is axis-aligned if dx or dy < this

  function isAxisAligned(pts) {
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const dx = Math.abs(b.x - a.x);
      const dy = Math.abs(b.y - a.y);
      if (dx >= AXIS_TOL && dy >= AXIS_TOL) return false;
    }
    return true;
  }

  let result = vertices;

  for (let iter = 1; iter <= maxIterations; iter++) {
    result = rectifyPolygon(result, rules);

    if (bumpThresholdCm != null) {
      result = removePolygonMicroBumps(result, bumpThresholdCm);
      result = rectifyPolygon(result, rules); // clean up after bumps
    }

    if (stackedWallGapCm != null) {
      result = removeStackedWalls(result, stackedWallGapCm);
    }

    const stable = isAxisAligned(result);
    console.log(`[enforcePolygonRules] iteration ${iter}: ${result.length} vertices, stable=${stable}`);

    if (stable) return result;
  }

  // Not converged — final safety net
  console.warn(`[enforcePolygonRules] did not converge after ${maxIterations} iterations, applying final rectify`);
  return rectifyPolygon(result, rules);
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
