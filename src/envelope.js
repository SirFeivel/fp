// src/envelope.js — Envelope-room integration: edge matching, classification, recomputation
//
// The envelope is the building outer boundary. It starts as a detection result
// (detectedPolygonCm) and evolves as rooms are added/edited. This module owns
// all logic for matching room edges to envelope edges, classifying them, and
// recomputing the living envelope.

import { FLOOR_PLAN_RULES, snapToWallType } from "./floor-plan-rules.js";
import { findSharedEdgeMatches } from "./floor_geometry.js";
import { syncFloorWalls, mergeCollinearWalls, enforceNoParallelWalls, enforceAdjacentPositions } from "./walls.js";

/**
 * Find the wall entity linked to a specific room edge.
 * Local lookup to avoid circular dependency with walls.js.
 * @param {Object} floor
 * @param {string} roomId
 * @param {number} edgeIndex
 * @returns {Object|null}
 */
function findWallForEdge(floor, roomId, edgeIndex) {
  if (!floor?.walls) return null;
  return floor.walls.find(
    w => w.roomEdge && w.roomEdge.roomId === roomId && w.roomEdge.edgeIndex === edgeIndex
  ) || floor.walls.find(
    w => w.surfaces.some(s => s.roomId === roomId && s.edgeIndex === edgeIndex)
  ) || null;
}

/**
 * Match a room edge (two floor-global endpoints) against the envelope polygon.
 *
 * Finds the envelope edge that is collinear with the room edge (parallel,
 * within alignment tolerance, and with projection overlap > 1 cm).
 *
 * Uses the same collinearity logic as findSharedEdgeMatches in floor_geometry.js.
 *
 * @param {{ x: number, y: number }} edgeStart - Start of room edge (floor-global cm)
 * @param {{ x: number, y: number }} edgeEnd   - End of room edge (floor-global cm)
 * @param {Array<{ x: number, y: number }>} envelopePolygon - Envelope vertices (floor-global cm)
 * @param {number} [tolerance] - Base perpendicular distance tolerance (cm)
 * @param {Array<{ edgeIndex: number, thicknessCm: number }>} [wallThicknessEdges]
 *   Per-envelope-edge wall thickness measurements. When provided, the max
 *   perpendicular distance for each envelope edge becomes wallThickness + tolerance,
 *   because room inner edges are approximately wallThickness away from the
 *   envelope outer boundary.
 * @returns {{ envelopeEdgeIndex: number, overlapCm: number, perpDistCm: number } | null}
 */
export function matchEdgeToEnvelope(
  edgeStart,
  edgeEnd,
  envelopePolygon,
  tolerance = FLOOR_PLAN_RULES.alignmentToleranceCm,
  wallThicknessEdges = [],
) {
  if (!envelopePolygon || envelopePolygon.length < 3) return null;

  // Room edge direction and length
  const sdx = edgeEnd.x - edgeStart.x;
  const sdy = edgeEnd.y - edgeStart.y;
  const sLen = Math.hypot(sdx, sdy);
  if (sLen < 0.01) return null;

  const snx = sdx / sLen;
  const sny = sdy / sLen;

  let bestMatch = null;

  const n = envelopePolygon.length;
  for (let i = 0; i < n; i++) {
    const C = envelopePolygon[i];
    const D = envelopePolygon[(i + 1) % n];

    const tdx = D.x - C.x;
    const tdy = D.y - C.y;
    const tLen = Math.hypot(tdx, tdy);
    if (tLen < 0.01) continue;

    const tnx = tdx / tLen;
    const tny = tdy / tLen;

    // Must be parallel (cross product near zero)
    const cross = snx * tny - sny * tnx;
    if (Math.abs(cross) > 0.01) continue;

    // Must be collinear: perpendicular distance from edgeStart to envelope edge line.
    // Room inner edges are ~wallThickness away from envelope outer edges, so
    // maxDist = wallThickness + baseTolerance for each envelope edge.
    const vx = C.x - edgeStart.x;
    const vy = C.y - edgeStart.y;
    const perpDist = Math.abs(vx * sny - vy * snx);
    const edgeMeas = wallThicknessEdges.find(e => e.edgeIndex === i);
    const wallThick = edgeMeas?.thicknessCm || 0;
    const maxDist = wallThick + tolerance;
    if (perpDist > maxDist) continue;

    // Compute overlap: project envelope edge endpoints onto room edge axis
    const t1 = vx * snx + vy * sny;
    const vx2 = D.x - edgeStart.x;
    const vy2 = D.y - edgeStart.y;
    const t2 = vx2 * snx + vy2 * sny;

    const overlapStart = Math.max(0, Math.min(t1, t2));
    const overlapEnd = Math.min(sLen, Math.max(t1, t2));
    const overlapCm = overlapEnd - overlapStart;
    if (overlapCm < 1) continue;

    // Pick the best match (largest overlap, then smallest perpendicular distance)
    if (
      !bestMatch ||
      overlapCm > bestMatch.overlapCm ||
      (overlapCm === bestMatch.overlapCm && perpDist < bestMatch.perpDistCm)
    ) {
      bestMatch = { envelopeEdgeIndex: i, overlapCm, perpDistCm: perpDist };
    }
  }

  return bestMatch;
}

