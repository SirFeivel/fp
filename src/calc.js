// src/calc.js
import { computeAvailableArea, tilesForPreview, multiPolyArea, getRoomBounds } from "./geometry.js";
import { getCurrentRoom } from "./core.js";

// cm² -> m²
function cm2ToM2(aCm2) {
  return aCm2 / 10000;
}

function clampPos(n) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.max(0, x) : 0;
}

function calculateTileArea(tw, th, shape) {
  if (shape === "hex") {
    const radius = tw / Math.sqrt(3);
    return (3 * Math.sqrt(3) / 2) * radius * radius;
  }
  return tw * th;
}

function rectArea(r) {
  return Math.max(0, r.w) * Math.max(0, r.h);
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
function analyzeCutTile(tile, tileAreaCm2) {
  const bb = bboxFromPathD(tile.d);
  if (!bb || !(bb.w > 0 && bb.h > 0)) {
    return null;
  }

  const polygon = parsePathDToPolygon(tile.d);
  const bboxArea = bb.w * bb.h;
  const actualArea = polygon ? multiPolyArea(polygon) : bboxArea;
  const areaRatio = bboxArea > 0 ? actualArea / bboxArea : 1;
  const isTriangularCut = areaRatio >= 0.45 && areaRatio <= 0.6;

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
function findComplementaryPairs(tiles, analyses, tw, th) {
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
      const fitsInOneTile = combinedArea >= tileAreaCm2 * 0.90 && combinedArea <= tileAreaCm2 * 1.10;

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
}

export function computePlanMetrics(state) {
  const currentRoom = getCurrentRoom(state);
  if (!currentRoom) {
    return { ok: false, error: "Kein Raum ausgewählt.", data: null };
  }

  const tw = Number(currentRoom.tile?.widthCm);
  const th = Number(currentRoom.tile?.heightCm);
  const grout = Number(currentRoom.grout?.widthCm) || 0;

  if (!(tw > 0) || !(th > 0) || grout < 0) {
    return { ok: false, error: "Ungültige Fliesen- oder Fugenmaße.", data: null };
  }

  // options
  const allowRotate = state?.waste?.allowRotate !== false; // default true
  const optimizeCuts = Boolean(state?.waste?.optimizeCuts); // default false
  const kerfCm = clampPos(state?.waste?.kerfCm); // default 0

  // Available area
  const avail = computeAvailableArea(currentRoom, currentRoom.exclusions);
  if (!avail.mp) return { ok: false, error: "Keine verfügbare Fläche.", data: null };

  // Preview tiles (clipped paths)
  const t = tilesForPreview(state, avail.mp);
  if (t.error) return { ok: false, error: t.error, data: null };

  const tileShape = currentRoom.tile?.shape || "rect";
  const tileAreaCm2 = calculateTileArea(tw, th, tileShape);

  let fullTiles = 0;
  let cutTiles = 0;
  let reusedCuts = 0;

  const pool = new OffcutPool();

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
    const isTriangularCut = analysis?.isTriangularCut || (areaRatio >= 0.45 && areaRatio <= 0.6);

    const pairedWith = pairs.get(i);
    const pairAlreadyProcessed = pairedWith !== undefined && tileUsage[pairedWith] !== undefined;

    let effectiveW = bb.w;
    let effectiveH = bb.h;

    if (areaRatio < 0.75 && !isTriangularCut) {
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

  // === PURCHASE / MATERIAL (Einkauf) ===
  const reserveTiles = Math.max(0, Math.floor(Number(state.pricing?.reserveTiles) || 0));

  // How many physical tiles are needed for this plan:
  // - full tiles always consume a tile
  // - cut placements consume a tile unless satisfied by offcut reuse
  const newTilesForCuts = Math.max(0, cutTiles - reusedCuts);
  const purchasedTiles = fullTiles + newTilesForCuts;
  const purchasedTilesWithReserve = purchasedTiles + reserveTiles;

  // Installed area = net available area (not tile sum)
  const installedAreaCm2 = Math.max(0, multiPolyArea(avail.mp));
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

  // Pricing (still per installed area)
  const pricePerM2 = Number(state.pricing?.pricePerM2) || 0;
  const packM2 = Number(state.pricing?.packM2) || 0;

  const priceTotal = installedAreaM2 * pricePerM2;
  const packs = packM2 > 0 ? Math.ceil(installedAreaM2 / packM2) : null;

  return {
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
      },

      debug: {
        tileUsage,
        cutNeeds,
        offcutPoolFinal: pool.snapshot(),
      },
    },
  };
}