// src/calc.js
import { computeAvailableArea, tilesForPreview, multiPolyArea, getRoomBounds, computeSkirtingPerimeter, computeSkirtingSegments, getAllFloorExclusions } from "./geometry.js";
import { getCurrentRoom, getCurrentFloor, resolvePresetTile } from "./core.js";
import { getEffectiveTileSettings, computePatternGroupOrigin } from "./pattern-groups.js";
import { TRIANGULAR_CUT_MIN, TRIANGULAR_CUT_MAX, AREA_RATIO_SCALING_THRESHOLD, COMPLEMENTARY_FIT_MIN, COMPLEMENTARY_FIT_MAX } from "./constants.js";
import { prepareWallSurface, computeSurfaceTiles, computeSubSurfaceTiles, computeSkirtingZoneTiles } from "./walls.js";


/**
 * Calculates material requirements for skirting.
 */
export function computeSkirtingNeeds(state, roomOverride = null) {
  const room = roomOverride || getCurrentRoom(state);
  if (!room) {
    return {
      enabled: false,
      totalLengthCm: 0,
      count: 0,
      additionalTiles: 0,
      stripsPerTile: 0,
      totalCost: 0
    };
  }

  const skirting = room.skirting || {};
  const floor = state?.floors?.find(f => f.rooms?.some(r => r.id === room.id));
  const segments = computeSkirtingSegments(room, false, floor);
  const totalLengthCm = segments.reduce((sum, s) => sum + s.length, 0);

  if (segments.length === 0 || totalLengthCm <= 0) {
    return {
      enabled: false,
      totalLengthCm: 0,
      count: 0,
      additionalTiles: 0,
      stripsPerTile: 0,
      totalCost: 0
    };
  }
  
  // Group centered piece-segments back into per-wall runs for material calculation.
  // computeSkirtingSegments now uses a centered layout (splitting each wall overlap
  // into left-cut + full-pieces + right-cut). Material needs are computed per run
  // (continuous wall edge) — ceil(runLength / pieceLength) — not per individual piece,
  // to match the original left-aligned semantics and avoid over-counting wastage.
  const runLengths = new Map();
  for (const seg of segments) {
    const runKey = seg.id.replace(/-p\d+$/, '');
    runLengths.set(runKey, (runLengths.get(runKey) || 0) + seg.length);
  }

  // Ready-made (bought per piece)
  if (skirting.type === "bought") {
    const pieceLength = Number(skirting.boughtWidthCm) || 1;
    let totalPieces = 0;
    for (const runLen of runLengths.values()) {
      totalPieces += Math.ceil(runLen / pieceLength);
    }
    const totalCost = totalPieces * (Number(skirting.boughtPricePerPiece) || 0);

    return {
      enabled: true,
      type: "bought",
      totalLengthCm,
      count: totalPieces,
      additionalTiles: 0,
      stripsPerTile: 0,
      totalCost
    };
  }

  // Self-made (cut from tiles)
  // Logic: 
  // - Tile long side is used for the strip length (tw).
  // - How many strips of height 'skirting.heightCm' fit into 'th' (tile height)?
  const tw = Number(room.tile?.widthCm) || 1;
  const th = Number(room.tile?.heightCm) || 1;
  const h = Number(skirting.heightCm) || 1;

  const longSide = Math.max(tw, th);
  const shortSide = Math.min(tw, th);

  // Requirement: use the long side for strip length, short side for strip count.
  // 0 when configured skirt height is higher than the short side, 1 if not sufficient for 2, or 2 max.
  let stripsPerTile = 0;
  if (h <= shortSide) {
    stripsPerTile = Math.min(2, Math.floor(shortSide / h));
  }

  let totalStripsNeeded = 0;
  if (stripsPerTile > 0) {
    for (const runLen of runLengths.values()) {
      totalStripsNeeded += Math.ceil(runLen / longSide);
    }
  }

  const additionalTiles = stripsPerTile > 0 ? Math.ceil(totalStripsNeeded / stripsPerTile) : 0;
  
  // Cost: additionalTiles * price per tile
  const pricing = getRoomPricing(state, room);
  const pricePerM2 = pricing.pricePerM2;
  const tileAreaM2 = (tw * th) / 10000;
  const pricePerTile = tileAreaM2 * pricePerM2;
  const totalCost = additionalTiles * pricePerTile;

  return {
    enabled: true,
    type: "cutout",
    totalLengthCm,
    count: additionalTiles, // Tiles sacrificed
    additionalTiles,
    stripsPerTile,
    totalCost
  };
}

// cm² -> m²
function cm2ToM2(aCm2) {
  return aCm2 / 10000;
}

// Count full vs cut tiles from a tiles array and derive purchased tile count + installed area.
// Conservative: no cross-surface offcut reuse.
function countTilesResult(tiles, tileW, tileH) {
  let fullTiles = 0, cutTiles = 0;
  for (const t of tiles) {
    if (t.isFull) fullTiles++; else cutTiles++;
  }
  const purchasedTiles = fullTiles + cutTiles;
  const tileAreaCm2 = (tileW || 1) * (tileH || 1);
  const installedAreaM2 = cm2ToM2(purchasedTiles * tileAreaCm2);
  return { fullTiles, cutTiles, purchasedTiles, installedAreaM2 };
}

