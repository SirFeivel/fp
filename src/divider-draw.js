// src/divider-draw.js — Draw controller for surface divider lines
import { findNearestEdgePoint } from './polygon-draw.js';

export function createDividerDrawController({ getSvg, getPolygonEdges, onComplete, onCancel }) {
  // getPolygonEdges() → [{p1:{x,y}, p2:{x,y}}] of current surface polygon
  const ANGLE_SNAP_DEG = [0, 45, 90, 135, 180, 225, 270, 315];
  const SNAP_THRESHOLD = 2;
  let active = false, startPt = null, previewLine = null;

  function snapToSurfaceEdge(pt) {
    const edges = getPolygonEdges().map(e => ({ roomId: 'surface', edge: e }));
    const result = findNearestEdgePoint(pt, edges);
    const snapped = result && result.distance <= SNAP_THRESHOLD ? result.point : null;
    console.log(`[divider-draw:snapToEdge] pt=(${pt.x.toFixed(1)},${pt.y.toFixed(1)}) dist=${result?.distance?.toFixed(2) ?? 'none'} snapped=${!!snapped}`);
    return snapped;
  }

  function angleSnap(from, to) {
    const dx = to.x - from.x, dy = to.y - from.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.1) return to;
    const angleDeg = ((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360;
    const best = ANGLE_SNAP_DEG.reduce((b, a) => {
      const d = Math.min(Math.abs(angleDeg - a), 360 - Math.abs(angleDeg - a));
      return d < b.d ? { a, d } : b;
    }, { a: ANGLE_SNAP_DEG[0], d: Infinity });
    const rad = best.a * Math.PI / 180;
    return { x: from.x + Math.cos(rad) * dist, y: from.y + Math.sin(rad) * dist };
  }

  function svgPoint(e) {
    const svg = getSvg();
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  }

  function onPointerDown(e) {
    const pt = svgPoint(e);
    const snapped = snapToSurfaceEdge(pt);
    if (!snapped) return;
    startPt = snapped;
    const svg = getSvg();
    previewLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    previewLine.setAttribute('stroke', 'rgba(99,102,241,0.8)');
    previewLine.setAttribute('stroke-width', '1.5');
    previewLine.setAttribute('stroke-dasharray', '4 3');
    previewLine.setAttribute('pointer-events', 'none');
    svg.appendChild(previewLine);
    console.log(`[divider-draw:pointerDown] startPt=(${snapped.x.toFixed(1)},${snapped.y.toFixed(1)})`);
  }

  function onPointerMove(e) {
    if (!startPt || !previewLine) return;
    const raw = svgPoint(e);
    const snapped = angleSnap(startPt, raw);
    previewLine.setAttribute('x1', startPt.x); previewLine.setAttribute('y1', startPt.y);
    previewLine.setAttribute('x2', snapped.x);  previewLine.setAttribute('y2', snapped.y);
  }

  function onPointerUp(e) {
    if (!startPt) return;
    const raw = svgPoint(e);
    const angleSnapped = angleSnap(startPt, raw);
    const endPt = snapToSurfaceEdge(angleSnapped);
    previewLine?.remove(); previewLine = null;
    const p1 = startPt; startPt = null;
    console.log(`[divider-draw:pointerUp] endPt=${endPt ? `(${endPt.x.toFixed(1)},${endPt.y.toFixed(1)})` : 'none'}`);
    if (endPt && (Math.abs(endPt.x - p1.x) > 0.1 || Math.abs(endPt.y - p1.y) > 0.1)) {
      onComplete({ p1, p2: endPt });
    } else {
      onCancel?.();
    }
  }

  function start() {
    active = true;
    const svg = getSvg();
    svg.addEventListener('pointerdown', onPointerDown);
    svg.addEventListener('pointermove', onPointerMove);
    svg.addEventListener('pointerup', onPointerUp);
    console.log('[divider-draw:start] draw mode active');
  }

  function stop() {
    active = false;
    previewLine?.remove(); previewLine = null; startPt = null;
    const svg = getSvg();
    svg.removeEventListener('pointerdown', onPointerDown);
    svg.removeEventListener('pointermove', onPointerMove);
    svg.removeEventListener('pointerup', onPointerUp);
    console.log('[divider-draw:stop] draw mode inactive');
  }

  return { start, stop, isActive: () => active };
}
