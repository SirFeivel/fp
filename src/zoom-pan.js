// src/zoom-pan.js
// Event controller for zoom and pan interactions

import { getViewport, setViewport, resetViewport, MIN_ZOOM, MAX_ZOOM } from "./viewport.js";
import { isInlineEditing } from "./ui_state.js";
import { pointerToSvgXY } from "./svg-coords.js";

const ZOOM_STEP = 0.1;
const ZOOM_WHEEL_FACTOR = 0.001;
const PAN_KEY_STEP = 20;

export function createZoomPanController({
  getSvg,
  getCurrentRoomId,
  onViewportChange,
  getSelectedExclId
}) {
  let isPanning = false;
  let isSpaceDown = false;
  let panStart = { x: 0, y: 0 };
  let panStartViewport = { panX: 0, panY: 0 };

  function zoomIn() {
    const roomId = getCurrentRoomId();
    const vp = getViewport(roomId);
    setViewport(roomId, { zoom: vp.zoom * (1 + ZOOM_STEP) });
    onViewportChange();
  }

  function zoomOut() {
    const roomId = getCurrentRoomId();
    const vp = getViewport(roomId);
    setViewport(roomId, { zoom: vp.zoom * (1 - ZOOM_STEP) });
    onViewportChange();
  }

  function zoomTo(level) {
    const roomId = getCurrentRoomId();
    setViewport(roomId, { zoom: level });
    onViewportChange();
  }

  function reset() {
    const roomId = getCurrentRoomId();
    resetViewport(roomId);
    onViewportChange();
  }

  function panBy(dx, dy) {
    const roomId = getCurrentRoomId();
    const vp = getViewport(roomId);
    // Pan in SVG units (divide by zoom to keep consistent feel)
    setViewport(roomId, {
      panX: vp.panX + dx / vp.zoom,
      panY: vp.panY + dy / vp.zoom
    });
    onViewportChange();
  }

  // Mouse wheel zoom (cursor-centered)
  function handleWheel(e) {
    const svg = getSvg();
    if (!svg || !svg.contains(e.target)) return;

    // Check if we're interacting with an exclusion or resize handle
    const inInteractive = e.target.closest("[data-exid], [data-secid], [data-resize-handle], [data-inline-edit]");
    if (inInteractive) return;

    e.preventDefault();

    const roomId = getCurrentRoomId();
    const vp = getViewport(roomId);
    const base = vp.baseViewBox;
    if (!base) return;

    // Calculate zoom factor
    const delta = -e.deltaY * ZOOM_WHEEL_FACTOR;
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, vp.zoom * (1 + delta)));
    const zoomChange = newZoom / vp.zoom;

    // Get mouse position in SVG coordinates before zoom
    const svgPoint = pointerToSvgXY(svg, e.clientX, e.clientY);

    // Calculate pan adjustment to keep cursor position stable
    // The cursor should point to the same SVG coordinate after zooming
    const centerX = base.minX + base.width / 2;
    const centerY = base.minY + base.height / 2;

    // Current view center in SVG coordinates
    const currentCenterX = centerX + vp.panX;
    const currentCenterY = centerY + vp.panY;

    // Vector from current center to cursor
    const dx = svgPoint.x - currentCenterX;
    const dy = svgPoint.y - currentCenterY;

    // After zoom, the cursor should be at the same relative position
    // but with scaled view. Adjust pan to compensate.
    const newPanX = vp.panX + dx * (1 - 1 / zoomChange);
    const newPanY = vp.panY + dy * (1 - 1 / zoomChange);

    setViewport(roomId, { zoom: newZoom, panX: newPanX, panY: newPanY });
    onViewportChange();
  }

  // Middle mouse / Space+drag pan
  function handlePointerDown(e) {
    const svg = getSvg();
    if (!svg) return;

    // Middle mouse button or space+left click
    const isMiddle = e.button === 1;
    const isSpaceLeft = isSpaceDown && e.button === 0;

    if (!isMiddle && !isSpaceLeft) return;

    // Check if we're on an interactive element
    const inInteractive = e.target.closest("[data-exid], [data-secid], [data-resize-handle], [data-inline-edit]");
    if (inInteractive && !isMiddle) return;

    e.preventDefault();

    isPanning = true;
    panStart = { x: e.clientX, y: e.clientY };
    const vp = getViewport(getCurrentRoomId());
    panStartViewport = { panX: vp.panX, panY: vp.panY };

    svg.classList.add("panning");

    document.addEventListener("pointermove", handlePanMove);
    document.addEventListener("pointerup", handlePanEnd);
  }

  function handlePanMove(e) {
    if (!isPanning) return;

    const roomId = getCurrentRoomId();
    const vp = getViewport(roomId);
    const base = vp.baseViewBox;
    if (!base) return;

    const svg = getSvg();
    if (!svg) return;

    // Calculate pan delta in client pixels
    const dx = e.clientX - panStart.x;
    const dy = e.clientY - panStart.y;

    // Convert to SVG units based on current viewBox
    // Get SVG element dimensions
    const rect = svg.getBoundingClientRect();
    const scaleX = (base.width / vp.zoom) / rect.width;
    const scaleY = (base.height / vp.zoom) / rect.height;

    // Apply pan (negative because dragging right moves content left)
    setViewport(roomId, {
      panX: panStartViewport.panX - dx * scaleX,
      panY: panStartViewport.panY - dy * scaleY
    });
    onViewportChange();
  }

  function handlePanEnd() {
    isPanning = false;
    const svg = getSvg();
    if (svg) {
      svg.classList.remove("panning");
    }
    document.removeEventListener("pointermove", handlePanMove);
    document.removeEventListener("pointerup", handlePanEnd);
  }

  function handleKeyDown(e) {
    // Skip if typing in an input
    const target = e.target;
    if (target?.isContentEditable) return;
    const tag = target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (isInlineEditing()) return;

    // Track space key for space+drag
    if (e.key === " " || e.code === "Space") {
      if (!isSpaceDown) {
        isSpaceDown = true;
        const svg = getSvg();
        if (svg) {
          svg.classList.add("pan-ready");
        }
      }
      e.preventDefault();
      return;
    }

    // Zoom with + and - keys
    if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      zoomIn();
      return;
    }
    if (e.key === "-" || e.key === "_") {
      e.preventDefault();
      zoomOut();
      return;
    }

    // Reset with 0 or Home
    if (e.key === "0" || e.key === "Home") {
      e.preventDefault();
      reset();
      return;
    }

    // Arrow keys for panning (only when no exclusion is selected)
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
      // If an exclusion is selected, let main.js handle nudging
      const selectedExclId = getSelectedExclId?.();
      if (selectedExclId) return;

      e.preventDefault();
      const step = e.shiftKey ? PAN_KEY_STEP * 3 : PAN_KEY_STEP;
      let dx = 0, dy = 0;
      if (e.key === "ArrowLeft") dx = step;
      if (e.key === "ArrowRight") dx = -step;
      if (e.key === "ArrowUp") dy = step;
      if (e.key === "ArrowDown") dy = -step;
      panBy(dx, dy);
    }
  }

  function handleKeyUp(e) {
    if (e.key === " " || e.code === "Space") {
      isSpaceDown = false;
      const svg = getSvg();
      if (svg) {
        svg.classList.remove("pan-ready");
      }
    }
  }

  // Prevent context menu on middle click
  function handleContextMenu(e) {
    if (e.button === 1) {
      e.preventDefault();
    }
  }

  function attach() {
    document.addEventListener("wheel", handleWheel, { passive: false });
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("keyup", handleKeyUp);
    document.addEventListener("auxclick", handleContextMenu);
  }

  function detach() {
    document.removeEventListener("wheel", handleWheel);
    document.removeEventListener("pointerdown", handlePointerDown);
    document.removeEventListener("keydown", handleKeyDown);
    document.removeEventListener("keyup", handleKeyUp);
    document.removeEventListener("auxclick", handleContextMenu);
  }

  return {
    attach,
    detach,
    zoomIn,
    zoomOut,
    zoomTo,
    reset,
    panBy
  };
}