/**
 * Match a room edge against spanning walls on the floor.
 *
 * Same collinearity logic as matchEdgeToEnvelope but checks against
 * spanning wall segments instead of envelope edges.
 *
 * @param {{ x: number, y: number }} edgeStart - Start of room edge (floor-global cm)
 * @param {{ x: number, y: number }} edgeEnd   - End of room edge (floor-global cm)
 * @param {Array<{ startCm: {x,y}, endCm: {x,y}, thicknessCm: number }>} spanningWalls
 * @param {number} [tolerance]
 * @returns {{ spanningWallIndex: number, overlapCm: number, perpDistCm: number } | null}
 */
function matchEdgeToSpanningWall(
  edgeStart,
  edgeEnd,
  spanningWalls,
  tolerance = FLOOR_PLAN_RULES.alignmentToleranceCm,
) {
  if (!spanningWalls || spanningWalls.length === 0) return null;

  const sdx = edgeEnd.x - edgeStart.x;
  const sdy = edgeEnd.y - edgeStart.y;
  const sLen = Math.hypot(sdx, sdy);
  if (sLen < 0.01) return null;

  const snx = sdx / sLen;
  const sny = sdy / sLen;

  let bestMatch = null;

  for (let i = 0; i < spanningWalls.length; i++) {
    const sw = spanningWalls[i];
    const C = sw.startCm;
    const D = sw.endCm;

    const tdx = D.x - C.x;
    const tdy = D.y - C.y;
    const tLen = Math.hypot(tdx, tdy);
    if (tLen < 0.01) continue;

    const tnx = tdx / tLen;
    const tny = tdy / tLen;

    const cross = snx * tny - sny * tnx;
    if (Math.abs(cross) > 0.01) continue;

    const vx = C.x - edgeStart.x;
    const vy = C.y - edgeStart.y;
    // Use spanning wall thickness + tolerance for matching distance
    const maxDist = (sw.thicknessCm || 0) / 2 + tolerance;
    const perpDist = Math.abs(vx * sny - vy * snx);
    if (perpDist > maxDist) continue;

    const t1 = vx * snx + vy * sny;
    const vx2 = D.x - edgeStart.x;
    const vy2 = D.y - edgeStart.y;
    const t2 = vx2 * snx + vy2 * sny;

    const overlapStart = Math.max(0, Math.min(t1, t2));
    const overlapEnd = Math.min(sLen, Math.max(t1, t2));
    const overlapCm = overlapEnd - overlapStart;
    if (overlapCm < 1) continue;

    if (
      !bestMatch ||
      overlapCm > bestMatch.overlapCm ||
      (overlapCm === bestMatch.overlapCm && perpDist < bestMatch.perpDistCm)
    ) {
      bestMatch = { spanningWallIndex: i, overlapCm, perpDistCm: perpDist };
    }
  }

  return bestMatch;
}

/**
 * Classify each edge of a room polygon relative to the envelope and other rooms.
 *
 * Classifications:
 *   "envelope"  — coincides with an envelope boundary edge
 *   "spanning"  — coincides with a spanning wall
 *   "shared"    — coincides with another room's edge
 *   "interior"  — inside envelope, not shared
 *   "extending" — extends beyond current envelope
 *
 * @param {Object} room - Room with polygonVertices[] and floorPosition
 * @param {Object} floor - Floor with layout.envelope and rooms[]
 * @returns {Array<{ type: string, envelopeMatch?: Object, spanningMatch?: Object, sharedMatches?: Array }>}
 */
