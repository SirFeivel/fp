// src/drag.js
import { deepClone } from "./core.js";

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
 * Wire drag handlers for exclusions inside the planSvg.
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
  getSelectedId, // () => id|null
  getMoveLabel // () => translated label for "moved" action
}) {
  let drag = null;
  let dragStartState = null;

  function onSvgPointerMove(e) {
    if (!drag) return;

    const svg = getSvg();
    const curMouse = pointerToSvgXY(svg, e.clientX, e.clientY);
    const dx = curMouse.x - drag.startMouse.x;
    const dy = curMouse.y - drag.startMouse.y;

    const state = getState();
    const temp = deepClone(state);
    const idx = temp.exclusions.findIndex((x) => x.id === drag.id);
    if (idx < 0) return;

    const start = drag.startShape;
    const cur = temp.exclusions[idx];

    if (cur.type === "rect") {
      cur.x = start.x + dx;
      cur.y = start.y + dy;
    } else if (cur.type === "circle") {
      cur.cx = start.cx + dx;
      cur.cy = start.cy + dy;
    } else {
      cur.p1.x = start.p1.x + dx;
      cur.p1.y = start.p1.y + dy;
      cur.p2.x = start.p2.x + dx;
      cur.p2.y = start.p2.y + dy;
      cur.p3.x = start.p3.x + dx;
      cur.p3.y = start.p3.y + dy;
    }

    setStateDirect(temp);
    render("…");
  }

  function onSvgPointerUp(e) {
    const svg = getSvg();
    svg.removeEventListener("pointermove", onSvgPointerMove);

    if (!drag || !dragStartState) return;

    const finalState = deepClone(getState());
    const startState = dragStartState;

    drag = null;
    dragStartState = null;

    const hasMoved = JSON.stringify(startState) !== JSON.stringify(finalState);
    if (hasMoved) {
      setStateDirect(startState);
      commit(getMoveLabel(), finalState);
    }
  }

  function onExclPointerDown(e) {
    e.preventDefault();
    e.stopPropagation();

    const id = e.currentTarget.getAttribute("data-exid");
    if (!id) return;

    setSelectedExcl(id);

    const ex = getSelectedExcl();
    if (!ex) return;

    const svg = getSvg();
    svg.setPointerCapture(e.pointerId);

    const startMouse = pointerToSvgXY(svg, e.clientX, e.clientY);
    dragStartState = deepClone(getState());
    drag = { id, startMouse, startShape: deepClone(ex) };

    svg.addEventListener("pointermove", onSvgPointerMove);
    svg.addEventListener("pointerup", onSvgPointerUp, { once: true });
    svg.addEventListener("pointercancel", onSvgPointerUp, { once: true });
  }

  return { onExclPointerDown };
}