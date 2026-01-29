// src/drag.js
import { deepClone, getCurrentRoom } from "./core.js";
import { getRoomBounds } from "./geometry.js";
import { getRoomSections } from "./composite.js";

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

function snapToMm(value) {
  return Math.round(value * 10) / 10;
}

function formatCm(value) {
  const rounded = Math.round(value * 10) / 10;
  if (!Number.isFinite(rounded)) return "0";
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function getResizeOverlay() {
  return document.getElementById("resizeMetrics");
}

function showResizeOverlay(text, clientX, clientY, options = {}) {
  const el = getResizeOverlay();
  if (!el) return;
  const { mode = "cursor" } = options;
  el.textContent = text;
  el.style.left = `${clientX}px`;
  el.style.top = `${clientY}px`;
  el.style.transform = mode === "center" ? "translate(-50%, -50%)" : "translate(-50%, -120%)";
  el.classList.remove("hidden");
}

function hideResizeOverlay() {
  const el = getResizeOverlay();
  if (!el) return;
  el.classList.add("hidden");
}

function svgPointToClient(svg, x, y) {
  const pt = svg.createSVGPoint();
  pt.x = x;
  pt.y = y;
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const p = pt.matrixTransform(ctm);
  return { x: p.x, y: p.y };
}

function showDragOverlay(text, svg, cursorClient, fallbackSvgPoint) {
  const el = getResizeOverlay();
  if (!el) return;
  showResizeOverlay(text, cursorClient.x, cursorClient.y);
  const rect = el.getBoundingClientRect();
  const margin = 8;
  const overflow =
    rect.left < margin ||
    rect.right > window.innerWidth - margin ||
    rect.top < margin ||
    rect.bottom > window.innerHeight - margin;

  if (overflow && fallbackSvgPoint) {
    const pos = svgPointToClient(svg, fallbackSvgPoint.x, fallbackSvgPoint.y);
    showResizeOverlay(text, pos.x, pos.y, { mode: "center" });
  }
}

function getRectResizeDims(startShape, handleType, dx, dy) {
  let newX = startShape.x;
  let newY = startShape.y;
  let newW = startShape.w;
  let newH = startShape.h;

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

  return { newX, newY, newW, newH };
}

function getTriResizePoints(startShape, handleType, dx, dy) {
  const pointNum = handleType.replace("p", "");
  return {
    p1: pointNum === "1" ? { x: startShape.p1.x + dx, y: startShape.p1.y + dy } : startShape.p1,
    p2: pointNum === "2" ? { x: startShape.p2.x + dx, y: startShape.p2.y + dy } : startShape.p2,
    p3: pointNum === "3" ? { x: startShape.p3.x + dx, y: startShape.p3.y + dy } : startShape.p3
  };
}

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function getExclusionBounds(startShape, dx, dy) {
  if (startShape.type === "rect") {
    return {
      minX: startShape.x + dx,
      minY: startShape.y + dy,
      maxX: startShape.x + dx + startShape.w,
      maxY: startShape.y + dy + startShape.h
    };
  }
  if (startShape.type === "circle") {
    return {
      minX: startShape.cx + dx - startShape.r,
      minY: startShape.cy + dy - startShape.r,
      maxX: startShape.cx + dx + startShape.r,
      maxY: startShape.cy + dy + startShape.r
    };
  }
  const points = [
    { x: startShape.p1.x + dx, y: startShape.p1.y + dy },
    { x: startShape.p2.x + dx, y: startShape.p2.y + dy },
    { x: startShape.p3.x + dx, y: startShape.p3.y + dy }
  ];
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys)
  };
}

function getDragOverlayText(bounds, box) {
  const left = box.minX - bounds.minX;
  const top = box.minY - bounds.minY;
  return `x ${formatCm(left)} cm · y ${formatCm(top)} cm`;
}

function getSvgRoots() {
  const svgs = [];
  const main = document.getElementById("planSvg");
  const full = document.getElementById("planSvgFullscreen");
  if (main) svgs.push(main);
  if (full) svgs.push(full);
  return svgs;
}

function ensureTriLabelGroup(svg, id) {
  let group = svg.querySelector(`g[data-tri-labels="${id}"]`);
  if (!group) {
    group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.setAttribute("data-tri-labels", id);
    svg.appendChild(group);
  }
  return group;
}