// Accumulate tile counts and area into the byMaterial map.
// surfaceType: 'floor' | 'skirting' | 'wall' | 'subSurface'
function accumulateIntoByMaterial(byMaterial, state, ref, count, surfaceType) {
  if (!byMaterial[ref]) {
    const pricing = getRoomPricing(state, { tile: { reference: ref } });
    byMaterial[ref] = {
      reference: ref,
      totalTiles: 0, totalAreaM2: 0, netAreaM2: 0, totalCost: 0,
      floorAreaM2: 0, skirtingAreaM2: 0, wallAreaM2: 0, subSurfaceAreaM2: 0,
      floorTiles: 0, skirtingTiles: 0, wallTiles: 0, subSurfaceTiles: 0,
      pricePerM2: pricing.pricePerM2, packM2: pricing.packM2,
      extraPacks: (state.materials?.[ref]?.extraPacks) || 0,
    };
  }
  const m = byMaterial[ref];
  m.totalTiles += count.purchasedTiles;
  m.totalAreaM2 += count.installedAreaM2;
  m.netAreaM2 += count.installedAreaM2;
  m.totalCost += count.installedAreaM2 * m.pricePerM2;
  if (surfaceType === 'floor') { m.floorAreaM2 += count.installedAreaM2; m.floorTiles += count.purchasedTiles; }
  else if (surfaceType === 'skirting') { m.skirtingAreaM2 += count.installedAreaM2; m.skirtingTiles += count.purchasedTiles; }
  else if (surfaceType === 'wall') { m.wallAreaM2 += count.installedAreaM2; m.wallTiles += count.purchasedTiles; }
  else if (surfaceType === 'subSurface') { m.subSurfaceAreaM2 += count.installedAreaM2; m.subSurfaceTiles += count.purchasedTiles; }
}

function clampPos(n) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.max(0, x) : 0;
}

export function calculateTileArea(tw, th, shape) {
  if (shape === "hex") {
    const radius = tw / Math.sqrt(3);
    return (3 * Math.sqrt(3) / 2) * radius * radius;
  }
  if (shape === "rhombus") {
    return (tw * th) / 2;
  }
  if (shape === "square") {
    return tw * tw;
  }
  return tw * th;
}

function rectArea(r) {
  return Math.max(0, r.w) * Math.max(0, r.h);
}

export function getRoomPricing(state, room) {
  const ref = room.tile?.reference;
  if (ref && state.materials && state.materials[ref]) {
    const m = state.materials[ref];
    return {
      pricePerM2: Number(m.pricePerM2) || 0,
      packM2: Number(m.packM2) || 0,
      reserveTiles: Number(state.pricing?.reserveTiles) || 0,
    };
  }
  return {
    pricePerM2: Number(state.pricing?.pricePerM2) || 0,
    packM2: Number(state.pricing?.packM2) || 0,
    reserveTiles: Number(state.pricing?.reserveTiles) || 0,
  };
}

