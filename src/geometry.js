import polygonClipping from "polygon-clipping";
import { degToRad, getCurrentRoom, DEFAULT_TILE_PRESET, DEFAULT_SKIRTING_PRESET, resolvePresetTile, resolvePresetGrout } from "./core.js";
import {
  CIRCLE_APPROXIMATION_STEPS,
  TILE_MARGIN_MULTIPLIER,
  TILE_AREA_TOLERANCE,
  BOND_PERIOD_MIN,
  BOND_PERIOD_MAX,
  BOND_PERIOD_EPSILON,
  EPSILON,
  HEX_STEP_RATIO
} from "./constants.js";
export function svgEl(tag, attrs = {}) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

export function roomPolygon(room) {
  // Circle rooms: approximate as polygon for polygon-clipping
  if (room?.circle && room.circle.rx > 0) {
    const { cx, cy, rx, ry } = room.circle;
    const steps = CIRCLE_APPROXIMATION_STEPS * 4;
    const ring = [];
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      ring.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
    }
    return [[ring]];
  }

  // Room must have polygon vertices (v8+ requirement)
  if (room?.polygonVertices && room.polygonVertices.length >= 3) {
    const ring = room.polygonVertices.map(p => [p.x, p.y]);
    // Close the ring if not already closed
    if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) {
      ring.push([ring[0][0], ring[0][1]]);
    }
    // Return in polygon-clipping MultiPolygon format: [Polygon[Ring[Point]]]
    return [[ring]];
  }

  // Return empty polygon if no valid polygonVertices
  return [[[[0, 0], [0, 0], [0, 0], [0, 0], [0, 0]]]];
}

export function getRoomBounds(room) {
  // Circle rooms
  if (room?.circle && room.circle.rx > 0) {
    const { cx, cy, rx, ry } = room.circle;
    return { minX: cx - rx, minY: cy - ry, maxX: cx + rx, maxY: cy + ry, width: 2 * rx, height: 2 * ry };
  }

  // Room must have polygon vertices (v8+ requirement)
  if (room?.polygonVertices && room.polygonVertices.length >= 3) {
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;
    for (const p of room.polygonVertices) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    return {
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX,
      height: maxY - minY
    };
  }

  // Return empty bounds if no valid polygonVertices
  return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
}

/**
 * Returns true when a room has exactly 4 polygon vertices forming an
 * axis-aligned rectangle (exactly 2 distinct x-values and 2 distinct y-values).
 * Used to distinguish plain rectangular rooms (which support bounding-box
 * resize handles) from freeform polygons that happen to have 4 vertices.
 */
export function isRectRoom(room) {
  const verts = room?.polygonVertices;
  if (!verts || verts.length !== 4) return false;
  const xs = new Set(verts.map(v => v.x));
  const ys = new Set(verts.map(v => v.y));
  return xs.size === 2 && ys.size === 2;
}

export function multiPolygonToPathD(mp) {
  let d = "";
  for (const poly of mp) {
    for (const ring of poly) {
      if (!ring.length) continue;
      d += `M ${ring[0][0]} ${ring[0][1]} `;
      for (let i = 1; i < ring.length; i++)
        d += `L ${ring[i][0]} ${ring[i][1]} `;
      d += "Z ";
    }
  }
  return d.trim();
}

/**
 * Calculates the total perimeter of a MultiPolygon.
 * This includes outer rings and any inner rings (holes).
 */
export function computeMultiPolygonPerimeter(mp) {
  if (!mp || !Array.isArray(mp)) return 0;
  let total = 0;
  for (const poly of mp) {
    for (const ring of poly) {
      if (ring.length < 2) continue;
      for (let i = 0; i < ring.length - 1; i++) {
        const p1 = ring[i];
        const p2 = ring[i + 1];
        const dx = p2[0] - p1[0];
        const dy = p2[1] - p1[1];
        total += Math.sqrt(dx * dx + dy * dy);
      }
    }
  }
  return total;
}

export function computeSkirtingArea(room, exclusions) {
  if (!room) return { mp: null, error: "No room" };

  const roomSkirtingEnabled = room.skirting?.enabled !== false;
  const skirtingExclusions = (exclusions || []).filter(ex => ex.skirtingEnabled !== false);

  // Room must have polygonVertices or circle (v8+ requirement)
  if (!(room.circle && room.circle.rx > 0) && (!room.polygonVertices || room.polygonVertices.length < 3)) {
    if (skirtingExclusions.length === 0) {
      return { mp: null, error: null };
    }
    // Only exclusions, no room polygon
    const { mp: activeExclusionsMP } = computeExclusionsUnion(skirtingExclusions);
    return { mp: activeExclusionsMP, error: null };
  }

  const mp = roomPolygon(room);
  const totalRoomMP = roomSkirtingEnabled ? mp : null;
  const activeRoomMP = roomSkirtingEnabled ? mp : null;

  // Early return if nothing to render
  if (!activeRoomMP && skirtingExclusions.length === 0) {
    return { mp: null, error: null };
  }

  const { mp: activeExclusionsMP } = computeExclusionsUnion(skirtingExclusions);

  try {
    let resultMP;
    if (!activeRoomMP) {
      resultMP = activeExclusionsMP;
    } else if (!activeExclusionsMP) {
      resultMP = activeRoomMP;
    } else {
      // XOR for independent toggles: (Room - Exclusions) + (Exclusions - Room)
      resultMP = polygonClipping.xor(activeRoomMP, activeExclusionsMP);
    }

    if (!resultMP) return { mp: null, error: null };

    // Intersect with total room footprint to avoid skirting outside
    if (totalRoomMP) {
      resultMP = polygonClipping.intersection(resultMP, totalRoomMP);
    }

    return { mp: resultMP, error: null };
  } catch (e) {
    return { mp: activeRoomMP || activeExclusionsMP, error: String(e?.message || e) };
  }
}

/**
 * Calculates the lengths of all segments where skirting should be applied.
 * Returns an array of segment objects: { p1, p2, length, id, excluded }
 */
export function computeSkirtingSegments(room, includeExcluded = false, floor = null) {
  if (!room) return [];
  const allExcl = getAllFloorExclusions(room);
  // Only 3D objects create skirting perimeters. 2D exclusions (zones, voids) are
  // purely planar and do not represent vertical surfaces.
  const skirtingExcl = allExcl.filter(e => e._isObject3d);
  const area = computeSkirtingArea(room, skirtingExcl);
  if (!area.mp) return [];

  // Boundary check uses only 3D objects — zone exclusions don't interrupt room wall skirting.
  const avail = computeAvailableArea(room, skirtingExcl);
  if (!avail.mp) return [];

  const skirting = room.skirting || {};
  const tileW = Number(room.tile?.widthCm) || DEFAULT_TILE_PRESET.widthCm;
  const tileH = Number(room.tile?.heightCm) || DEFAULT_TILE_PRESET.heightCm;
  const longSide = Math.max(tileW, tileH);
  const pieceLength = skirting.type === "bought"
    ? (Number(skirting.boughtWidthCm) || DEFAULT_SKIRTING_PRESET.lengthCm)
    : longSide;
  // Grout width determines tile step; pieces must use same step as visual tiles
  const groutW = Number(room.grout?.widthCm) || 0;
  const stepX = pieceLength + groutW;

  // Build doorway intervals per polygon edge for fast lookup
  const doorwayIntervals = buildDoorwayIntervals(room, floor);

  const segments = [];
  for (const poly of area.mp) {
    for (const ring of poly) {
      if (ring.length < 2) continue;
      for (let i = 0; i < ring.length - 1; i++) {
        const p1 = ring[i];
        const p2 = ring[i + 1];

        const dx = p2[0] - p1[0];
        const dy = p2[1] - p1[1];
        const wallLength = Math.sqrt(dx * dx + dy * dy);
        if (wallLength <= 0) continue;

        let overlaps = boundaryOverlapIntervals(p1, p2, avail.mp);
        if (overlaps.length === 0) continue;

        // Subtract doorway intervals from skirting overlaps
        if (doorwayIntervals.length > 0) {
          overlaps = subtractDoorwayIntervals(overlaps, p1, p2, wallLength, doorwayIntervals);
          if (overlaps.length === 0) continue;
        }

        // Normalize points for stable Wall ID regardless of direction
        const pts = [p1, p2].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        const wallId = `w${pts[0][0].toFixed(2)},${pts[0][1].toFixed(2)}-${pts[1][0].toFixed(2)},${pts[1][1].toFixed(2)}`;
        const unitDx = dx / wallLength;
        const unitDy = dy / wallLength;

        // Center-align pieces to match the visual tile layout produced by computeSkirtingZoneTiles.
        // The visual renderer uses preset="center" + originOverride={x: wallLen/2}, which shifts
        // the anchor by -tw/2: anchorX = wallLen/2 - pieceLength/2.
        // Steps use (pieceLength + grout) so piece boundaries match tile boundaries exactly.
        const anchor = wallLength / 2 - pieceLength / 2;
        const centerOffset = ((anchor % stepX) + stepX) % stepX; // positive modulo
        const hasLeftCut = centerOffset > EPSILON;
        const indexOffset = hasLeftCut ? 1 : 0; // p0 reserved for left cut when it exists

        for (const [startDist, endDist] of overlaps) {
          // Left cut: [0, centerOffset] → p0 (only when centerOffset > 0)
          if (hasLeftCut && startDist < centerOffset && endDist > 0) {
            const pieceStart = Math.max(startDist, 0);
            const pieceEnd = Math.min(endDist, centerOffset);
            if (pieceEnd - pieceStart > EPSILON) {
              const segP1 = [p1[0] + unitDx * pieceStart, p1[1] + unitDy * pieceStart];
              const segP2 = [p1[0] + unitDx * pieceEnd, p1[1] + unitDy * pieceEnd];
              const pieceId = `${wallId}-p0`;
              const isExcluded = Boolean(room.excludedSkirts?.includes(pieceId));
              if (includeExcluded || !isExcluded) {
                segments.push({ p1: segP1, p2: segP2, length: pieceEnd - pieceStart, id: pieceId, excluded: isExcluded });
              }
            }
          }

          // Full pieces and right cut: starting from centerOffset, step = stepX
          if (endDist > centerOffset) {
            const relStart = Math.max(startDist, centerOffset) - centerOffset;
            const relEnd = endDist - centerOffset;
            const kStart = Math.max(0, Math.floor(relStart / stepX));
            const kEnd = Math.floor((relEnd - EPSILON) / stepX);

            for (let k = kStart; k <= kEnd; k++) {
              const pieceStart = Math.max(startDist, centerOffset + k * stepX);
              const pieceEnd = Math.min(endDist, Math.min(wallLength, centerOffset + (k + 1) * stepX));
              if (pieceEnd - pieceStart <= EPSILON) continue;

              const j = k + indexOffset;
              const segP1 = [p1[0] + unitDx * pieceStart, p1[1] + unitDy * pieceStart];
              const segP2 = [p1[0] + unitDx * pieceEnd, p1[1] + unitDy * pieceEnd];
              const pieceId = `${wallId}-p${j}`;
              const isExcluded = Boolean(room.excludedSkirts?.includes(pieceId));
              if (includeExcluded || !isExcluded) {
                segments.push({ p1: segP1, p2: segP2, length: pieceEnd - pieceStart, id: pieceId, excluded: isExcluded });
              }
            }
          }
        }
      }
    }
  }
  return segments;
}