function updateTriSideLabel(textEl, label, p1, p2) {
  const midX = (p1.x + p2.x) / 2;
  const midY = (p1.y + p2.y) / 2;
  const vx = p2.x - p1.x;
  const vy = p2.y - p1.y;
  const len = Math.sqrt(vx * vx + vy * vy) || 1;
  const nx = -vy / len;
  const ny = vx / len;
  const offset = 6;
  const x = midX + nx * offset;
  const y = midY + ny * offset;

  textEl.setAttribute("x", x);
  textEl.setAttribute("y", y);
  textEl.textContent = label;
}

function updateTriangleLabels(id, points) {
  const svgs = getSvgRoots();
  svgs.forEach(svg => {
    const group = ensureTriLabelGroup(svg, id);
    const labels = {
      a: group.querySelector('[data-side="a"]'),
      b: group.querySelector('[data-side="b"]'),
      c: group.querySelector('[data-side="c"]')
    };

    ["a", "b", "c"].forEach(key => {
      if (!labels[key]) {
        const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
        t.setAttribute("data-side", key);
        t.setAttribute("fill", "rgba(231,238,252,0.9)");
        t.setAttribute("font-size", "11");
        t.setAttribute("font-family", "system-ui, -apple-system, Segoe UI, Roboto, Arial");
        t.setAttribute("text-anchor", "middle");
        t.setAttribute("dominant-baseline", "middle");
        group.appendChild(t);
        labels[key] = t;
      }
    });

    updateTriSideLabel(labels.a, "a", points.p1, points.p2);
    updateTriSideLabel(labels.b, "b", points.p2, points.p3);
    updateTriSideLabel(labels.c, "c", points.p3, points.p1);
  });
}

function removeTriangleLabels(id) {
  const svgs = getSvgRoots();
  svgs.forEach(svg => {
    const group = svg.querySelector(`g[data-tri-labels="${id}"]`);
    if (group) group.remove();
  });
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
    const dx = snapToMm(curMouse.x - drag.startMouse.x);
    const dy = snapToMm(curMouse.y - drag.startMouse.y);

    // Store current delta for final state computation
    drag.currentDx = dx;
    drag.currentDy = dy;

    // Apply CSS transform to all matching elements (main SVG + fullscreen SVG)
    const elements = findExclElements(drag.id);
    elements.forEach(el => {
      el.setAttribute("transform", `translate(${dx}, ${dy})`);
    });

    if (drag.bounds && drag.startShape) {
      const box = getExclusionBounds(drag.startShape, dx, dy);
      const text = getDragOverlayText(drag.bounds, box);
      const center = {
        x: (box.minX + box.maxX) / 2,
        y: (box.minY + box.maxY) / 2
      };
      showDragOverlay(text, svg, { x: e.clientX, y: e.clientY }, center);
    }
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
    hideResizeOverlay();

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

    const bounds = getRoomBounds(room);

    drag = {
      id,
      startMouse,
      startShape: deepClone(ex),
      currentDx: 0,
      currentDy: 0,
      bounds
    };

    const box = getExclusionBounds(ex, 0, 0);
    const text = getDragOverlayText(bounds, box);
    const center = {
      x: (box.minX + box.maxX) / 2,
      y: (box.minY + box.maxY) / 2
    };
    showDragOverlay(text, svg, { x: e.clientX, y: e.clientY }, center);

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
    let overlayText = "";
    let rectDims = null;
    let triPoints = null;
    let circleR = null;

    if (startShape.type === "rect") {
      rectDims = getRectResizeDims(startShape, handleType, dx, dy);
      overlayText = `${formatCm(rectDims.newW)} x ${formatCm(rectDims.newH)} cm`;
    } else if (startShape.type === "circle") {
      const centerX = startShape.cx;
      const centerY = startShape.cy;
      const distToMouse = Math.sqrt(
        Math.pow(curMouse.x - centerX, 2) + Math.pow(curMouse.y - centerY, 2)
      );
      circleR = Math.max(1, distToMouse);
      overlayText = `Ø ${formatCm(circleR * 2)} cm`;
    } else if (startShape.type === "tri") {
      triPoints = getTriResizePoints(startShape, handleType, dx, dy);
      const a = dist(triPoints.p1, triPoints.p2);
      const b = dist(triPoints.p2, triPoints.p3);
      const c = dist(triPoints.p3, triPoints.p1);
      overlayText = `a ${formatCm(a)} · b ${formatCm(b)} · c ${formatCm(c)} cm`;
      updateTriangleLabels(resize.id, triPoints);
    }

    elements.forEach(el => {
      if (startShape.type === "rect") {
        const { newX, newY, newW, newH } = rectDims;

        if (!el.hasAttribute("data-resize-handle")) {
          el.setAttribute("x", newX);
          el.setAttribute("y", newY);
          el.setAttribute("width", newW);
          el.setAttribute("height", newH);
        }
      } else if (startShape.type === "circle") {
        // For circle, resize handle changes radius
        if (!el.hasAttribute("data-resize-handle")) {
          el.setAttribute("r", circleR);
        }
      } else if (startShape.type === "tri") {
        // For triangle, move the specific point
        const pointNum = handleType.replace("p", "");
        if (!el.hasAttribute("data-resize-handle")) {
          const { p1, p2, p3 } = triPoints;
          el.setAttribute("points", `${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y}`);
        }
      }
    });

    if (overlayText) {
      showResizeOverlay(overlayText, e.clientX, e.clientY);
    }

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
    hideResizeOverlay();
    if (resize?.startShape?.type === "tri") {
      removeTriangleLabels(resize.id);
    }

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

    if (ex.type === "rect") {
      showResizeOverlay(`${formatCm(ex.w)} x ${formatCm(ex.h)} cm`, e.clientX, e.clientY);
    } else if (ex.type === "circle") {
      showResizeOverlay(`Ø ${formatCm(ex.r * 2)} cm`, e.clientX, e.clientY);
    } else if (ex.type === "tri") {
      const a = dist(ex.p1, ex.p2);
      const b = dist(ex.p2, ex.p3);
      const c = dist(ex.p3, ex.p1);
      showResizeOverlay(`a ${formatCm(a)} · b ${formatCm(b)} · c ${formatCm(c)} cm`, e.clientX, e.clientY);
      updateTriangleLabels(id, ex);
    }

    svg.addEventListener("pointermove", onResizePointerMove);
    svg.addEventListener("pointerup", onResizePointerUp, { once: true });
    svg.addEventListener("pointercancel", onResizePointerUp, { once: true });
  }

  return { onExclPointerDown, onResizeHandlePointerDown };
}