function bboxFromPathD(d) {
  const nums = d
    .trim()
    .split(/[\s,]+/)
    .map((x) => Number(x))
    .filter((x) => Number.isFinite(x));

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  for (let i = 0; i + 1 < nums.length; i += 2) {
    const x = nums[i];
    const y = nums[i + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Parse path d attribute to extract polygon points for area calculation
 */
function parsePathDToPolygon(d) {
  const commands = d.trim().split(/(?=[MLZ])/);
  const points = [];

  for (const cmd of commands) {
    if (!cmd.trim()) continue;
    const type = cmd[0];
    const nums = cmd
      .slice(1)
      .trim()
      .split(/[\s,]+/)
      .map((x) => Number(x))
      .filter((x) => Number.isFinite(x));

    if ((type === 'M' || type === 'L') && nums.length >= 2) {
      points.push([nums[0], nums[1]]);
    }
  }

  if (points.length < 3) return null;

  // Close the ring if not already closed
  const first = points[0];
  const last = points[points.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    points.push([first[0], first[1]]);
  }

  return [[points]];
}

/**
 * Analyze a cut tile to extract its geometric properties
 */
export function analyzeCutTile(tile, tileAreaCm2) {
  const bb = bboxFromPathD(tile.d);
  if (!bb || !(bb.w > 0 && bb.h > 0)) {
    return null;
  }

  const polygon = parsePathDToPolygon(tile.d);
  const bboxArea = bb.w * bb.h;
  const actualArea = polygon ? multiPolyArea(polygon) : bboxArea;
  const areaRatio = bboxArea > 0 ? actualArea / bboxArea : 1;
  const isTriangularCut = areaRatio >= TRIANGULAR_CUT_MIN && areaRatio <= TRIANGULAR_CUT_MAX;

  return {
    bb,
    bboxArea,
    actualArea,
    areaRatio,
    isTriangularCut,
    polygon,
  };
}

/**
 * Find complementary pairs of cut tiles that can be cut from the same tile.
 * Returns a Map: tileIndex -> pairedWithIndex
 */
export function findComplementaryPairs(tiles, analyses, tw, th) {
  const pairs = new Map();
  const tileAreaCm2 = tw * th;
  const dimensionTol = 1.0;
  const minArea = tileAreaCm2 * 0.001;

  const unpairedIndices = [];
  for (let i = 0; i < tiles.length; i++) {
    if (!tiles[i].isFull && analyses[i] && analyses[i].actualArea > minArea) {
      unpairedIndices.push(i);
    }
  }

  for (let i = 0; i < unpairedIndices.length; i++) {
    const idx1 = unpairedIndices[i];
    if (pairs.has(idx1)) continue;

    const a1 = analyses[idx1];
    if (!a1) continue;

    for (let j = i + 1; j < unpairedIndices.length; j++) {
      const idx2 = unpairedIndices[j];
      if (pairs.has(idx2)) continue;

      const a2 = analyses[idx2];
      if (!a2) continue;

      const dimMatch =
        Math.abs(a1.bb.w - a2.bb.w) < dimensionTol &&
        Math.abs(a1.bb.h - a2.bb.h) < dimensionTol;

      if (!dimMatch) continue;

      const combinedArea = a1.actualArea + a2.actualArea;
      const fitsInOneTile = combinedArea >= tileAreaCm2 * COMPLEMENTARY_FIT_MIN && combinedArea <= tileAreaCm2 * COMPLEMENTARY_FIT_MAX;

      if (fitsInOneTile) {
        pairs.set(idx1, idx2);
        pairs.set(idx2, idx1);
        break;
      }
    }
  }

  return pairs;
}

/**
 * Sort tiles to maximize pairing efficiency.
 * Paired tiles should be processed together.
 */
function optimizeTileProcessingOrder(tiles, analyses, pairs) {
  const indices = [];
  const processed = new Set();

  for (let i = 0; i < tiles.length; i++) {
    if (processed.has(i)) continue;

    const pairedWith = pairs.get(i);
    if (pairedWith !== undefined && !processed.has(pairedWith)) {
      indices.push(i);
      indices.push(pairedWith);
      processed.add(i);
      processed.add(pairedWith);
    } else {
      indices.push(i);
      processed.add(i);
    }
  }

  return indices;
}

function makeRect(w, h) {
  w = clampPos(w);
  h = clampPos(h);
  if (w <= 0 || h <= 0) return null;
  return { w, h };
}

/**
 * Guillotine split with kerf:
 * Cut "needW x needH" from top-left of (containerW x containerH).
 * If a cut creates a remainder on an axis, that cut consumes kerf on that axis.
 */
function guillotineRemainders(containerW, containerH, needW, needH, kerfCm) {
  const w = clampPos(containerW);
  const h = clampPos(containerH);
  const nw = clampPos(needW);
  const nh = clampPos(needH);
  const k = clampPos(kerfCm);

  if (!(w > 0 && h > 0 && nw > 0 && nh > 0)) return [];
  if (nw > w || nh > h) return [];

  const out = [];

  const hasRight = w > nw;
  const rw = Math.max(0, w - nw - (hasRight ? k : 0));
  const r1 = makeRect(rw, h);
  if (r1) out.push(r1);

  const hasBottom = h > nh;
  const rh = Math.max(0, h - nh - (hasBottom ? k : 0));
  const r2 = makeRect(nw, rh);
  if (r2) out.push(r2);

  return out;
}

/**
 * Fit-check with kerf:
 * If offcut is strictly larger than need on an axis, we assume a cut is required -> need + kerf.
 * If exactly equal, no kerf needed on that axis.
 */
function fitsWithKerf(offW, offH, needW, needH, kerfCm) {
  const ow = clampPos(offW);
  const oh = clampPos(offH);
  const nw = clampPos(needW);
  const nh = clampPos(needH);
  const k = clampPos(kerfCm);

  if (!(ow > 0 && oh > 0 && nw > 0 && nh > 0)) return false;

  if (ow < nw) return false;
  if (ow > nw && ow < nw + k) return false;

  if (oh < nh) return false;
  if (oh > nh && oh < nh + k) return false;

  return true;
}

// Global rectangular offcut pool (with optional guillotine split + kerf)
class OffcutPool {
  constructor() {
    /** @type {{id:string,w:number,h:number,from:"tile"|"offcut",isHalfTile?:boolean}[]} */
    this.rects = [];
    this._seq = 0;
  }
  _id() {
    this._seq += 1;
    return `o${this._seq}`;
  }
  add(r, from = "tile", isHalfTile = false) {
    if (!r) return null;
    const w = clampPos(r.w);
    const h = clampPos(r.h);
    if (w <= 0 || h <= 0) return null;
    const entry = { id: this._id(), w, h, from, isHalfTile };
    this.rects.push(entry);
    return entry.id;
  }

  take(needW, needH, { allowRotate, optimizeCuts, kerfCm, preferHalfTile = false }) {
    const w = clampPos(needW);
    const h = clampPos(needH);
    const k = clampPos(kerfCm);

    if (w <= 0 || h <= 0) return { ok: false, used: null };

    let best = null;

    for (let i = 0; i < this.rects.length; i++) {
      const r = this.rects[i];

      // A: no rotate
      if (fitsWithKerf(r.w, r.h, w, h, k)) {
        const leftover = rectArea(r) - w * h;
        const isHalfTileMatch = preferHalfTile && r.isHalfTile;
        const cand = { idx: i, id: r.id, offW: r.w, offH: r.h, rotUsed: false, leftoverArea: leftover, isHalfTileMatch };

        if (!best) best = cand;
        else if (isHalfTileMatch && !best.isHalfTileMatch) best = cand; // Prefer half-tiles for triangular cuts
        else if (optimizeCuts && cand.leftoverArea < best.leftoverArea) best = cand;
        else if (!optimizeCuts) return this._consume(cand, w, h, optimizeCuts, k);
      }

      // B: rotate need
      if (allowRotate) {
        if (fitsWithKerf(r.w, r.h, h, w, k)) {
          const leftover = rectArea(r) - w * h;
          const isHalfTileMatch = preferHalfTile && r.isHalfTile;
          const cand = { idx: i, id: r.id, offW: r.w, offH: r.h, rotUsed: true, leftoverArea: leftover, isHalfTileMatch };

          if (!best) best = cand;
          else if (isHalfTileMatch && !best.isHalfTileMatch) best = cand;
          else if (optimizeCuts && cand.leftoverArea < best.leftoverArea) best = cand;
          else if (!optimizeCuts) return this._consume(cand, w, h, optimizeCuts, k);
        }
      }
    }

    if (!best) return { ok: false, used: null };
    return this._consume(best, w, h, optimizeCuts, k);
  }

  _consume(best, needW, needH, optimizeCuts, kerfCm) {
    const chosen = this.rects.splice(best.idx, 1)[0];

    const usedNeedW = best.rotUsed ? needH : needW;
    const usedNeedH = best.rotUsed ? needW : needH;

    const remainders = [];
    if (optimizeCuts) {
      const rem = guillotineRemainders(chosen.w, chosen.h, usedNeedW, usedNeedH, kerfCm);
      for (const rr of rem) {
        const newId = this.add(rr, "offcut");
        if (newId) remainders.push({ id: newId, w: rr.w, h: rr.h });
      }
    }

    return {
      ok: true,
      used: { id: chosen.id, w: chosen.w, h: chosen.h, rotUsed: best.rotUsed, remainders },
    };
  }

  snapshot() {
    return this.rects.map((r) => ({ id: r.id, w: r.w, h: r.h, from: r.from }));
  }

  /** Returns count of offcuts in the pool */
  count() {
    return this.rects.length;
  }

  /** Clears all offcuts from the pool */
  clear() {
    this.rects = [];
    this._seq = 0;
  }
}

/** Exported for floor-level offcut sharing */
export { OffcutPool };

const metricsCache = new Map();

export function clearMetricsCache(roomId = null) {
  if (roomId) {
    metricsCache.delete(roomId);
    return;
  }
  metricsCache.clear();
}

function getMetricsKey(state, room) {
  const floor = state?.floors?.find(f => f.rooms?.some(r => r.id === room.id));
  const group = floor?.patternGroups?.find(g => g.memberRoomIds?.includes(room.id));
  const originRoom = group?.originRoomId
    ? floor.rooms.find(r => r.id === group.originRoomId) : null;
  // Include skirting config: computeSkirtingNeeds reads room.skirting
  // Include pricing: getRoomPricing reads state.pricing and state.materials[ref]
  const ref = room.tile?.reference || null;
  return JSON.stringify({
    tile: room.tile,
    grout: room.grout,
    pattern: room.pattern,
    skirting: room.skirting,
    exclusions: room.exclusions,
    objects3d: room.objects3d,
    polygonVertices: room.polygonVertices,
    waste: state?.waste,
    pricing: state?.pricing,
    materialRef: ref ? (state?.materials?.[ref] || null) : null,
    originTile: originRoom?.tile || null,
    originPattern: originRoom?.pattern || null,
    originGrout: originRoom?.grout || null,
    originFloorPos: originRoom?.floorPosition || null,
    roomFloorPos: room.floorPosition || null,
  });
}

/**
 * Computes tile planning metrics for a room.
 *
 * @param {Object} state - The application state
 * @param {Object|null} roomOverride - Optional room to compute metrics for (overrides current room)
 * @param {Object} options - Optional settings:
 *   - externalPool: OffcutPool instance to use (enables floor-level offcut sharing)
 *   - returnPool: If true, returns the pool in the result for chaining
 *   - skipCache: If true, bypasses caching
 * @returns {Object} Metrics result with ok, error, data, and optionally pool
 */
export function computePlanMetrics(state, roomOverride = null, options = {}) {
  const { externalPool = null, returnPool = false, skipCache = false } = options;

  const currentRoom = roomOverride || getCurrentRoom(state);
  if (!currentRoom) {
    return { ok: false, error: "Kein Raum ausgewählt.", data: null };
  }

  // Skip cache when using external pool (floor-level sharing mode)
  const useCache = !skipCache && !externalPool;

  const cacheKey = getMetricsKey(state, currentRoom);
  const cached = metricsCache.get(currentRoom.id);
  if (useCache && cached && cached.key === cacheKey) {
    return cached.result;
  }

  // Get floor context for pattern group inheritance
  const floor = getCurrentFloor(state);
  const effectiveSettings = getEffectiveTileSettings(currentRoom, floor, state);

  const tw = Number(effectiveSettings.tile?.widthCm);
  const th = Number(effectiveSettings.tile?.heightCm);
  const grout = Number(effectiveSettings.grout?.widthCm) || 0;

  if (!(tw > 0) || !(th > 0) || grout < 0) {
    return { ok: false, error: "Ungültige Fliesen- oder Fugenmaße.", data: null };
  }

  // options
  const allowRotate = state?.waste?.allowRotate !== false; // default true
  const optimizeCuts = Boolean(state?.waste?.optimizeCuts); // default false
  const kerfCm = clampPos(state?.waste?.kerfCm); // default 0

  // Available area
  const avail = computeAvailableArea(currentRoom, getAllFloorExclusions(currentRoom));
  if (!avail.mp) return { ok: false, error: "Keine verfügbare Fläche.", data: null };

  // Preview tiles (clipped paths) - use effective settings from pattern group origin
  const patternGroupOrigin = computePatternGroupOrigin(currentRoom, floor);
  const t = tilesForPreview(state, avail.mp, roomOverride, false, floor, { originOverride: patternGroupOrigin, effectiveSettings });
  if (t.error) return { ok: false, error: t.error, data: null };

  const tileShape = effectiveSettings.tile?.shape || "rect";
  const tileAreaCm2 = calculateTileArea(tw, th, tileShape);

  let fullTiles = 0;
  let cutTiles = 0;
  let reusedCuts = 0;

  // Use external pool for floor-level offcut sharing, or create new pool
  const pool = externalPool || new OffcutPool();

  const tileUsage = new Array(t.tiles.length);
  const cutNeeds = new Array(t.tiles.length);
  let cutNeedAreaCm2_est = 0;

  const analyses = new Array(t.tiles.length).fill(null);
  for (let i = 0; i < t.tiles.length; i++) {
    const tile = t.tiles[i];
    if (!tile.isFull) {
      analyses[i] = analyzeCutTile(tile, tileAreaCm2);
    }
  }

  const pairs = findComplementaryPairs(t.tiles, analyses, tw, th);
  const processOrder = optimizeTileProcessingOrder(t.tiles, analyses, pairs);

  const pairOffcuts = new Map();

  for (let idx = 0; idx < processOrder.length; idx++) {
    const i = processOrder[idx];
    const tile = t.tiles[i];

    if (tile.isFull) {
      fullTiles++;
      tileUsage[i] = { isFull: true, reused: false, source: "new", need: null, usedOffcut: null, createdOffcuts: [] };
      cutNeeds[i] = null;
      continue;
    }

    const analysis = analyses[i];
    const bb = analysis?.bb || bboxFromPathD(tile.d);
    const need = bb ? { x: bb.x, y: bb.y, w: bb.w, h: bb.h } : null;
    cutNeeds[i] = need;

    const actualArea = analysis?.actualArea || 0;
    const minViableArea = tileAreaCm2 * 0.001;

    if (!bb || !(bb.w > 0 && bb.h > 0) || actualArea < minViableArea) {
      tileUsage[i] = { isFull: false, reused: false, source: "degenerate", need, usedOffcut: null, createdOffcuts: [] };
      continue;
    }

    cutTiles++;

    if (bb && bb.w > 0 && bb.h > 0) cutNeedAreaCm2_est += bb.w * bb.h;

    const polygon = analysis?.polygon || parsePathDToPolygon(tile.d);
    const bboxArea = analysis?.bboxArea || bb.w * bb.h;
    const areaRatio = analysis?.areaRatio || (bboxArea > 0 ? actualArea / bboxArea : 1);
    const isTriangularCut = analysis?.isTriangularCut || (areaRatio >= TRIANGULAR_CUT_MIN && areaRatio <= TRIANGULAR_CUT_MAX);

    const pairedWith = pairs.get(i);
    const pairAlreadyProcessed = pairedWith !== undefined && tileUsage[pairedWith] !== undefined;

    let effectiveW = bb.w;
    let effectiveH = bb.h;

    if (areaRatio < AREA_RATIO_SCALING_THRESHOLD && !isTriangularCut) {
      const scale = Math.sqrt(areaRatio);
      effectiveW = bb.w * scale;
      effectiveH = bb.h * scale;
    }

    if (pairAlreadyProcessed) {
      const pairUsage = tileUsage[pairedWith];
      if (!pairUsage.reused && pairUsage.createdOffcuts && pairUsage.createdOffcuts.length > 0) {
        const offcut = pairUsage.createdOffcuts[0];
        if (offcut && offcut.id && offcut.id.startsWith('pair-')) {
          reusedCuts++;
          tileUsage[i] = {
            isFull: false,
            reused: true,
            source: "paired_offcut",
            need,
            usedOffcut: { id: offcut.id, w: offcut.w, h: offcut.h },
            createdOffcuts: [],
          };
          continue;
        }
      }
    }

    const takeRes = pool.take(effectiveW, effectiveH, {
      allowRotate,
      optimizeCuts,
      kerfCm: optimizeCuts ? kerfCm : 0,
      preferHalfTile: false,
    });

    if (takeRes.ok) {
      reusedCuts++;
      tileUsage[i] = {
        isFull: false,
        reused: true,
        source: "offcut",
        need,
        usedOffcut: takeRes.used,
        createdOffcuts: takeRes.used?.remainders || [],
      };
      continue;
    }

    const createdOffcuts = [];

    if (pairedWith !== undefined && !pairAlreadyProcessed) {
      const offcutW = bb.w;
      const offcutH = bb.h;
      createdOffcuts.push({ id: `pair-${i}-${pairedWith}`, w: offcutW, h: offcutH });
    } else if (isTriangularCut) {
      const offcutW = bb.w;
      const offcutH = bb.h;
      const id = pool.add({ w: offcutW, h: offcutH }, "tile", false);
      if (id) createdOffcuts.push({ id, w: offcutW, h: offcutH });
    } else if (optimizeCuts) {
      const rem = guillotineRemainders(tw, th, effectiveW, effectiveH, kerfCm);
      for (const rr of rem) {
        const id = pool.add(rr, "tile", false);
        if (id) createdOffcuts.push({ id, w: rr.w, h: rr.h });
      }
    } else {
      const leftoverArea = Math.max(0, tileAreaCm2 - actualArea);
      if (leftoverArea > 0) {
        const maxSide = Math.max(tw, th);
        const w = Math.min(maxSide, Math.max(0.1, leftoverArea / maxSide));
        const h = leftoverArea / w;
        const id = pool.add({ w, h }, "tile", false);
        if (id) createdOffcuts.push({ id, w, h });
      }
    }

    tileUsage[i] = { isFull: false, reused: false, source: "new", need, usedOffcut: null, createdOffcuts };
  }

  // === 3D OBJECT FACE TILES ===
  let faceTilesInstalledAreaCm2 = 0;
  for (const obj of (currentRoom.objects3d || [])) {
    for (const surf of (obj.surfaces || [])) {
      if (!surf.tile) continue;

      const isTop = surf.face === "top";
      const faceW = isTop ? obj.w : (surf.face === "left" || surf.face === "right" ? obj.h : obj.w);
      const faceH = isTop ? obj.h : (obj.heightCm || 100);

      const region = {
        widthCm: faceW,
        heightCm: faceH,
        polygonVertices: [
          { x: 0, y: 0 }, { x: faceW, y: 0 },
          { x: faceW, y: faceH }, { x: 0, y: faceH },
        ],
        tile: surf.tile,
        grout: surf.grout || { widthCm: 0.2, colorHex: "#ffffff" },
        pattern: surf.pattern || { type: "grid", bondFraction: 0.5, rotationDeg: 0, offsetXcm: 0, offsetYcm: 0 },
        exclusions: [],
      };

      const faceAvail = computeAvailableArea(region, []);
      if (!faceAvail.mp) continue;

      const faceResult = tilesForPreview(state, faceAvail.mp, region, false, floor, {
        effectiveSettings: { tile: surf.tile, grout: region.grout, pattern: region.pattern },
      });
      if (!faceResult?.tiles) continue;

      for (const ft of faceResult.tiles) {
        if (ft.isFull) fullTiles++;
        else cutTiles++;
      }

      faceTilesInstalledAreaCm2 += Math.max(0, multiPolyArea(faceAvail.mp));
      console.log(`[calc] 3D face tiles: obj=${obj.id} face=${surf.face} faceW=${faceW} faceH=${faceH} tiles=${faceResult.tiles.length}`);
    }
  }

  // === PURCHASE / MATERIAL (Einkauf) ===
  const reserveTiles = Math.max(0, Math.floor(Number(state.pricing?.reserveTiles) || 0));

  // How many physical tiles are needed for this plan:
  // - full tiles always consume a tile
  // - cut placements consume a tile unless satisfied by offcut reuse
  const newTilesForCuts = Math.max(0, cutTiles - reusedCuts);
  const purchasedTiles = fullTiles + newTilesForCuts;
  const purchasedTilesWithReserve = purchasedTiles + reserveTiles;

  // Installed area = net available area (not tile sum) + 3D face tile area
  const installedAreaCm2 = Math.max(0, multiPolyArea(avail.mp)) + faceTilesInstalledAreaCm2;
  const installedAreaM2 = cm2ToM2(installedAreaCm2);

  const purchasedAreaCm2 = purchasedTilesWithReserve * tileAreaCm2;
  const purchasedAreaM2 = cm2ToM2(purchasedAreaCm2);

  const wasteAreaCm2 = Math.max(0, purchasedAreaCm2 - installedAreaCm2);
  const wasteAreaM2 = cm2ToM2(wasteAreaCm2);
  const wastePct = purchasedAreaCm2 > 0 ? (wasteAreaCm2 / purchasedAreaCm2) * 100 : 0;

  // Optional “waste in tiles” for display (area-based)
  const installedTilesAreaEq = tileAreaCm2 > 0 ? installedAreaCm2 / tileAreaCm2 : 0;
  const wasteTiles_est = Math.max(0, purchasedTilesWithReserve - Math.ceil(installedTilesAreaEq));

  // === LABOR (Beschnitt / Aufwand) ===
  const totalPlacedTiles = fullTiles + cutTiles; // what you see in the preview
  const cutTilesPct = totalPlacedTiles > 0 ? (cutTiles / totalPlacedTiles) * 100 : 0;

  // Room gross (bounding box area)
  const bounds = getRoomBounds(currentRoom);
  const roomAreaCm2 = bounds.width * bounds.height;
  const grossRoomAreaM2 = cm2ToM2(roomAreaCm2);

  // Pricing
  const pricing = getRoomPricing(state, currentRoom);
  const pricePerM2 = pricing.pricePerM2;
  const packM2 = pricing.packM2;

  const priceTotal = installedAreaM2 * pricePerM2;
  const packs = packM2 > 0 ? Math.ceil(installedAreaM2 / packM2) : null;
  const purchasedCost = packs && packM2 > 0 ? packs * packM2 * pricePerM2 : priceTotal;

  const result = {
    ok: true,
    error: null,
    data: {
      tiles: {
        fullTiles,
        cutTiles,
        reusedCuts,
        // purchased tiles (no reserve) and with reserve:
        purchasedTiles,
        reserveTiles,
        purchasedTilesWithReserve,
        // keep old name for convenience (but now = purchasedTilesWithReserve)
        totalTilesWithReserve: purchasedTilesWithReserve,
      },

      // NEW: material vs labor separation
      material: {
        tileAreaCm2,
        purchasedAreaM2,
        installedAreaM2,
        wasteAreaM2,
        wastePct,
        wasteTiles_est, // area-based estimate
      },

      labor: {
        totalPlacedTiles,
        cutTiles,
        cutTilesPct,
        // only an estimate (bbox), but useful to compare scenarios
        cutNeedAreaM2_estFromBBox: cm2ToM2(cutNeedAreaCm2_est),
      },

      // keep a small "waste" object for UI toggles / settings visibility
      waste: {
        allowRotate,
        optimizeCuts,
        kerfCm,
      },

      area: {
        grossRoomAreaM2,
        netAreaM2: installedAreaM2, // RENAMED: previously netAreaM2_estFromTiles
      },

      pricing: {
        pricePerM2,
        packM2,
        packs,
        priceTotal,
        purchasedCost,
      },

      debug: {
        tileUsage,
        cutNeeds,
        offcutPoolFinal: pool.snapshot(),
      },
    },
  };

  // Add pool to result if requested (for floor-level offcut chaining)
  if (returnPool) {
    result.pool = pool;
  }

  // Cache the result (skip caching when using external pool)
  if (useCache) {
    metricsCache.set(currentRoom.id, { key: cacheKey, result });
  }

  return result;
}

/**
 * Computes metrics for all rooms on a floor, optionally sharing offcuts between rooms.
 *
 * @param {Object} state - The application state
 * @param {Object} floor - The floor to compute metrics for
 * @returns {Object} Floor metrics with per-room breakdown and totals
 */
export function computeFloorMetrics(state, floor) {
  if (!floor?.rooms?.length) {
    return {
      ok: false,
      error: "No rooms on floor",
      rooms: [],
      totals: null,
      wallTotals: null,
      sharedPool: null
    };
  }

  const useSharedPool = Boolean(state?.waste?.shareOffcuts);
  const sharedPool = useSharedPool ? new OffcutPool() : null;

  const floorRooms = floor?.rooms || [];

  const roomMetrics = [];
  let totalFullTiles = 0;
  let totalCutTiles = 0;
  let totalReusedCuts = 0;
  let totalNetAreaM2 = 0;
  let totalWasteAreaM2 = 0;
  let totalPurchasedTiles = 0;
  let totalCost = 0;

  // Floor rooms
  for (const room of floorRooms) {
    const options = {
      externalPool: sharedPool,
      returnPool: useSharedPool,
      skipCache: useSharedPool
    };

    const metrics = computePlanMetrics(state, room, options);

    roomMetrics.push({
      type: "floor",
      room,
      roomId: room.id,
      roomName: room.name,
      metrics
    });

    if (metrics.ok && metrics.data) {
      const d = metrics.data;
      totalFullTiles += d.tiles.fullTiles || 0;
      totalCutTiles += d.tiles.cutTiles || 0;
      totalReusedCuts += d.tiles.reusedCuts || 0;
      totalNetAreaM2 += d.area.netAreaM2 || 0;
      totalWasteAreaM2 += d.material.wasteAreaM2 || 0;
      totalPurchasedTiles += d.tiles.purchasedTiles || 0;
      totalCost += d.pricing.priceTotal || 0;
    }
  }

  return {
    ok: true,
    rooms: roomMetrics,
    totals: {
      fullTiles: totalFullTiles,
      cutTiles: totalCutTiles,
      reusedCuts: totalReusedCuts,
      netAreaM2: totalNetAreaM2,
      wasteAreaM2: totalWasteAreaM2,
      purchasedTiles: totalPurchasedTiles,
      totalCost
    },
    wallTotals: {
      totalTiles: 0,
      totalCost: 0,
      netAreaM2: 0
    },
    sharedPool: sharedPool?.snapshot() || null
  };
}

/**
 * Calculates the combined total requirements for both floor and skirting.
 */
export function computeGrandTotals(state, roomOverride = null) {
  const metrics = computePlanMetrics(state, roomOverride);
  const skirting = computeSkirtingNeeds(state, roomOverride);

  if (!metrics.ok) {
    return { ok: false, error: metrics.error };
  }

  const d = metrics.data;
  const tileAreaM2 = (d.material.tileAreaCm2) / 10000;
  
  const floorTiles = d.tiles.purchasedTilesWithReserve;
  const floorAreaM2 = floorTiles * tileAreaM2;
  const floorPacks = d.pricing.packM2 > 0 ? Math.ceil(floorAreaM2 / d.pricing.packM2) : null;

  let totalTiles = floorTiles;
  let totalCost = d.pricing.priceTotal;
  let skirtingTiles = 0;

  if (skirting.enabled) {
    totalCost += skirting.totalCost;
    if (skirting.type === "cutout") {
      skirtingTiles = skirting.additionalTiles;
      totalTiles += skirtingTiles;
    }
  }

  // Recalculate area and packs based on total tiles needed (floor + cutout skirting)
  const skirtingAreaM2 = skirtingTiles * tileAreaM2;
  const skirtingPacks = d.pricing.packM2 > 0 ? Math.ceil(skirtingAreaM2 / d.pricing.packM2) : null;
  const totalAreaM2 = totalTiles * tileAreaM2;
  const totalPacks = d.pricing.packM2 > 0 ? Math.ceil(totalAreaM2 / d.pricing.packM2) : null;

  return {
    ok: true,
    floorTiles,
    floorAreaM2,
    floorPacks,
    skirtingTiles,
    skirtingAreaM2,
    skirtingPacks,
    totalTiles,
    totalAreaM2,
    totalPacks,
    totalCost,
    skirtingEnabled: skirting.enabled,
    skirtingType: skirting.type,
    purchasedAreaM2: totalAreaM2, // consistency with computePlanMetrics terminology
    netAreaM2: d.material.installedAreaM2 // Added for project totals
  };
}

/**
 * Calculates project-wide totals by summing up all rooms in all floors.
 */
export function computeProjectTotals(state) {
  let totalTiles = 0;
  let totalCost = 0;
  let totalPurchasedAreaM2 = 0;
  let totalNetAreaM2 = 0;
  let roomCount = 0;
  let totalFloorAreaM2 = 0;
  let totalSkirtingAreaM2 = 0;

  const rooms = [];
  const wallRooms = [];
  const subSurfaceRooms = [];
  const byMaterial = {};
  let wallTotalTiles = 0;
  let wallTotalCost = 0;
  let wallTotalAreaM2 = 0;

  if (state.floors) {
    for (const floor of state.floors) {
      for (const room of (floor.rooms || [])) {
        const grand = computeGrandTotals(state, room);
        if (grand.ok) {
          totalTiles += grand.totalTiles;
          totalCost += grand.totalCost;
          totalPurchasedAreaM2 += grand.totalAreaM2;
          totalNetAreaM2 += grand.netAreaM2;
          totalFloorAreaM2 += grand.floorAreaM2;
          totalSkirtingAreaM2 += grand.skirtingAreaM2;
          roomCount++;

          const roomInfo = {
            id: room.id,
            name: room.name,
            floorName: floor.name,
            reference: room.tile?.reference || "",
            totalTiles: grand.totalTiles,
            totalAreaM2: grand.totalAreaM2,
            netAreaM2: grand.netAreaM2,
            totalCost: grand.totalCost,
            totalPacks: grand.totalPacks,
            floorPacks: grand.floorPacks,
            skirtingPacks: grand.skirtingPacks,
          };
          rooms.push(roomInfo);

          const ref = roomInfo.reference;
          if (!byMaterial[ref]) {
            const pricing = getRoomPricing(state, room);
            byMaterial[ref] = {
              reference: ref,
              totalTiles: 0, totalAreaM2: 0, netAreaM2: 0, totalCost: 0,
              floorAreaM2: 0, skirtingAreaM2: 0, wallAreaM2: 0, subSurfaceAreaM2: 0,
              floorTiles: 0, skirtingTiles: 0, wallTiles: 0, subSurfaceTiles: 0,
              pricePerM2: pricing.pricePerM2, packM2: pricing.packM2,
              extraPacks: (state.materials && state.materials[ref]?.extraPacks) || 0,
            };
          }
          byMaterial[ref].totalTiles += grand.totalTiles;
          byMaterial[ref].totalAreaM2 += grand.totalAreaM2;
          byMaterial[ref].netAreaM2 += grand.netAreaM2;
          byMaterial[ref].totalCost += grand.totalCost;
          byMaterial[ref].floorAreaM2 += grand.floorAreaM2;
          byMaterial[ref].skirtingAreaM2 += grand.skirtingAreaM2;
          byMaterial[ref].floorTiles += grand.floorTiles;
          byMaterial[ref].skirtingTiles += grand.skirtingTiles;
        }
      }

      // Floor room exclusion sub-surfaces (exclusions that carry their own tile/pattern)
      for (const room of (floor.rooms || [])) {
        const floorSubResults = computeSubSurfaceTiles(state, room.exclusions || [], floor);
        for (const ss of floorSubResults) {
          const excl = (room.exclusions || []).find(e => e.id === ss.exclusionId);
          if (!excl?.tile) continue;
          const exTile = resolvePresetTile(excl.tile, state);
          const exRef = exTile?.reference || excl.tile?.reference || '';
          const count = countTilesResult(ss.tiles, exTile?.widthCm || 1, exTile?.heightCm || 1);
          accumulateIntoByMaterial(byMaterial, state, exRef, count, 'subSurface');
          const exPricing = getRoomPricing(state, { tile: { reference: exRef } });
          subSurfaceRooms.push({
            id: `${room.id}-excl-${excl.id}`,
            floorName: floor.name,
            roomName: room.name || '',
            label: excl.label || excl.type || 'Sub-surface',
            reference: exRef,
            areaM2: count.installedAreaM2,
            tiles: count.purchasedTiles,
            cost: count.installedAreaM2 * exPricing.pricePerM2,
            sourceType: 'floor-exclusion',
          });
          console.log(`[computeProjectTotals] floorSubSurf room=${room.id} excl=${ss.exclusionId} ref=${exRef} tiles=${ss.tiles.length}`);
        }
      }

      // Wall surfaces, wall sub-surfaces, wall skirting zones
      for (const wall of (floor.walls || [])) {
        for (let idx = 0; idx < (wall.surfaces || []).length; idx++) {
          const surface = wall.surfaces[idx];
          if (!surface.tile) continue;

          const room = floor.rooms?.find(r => r.id === surface.roomId);
          const region = prepareWallSurface(wall, idx, room, floor, state);
          if (!region) continue;

          const resolvedSurfTile = resolvePresetTile(surface.tile, state);
          const surfRef = resolvedSurfTile?.reference || surface.tile?.reference || '';
          const tileW = resolvedSurfTile?.widthCm || 1;
          const tileH = resolvedSurfTile?.heightCm || 1;

          // Main wall surface tiles
          const wallResult = computeSurfaceTiles(state, region, floor, {
            exclusions: region.exclusions || [],
            effectiveSettings: { tile: region.tile, grout: region.grout, pattern: region.pattern },
          });
          if (wallResult.tiles.length > 0) {
            const count = countTilesResult(wallResult.tiles, tileW, tileH);
            accumulateIntoByMaterial(byMaterial, state, surfRef, count, 'wall');
            const surfPricing = getRoomPricing(state, { tile: { reference: surfRef } });
            wallRooms.push({
              id: `${wall.id}-${idx}`,
              wallId: wall.id,
              surfaceIdx: idx,
              floorName: floor.name,
              roomName: room?.name || '',
              reference: surfRef,
              areaM2: count.installedAreaM2,
              tiles: count.purchasedTiles,
              cost: count.installedAreaM2 * surfPricing.pricePerM2,
            });
            console.log(`[computeProjectTotals] wallSurf wall=${wall.id} surf=${idx} ref=${surfRef} tiles=${wallResult.tiles.length}`);
          }

          // Sub-surface exclusions on this wall surface
          const nonContactExcls = (region.exclusions || []).filter(e => !e._isContact);
          const wallSubResults = computeSubSurfaceTiles(state, nonContactExcls, floor);
          for (const ss of wallSubResults) {
            const excl = nonContactExcls.find(e => e.id === ss.exclusionId);
            if (!excl?.tile) continue;
            const exTile = resolvePresetTile(excl.tile, state);
            const exRef = exTile?.reference || excl.tile?.reference || '';
            const count = countTilesResult(ss.tiles, exTile?.widthCm || 1, exTile?.heightCm || 1);
            accumulateIntoByMaterial(byMaterial, state, exRef, count, 'subSurface');
            const exPricing = getRoomPricing(state, { tile: { reference: exRef } });
            subSurfaceRooms.push({
              id: `${wall.id}-surf${idx}-excl-${excl.id}`,
              floorName: floor.name,
              roomName: room?.name || '',
              label: excl.label || excl.type || 'Sub-surface',
              reference: exRef,
              areaM2: count.installedAreaM2,
              tiles: count.purchasedTiles,
              cost: count.installedAreaM2 * exPricing.pricePerM2,
              sourceType: 'wall-sub-surface',
            });
            console.log(`[computeProjectTotals] wallSubSurf wall=${wall.id} excl=${ss.exclusionId} ref=${exRef} tiles=${ss.tiles.length}`);
          }

          // Skirting zones on this wall surface
          const skirtZones = surface.skirtingZones || [];
          if (skirtZones.length > 0) {
            const zoneResults = computeSkirtingZoneTiles(state, skirtZones, region.widthCm, floor);
            for (let zi = 0; zi < zoneResults.length; zi++) {
              const zr = zoneResults[zi];
              if (!zr.tiles.length) continue;
              const zone = skirtZones[zi];
              if (!zone?.tile) continue;
              const zTile = resolvePresetTile(zone.tile, state);
              const zRef = zTile?.reference || zone.tile?.reference || '';
              const count = countTilesResult(zr.tiles, zTile?.widthCm || 1, zTile?.heightCm || 1);
              accumulateIntoByMaterial(byMaterial, state, zRef, count, 'wall');
              console.log(`[computeProjectTotals] wallSkirtZone wall=${wall.id} zone=${zi} ref=${zRef} tiles=${zr.tiles.length}`);
            }
          }
        }
      }

    }
  }

  const materials = Object.values(byMaterial).map(m => {
    const floorPacks = m.packM2 > 0 ? Math.ceil(m.floorAreaM2 / m.packM2) : 0;
    const skirtingPacks = m.packM2 > 0 ? Math.ceil(m.skirtingAreaM2 / m.packM2) : 0;
    const wallPacks = m.packM2 > 0 ? Math.ceil(m.wallAreaM2 / m.packM2) : 0;
    const subSurfacePacks = m.packM2 > 0 ? Math.ceil(m.subSurfaceAreaM2 / m.packM2) : 0;
    const basePacks = m.packM2 > 0 ? Math.ceil(m.totalAreaM2 / m.packM2) : 0;
    const totalPacks = basePacks + m.extraPacks;
    const adjustedCost = m.totalCost + (m.extraPacks * m.packM2 * m.pricePerM2);
    return { ...m, floorPacks, skirtingPacks, wallPacks, subSurfacePacks, totalPacks, adjustedCost };
  });

  const totalPacks = materials.reduce((sum, m) => sum + (m.totalPacks || 0), 0);
  const totalCostAdjusted = materials.reduce((sum, m) => sum + (m.adjustedCost || 0), 0);
  // Derive totals from byMaterial so wall/sub-surface contributions are included
  const totalTilesAll = materials.reduce((sum, m) => sum + (m.totalTiles || 0), 0);
  const totalNetAreaM2All = materials.reduce((sum, m) => sum + (m.netAreaM2 || 0), 0);

  return {
    totalTiles: totalTilesAll,
    totalCost: totalCostAdjusted,
    totalPurchasedAreaM2,
    totalNetAreaM2: totalNetAreaM2All,
    totalFloorAreaM2,
    totalSkirtingAreaM2,
    totalPacks,
    roomCount,
    rooms,
    materials,
    wallRooms,
    subSurfaceRooms,
    wallTotalTiles,
    wallTotalCost,
    wallTotalAreaM2,
  };
}
