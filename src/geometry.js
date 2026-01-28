import polygonClipping from "polygon-clipping";
import { degToRad, getCurrentRoom } from "./core.js";
import {
  CIRCLE_APPROXIMATION_STEPS,
  TILE_MARGIN_MULTIPLIER,
  MAX_PREVIEW_TILES,
  TILE_AREA_TOLERANCE,
  BOND_PERIOD_MIN,
  BOND_PERIOD_MAX,
  BOND_PERIOD_EPSILON
} from "./constants.js";
import {
  getRoomSections,
  computeCompositePolygon,
  computeCompositeBounds,
  rectToPolygon
} from "./composite.js";

export { getRoomSections } from "./composite.js";

export function svgEl(tag, attrs = {}) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

export function roomPolygon(room) {
  const sections = getRoomSections(room);
  if (sections.length === 0) {
    return [[[[[0, 0], [0, 0], [0, 0], [0, 0], [0, 0]]]]];
  }

  const { mp, error } = computeCompositePolygon(sections);
  if (error || !mp) {
    // Return empty if there's an error, as migration should have handled valid legacy dimensions
    return [[[[[0, 0], [0, 0], [0, 0], [0, 0], [0, 0]]]]];
  }

  return mp;
}

export function getRoomBounds(room) {
  const sections = getRoomSections(room);
  if (sections.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }
  return computeCompositeBounds(sections);
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

  const allSections = getRoomSections(room);
  const activeSections = allSections.filter(s => s.skirtingEnabled !== false);
  const skirtingExclusions = (exclusions || []).filter(ex => ex.skirtingEnabled !== false);

  if (activeSections.length === 0 && skirtingExclusions.length === 0) {
    return { mp: null, error: null };
  }

  const { mp: totalRoomMP } = computeCompositePolygon(allSections);
  const { mp: activeSectionsMP } = computeCompositePolygon(activeSections);
  const { mp: activeExclusionsMP } = computeExclusionsUnion(skirtingExclusions);

  try {
    let resultMP;
    if (!activeSectionsMP) {
      resultMP = activeExclusionsMP;
    } else if (!activeExclusionsMP) {
      resultMP = activeSectionsMP;
    } else {
      // XOR for independent toggles: (Sections - Exclusions) + (Exclusions - Sections)
      resultMP = polygonClipping.xor(activeSectionsMP, activeExclusionsMP);
    }

    if (!resultMP) return { mp: null, error: null };

    // Intersect with total room footprint to avoid skirting outside
    if (totalRoomMP) {
      resultMP = polygonClipping.intersection(resultMP, totalRoomMP);
    }

    return { mp: resultMP, error: null };
  } catch (e) {
    return { mp: activeSectionsMP || activeExclusionsMP, error: String(e?.message || e) };
  }
}

/**
 * Calculates the lengths of all segments where skirting should be applied.
 * Returns an array of segment objects: { p1, p2, length, id, excluded }
 */
export function computeSkirtingSegments(room, includeExcluded = false) {
  if (!room) return [];
  const area = computeSkirtingArea(room, room.exclusions);
  if (!area.mp) return [];

  // Source of truth for physical walls
  const avail = computeAvailableArea(room, room.exclusions);
  if (!avail.mp) return [];

  const skirting = room.skirting || {};
  const pieceLength = skirting.type === "bought"
    ? (Number(skirting.boughtWidthCm) || 60)
    : (Number(room.tile?.widthCm) || 60);

  const segments = [];
  for (const poly of area.mp) {
    for (const ring of poly) {
      if (ring.length < 2) continue;
      for (let i = 0; i < ring.length - 1; i++) {
        const p1 = ring[i];
        const p2 = ring[i + 1];

        // Only keep segments that are part of the actual physical room/exclusion boundaries
        if (isSegmentOnBoundary(p1, p2, avail.mp)) {
          const dx = p2[0] - p1[0];
          const dy = p2[1] - p1[1];
          const wallLength = Math.sqrt(dx * dx + dy * dy);

          // Normalize points for stable Wall ID regardless of direction
          const pts = [p1, p2].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
          const wallId = `w${pts[0][0].toFixed(2)},${pts[0][1].toFixed(2)}-${pts[1][0].toFixed(2)},${pts[1][1].toFixed(2)}`;

          // Subdivide wall into pieces
          const numPieces = Math.ceil(wallLength / pieceLength);
          const unitDx = dx / wallLength;
          const unitDy = dy / wallLength;

          for (let j = 0; j < numPieces; j++) {
            const startDist = j * pieceLength;
            const endDist = Math.min((j + 1) * pieceLength, wallLength);
            
            const segP1 = [p1[0] + unitDx * startDist, p1[1] + unitDy * startDist];
            const segP2 = [p1[0] + unitDx * endDist, p1[1] + unitDy * endDist];
            
            // Stable ID for the piece
            const pieceId = `${wallId}-p${j}`;
            
            const isExcluded = Boolean(room.excludedSkirts?.includes(pieceId));
            if (!includeExcluded && isExcluded) continue;

            segments.push({
              p1: segP1,
              p2: segP2,
              length: endDist - startDist,
              id: pieceId,
              excluded: isExcluded
            });
          }
        }
      }
    }
  }
  return segments;
}