export function classifyRoomEdges(room, floor) {
  const verts = room.polygonVertices;
  if (!verts || verts.length < 3) return [];

  const pos = room.floorPosition || { x: 0, y: 0 };
  const envelope = floor?.layout?.envelope;
  // Use detectedPolygonCm for classification — it's the clean original boundary.
  // The recomputed polygonCm can be jagged from union artifacts, which would
  // produce wrong matches. The detected boundary is the ground truth.
  const envelopePoly = envelope?.detectedPolygonCm || envelope?.polygonCm;
  const envThicknesses = envelope?.wallThicknesses?.edges || [];
  const spanningWalls = envelope?.spanningWalls || [];
  const otherRooms = (floor.rooms || []).filter(r => r.id !== room.id);

  console.log(`[envelope] classifyRoomEdges room=${room.id}, ${verts.length} edges, floorPos=(${pos.x},${pos.y})`);
  console.log(`[envelope]   envelope polygon: ${envelopePoly ? envelopePoly.length + ' verts' : 'NONE'} (${envelope?.detectedPolygonCm ? 'detected' : 'recomputed'})`);
  console.log(`[envelope]   envThicknesses: ${envThicknesses.length} edges, spanning walls: ${spanningWalls.length}, other rooms: ${otherRooms.length}`);

  const n = verts.length;
  const classifications = [];

  for (let i = 0; i < n; i++) {
    const A = verts[i];
    const B = verts[(i + 1) % n];
    const globalA = { x: pos.x + A.x, y: pos.y + A.y };
    const globalB = { x: pos.x + B.x, y: pos.y + B.y };

    const entry = { type: "interior" };

    // 1. Check against envelope (pass wall thicknesses so tolerance accounts for wall depth)
    if (envelopePoly && envelopePoly.length >= 3) {
      const envMatch = matchEdgeToEnvelope(globalA, globalB, envelopePoly, undefined, envThicknesses);
      if (envMatch) {
        // Check if the room edge extends beyond the envelope edge
        const envEdgeA = envelopePoly[envMatch.envelopeEdgeIndex];
        const envEdgeB = envelopePoly[(envMatch.envelopeEdgeIndex + 1) % envelopePoly.length];
        const envLen = Math.hypot(envEdgeB.x - envEdgeA.x, envEdgeB.y - envEdgeA.y);
        const roomLen = Math.hypot(globalB.x - globalA.x, globalB.y - globalA.y);

        // If the room edge overlap covers less than the room edge length,
        // part of it extends beyond
        if (envMatch.overlapCm < roomLen - 1) {
          entry.type = "extending";
        } else {
          entry.type = "envelope";
        }
        entry.envelopeMatch = envMatch;
        classifications.push(entry);
        continue;
      }
    }

    // 2. Check against spanning walls
    const swMatch = matchEdgeToSpanningWall(globalA, globalB, spanningWalls);
    if (swMatch) {
      entry.type = "spanning";
      entry.spanningMatch = swMatch;
      classifications.push(entry);
      continue;
    }

    // 3. Check against other rooms
    const sharedMatches = findSharedEdgeMatches(room, i, otherRooms);
    if (sharedMatches.length > 0) {
      entry.type = "shared";
      entry.sharedMatches = sharedMatches;
      classifications.push(entry);
      continue;
    }

    // 4. Default: interior
    classifications.push(entry);
  }

  const summary = classifications.map((c, i) => `edge${i}:${c.type}`).join(', ');
  console.log(`[envelope]   classification result: [${summary}]`);
  return classifications;
}

/**
 * Apply wall thicknesses to a room's walls based on edge classification.
 *
 * Rules:
 *   "envelope" / "extending" — inherit per-edge thickness from envelope.wallThicknesses,
 *                               snapped via snapToWallType
 *   "spanning"               — inherit spanning wall's thickness
 *   "shared"                 — use partition wall type (thinnest)
 *   "interior"               — keep detected thickness, snapped to wall type
 *
 * @param {Object} floor - Floor with walls[], layout.envelope, layout.wallDefaults
 * @param {Object} room  - Room with id, polygonVertices
 * @param {Array<{ type: string, envelopeMatch?: Object, spanningMatch?: Object }>} classifications
 * @param {Array<{ edgeIndex: number, thicknessCm: number }>} [detectedEdgeThicknesses]
 *   - Raw per-edge thickness measurements from detection (optional).
 *     Used for direct index matching on interior edges. For edges where
 *     rectification changes index ordering, the caller should fall back
 *     to midpoint-proximity matching using the raw polygon.
 */
