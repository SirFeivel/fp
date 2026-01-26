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
  const grout = Number(currentRoom.grout?.widthCm) || 0;
  if (!(tw > 0) || !(th > 0) || grout < 0) {
    return { tiles: [], error: null };
  }

  const stepX = tw + grout;
  const stepY = th + grout;

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