/**
 * Build sorted doorway intervals from wall entities (or empty if no floor).
 * Each interval is { edgeIndex, startCm, endCm, edgeStartPt, edgeDirX, edgeDirY, edgeLen }.
 */
function buildDoorwayIntervals(room, floor) {
  const verts = room.polygonVertices;
  if (!verts || verts.length < 3) return [];
  if (!floor?.walls) return [];

  const intervals = [];
  for (let i = 0; i < verts.length; i++) {
    // Find wall for this edge
    const wall = floor.walls.find(
      w => w.roomEdge && w.roomEdge.roomId === room.id && w.roomEdge.edgeIndex === i
    ) || floor.walls.find(
      w => w.surfaces && w.surfaces.some(s => s.roomId === room.id && s.edgeIndex === i)
    );

    if (!wall || !wall.doorways || wall.doorways.length === 0) continue;

    const A = verts[i];
    const B = verts[(i + 1) % verts.length];
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const L = Math.sqrt(dx * dx + dy * dy);
    if (L < 1) continue;

    for (const dw of wall.doorways) {
      intervals.push({
        edgeIndex: i,
        startCm: dw.offsetCm,
        endCm: dw.offsetCm + dw.widthCm,
        edgeStartX: A.x,
        edgeStartY: A.y,
        edgeDirX: dx / L,
        edgeDirY: dy / L,
        edgeLen: L
      });
    }
  }
  return intervals;
}

/**
 * Subtract doorway intervals from skirting overlap intervals.
 * Matches by checking if the skirting segment lies on a polygon edge with doorways.
 */
function subtractDoorwayIntervals(overlaps, p1, p2, wallLength, doorwayIntervals) {
  if (!doorwayIntervals || doorwayIntervals.length === 0) return overlaps;

  const eps = EPSILON;

  // Find doorway intervals that match this skirting segment
  const matchingIntervals = [];

  for (const interval of doorwayIntervals) {
    const { edgeStartX, edgeStartY, edgeDirX, edgeDirY, edgeLen, startCm, endCm } = interval;

    // Check if p1→p2 is collinear with this edge
    const segDx = p2[0] - p1[0];
    const segDy = p2[1] - p1[1];
    const cross = edgeDirX * segDy - edgeDirY * segDx;
    if (Math.abs(cross) > eps) continue;

    // Check if p1 is on the edge line
    const toP1x = p1[0] - edgeStartX;
    const toP1y = p1[1] - edgeStartY;
    const cross2 = edgeDirX * toP1y - edgeDirY * toP1x;
    if (Math.abs(cross2) > eps) continue;

    // Project p1 onto edge to find the offset
    const t1 = toP1x * edgeDirX + toP1y * edgeDirY;
    // Direction: same or reversed?
    const dot = segDx * edgeDirX + segDy * edgeDirY;
    const sameDir = dot >= 0;
    const baseOffset = t1;

    // Calculate doorway exclusion in skirting-local coordinates
    let dwStart, dwEnd;
    if (sameDir) {
      dwStart = startCm - baseOffset;
      dwEnd = endCm - baseOffset;
    } else {
      dwStart = baseOffset - endCm;
      dwEnd = baseOffset - startCm;
    }

    if (dwEnd > eps && dwStart < wallLength - eps) {
      matchingIntervals.push([Math.max(0, dwStart), Math.min(wallLength, dwEnd)]);
    }
  }

  if (matchingIntervals.length === 0) return overlaps;

  // Sort exclusions
  matchingIntervals.sort((a, b) => a[0] - b[0]);

  // Subtract exclusions from each overlap
  const result = [];
  for (const [oStart, oEnd] of overlaps) {
    let cursor = oStart;
    for (const [exStart, exEnd] of matchingIntervals) {
      if (exStart > cursor && exStart < oEnd) {
        result.push([cursor, Math.min(exStart, oEnd)]);
      }
      cursor = Math.max(cursor, exEnd);
    }
    if (cursor < oEnd - eps) {
      result.push([cursor, oEnd]);
    }
  }
  return result;
}

/**
 * Checks if a segment [p1, p2] lies on the boundary of a MultiPolygon.
 */
function isSegmentOnBoundary(p1, p2, mp) {
  const eps = EPSILON;
  for (const poly of mp) {
    for (const ring of poly) {
      if (ring.length < 2) continue;
      for (let i = 0; i < ring.length - 1; i++) {
        const q1 = ring[i];
        const q2 = ring[i + 1];
        if (isSubSegment(p1, p2, q1, q2, eps)) return true;
      }
    }
  }
  return false;
}

function boundaryOverlapIntervals(p1, p2, mp) {
  const eps = EPSILON;
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const wallLength = Math.sqrt(dx * dx + dy * dy);
  if (wallLength <= 0) return [];

  const useX = Math.abs(dx) >= Math.abs(dy);
  const axisDelta = useX ? dx : dy;
  if (Math.abs(axisDelta) < eps) return [];

  const intervals = [];

  for (const poly of mp) {
    for (const ring of poly) {
      if (ring.length < 2) continue;
      for (let i = 0; i < ring.length - 1; i++) {
        const q1 = ring[i];
        const q2 = ring[i + 1];
        if (!isPointOnLine(q1, p1, p2, eps) || !isPointOnLine(q2, p1, p2, eps)) continue;

        const t1 = ((useX ? q1[0] : q1[1]) - (useX ? p1[0] : p1[1])) / axisDelta;
        const t2 = ((useX ? q2[0] : q2[1]) - (useX ? p1[0] : p1[1])) / axisDelta;
        const tStart = Math.max(Math.min(t1, t2), 0);
        const tEnd = Math.min(Math.max(t1, t2), 1);
        if (tEnd - tStart > eps) {
          intervals.push([tStart * wallLength, tEnd * wallLength]);
        }
      }
    }
  }

  if (!intervals.length) return [];
  intervals.sort((a, b) => a[0] - b[0]);

  const merged = [intervals[0]];
  for (let i = 1; i < intervals.length; i++) {
    const last = merged[merged.length - 1];
    const cur = intervals[i];
    if (cur[0] <= last[1] + eps) {
      last[1] = Math.max(last[1], cur[1]);
    } else {
      merged.push(cur);
    }
  }

  return merged;
}

