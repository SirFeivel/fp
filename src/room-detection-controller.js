// src/room-detection-controller.js
// Controller for semi-automatic room detection from calibrated background images.
// State machine: idle → waitingForClick → processing → preview → idle

import { t } from "./i18n.js";
import { svgEl } from "./geometry.js";
import { pointerToSvgXY } from "./svg-coords.js";
import { createSurface } from "./surface.js";
import { getCurrentFloor, deepClone, uuid } from "./core.js";
import { detectRoomAtPixel, detectEnvelope, detectSpanningWalls, detectWallThickness, preprocessForRoomDetection } from "./room-detection.js";
import { getWallForEdge, syncFloorWalls, addDoorwayToWall, mergeCollinearWalls, enforceNoParallelWalls, enforceAdjacentPositions } from "./walls.js";
import { classifyRoomEdges, assignWallTypesFromClassification, extendSkeletonForRoom, recomputeEnvelope, alignToEnvelope, constrainRoomToStructuralBoundaries, enforceSkeletonWallProperties } from "./envelope.js";
import { showAlert } from "./dialog.js";
import { rectifyPolygon, extractValidAngles, alignToExistingRooms, FLOOR_PLAN_RULES, DEFAULT_WALL_TYPES, DEFAULT_FLOOR_HEIGHT_CM, classifyWallTypes, removePolygonMicroBumps, removeStackedWalls, enforcePolygonRules } from "./floor-plan-rules.js";

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
/** Round to 1 decimal place (0.1 cm precision). */
function round1(v) { return Math.round(v * 10) / 10; }

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
  function positionPanelAboveEnvelope(panel) {
    const svg = getSvg();
    const floor = getFloor();
    const envelope = floor?.layout?.envelope;
    if (!svg || !envelope?.polygonCm?.length) return; // fall back to CSS default

    // Find envelope top edge center in SVG (cm) coordinates
    const ys = envelope.polygonCm.map(p => p.y);
    const xs = envelope.polygonCm.map(p => p.x);
    const minY = Math.min(...ys);
    const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;

    // Convert SVG point to screen, then to container-relative
    const pt = svg.createSVGPoint();
    pt.x = centerX;
    pt.y = minY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const screenPt = pt.matrixTransform(ctm);

    const container = svg.parentElement;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const relX = screenPt.x - containerRect.left;
    const relY = screenPt.y - containerRect.top;

    // Position: centered horizontally at envelope center, bottom edge just above envelope top
    const gap = 12; // px gap between panel and envelope
    panel.style.left = `${relX}px`;
    panel.style.top = `${relY - gap}px`;
    panel.style.transform = "translate(-50%, -100%)";
  }

  function showPanel() {
    const panel = getPanel();
    if (!panel) return;
    panel.classList.remove("hidden");
    positionPanelAboveEnvelope(panel);
  }
  function hidePanel() {
    const panel = getPanel();
    if (!panel) return;
    panel.classList.add("hidden");
    // Reset to CSS defaults so calibration panel (same class) isn't affected
    panel.style.left = "";
    panel.style.top = "";
    panel.style.transform = "";
  }

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
      console.log(`[room-detection] click: svgCm=(${svgPt.x.toFixed(1)}, ${svgPt.y.toFixed(1)}), imgPx=(${imgPt.x}, ${imgPt.y}), ppc=${effectivePpc.toFixed(4)}, scaleFactor=${scaleFactor}`);

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

    // Use envelope median wall thickness for bump/stacked wall thresholds
    const medianCm = envelope?.wallThicknesses?.medianCm;
    const bumpThresholdCm = medianCm ? medianCm * 0.8 : null;
    const stackedWallGapCm = medianCm ? medianCm * 1.5 : null;
    const rectifiedGlobal = enforcePolygonRules(_detectedPolygonCm, {
      rules, bumpThresholdCm, stackedWallGapCm,
    });
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

    // Constrain edges to structural boundaries (reshape polygon)
    const alignedGlobal = localVertices.map(v => ({
      x: alignedPos.x + v.x, y: alignedPos.y + v.y
    }));
    const constrainedGlobal = constrainRoomToStructuralBoundaries(alignedGlobal, envelope);

    // Recompute local vertices + floorPosition from constrained global coords
    let cMinX = Infinity, cMinY = Infinity;
    for (const p of constrainedGlobal) {
      if (p.x < cMinX) cMinX = p.x;
      if (p.y < cMinY) cMinY = p.y;
    }
    const constrainedLocal = constrainedGlobal.map(p => ({
      x: round1(p.x - cMinX), y: round1(p.y - cMinY)
    }));
    const constrainedPos = { x: round1(cMinX), y: round1(cMinY) };
    console.log(`[confirmDetection]   after constrainToSkeleton: pos=(${constrainedPos.x},${constrainedPos.y})`);

    const room = createSurface({
      name: t("room.newRoom") || "New Room",
      polygonVertices: constrainedLocal,
      floorPosition: constrainedPos
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

    // Top-down skeleton enforcement: force skeleton properties on all boundary-aligned walls
    enforceSkeletonWallProperties(floor);

    // Classify room edges and assign wall types based on envelope/spanning/shared/interior
    const classification = classifyRoomEdges(room, floor);
    assignWallTypesFromClassification(
      floor, room, classification,
      _detectedWallThicknesses?.edges,
    );

    // Note: fallback per-edge thickness matching removed — enforceSkeletonWallProperties
    // handles boundary walls, and classification handles interior edges.
    const n = rectifiedGlobal.length;

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

    // Note: height assignment removed — enforceSkeletonWallProperties handles it.

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

  // ── Pass 1: raw image → rough envelope ───────────────────────────────────
  const { imageData, scaleFactor } = await loadImageData(bg.dataUrl, bg.nativeWidth, bg.nativeHeight);
  const effectivePpc = bg.scale.pixelsPerCm * scaleFactor;
  console.log(`[envelope] Pass 1 start: ppc=${bg.scale.pixelsPerCm.toFixed(3)} effectivePpc=${effectivePpc.toFixed(3)} scaleFactor=${scaleFactor}`);

  const result = detectEnvelope(imageData, { pixelsPerCm: effectivePpc });
  if (!result || result.polygonPixels.length < 3) {
    console.log("[envelope] Pass 1 failed — no valid polygon");
    return false;
  }
  console.log("[envelope] Pass 1 polygon: %d vertices", result.polygonPixels.length);

  // Build effective bg for coordinate conversion with upscaled image
  const effectiveBg = scaleFactor === 1 ? bg : {
    ...bg,
    scale: { ...bg.scale, pixelsPerCm: effectivePpc }
  };

  // Detect structural spanning walls from pass-1 masks (needed for preprocessing)
  let pass1SpanningWalls = [];
  if (result.wallMask && result.buildingMask) {
    const { minCm, maxCm } = FLOOR_PLAN_RULES.wallThickness;
    const pass1Rejections = [];
    const rawWalls = detectSpanningWalls(
      imageData, result.wallMaskFiltered || result.wallMask, result.buildingMask,
      imageData.width, imageData.height,
      { pixelsPerCm: effectivePpc, minThicknessCm: minCm, maxThicknessCm: maxCm, rejections: pass1Rejections }
    );
    if (pass1Rejections.length) {
      console.log(`[envelope] Pass 1 spanning wall rejections: ${pass1Rejections.length}`);
      for (const r of pass1Rejections) console.log(`  [spanning] ${r.orientation} band ${r.band.start}-${r.band.end}: ${r.reason}`, r.details || '');
    }
    pass1SpanningWalls = rawWalls.map(wall => ({
      orientation: wall.orientation,
      startCm: imagePxToCm(wall.startPx.x, wall.startPx.y, effectiveBg),
      endCm: imagePxToCm(wall.endPx.x, wall.endPx.y, effectiveBg),
      thicknessCm: Math.round(wall.thicknessPx / effectivePpc * 10) / 10,
    }));
    console.log("[envelope] Pass 1 spanning walls: %d", pass1SpanningWalls.length);
  }

  // Count pass-1 building area for comparison
  let pass1BuildingArea = 0;
  if (result.buildingMask) {
    for (let i = 0; i < result.buildingMask.length; i++) pass1BuildingArea += result.buildingMask[i];
  } else {
    console.warn("[envelope] Pass 1 buildingMask missing — area comparison will fall back to pass 1");
  }

  // ── Pass 2: preprocess raw image, then re-detect envelope ────────────────
  // Build pixel-space preprocessing args from pass-1 results.
  // Mirrors exactly what handleSvgClick does for room detection (lines 276-280).
  const pass1SpanningWallsPx = pass1SpanningWalls.map(w => ({
    startPx: cmToImagePx(w.startCm.x, w.startCm.y, effectiveBg),
    endPx: cmToImagePx(w.endCm.x, w.endCm.y, effectiveBg),
    thicknessPx: Math.round(w.thicknessCm * effectivePpc),
  }));

  // Load a fresh copy — preprocessForRoomDetection mutates imageData in-place.
  const { imageData: imageData2 } = await loadImageData(bg.dataUrl, bg.nativeWidth, bg.nativeHeight);
  console.log("[envelope] Pass 2: fresh image %dx%d", imageData2.width, imageData2.height);

  preprocessForRoomDetection(imageData2, {
    pixelsPerCm: effectivePpc,
    envelopePolygonPx: result.polygonPixels,
    envelopeWallThicknesses: result.wallThicknesses,
    spanningWallsPx: pass1SpanningWallsPx,
  });
  console.log("[envelope] Preprocessing complete");

  // envelopeBboxPx activates the stricter morphological open in detectEnvelope.
  // Only truthiness is checked — the actual bbox values are not read.
  const pass1BboxPx = {
    minX: Math.min(...result.polygonPixels.map(p => p.x)),
    minY: Math.min(...result.polygonPixels.map(p => p.y)),
    maxX: Math.max(...result.polygonPixels.map(p => p.x)),
    maxY: Math.max(...result.polygonPixels.map(p => p.y)),
  };

  const result2 = detectEnvelope(imageData2, {
    pixelsPerCm: effectivePpc,
    envelopeBboxPx: pass1BboxPx,
  });

  // ── Dynamic fallback: compare building areas ─────────────────────────────
  // Pass 2 on a preprocessed image typically produces a *smaller* building
  // area than pass 1 because preprocessing removes noise that inflated the
  // raw envelope. A pass-2 area of 50-90% of pass-1 is normal and indicates
  // a more accurate envelope. True collapse (e.g. flood fill leaked through
  // broken walls) shows as <30% of pass-1 area.
  let usePass2 = false;
  if (result2 && result2.polygonPixels.length >= 3 && result2.buildingMask) {
    let pass2BuildingArea = 0;
    for (let i = 0; i < result2.buildingMask.length; i++) pass2BuildingArea += result2.buildingMask[i];
    const areaRatio = pass1BuildingArea > 0 ? pass2BuildingArea / pass1BuildingArea : 0;
    console.log(`[envelope] Building area: pass1=${pass1BuildingArea} pass2=${pass2BuildingArea} ratio=${areaRatio.toFixed(2)}`);
    if (areaRatio >= 0.3) {
      usePass2 = true;
    } else {
      console.log(`[envelope] Pass 2 building area too small (${(areaRatio * 100).toFixed(0)}% of pass 1) — falling back to pass 1`);
    }
  } else {
    console.log("[envelope] Pass 2 failed (null or <3 vertices) — falling back to pass 1");
  }

  const finalResult = usePass2 ? result2 : result;
  const finalImageData = usePass2 ? imageData2 : imageData;
  console.log("[envelope] Using %s result: %d vertices", usePass2 ? "pass-2" : "pass-1", finalResult.polygonPixels.length);

  // ── Downstream pipeline: runs on final result ────────────────────────────
  // Convert final pixel polygon to floor-global cm coordinates
  const finalPolygonCm = finalResult.polygonPixels.map(p => imagePxToCm(p.x, p.y, effectiveBg));

  // Re-detect spanning walls on the final result
  let finalSpanningWalls = [];
  if (finalResult.wallMask && finalResult.buildingMask) {
    const { minCm, maxCm } = FLOOR_PLAN_RULES.wallThickness;
    const finalRejections = [];
    const rawWalls = detectSpanningWalls(
      finalImageData, finalResult.wallMaskFiltered || finalResult.wallMask, finalResult.buildingMask,
      finalImageData.width, finalImageData.height,
      { pixelsPerCm: effectivePpc, minThicknessCm: minCm, maxThicknessCm: maxCm, rejections: finalRejections }
    );
    if (finalRejections.length) {
      console.log(`[envelope] Final spanning wall rejections: ${finalRejections.length}`);
      for (const r of finalRejections) console.log(`  [spanning] ${r.orientation} band ${r.band.start}-${r.band.end}: ${r.reason}`, r.details || '');
    }
    finalSpanningWalls = rawWalls.map(wall => ({
      orientation: wall.orientation,
      startCm: imagePxToCm(wall.startPx.x, wall.startPx.y, effectiveBg),
      endCm: imagePxToCm(wall.endPx.x, wall.endPx.y, effectiveBg),
      thicknessCm: Math.round(wall.thicknessPx / effectivePpc * 10) / 10,
    }));
    console.log("[envelope] Final spanning walls: %d", finalSpanningWalls.length);
  }

  // Discover valid angles from the pre-rectification polygon and spanning walls.
  // Use a higher minEdgeLengthCm than the default (5cm) because raw detection
  // polygons have noise diagonals that can accumulate >5cm total. A real building
  // direction needs at least 50cm of total edge length (≈ max wall thickness).
  const validAngles = extractValidAngles(finalPolygonCm, finalSpanningWalls, {
    minEdgeLengthCm: FLOOR_PLAN_RULES.wallThickness.maxCm,
  });

  // Enforce all polygon rules: rectify, remove bumps, remove stacked walls.
  // Runs in a fixpoint loop to guarantee axis-alignment after all steps.
  const rectifyRules = { ...FLOOR_PLAN_RULES, standardAngles: validAngles };
  const bumpThreshold = (finalResult.wallThicknesses?.medianCm ?? 25) * 0.8;
  const stackedGap = (finalResult.wallThicknesses?.medianCm ?? 30) * 1.5;
  const cleaned = enforcePolygonRules(finalPolygonCm, {
    rules: rectifyRules,
    bumpThresholdCm: bumpThreshold,
    stackedWallGapCm: stackedGap,
  });

  // Re-measure wall thickness on the cleaned polygon so edge indices match
  const cleanedPx = cleaned.map(p => cmToImagePx(p.x, p.y, effectiveBg));
  const wallThicknesses = detectWallThickness(
    finalImageData, cleanedPx, finalImageData.width, finalImageData.height,
    effectivePpc, { probeFromInnerFace: true }
  );

  // Classify wall types from all measured thicknesses
  const allThicknesses = [
    ...wallThicknesses.edges.map(e => e.thicknessCm),
    ...finalSpanningWalls.map(w => w.thicknessCm),
  ];
  const wallTypes = classifyWallTypes(allThicknesses);

  // Store in state
  const next = deepClone(getState());
  const nextFloor = getFloor(next);
  if (!nextFloor?.layout) return false;

  nextFloor.layout.envelope = {
    polygonCm: cleaned,
    wallThicknesses,
    spanningWalls: finalSpanningWalls,
    validAngles,
    wallTypes,
  };

  // Auto-enable assisted tracing when envelope is detected
  nextFloor.layout.assistedTracing = true;

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
