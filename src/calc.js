// src/calc.js
import { computeAvailableArea, tilesForPreview, multiPolyArea } from "./geometry.js";
import { getCurrentRoom } from "./core.js";

// cm² -> m²
function cm2ToM2(aCm2) {
  return aCm2 / 10000;
}

function clampPos(n) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.max(0, x) : 0;
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
    /** @type {{id:string,w:number,h:number,from:"tile"|"offcut"}[]} */
    this.rects = [];
    this._seq = 0;
  }
  _id() {
    this._seq += 1;
    return `o${this._seq}`;
  }
  add(r, from = "tile") {
    if (!r) return null;
    const w = clampPos(r.w);
    const h = clampPos(r.h);
    if (w <= 0 || h <= 0) return null;
    const entry = { id: this._id(), w, h, from };
    this.rects.push(entry);
    return entry.id;
  }

  take(needW, needH, { allowRotate, optimizeCuts, kerfCm }) {
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
        const cand = { idx: i, id: r.id, offW: r.w, offH: r.h, rotUsed: false, leftoverArea: leftover };
        if (!best) best = cand;
        else if (optimizeCuts && cand.leftoverArea < best.leftoverArea) best = cand;
        else if (!optimizeCuts) return this._consume(cand, w, h, optimizeCuts, k);
      }

      // B: rotate need
      if (allowRotate) {
        if (fitsWithKerf(r.w, r.h, h, w, k)) {
          const leftover = rectArea(r) - w * h;
          const cand = { idx: i, id: r.id, offW: r.w, offH: r.h, rotUsed: true, leftoverArea: leftover };
          if (!best) best = cand;
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

  const tileAreaCm2 = tw * th;

  let fullTiles = 0;
  let cutTiles = 0;
  let reusedCuts = 0;

  const pool = new OffcutPool();

  // Debug
  const tileUsage = []; // per preview tile index
  const cutNeeds = []; // bbox per preview tile index
  let cutNeedAreaCm2_est = 0; // only bbox-area, as estimate

  for (let i = 0; i < t.tiles.length; i++) {
    const tile = t.tiles[i];

    if (tile.isFull) {
      fullTiles++;
      tileUsage.push({ isFull: true, reused: false, source: "new", need: null, usedOffcut: null, createdOffcuts: [] });
      cutNeeds.push(null);
      continue;
    }

    cutTiles++;

    const bb = bboxFromPathD(tile.d);
    const need = bb ? { x: bb.x, y: bb.y, w: bb.w, h: bb.h } : null;
    cutNeeds.push(need);

    if (bb && bb.w > 0 && bb.h > 0) cutNeedAreaCm2_est += bb.w * bb.h;

    // No bbox => cannot reuse => treat as new cut tile without offcuts
    if (!bb || !(bb.w > 0 && bb.h > 0)) {
      tileUsage.push({ isFull: false, reused: false, source: "new", need, usedOffcut: null, createdOffcuts: [] });
      continue;
    }

    // Try reuse from pool
    const takeRes = pool.take(bb.w, bb.h, {
      allowRotate,
      optimizeCuts,
      kerfCm: optimizeCuts ? kerfCm : 0,
    });

    if (takeRes.ok) {
      reusedCuts++;
      tileUsage.push({
        isFull: false,
        reused: true,
        source: "offcut",
        need,
        usedOffcut: takeRes.used,
        createdOffcuts: takeRes.used?.remainders || [],
      });
      continue;
    }

    // Not reused => new tile => create offcuts
    const createdOffcuts = [];

    if (optimizeCuts) {
      const rem = guillotineRemainders(tw, th, bb.w, bb.h, kerfCm);
      for (const rr of rem) {
        const id = pool.add(rr, "tile");
        if (id) createdOffcuts.push({ id, w: rr.w, h: rr.h });
      }
    } else {
      // conservative single-rect by leftover area
      const leftoverArea = Math.max(0, tileAreaCm2 - bb.w * bb.h);
      if (leftoverArea > 0) {
        const maxSide = Math.max(tw, th);
        const w = Math.min(maxSide, Math.max(0.1, leftoverArea / maxSide));
        const h = leftoverArea / w;
        const id = pool.add({ w, h }, "tile");
        if (id) createdOffcuts.push({ id, w, h });
      }
    }

    tileUsage.push({ isFull: false, reused: false, source: "new", need, usedOffcut: null, createdOffcuts });
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

  // Room gross
  const roomAreaCm2 = Number(state.room?.widthCm) * Number(state.room?.heightCm);
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