/**
 * Checks if segment [p1, p2] is a subset of [q1, q2].
 */
function isSubSegment(p1, p2, q1, q2, eps) {
  // Check if p1 and p2 lie on the line passing through q1 and q2
  if (!isPointOnLine(p1, q1, q2, eps)) return false;
  if (!isPointOnLine(p2, q1, q2, eps)) return false;

  // Check if they are within the bounds of q1, q2
  const minX = Math.min(q1[0], q2[0]) - eps;
  const maxX = Math.max(q1[0], q2[0]) + eps;
  const minY = Math.min(q1[1], q2[1]) - eps;
  const maxY = Math.max(q1[1], q2[1]) + eps;

  return p1[0] >= minX && p1[0] <= maxX &&
         p1[1] >= minY && p1[1] <= maxY &&
         p2[0] >= minX && p2[0] <= maxX &&
         p2[1] >= minY && p2[1] <= maxY;
}

function isPointOnLine(p, q1, q2, eps) {
  const dx = q2[0] - q1[0];
  const dy = q2[1] - q1[1];

  // Vertical line
  if (Math.abs(dx) < eps) {
    return Math.abs(p[0] - q1[0]) < eps;
  }
  // Horizontal line
  if (Math.abs(dy) < eps) {
    return Math.abs(p[1] - q1[1]) < eps;
  }

  // General case: collinearity via cross product
  // (p.y - q1.y) / (q2.y - q1.y) == (p.x - q1.x) / (q2.x - q1.x)
  const cross = (p[1] - q1[1]) * dx - (p[0] - q1[0]) * dy;
  return Math.abs(cross) < eps * Math.max(Math.abs(dx), Math.abs(dy));
}

/**
 * Calculates the total length where skirting should be applied.
 */
export function computeSkirtingPerimeter(room, floor = null) {
  const segments = computeSkirtingSegments(room, false, floor);
  return segments.reduce((sum, s) => sum + s.length, 0);
}

export function rotatePoint2(x, y, ox, oy, rad) {
  const dx = x - ox,
    dy = y - oy;
  const cos = Math.cos(rad),
    sin = Math.sin(rad);
  return { x: ox + dx * cos - dy * sin, y: oy + dx * sin + dy * cos };
}

export function tileRectPolygon(x, y, tw, th, originX, originY, rotRad) {
  const p1 = rotatePoint2(x, y, originX, originY, rotRad);
  const p2 = rotatePoint2(x + tw, y, originX, originY, rotRad);
  const p3 = rotatePoint2(x + tw, y + th, originX, originY, rotRad);
  const p4 = rotatePoint2(x, y + th, originX, originY, rotRad);
  return [
    [
      [
        [p1.x, p1.y],
        [p2.x, p2.y],
        [p3.x, p3.y],
        [p4.x, p4.y],
        [p1.x, p1.y],
      ],
    ],
  ];
}

export function tileHexPolygon(cx, cy, widthCm, originX, originY, rotRad) {
  const sideLength = widthCm / Math.sqrt(3);
  const halfWidth = widthCm / 2;
  const quarterHeight = sideLength / 2;
  const halfHeight = sideLength;

  const points = [
    [cx - halfWidth, cy - quarterHeight],
    [cx - halfWidth, cy + quarterHeight],
    [cx, cy + halfHeight],
    [cx + halfWidth, cy + quarterHeight],
    [cx + halfWidth, cy - quarterHeight],
    [cx, cy - halfHeight]
  ];

  const rotatedPoints = points.map(([px, py]) => {
    const rotated = rotatePoint2(px, py, originX, originY, rotRad);
    return [rotated.x, rotated.y];
  });

  rotatedPoints.push([rotatedPoints[0][0], rotatedPoints[0][1]]);
  return [[rotatedPoints]];
}

export function tileRhombusPolygon(cx, cy, widthCm, heightCm, originX, originY, rotRad) {
  const hw = widthCm / 2;
  const hh = heightCm / 2;

  const points = [
    [cx, cy - hh],
    [cx + hw, cy],
    [cx, cy + hh],
    [cx - hw, cy]
  ];

  const rotatedPoints = points.map(([px, py]) => {
    const rotated = rotatePoint2(px, py, originX, originY, rotRad);
    return [rotated.x, rotated.y];
  });

  rotatedPoints.push([rotatedPoints[0][0], rotatedPoints[0][1]]);
  return [[rotatedPoints]];
}

export function ringArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i],
      [x2, y2] = ring[i + 1];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

export function multiPolyArea(mp) {
  if (!mp || !mp.length) return 0;
  let area = 0;
  for (const poly of mp) {
    if (!poly.length) continue;
    const outer = Math.abs(ringArea(poly[0] || []));
    let holes = 0;
    for (let i = 1; i < poly.length; i++)
      holes += Math.abs(ringArea(poly[i] || []));
    area += Math.max(0, outer - holes);
  }
  return area;
}

/**
 * Returns all exclusions that affect floor area, including objects3d footprints.
 * This is the single source of truth for "what subtracts from floor tiles".
 */
export function getAllFloorExclusions(room) {
  const excls = [...(room.exclusions || [])];
  for (const obj of (room.objects3d || [])) {
    if (obj.type === 'tri') {
      excls.push({
        type: 'tri', id: obj.id,
        p1: obj.p1, p2: obj.p2, p3: obj.p3,
        skirtingEnabled: obj.skirtingEnabled, _isObject3d: true
      });
    } else if (obj.type === 'freeform' && obj.vertices?.length >= 3) {
      excls.push({
        type: 'freeform', id: obj.id,
        vertices: obj.vertices,
        skirtingEnabled: obj.skirtingEnabled, _isObject3d: true
      });
    } else if (obj.type === 'cylinder') {
      excls.push({
        type: 'circle', id: obj.id,
        cx: obj.cx, cy: obj.cy, r: obj.r,
        skirtingEnabled: obj.skirtingEnabled, _isObject3d: true
      });
    } else {
      excls.push({
        type: 'rect', id: obj.id,
        x: obj.x, y: obj.y, w: obj.w, h: obj.h,
        skirtingEnabled: obj.skirtingEnabled, _isObject3d: true
      });
    }
  }
  return excls;
}

export function exclusionToPolygon(ex) {
  if (ex.type === "rect") {
    const x1 = ex.x,
      y1 = ex.y,
      x2 = ex.x + ex.w,
      y2 = ex.y + ex.h;
    return [
      [
        [
          [x1, y1],
          [x2, y1],
          [x2, y2],
          [x1, y2],
          [x1, y1],
        ],
      ],
    ];
  }
  if (ex.type === "circle") {
    const steps = CIRCLE_APPROXIMATION_STEPS;
    const ring = [];
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      ring.push([ex.cx + Math.cos(a) * ex.r, ex.cy + Math.sin(a) * ex.r]);
    }
    return [[ring]];
  }
  if (ex.type === "tri") {
    const ring = [
      [ex.p1.x, ex.p1.y],
      [ex.p2.x, ex.p2.y],
      [ex.p3.x, ex.p3.y],
      [ex.p1.x, ex.p1.y],
    ];
    return [[ring]];
  }
  if (ex.type === "freeform" && ex.vertices?.length >= 3) {
    const ring = ex.vertices.map(v => [v.x, v.y]);
    // Close the ring if not already closed
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      ring.push([first[0], first[1]]);
    }
    return [[ring]];
  }
  return null;
}

export function exclusionToRegion(excl, state) {
  const mp = exclusionToPolygon(excl);
  if (!mp) return null;
  const ring = mp[0][0];
  const verts = ring.slice(0, -1).map(([x, y]) => ({ x, y }));
  const xs = verts.map(v => v.x), ys = verts.map(v => v.y);
  const widthCm = Math.max(...xs) - Math.min(...xs);
  const heightCm = Math.max(...ys) - Math.min(...ys);
  console.log(`[geometry:exclusionToRegion] id=${excl.id} shape=${excl.type} verts=${verts.length} w=${widthCm.toFixed(1)} h=${heightCm.toFixed(1)}`);
  const tile = resolvePresetTile(excl.tile, state);
  const grout = excl.tile?.reference
    ? resolvePresetGrout(excl.grout, excl.tile.reference, state)
    : (excl.grout || { widthCm: 0.2, colorHex: '#ffffff' });
  return {
    id: excl.id,
    widthCm,
    heightCm,
    polygonVertices: verts,
    tile,
    grout: grout || { widthCm: 0.2, colorHex: '#ffffff' },
    pattern: excl.pattern || { type: 'grid', bondFraction: 0.5, rotationDeg: 0, offsetXcm: 0, offsetYcm: 0 },
    exclusions: [],
  };
}