export function assignWallTypesFromClassification(
  floor,
  room,
  classifications,
  detectedEdgeThicknesses,
) {
  const envelope = floor?.layout?.envelope;
  const wallTypes = floor?.layout?.wallDefaults?.types;
  const envThicknesses = envelope?.wallThicknesses?.edges || [];

  console.log(`[envelope] assignWallTypesFromClassification room=${room.id}, ${classifications.length} edges`);
  console.log(`[envelope]   wallTypes: ${JSON.stringify(wallTypes)}`);
  console.log(`[envelope]   envThicknesses: ${JSON.stringify(envThicknesses)}`);
  console.log(`[envelope]   detectedEdgeThicknesses: ${JSON.stringify(detectedEdgeThicknesses)}`);

  for (let i = 0; i < classifications.length; i++) {
    const cls = classifications[i];
    const wall = findWallForEdge(floor, room.id, i);
    if (!wall) {
      console.log(`[envelope]   edge ${i} (${cls.type}): NO WALL FOUND`);
      continue;
    }

    const prevThickness = wall.thicknessCm;

    switch (cls.type) {
      case "envelope":
      case "extending": {
        const envIdx = cls.envelopeMatch?.envelopeEdgeIndex;
        const envEdgeMeas = envThicknesses.find(e => e.edgeIndex === envIdx);
        if (envEdgeMeas && Number.isFinite(envEdgeMeas.thicknessCm)) {
          const { snappedCm, typeId } = snapToWallType(envEdgeMeas.thicknessCm, wallTypes);
          wall.thicknessCm = snappedCm;
          console.log(`[envelope]   edge ${i} (${cls.type}): envEdge=${envIdx}, measured=${envEdgeMeas.thicknessCm}cm → snapped=${snappedCm}cm (${typeId}), was=${prevThickness}cm`);
        } else {
          console.log(`[envelope]   edge ${i} (${cls.type}): envEdge=${envIdx}, NO thickness measurement found`);
        }
        break;
      }

      case "spanning": {
        const swIdx = cls.spanningMatch?.spanningWallIndex;
        const spanningWalls = envelope?.spanningWalls || [];
        const sw = spanningWalls[swIdx];
        if (sw && Number.isFinite(sw.thicknessCm)) {
          const { snappedCm, typeId } = snapToWallType(sw.thicknessCm, wallTypes);
          wall.thicknessCm = snappedCm;
          console.log(`[envelope]   edge ${i} (spanning): sw=${swIdx}, measured=${sw.thicknessCm}cm → snapped=${snappedCm}cm (${typeId}), was=${prevThickness}cm`);
        } else {
          console.log(`[envelope]   edge ${i} (spanning): sw=${swIdx}, NO thickness data`);
        }
        break;
      }

      case "shared": {
        const sorted = [...(wallTypes || [])].sort((a, b) => a.thicknessCm - b.thicknessCm);
        if (sorted.length > 0) {
          wall.thicknessCm = sorted[0].thicknessCm;
          console.log(`[envelope]   edge ${i} (shared): → partition=${sorted[0].thicknessCm}cm, was=${prevThickness}cm`);
        } else {
          console.log(`[envelope]   edge ${i} (shared): no wall types defined`);
        }
        break;
      }

      case "interior":
      default: {
        if (detectedEdgeThicknesses) {
          const detected = findDetectedThicknessForEdge(
            i, detectedEdgeThicknesses,
          );
          if (detected !== null) {
            const { snappedCm, typeId } = snapToWallType(detected, wallTypes);
            wall.thicknessCm = snappedCm;
            console.log(`[envelope]   edge ${i} (interior): detected=${detected}cm → snapped=${snappedCm}cm (${typeId}), was=${prevThickness}cm`);
          } else {
            console.log(`[envelope]   edge ${i} (interior): no detected thickness match, keeping=${prevThickness}cm`);
          }
        } else {
          console.log(`[envelope]   edge ${i} (interior): no detection data, keeping=${prevThickness}cm`);
        }
        break;
      }
    }
  }
}

