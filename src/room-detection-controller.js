// src/room-detection-controller.js
// Controller for semi-automatic room detection from calibrated background images.
// State machine: idle → waitingForClick → processing → preview → idle

import { t } from "./i18n.js";
import { svgEl } from "./geometry.js";
import { pointerToSvgXY } from "./svg-coords.js";
import { createSurface } from "./surface.js";
import { getCurrentFloor, deepClone, uuid } from "./core.js";
import { detectRoomAtPixel, detectEnvelope, detectSpanningWalls, removePolygonMicroBumps, removeStackedWalls, detectWallThickness, preprocessForRoomDetection } from "./room-detection.js";
import { getWallForEdge, syncFloorWalls, addDoorwayToWall, mergeCollinearWalls, enforceNoParallelWalls, enforceAdjacentPositions } from "./walls.js";
import { classifyRoomEdges, assignWallTypesFromClassification, extendSkeletonForRoom, recomputeEnvelope, alignToEnvelope } from "./envelope.js";
import { showAlert } from "./dialog.js";
import { rectifyPolygon, extractValidAngles, alignToExistingRooms, FLOOR_PLAN_RULES, DEFAULT_WALL_TYPES, DEFAULT_FLOOR_HEIGHT_CM, snapToWallType, classifyWallTypes } from "./floor-plan-rules.js";
import { closestPointOnSegment } from "./polygon-draw.js";

/** Scale factor for rasterizing SVG backgrounds before detection.
 *  SVGs at native 96 DPI give ppc ≈ 0.38 (each pixel = ~2.6 cm).
 *  At 4×, ppc ≈ 1.51 — measurements stabilize within ±2 cm. */
const SVG_DETECTION_SCALE = 4;

// ---- Coordinate helpers (background-specific space, internal to this file) ----

/**
 * Convert SVG cm coordinates to image pixel coordinates.
 * bg = floor.layout.background
 * px = (cmCoord - bg.position) * bg.scale.pixelsPerCm
 */
function cmToImagePx(cmX, cmY, bg) {
  const ppc = bg.scale?.pixelsPerCm ?? 1;
  return {
    x: Math.round((cmX - (bg.position?.x ?? 0)) * ppc),
    y: Math.round((cmY - (bg.position?.y ?? 0)) * ppc)
  };
}

/**
 * Convert image pixel coordinates back to SVG/floor cm coordinates.
 * cm = px / bg.scale.pixelsPerCm + bg.position
 */
function imagePxToCm(px, py, bg) {
  const ppc = bg.scale?.pixelsPerCm ?? 1;
  return {
    x: px / ppc + (bg.position?.x ?? 0),
    y: py / ppc + (bg.position?.y ?? 0)
  };
}

// ---------------------------------------------------------------------------

/**
 * Creates the room detection controller.
 *
 * @param {{
 *   getSvg: () => SVGElement,
 *   getState: () => object,
 *   commit: (label: string, next: object) => void,
 *   render: () => void,
 *   getCurrentFloor: (state?: object) => object
 * }} opts
 */