export function computeExclusionsUnion(exclusions) {
  if (!exclusions?.length) return { mp: null, error: null };

  const polys = [];
  for (const ex of exclusions) {
    const poly = exclusionToPolygon(ex);
    if (poly) polys.push(poly);
  }
  if (!polys.length) return { mp: null, error: null };

  try {
    return { mp: polygonClipping.union(...polys), error: null };
  } catch (e) {
    return { mp: null, error: String(e?.message || e) };
  }
}

export function computeAvailableArea(room, exclusions) {
  const roomP = roomPolygon(room);
  const { mp: unionP, error } = computeExclusionsUnion(exclusions);
  if (!unionP) return { mp: roomP, error };

  try {
    return { mp: polygonClipping.difference(roomP, unionP), error: null };
  } catch (e) {
    return { mp: roomP, error: String(e?.message || e) };
  }
}

/**
 * Validate that a freeform exclusion in `room` (after a drag/resize) does not
 * overlap with any other freeform exclusion and stays within the room boundary.
 *
 * Returns { valid: true } or { valid: false, reason: string }.
 * Only checks freeform exclusions — rect/circle/tri exclusions are not zones
 * and do not participate in mutual-exclusivity enforcement.
 */
export function validateFreeformDrop(room, exclId) {
  const moved = room.exclusions?.find(e => e.id === exclId);
  if (!moved || moved.type !== 'freeform' || !moved.vertices?.length) {
    return { valid: true }; // not a freeform — skip
  }
  const movedMp = exclusionToPolygon(moved);
  if (!movedMp) return { valid: true };

  // 1. Must be fully within room boundary
  const roomMp = roomPolygon(room);
  try {
    const outside = polygonClipping.difference(movedMp, roomMp);
    if (outside.length > 0) {
      console.warn(`[geometry:validateFreeformDrop] excl=${exclId} outside room boundary`);
      return { valid: false, reason: 'outside-room' };
    }
  } catch (e) {
    return { valid: false, reason: String(e?.message || e) };
  }

  // 2. Must not overlap any other freeform exclusion
  const others = (room.exclusions || []).filter(
    e => e.id !== exclId && e.type === 'freeform' && e.vertices?.length >= 3
  );
  for (const other of others) {
    const otherMp = exclusionToPolygon(other);
    if (!otherMp) continue;
    try {
      const intersection = polygonClipping.intersection(movedMp, otherMp);
      if (intersection.length > 0) {
        console.warn(`[geometry:validateFreeformDrop] excl=${exclId} overlaps excl=${other.id}`);
        return { valid: false, reason: `overlaps-${other.id}` };
      }
    } catch (e) {
      return { valid: false, reason: String(e?.message || e) };
    }
  }

  return { valid: true };
}

/**
 * Ray-casting point-in-polygon test.
 * @param {{x:number,y:number}} pt
 * @param {{x:number,y:number}[]} vertices — open polygon (last point ≠ first)
 * @returns {boolean}
 */