/**
 * Find the detected thickness measurement for a rectified edge by direct index match.
 *
 * This is a fast-path lookup when detection edge indices happen to correspond to
 * rectified edge indices. For cases where rectification changes vertex count or
 * ordering, the caller (confirmDetection) falls back to midpoint-proximity matching
 * using the raw polygon, which this function cannot do without it.
 *
 * @param {number} rectifiedEdgeIndex
 * @param {Array<{ edgeIndex: number, thicknessCm: number }>} detectedEdges
 * @returns {number|null} Thickness in cm, or null if no match
 */
function findDetectedThicknessForEdge(rectifiedEdgeIndex, detectedEdges) {
  if (!detectedEdges) return null;

  const { minCm, maxCm } = FLOOR_PLAN_RULES.wallThickness;

  for (const edgeMeas of detectedEdges) {
    if (edgeMeas.thicknessCm < minCm || edgeMeas.thicknessCm > maxCm) continue;
    if (edgeMeas.edgeIndex === rectifiedEdgeIndex) {
      return edgeMeas.thicknessCm;
    }
  }

  return null;
}

/**
 * Extend the skeleton boundary for a room's "extending" edges.
 *
 * When a room edge is classified as "extending", it means the room's outer
 * boundary (inner edge + wall thickness) overshoots the envelope edge length.
 * This function moves the envelope vertex at the overshot endpoint so the
 * skeleton boundary grows to contain the room.
 *
 * For detected rooms (post-alignToEnvelope), extensions are small (0.2–0.6cm)
 * and vertex movement is exact. For manual rooms, extensions can be large
 * (hundreds of cm). Large moves propagate to the adjacent edge's other vertex
 * to maintain axis alignment (no diagonal edges).
 *
 * Invariants preserved:
 *   - Edge count unchanged (vertex movement only, no insertion)
 *   - wallThicknesses indices stable
 *   - Extension is monotonic (vertices only move outward)
 *   - Axis-aligned edges stay axis-aligned after extension
 *
 * @param {Object} floor - Floor with layout.envelope.polygonCm
 * @param {Object} room  - Room with polygonVertices, floorPosition
 * @param {Array<{ type: string, envelopeMatch?: Object }>} classifications
 */
export function extendSkeletonForRoom(floor, room, classifications) {
  const envelope = floor?.layout?.envelope;
  if (!envelope?.polygonCm || envelope.polygonCm.length < 3) {
    console.log(`[envelope] extendSkeletonForRoom: no polygonCm, skipping`);
    return;
  }

  const poly = envelope.polygonCm;
  const pos = room.floorPosition || { x: 0, y: 0 };
  const verts = room.polygonVertices;
  if (!verts || verts.length < 3) return;

  const extendingEdges = classifications
    .map((cls, i) => ({ cls, i }))
    .filter(({ cls }) => cls.type === "extending" && cls.envelopeMatch);

  if (extendingEdges.length === 0) {
    console.log(`[envelope] extendSkeletonForRoom room=${room.id}: no extending edges`);
    return;
  }

  console.log(`[envelope] extendSkeletonForRoom room=${room.id}: ${extendingEdges.length} extending edge(s)`);

  for (const { cls, i } of extendingEdges) {
    const envIdx = cls.envelopeMatch.envelopeEdgeIndex;
    const n = poly.length;
    const envA = poly[envIdx];
    const envB = poly[(envIdx + 1) % n];

    // Room edge in global coords
    const A = verts[i];
    const B = verts[(i + 1) % verts.length];
    const globalA = { x: pos.x + A.x, y: pos.y + A.y };
    const globalB = { x: pos.x + B.x, y: pos.y + B.y };

    // Envelope edge direction and length
    const edx = envB.x - envA.x;
    const edy = envB.y - envA.y;
    const eLen = Math.hypot(edx, edy);
    if (eLen < 0.01) continue;

    const enx = edx / eLen; // unit direction along envelope edge
    const eny = edy / eLen;

    // Project room edge endpoints onto envelope edge axis
    // t = dot(point - envA, edgeDir)
    const tRoomA = (globalA.x - envA.x) * enx + (globalA.y - envA.y) * eny;
    const tRoomB = (globalB.x - envA.x) * enx + (globalB.y - envA.y) * eny;
    const tMin = Math.min(tRoomA, tRoomB);
    const tMax = Math.max(tRoomA, tRoomB);

    // Check if room extends beyond start (t < 0) or end (t > eLen) of envelope edge
    if (tMin < -0.01) {
      // Room extends beyond the start vertex (envA)
      const extension = -tMin;
      const dx = enx * tMin;
      const dy = eny * tMin;
      envA.x += dx;
      envA.y += dy;
      console.log(`[envelope] extendSkeletonForRoom: edge ${i} extending skeleton edge ${envIdx} by ${extension.toFixed(2)}cm at start`);

      // Propagate to keep adjacent edge axis-aligned.
      // envA is shared with the previous edge: envPrev → envA.
      const envPrev = poly[(envIdx - 1 + n) % n];
      propagateAxisAlignment(envPrev, envA, dx, dy);
    }

    if (tMax > eLen + 0.01) {
      // Room extends beyond the end vertex (envB)
      const extension = tMax - eLen;
      const dx = enx * (tMax - eLen);
      const dy = eny * (tMax - eLen);
      envB.x += dx;
      envB.y += dy;
      console.log(`[envelope] extendSkeletonForRoom: edge ${i} extending skeleton edge ${envIdx} by ${extension.toFixed(2)}cm at end`);

      // Propagate to keep adjacent edge axis-aligned.
      // envB is shared with the next edge: envB → envC.
      const envC = poly[(envIdx + 2) % n];
      propagateAxisAlignment(envC, envB, dx, dy);
    }
  }
}

