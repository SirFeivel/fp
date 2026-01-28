import { deepClone, getCurrentRoom } from './core.js';

export function createCanvasPlanningController({ getState, commit, renderAll }) {
  let isDraggingOrigin = false;
  let dragData = null;

  function onOriginPointerDown(e) {
    isDraggingOrigin = true;
    const svg = document.getElementById('planSvg');
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const cursor = pt.matrixTransform(svg.getScreenCTM().inverse());

    const state = getState();
    const room = getCurrentRoom(state);
    const origin = room.origin || { x: 0, y: 0 };

    dragData = {
      startX: cursor.x,
      startY: cursor.y,
      startOriginX: origin.x,
      startOriginY: origin.y
    };

    document.addEventListener('pointermove', onOriginPointerMove);
    document.addEventListener('pointerup', onOriginPointerUp);
    
    if (e.setPointerCapture) e.target.setPointerCapture(e.pointerId);
  }

  function onOriginPointerMove(e) {
    if (!isDraggingOrigin || !dragData) return;

    const svg = document.getElementById('planSvg');
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const cursor = pt.matrixTransform(svg.getScreenCTM().inverse());

    const dx = cursor.x - dragData.startX;
    const dy = cursor.y - dragData.startY;

    const state = getState();
    const next = deepClone(state);
    const room = getCurrentRoom(next);
    
    room.origin = room.origin || { x: 0, y: 0 };
    room.origin.x = Math.round(dragData.startOriginX + dx);
    room.origin.y = Math.round(dragData.startOriginY + dy);
    room.originPreset = 'free';

    commit("Move Origin", next, { onRender: renderAll, skipHistory: true });
  }

  function onOriginPointerUp() {
    if (!isDraggingOrigin) return;
    isDraggingOrigin = false;
    
    const state = getState();
    commit("Move Origin", state, { onRender: renderAll });

    document.removeEventListener('pointermove', onOriginPointerMove);
    document.removeEventListener('pointerup', onOriginPointerUp);
  }

  return {
    onOriginPointerDown
  };
}
