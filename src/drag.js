// src/drag.js
import { deepClone, getCurrentRoom, getCurrentFloor, getWallSvgRotation, svgToLocalPoint, svgToLocalDelta } from "./core.js";
import { getRoomBounds } from "./geometry.js";
import { findNearestConnectedPosition } from "./floor_geometry.js";
import { ensureRoomWalls } from "./surface.js";

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
  if (startShape.type === "freeform" && startShape.vertices?.length > 0) {
    const xs = startShape.vertices.map(v => v.x + dx);
    const ys = startShape.vertices.map(v => v.y + dy);
    return {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys)
    };
  }
  // tri type (default)
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
  commit, // (label, nextState) => void
  render, // (label?) => void
  getSelectedExcl, // () => excl or null
  setSelectedExcl, // (id|null) => void
  setSelectedIdOnly, // (id|null) => void - sets ID without triggering render
  getSelectedId, // () => id|null
  getMoveLabel, // () => translated label for "moved" action
  getResizeLabel, // () => translated label for "resized" action
  onDragStart, // (id) => void
  onDragEnd // ({ id, moved, type }) => void
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
    const svgDx = snapToMm(curMouse.x - drag.startMouse.x);
    const svgDy = snapToMm(curMouse.y - drag.startMouse.y);

    // Store SVG-space delta for final state computation
    drag.currentDx = svgDx;
    drag.currentDy = svgDy;

    // Un-rotate for elements inside the rotated wall <g>
    const { dx, dy } = svgToLocalDelta(svgDx, svgDy, drag.wallRot);

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

    const svgDx = drag.currentDx || 0;
    const svgDy = drag.currentDy || 0;
    const hasMoved = Math.abs(svgDx) > 0.01 || Math.abs(svgDy) > 0.01;

    if (hasMoved) {
      // Un-rotate delta for wall surfaces (SVG is rotated for display)
      const { dx, dy } = svgToLocalDelta(svgDx, svgDy, drag.wallRot);

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
        } else if (excl.type === "freeform" && excl.vertices) {
          for (const v of excl.vertices) {
            v.x += dx;
            v.y += dy;
          }
        }
      }

      // Commit triggers full render with correct tile calculations
      commit(getMoveLabel(), finalState);
    } else {
      // No movement - selection already set in pointerdown, just trigger full render
      const elements = findExclElements(drag.id);
      elements.forEach(el => el.removeAttribute("transform"));
      // Use render() instead of setSelectedExcl() since ID is already set
      if (render) render();
    }

    if (onDragEnd) {
      onDragEnd({ id: drag.id, moved: hasMoved, type: "drag" });
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
    if (onDragStart) {
      onDragStart(id);
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
      bounds,
      wallRot: getWallSvgRotation(room),
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
    const svgDx = curMouse.x - resize.startMouse.x;
    const svgDy = curMouse.y - resize.startMouse.y;

    resize.currentDx = svgDx;
    resize.currentDy = svgDy;

    // Un-rotate for elements inside the rotated wall <g>
    const { dx, dy } = svgToLocalDelta(svgDx, svgDy, resize.wallRot);

    // Calculate new dimensions based on handle type and shape
    const { startShape, handleType } = resize;
    const elements = findExclElements(resize.id);
    let overlayText = "";
    let rectDims = null;
    let triPoints = null;
    let circleR = null;

    let freeformVertices = null;

    if (startShape.type === "rect") {
      rectDims = getRectResizeDims(startShape, handleType, dx, dy);
      overlayText = `${formatCm(rectDims.newW)} x ${formatCm(rectDims.newH)} cm`;
    } else if (startShape.type === "circle") {
      const local = svgToLocalPoint(curMouse.x, curMouse.y, resize.wallRot);
      circleR = Math.max(1, Math.sqrt(
        Math.pow(local.x - startShape.cx, 2) + Math.pow(local.y - startShape.cy, 2)
      ));
      overlayText = `Ø ${formatCm(circleR * 2)} cm`;
    } else if (startShape.type === "tri") {
      triPoints = getTriResizePoints(startShape, handleType, dx, dy);
      const a = dist(triPoints.p1, triPoints.p2);
      const b = dist(triPoints.p2, triPoints.p3);
      const c = dist(triPoints.p3, triPoints.p1);
      overlayText = `a ${formatCm(a)} · b ${formatCm(b)} · c ${formatCm(c)} cm`;
      updateTriangleLabels(resize.id, triPoints);
    } else if (startShape.type === "freeform" && startShape.vertices && handleType.startsWith("v")) {
      const vertexIndex = parseInt(handleType.substring(1), 10);
      freeformVertices = startShape.vertices.map((v, i) =>
        i === vertexIndex
          ? { x: v.x + dx, y: v.y + dy }
          : { ...v }
      );
      overlayText = `x ${formatCm(freeformVertices[vertexIndex].x)} · y ${formatCm(freeformVertices[vertexIndex].y)} cm`;
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
      } else if (startShape.type === "freeform" && freeformVertices) {
        // For freeform, update the polygon points
        if (!el.hasAttribute("data-resize-handle")) {
          const pts = freeformVertices.map(v => `${v.x},${v.y}`).join(" ");
          el.setAttribute("points", pts);
        }
      }
    });

    if (overlayText) {
      showResizeOverlay(overlayText, e.clientX, e.clientY);
    }

    // Update handle positions
    updateResizeHandlePositions(resize.id, startShape, dx, dy, handleType, curMouse, freeformVertices, resize.wallRot);
  }

  function updateResizeHandlePositions(id, startShape, dx, dy, activeHandle, curMouse, freeformVertices = null, wallRot = null) {
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
        const local = svgToLocalPoint(curMouse.x, curMouse.y, wallRot);
        const newR = Math.max(1, Math.sqrt(
          Math.pow(local.x - startShape.cx, 2) + Math.pow(local.y - startShape.cy, 2)
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
      } else if (startShape.type === "freeform" && freeformVertices && ht.startsWith("v")) {
        const vertexIndex = parseInt(ht.substring(1), 10);
        if (freeformVertices[vertexIndex]) {
          handle.setAttribute("cx", freeformVertices[vertexIndex].x);
          handle.setAttribute("cy", freeformVertices[vertexIndex].y);
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

    const svgDx = resize.currentDx || 0;
    const svgDy = resize.currentDy || 0;
    const hasResized = Math.abs(svgDx) > 0.01 || Math.abs(svgDy) > 0.01;

    if (hasResized) {
      // Un-rotate delta for wall surfaces
      const { dx, dy } = svgToLocalDelta(svgDx, svgDy, resize.wallRot);

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
          const local = svgToLocalPoint(curMouse.x, curMouse.y, resize.wallRot);
          excl.r = Math.max(1, Math.sqrt(
            Math.pow(local.x - startShape.cx, 2) + Math.pow(local.y - startShape.cy, 2)
          ));
        } else if (excl.type === "tri") {
          const pointNum = handleType.replace("p", "");
          excl[`p${pointNum}`].x = startShape[`p${pointNum}`].x + dx;
          excl[`p${pointNum}`].y = startShape[`p${pointNum}`].y + dy;
        } else if (excl.type === "freeform" && excl.vertices && handleType.startsWith("v")) {
          const vertexIndex = parseInt(handleType.substring(1), 10);
          if (excl.vertices[vertexIndex]) {
            excl.vertices[vertexIndex].x = startShape.vertices[vertexIndex].x + dx;
            excl.vertices[vertexIndex].y = startShape.vertices[vertexIndex].y + dy;
          }
        }
      }

      const label = getResizeLabel ? getResizeLabel() : "Resized exclusion";
      commit(label, finalState);
    } else {
      // No resize - trigger render to restore
      render();
    }

    if (onDragEnd) {
      onDragEnd({ id: resize.id, moved: hasResized, type: "resize" });
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
      currentDy: 0,
      wallRot: getWallSvgRotation(room),
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
 * Creates a drag controller for repositioning rooms on the floor canvas.
 * Used in Floor View mode.
 */
export function createRoomDragController({
  getSvg,
  getState,
  commit,
  render,
  getCurrentFloor,
  getMoveLabel
}) {
  let drag = null;
  let dragStartState = null;
  let isDragging = false;
  const DRAG_THRESHOLD = 5; // pixels before considering it a drag

  function onRoomPointerDown(e, roomId) {
    const svg = getSvg();
    if (!svg) return;

    const state = getState();
    const floor = getCurrentFloor(state);
    if (!floor) return;

    const room = floor.rooms?.find(r => r.id === roomId);
    if (!room) return;

    // Don't preventDefault here - allow click/dblclick to work
    // Only capture pointer after drag threshold is met

    const startMouse = pointerToSvgXY(svg, e.clientX, e.clientY);
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const pointerId = e.pointerId;
    dragStartState = deepClone(state);
    isDragging = false;

    drag = {
      roomId,
      startMouse,
      startClientX,
      startClientY,
      pointerId,
      startPos: { ...(room.floorPosition || { x: 0, y: 0 }) },
      currentDx: 0,
      currentDy: 0
    };

    svg.addEventListener("pointermove", onPointerMove);
    svg.addEventListener("pointerup", onPointerUp, { once: true });
    svg.addEventListener("pointercancel", onPointerUp, { once: true });
  }

  function onPointerMove(e) {
    if (!drag) return;

    const svg = getSvg();
    if (!svg) return;

    // Check if we've moved past the drag threshold
    const clientDx = e.clientX - drag.startClientX;
    const clientDy = e.clientY - drag.startClientY;
    const distance = Math.sqrt(clientDx * clientDx + clientDy * clientDy);

    if (!isDragging && distance < DRAG_THRESHOLD) {
      return; // Not dragging yet
    }

    if (!isDragging) {
      // Just crossed threshold - start actual drag
      isDragging = true;
      svg.setPointerCapture(drag.pointerId);
      showResizeOverlay(
        `${formatCm(drag.startPos.x)}, ${formatCm(drag.startPos.y)} cm`,
        e.clientX,
        e.clientY
      );
    }

    const current = pointerToSvgXY(svg, e.clientX, e.clientY);
    const rawDx = current.x - drag.startMouse.x;
    const rawDy = current.y - drag.startMouse.y;

    // Snap to 0.5cm grid
    drag.currentDx = Math.round(rawDx / 0.5) * 0.5;
    drag.currentDy = Math.round(rawDy / 0.5) * 0.5;

    const newX = drag.startPos.x + drag.currentDx;
    const newY = drag.startPos.y + drag.currentDy;

    // Update visual position of room group during drag
    const roomGroup = svg.querySelector(`[data-roomid="${drag.roomId}"]`);
    if (roomGroup) {
      roomGroup.setAttribute("transform", `translate(${newX}, ${newY})`);
    }

    showResizeOverlay(`${formatCm(newX)}, ${formatCm(newY)} cm`, e.clientX, e.clientY);
  }

  function onPointerUp(e) {
    if (!drag) return;

    const svg = getSvg();
    if (svg) {
      if (isDragging) {
        svg.releasePointerCapture(e.pointerId);
      }
      svg.removeEventListener("pointermove", onPointerMove);
    }

    hideResizeOverlay();

    // Only commit if position actually changed and was a drag
    if (isDragging && (drag.currentDx !== 0 || drag.currentDy !== 0)) {
      const next = deepClone(dragStartState);
      const floor = getCurrentFloor(next);
      const room = floor?.rooms?.find(r => r.id === drag.roomId);

      if (room) {
        const desiredX = drag.startPos.x + drag.currentDx;
        const desiredY = drag.startPos.y + drag.currentDy;

        // Get other rooms to check for overlap and connectivity
        const otherRooms = floor.rooms.filter(r => r.id !== drag.roomId);

        // Find position that is both non-overlapping AND connected to other rooms
        const snappedPos = findNearestConnectedPosition(
          room, otherRooms, desiredX, desiredY
        );

        room.floorPosition = room.floorPosition || { x: 0, y: 0 };
        room.floorPosition.x = snappedPos.x;
        room.floorPosition.y = snappedPos.y;

        commit(getMoveLabel?.() || "Room moved", next);
      }
    }
    // If not dragging or no change, don't need to do anything -
    // click/dblclick handlers will fire naturally

    drag = null;
    dragStartState = null;
    isDragging = false;
  }

  return { onRoomPointerDown };
}

/**
 * Creates a resize controller for rooms in floor view.
 * Allows resizing rooms by dragging corner/edge handles.
 */
export function createRoomResizeController({
  getSvg,
  getState,
  commit,
  render,
  getCurrentFloor,
  getResizeLabel
}) {
  let resize = null;
  let resizeStartState = null;

  function calcResizeDims(r, dx, dy) {
    let newWidth = r.startDims.widthCm;
    let newHeight = r.startDims.heightCm;
    let newPosX = r.startPos.x;
    let newPosY = r.startPos.y;
    const handle = r.handleType;

    if (handle.includes("e")) {
      newWidth = Math.max(50, r.startDims.widthCm + dx);
    } else if (handle.includes("w")) {
      const widthChange = Math.min(dx, r.startDims.widthCm - 50);
      newWidth = r.startDims.widthCm - widthChange;
      newPosX = r.startPos.x + widthChange;
    }

    if (handle.includes("s")) {
      newHeight = Math.max(50, r.startDims.heightCm + dy);
    } else if (handle.includes("n")) {
      const heightChange = Math.min(dy, r.startDims.heightCm - 50);
      newHeight = r.startDims.heightCm - heightChange;
      newPosY = r.startPos.y + heightChange;
    }

    return { newWidth, newHeight, newPosX, newPosY };
  }

  function onRoomResizePointerDown(e, roomId, handleType) {
    const svg = getSvg();
    if (!svg) return;

    const state = getState();
    const floor = getCurrentFloor(state);
    if (!floor) return;

    const room = floor.rooms?.find(r => r.id === roomId);
    const isCircle = room?.circle && room.circle.rx > 0;
    if (!isCircle && (!room || !room.polygonVertices || room.polygonVertices.length !== 4)) return;

    e.preventDefault();
    e.stopPropagation();

    svg.setPointerCapture(e.pointerId);

    const startMouse = pointerToSvgXY(svg, e.clientX, e.clientY);
    resizeStartState = deepClone(state);

    // Get initial room dimensions from polygonVertices bounds
    const bounds = getRoomBounds(room);
    const pos = room.floorPosition || { x: 0, y: 0 };

    resize = {
      roomId,
      handleType,
      startMouse,
      startPos: { ...pos },
      startDims: {
        widthCm: bounds.width,
        heightCm: bounds.height
      },
      isCircle,
      startCircle: isCircle ? { ...room.circle } : null,
      currentDx: 0,
      currentDy: 0
    };

    showResizeOverlay(
      `${formatCm(bounds.width)} × ${formatCm(bounds.height)} cm`,
      e.clientX,
      e.clientY
    );

    svg.addEventListener("pointermove", onPointerMove);
    svg.addEventListener("pointerup", onPointerUp, { once: true });
    svg.addEventListener("pointercancel", onPointerUp, { once: true });
  }

  function onPointerMove(e) {
    if (!resize) return;

    const svg = getSvg();
    if (!svg) return;

    const current = pointerToSvgXY(svg, e.clientX, e.clientY);
    const rawDx = current.x - resize.startMouse.x;
    const rawDy = current.y - resize.startMouse.y;

    // Snap to 0.5cm grid
    const dx = Math.round(rawDx / 0.5) * 0.5;
    const dy = Math.round(rawDy / 0.5) * 0.5;

    resize.currentDx = dx;
    resize.currentDy = dy;

    const { newWidth, newHeight, newPosX, newPosY } = calcResizeDims(resize, dx, dy);

    // Update visual during drag
    const roomGroup = svg.querySelector(`[data-roomid="${resize.roomId}"]`);
    if (roomGroup) {
      if (resize.isCircle) {
        // For circle/ellipse, compute new rx/ry from dimension changes
        const newRx = newWidth / 2;
        const newRy = newHeight / 2;
        roomGroup.setAttribute("transform", `translate(${newPosX}, ${newPosY})`);
        const ellipses = roomGroup.querySelectorAll("ellipse");
        ellipses.forEach(el => {
          el.setAttribute("cx", newRx);
          el.setAttribute("cy", newRy);
          el.setAttribute("rx", newRx);
          el.setAttribute("ry", newRy);
        });
      } else {
        roomGroup.setAttribute("transform", `translate(${newPosX}, ${newPosY})`);
        // Find and update the path
        const path = roomGroup.querySelector("path");
        if (path) {
          const d = `M 0 0 L ${newWidth} 0 L ${newWidth} ${newHeight} L 0 ${newHeight} Z`;
          path.setAttribute("d", d);
        }
      }
    }

    showResizeOverlay(`${formatCm(newWidth)} × ${formatCm(newHeight)} cm`, e.clientX, e.clientY);
  }

  function onPointerUp(e) {
    if (!resize) return;

    const svg = getSvg();
    if (svg) {
      svg.releasePointerCapture(e.pointerId);
      svg.removeEventListener("pointermove", onPointerMove);
    }

    hideResizeOverlay();

    // Commit changes if dimensions changed
    const { newWidth, newHeight, newPosX, newPosY } = calcResizeDims(resize, resize.currentDx, resize.currentDy);

    const hasChanges =
      newWidth !== resize.startDims.widthCm ||
      newHeight !== resize.startDims.heightCm ||
      newPosX !== resize.startPos.x ||
      newPosY !== resize.startPos.y;

    if (hasChanges) {
      const next = deepClone(resizeStartState);
      const floor = getCurrentFloor(next);
      const room = floor?.rooms?.find(r => r.id === resize.roomId);

      if (room && resize.isCircle && room.circle) {
        const newRx = newWidth / 2;
        const newRy = newHeight / 2;
        room.circle = { cx: newRx, cy: newRy, rx: newRx, ry: newRy };
        room.floorPosition = { x: newPosX, y: newPosY };
        room.widthCm = newWidth;
        room.heightCm = newHeight;

        commit(getResizeLabel?.() || "Room resized", next);
      } else if (room && room.polygonVertices?.length === 4) {
        room.floorPosition = { x: newPosX, y: newPosY };
        // Update polygonVertices for rectangle
        room.polygonVertices = [
          { x: 0, y: 0 },
          { x: newWidth, y: 0 },
          { x: newWidth, y: newHeight },
          { x: 0, y: newHeight }
        ];
        // Also update legacy dimensions for compatibility
        room.widthCm = newWidth;
        room.heightCm = newHeight;

        commit(getResizeLabel?.() || "Room resized", next);
      }
    } else {
      render();
    }

    resize = null;
    resizeStartState = null;
  }

  return { onRoomResizePointerDown };
}

/**
 * Creates a drag controller for polygon vertices in floor view.
 * Allows users to drag individual vertices of free-form rooms.
 */
export function createPolygonVertexDragController({
  getSvg,
  getState,
  commit,
  render,
  getCurrentFloor,
  getVertexMoveLabel
}) {
  let drag = null;
  let dragStartState = null;

  function snapToHalfCm(value) {
    return Math.round(value / 0.5) * 0.5;
  }

  function onVertexPointerDown(e, roomId, vertexIndex) {
    const svg = getSvg();
    if (!svg) return;

    const state = getState();
    const floor = getCurrentFloor(state);
    if (!floor) return;

    const room = floor.rooms?.find(r => r.id === roomId);
    if (!room || !room.polygonVertices) return;

    e.preventDefault();
    e.stopPropagation();

    svg.setPointerCapture(e.pointerId);

    const startMouse = pointerToSvgXY(svg, e.clientX, e.clientY);
    const pos = room.floorPosition || { x: 0, y: 0 };
    dragStartState = deepClone(state);

    drag = {
      roomId,
      vertexIndex,
      startMouse,
      startVertex: { ...room.polygonVertices[vertexIndex] },
      roomPos: { ...pos },
      currentDx: 0,
      currentDy: 0
    };

    const vertex = room.polygonVertices[vertexIndex];
    const absX = pos.x + vertex.x;
    const absY = pos.y + vertex.y;
    showResizeOverlay(`x: ${formatCm(absX)} cm  y: ${formatCm(absY)} cm`, e.clientX, e.clientY);

    svg.addEventListener("pointermove", onPointerMove);
    svg.addEventListener("pointerup", onPointerUp, { once: true });
    svg.addEventListener("pointercancel", onPointerUp, { once: true });
  }

  function onPointerMove(e) {
    if (!drag) return;

    const svg = getSvg();
    if (!svg) return;

    const current = pointerToSvgXY(svg, e.clientX, e.clientY);
    let rawDx = current.x - drag.startMouse.x;
    let rawDy = current.y - drag.startMouse.y;

    // Shift key: constrain to 15° angle increments (matching freeform drawing)
    if (e.shiftKey) {
      const angle = Math.atan2(rawDy, rawDx);
      const snappedAngle = Math.round(angle / (Math.PI / 12)) * (Math.PI / 12);
      const dist = Math.hypot(rawDx, rawDy);
      rawDx = Math.cos(snappedAngle) * dist;
      rawDy = Math.sin(snappedAngle) * dist;
    }

    // Snap to 0.5cm grid
    drag.currentDx = snapToHalfCm(rawDx);
    drag.currentDy = snapToHalfCm(rawDy);

    const newLocalX = drag.startVertex.x + drag.currentDx;
    const newLocalY = drag.startVertex.y + drag.currentDy;
    const absX = drag.roomPos.x + newLocalX;
    const absY = drag.roomPos.y + newLocalY;

    // Update visual position of vertex handle
    const handle = svg.querySelector(`[data-vertex-roomid="${drag.roomId}"][data-vertex-index="${drag.vertexIndex}"]`);
    if (handle) {
      handle.setAttribute("cx", absX);
      handle.setAttribute("cy", absY);
    }

    // Update the room polygon path visual
    const state = dragStartState;
    const floor = getCurrentFloor(state);
    const room = floor?.rooms?.find(r => r.id === drag.roomId);
    if (room?.polygonVertices) {
      const vertices = room.polygonVertices.map((v, i) => {
        if (i === drag.vertexIndex) {
          return { x: newLocalX, y: newLocalY };
        }
        return v;
      });
      // Use local coordinates - the roomGroup already has translate(pos.x, pos.y)
      const pathD = vertices.map((v, i) =>
        `${i === 0 ? "M" : "L"} ${v.x} ${v.y}`
      ).join(" ") + " Z";

      const roomPath = svg.querySelector(`[data-roomid="${drag.roomId}"] path`);
      if (roomPath) {
        roomPath.setAttribute("d", pathD);
      }
    }

    showResizeOverlay(`x: ${formatCm(absX)} cm  y: ${formatCm(absY)} cm`, e.clientX, e.clientY);
  }

  function onPointerUp(e) {
    if (!drag) return;

    const svg = getSvg();
    if (svg) {
      svg.releasePointerCapture(e.pointerId);
      svg.removeEventListener("pointermove", onPointerMove);
    }

    hideResizeOverlay();

    // Only commit if position actually changed
    if (drag.currentDx !== 0 || drag.currentDy !== 0) {
      const next = deepClone(dragStartState);
      const floor = getCurrentFloor(next);
      const room = floor?.rooms?.find(r => r.id === drag.roomId);

      if (room?.polygonVertices && room.polygonVertices[drag.vertexIndex]) {
        // Update vertex position (local coordinates)
        room.polygonVertices[drag.vertexIndex].x = drag.startVertex.x + drag.currentDx;
        room.polygonVertices[drag.vertexIndex].y = drag.startVertex.y + drag.currentDy;

        // Recalculate bounding box and update room dimensions
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;
        for (const v of room.polygonVertices) {
          minX = Math.min(minX, v.x);
          minY = Math.min(minY, v.y);
          maxX = Math.max(maxX, v.x);
          maxY = Math.max(maxY, v.y);
        }

        // If bounding box origin shifted, update floorPosition and normalize vertices
        if (minX !== 0 || minY !== 0) {
          room.floorPosition = room.floorPosition || { x: 0, y: 0 };
          room.floorPosition.x += minX;
          room.floorPosition.y += minY;
          room.polygonVertices = room.polygonVertices.map(v => ({
            x: v.x - minX,
            y: v.y - minY
          }));
          maxX -= minX;
          maxY -= minY;
        }

        room.widthCm = Math.round(maxX);
        room.heightCm = Math.round(maxY);

        // Regenerate walls after vertex drag
        ensureRoomWalls(room, floor, { forceRegenerate: true });

        commit(getVertexMoveLabel?.() || "Vertex moved", next);
      }
    } else {
      render();
    }

    drag = null;
    dragStartState = null;
  }

  return { onVertexPointerDown };
}
