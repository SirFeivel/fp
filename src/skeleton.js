// src/skeleton.js — Structural boundary enforcement from envelope skeleton
//
// This module is deliberately separated from envelope.js to avoid circular
// dependencies: walls.js can import from skeleton.js (which only depends on
// floor-plan-rules.js), while envelope.js imports from walls.js.

import { FLOOR_PLAN_RULES, snapToWallType } from "./floor-plan-rules.js";

/**
 * Extract structural boundary positions from the envelope polygon and spanning walls.
 * Returns inner-face positions (where room edges should align) with thickness and type info.
 *
 * @param {Object} envelope - Envelope data with detectedPolygonCm/polygonCm, wallThicknesses, spanningWalls
 * @returns {{ hTargets: Array, vTargets: Array }} Horizontal and vertical boundary targets
 */
export function computeStructuralBoundaries(envelope) {
  if (!envelope) return { hTargets: [], vTargets: [] };

  const envelopePoly = envelope.detectedPolygonCm || envelope.polygonCm;
  if (!envelopePoly || envelopePoly.length < 3) return { hTargets: [], vTargets: [] };

  const envThicknesses = envelope.wallThicknesses?.edges || [];
  const spanningWalls = envelope.spanningWalls || [];
  const hTargets = [];
  const vTargets = [];

  // Compute winding for inward normal
  let signedArea2 = 0;
  const n = envelopePoly.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    signedArea2 += envelopePoly[i].x * envelopePoly[j].y
                 - envelopePoly[j].x * envelopePoly[i].y;
  }
  const sign = signedArea2 > 0 ? 1 : -1;

  // Envelope inner faces
  for (let i = 0; i < n; i++) {
    const a = envelopePoly[i];
    const b = envelopePoly[(i + 1) % n];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) continue;

    const edgeMeas = envThicknesses.find(e => e.edgeIndex === i);
    const thickness = edgeMeas?.thicknessCm || 0;
    const inNx = -sign * (dy / len);
    const inNy = -sign * (-dx / len);

    if (Math.abs(dy) < 0.5) {
      // H envelope edge
      const envY = (a.y + b.y) / 2;
      const innerY = envY + inNy * thickness;
      hTargets.push({
        coord: innerY, thickness, type: 'envelope',
        envelopeEdgeIndex: i, rangeMin: Math.min(a.x, b.x), rangeMax: Math.max(a.x, b.x)
      });
    } else if (Math.abs(dx) < 0.5) {
      // V envelope edge
      const envX = (a.x + b.x) / 2;
      const innerX = envX + inNx * thickness;
      vTargets.push({
        coord: innerX, thickness, type: 'envelope',
        envelopeEdgeIndex: i, rangeMin: Math.min(a.y, b.y), rangeMax: Math.max(a.y, b.y)
      });
    }
  }

  // Spanning wall faces (both sides)
  for (let i = 0; i < spanningWalls.length; i++) {
    const sw = spanningWalls[i];
    const half = (sw.thicknessCm || 0) / 2;
    if (sw.orientation === 'H') {
      const centerY = (sw.startCm.y + sw.endCm.y) / 2;
      const rMin = Math.min(sw.startCm.x, sw.endCm.x);
      const rMax = Math.max(sw.startCm.x, sw.endCm.x);
      hTargets.push({ coord: centerY - half, thickness: sw.thicknessCm,
        type: 'spanning', spanningWallIndex: i, rangeMin: rMin, rangeMax: rMax });
      hTargets.push({ coord: centerY + half, thickness: sw.thicknessCm,
        type: 'spanning', spanningWallIndex: i, rangeMin: rMin, rangeMax: rMax });
    } else {
      const centerX = (sw.startCm.x + sw.endCm.x) / 2;
      const rMin = Math.min(sw.startCm.y, sw.endCm.y);
      const rMax = Math.max(sw.startCm.y, sw.endCm.y);
      vTargets.push({ coord: centerX - half, thickness: sw.thicknessCm,
        type: 'spanning', spanningWallIndex: i, rangeMin: rMin, rangeMax: rMax });
      vTargets.push({ coord: centerX + half, thickness: sw.thicknessCm,
        type: 'spanning', spanningWallIndex: i, rangeMin: rMin, rangeMax: rMax });
    }
  }

  console.log(`[skeleton] boundaries: ${hTargets.length} H targets, ${vTargets.length} V targets`);
  for (const t of hTargets) console.log(`[skeleton]   H: y=${t.coord.toFixed(1)} thick=${t.thickness.toFixed(1)} (${t.type})`);
  for (const t of vTargets) console.log(`[skeleton]   V: x=${t.coord.toFixed(1)} thick=${t.thickness.toFixed(1)} (${t.type})`);

  return { hTargets, vTargets };
}

