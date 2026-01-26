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
import { getRoomSections, computeCompositePolygon, computeCompositeBounds } from "./composite.js";

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
    const w = room.widthCm || 0;
    const h = room.heightCm || 0;
    return [[[[[0, 0], [w, 0], [w, h], [0, h], [0, 0]]]]];
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

export function tilesForPreview(state, availableMP) {
  const currentRoom = getCurrentRoom(state);
  if (!currentRoom) {
    return { tiles: [], error: "Kein Raum ausgewählt." };
  }

  const tw = Number(currentRoom.tile?.widthCm);
  const th = Number(currentRoom.tile?.heightCm);
  const tileShape = currentRoom.tile?.shape || "rect";
  const grout = Number(currentRoom.grout?.widthCm) || 0;
  if (!(tw > 0) || !(th > 0) || grout < 0) {
    return { tiles: [], error: null };
  }

  if (tileShape === "hex") {
    return tilesForPreviewHex(state, availableMP, tw, th, grout);
  }

  const type = currentRoom.pattern?.type || "grid";

  if (type === "herringbone") {
    return tilesForPreviewHerringbone(state, availableMP, tw, th, grout);
  }

  if (type === "basketweave") {
    return tilesForPreviewBasketweave(state, availableMP, tw, th, grout);
  }

  const stepX = tw + grout;
  const stepY = th + grout;

  const rotDeg = Number(currentRoom.pattern?.rotationDeg) || 0;
  const rotRad = degToRad(rotDeg);

  const offX = Number(currentRoom.pattern?.offsetXcm) || 0;
  const offY = Number(currentRoom.pattern?.offsetYcm) || 0;

  const origin = computeOriginPoint(currentRoom, currentRoom.pattern);
  const preset = currentRoom.pattern?.origin?.preset || "tl";

  const frac = Number(currentRoom.pattern?.bondFraction) || 0.5;
  const rowShiftCm = type === "runningBond" ? tw * frac : 0;
  const bondPeriod = type === "runningBond" ? detectBondPeriod(frac) : 0;

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

      tiles.push({ d, isFull });
    }
  }

  return { tiles, error: null };
}

function tilesForPreviewHex(state, availableMP, tw, th, grout) {
  const currentRoom = getCurrentRoom(state);
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

      tiles.push({ d, isFull });
    }
  }

  return { tiles, error: null };
}