/**
 * After moving `movedVertex` by (dx,dy), check if the edge from `otherVertex`
 * to `movedVertex` became non-axis-aligned. If the edge was originally
 * horizontal or vertical, propagate the moved coordinate to `otherVertex`
 * to maintain alignment.
 */
function propagateAxisAlignment(otherVertex, movedVertex, dx, dy) {
  // Reconstruct the original edge direction (before the move)
  const origX = movedVertex.x - dx;
  const origY = movedVertex.y - dy;
  const wasHorizontal = Math.abs(otherVertex.y - origY) < 0.5;
  const wasVertical = Math.abs(otherVertex.x - origX) < 0.5;

  if (wasHorizontal && Math.abs(dy) > 0.5) {
    // Edge was horizontal (constant y), move broke y alignment → propagate y
    console.log(`[envelope] extendSkeletonForRoom: propagating y to adjacent vertex to maintain axis alignment`);
    otherVertex.y = movedVertex.y;
  } else if (wasVertical && Math.abs(dx) > 0.5) {
    // Edge was vertical (constant x), move broke x alignment → propagate x
    console.log(`[envelope] extendSkeletonForRoom: propagating x to adjacent vertex to maintain axis alignment`);
    otherVertex.x = movedVertex.x;
  }
}

/**
 * Full wall+envelope pipeline for room mutations (add/delete/resize).
 *
 * Runs:
 *   1. syncFloorWalls (without position enforcement — thicknesses are still defaults)
 *   2. mergeCollinearWalls
 *   3. classifyRoomEdges + assignWallTypesFromClassification + extendSkeletonForRoom for ALL rooms
 *   4. enforceNoParallelWalls + enforceAdjacentPositions (with correct thicknesses)
 *   5. recomputeEnvelope (no-op when rooms exist, reset when no rooms)
 *
 * Call sites that previously did syncFloorWalls + recomputeEnvelope separately
 * should use this helper instead to get classification and constraint enforcement.
 *
 * @param {Object} floor - Floor with rooms[], walls[], layout.envelope
 */

/**
 * Classify room edges and extend the skeleton for all rooms on a floor.
 *
 * This is the lightweight pipeline for manual room operations (add, delete,
 * resize). It runs classification + wall type assignment + skeleton extension
 * but does NOT enforce positions or parallel walls, avoiding corruption of
 * manually placed room positions.
 *
 * Call after syncFloorWalls in structure.js and main.js manual paths.
 *
 * @param {Object} floor - Floor with rooms[], walls[], layout.envelope
 */