/**
 * Check if two rectangles share an edge (not just touch at a point)
 */
function rectsShareEdge(a, b) {
  const aLeft = a.x;
  const aRight = a.x + a.widthCm;
  const aTop = a.y;
  const aBottom = a.y + a.heightCm;

  const bLeft = b.x;
  const bRight = b.x + b.widthCm;
  const bTop = b.y;
  const bBottom = b.y + b.heightCm;

  const eps = 0.01;

  // Check vertical edge sharing (left-right)
  const verticalOverlap = Math.max(0, Math.min(aBottom, bBottom) - Math.max(aTop, bTop));
  if (verticalOverlap > eps) {
    // A's right edge touches B's left edge
    if (Math.abs(aRight - bLeft) < eps) return true;
    // A's left edge touches B's right edge
    if (Math.abs(aLeft - bRight) < eps) return true;
  }

  // Check horizontal edge sharing (top-bottom)
  const horizontalOverlap = Math.max(0, Math.min(aRight, bRight) - Math.max(aLeft, bLeft));
  if (horizontalOverlap > eps) {
    // A's bottom edge touches B's top edge
    if (Math.abs(aBottom - bTop) < eps) return true;
    // A's top edge touches B's bottom edge
    if (Math.abs(aTop - bBottom) < eps) return true;
  }

  return false;
}

/**
 * Check if a section is connected to at least one other section
 */
function isSectionConnected(section, otherSections) {
  if (otherSections.length === 0) return true; // Single section is always valid
  return otherSections.some(other => rectsShareEdge(section, other));
}

/**
 * Find snap positions where the section would connect to other sections
 */
