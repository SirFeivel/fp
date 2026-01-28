import { deepClone, getCurrentRoom } from './core.js';
import { getRoomSections } from './composite.js';

export function createSVGSectionsController({ getState, commit, renderAll, getSelectedId }) {
  let isResizing = false;
  let resizeData = null;

  function onAddSection(direction) {
    // This is already handled by sections.addSection, but we can call it from here
    // or just listen to the event in main.js
  }

  function onResizeStart(sectionId, direction, e) {
    isResizing = true;
    const state = getState();
    const room = getCurrentRoom(state);
    const sections = getRoomSections(room);
    const section = sections.find(s => s.id === sectionId);
    
    if (!section) return;

    // Convert SVG coordinates to screen coordinates? No, we work in SVG units (cm)
    const svg = document.getElementById('planSvg');
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const cursor = pt.matrixTransform(svg.getScreenCTM().inverse());

    resizeData = {
      sectionId,
      direction,
      startW: section.widthCm,
      startH: section.heightCm,
      startX: cursor.x,
      startY: cursor.y
    };

    document.addEventListener('pointermove', onResizeMove);
    document.addEventListener('pointerup', onResizeEnd);
    
    if (e.setPointerCapture) e.target.setPointerCapture(e.pointerId);
  }

  function onResizeMove(e) {
    if (!isResizing || !resizeData) return;

    const svg = document.getElementById('planSvg');
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const cursor = pt.matrixTransform(svg.getScreenCTM().inverse());

    const dx = cursor.x - resizeData.startX;
    const dy = cursor.y - resizeData.startY;

    const state = getState();
    const next = deepClone(state);
    const room = getCurrentRoom(next);
    const sections = getRoomSections(room);
    const section = sections.find(s => s.id === resizeData.sectionId);

    if (!section) return;

    if (resizeData.direction.includes('right')) {
      section.widthCm = Math.max(10, Math.round(resizeData.startW + dx));
    }
    if (resizeData.direction.includes('bottom')) {
      section.heightCm = Math.max(10, Math.round(resizeData.startH + dy));
    }

    // We don't commit on every move to avoid massive undo history, 
    // but we want to see it live. 
    // Actually, we can just render the changes without committing yet.
    // But then other things might not update. 
    // Let's use a "ephemeral" render for now if possible, or just commit.
    commit("Resize Section", next, { onRender: renderAll, skipHistory: true });
  }

  function onResizeEnd() {
    if (!isResizing) return;
    isResizing = false;
    
    // Final commit with history
    const state = getState();
    commit("Resize Section", state, { onRender: renderAll });

    document.removeEventListener('pointermove', onResizeMove);
    document.removeEventListener('pointerup', onResizeEnd);
  }

  return {
    onResizeStart
  };
}
