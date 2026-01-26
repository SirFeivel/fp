// src/exclusions.js
import { deepClone, uuid } from './core.js';

export function createExclusionsController({
  getState, // () => state
  commit, // (label, nextState) => void
  getSelectedId, // () => id|null
  setSelectedId, // (id|null) => void
}) {
  function getSelectedExcl() {
    const state = getState();
    const id = getSelectedId();
    return state.exclusions.find((e) => e.id === id) || null;
  }

  function addRect() {
    const state = getState();
    const w = state.room.widthCm,
      h = state.room.heightCm;
    const ex = {
      id: uuid(),
      type: 'rect',
      label: `Rechteck ${state.exclusions.length + 1}`,
      x: w * 0.25,
      y: h * 0.25,
      w: Math.max(10, w * 0.2),
      h: Math.max(10, h * 0.2),
    };
    const next = deepClone(state);
    next.exclusions.push(ex);
    setSelectedId(ex.id);
    commit('Ausschluss hinzugefügt', next);
  }

  function addCircle() {
    const state = getState();
    const w = state.room.widthCm,
      h = state.room.heightCm;
    const r = Math.max(10, Math.min(w, h) * 0.1);
    const ex = {
      id: uuid(),
      type: 'circle',
      label: `Kreis ${state.exclusions.length + 1}`,
      cx: w * 0.5,
      cy: h * 0.5,
      r,
    };
    const next = deepClone(state);
    next.exclusions.push(ex);
    setSelectedId(ex.id);
    commit('Ausschluss hinzugefügt', next);
  }

  function addTri() {
    const state = getState();
    const w = state.room.widthCm,
      h = state.room.heightCm;
    const cx = w * 0.5,
      cy = h * 0.5;
    const size = Math.max(10, Math.min(w, h) * 0.12);
    const ex = {
      id: uuid(),
      type: 'tri',
      label: `Dreieck ${state.exclusions.length + 1}`,
      p1: { x: cx, y: cy - size },
      p2: { x: cx - size, y: cy + size },
      p3: { x: cx + size, y: cy + size },
    };
    const next = deepClone(state);
    next.exclusions.push(ex);
    setSelectedId(ex.id);
    commit('Ausschluss hinzugefügt', next);
  }

  function deleteSelectedExcl() {
    const state = getState();
    const id = getSelectedId();
    if (!id) return;

    const next = deepClone(state);
    const beforeLen = next.exclusions.length;
    next.exclusions = next.exclusions.filter((e) => e.id !== id);
    if (next.exclusions.length === beforeLen) return;

    setSelectedId(next.exclusions.at(-1)?.id ?? null);
    commit('Ausschluss gelöscht', next);
  }

  function commitExclProps(label) {
    const state = getState();
    const id = getSelectedId();
    if (!id) return;

    const next = deepClone(state);
    const idx = next.exclusions.findIndex((e) => e.id === id);
    if (idx < 0) return;

    const cur = next.exclusions[idx];

    const labelInp = document.getElementById('exLabel');
    if (labelInp) cur.label = labelInp.value ?? cur.label;

    const readNum = (id, def) => {
      const el = document.getElementById(id);
      if (!el) return def;
      const v = Number(el.value);
      return Number.isFinite(v) ? v : def;
    };

    if (cur.type === 'rect') {
      cur.x = readNum('exX', cur.x);
      cur.y = readNum('exY', cur.y);
      cur.w = Math.max(0.1, readNum('exW', cur.w));
      cur.h = Math.max(0.1, readNum('exH', cur.h));
    } else if (cur.type === 'circle') {
      cur.cx = readNum('exCX', cur.cx);
      cur.cy = readNum('exCY', cur.cy);
      cur.r = Math.max(0.1, readNum('exR', cur.r));
    } else if (cur.type === 'tri') {
      cur.p1.x = readNum('exP1X', cur.p1.x);
      cur.p1.y = readNum('exP1Y', cur.p1.y);
      cur.p2.x = readNum('exP2X', cur.p2.x);
      cur.p2.y = readNum('exP2Y', cur.p2.y);
      cur.p3.x = readNum('exP3X', cur.p3.x);
      cur.p3.y = readNum('exP3Y', cur.p3.y);
    }

    commit(label, next);
  }

  return {
    getSelectedExcl,
    addRect,
    addCircle,
    addTri,
    deleteSelectedExcl,
    commitExclProps,
  };
}