export function classifyAndExtendRooms(floor) {
  const envelope = floor?.layout?.envelope;
  if (!envelope) {
    console.log(`[envelope] classifyAndExtendRooms: no envelope, skipping`);
    return;
  }

  // Ensure all rooms have polygonVertices for classification.
  // Rectangular rooms only have widthCm/heightCm — synthesize vertices.
  const allRooms = (floor.rooms || []);
  for (const room of allRooms) {
    if (!room.polygonVertices && room.widthCm > 0 && room.heightCm > 0) {
      room.polygonVertices = [
        { x: 0, y: 0 },
        { x: room.widthCm, y: 0 },
        { x: room.widthCm, y: room.heightCm },
        { x: 0, y: room.heightCm },
      ];
      console.log(`[envelope] classifyAndExtendRooms: synthesized polygonVertices for rect room ${room.id} (${room.widthCm}x${room.heightCm})`);
    }
  }

  const validRooms = allRooms.filter(r => r.polygonVertices?.length >= 3);

  if (validRooms.length === 0) {
    console.log(`[envelope] classifyAndExtendRooms: no valid rooms, resetting envelope`);
    recomputeEnvelope(floor);
    return;
  }

  console.log(`[envelope] classifyAndExtendRooms: ${validRooms.length} rooms`);
  for (const room of validRooms) {
    const cls = classifyRoomEdges(room, floor);
    assignWallTypesFromClassification(floor, room, cls);
    extendSkeletonForRoom(floor, room, cls);
  }
  console.log(`[envelope] classifyAndExtendRooms: done`);
}

export function syncFloorWallsAndEnvelope(floor) {
  console.log(`[envelope] syncFloorWallsAndEnvelope: ${floor?.rooms?.length || 0} rooms`);

  // 1. Create/merge walls (skip position enforcement — we'll do it with correct thicknesses)
  syncFloorWalls(floor, { enforcePositions: false });
  mergeCollinearWalls(floor);
  console.log(`[envelope]   after wall sync+merge: ${floor?.walls?.length || 0} walls`);

  // 2. Classify, assign wall types, and extend skeleton for ALL rooms
  // Synthesize polygonVertices for rectangular rooms that only have widthCm/heightCm
  for (const room of (floor.rooms || [])) {
    if (!room.polygonVertices && room.widthCm > 0 && room.heightCm > 0) {
      room.polygonVertices = [
        { x: 0, y: 0 },
        { x: room.widthCm, y: 0 },
        { x: room.widthCm, y: room.heightCm },
        { x: 0, y: room.heightCm },
      ];
    }
  }
  const validRooms = (floor.rooms || []).filter(r => r.polygonVertices?.length >= 3);
  for (const room of validRooms) {
    const cls = classifyRoomEdges(room, floor);
    assignWallTypesFromClassification(floor, room, cls);
    extendSkeletonForRoom(floor, room, cls);
  }
  console.log(`[envelope]   classified and extended ${validRooms.length} rooms`);
  console.log(`[envelope] syncFloorWallsAndEnvelope: extending skeleton for ${validRooms.length} rooms`);

  // 3. Enforce constraints with correct thicknesses
  enforceNoParallelWalls(floor);
  enforceAdjacentPositions(floor);
  console.log(`[envelope]   after constraint enforcement: ${floor?.walls?.length || 0} walls`);

  // 4. Recompute envelope (no-op when rooms exist, reset when no rooms)
  recomputeEnvelope(floor);
  console.log(`[envelope]   final envelope: ${floor?.layout?.envelope?.polygonCm?.length || 0} verts`);
}

/**
 * Recompute the living envelope from rooms and detected boundary.
 *
 * With edge extension (extendSkeletonForRoom), skeleton growth happens
 * incrementally per room during classification. This function now handles:
 *   - Migration: ensure detectedPolygonCm exists
 *   - No rooms: reset polygonCm to detectedPolygonCm
 *   - Rooms present: no-op (skeleton already extended incrementally)
 *
 * The detected envelope is preserved as `detectedPolygonCm`.
 *
 * @param {Object} floor - Floor with rooms[], walls[], layout.envelope
 */
export function recomputeEnvelope(floor) {
  const envelope = floor?.layout?.envelope;
  if (!envelope) {
    console.log(`[envelope] recomputeEnvelope: no envelope on floor, skipping`);
    return;
  }

  // Ensure detectedPolygonCm exists (migration: rename polygonCm on first call)
  if (!envelope.detectedPolygonCm && envelope.polygonCm) {
    console.log(`[envelope] recomputeEnvelope: migrating polygonCm → detectedPolygonCm (${envelope.polygonCm.length} verts)`);
    envelope.detectedPolygonCm = envelope.polygonCm;
  }

  const rooms = floor.rooms || [];

  if (rooms.length === 0) {
    console.log(`[envelope] recomputeEnvelope: no rooms → reset to detected boundary (${envelope.detectedPolygonCm?.length || 0} verts)`);
    envelope.polygonCm = envelope.detectedPolygonCm
      ? [...envelope.detectedPolygonCm.map(p => ({ x: p.x, y: p.y }))]
      : null;
    return;
  }

  console.log(`[envelope] recomputeEnvelope: ${rooms.length} rooms present, skeleton already extended incrementally — no-op`);
}