export function createRoomDetectionController({ getSvg, getState, commit, render, getCurrentFloor: getFloor }) {
  // State machine
  let _state = "idle"; // idle | waitingForClick | processing | preview

  // Stored detection result (for confirm)
  let _detectedPolygonCm = null; // [{x, y}] in floor-global cm
  let _detectedDoorGapsCm = null; // [{midpointCm: {x,y}}]
  let _detectedWallThicknesses = null; // {edges: [{edgeIndex, thicknessPx, thicknessCm}], medianPx, medianCm}

  // SVG preview group
  let _previewGroup = null;

  // Click handler reference (for cleanup)
  let _svgClickHandler = null;
  let _wheelHandler = null;

  // ---- DOM element accessors ----
  function getPanel()      { return document.getElementById("roomDetectionPanel"); }
  function getInstruction(){ return document.getElementById("roomDetectionInstruction"); }
  function getPreviewActions() { return document.getElementById("roomDetectionPreviewActions"); }
  function getErrorEl()    { return document.getElementById("roomDetectionError"); }

  // ---- Panel show/hide ----
  function showPanel() { getPanel()?.classList.remove("hidden"); }
  function hidePanel() { getPanel()?.classList.add("hidden"); }

  function showPreviewActions() { getPreviewActions()?.classList.remove("hidden"); }
  function hidePreviewActions() { getPreviewActions()?.classList.add("hidden"); }

  function showError() { getErrorEl()?.classList.remove("hidden"); }
  function hideError() { getErrorEl()?.classList.add("hidden"); }

  function setInstruction(text) {
    const el = getInstruction();
    if (el) el.textContent = text;
  }

  // ---- Preview overlay ----
  function attachPreviewGroup() {
    const svg = getSvg();
    if (!svg) return;
    if (_previewGroup && !_previewGroup.parentNode) {
      svg.appendChild(_previewGroup);
    }
  }

  function removePreviewGroup() {
    if (_previewGroup) {
      _previewGroup.remove();
      _previewGroup = null;
    }
  }

  function drawPreviewPolygon(polygonCm) {
    const svg = getSvg();
    if (!svg || !polygonCm || polygonCm.length < 3) return;

    removePreviewGroup();
    _previewGroup = svgEl("g", { id: "roomDetectionPreview", class: "room-detection-preview" });

    // Filled polygon
    const pathData = polygonCm.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ") + " Z";
    const fill = svgEl("path", {
      d: pathData,
      fill: "rgba(34, 197, 94, 0.15)",
      stroke: "#22c55e",
      "stroke-width": 2,
      "stroke-dasharray": "5,5",
      "vector-effect": "non-scaling-stroke"
    });
    _previewGroup.appendChild(fill);

    // Vertex circles
    for (const p of polygonCm) {
      const circle = svgEl("circle", {
        cx: p.x,
        cy: p.y,
        r: 5,
        fill: "#22c55e",
        stroke: "#fff",
        "stroke-width": 1.5,
        "vector-effect": "non-scaling-stroke"
      });
      _previewGroup.appendChild(circle);
    }

    svg.appendChild(_previewGroup);
  }

  // Re-attach preview group after zoom/pan re-renders the SVG
  function setupZoomListener() {
    const svg = getSvg();
    if (!svg) return;
    _wheelHandler = () => {
      if (_state === "preview") {
        requestAnimationFrame(() => attachPreviewGroup());
      }
    };
    document.addEventListener("wheel", _wheelHandler, { passive: true });
  }

  function teardownZoomListener() {
    if (_wheelHandler) {
      document.removeEventListener("wheel", _wheelHandler);
      _wheelHandler = null;
    }
  }

  // ---- State transitions ----

  function enterWaitingForClick() {
    _state = "waitingForClick";
    showPanel();
    hidePreviewActions();
    hideError();
    setInstruction(t("roomDetection.clickPrompt"));

    const svg = getSvg();
    if (svg) {
      svg.style.cursor = "crosshair";
      _svgClickHandler = handleSvgClick;
      svg.addEventListener("click", _svgClickHandler);
    }
  }

  function enterIdle() {
    _state = "idle";
    _detectedPolygonCm = null;
    _detectedDoorGapsCm = null;
    _detectedWallThicknesses = null;

    const svg = getSvg();
    if (svg) {
      if (_svgClickHandler) svg.removeEventListener("click", _svgClickHandler);
      svg.style.cursor = "";
      _svgClickHandler = null;
    }

    removePreviewGroup();
    teardownZoomListener();
    hidePanel();
    hidePreviewActions();
    hideError();
  }

  function enterPreview(polygonCm, doorGapsCm, wallThicknesses) {
    _state = "preview";
    _detectedPolygonCm = polygonCm;
    _detectedDoorGapsCm = doorGapsCm;
    _detectedWallThicknesses = wallThicknesses || null;

    // Stop listening for clicks (we're in preview mode, waiting for Confirm/Cancel)
    const svg = getSvg();
    if (svg && _svgClickHandler) {
      svg.removeEventListener("click", _svgClickHandler);
      svg.style.cursor = "";
      _svgClickHandler = null;
    }

    drawPreviewPolygon(polygonCm);
    setupZoomListener();
    showPreviewActions();
    hideError();
    setInstruction(t("roomDetection.activate"));
  }

  // ---- Click handler ----

  async function handleSvgClick(e) {
    if (_state !== "waitingForClick") return;
    if (e.target.closest(".quick-controls, button, input, select")) return;

    e.preventDefault();
    e.stopPropagation();

    const svg = getSvg();
    if (!svg) return;

    const state = getState();
    const floor = getFloor(state);
    const bg = floor?.layout?.background;

    if (!bg?.dataUrl || !bg?.scale?.calibrated || !bg.scale.pixelsPerCm) {
      await showAlert({
        title: t("roomDetection.activate"),
        message: t("roomDetection.failed"),
        type: "warning"
      });
      return;
    }

    _state = "processing";
    svg.style.cursor = "wait";

    const svgPt = pointerToSvgXY(svg, e.clientX, e.clientY);
    const pixelsPerCm = bg.scale.pixelsPerCm;

    // Load the background image (SVGs are upscaled for sharper detection)
    try {
      const { imageData, scaleFactor } = await loadImageData(bg.dataUrl, bg.nativeWidth, bg.nativeHeight);
      const effectivePpc = pixelsPerCm * scaleFactor;

      // Build effective bg for coordinate conversion with upscaled image
      const effectiveBg = scaleFactor === 1 ? bg : {
        ...bg,
        scale: { ...bg.scale, pixelsPerCm: effectivePpc }
      };

      // Preprocess image: remove colored annotation noise
      const envelope = floor.layout?.envelope;
      if (envelope?.polygonCm) {
        const envelopePolygonPx = envelope.polygonCm.map(p =>
          cmToImagePx(p.x, p.y, effectiveBg)
        );
        const spanningWallsPx = (envelope.spanningWalls || []).map(w => ({
          startPx: cmToImagePx(w.startCm.x, w.startCm.y, effectiveBg),
          endPx: cmToImagePx(w.endCm.x, w.endCm.y, effectiveBg),
          thicknessPx: Math.round(w.thicknessCm * effectivePpc),
        }));
        preprocessForRoomDetection(imageData, {
          pixelsPerCm: effectivePpc,
          envelopePolygonPx,
          envelopeWallThicknesses: envelope.wallThicknesses,
          spanningWallsPx,
        });
      }

      // Convert click point to upscaled image pixel space
      const imgPt = cmToImagePx(svgPt.x, svgPt.y, effectiveBg);

      const result = detectRoomAtPixel(imageData, imgPt.x, imgPt.y, {
        pixelsPerCm: effectivePpc,
        maxAreaCm2: 500000
      });

      if (!result || result.polygonPixels.length < 3) {
        _state = "waitingForClick";
        svg.style.cursor = "crosshair";
        showError();
        return;
      }

      // Convert pixel polygon to floor-global cm coordinates
      const polygonCm = result.polygonPixels.map(p => imagePxToCm(p.x, p.y, effectiveBg));

      // Convert door gap midpoints to cm; estimate gap width from bounding box span
      const doorGapsCm = result.doorGapsPx.map(g => ({
        midpointCm: imagePxToCm(g.midpointPx.x, g.midpointPx.y, effectiveBg),
        gapWidthCm: Math.max(g.spanPx?.x ?? 0, g.spanPx?.y ?? 0) / effectivePpc
      }));

      enterPreview(polygonCm, doorGapsCm, result.wallThicknesses);
    } catch (err) {
      console.error("Room detection failed:", err);
      _state = "waitingForClick";
      svg.style.cursor = "crosshair";
      showError();
    }
  }

  // ---- Confirm: insert room ----

  function confirmDetection() {
    if (_state !== "preview" || !_detectedPolygonCm || _detectedPolygonCm.length < 3) return;

    const state = getState();
    const next = deepClone(state);
    const floor = getCurrentFloor(next);
    if (!floor) return;

    // Rectify polygon: snap edges to discovered angles (from envelope) or standard angles
    const envelope = floor?.layout?.envelope;
    const rules = envelope?.validAngles
      ? { ...FLOOR_PLAN_RULES, standardAngles: envelope.validAngles }
      : FLOOR_PLAN_RULES;

    console.log(`[confirmDetection] START — raw polygon: ${_detectedPolygonCm.length} verts`);
    console.log(`[confirmDetection]   raw verts: ${JSON.stringify(_detectedPolygonCm.map(p => `(${p.x.toFixed(1)},${p.y.toFixed(1)})`))}`);
    console.log(`[confirmDetection]   envelope: ${envelope ? 'present' : 'NONE'}, validAngles: ${JSON.stringify(envelope?.validAngles)}`);
    console.log(`[confirmDetection]   detectedWallThicknesses: ${JSON.stringify(_detectedWallThicknesses)}`);

    const rectifiedGlobal = rectifyPolygon(_detectedPolygonCm, rules);
    console.log(`[confirmDetection]   rectified: ${rectifiedGlobal.length} verts: ${JSON.stringify(rectifiedGlobal.map(p => `(${p.x.toFixed(1)},${p.y.toFixed(1)})`))}`);


    // Compute bounding box for floorPosition (top-left corner)
    let minX = Infinity, minY = Infinity;
    for (const p of rectifiedGlobal) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
    }

    const localVertices = rectifiedGlobal.map(p => ({
      x: Math.round((p.x - minX) * 10) / 10,
      y: Math.round((p.y - minY) * 10) / 10
    }));

    const floorPos = {
      x: Math.round(minX * 10) / 10,
      y: Math.round(minY * 10) / 10
    };

    console.log(`[confirmDetection]   localVertices: ${JSON.stringify(localVertices.map(p => `(${p.x.toFixed(1)},${p.y.toFixed(1)})`))}`);
    console.log(`[confirmDetection]   initial floorPos: (${floorPos.x},${floorPos.y})`);

    // Align to envelope edges first (higher priority), then to existing rooms
    const { floorPosition: envAlignedPos } = alignToEnvelope(
      localVertices, floorPos, envelope
    );
    console.log(`[confirmDetection]   after alignToEnvelope: (${envAlignedPos.x},${envAlignedPos.y})`);

    const { floorPosition: alignedPos } = alignToExistingRooms(
      localVertices, envAlignedPos, floor.rooms || []
    );
    console.log(`[confirmDetection]   after alignToExistingRooms: (${alignedPos.x},${alignedPos.y})`);

    const room = createSurface({
      name: t("room.newRoom") || "New Room",
      polygonVertices: localVertices,
      floorPosition: alignedPos
    });

    floor.rooms = floor.rooms || [];
    floor.rooms.push(room);
    next.selectedRoomId = room.id;
    console.log(`[confirmDetection]   created room ${room.id}, ${floor.rooms.length} rooms total`);

    // Sync walls and merge collinear segments from different rooms
    // Skip position enforcement — thicknesses are still defaults; enforce after classification
    console.log(`[confirmDetection]   syncFloorWalls (enforcePositions=false)...`);
    syncFloorWalls(floor, { enforcePositions: false });
    console.log(`[confirmDetection]   after syncFloorWalls: ${floor.walls.length} walls`);
    for (const w of floor.walls) {
      console.log(`[confirmDetection]     wall ${w.id}: room=${w.roomEdge?.roomId}:edge${w.roomEdge?.edgeIndex}, thick=${w.thicknessCm}cm, (${w.start.x.toFixed(1)},${w.start.y.toFixed(1)})→(${w.end.x.toFixed(1)},${w.end.y.toFixed(1)})`);
    }

    mergeCollinearWalls(floor);
    console.log(`[confirmDetection]   after mergeCollinearWalls: ${floor.walls.length} walls`);

    // Classify room edges and assign wall types based on envelope/spanning/shared/interior
    const classification = classifyRoomEdges(room, floor);
    assignWallTypesFromClassification(
      floor, room, classification,
      _detectedWallThicknesses?.edges,
    );

    // Apply per-edge wall thickness from detection for edges not covered by classification.
    // The classification handles envelope/spanning/shared edges; for interior edges with
    // no direct detection match, fall back to the original midpoint-proximity approach.
    const n = rectifiedGlobal.length;
    if (_detectedWallThicknesses?.edges) {
      const rawPoly = _detectedPolygonCm;
      const { minCm, maxCm } = FLOOR_PLAN_RULES.wallThickness;
      for (const edgeMeas of _detectedWallThicknesses.edges) {
        if (edgeMeas.thicknessCm < minCm || edgeMeas.thicknessCm > maxCm) continue;

        const rawA = rawPoly[edgeMeas.edgeIndex];
        const rawB = rawPoly[(edgeMeas.edgeIndex + 1) % rawPoly.length];
        const mid = { x: (rawA.x + rawB.x) / 2, y: (rawA.y + rawB.y) / 2 };

        let bestEdge = -1;
        let bestDist = Infinity;
        for (let i = 0; i < n; i++) {
          const cp = closestPointOnSegment(mid, rectifiedGlobal[i], rectifiedGlobal[(i + 1) % n]);
          if (!cp) continue;
          const dist = Math.hypot(cp.x - mid.x, cp.y - mid.y);
          if (dist < bestDist) { bestDist = dist; bestEdge = i; }
        }

        if (bestEdge < 0) continue;
        // Only apply if classification didn't already set this edge's wall type
        const cls = classification[bestEdge];
        if (cls && cls.type !== "interior") continue;

        const wall = getWallForEdge(floor, room.id, bestEdge);
        if (wall) {
          const wallTypes = floor.layout?.wallDefaults?.types;
          const { snappedCm } = snapToWallType(edgeMeas.thicknessCm, wallTypes);
          console.log(`[confirmDetection]   fallback thickness: rawEdge=${edgeMeas.edgeIndex} → rectEdge=${bestEdge}, measured=${edgeMeas.thicknessCm}cm → snapped=${snappedCm}cm (was=${wall.thicknessCm}cm)`);
          wall.thicknessCm = snappedCm;
        }
      }
    }

    // Extend skeleton boundary for any "extending" edges
    const extendingCount = classification.filter(c => c.type === "extending").length;
    console.log(`[envelope] confirmDetection: extending skeleton for room ${room.id} (${extendingCount} extending edges)`);
    extendSkeletonForRoom(floor, room, classification);

    // Enforce no parallel walls on envelope edges
    console.log(`[confirmDetection]   enforceNoParallelWalls...`);
    enforceNoParallelWalls(floor);
    console.log(`[confirmDetection]   after enforceNoParallelWalls: ${floor.walls.length} walls`);

    // Enforce adjacent positions with correct post-classification thicknesses
    console.log(`[confirmDetection]   enforceAdjacentPositions...`);
    enforceAdjacentPositions(floor);

    // Recompute the living envelope after wall assignments
    console.log(`[confirmDetection]   recomputeEnvelope...`);
    recomputeEnvelope(floor);
    console.log(`[confirmDetection]   final envelope: ${floor.layout?.envelope?.polygonCm?.length || 0} verts`);

    // Apply floor height from wallDefaults to all detection-created walls
    const floorHeight = floor.layout?.wallDefaults?.heightCm;
    if (floorHeight && Number.isFinite(floorHeight)) {
      for (let i = 0; i < localVertices.length; i++) {
        const wall = getWallForEdge(floor, room.id, i);
        if (wall) {
          wall.heightStartCm = floorHeight;
          wall.heightEndCm = floorHeight;
        }
      }
    }

    // Insert each detected door gap as a wall doorway
    for (const gap of (_detectedDoorGapsCm || [])) {
      const { midpointCm, gapWidthCm } = gap;

      // Find the polygon edge (floor-global) closest to the gap midpoint
      let bestEdge = -1;
      let bestDist = Infinity;
      let bestT = 0;
      let bestLen = 0;

      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const sx = rectifiedGlobal[i].x, sy = rectifiedGlobal[i].y;
        const ex = rectifiedGlobal[j].x, ey = rectifiedGlobal[j].y;
        const dx = ex - sx, dy = ey - sy;
        const edgeLenSq = dx * dx + dy * dy;
        if (edgeLenSq < 1e-6) continue;

        const t = ((midpointCm.x - sx) * dx + (midpointCm.y - sy) * dy) / edgeLenSq;
        const tc = Math.max(0, Math.min(1, t));
        const px = sx + tc * dx - midpointCm.x;
        const py = sy + tc * dy - midpointCm.y;
        const dist = Math.sqrt(px * px + py * py);

        if (dist < bestDist) {
          bestDist = dist;
          bestEdge = i;
          bestT = t;
          bestLen = Math.sqrt(edgeLenSq);
        }
      }

      if (bestEdge < 0) continue;

      const wall = getWallForEdge(floor, room.id, bestEdge);
      if (!wall) continue;

      const widthCm = Math.max(60, Math.min(200, gapWidthCm || 90));
      const midOffset = bestT * bestLen;
      const offsetCm = Math.max(0, Math.min(bestLen - widthCm, midOffset - widthCm / 2));

      addDoorwayToWall(wall, {
        id: uuid(),
        offsetCm: Math.round(offsetCm * 10) / 10,
        widthCm: Math.round(widthCm * 10) / 10,
        heightCm: 210,
        elevationCm: 0
      });
    }

    console.log(`[confirmDetection] DONE — final wall summary:`);
    for (const w of floor.walls) {
      const surfStr = w.surfaces.map(s => `${s.roomId}:e${s.edgeIndex}`).join(',');
      console.log(`[confirmDetection]   wall ${w.id}: owner=${w.roomEdge?.roomId}:e${w.roomEdge?.edgeIndex}, thick=${w.thicknessCm}cm, surfs=[${surfStr}], doors=${w.doorways.length}`);
    }

    commit(t("roomDetection.activate") || "Detect room", next);
    enterIdle();
    render();
  }

  // ---- Public API ----

  function activate() {
    if (_state !== "idle") return;
    enterWaitingForClick();
  }

  function cancel() {
    enterIdle();
    render();
  }

  function isActive() {
    return _state !== "idle";
  }

  return { activate, cancel, confirmDetection, isActive };
}

