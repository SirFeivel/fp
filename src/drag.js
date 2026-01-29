// src/drag.js
import { deepClone, getCurrentRoom } from "./core.js";

function pointerToSvgXY(svg, clientX, clientY) {
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const inv = ctm.inverse();
  const p = pt.matrixTransform(inv);
  return { x: p.x, y: p.y };
}

/**
 * Find all SVG elements for a given exclusion ID across all SVG containers
 */
function findExclElements(id) {
  return document.querySelectorAll(`[data-exid="${id}"]`);
}

/**
 * Find all resize handle elements for a given exclusion ID
 */
function findResizeHandles(id) {
  return document.querySelectorAll(`[data-exid="${id}"][data-resize-handle]`);
}

/**
 * Wire drag handlers for exclusions inside the planSvg.
 *
 * Uses CSS transforms during drag for optimal performance - no DOM rebuilding.
 * Full render only happens on drag end.
 *
 * Required callbacks are passed in so drag.js stays framework-free.
 */
export function createExclusionDragController({
  getSvg, // () => SVGElement
  getState, // () => state
  setStateDirect, // (nextState) => void
  commit, // (label, nextState) => void
  render, // (label?) => void
  getSelectedExcl, // () => excl or null
  setSelectedExcl, // (id|null) => void
  setSelectedIdOnly, // (id|null) => void - sets ID without triggering render
  getSelectedId, // () => id|null
  getMoveLabel, // () => translated label for "moved" action
  getResizeLabel // () => translated label for "resized" action
}) {
  let drag = null;
  let resize = null; // For resize operations
  let dragStartState = null;
  let pendingFrame = false;
  let lastMoveEvent = null;

  function applyDragMove(e) {
    if (!drag) return;

    const svg = getSvg();
    const curMouse = pointerToSvgXY(svg, e.clientX, e.clientY);
    const dx = curMouse.x - drag.startMouse.x;
    const dy = curMouse.y - drag.startMouse.y;

    // Store current delta for final state computation
    drag.currentDx = dx;
    drag.currentDy = dy;

    // Apply CSS transform to all matching elements (main SVG + fullscreen SVG)
    const elements = findExclElements(drag.id);
    elements.forEach(el => {
      el.setAttribute("transform", `translate(${dx}, ${dy})`);
    });
  }

  function scheduleDragMove(e) {
    lastMoveEvent = e;
    if (pendingFrame) return;
    pendingFrame = true;
    requestAnimationFrame(() => {
      pendingFrame = false;
      const evt = lastMoveEvent;
      lastMoveEvent = null;
      if (evt) applyDragMove(evt);
    });
  }

  function onSvgPointerMove(e) {
    if (!drag) return;
    scheduleDragMove(e);
  }

  function onSvgPointerUp(e) {
    const svg = getSvg();
    svg.removeEventListener("pointermove", onSvgPointerMove);

    if (!drag || !dragStartState) return;

    const dx = drag.currentDx || 0;
    const dy = drag.currentDy || 0;
    const hasMoved = Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01;

    if (hasMoved) {
      // Build final state with updated exclusion position
      const finalState = deepClone(dragStartState);
      const finalRoom = getCurrentRoom(finalState);
      const excl = finalRoom?.exclusions?.find(x => x.id === drag.id);

      if (excl) {
        if (excl.type === "rect") {
          excl.x += dx;
          excl.y += dy;
        } else if (excl.type === "circle") {
          excl.cx += dx;
          excl.cy += dy;
        } else if (excl.type === "tri") {
          excl.p1.x += dx;
          excl.p1.y += dy;
          excl.p2.x += dx;
          excl.p2.y += dy;
          excl.p3.x += dx;
          excl.p3.y += dy;
        }
      }

      // Commit triggers full render with correct tile calculations
      commit(getMoveLabel(), finalState);
    } else {
      // No movement - clear transforms and trigger render to show selection properly
      const elements = findExclElements(drag.id);
      elements.forEach(el => el.removeAttribute("transform"));
      // Use setSelectedExcl to trigger proper render with selection styling
      setSelectedExcl(drag.id);
    }

    drag = null;
    dragStartState = null;
  }

  function onExclPointerDown(e) {
    e.preventDefault();
    e.stopPropagation();

    const id = e.currentTarget.getAttribute("data-exid");
    if (!id) return;

    // Set selection ID without triggering full render
    if (setSelectedIdOnly) {
      setSelectedIdOnly(id);
    }

    // Apply visual selection styling directly to avoid re-render
    const elements = findExclElements(id);
    elements.forEach(el => {
      el.setAttribute("stroke", "rgba(239,68,68,0.95)");
      el.setAttribute("stroke-width", "2");
      el.setAttribute("fill", "rgba(239,68,68,0.25)");
    });

    // Enter drag mode - skip tile rendering
    if (render) {
      render({ mode: "drag" });
    }

    // Find exclusion from state directly
    const state = getState();
    const room = getCurrentRoom(state);
    const ex = room?.exclusions?.find(x => x.id === id);
    if (!ex) return;

    const svg = getSvg();
    svg.setPointerCapture(e.pointerId);

    const startMouse = pointerToSvgXY(svg, e.clientX, e.clientY);
    dragStartState = deepClone(state);

    drag = {
      id,
      startMouse,
      startShape: deepClone(ex),
      currentDx: 0,
      currentDy: 0
    };

    svg.addEventListener("pointermove", onSvgPointerMove);
    svg.addEventListener("pointerup", onSvgPointerUp, { once: true });
    svg.addEventListener("pointercancel", onSvgPointerUp, { once: true });
  }

  // --- Resize handling ---

  function applyResize(e) {
    if (!resize) return;

    const svg = getSvg();
    const curMouse = pointerToSvgXY(svg, e.clientX, e.clientY);
    const dx = curMouse.x - resize.startMouse.x;
    const dy = curMouse.y - resize.startMouse.y;

    resize.currentDx = dx;
    resize.currentDy = dy;

    // Calculate new dimensions based on handle type and shape
    const { startShape, handleType } = resize;
    const elements = findExclElements(resize.id);

    elements.forEach(el => {
      if (startShape.type === "rect") {
        let newX = startShape.x;
        let newY = startShape.y;
        let newW = startShape.w;
        let newH = startShape.h;

        // Adjust based on which handle is being dragged
        if (handleType.includes("w")) {
          newX = startShape.x + dx;
          newW = Math.max(1, startShape.w - dx);
        }
        if (handleType.includes("e")) {
          newW = Math.max(1, startShape.w + dx);
        }
        if (handleType.includes("n")) {
          newY = startShape.y + dy;
          newH = Math.max(1, startShape.h - dy);
        }
        if (handleType.includes("s")) {
          newH = Math.max(1, startShape.h + dy);
        }

        if (!el.hasAttribute("data-resize-handle")) {
          el.setAttribute("x", newX);
          el.setAttribute("y", newY);
          el.setAttribute("width", newW);
          el.setAttribute("height", newH);
        }
      } else if (startShape.type === "circle") {
        // For circle, resize handle changes radius
        const centerX = startShape.cx;
        const centerY = startShape.cy;
        const distToMouse = Math.sqrt(
          Math.pow(curMouse.x - centerX, 2) + Math.pow(curMouse.y - centerY, 2)
        );
        const newR = Math.max(1, distToMouse);

        if (!el.hasAttribute("data-resize-handle")) {
          el.setAttribute("r", newR);
        }
      } else if (startShape.type === "tri") {
        // For triangle, move the specific point
        const pointNum = handleType.replace("p", "");
        if (!el.hasAttribute("data-resize-handle")) {
          const p1 = pointNum === "1" ? { x: startShape.p1.x + dx, y: startShape.p1.y + dy } : startShape.p1;
          const p2 = pointNum === "2" ? { x: startShape.p2.x + dx, y: startShape.p2.y + dy } : startShape.p2;
          const p3 = pointNum === "3" ? { x: startShape.p3.x + dx, y: startShape.p3.y + dy } : startShape.p3;
          el.setAttribute("points", `${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y}`);
        }
      }
    });

    // Update handle positions
    updateResizeHandlePositions(resize.id, startShape, dx, dy, handleType, curMouse);
  }

  function updateResizeHandlePositions(id, startShape, dx, dy, activeHandle, curMouse) {
    const handles = findResizeHandles(id);
    handles.forEach(handle => {
      const ht = handle.getAttribute("data-resize-handle");

      if (startShape.type === "rect") {
        let newX = startShape.x;
        let newY = startShape.y;
        let newW = startShape.w;
        let newH = startShape.h;

        if (activeHandle.includes("w")) {
          newX = startShape.x + dx;
          newW = Math.max(1, startShape.w - dx);
        }
        if (activeHandle.includes("e")) {
          newW = Math.max(1, startShape.w + dx);
        }
        if (activeHandle.includes("n")) {
          newY = startShape.y + dy;
          newH = Math.max(1, startShape.h - dy);
        }
        if (activeHandle.includes("s")) {
          newH = Math.max(1, startShape.h + dy);
        }

        // Position handles at corners/edges
        const positions = {
          nw: { cx: newX, cy: newY },
          ne: { cx: newX + newW, cy: newY },
          sw: { cx: newX, cy: newY + newH },
          se: { cx: newX + newW, cy: newY + newH },
          n: { cx: newX + newW / 2, cy: newY },
          s: { cx: newX + newW / 2, cy: newY + newH },
          w: { cx: newX, cy: newY + newH / 2 },
          e: { cx: newX + newW, cy: newY + newH / 2 }
        };

        if (positions[ht]) {
          handle.setAttribute("cx", positions[ht].cx);
          handle.setAttribute("cy", positions[ht].cy);
        }
      } else if (startShape.type === "circle") {
        const newR = Math.max(1, Math.sqrt(
          Math.pow(curMouse.x - startShape.cx, 2) + Math.pow(curMouse.y - startShape.cy, 2)
        ));
        // Position handle at edge of circle
        handle.setAttribute("cx", startShape.cx + newR);
        handle.setAttribute("cy", startShape.cy);
      } else if (startShape.type === "tri") {
        const pointNum = ht.replace("p", "");
        if (pointNum === activeHandle.replace("p", "")) {
          handle.setAttribute("cx", startShape[`p${pointNum}`].x + dx);
          handle.setAttribute("cy", startShape[`p${pointNum}`].y + dy);
        }
      }
    });
  }

  function scheduleResize(e) {
    lastMoveEvent = e;
    if (pendingFrame) return;
    pendingFrame = true;
    requestAnimationFrame(() => {
      pendingFrame = false;
      const evt = lastMoveEvent;
      lastMoveEvent = null;
      if (evt) applyResize(evt);
    });
  }

  function onResizePointerMove(e) {
    if (!resize) return;
    scheduleResize(e);
  }

  function onResizePointerUp(e) {
    const svg = getSvg();
    svg.removeEventListener("pointermove", onResizePointerMove);

    if (!resize || !dragStartState) return;

    const dx = resize.currentDx || 0;
    const dy = resize.currentDy || 0;
    const hasResized = Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01;

    if (hasResized) {
      const finalState = deepClone(dragStartState);
      const finalRoom = getCurrentRoom(finalState);
      const excl = finalRoom?.exclusions?.find(x => x.id === resize.id);

      if (excl) {
        const { startShape, handleType } = resize;

        if (excl.type === "rect") {
          if (handleType.includes("w")) {
            excl.x = startShape.x + dx;
            excl.w = Math.max(1, startShape.w - dx);
          }
          if (handleType.includes("e")) {
            excl.w = Math.max(1, startShape.w + dx);
          }
          if (handleType.includes("n")) {
            excl.y = startShape.y + dy;
            excl.h = Math.max(1, startShape.h - dy);
          }
          if (handleType.includes("s")) {
            excl.h = Math.max(1, startShape.h + dy);
          }
        } else if (excl.type === "circle") {
          const svg = getSvg();
          const curMouse = pointerToSvgXY(svg, e.clientX, e.clientY);
          excl.r = Math.max(1, Math.sqrt(
            Math.pow(curMouse.x - startShape.cx, 2) + Math.pow(curMouse.y - startShape.cy, 2)
          ));
        } else if (excl.type === "tri") {
          const pointNum = handleType.replace("p", "");
          excl[`p${pointNum}`].x = startShape[`p${pointNum}`].x + dx;
          excl[`p${pointNum}`].y = startShape[`p${pointNum}`].y + dy;
        }
      }

      const label = getResizeLabel ? getResizeLabel() : "Resized exclusion";
      commit(label, finalState);
    } else {
      // No resize - trigger render to restore
      render();
    }

    resize = null;
    dragStartState = null;
  }

  function onResizeHandlePointerDown(e) {
    e.preventDefault();
    e.stopPropagation();

    const id = e.currentTarget.getAttribute("data-exid");
    const handleType = e.currentTarget.getAttribute("data-resize-handle");
    if (!id || !handleType) return;

    const state = getState();
    const room = getCurrentRoom(state);
    const ex = room?.exclusions?.find(x => x.id === id);
    if (!ex) return;

    const svg = getSvg();
    svg.setPointerCapture(e.pointerId);

    const startMouse = pointerToSvgXY(svg, e.clientX, e.clientY);
    dragStartState = deepClone(state);

    resize = {
      id,
      handleType,
      startMouse,
      startShape: deepClone(ex),
      currentDx: 0,
      currentDy: 0
    };

    svg.addEventListener("pointermove", onResizePointerMove);
    svg.addEventListener("pointerup", onResizePointerUp, { once: true });
    svg.addEventListener("pointercancel", onResizePointerUp, { once: true });
  }

  return { onExclPointerDown, onResizeHandlePointerDown };
}
