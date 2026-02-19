// src/room-detection-controller.js
// Controller for semi-automatic room detection from calibrated background images.
// State machine: idle → waitingForClick → processing → preview → idle

import { t } from "./i18n.js";
import { svgEl } from "./geometry.js";
import { pointerToSvgXY } from "./svg-coords.js";
import { createSurface } from "./surface.js";
import { getCurrentFloor, deepClone, uuid } from "./core.js";
import { detectRoomAtPixel } from "./room-detection.js";
import { getWallForEdge, syncFloorWalls, addDoorwayToWall, mergeCollinearWalls } from "./walls.js";
import { showAlert } from "./dialog.js";
import { rectifyPolygon, alignToExistingRooms } from "./floor-plan-rules.js";

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

  function enterPreview(polygonCm, doorGapsCm) {
    _state = "preview";
    _detectedPolygonCm = polygonCm;
    _detectedDoorGapsCm = doorGapsCm;

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

    // Convert SVG click coordinates to image pixel coordinates
    const svgPt = pointerToSvgXY(svg, e.clientX, e.clientY);
    const imgPt = cmToImagePx(svgPt.x, svgPt.y, bg);
    const pixelsPerCm = bg.scale.pixelsPerCm;

    // Load the background image and run detection
    try {
      const imageData = await loadImageData(bg.dataUrl, bg.nativeWidth, bg.nativeHeight);
      const result = detectRoomAtPixel(imageData, imgPt.x, imgPt.y, {
        pixelsPerCm,
        maxAreaCm2: 500000
      });

      if (!result || result.polygonPixels.length < 3) {
        _state = "waitingForClick";
        svg.style.cursor = "crosshair";
        showError();
        return;
      }

      // Convert pixel polygon to floor-global cm coordinates
      const polygonCm = result.polygonPixels.map(p => imagePxToCm(p.x, p.y, bg));

      // Convert door gap midpoints to cm; estimate gap width from bounding box span
      const doorGapsCm = result.doorGapsPx.map(g => ({
        midpointCm: imagePxToCm(g.midpointPx.x, g.midpointPx.y, bg),
        gapWidthCm: Math.max(g.spanPx?.x ?? 0, g.spanPx?.y ?? 0) / pixelsPerCm
      }));

      enterPreview(polygonCm, doorGapsCm);
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

    // Rectify polygon: snap edges to standard angles, remove detection noise
    const rectifiedGlobal = rectifyPolygon(_detectedPolygonCm);

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

    // Align to existing rooms' edges (adjusts floorPosition only)
    const { floorPosition: alignedPos } = alignToExistingRooms(
      localVertices, floorPos, floor.rooms || []
    );

    const room = createSurface({
      name: t("room.newRoom") || "New Room",
      polygonVertices: localVertices,
      floorPosition: alignedPos
    });

    floor.rooms = floor.rooms || [];
    floor.rooms.push(room);
    next.selectedRoomId = room.id;

    // Sync walls and merge collinear segments from different rooms
    syncFloorWalls(floor);
    mergeCollinearWalls(floor);

    // Insert each detected door gap as a wall doorway
    const n = rectifiedGlobal.length;
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
function loadImageData(dataUrl, nativeWidth, nativeHeight) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w = nativeWidth || img.naturalWidth;
      const h = nativeHeight || img.naturalHeight;
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      // Fill white so transparent SVG areas don't render as black (which
      // the wall mask would misclassify as wall pixels).
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      resolve(ctx.getImageData(0, 0, w, h));
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}