// ---------------------------------------------------------------------------
// Helper: load image into ImageData
// ---------------------------------------------------------------------------
/**
 * Returns the rasterization scale factor for a given dataUrl.
 * SVGs are upscaled by SVG_DETECTION_SCALE; raster images use 1×.
 * Exported for testing.
 */
export function getDetectionScaleFactor(dataUrl) {
  return dataUrl && dataUrl.startsWith("data:image/svg+xml") ? SVG_DETECTION_SCALE : 1;
}

export function loadImageData(dataUrl, nativeWidth, nativeHeight) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scaleFactor = getDetectionScaleFactor(dataUrl);
      const baseW = nativeWidth || img.naturalWidth;
      const baseH = nativeHeight || img.naturalHeight;
      const w = baseW * scaleFactor;
      const h = baseH * scaleFactor;
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      // Fill white so transparent SVG areas don't render as black (which
      // the wall mask would misclassify as wall pixels).
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      resolve({ imageData: ctx.getImageData(0, 0, w, h), scaleFactor });
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

// ---------------------------------------------------------------------------
// Standalone envelope detection (called after calibration)
// ---------------------------------------------------------------------------

/**
 * Detects and stores the building envelope for the current floor.
 * Runs automatically after calibration completes.
 *
 * @param {{ getState: () => object, commit: (label: string, next: object) => void, getCurrentFloor: (state?: object) => object }} opts
 * @returns {Promise<boolean>} true if envelope was detected and stored
 */
