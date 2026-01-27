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
  getMoveLabel // () => translated label for "moved" action
}) {
  let drag = null;
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

  return { onExclPointerDown };
}