/**
 * Constrain a room polygon's edges to structural boundaries.
 * For each axis-aligned edge within tolerance of a skeleton boundary
 * (envelope inner face or spanning wall face), snap the edge to
 * the boundary position. This reshapes the polygon — not just translates.
 *
 * @param {Array<{x,y}>} globalVertices - Floor-global polygon coordinates
 * @param {Object} envelope - Envelope data with boundaries
 * @returns {Array<{x,y}>} Adjusted vertices (new array, input not mutated)
 */
export function constrainRoomToStructuralBoundaries(globalVertices, envelope) {
  if (!envelope || !globalVertices?.length) return globalVertices;

  const { hTargets, vTargets } = computeStructuralBoundaries(envelope);
  if (!hTargets.length && !vTargets.length) return globalVertices;

  const baseTolerance = FLOOR_PLAN_RULES.alignmentToleranceCm;
  const adjusted = globalVertices.map(v => ({ x: v.x, y: v.y }));
  const n = adjusted.length;

  for (let i = 0; i < n; i++) {
    const a = adjusted[i];
    const b = adjusted[(i + 1) % n];
    const dx = b.x - a.x, dy = b.y - a.y;

    if (Math.abs(dy) < 0.5 && Math.abs(dx) > 1) {
      // Horizontal edge at y = edgeY
      const edgeY = (a.y + b.y) / 2;
      const edgeMinX = Math.min(a.x, b.x), edgeMaxX = Math.max(a.x, b.x);
      let bestTarget = null, bestDist = Infinity;
      for (const t of hTargets) {
        const dist = Math.abs(t.coord - edgeY);
        // Per-target tolerance: the detected room edge can be anywhere within the
        // wall body, so max displacement from the inner face = wall thickness.
        const tol = Math.max(baseTolerance, t.thickness);
        const overlap = Math.min(edgeMaxX, t.rangeMax) - Math.max(edgeMinX, t.rangeMin);
        if (dist <= tol && dist < bestDist && overlap > 1) {
          bestTarget = t; bestDist = dist;
        }
      }
      if (bestTarget && bestDist > 0.5) {
        const tol = Math.max(baseTolerance, bestTarget.thickness);
        console.log(`[constrain] H edge ${i}: y=${edgeY.toFixed(1)} → ${bestTarget.coord.toFixed(1)} (${bestTarget.type}, delta=${(bestTarget.coord - edgeY).toFixed(1)}, tol=${tol.toFixed(1)})`);
        a.y = bestTarget.coord;
        b.y = bestTarget.coord;
      }
    } else if (Math.abs(dx) < 0.5 && Math.abs(dy) > 1) {
      // Vertical edge at x = edgeX
      const edgeX = (a.x + b.x) / 2;
      const edgeMinY = Math.min(a.y, b.y), edgeMaxY = Math.max(a.y, b.y);
      let bestTarget = null, bestDist = Infinity;
      for (const t of vTargets) {
        const dist = Math.abs(t.coord - edgeX);
        const tol = Math.max(baseTolerance, t.thickness);
        const overlap = Math.min(edgeMaxY, t.rangeMax) - Math.max(edgeMinY, t.rangeMin);
        if (dist <= tol && dist < bestDist && overlap > 1) {
          bestTarget = t; bestDist = dist;
        }
      }
      if (bestTarget && bestDist > 0.5) {
        const tol = Math.max(baseTolerance, bestTarget.thickness);
        console.log(`[constrain] V edge ${i}: x=${edgeX.toFixed(1)} → ${bestTarget.coord.toFixed(1)} (${bestTarget.type}, delta=${(bestTarget.coord - edgeX).toFixed(1)}, tol=${tol.toFixed(1)})`);
        a.x = bestTarget.coord;
        b.x = bestTarget.coord;
      }
    }
  }

  return adjusted;
}