export async function detectAndStoreEnvelope({ getState, commit, getCurrentFloor: getFloor }) {
  const state = getState();
  const floor = getFloor(state);
  const bg = floor?.layout?.background;

  if (!bg?.dataUrl || !bg?.scale?.calibrated || !bg.scale.pixelsPerCm) {
    return false;
  }

  const { imageData, scaleFactor } = await loadImageData(bg.dataUrl, bg.nativeWidth, bg.nativeHeight);
  const effectivePpc = bg.scale.pixelsPerCm * scaleFactor;

  const result = detectEnvelope(imageData, { pixelsPerCm: effectivePpc });
  if (!result || result.polygonPixels.length < 3) {
    return false;
  }

  // Build effective bg for coordinate conversion with upscaled image
  const effectiveBg = scaleFactor === 1 ? bg : {
    ...bg,
    scale: { ...bg.scale, pixelsPerCm: effectivePpc }
  };

  // Convert pixel polygon to floor-global cm coordinates
  const polygonCm = result.polygonPixels.map(p => imagePxToCm(p.x, p.y, effectiveBg));

  // Detect structural spanning walls inside the envelope (before rectification —
  // detectSpanningWalls uses wallMask/buildingMask, not the rectified polygon)
  let spanningWalls = [];
  if (result.wallMask && result.buildingMask) {
    const { minCm, maxCm } = FLOOR_PLAN_RULES.wallThickness;
    const rawWalls = detectSpanningWalls(
      imageData, result.wallMask, result.buildingMask,
      imageData.width, imageData.height,
      { pixelsPerCm: effectivePpc, minThicknessCm: minCm, maxThicknessCm: maxCm }
    );
    spanningWalls = rawWalls.map(wall => ({
      orientation: wall.orientation,
      startCm: imagePxToCm(wall.startPx.x, wall.startPx.y, effectiveBg),
      endCm: imagePxToCm(wall.endPx.x, wall.endPx.y, effectiveBg),
      thicknessCm: Math.round(wall.thicknessPx / effectivePpc * 10) / 10,
    }));
  }

  // Discover valid angles from the pre-rectification polygon and spanning walls.
  // Use a higher minEdgeLengthCm than the default (5cm) because raw detection
  // polygons have noise diagonals that can accumulate >5cm total. A real building
  // direction needs at least 50cm of total edge length (≈ max wall thickness).
  const validAngles = extractValidAngles(polygonCm, spanningWalls, {
    minEdgeLengthCm: FLOOR_PLAN_RULES.wallThickness.maxCm,
  });

  // Rectify polygon: snap edges to discovered angles
  const rectifyRules = { ...FLOOR_PLAN_RULES, standardAngles: validAngles };
  const rectified = rectifyPolygon(polygonCm, rectifyRules);

  // Remove micro-bumps from external structures (retaining walls, stairs, etc.)
  const bumpThreshold = result.wallThicknesses?.medianCm || 30;
  const bumped = removePolygonMicroBumps(rectified, bumpThreshold);

  // Re-rectify: bump removal can leave residual notches where nearby V (or H)
  // edges were separated by the bump.  A second pass merges those edges.
  const reRectified = rectifyPolygon(bumped, rectifyRules);

  // Remove stacked walls: parallel edges overlapping within wall-thickness distance
  // (e.g. contour traced both inner and outer face of same wall)
  const cleaned = removeStackedWalls(reRectified);

  // Re-measure wall thickness on the cleaned polygon so edge indices match
  const cleanedPx = cleaned.map(p => cmToImagePx(p.x, p.y, effectiveBg));
  const wallThicknesses = detectWallThickness(
    imageData, cleanedPx, imageData.width, imageData.height,
    effectivePpc, { probeFromInnerFace: true }
  );

  // Classify wall types from all measured thicknesses
  const allThicknesses = [
    ...wallThicknesses.edges.map(e => e.thicknessCm),
    ...spanningWalls.map(w => w.thicknessCm),
  ];
  const wallTypes = classifyWallTypes(allThicknesses);

  // Store in state
  const next = deepClone(getState());
  const nextFloor = getFloor(next);
  if (!nextFloor?.layout) return false;

  nextFloor.layout.envelope = {
    polygonCm: cleaned,
    wallThicknesses,
    spanningWalls,
    validAngles,
    wallTypes,
  };

  // Populate floor-level wall defaults (if absent — preserves user customizations)
  if (!nextFloor.layout.wallDefaults) {
    nextFloor.layout.wallDefaults = {
      types: DEFAULT_WALL_TYPES.map(t => ({ ...t })),
      heightCm: DEFAULT_FLOOR_HEIGHT_CM,
    };
  }

  commit("Detect floor envelope", next);
  return true;
}