function findSnapPositions(section, otherSections, dx, dy) {
  const snapPositions = [];

  for (const other of otherSections) {
    // Snap to right edge of other
    snapPositions.push({
      x: other.x + other.widthCm,
      y: other.y, // Align tops
      desc: "right-top"
    });
    snapPositions.push({
      x: other.x + other.widthCm,
      y: other.y + other.heightCm - section.heightCm, // Align bottoms
      desc: "right-bottom"
    });

    // Snap to left edge of other
    snapPositions.push({
      x: other.x - section.widthCm,
      y: other.y,
      desc: "left-top"
    });
    snapPositions.push({
      x: other.x - section.widthCm,
      y: other.y + other.heightCm - section.heightCm,
      desc: "left-bottom"
    });

    // Snap to bottom edge of other
    snapPositions.push({
      x: other.x,
      y: other.y + other.heightCm,
      desc: "bottom-left"
    });
    snapPositions.push({
      x: other.x + other.widthCm - section.widthCm,
      y: other.y + other.heightCm,
      desc: "bottom-right"
    });

    // Snap to top edge of other
    snapPositions.push({
      x: other.x,
      y: other.y - section.heightCm,
      desc: "top-left"
    });
    snapPositions.push({
      x: other.x + other.widthCm - section.widthCm,
      y: other.y - section.heightCm,
      desc: "top-right"
    });
  }

  return snapPositions;
}

/**
 * Find the nearest valid snap position for a section
 */
function findNearestValidPosition(section, otherSections, desiredX, desiredY) {
  const testSection = { ...section, x: desiredX, y: desiredY };

  // Check if desired position is already valid
  if (isSectionConnected(testSection, otherSections)) {
    return { x: desiredX, y: desiredY };
  }

  // Find snap positions
  const snapPositions = findSnapPositions(section, otherSections, 0, 0);

  let bestPos = null;
  let bestDist = Infinity;

  for (const pos of snapPositions) {
    const testPos = { ...section, x: pos.x, y: pos.y };
    if (isSectionConnected(testPos, otherSections)) {
      const dist = Math.sqrt(Math.pow(pos.x - desiredX, 2) + Math.pow(pos.y - desiredY, 2));
      if (dist < bestDist) {
        bestDist = dist;
        bestPos = pos;
      }
    }
  }

  return bestPos || { x: section.x, y: section.y }; // Fall back to original position
}

function findSectionElements(id) {
  return document.querySelectorAll(`[data-secid="${id}"]`);
}

function findSectionResizeHandles(id) {
  return document.querySelectorAll(`[data-secid="${id}"][data-resize-handle]`);
}

/**
 * Wire drag handlers for sections inside the planSvg.
 * Sections must maintain connectivity with other sections.
 */