function tilesForPreviewHerringbone(state, availableMP, tw, th, grout) {
  const currentRoom = getCurrentRoom(state);
  const rotDeg = Number(currentRoom.pattern?.rotationDeg) || 0;
  const rotRad = degToRad(rotDeg);

  const offX = Number(currentRoom.pattern?.offsetXcm) || 0;
  const offY = Number(currentRoom.pattern?.offsetYcm) || 0;

  const origin = computeOriginPoint(currentRoom, currentRoom.pattern);
  const preset = currentRoom.pattern?.origin?.preset || "tl";

  // L = long edge, W = short edge
  const L = Math.max(tw, th);
  const W = Math.min(tw, th);

  // 90° Herringbone pattern:
  // Each tile's SHORT edge aligns with the LONG edge of the adjacent tile.
  // The pattern consists of alternating H and V tiles arranged so that:
  //
  //   [====H====]        <- H tile (L×W)
  //             [V]      <- V tile (W×L) - short edge meets H's long edge
  //             [V]
  //   [====H====][V]
  //             [V]
  //             [V]
  //   [====H====][V]
  //
  // The repeating unit is (L+W) wide and (L+W) tall.
  // Odd rows are offset by (L+grout) to create the stepped effect.

  const unitW = L + W + 2 * grout;  // Width of repeating unit
  const unitH = L + W + 2 * grout;  // Height of repeating unit

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

  const startCol = Math.floor((minX - anchorX) / unitW) - 1;
  const endCol = Math.ceil((maxX - anchorX) / unitW) + 1;
  const startRow = Math.floor((minY - anchorY) / unitH) - 1;
  const endRow = Math.ceil((maxY - anchorY) / unitH) + 1;

  const estTiles = (endCol - startCol) * (endRow - startRow) * 4;
  if (estTiles > MAX_PREVIEW_TILES) {
    return { tiles: [], error: `Zu viele Fliesen für Preview (${estTiles}).` };
  }

  const tiles = [];
  const fullArea = W * L;

  // Generate herringbone pattern
  for (let row = startRow; row <= endRow; row++) {
    for (let col = startCol; col <= endCol; col++) {
      // Odd rows are offset by (L + grout) to create the stepped pattern
      const rowOffset = (row % 2 === 0) ? 0 : (L + grout);

      const unitX = anchorX + col * unitW + rowOffset;
      const unitY = anchorY + row * unitH;

      // Each unit contains 4 tiles:
      // Top-left: H tile
      // Top-right: V tile (extending down)
      // Bottom-left: V tile (extending down)
      // Bottom-right: H tile

      // Tile 1: H at top-left of unit
      const h1x = unitX;
      const h1y = unitY;
      const h1Poly = tileRectPolygon(h1x, h1y, L, W, origin.x, origin.y, rotRad);

      // Tile 2: V at top-right, extending downward
      const v1x = unitX + L + grout;
      const v1y = unitY;
      const v1Poly = tileRectPolygon(v1x, v1y, W, L, origin.x, origin.y, rotRad);

      // Tile 3: V at bottom-left, extending downward
      const v2x = unitX;
      const v2y = unitY + W + grout;
      const v2Poly = tileRectPolygon(v2x, v2y, W, L, origin.x, origin.y, rotRad);

      // Tile 4: H at bottom-right
      const h2x = unitX + W + grout;
      const h2y = unitY + L + grout;
      const h2Poly = tileRectPolygon(h2x, h2y, L, W, origin.x, origin.y, rotRad);

      // Process all 4 tiles
      const tilesToProcess = [h1Poly, v1Poly, v2Poly, h2Poly];

      for (const tilePoly of tilesToProcess) {
        let clipped;
        try {
          clipped = polygonClipping.intersection(availableMP, tilePoly);
        } catch (e) {
          return { tiles: [], error: String(e?.message || e) };
        }
        if (clipped && clipped.length) {
          const d = multiPolygonToPathD(clipped);
          if (d) {
            const gotArea = multiPolyArea(clipped);
            const isFull = gotArea >= fullArea * TILE_AREA_TOLERANCE;
            tiles.push({ d, isFull });
          }
        }
      }
    }
  }

  return { tiles, error: null };
}

// Export for testing
export { tilesForPreviewHerringbone };

function tilesForPreviewBasketweave(state, availableMP, tw, th, grout) {
  const currentRoom = getCurrentRoom(state);
  const rotDeg = Number(currentRoom.pattern?.rotationDeg) || 0;
  const rotRad = degToRad(rotDeg);

  const offX = Number(currentRoom.pattern?.offsetXcm) || 0;
  const offY = Number(currentRoom.pattern?.offsetYcm) || 0;

  const origin = computeOriginPoint(currentRoom, currentRoom.pattern);
  const preset = currentRoom.pattern?.origin?.preset || "tl";

  const pairSize = Math.max(tw, th);
  const stepX = pairSize + grout;
  const stepY = pairSize + grout;

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
    anchorX -= pairSize / 2;
    anchorY -= pairSize / 2;
  }

  const startX = anchorX + floorDiv(minX - anchorX, stepX) * stepX;
  const startY = anchorY + floorDiv(minY - anchorY, stepY) * stepY;

  const estCols = Math.ceil((maxX - startX) / stepX) + 2;
  const estRows = Math.ceil((maxY - startY) / stepY) + 2;

  const estTiles = estCols * estRows * 2;
  if (estTiles > MAX_PREVIEW_TILES) {
    return { tiles: [], error: `Zu viele Fliesen für Preview (${estTiles}).` };
  }

  const tiles = [];
  const fullArea = tw * th;

  for (let r = 0; r < estRows; r++) {
    for (let c = 0; c < estCols; c++) {
      const baseX = startX + c * stepX;
      const baseY = startY + r * stepY;

      const isHorizontal = (r + c) % 2 === 0;

      const basketweaveTiles = isHorizontal
        ? [
            { x: baseX, y: baseY, w: tw, h: th },
            { x: baseX, y: baseY + th + grout, w: tw, h: th },
          ]
        : [
            { x: baseX, y: baseY, w: th, h: tw },
            { x: baseX + th + grout, y: baseY, w: th, h: tw },
          ];

      for (const tile of basketweaveTiles) {
        const tileP = tileRectPolygon(
          tile.x,
          tile.y,
          tile.w,
          tile.h,
          origin.x,
          origin.y,
          rotRad
        );

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

        tiles.push({ d, isFull });
      }
    }
  }

  return { tiles, error: null };
}