/**
 * Round to 1 decimal place (0.1 cm precision).
 */
function round1(v) {
  return Math.round(v * 10) / 10;
}

/**
 * Snap a new room's floor position so its edges align with envelope edges.
 *
 * Same pattern as alignToExistingRooms in floor-plan-rules.js, but matching
 * against envelope edges and snapping to the inner face (envelope edge
 * position offset inward by wall thickness).
 *
 * Envelope alignment takes priority over room-to-room alignment, so this
 * should be called before alignToExistingRooms.
 *
 * @param {Array<{x: number, y: number}>} newVertices - Room polygon (room-local cm)
 * @param {{x: number, y: number}} newFloorPos - Proposed floor position
 * @param {Object} envelope - floor.layout.envelope with polygonCm, wallThicknesses
 * @param {Object} [rules] - Floor plan rules
 * @returns {{ vertices: Array, floorPosition: {x: number, y: number} }}
 */
export function alignToEnvelope(newVertices, newFloorPos, envelope, rules = FLOOR_PLAN_RULES) {
  console.log(`[envelope] alignToEnvelope: floorPos=(${newFloorPos.x},${newFloorPos.y}), ${newVertices?.length || 0} verts`);
  // Use detectedPolygonCm (clean detected boundary) — the recomputed polygonCm
  // can be jagged from union artifacts, which would produce wrong snap targets.
  const envelopePoly = envelope?.detectedPolygonCm || envelope?.polygonCm;
  if (!envelopePoly || envelopePoly.length < 3 || !newVertices?.length) {
    console.log(`[envelope]   no envelope polygon → no alignment`);
    return { vertices: newVertices, floorPosition: newFloorPos };
  }

  const tol = rules.alignmentToleranceCm;
  const envThicknesses = envelope?.wallThicknesses?.edges || [];

  // Collect envelope edge axis values, offset inward by wall thickness
  const envHLines = []; // { y, len } for horizontal envelope edges
  const envVLines = []; // { x, len } for vertical envelope edges

  // Compute winding sign for inward normal direction
  let signedArea2 = 0;
  const n = envelopePoly.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    signedArea2 += envelopePoly[i].x * envelopePoly[j].y - envelopePoly[j].x * envelopePoly[i].y;
  }
  const sign = signedArea2 > 0 ? 1 : -1;

  for (let i = 0; i < n; i++) {
    const a = envelopePoly[i];
    const b = envelopePoly[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) continue;

    // Get wall thickness for this envelope edge
    const edgeMeas = envThicknesses.find(e => e.edgeIndex === i);
    const thickness = edgeMeas?.thicknessCm || 0;

    // Inward normal: opposite of outward
    // Outward: sign * (dy/len, -dx/len); Inward: -sign * (dy/len, -dx/len)
    const inNx = -sign * (dy / len);
    const inNy = -sign * (-dx / len);

    if (Math.abs(dy) < 0.5) {
      // Horizontal envelope edge — inner face Y
      const envY = (a.y + b.y) / 2;
      const innerY = envY + inNy * thickness;
      envHLines.push({ y: innerY, len });
    } else if (Math.abs(dx) < 0.5) {
      // Vertical envelope edge — inner face X
      const envX = (a.x + b.x) / 2;
      const innerX = envX + inNx * thickness;
      envVLines.push({ x: innerX, len });
    }
  }

  // Find best alignment deltas
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
      const newY = newFloorPos.y + (a.y + b.y) / 2;
      for (const line of envHLines) {
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
      const newX = newFloorPos.x + (a.x + b.x) / 2;
      for (const line of envVLines) {
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

  const aligned = {
    vertices: newVertices,
    floorPosition: {
      x: round1(newFloorPos.x + bestDeltaX),
      y: round1(newFloorPos.y + bestDeltaY),
    },
  };
  console.log(`[envelope]   envHLines: ${JSON.stringify(envHLines)}`);
  console.log(`[envelope]   envVLines: ${JSON.stringify(envVLines)}`);
  console.log(`[envelope]   bestDeltaX=${bestDeltaX} (score=${bestXScore}), bestDeltaY=${bestDeltaY} (score=${bestYScore})`);
  console.log(`[envelope]   result floorPos=(${aligned.floorPosition.x},${aligned.floorPosition.y})`);
  return aligned;
}