export function createSectionDragController({
  getSvg,
  getState,
  commit,
  render,
  getSelectedSection,
  setSelectedSection,
  setSelectedIdOnly,
  getSelectedId,
  getMoveLabel,
  getResizeLabel
}) {
  let drag = null;
  let resize = null;
  let dragStartState = null;
  let pendingFrame = false;
  let lastMoveEvent = null;

  function applyDragMove(e) {
    if (!drag) return;

    const svg = getSvg();
    const curMouse = pointerToSvgXY(svg, e.clientX, e.clientY);
    const rawDx = curMouse.x - drag.startMouse.x;
    const rawDy = curMouse.y - drag.startMouse.y;

    const desiredX = drag.startShape.x + rawDx;
    const desiredY = drag.startShape.y + rawDy;

    // Find nearest valid position that maintains connectivity
    const validPos = findNearestValidPosition(
      drag.startShape,
      drag.otherSections,
      desiredX,
      desiredY
    );

    const dx = snapToMm(validPos.x - drag.startShape.x);
    const dy = snapToMm(validPos.y - drag.startShape.y);

    drag.currentDx = dx;
    drag.currentDy = dy;

    // Apply CSS transform
    const elements = findSectionElements(drag.id);
    elements.forEach(el => {
      if (!el.hasAttribute("data-resize-handle")) {
        el.setAttribute("transform", `translate(${dx}, ${dy})`);
      }
    });

    // Update overlay
    const text = `x ${formatCm(validPos.x)} cm · y ${formatCm(validPos.y)} cm`;
    const center = {
      x: validPos.x + drag.startShape.widthCm / 2,
      y: validPos.y + drag.startShape.heightCm / 2
    };
    showDragOverlay(text, svg, { x: e.clientX, y: e.clientY }, center);
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

  function showDragOverlay(text, svg, cursorClient, fallbackSvgPoint) {
    const el = getResizeOverlay();
    if (!el) return;
    showResizeOverlay(text, cursorClient.x, cursorClient.y);
    const rect = el.getBoundingClientRect();
    const margin = 8;
    const overflow =
      rect.left < margin ||
      rect.right > window.innerWidth - margin ||
      rect.top < margin ||
      rect.bottom > window.innerHeight - margin;

    if (overflow && fallbackSvgPoint) {
      const pos = svgPointToClient(svg, fallbackSvgPoint.x, fallbackSvgPoint.y);
      showResizeOverlay(text, pos.x, pos.y, { mode: "center" });
    }
  }

  function onSvgPointerUp(e) {
    const svg = getSvg();
    svg.removeEventListener("pointermove", onSvgPointerMove);
    hideResizeOverlay();

    if (!drag || !dragStartState) return;

    const dx = drag.currentDx || 0;
    const dy = drag.currentDy || 0;
    const hasMoved = Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01;

    if (hasMoved) {
      const finalState = deepClone(dragStartState);
      const finalRoom = getCurrentRoom(finalState);
      const sec = finalRoom?.sections?.find(s => s.id === drag.id);

      if (sec) {
        sec.x += dx;
        sec.y += dy;
      }

      commit(getMoveLabel(), finalState);
    } else {
      // No movement - clear transforms and render
      const elements = findSectionElements(drag.id);
      elements.forEach(el => el.removeAttribute("transform"));
      setSelectedSection(drag.id);
    }

    drag = null;
    dragStartState = null;
  }

  function onSectionPointerDown(e) {
    e.preventDefault();
    e.stopPropagation();

    const id = e.currentTarget.getAttribute("data-secid");
    if (!id) return;

    const state = getState();
    const room = getCurrentRoom(state);
    const sections = getRoomSections(room);

    // Only allow dragging if there are multiple sections
    if (sections.length < 2) return;

    const sec = sections.find(s => s.id === id);
    if (!sec) return;

    if (setSelectedIdOnly) {
      setSelectedIdOnly(id);
    }

    // Apply visual selection styling
    const elements = findSectionElements(id);
    elements.forEach(el => {
      if (!el.hasAttribute("data-resize-handle")) {
        el.setAttribute("stroke", "rgba(122,162,255,1)");
        el.setAttribute("stroke-width", "2");
        el.setAttribute("fill", "rgba(122,162,255,0.15)");
      }
    });

    if (render) {
      render({ mode: "drag" });
    }

    const svg = getSvg();
    svg.setPointerCapture(e.pointerId);

    const startMouse = pointerToSvgXY(svg, e.clientX, e.clientY);
    dragStartState = deepClone(state);

    const otherSections = sections.filter(s => s.id !== id);

    drag = {
      id,
      startMouse,
      startShape: deepClone(sec),
      currentDx: 0,
      currentDy: 0,
      otherSections
    };

    const text = `x ${formatCm(sec.x)} cm · y ${formatCm(sec.y)} cm`;
    const center = {
      x: sec.x + sec.widthCm / 2,
      y: sec.y + sec.heightCm / 2
    };
    showDragOverlay(text, svg, { x: e.clientX, y: e.clientY }, center);

    svg.addEventListener("pointermove", onSvgPointerMove);
    svg.addEventListener("pointerup", onSvgPointerUp, { once: true });
    svg.addEventListener("pointercancel", onSvgPointerUp, { once: true });
  }

  // --- Resize handling ---

  function getSectionResizeDims(startShape, handleType, dx, dy) {
    let newX = startShape.x;
    let newY = startShape.y;
    let newW = startShape.widthCm;
    let newH = startShape.heightCm;

    if (handleType.includes("w")) {
      newX = startShape.x + dx;
      newW = Math.max(10, startShape.widthCm - dx);
    }
    if (handleType.includes("e")) {
      newW = Math.max(10, startShape.widthCm + dx);
    }
    if (handleType.includes("n")) {
      newY = startShape.y + dy;
      newH = Math.max(10, startShape.heightCm - dy);
    }
    if (handleType.includes("s")) {
      newH = Math.max(10, startShape.heightCm + dy);
    }

    return { newX, newY, newW, newH };
  }

  function applyResize(e) {
    if (!resize) return;

    const svg = getSvg();
    const curMouse = pointerToSvgXY(svg, e.clientX, e.clientY);
    const dx = curMouse.x - resize.startMouse.x;
    const dy = curMouse.y - resize.startMouse.y;

    resize.currentDx = dx;
    resize.currentDy = dy;

    const { startShape, handleType } = resize;
    const dims = getSectionResizeDims(startShape, handleType, dx, dy);

    // Check if resized section would still be connected
    const testSection = {
      ...startShape,
      x: dims.newX,
      y: dims.newY,
      widthCm: dims.newW,
      heightCm: dims.newH
    };

    const isValid = isSectionConnected(testSection, resize.otherSections);

    // Update section rect
    const elements = findSectionElements(resize.id);
    elements.forEach(el => {
      if (!el.hasAttribute("data-resize-handle")) {
        el.setAttribute("x", dims.newX);
        el.setAttribute("y", dims.newY);
        el.setAttribute("width", dims.newW);
        el.setAttribute("height", dims.newH);
        el.setAttribute("stroke", isValid ? "rgba(122,162,255,1)" : "rgba(239,68,68,0.95)");
      }
    });

    // Update overlay
    const overlayText = `${formatCm(dims.newW)} x ${formatCm(dims.newH)} cm`;
    showResizeOverlay(overlayText, e.clientX, e.clientY);

    // Update handle positions
    updateSectionResizeHandlePositions(resize.id, dims);
  }

  function updateSectionResizeHandlePositions(id, dims) {
    const handles = findSectionResizeHandles(id);
    const { newX, newY, newW, newH } = dims;

    handles.forEach(handle => {
      const ht = handle.getAttribute("data-resize-handle");
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
    hideResizeOverlay();

    if (!resize || !dragStartState) return;

    const dx = resize.currentDx || 0;
    const dy = resize.currentDy || 0;
    const hasResized = Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01;

    if (hasResized) {
      const { startShape, handleType } = resize;
      const dims = getSectionResizeDims(startShape, handleType, dx, dy);

      // Check connectivity before committing
      const testSection = {
        ...startShape,
        x: dims.newX,
        y: dims.newY,
        widthCm: dims.newW,
        heightCm: dims.newH
      };

      if (isSectionConnected(testSection, resize.otherSections)) {
        const finalState = deepClone(dragStartState);
        const finalRoom = getCurrentRoom(finalState);
        const sec = finalRoom?.sections?.find(s => s.id === resize.id);

        if (sec) {
          sec.x = dims.newX;
          sec.y = dims.newY;
          sec.widthCm = dims.newW;
          sec.heightCm = dims.newH;
        }

        const label = getResizeLabel ? getResizeLabel() : "Resized section";
        commit(label, finalState);
      } else {
        // Invalid resize - revert
        render();
      }
    } else {
      render();
    }

    resize = null;
    dragStartState = null;
  }

  function onSectionResizeHandlePointerDown(e) {
    e.preventDefault();
    e.stopPropagation();

    const id = e.currentTarget.getAttribute("data-secid");
    const handleType = e.currentTarget.getAttribute("data-resize-handle");
    if (!id || !handleType) return;

    const state = getState();
    const room = getCurrentRoom(state);
    const sections = getRoomSections(room);
    const sec = sections.find(s => s.id === id);
    if (!sec) return;

    const svg = getSvg();
    svg.setPointerCapture(e.pointerId);

    const startMouse = pointerToSvgXY(svg, e.clientX, e.clientY);
    dragStartState = deepClone(state);

    const otherSections = sections.filter(s => s.id !== id);

    resize = {
      id,
      handleType,
      startMouse,
      startShape: deepClone(sec),
      currentDx: 0,
      currentDy: 0,
      otherSections
    };

    showResizeOverlay(`${formatCm(sec.widthCm)} x ${formatCm(sec.heightCm)} cm`, e.clientX, e.clientY);

    svg.addEventListener("pointermove", onResizePointerMove);
    svg.addEventListener("pointerup", onResizePointerUp, { once: true });
    svg.addEventListener("pointercancel", onResizePointerUp, { once: true });
  }

  return { onSectionPointerDown, onSectionResizeHandlePointerDown };
}