/**
 * Enforce skeleton wall properties on all walls that align with
 * envelope edges or spanning walls. This is a top-down enforcement:
 * the skeleton (envelope) is the source of truth, and walls inherit
 * from it — not the other way around.
 *
 * For each wall in floor.walls:
 *   - If it aligns with an envelope edge → set thickness from envelope measurement
 *   - If it aligns with a spanning wall → set thickness from spanning wall measurement
 *
 * "Aligns" means: the wall is parallel to and within tolerance distance of
 * the structural boundary, with significant overlap along the boundary's range.
 *
 * Also enforces wallDefaults.heightCm on all walls.
 *
 * @param {Object} floor - Floor with walls[], layout.envelope, layout.wallDefaults
 */
export function enforceSkeletonWallProperties(floor) {
  const envelope = floor?.layout?.envelope;
  if (!envelope) return;

  const { hTargets, vTargets } = computeStructuralBoundaries(envelope);
  if (!hTargets.length && !vTargets.length) return;

  const wallHeight = floor.layout?.wallDefaults?.heightCm;
  const wallTypes = floor.layout?.wallDefaults?.types;
  const tolerance = FLOOR_PLAN_RULES.alignmentToleranceCm;

  for (const wall of (floor.walls || [])) {
    const sx = wall.start.x, sy = wall.start.y;
    const ex = wall.end.x, ey = wall.end.y;
    const wdx = ex - sx, wdy = ey - sy;
    const wLen = Math.hypot(wdx, wdy);
    if (wLen < 1) continue;

    // Enforce height from wallDefaults
    if (wallHeight && Number.isFinite(wallHeight)) {
      wall.heightStartCm = wallHeight;
      wall.heightEndCm = wallHeight;
    }

    if (Math.abs(wdy) < 0.5) {
      // Horizontal wall — check against hTargets
      const wallY = (sy + ey) / 2;
      const wallMinX = Math.min(sx, ex), wallMaxX = Math.max(sx, ex);
      for (const t of hTargets) {
        const dist = Math.abs(t.coord - wallY);
        // Tight tolerance: walls should be very close to the structural face they align with
        const overlap = Math.min(wallMaxX, t.rangeMax) - Math.max(wallMinX, t.rangeMin);
        if (dist <= tolerance && overlap > 1) {
          const { snappedCm } = snapToWallType(t.thickness, wallTypes);
          if (wall.thicknessCm !== snappedCm) {
            console.log(`[skeleton] wall ${wall.id}: H at y=${wallY.toFixed(1)} → ${t.type} (thick ${wall.thicknessCm} → ${snappedCm})`);
            wall.thicknessCm = snappedCm;
          }
          break;
        }
      }
    } else if (Math.abs(wdx) < 0.5) {
      // Vertical wall — check against vTargets
      const wallX = (sx + ex) / 2;
      const wallMinY = Math.min(sy, ey), wallMaxY = Math.max(sy, ey);
      for (const t of vTargets) {
        const dist = Math.abs(t.coord - wallX);
        // Tight tolerance: walls should be very close to the structural face they align with
        const overlap = Math.min(wallMaxY, t.rangeMax) - Math.max(wallMinY, t.rangeMin);
        if (dist <= tolerance && overlap > 1) {
          const { snappedCm } = snapToWallType(t.thickness, wallTypes);
          if (wall.thicknessCm !== snappedCm) {
            console.log(`[skeleton] wall ${wall.id}: V at x=${wallX.toFixed(1)} → ${t.type} (thick ${wall.thicknessCm} → ${snappedCm})`);
            wall.thicknessCm = snappedCm;
          }
          break;
        }
      }
    }
  }
}