export function pointInPolygon(pt, vertices) {
  let inside = false;
  const n = vertices.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = vertices[i].x, yi = vertices[i].y;
    const xj = vertices[j].x, yj = vertices[j].y;
    if (((yi > pt.y) !== (yj > pt.y)) &&
        (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Returns the polygon set for a floor room: the uncovered area (room minus all
 * exclusions, possibly multi-polygon) plus each freeform exclusion as a zone.
 *
 * Each entry: { id, type: 'uncovered'|'zone', exclId?: string, vertices: [{x,y}] }
 *
 * Only freeform exclusions become zone polygons (they're the ones created by the
 * divider tool and represent independently-tileable sub-surfaces).
 */
export function computeSurfacePolygons(room) {
  const allExcls = room.exclusions || [];
  const freeformExcls = allExcls.filter(e => e.type === 'freeform' && e.vertices?.length >= 3);

  const { mp: uncoveredMp } = computeAvailableArea(room, allExcls);
  const result = [];

  if (uncoveredMp) {
    uncoveredMp.forEach((poly, idx) => {
      const verts = poly[0].slice(0, -1).map(([x, y]) => ({ x, y }));
      if (verts.length >= 3) {
        result.push({ id: `uncovered-${idx}`, type: 'uncovered', vertices: verts });
      }
    });
  }

  for (const excl of freeformExcls) {
    result.push({ id: excl.id, type: 'zone', exclId: excl.id, vertices: excl.vertices });
  }

  console.log(`[geometry:computeSurfacePolygons] room=${room.id} uncovered=${result.filter(p => p.type === 'uncovered').length} zones=${freeformExcls.length}`);
  return result;
}

/**
 * Returns the footprint edges of a 3D object in room-local 2D coords,
 * each tagged with its face name matching createBoxFaceMapper conventions.
 * @param {Object} obj - 3D object (rect/tri/freeform)
 * @returns {Array} [{ p1, p2, face }]
 */
export function getObjFootprintEdges(obj) {
  if (obj.type === 'cylinder') {
    const steps = 16;
    const verts = Array.from({ length: steps }, (_, i) => {
      const a = (i / steps) * Math.PI * 2;
      return { x: obj.cx + Math.cos(a) * obj.r, y: obj.cy + Math.sin(a) * obj.r };
    });
    return verts.map((v, i) => ({ p1: v, p2: verts[(i + 1) % steps], face: `side-${i}` }));
  }
  if (obj.type === 'rect') {
    const { x, y, w, h } = obj;
    return [
      { p1: { x, y },               p2: { x: x + w, y },           face: 'front' },
      { p1: { x: x + w, y },        p2: { x: x + w, y: y + h },    face: 'right' },
      { p1: { x: x + w, y: y + h }, p2: { x, y: y + h },           face: 'back'  },
      { p1: { x, y: y + h },        p2: { x, y },                  face: 'left'  },
    ];
  }
  const verts = obj.type === 'tri'
    ? [obj.p1, obj.p2, obj.p3]
    : (obj.vertices || []);
  return verts.map((v, i) => ({
    p1: v,
    p2: verts[(i + 1) % verts.length],
    face: `side-${i}`,
  }));
}

/**
 * Detects contacts between a wall's inner face and 3D object side faces in a room.
 * Two surfaces are in contact when they are coplanar (collinear edges in plan view)
 * and their segments overlap horizontally and vertically.
 *
 * Returns exclusion data for both the wall surface and the object face so tiles
 * can be removed from both at the contact zone.
 *
 * @param {Object} room  - Room with objects3d[]
 * @param {Object} wall  - Wall entity { id, start, end, heightStartCm, heightEndCm }
 * @returns {Array} Contact records:
 *   { objId, face, overlapStart, overlapEnd, contactH, faceLocalX1, faceLocalX2 }
 *   - overlapStart/End: cm from wall.start along wall direction
 *   - contactH: height of contact zone in cm (from floor up)
 *   - faceLocalX1/X2: cm from face edge start along face direction
 */
export function computeSurfaceContacts(room, wall) {
  const contacts = [];
  const objects = room?.objects3d || [];
  if (!objects.length) return contacts;

  // wall.start/end are in floor-global coords (room polygon vertices + room.floorPosition).
  // obj.x/y are in room-local coords. Convert object vertices to floor-global before comparing.
  const fp = room?.floorPosition || { x: 0, y: 0 };

  const ax = wall.start.x, ay = wall.start.y;
  const bx = wall.end.x,   by = wall.end.y;
  const wallLen = Math.hypot(bx - ax, by - ay);
  if (wallLen < 0.1) return contacts;

  const dirX = (bx - ax) / wallLen;
  const dirY = (by - ay) / wallLen;
  const wallH = Math.max(wall.heightStartCm ?? 250, wall.heightEndCm ?? 250);

  for (const obj of objects) {
    const objH = obj.heightCm ?? 0;
    const contactH = Math.min(wallH, objH);
    if (contactH < 0.1) continue;

    for (const { p1, p2, face } of getObjFootprintEdges(obj)) {
      // Convert room-local object vertices to floor-global to match wall coordinate space
      const p1g = { x: p1.x + fp.x, y: p1.y + fp.y };
      const p2g = { x: p2.x + fp.x, y: p2.y + fp.y };

      const ex = p2g.x - p1g.x, ey = p2g.y - p1g.y;
      const eLen = Math.hypot(ex, ey);
      if (eLen < 0.1) continue;

      // Direction vectors must be parallel (cross product ≈ 0)
      const cross = dirX * (ey / eLen) - dirY * (ex / eLen);
      if (Math.abs(cross) > 0.01) continue;

      // p1g must lie on the wall line (perpendicular distance ≤ 1 cm).
      // Threshold is 1 cm to tolerate floating-point drift during drag placement.
      const dpx = p1g.x - ax, dpy = p1g.y - ay;
      const dist = Math.abs(dpx * (-dirY) + dpy * dirX);
      if (dist > 1.0) continue;

      // Project both segments onto the wall direction vector
      const tP1 = dpx * dirX + dpy * dirY;
      const tP2 = (p2g.x - ax) * dirX + (p2g.y - ay) * dirY;
      const overlapStart = Math.max(0, Math.min(tP1, tP2));
      const overlapEnd   = Math.min(wallLen, Math.max(tP1, tP2));
      if (overlapEnd - overlapStart < 0.1) continue;

      // Convert wall-space overlap to face-local x coordinates
      const edgeDirX = ex / eLen, edgeDirY = ey / eLen;
      const faceX1 = (ax + overlapStart * dirX - p1g.x) * edgeDirX + (ay + overlapStart * dirY - p1g.y) * edgeDirY;
      const faceX2 = (ax + overlapEnd   * dirX - p1g.x) * edgeDirX + (ay + overlapEnd   * dirY - p1g.y) * edgeDirY;

      contacts.push({
        objId: obj.id,
        face,
        overlapStart,
        overlapEnd,
        contactH,
        faceLocalX1: Math.min(faceX1, faceX2),
        faceLocalX2: Math.max(faceX1, faceX2),
      });
      console.log(`[surface-contact] wall=${wall.id} ↔ obj=${obj.id} face=${face}: overlap=[${overlapStart.toFixed(1)},${overlapEnd.toFixed(1)}] h=${contactH.toFixed(1)} faceX=[${Math.min(faceX1, faceX2).toFixed(1)},${Math.max(faceX1, faceX2).toFixed(1)}]`);
    }
  }
  return contacts;
}

/**
 * Computes the origin point for tile pattern placement.
 *
 * @param {Object} room - The room object
 * @param {Object} pattern - The pattern configuration
 * @param {Object} floor - Optional floor object for pattern linking support
 * @returns {Object} The origin point {x, y} in room-local coordinates
 */
export function computeOriginPoint(room, pattern, floor = null) {
  // Note: Pattern linking is now handled externally via originOverride parameter
  // passed to tilesForPreview. This function only computes room-local origin.

  // Standard room-local origin computation
  const bounds = getRoomBounds(room);
  const w = bounds.width;
  const h = bounds.height;
  const minX = bounds.minX;
  const minY = bounds.minY;

  const o = pattern?.origin || { preset: "tl", xCm: 0, yCm: 0 };
  const preset = o.preset || "tl";

  if (preset === "tl") return { x: minX, y: minY };
  if (preset === "tr") return { x: minX + w, y: minY };
  if (preset === "bl") return { x: minX, y: minY + h };
  if (preset === "br") return { x: minX + w, y: minY + h };
  if (preset === "center") return { x: minX + w / 2, y: minY + h / 2 };

  // "free"
  return { x: Number(o.xCm) || 0, y: Number(o.yCm) || 0 };
}

// helper: floor division for negative values (stable grid anchoring)
function floorDiv(a, b) {
  if (!(b > 0)) return 0;
  return Math.floor(a / b);
}

// helper: compute inverse-rotated bounds of the room around origin
// roomMinX/roomMinY: actual top-left corner of room (may be negative for composite rooms)
function inverseRotatedRoomBounds(w, h, origin, rotRad, roomMinX = 0, roomMinY = 0) {
  const inv = -rotRad;
  const pts = [
    rotatePoint2(roomMinX, roomMinY, origin.x, origin.y, inv),
    rotatePoint2(roomMinX + w, roomMinY, origin.x, origin.y, inv),
    rotatePoint2(roomMinX + w, roomMinY + h, origin.x, origin.y, inv),
    rotatePoint2(roomMinX, roomMinY + h, origin.x, origin.y, inv),
  ];
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

function detectBondPeriod(frac) {
  const f = Number(frac);
  if (!Number.isFinite(f) || f <= 0) return 0;
  const inv = 1 / f;
  const rounded = Math.round(inv);
  if (Math.abs(inv - rounded) < BOND_PERIOD_EPSILON &&
      rounded >= BOND_PERIOD_MIN &&
      rounded <= BOND_PERIOD_MAX) return rounded;
  return 0;
}

/**
 * Resolves room, floor, pattern settings, rotation, offset, origin, and room bounds
 * shared by all tilesForPreview* functions.
 * Returns null if no valid room is available.
 */
function prepareTileContext(state, roomOverride, floorOverride, originOverride, patternSettingsOverride) {
  const room = roomOverride || getCurrentRoom(state);
  if (!room) return null;
  const floor = floorOverride || (state.floors?.find(f => f.id === state.selectedFloorId) || null);
  const patternSettings = patternSettingsOverride || room.pattern;
  const rotDeg = Number(patternSettings?.rotationDeg) || 0;
  const rotRad = degToRad(rotDeg);
  const offX = Number(patternSettings?.offsetXcm) || 0;
  const offY = Number(patternSettings?.offsetYcm) || 0;
  const origin = originOverride || computeOriginPoint(room, patternSettings, floor);
  const preset = patternSettings?.origin?.preset || "tl";
  const bounds = getRoomBounds(room);
  return { room, floor, patternSettings, rotDeg, rotRad, offX, offY, origin, preset, bounds };
}

/**
 * Clips a tile polygon against the available area multipolygon.
 * Returns { d, isFull } or null if the tile doesn't intersect the area.
 */
function clipTileToArea(availableMP, tilePolygon, fullArea) {
  let clipped;
  try {
    clipped = polygonClipping.intersection(availableMP, tilePolygon);
  } catch (e) {
    return { error: String(e?.message || e) };
  }
  if (!clipped || !clipped.length) return null;
  const d = multiPolygonToPathD(clipped);
  if (!d) return null;
  const gotArea = multiPolyArea(clipped);
  const isFull = gotArea >= fullArea * TILE_AREA_TOLERANCE;
  return { d, isFull };
}

export function tilesForPreview(state, availableMP, roomOrInclude = null, maybeInclude = null, floorOverride = null, options = null) {
  let roomOverride = null;
  let includeExcluded = false;

  if (typeof roomOrInclude === 'boolean') {
    includeExcluded = roomOrInclude;
    roomOverride = null;
  } else {
    roomOverride = roomOrInclude;
    includeExcluded = maybeInclude === true;
  }

  const finalRoom = roomOverride || getCurrentRoom(state);

  // Get floor context for pattern linking (from override or state)
  const floor = floorOverride || (state.floors?.find(f => f.id === state.selectedFloorId) || null);

  // Extract options
  const originOverride = options?.originOverride || null;
  const effectiveSettings = options?.effectiveSettings || null;

  if (!finalRoom) {
    return { tiles: [], error: "Kein Raum ausgewählt." };
  }

  // Use effective settings if provided (for pattern group inheritance), otherwise use room's own settings.
  // Resolve through preset so that shape/dimensions are always authoritative from the preset registry
  // (consistent with prepareWallSurface which also calls resolvePresetTile).
  const rawTileSettings = effectiveSettings?.tile || finalRoom.tile;
  const tileSettings = rawTileSettings?.reference ? resolvePresetTile(rawTileSettings, state) : rawTileSettings;
  const rawGroutSettings = effectiveSettings?.grout || finalRoom.grout;
  const groutSettings = rawTileSettings?.reference
    ? (resolvePresetGrout(rawGroutSettings, rawTileSettings.reference, state) || rawGroutSettings)
    : rawGroutSettings;
  const patternSettings = effectiveSettings?.pattern || finalRoom.pattern;

  const tw = Number(tileSettings?.widthCm);
  const th = Number(tileSettings?.heightCm);
  const tileShape = tileSettings?.shape || "rect";
  const grout = Number(groutSettings?.widthCm) || 0;
  if (!(tw > 0) || !(th > 0) || grout < 0) {
    return { tiles: [], error: null };
  }

  if (tileShape === "hex") {
    return tilesForPreviewHex(state, availableMP, tw, th, grout, includeExcluded, finalRoom, floor, originOverride, patternSettings);
  }

  if (tileShape === "rhombus") {
    return tilesForPreviewRhombus(state, availableMP, tw, th, grout, includeExcluded, finalRoom, floor, originOverride, patternSettings);
  }

  if (tileShape === "square") {
    // For square tiles, we force width = height using the width value
    return tilesForPreviewSquare(state, availableMP, tw, grout, includeExcluded, finalRoom, floor, originOverride, patternSettings);
  }

  const type = patternSettings?.type || "grid";

  if (type === "herringbone") {
    return tilesForPreviewHerringbone(state, availableMP, tw, th, grout, includeExcluded, finalRoom, floor, originOverride, patternSettings);
  }

  if (type === "basketweave") {
    return tilesForPreviewBasketweave(state, availableMP, tw, th, grout, includeExcluded, finalRoom, floor, originOverride, patternSettings);
  }

  if (type === "doubleHerringbone") {
    return tilesForPreviewDoubleHerringbone(state, availableMP, tw, th, grout, includeExcluded, finalRoom, floor, originOverride, patternSettings);
  }

  if (type === "verticalStackAlternating") {
    return tilesForPreviewVerticalStackAlternating(state, availableMP, tw, th, grout, includeExcluded, finalRoom, floor, originOverride, patternSettings);
  }

  const stepX = tw + grout;
  const stepY = th + grout;

  const rotDeg = Number(patternSettings?.rotationDeg) || 0;
  const rotRad = degToRad(rotDeg);

  const offX = Number(patternSettings?.offsetXcm) || 0;
  const offY = Number(patternSettings?.offsetYcm) || 0;

  const origin = originOverride || computeOriginPoint(finalRoom, patternSettings, floor);
  const preset = patternSettings?.origin?.preset || "tl";

  const frac = Number(patternSettings?.bondFraction) || 0.5;
  const rowShiftCm = type === "runningBond" ? tw * frac : 0;
  const bondPeriod = type === "runningBond" ? detectBondPeriod(frac) : 0;

  const bounds = getRoomBounds(finalRoom);
  const w = bounds.width;
  const h = bounds.height;

  const b = inverseRotatedRoomBounds(w, h, origin, rotRad, bounds.minX, bounds.minY);

  const marginX = TILE_MARGIN_MULTIPLIER * stepX;
  const marginY = TILE_MARGIN_MULTIPLIER * stepY;

  const minX = b.minX - marginX;
  const maxX = b.maxX + marginX;
  const minY = b.minY - marginY;
  const maxY = b.maxY + marginY;

  // For preset="center": shift anchor by half tile so that a tile is centered on the origin point.
  let anchorX = origin.x + offX;
  let anchorY = origin.y + offY;
  if (preset === "center") {
    anchorX -= tw / 2;
    anchorY -= th / 2;
  }

  const startX = anchorX + floorDiv(minX - anchorX, stepX) * stepX;
  const startY = anchorY + floorDiv(minY - anchorY, stepY) * stepY;

  const estCols = Math.ceil((maxX - startX) / stepX) + 1;
  const estRows = Math.ceil((maxY - startY) / stepY) + 1;

  const tiles = [];

  for (let r = 0; r < estRows; r++) {
    const y = startY + r * stepY;

    // Running bond: periodic row shift to prevent cumulative drift at non-reciprocal fractions.
    let shift = 0;
    if (rowShiftCm) {
      if (bondPeriod > 0) shift = (r % bondPeriod) * rowShiftCm;
      else shift = (r % 2) * rowShiftCm; // fallback (reasonable)
    }

    for (let c = 0; c < estCols; c++) {
      const x = startX + c * stepX + shift;

      const tileId = `r${r}c${c}`;
      const isExcluded = Boolean(finalRoom.excludedTiles?.includes(tileId));
      if (!includeExcluded && isExcluded) continue;

      const tileP = tileRectPolygon(x, y, tw, th, origin.x, origin.y, rotRad);

      let clipped;
      try {
        clipped = polygonClipping.intersection(availableMP, tileP);
      } catch (e) {
        return { tiles: [], error: String(e?.message || e) };
      }
      if (!clipped || !clipped.length) continue;

      const d = multiPolygonToPathD(clipped);
      if (!d) continue;

      const fullArea = tw * th;
      const gotArea = multiPolyArea(clipped);
      const isFull = gotArea >= fullArea * TILE_AREA_TOLERANCE;

      tiles.push({ d, isFull, id: tileId, excluded: isExcluded });
    }
  }

  return { tiles, error: null };
}

function tilesForPreviewHex(state, availableMP, tw, th, grout, includeExcluded = false, roomOverride = null, floorOverride = null, originOverride = null, patternSettingsOverride = null) {
  const ctx = prepareTileContext(state, roomOverride, floorOverride, originOverride, patternSettingsOverride);
  if (!ctx) return { tiles: [], error: "Kein Raum ausgewählt." };
  const { room, origin, preset, rotRad, offX, offY, bounds } = ctx;

  const sideLength = tw / Math.sqrt(3);
  const hexHeight = sideLength * 2;
  const hexWidth = tw;

  const stepX = hexWidth + grout;
  const stepY = hexHeight * HEX_STEP_RATIO + grout;

  const b = inverseRotatedRoomBounds(bounds.width, bounds.height, origin, rotRad, bounds.minX, bounds.minY);

  const marginX = TILE_MARGIN_MULTIPLIER * stepX;
  const marginY = TILE_MARGIN_MULTIPLIER * stepY;

  let anchorX = origin.x + offX;
  let anchorY = origin.y + offY;
  if (preset === "center") { anchorX -= hexWidth / 2; anchorY -= hexHeight / 2; }

  const startX = anchorX + floorDiv(b.minX - marginX - anchorX, stepX) * stepX;
  const startY = anchorY + floorDiv(b.minY - marginY - anchorY, stepY) * stepY;

  const estCols = Math.ceil((b.maxX + marginX - startX) / stepX) + 2;
  const estRows = Math.ceil((b.maxY + marginY - startY) / stepY) + 2;

  const tiles = [];
  const hexFullArea = (3 * Math.sqrt(3) / 2) * sideLength * sideLength;

  for (let r = 0; r < estRows; r++) {
    const y = startY + r * stepY;
    const rowOffset = (r % 2) * (hexWidth * 0.5);

    for (let c = 0; c < estCols; c++) {
      const x = startX + c * stepX + rowOffset;
      const tileId = `hex-r${r}c${c}`;
      const isExcluded = Boolean(room.excludedTiles?.includes(tileId));
      if (!includeExcluded && isExcluded) continue;

      const result = clipTileToArea(availableMP, tileHexPolygon(x, y, tw, origin.x, origin.y, rotRad), hexFullArea);
      if (result?.error) return { tiles: [], error: result.error };
      if (!result) continue;

      tiles.push({ d: result.d, isFull: result.isFull, id: tileId, excluded: isExcluded });
    }
  }

  return { tiles, error: null };
}

function tilesForPreviewSquare(state, availableMP, tw, grout, includeExcluded = false, roomOverride = null, floorOverride = null, originOverride = null, patternSettingsOverride = null) {
  const ctx = prepareTileContext(state, roomOverride, floorOverride, originOverride, patternSettingsOverride);
  if (!ctx) return { tiles: [], error: "Kein Raum ausgewählt." };
  const { room, patternSettings, origin, preset, rotRad, offX, offY, bounds } = ctx;

  const type = patternSettings?.type || "grid";
  const frac = Number(patternSettings?.bondFraction) || 0.5;
  const rowShiftCm = type === "runningBond" ? tw * frac : 0;
  const bondPeriod = type === "runningBond" ? detectBondPeriod(frac) : 0;

  const stepX = tw + grout;
  const stepY = tw + grout;

  const b = inverseRotatedRoomBounds(bounds.width, bounds.height, origin, rotRad, bounds.minX, bounds.minY);
  const marginX = TILE_MARGIN_MULTIPLIER * stepX;
  const marginY = TILE_MARGIN_MULTIPLIER * stepY;

  let anchorX = origin.x + offX;
  let anchorY = origin.y + offY;
  if (preset === "center") { anchorX -= tw / 2; anchorY -= tw / 2; }

  const minX = b.minX - marginX, maxX = b.maxX + marginX;
  const minY = b.minY - marginY, maxY = b.maxY + marginY;
  const startX = anchorX + floorDiv(minX - anchorX, stepX) * stepX;
  const startY = anchorY + floorDiv(minY - anchorY, stepY) * stepY;

  const estCols = Math.ceil((maxX - startX) / stepX) + 1;
  const estRows = Math.ceil((maxY - startY) / stepY) + 1;

  const tiles = [];
  const fullArea = tw * tw;

  for (let r = 0; r < estRows; r++) {
    const y = startY + r * stepY;
    let shift = 0;
    if (rowShiftCm) {
      if (bondPeriod > 0) shift = (r % bondPeriod) * rowShiftCm;
      else shift = (r % 2) * rowShiftCm;
    }

    for (let c = 0; c < estCols; c++) {
      const x = startX + c * stepX + shift;
      const tileId = `sq-r${r}c${c}`;
      const isExcluded = Boolean(room.excludedTiles?.includes(tileId));
      if (!includeExcluded && isExcluded) continue;

      const result = clipTileToArea(availableMP, tileRectPolygon(x, y, tw, tw, origin.x, origin.y, rotRad), fullArea);
      if (result?.error) return { tiles: [], error: result.error };
      if (!result) continue;

      tiles.push({ d: result.d, isFull: result.isFull, id: tileId, excluded: isExcluded });
    }
  }

  return { tiles, error: null };
}

function tilesForPreviewRhombus(state, availableMP, tw, th, grout, includeExcluded = false, roomOverride = null, floorOverride = null, originOverride = null, patternSettingsOverride = null) {
  const ctx = prepareTileContext(state, roomOverride, floorOverride, originOverride, patternSettingsOverride);
  if (!ctx) return { tiles: [], error: "Kein Raum ausgewählt." };
  const { room, origin, preset, rotRad, offX, offY, bounds } = ctx;

  const stepX = tw + grout;
  const stepY = th / 2 + grout / 2;

  const b = inverseRotatedRoomBounds(bounds.width, bounds.height, origin, rotRad, bounds.minX, bounds.minY);
  const marginX = TILE_MARGIN_MULTIPLIER * stepX;
  const marginY = TILE_MARGIN_MULTIPLIER * stepY;

  let anchorX = origin.x + offX;
  let anchorY = origin.y + offY;
  if (preset === "center") { anchorX -= tw / 2; anchorY -= th / 2; }

  const minX = b.minX - marginX, maxX = b.maxX + marginX;
  const minY = b.minY - marginY, maxY = b.maxY + marginY;
  const startX = anchorX + floorDiv(minX - anchorX, stepX) * stepX;
  const startY = anchorY + floorDiv(minY - anchorY, stepY) * stepY;

  const estCols = Math.ceil((maxX - startX) / stepX) + 2;
  const estRows = Math.ceil((maxY - startY) / stepY) + 2;

  const tiles = [];
  const fullArea = (tw * th) / 2;

  for (let r = 0; r < estRows; r++) {
    const y = startY + r * stepY;
    const rowOffset = (r % 2) * (tw * 0.5);

    for (let c = 0; c < estCols; c++) {
      const x = startX + c * stepX + rowOffset;
      const tileId = `rho-r${r}c${c}`;
      const isExcluded = Boolean(room.excludedTiles?.includes(tileId));
      if (!includeExcluded && isExcluded) continue;

      const result = clipTileToArea(availableMP, tileRhombusPolygon(x, y, tw, th, origin.x, origin.y, rotRad), fullArea);
      if (result?.error) return { tiles: [], error: result.error };
      if (!result) continue;

      tiles.push({ d: result.d, isFull: result.isFull, id: tileId, excluded: isExcluded });
    }
  }

  return { tiles, error: null };
}

function tilesForPreviewHerringbone(state, availableMP, tw, th, grout, includeExcluded = false, roomOverride = null, floorOverride = null, originOverride = null, patternSettingsOverride = null) {
  const ctx = prepareTileContext(state, roomOverride, floorOverride, originOverride, patternSettingsOverride);
  if (!ctx) return { tiles: [], error: "Kein Raum ausgewählt." };
  const { room, origin, preset, rotRad, offX, offY, bounds } = ctx;

  const L = Math.max(tw, th);
  const W = Math.min(tw, th);
  const stepX = L + grout;
  const stepY = W + grout;
  const shear = Math.max(L - W, 0) + grout;

  const b = inverseRotatedRoomBounds(bounds.width, bounds.height, origin, rotRad, bounds.minX, bounds.minY);
  const margin = TILE_MARGIN_MULTIPLIER * (L + W + grout);
  const minX = b.minX - margin, maxX = b.maxX + margin;
  const minY = b.minY - margin, maxY = b.maxY + margin;

  let anchorX = origin.x + offX;
  let anchorY = origin.y + offY;
  if (preset === "center") { anchorX -= L / 2; anchorY -= W / 2; }

  const startRow = Math.floor((minY - anchorY) / stepY) - 2;
  const endRow = Math.ceil((maxY - anchorY) / stepY) + 2;
  const minRowShift = Math.min(startRow, endRow) * shear;
  const maxRowShift = Math.max(startRow, endRow) * shear;
  const startCol = Math.floor((minX - anchorX - maxRowShift) / stepX) - 2;
  const endCol = Math.ceil((maxX - anchorX - minRowShift) / stepX) + 2;

  const estRows = endRow - startRow + 1;
  const estCols = endCol - startCol + 1;

  const tiles = [];
  const fullArea = W * L;

  for (let row = startRow; row <= endRow; row++) {
    const baseY = anchorY + row * stepY;
    for (let col = startCol; col <= endCol; col++) {
      const baseX = anchorX + col * stepX + row * shear;
      const isHorizontal = (row + col) % 2 === 0;
      const tileId = `hb-r${row}c${col}`;
      const isExcluded = Boolean(room.excludedTiles?.includes(tileId));
      if (!includeExcluded && isExcluded) continue;

      const tileX = isHorizontal ? baseX : baseX + (L - W);
      const tileY = isHorizontal ? baseY : baseY - (L - W);
      const tileW = isHorizontal ? L : W;
      const tileH = isHorizontal ? W : L;

      const result = clipTileToArea(availableMP, tileRectPolygon(tileX, tileY, tileW, tileH, origin.x, origin.y, rotRad), fullArea);
      if (result?.error) return { tiles: [], error: result.error };
      if (!result) continue;

      tiles.push({ d: result.d, isFull: result.isFull, id: tileId, excluded: isExcluded });
    }
  }

  return { tiles, error: null };
}

// Export for testing
export { tilesForPreviewHerringbone };

function tilesForPreviewDoubleHerringbone(state, availableMP, tw, th, grout, includeExcluded = false, roomOverride = null, floorOverride = null, originOverride = null, patternSettingsOverride = null) {
  const ctx = prepareTileContext(state, roomOverride, floorOverride, originOverride, patternSettingsOverride);
  if (!ctx) return { tiles: [], error: "Kein Raum ausgewählt." };
  const { room, origin, preset, rotRad, offX, offY, bounds } = ctx;

  const L = Math.max(tw, th);
  const W = Math.min(tw, th);
  const W2 = 2 * W + grout;
  const stepX = L + grout;
  const stepY = W2 + grout;
  const shear = Math.max(L - W2, 0) + grout;

  const b = inverseRotatedRoomBounds(bounds.width, bounds.height, origin, rotRad, bounds.minX, bounds.minY);
  const margin = TILE_MARGIN_MULTIPLIER * (L + W2 + grout);
  const minX = b.minX - margin, maxX = b.maxX + margin;
  const minY = b.minY - margin, maxY = b.maxY + margin;

  let anchorX = origin.x + offX;
  let anchorY = origin.y + offY;
  if (preset === "center") { anchorX -= L / 2; anchorY -= W2 / 2; }

  const startRow = Math.floor((minY - anchorY) / stepY) - 2;
  const endRow = Math.ceil((maxY - anchorY) / stepY) + 2;
  const minRowShift = Math.min(startRow, endRow) * shear;
  const maxRowShift = Math.max(startRow, endRow) * shear;
  const startCol = Math.floor((minX - anchorX - maxRowShift) / stepX) - 2;
  const endCol = Math.ceil((maxX - anchorX - minRowShift) / stepX) + 2;

  const tiles = [];
  const fullArea = W * L;

  for (let row = startRow; row <= endRow; row++) {
    const baseY = anchorY + row * stepY;
    for (let col = startCol; col <= endCol; col++) {
      const baseX = anchorX + col * stepX + row * shear;
      const isHorizontal = (row + col) % 2 === 0;

      const placements = isHorizontal
        ? [
            { x: baseX, y: baseY, w: L, h: W, id: `dhb-r${row}c${col}-h0` },
            { x: baseX, y: baseY + W + grout, w: L, h: W, id: `dhb-r${row}c${col}-h1` },
          ]
        : [
            { x: baseX + (L - W2), y: baseY - (L - W2), w: W, h: L, id: `dhb-r${row}c${col}-v0` },
            { x: baseX + (L - W2) + W + grout, y: baseY - (L - W2), w: W, h: L, id: `dhb-r${row}c${col}-v1` },
          ];

      for (const t of placements) {
        const isExcluded = Boolean(room.excludedTiles?.includes(t.id));
        if (!includeExcluded && isExcluded) continue;

        const result = clipTileToArea(availableMP, tileRectPolygon(t.x, t.y, t.w, t.h, origin.x, origin.y, rotRad), fullArea);
        if (result?.error) return { tiles: [], error: result.error };
        if (!result) continue;

        tiles.push({ d: result.d, isFull: result.isFull, id: t.id, excluded: isExcluded });
      }
    }
  }

  return { tiles, error: null };
}

function tilesForPreviewVerticalStackAlternating(state, availableMP, tw, th, grout, includeExcluded = false, roomOverride = null, floorOverride = null, originOverride = null, patternSettingsOverride = null) {
  const ctx = prepareTileContext(state, roomOverride, floorOverride, originOverride, patternSettingsOverride);
  if (!ctx) return { tiles: [], error: "Kein Raum ausgewählt." };
  const { room, origin, preset, rotRad, offX, offY, bounds } = ctx;

  const L = Math.max(tw, th);
  const W = Math.min(tw, th);
  const stepX = W + grout;
  const stepY = L + grout;

  const b = inverseRotatedRoomBounds(bounds.width, bounds.height, origin, rotRad, bounds.minX, bounds.minY);
  const marginX = TILE_MARGIN_MULTIPLIER * stepX;
  const marginY = TILE_MARGIN_MULTIPLIER * stepY;

  let anchorX = origin.x + offX;
  let anchorY = origin.y + offY;
  if (preset === "center") { anchorX -= W / 2; anchorY -= L / 2; }

  const minX = b.minX - marginX, maxX = b.maxX + marginX;
  const minY = b.minY - marginY, maxY = b.maxY + marginY;
  const startCol = Math.floor((minX - anchorX) / stepX) - 2;
  const endCol = Math.ceil((maxX - anchorX) / stepX) + 2;
  const startRow = Math.floor((minY - anchorY) / stepY) - 2;
  const endRow = Math.ceil((maxY - anchorY) / stepY) + 2;

  const tiles = [];
  const fullArea = W * L;
  const colShift = stepY / 2;

  for (let col = startCol; col <= endCol; col++) {
    const baseX = anchorX + col * stepX;
    const shiftY = (col % 2) * colShift;
    for (let row = startRow; row <= endRow; row++) {
      const baseY = anchorY + row * stepY + shiftY;
      const tileId = `vsa-r${row}c${col}`;
      const isExcluded = Boolean(room.excludedTiles?.includes(tileId));
      if (!includeExcluded && isExcluded) continue;

      const result = clipTileToArea(availableMP, tileRectPolygon(baseX, baseY, W, L, origin.x, origin.y, rotRad), fullArea);
      if (result?.error) return { tiles: [], error: result.error };
      if (!result) continue;

      tiles.push({ d: result.d, isFull: result.isFull, id: tileId, excluded: isExcluded });
    }
  }

  return { tiles, error: null };
}

function tilesForPreviewBasketweave(state, availableMP, tw, th, grout, includeExcluded = false, roomOverride = null, floorOverride = null, originOverride = null, patternSettingsOverride = null) {
  const ctx = prepareTileContext(state, roomOverride, floorOverride, originOverride, patternSettingsOverride);
  if (!ctx) return { tiles: [], error: "Kein Raum ausgewählt." };
  const { room, origin, preset, rotRad, offX, offY, bounds } = ctx;

  const L = Math.max(tw, th);
  const W = Math.min(tw, th);
  const tilesPerStack = Math.max(1, Math.round(L / W));
  const unitW = 2 * L + 2 * grout;
  const unitH = L + grout;

  const b = inverseRotatedRoomBounds(bounds.width, bounds.height, origin, rotRad, bounds.minX, bounds.minY);
  const marginX = TILE_MARGIN_MULTIPLIER * unitW;
  const marginY = TILE_MARGIN_MULTIPLIER * unitH;

  let anchorX = origin.x + offX;
  let anchorY = origin.y + offY;
  if (preset === "center") { anchorX -= unitW / 2; anchorY -= unitH / 2; }

  const minX = b.minX - marginX, maxX = b.maxX + marginX;
  const minY = b.minY - marginY, maxY = b.maxY + marginY;
  const startCol = Math.floor((minX - anchorX) / unitW) - 2;
  const endCol = Math.ceil((maxX - anchorX) / unitW) + 2;
  const startRow = Math.floor((minY - anchorY) / unitH) - 2;
  const endRow = Math.ceil((maxY - anchorY) / unitH) + 2;

  const tiles = [];
  const fullArea = tw * th;

  for (let row = startRow; row <= endRow; row++) {
    const rowOffset = row % 2 === 0 ? 0 : (L + grout);
    const baseY = anchorY + row * unitH;
    for (let col = startCol; col <= endCol; col++) {
      const baseX = anchorX + col * unitW + rowOffset;

      for (let i = 0; i < tilesPerStack; i++) {
        const placements = [
          { x: baseX, y: baseY + i * (W + grout), w: L, h: W, id: `bw-r${row}c${col}-i${i}-h` },
          { x: baseX + L + grout + i * (W + grout), y: baseY, w: W, h: L, id: `bw-r${row}c${col}-i${i}-v` },
        ];

        for (const t of placements) {
          const isExcluded = Boolean(room.excludedTiles?.includes(t.id));
          if (!includeExcluded && isExcluded) continue;

          const result = clipTileToArea(availableMP, tileRectPolygon(t.x, t.y, t.w, t.h, origin.x, origin.y, rotRad), fullArea);
          if (result?.error) return { tiles: [], error: result.error };
          if (!result) continue;

          tiles.push({ d: result.d, isFull: result.isFull, id: t.id, excluded: isExcluded });
        }
      }
    }
  }

  return { tiles, error: null };
}

// ── Surface Divider Helpers ───────────────────────────────────────────────────

export function isPointInPolygon(point, vertices) {
  const { x, y } = point;
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const xi = vertices[i].x, yi = vertices[i].y;
    const xj = vertices[j].x, yj = vertices[j].y;
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

function insertPointOnRing(vertices, pt) {
  let bestIdx = -1, bestT = -1, bestDist = Infinity;
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const a = vertices[i], b = vertices[(i + 1) % n];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < 0.0001) continue;
    const t = Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / len2));
    const px = a.x + t * dx, py = a.y + t * dy;
    const dist = Math.hypot(pt.x - px, pt.y - py);
    if (dist < bestDist) { bestDist = dist; bestIdx = i; bestT = t; }
  }
  if (bestIdx < 0) {
    console.warn(`[geometry:insertPointOnRing] no edge found for pt=(${pt.x.toFixed(1)},${pt.y.toFixed(1)})`);
    return vertices;
  }
  if (bestT < 0.001 || bestT > 0.999) {
    console.log(`[geometry:insertPointOnRing] pt=(${pt.x.toFixed(1)},${pt.y.toFixed(1)}) t=${bestT.toFixed(3)} — coincident with vertex, skipping insert`);
    return vertices;
  }
  const result = [...vertices];
  result.splice(bestIdx + 1, 0, { x: pt.x, y: pt.y });
  console.log(`[geometry:insertPointOnRing] inserted at edge ${bestIdx} t=${bestT.toFixed(3)} dist=${bestDist.toFixed(2)}`);
  return result;
}

export function splitPolygonByLine(vertices, p1, p2) {
  const verts = insertPointOnRing(insertPointOnRing([...vertices], p1), p2);
  const i1 = verts.findIndex(v => Math.abs(v.x - p1.x) < 0.01 && Math.abs(v.y - p1.y) < 0.01);
  const i2 = verts.findIndex((v, i) => i !== i1 && Math.abs(v.x - p2.x) < 0.01 && Math.abs(v.y - p2.y) < 0.01);
  if (i1 < 0 || i2 < 0 || i1 === i2) {
    console.warn(`[geometry:splitPolygonByLine] degenerate: i1=${i1} i2=${i2} verts=${verts.length}`);
    return null;
  }
  const n = verts.length;
  const a = [], b = [];
  for (let i = i1; ; i = (i + 1) % n) { a.push(verts[i]); if (i === i2) break; }
  for (let i = i2; ; i = (i + 1) % n) { b.push(verts[i]); if (i === i1) break; }
  if (a.length < 3 || b.length < 3) {
    console.warn(`[geometry:splitPolygonByLine] sub-polygon too small: a=${a.length} b=${b.length}`);
    return null;
  }
  console.log(`[geometry:splitPolygonByLine] p1=(${p1.x.toFixed(1)},${p1.y.toFixed(1)}) p2=(${p2.x.toFixed(1)},${p2.y.toFixed(1)}) → a=${a.length} b=${b.length} verts`);
  return [a, b];
}

/**
 * Snap an edge direction (dx, dy) to the nearest angle in validAngles.
 * Returns the snapped angle in degrees [0, 360).
 */
export function snapEdgeAngleDeg(dx, dy, validAngles) {
  const raw = ((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360;
  let best = Math.round(raw), bestDiff = Infinity;
  for (const a of validAngles) {
    const diff = Math.min(Math.abs(raw - a), 360 - Math.abs(raw - a));
    if (diff < bestDiff) { bestDiff = diff; best = a; }
  }
  return best;
}

/**
 * Find the intersection of two infinite lines, each defined by a point and
 * a direction angle (degrees). Returns {x, y} or null if lines are parallel.
 */
export function lineIntersection(p1, angleDeg1, p2, angleDeg2) {
  const r1 = angleDeg1 * Math.PI / 180;
  const r2 = angleDeg2 * Math.PI / 180;
  const dx1 = Math.cos(r1), dy1 = Math.sin(r1);
  const dx2 = Math.cos(r2), dy2 = Math.sin(r2);
  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < 1e-9) return null; // parallel
  const t = ((p2.x - p1.x) * dy2 - (p2.y - p1.y) * dx2) / denom;
  return { x: p1.x + t * dx1, y: p1.y + t * dy1 };
}