/**
 * Checks if a segment [p1, p2] lies on the boundary of a MultiPolygon.
 */
function isSegmentOnBoundary(p1, p2, mp) {
  const eps = 1e-6;
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
export function computeSkirtingPerimeter(room) {
  const segments = computeSkirtingSegments(room);
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
  return null;
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

export function computeOriginPoint(room, pattern) {
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
function inverseRotatedRoomBounds(w, h, origin, rotRad) {
  const inv = -rotRad;
  const pts = [
    rotatePoint2(0, 0, origin.x, origin.y, inv),
    rotatePoint2(w, 0, origin.x, origin.y, inv),
    rotatePoint2(w, h, origin.x, origin.y, inv),
    rotatePoint2(0, h, origin.x, origin.y, inv),
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

export function tilesForPreview(state, availableMP, roomOrInclude = null, maybeInclude = null) {
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
  if (!finalRoom) {
    return { tiles: [], error: "Kein Raum ausgewählt." };
  }

  const tw = Number(finalRoom.tile?.widthCm);
  const th = Number(finalRoom.tile?.heightCm);
  const tileShape = finalRoom.tile?.shape || "rect";
  const grout = Number(finalRoom.grout?.widthCm) || 0;
  if (!(tw > 0) || !(th > 0) || grout < 0) {
    return { tiles: [], error: null };
  }

  if (tileShape === "hex") {
    return tilesForPreviewHex(state, availableMP, tw, th, grout, includeExcluded, finalRoom);
  }

  if (tileShape === "rhombus") {
    return tilesForPreviewRhombus(state, availableMP, tw, th, grout, includeExcluded, finalRoom);
  }

  if (tileShape === "square") {
    // For square tiles, we force width = height using the width value
    return tilesForPreviewSquare(state, availableMP, tw, grout, includeExcluded, finalRoom);
  }

  const type = finalRoom.pattern?.type || "grid";

  if (type === "herringbone") {
    return tilesForPreviewHerringbone(state, availableMP, tw, th, grout, includeExcluded, finalRoom);
  }

  if (type === "basketweave") {
    return tilesForPreviewBasketweave(state, availableMP, tw, th, grout, includeExcluded, finalRoom);
  }

  if (type === "doubleHerringbone") {
    return tilesForPreviewDoubleHerringbone(state, availableMP, tw, th, grout, includeExcluded, finalRoom);
  }

  if (type === "verticalStackAlternating") {
    return tilesForPreviewVerticalStackAlternating(state, availableMP, tw, th, grout, includeExcluded, finalRoom);
  }

  const stepX = tw + grout;
  const stepY = th + grout;

  const rotDeg = Number(finalRoom.pattern?.rotationDeg) || 0;
  const rotRad = degToRad(rotDeg);

  const offX = Number(finalRoom.pattern?.offsetXcm) || 0;
  const offY = Number(finalRoom.pattern?.offsetYcm) || 0;

  const origin = computeOriginPoint(finalRoom, finalRoom.pattern);
  const preset = finalRoom.pattern?.origin?.preset || "tl";

  const frac = Number(finalRoom.pattern?.bondFraction) || 0.5;
  const rowShiftCm = type === "runningBond" ? tw * frac : 0;
  const bondPeriod = type === "runningBond" ? detectBondPeriod(frac) : 0;

  const bounds = getRoomBounds(finalRoom);
  const w = bounds.width;
  const h = bounds.height;

  const b = inverseRotatedRoomBounds(w, h, origin, rotRad);

  const marginX = TILE_MARGIN_MULTIPLIER * stepX;
  const marginY = TILE_MARGIN_MULTIPLIER * stepY;

  const minX = b.minX - marginX;
  const maxX = b.maxX + marginX;
  const minY = b.minY - marginY;
  const maxY = b.maxY + marginY;

  // === FIX A: "center" means tile CENTER on room center ===
  // Only for preset="center": shift anchor by half tile so that a tile is centered on origin.
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

  const estTiles = estCols * estRows;
  if (estTiles > MAX_PREVIEW_TILES) {
    return { tiles: [], error: `Zu viele Fliesen für Preview (${estTiles}).` };
  }

  const tiles = [];

  for (let r = 0; r < estRows; r++) {
    const y = startY + r * stepY;

    // === FIX B: running bond must be periodic, not cumulative drift ===
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

function tilesForPreviewHex(state, availableMP, tw, th, grout, includeExcluded = false, roomOverride = null) {
  const currentRoom = roomOverride || getCurrentRoom(state);
  const rotDeg = Number(currentRoom.pattern?.rotationDeg) || 0;
  const rotRad = degToRad(rotDeg);

  const offX = Number(currentRoom.pattern?.offsetXcm) || 0;
  const offY = Number(currentRoom.pattern?.offsetYcm) || 0;

  const origin = computeOriginPoint(currentRoom, currentRoom.pattern);
  const preset = currentRoom.pattern?.origin?.preset || "tl";

  const sideLength = tw / Math.sqrt(3);
  const hexHeight = sideLength * 2;
  const hexWidth = tw;

  const stepX = hexWidth + grout;
  const stepY = hexHeight * 0.75 + grout;

  const bounds = getRoomBounds(currentRoom);
  const w = bounds.width;
  const h = bounds.height;

  const b = inverseRotatedRoomBounds(w, h, origin, rotRad);

  const marginX = TILE_MARGIN_MULTIPLIER * stepX;
  const marginY = TILE_MARGIN_MULTIPLIER * stepY;

  const minX = b.minX - marginX;
  const maxX = b.maxX + marginX;
  const minY = b.minY - marginY;
  const maxY = b.maxY + marginY;

  let anchorX = origin.x + offX;
  let anchorY = origin.y + offY;
  if (preset === "center") {
    anchorX -= hexWidth / 2;
    anchorY -= hexHeight / 2;
  }

  const startX = anchorX + floorDiv(minX - anchorX, stepX) * stepX;
  const startY = anchorY + floorDiv(minY - anchorY, stepY) * stepY;

  const estCols = Math.ceil((maxX - startX) / stepX) + 2;
  const estRows = Math.ceil((maxY - startY) / stepY) + 2;

  const estTiles = estCols * estRows;
  if (estTiles > MAX_PREVIEW_TILES) {
    return { tiles: [], error: `Zu viele Fliesen für Preview (${estTiles}).` };
  }

  const tiles = [];
  const hexFullArea = (3 * Math.sqrt(3) / 2) * sideLength * sideLength;

  for (let r = 0; r < estRows; r++) {
    const y = startY + r * stepY;
    const rowOffset = (r % 2) * (hexWidth * 0.5);

    for (let c = 0; c < estCols; c++) {
      const x = startX + c * stepX + rowOffset;

      const tileId = `hex-r${r}c${c}`;
      const isExcluded = Boolean(currentRoom.excludedTiles?.includes(tileId));
      if (!includeExcluded && isExcluded) continue;

      const tileP = tileHexPolygon(x, y, tw, origin.x, origin.y, rotRad);

      let clipped;
      try {
        clipped = polygonClipping.intersection(availableMP, tileP);
      } catch (e) {
        return { tiles: [], error: String(e?.message || e) };
      }
      if (!clipped || !clipped.length) continue;

      const d = multiPolygonToPathD(clipped);
      if (!d) continue;

      const gotArea = multiPolyArea(clipped);
      const isFull = gotArea >= hexFullArea * TILE_AREA_TOLERANCE;

      tiles.push({ d, isFull, id: tileId, excluded: isExcluded });
    }
  }

  return { tiles, error: null };
}

function tilesForPreviewSquare(state, availableMP, tw, grout, includeExcluded = false, roomOverride = null) {
  const currentRoom = roomOverride || getCurrentRoom(state);
  const rotDeg = Number(currentRoom.pattern?.rotationDeg) || 0;
  const rotRad = degToRad(rotDeg);

  const offX = Number(currentRoom.pattern?.offsetXcm) || 0;
  const offY = Number(currentRoom.pattern?.offsetYcm) || 0;

  const origin = computeOriginPoint(currentRoom, currentRoom.pattern);
  const preset = currentRoom.pattern?.origin?.preset || "tl";

  const type = currentRoom.pattern?.type || "grid";
  const frac = Number(currentRoom.pattern?.bondFraction) || 0.5;
  const rowShiftCm = type === "runningBond" ? tw * frac : 0;
  const bondPeriod = type === "runningBond" ? detectBondPeriod(frac) : 0;

  const stepX = tw + grout;
  const stepY = tw + grout;

  const bounds = getRoomBounds(currentRoom);
  const w = bounds.width;
  const h = bounds.height;

  const b = inverseRotatedRoomBounds(w, h, origin, rotRad);

  const marginX = TILE_MARGIN_MULTIPLIER * stepX;
  const marginY = TILE_MARGIN_MULTIPLIER * stepY;

  const minX = b.minX - marginX;
  const maxX = b.maxX + marginX;
  const minY = b.minY - marginY;
  const maxY = b.maxY + marginY;

  let anchorX = origin.x + offX;
  let anchorY = origin.y + offY;
  if (preset === "center") {
    anchorX -= tw / 2;
    anchorY -= tw / 2;
  }

  const startX = anchorX + floorDiv(minX - anchorX, stepX) * stepX;
  const startY = anchorY + floorDiv(minY - anchorY, stepY) * stepY;

  const estCols = Math.ceil((maxX - startX) / stepX) + 1;
  const estRows = Math.ceil((maxY - startY) / stepY) + 1;

  const estTiles = estCols * estRows;
  if (estTiles > MAX_PREVIEW_TILES) {
    return { tiles: [], error: `Zu viele Fliesen für Preview (${estTiles}).` };
  }

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
      const isExcluded = Boolean(currentRoom.excludedTiles?.includes(tileId));
      if (!includeExcluded && isExcluded) continue;
      const tileP = tileRectPolygon(x, y, tw, tw, origin.x, origin.y, rotRad);

      let clipped;
      try {
        clipped = polygonClipping.intersection(availableMP, tileP);
      } catch (e) {
        return { tiles: [], error: String(e?.message || e) };
      }
      if (!clipped || !clipped.length) continue;

      const d = multiPolygonToPathD(clipped);
      if (!d) continue;

      const gotArea = multiPolyArea(clipped);
      const isFull = gotArea >= fullArea * TILE_AREA_TOLERANCE;

      tiles.push({ d, isFull, id: tileId, excluded: isExcluded });
    }
  }

  return { tiles, error: null };
}

function tilesForPreviewRhombus(state, availableMP, tw, th, grout, includeExcluded = false, roomOverride = null) {
  const currentRoom = roomOverride || getCurrentRoom(state);
  const rotDeg = Number(currentRoom.pattern?.rotationDeg) || 0;
  const rotRad = degToRad(rotDeg);

  const offX = Number(currentRoom.pattern?.offsetXcm) || 0;
  const offY = Number(currentRoom.pattern?.offsetYcm) || 0;

  const origin = computeOriginPoint(currentRoom, currentRoom.pattern);
  const preset = currentRoom.pattern?.origin?.preset || "tl";

  const stepX = tw + grout;
  const stepY = th / 2 + grout / 2; // For staggered rhombus grid

  const bounds = getRoomBounds(currentRoom);
  const w = bounds.width;
  const h = bounds.height;

  const b = inverseRotatedRoomBounds(w, h, origin, rotRad);

  const marginX = TILE_MARGIN_MULTIPLIER * stepX;
  const marginY = TILE_MARGIN_MULTIPLIER * stepY;

  const minX = b.minX - marginX;
  const maxX = b.maxX + marginX;
  const minY = b.minY - marginY;
  const maxY = b.maxY + marginY;

  let anchorX = origin.x + offX;
  let anchorY = origin.y + offY;
  if (preset === "center") {
    anchorX -= tw / 2;
    anchorY -= th / 2;
  }

  const startX = anchorX + floorDiv(minX - anchorX, stepX) * stepX;
  const startY = anchorY + floorDiv(minY - anchorY, stepY) * stepY;

  const estCols = Math.ceil((maxX - startX) / stepX) + 2;
  const estRows = Math.ceil((maxY - startY) / stepY) + 2;

  const estTiles = estCols * estRows;
  if (estTiles > MAX_PREVIEW_TILES) {
    return { tiles: [], error: `Zu viele Fliesen für Preview (${estTiles}).` };
  }

  const tiles = [];
  const fullArea = (tw * th) / 2;

  for (let r = 0; r < estRows; r++) {
    const y = startY + r * stepY;
    const rowOffset = (r % 2) * (tw * 0.5);

    for (let c = 0; c < estCols; c++) {
      const x = startX + c * stepX + rowOffset;

      const tileId = `rho-r${r}c${c}`;
      const isExcluded = Boolean(currentRoom.excludedTiles?.includes(tileId));
      if (!includeExcluded && isExcluded) continue;

      const tileP = tileRhombusPolygon(x, y, tw, th, origin.x, origin.y, rotRad);

      let clipped;
      try {
        clipped = polygonClipping.intersection(availableMP, tileP);
      } catch (e) {
        return { tiles: [], error: String(e?.message || e) };
      }
      if (!clipped || !clipped.length) continue;

      const d = multiPolygonToPathD(clipped);
      if (!d) continue;

      const gotArea = multiPolyArea(clipped);
      const isFull = gotArea >= fullArea * TILE_AREA_TOLERANCE;

      tiles.push({ d, isFull, id: tileId, excluded: isExcluded });
    }
  }

  return { tiles, error: null };
}

function tilesForPreviewHerringbone(state, availableMP, tw, th, grout, includeExcluded = false, roomOverride = null) {
  const currentRoom = roomOverride || getCurrentRoom(state);
  const rotDeg = Number(currentRoom.pattern?.rotationDeg) || 0;
  const rotRad = degToRad(rotDeg);

  const offX = Number(currentRoom.pattern?.offsetXcm) || 0;
  const offY = Number(currentRoom.pattern?.offsetYcm) || 0;

  const origin = computeOriginPoint(currentRoom, currentRoom.pattern);
  const preset = currentRoom.pattern?.origin?.preset || "tl";

  const L = Math.max(tw, th);
  const W = Math.min(tw, th);
  const stepX = L + grout;
  const stepY = W + grout;
  const shear = Math.max(L - W, 0) + grout;

  const bounds = getRoomBounds(currentRoom);
  const w = bounds.width;
  const h = bounds.height;

  const b = inverseRotatedRoomBounds(w, h, origin, rotRad);

  const margin = TILE_MARGIN_MULTIPLIER * (L + W + grout);
  const minX = b.minX - margin;
  const maxX = b.maxX + margin;
  const minY = b.minY - margin;
  const maxY = b.maxY + margin;

  let anchorX = origin.x + offX;
  let anchorY = origin.y + offY;
  if (preset === "center") {
    anchorX -= L / 2;
    anchorY -= W / 2;
  }

  const startRow = Math.floor((minY - anchorY) / stepY) - 2;
  const endRow = Math.ceil((maxY - anchorY) / stepY) + 2;

  const minRowShift = Math.min(startRow, endRow) * shear;
  const maxRowShift = Math.max(startRow, endRow) * shear;

  const startCol = Math.floor((minX - anchorX - maxRowShift) / stepX) - 2;
  const endCol = Math.ceil((maxX - anchorX - minRowShift) / stepX) + 2;

  const estRows = endRow - startRow + 1;
  const estCols = endCol - startCol + 1;
  const estTiles = estRows * estCols;
  const areaEst = (w * h) / (W * L);
  const maxTiles = Math.min(
    MAX_PREVIEW_TILES * 4,
    Math.max(MAX_PREVIEW_TILES, Math.ceil(areaEst * 20))
  );
  if (estTiles > maxTiles) {
    return { tiles: [], error: `Zu viele Fliesen für Preview (${estTiles}).` };
  }

  const tiles = [];
  const fullArea = W * L;

  for (let row = startRow; row <= endRow; row++) {
    const baseY = anchorY + row * stepY;
    for (let col = startCol; col <= endCol; col++) {
      const baseX = anchorX + col * stepX + row * shear;
      const isHorizontal = (row + col) % 2 === 0;

      const tileId = `hb-r${row}c${col}`;
      const isExcluded = Boolean(currentRoom.excludedTiles?.includes(tileId));
      if (!includeExcluded && isExcluded) continue;

      const tileX = isHorizontal ? baseX : baseX + (L - W);
      const tileY = isHorizontal ? baseY : baseY - (L - W);
      const tileW = isHorizontal ? L : W;
      const tileH = isHorizontal ? W : L;

      const tileP = tileRectPolygon(tileX, tileY, tileW, tileH, origin.x, origin.y, rotRad);

      let clipped;
      try {
        clipped = polygonClipping.intersection(availableMP, tileP);
      } catch (e) {
        return { tiles: [], error: String(e?.message || e) };
      }
      if (!clipped || !clipped.length) continue;

      const d = multiPolygonToPathD(clipped);
      if (!d) continue;

      const gotArea = multiPolyArea(clipped);
      const isFull = gotArea >= fullArea * TILE_AREA_TOLERANCE;
      tiles.push({ d, isFull, id: tileId, excluded: isExcluded });
    }
  }

  return { tiles, error: null };
}

// Export for testing
export { tilesForPreviewHerringbone };

function tilesForPreviewDoubleHerringbone(state, availableMP, tw, th, grout, includeExcluded = false, roomOverride = null) {
  const currentRoom = roomOverride || getCurrentRoom(state);
  const rotDeg = Number(currentRoom.pattern?.rotationDeg) || 0;
  const rotRad = degToRad(rotDeg);

  const offX = Number(currentRoom.pattern?.offsetXcm) || 0;
  const offY = Number(currentRoom.pattern?.offsetYcm) || 0;

  const origin = computeOriginPoint(currentRoom, currentRoom.pattern);
  const preset = currentRoom.pattern?.origin?.preset || "tl";

  const L = Math.max(tw, th);
  const W = Math.min(tw, th);
  const W2 = 2 * W + grout;

  const stepX = L + grout;
  const stepY = W2 + grout;
  const shear = Math.max(L - W2, 0) + grout;

  const bounds = getRoomBounds(currentRoom);
  const w = bounds.width;
  const h = bounds.height;

  const b = inverseRotatedRoomBounds(w, h, origin, rotRad);

  const margin = TILE_MARGIN_MULTIPLIER * (L + W2 + grout);
  const minX = b.minX - margin;
  const maxX = b.maxX + margin;
  const minY = b.minY - margin;
  const maxY = b.maxY + margin;

  let anchorX = origin.x + offX;
  let anchorY = origin.y + offY;
  if (preset === "center") {
    anchorX -= L / 2;
    anchorY -= W2 / 2;
  }

  const startRow = Math.floor((minY - anchorY) / stepY) - 2;
  const endRow = Math.ceil((maxY - anchorY) / stepY) + 2;

  const minRowShift = Math.min(startRow, endRow) * shear;
  const maxRowShift = Math.max(startRow, endRow) * shear;

  const startCol = Math.floor((minX - anchorX - maxRowShift) / stepX) - 2;
  const endCol = Math.ceil((maxX - anchorX - minRowShift) / stepX) + 2;

  const estRows = endRow - startRow + 1;
  const estCols = endCol - startCol + 1;
  const estTiles = estRows * estCols * 2;
  if (estTiles > MAX_PREVIEW_TILES) {
    return { tiles: [], error: `Zu viele Fliesen für Preview (${estTiles}).` };
  }

  const tiles = [];
  const fullArea = W * L;

  for (let row = startRow; row <= endRow; row++) {
    const baseY = anchorY + row * stepY;
    for (let col = startCol; col <= endCol; col++) {
      const baseX = anchorX + col * stepX + row * shear;
      const isHorizontal = (row + col) % 2 === 0;

      if (isHorizontal) {
        const hx = baseX;
        const hy = baseY;
        const placements = [
          { x: hx, y: hy, w: L, h: W, id: `dhb-r${row}c${col}-h0` },
          { x: hx, y: hy + W + grout, w: L, h: W, id: `dhb-r${row}c${col}-h1` },
        ];
        for (const t of placements) {
          const isExcluded = Boolean(currentRoom.excludedTiles?.includes(t.id));
          if (!includeExcluded && isExcluded) continue;

          const tileP = tileRectPolygon(t.x, t.y, t.w, t.h, origin.x, origin.y, rotRad);
          let clipped;
          try {
            clipped = polygonClipping.intersection(availableMP, tileP);
          } catch (e) {
            return { tiles: [], error: String(e?.message || e) };
          }
          if (!clipped || !clipped.length) continue;
          const d = multiPolygonToPathD(clipped);
          if (!d) continue;
          const gotArea = multiPolyArea(clipped);
          const isFull = gotArea >= fullArea * TILE_AREA_TOLERANCE;
          tiles.push({ d, isFull, id: t.id, excluded: isExcluded });
        }
      } else {
        const vx = baseX + (L - W2);
        const vy = baseY - (L - W2);
        const placements = [
          { x: vx, y: vy, w: W, h: L, id: `dhb-r${row}c${col}-v0` },
          { x: vx + W + grout, y: vy, w: W, h: L, id: `dhb-r${row}c${col}-v1` },
        ];
        for (const t of placements) {
          const isExcluded = Boolean(currentRoom.excludedTiles?.includes(t.id));
          if (!includeExcluded && isExcluded) continue;

          const tileP = tileRectPolygon(t.x, t.y, t.w, t.h, origin.x, origin.y, rotRad);
          let clipped;
          try {
            clipped = polygonClipping.intersection(availableMP, tileP);
          } catch (e) {
            return { tiles: [], error: String(e?.message || e) };
          }
          if (!clipped || !clipped.length) continue;
          const d = multiPolygonToPathD(clipped);
          if (!d) continue;
          const gotArea = multiPolyArea(clipped);
          const isFull = gotArea >= fullArea * TILE_AREA_TOLERANCE;
          tiles.push({ d, isFull, id: t.id, excluded: isExcluded });
        }
      }
    }
  }

  return { tiles, error: null };
}

function tilesForPreviewVerticalStackAlternating(state, availableMP, tw, th, grout, includeExcluded = false, roomOverride = null) {
  const currentRoom = roomOverride || getCurrentRoom(state);
  const rotDeg = Number(currentRoom.pattern?.rotationDeg) || 0;
  const rotRad = degToRad(rotDeg);

  const offX = Number(currentRoom.pattern?.offsetXcm) || 0;
  const offY = Number(currentRoom.pattern?.offsetYcm) || 0;

  const origin = computeOriginPoint(currentRoom, currentRoom.pattern);
  const preset = currentRoom.pattern?.origin?.preset || "tl";

  const L = Math.max(tw, th);
  const W = Math.min(tw, th);
  const stepX = W + grout;
  const stepY = L + grout;

  const bounds = getRoomBounds(currentRoom);
  const w = bounds.width;
  const h = bounds.height;

  const b = inverseRotatedRoomBounds(w, h, origin, rotRad);

  const marginX = TILE_MARGIN_MULTIPLIER * stepX;
  const marginY = TILE_MARGIN_MULTIPLIER * stepY;

  const minX = b.minX - marginX;
  const maxX = b.maxX + marginX;
  const minY = b.minY - marginY;
  const maxY = b.maxY + marginY;

  let anchorX = origin.x + offX;
  let anchorY = origin.y + offY;
  if (preset === "center") {
    anchorX -= W / 2;
    anchorY -= L / 2;
  }

  const startCol = Math.floor((minX - anchorX) / stepX) - 2;
  const endCol = Math.ceil((maxX - anchorX) / stepX) + 2;

  const startRow = Math.floor((minY - anchorY) / stepY) - 2;
  const endRow = Math.ceil((maxY - anchorY) / stepY) + 2;

  const estCols = endCol - startCol + 1;
  const estRows = endRow - startRow + 1;
  const estTiles = estCols * estRows;
  if (estTiles > MAX_PREVIEW_TILES) {
    return { tiles: [], error: `Zu viele Fliesen für Preview (${estTiles}).` };
  }

  const tiles = [];
  const fullArea = W * L;
  const colShift = stepY / 2;

  for (let col = startCol; col <= endCol; col++) {
    const baseX = anchorX + col * stepX;
    const shiftY = (col % 2) * colShift;
    for (let row = startRow; row <= endRow; row++) {
      const baseY = anchorY + row * stepY + shiftY;
      const tileId = `vsa-r${row}c${col}`;
      const isExcluded = Boolean(currentRoom.excludedTiles?.includes(tileId));
      if (!includeExcluded && isExcluded) continue;

      const tileP = tileRectPolygon(baseX, baseY, W, L, origin.x, origin.y, rotRad);

      let clipped;
      try {
        clipped = polygonClipping.intersection(availableMP, tileP);
      } catch (e) {
        return { tiles: [], error: String(e?.message || e) };
      }
      if (!clipped || !clipped.length) continue;

      const d = multiPolygonToPathD(clipped);
      if (!d) continue;

      const gotArea = multiPolyArea(clipped);
      const isFull = gotArea >= fullArea * TILE_AREA_TOLERANCE;
      tiles.push({ d, isFull, id: tileId, excluded: isExcluded });
    }
  }

  return { tiles, error: null };
}

function tilesForPreviewBasketweave(state, availableMP, tw, th, grout, includeExcluded = false, roomOverride = null) {
  const currentRoom = roomOverride || getCurrentRoom(state);
  const rotDeg = Number(currentRoom.pattern?.rotationDeg) || 0;
  const rotRad = degToRad(rotDeg);

  const offX = Number(currentRoom.pattern?.offsetXcm) || 0;
  const offY = Number(currentRoom.pattern?.offsetYcm) || 0;

  const origin = computeOriginPoint(currentRoom, currentRoom.pattern);
  const preset = currentRoom.pattern?.origin?.preset || "tl";

  const L = Math.max(tw, th);
  const W = Math.min(tw, th);
  const tilesPerStack = Math.max(1, Math.round(L / W));
  const unitW = 2 * L + 2 * grout;
  const unitH = L + grout;

  const bounds = getRoomBounds(currentRoom);
  const w = bounds.width;
  const h = bounds.height;

  const b = inverseRotatedRoomBounds(w, h, origin, rotRad);

  const marginX = TILE_MARGIN_MULTIPLIER * unitW;
  const marginY = TILE_MARGIN_MULTIPLIER * unitH;

  const minX = b.minX - marginX;
  const maxX = b.maxX + marginX;
  const minY = b.minY - marginY;
  const maxY = b.maxY + marginY;

  let anchorX = origin.x + offX;
  let anchorY = origin.y + offY;
  if (preset === "center") {
    anchorX -= unitW / 2;
    anchorY -= unitH / 2;
  }

  const startCol = Math.floor((minX - anchorX) / unitW) - 2;
  const endCol = Math.ceil((maxX - anchorX) / unitW) + 2;
  const startRow = Math.floor((minY - anchorY) / unitH) - 2;
  const endRow = Math.ceil((maxY - anchorY) / unitH) + 2;

  const estCols = endCol - startCol + 1;
  const estRows = endRow - startRow + 1;

  const estTiles = estCols * estRows * tilesPerStack * 2;
  if (estTiles > MAX_PREVIEW_TILES) {
    return { tiles: [], error: `Zu viele Fliesen für Preview (${estTiles}).` };
  }

  const tiles = [];
  const fullArea = tw * th;

  for (let row = startRow; row <= endRow; row++) {
    const rowOffset = row % 2 === 0 ? 0 : (L + grout);
    const baseY = anchorY + row * unitH;
    for (let col = startCol; col <= endCol; col++) {
      const baseX = anchorX + col * unitW + rowOffset;

      for (let i = 0; i < tilesPerStack; i++) {
        const hx = baseX;
        const hy = baseY + i * (W + grout);
        const vx = baseX + L + grout + i * (W + grout);
        const vy = baseY;

        const placements = [
          { x: hx, y: hy, w: L, h: W, id: `bw-r${row}c${col}-i${i}-h` },
          { x: vx, y: vy, w: W, h: L, id: `bw-r${row}c${col}-i${i}-v` },
        ];

        for (const t of placements) {
          const isExcluded = Boolean(currentRoom.excludedTiles?.includes(t.id));
          if (!includeExcluded && isExcluded) continue;

          const tileP = tileRectPolygon(t.x, t.y, t.w, t.h, origin.x, origin.y, rotRad);

          let clipped;
          try {
            clipped = polygonClipping.intersection(availableMP, tileP);
          } catch (e) {
            return { tiles: [], error: String(e?.message || e) };
          }
          if (!clipped || !clipped.length) continue;

          const d = multiPolygonToPathD(clipped);
          if (!d) continue;

          const gotArea = multiPolyArea(clipped);
          const isFull = gotArea >= fullArea * TILE_AREA_TOLERANCE;

          tiles.push({ d, isFull, id: t.id, excluded: isExcluded });
        }
      }
    }
  }

  return { tiles, error: null };
}
