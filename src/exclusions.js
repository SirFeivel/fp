// src/exclusions.js
import { deepClone, uuid, getCurrentRoom } from './core.js';
import { t } from './i18n.js';
import { getRoomBounds } from './geometry.js';

export function createExclusionsController({
  getState, // () => state
  commit, // (label, nextState) => void
  getSelectedId, // () => id|null
  setSelectedId, // (id|null) => void
  // Optional: override target resolution for non-floor surfaces (e.g. wall surfaces).
  // getTarget(state) must return the entity with an `exclusions` array.
  // getTargetBounds(state) must return { minX, minY, width, height }.
  // Defaults to floor room behavior when not provided.
  getTarget = null,
  getTargetBounds = null,
}) {
  const resolveTarget = (s) => getTarget ? getTarget(s) : getCurrentRoom(s);
  const resolveBounds = (s) => {
    if (getTargetBounds) return getTargetBounds(s);
    const room = getCurrentRoom(s);
    return room ? getRoomBounds(room) : { minX: 0, minY: 0, width: 200, height: 200 };
  };

  function getSelectedExcl() {
    const state = getState();
    const id = getSelectedId();
    const target = resolveTarget(state);
    if (!target) return null;
    return target.exclusions.find((e) => e.id === id) || null;
  }

  function addRect() {
    const state = getState();
    const target = resolveTarget(state);
    if (!target) return;

    const bounds = resolveBounds(state);
    const w = bounds.width;
    const h = bounds.height;
    const ex = {
      id: uuid(),
      type: 'rect',
      label: `${t('exclusions.rect')} ${target.exclusions.length + 1}`,
      x: bounds.minX + w * 0.25,
      y: bounds.minY + h * 0.25,
      w: Math.max(10, w * 0.2),
      h: Math.max(10, h * 0.2),
    };

    const next = deepClone(state);
    const nextTarget = resolveTarget(next);
    if (!nextTarget) return;

    nextTarget.exclusions.push(ex);
    setSelectedId(ex.id);
    commit(t('exclusions.added'), next);
  }

  function addCircle() {
    const state = getState();
    const target = resolveTarget(state);
    if (!target) return;

    const bounds = resolveBounds(state);
    const w = bounds.width;
    const h = bounds.height;
    const r = Math.max(10, Math.min(w, h) * 0.1);
    const ex = {
      id: uuid(),
      type: 'circle',
      label: `${t('exclusions.circle')} ${target.exclusions.length + 1}`,
      cx: bounds.minX + w * 0.5,
      cy: bounds.minY + h * 0.5,
      r,
    };

    const next = deepClone(state);
    const nextTarget = resolveTarget(next);
    if (!nextTarget) return;

    nextTarget.exclusions.push(ex);
    setSelectedId(ex.id);
    commit(t('exclusions.added'), next);
  }

  function addTri() {
    const state = getState();
    const target = resolveTarget(state);
    if (!target) return;

    const bounds = resolveBounds(state);
    const w = bounds.width;
    const h = bounds.height;
    const cx = bounds.minX + w * 0.5;
    const cy = bounds.minY + h * 0.5;
    const size = Math.max(10, Math.min(w, h) * 0.12);
    const ex = {
      id: uuid(),
      type: 'tri',
      label: `${t('exclusions.triangle')} ${target.exclusions.length + 1}`,
      p1: { x: cx, y: cy - size },
      p2: { x: cx - size, y: cy + size },
      p3: { x: cx + size, y: cy + size },
    };

    const next = deepClone(state);
    const nextTarget = resolveTarget(next);
    if (!nextTarget) return;

    nextTarget.exclusions.push(ex);
    setSelectedId(ex.id);
    commit(t('exclusions.added'), next);
  }

  function addFreeform(vertices) {
    if (!vertices || vertices.length < 3) return;

    const state = getState();
    const target = resolveTarget(state);
    if (!target) return;

    const freeformCount = target.exclusions.filter(e => e.type === 'freeform').length;
    const ex = {
      id: uuid(),
      type: 'freeform',
      label: `${t('exclusions.freeform')} ${freeformCount + 1}`,
      vertices: vertices,
      skirtingEnabled: true,
    };

    const next = deepClone(state);
    const nextTarget = resolveTarget(next);
    if (!nextTarget) return;

    nextTarget.exclusions.push(ex);
    setSelectedId(ex.id);
    commit(t('exclusions.addFreeform'), next);
  }

  function deleteSelectedExcl() {
    const state = getState();
    const id = getSelectedId();
    if (!id) return;

    const next = deepClone(state);
    const nextTarget = resolveTarget(next);
    if (!nextTarget) return;

    const beforeLen = nextTarget.exclusions.length;
    nextTarget.exclusions = nextTarget.exclusions.filter((e) => e.id !== id);
    if (nextTarget.exclusions.length === beforeLen) return;

    setSelectedId(nextTarget.exclusions.at(-1)?.id ?? null);
    commit(t('exclusions.deleted'), next);
  }

  function commitExclProps(label) {
    const state = getState();
    const id = getSelectedId();
    if (!id) return;

    const next = deepClone(state);
    const nextTarget = resolveTarget(next);
    if (!nextTarget) return;

    const idx = nextTarget.exclusions.findIndex((e) => e.id === id);
    if (idx < 0) return;

    const cur = nextTarget.exclusions[idx];

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

    const skirtInp = document.getElementById('exSkirtingEnabled');
    if (skirtInp) cur.skirtingEnabled = !!skirtInp.checked;

    commit(label, next);
  }

  function commitSubSurface(label) {
    const state = getState();
    const id = getSelectedId();
    if (!id) return;

    const next = deepClone(state);
    const nextTarget = resolveTarget(next);
    if (!nextTarget) return;

    const idx = nextTarget.exclusions.findIndex((e) => e.id === id);
    if (idx < 0) return;

    const cur = nextTarget.exclusions[idx];

    // Read from either the quick bar (qss*) or sidebar (subSurf*) — whichever triggered the commit
    const el = (qssId, sidebarId) => document.getElementById(qssId) || document.getElementById(sidebarId);

    const enabledInp = el('qssEnabled', 'subSurfEnabled');
    if (!enabledInp) return;

    if (!enabledInp.checked) {
      cur.tile = null;
      cur.grout = null;
      cur.pattern = null;
    } else {
      const presetSel = el('qssPreset', 'subSurfPreset');
      const presets = state.tilePresets || [];
      const preset = presetSel ? presets.find(p => p.id === presetSel.value) : null;

      cur.tile = preset
        ? { widthCm: preset.widthCm, heightCm: preset.heightCm, shape: preset.shape || 'rect', reference: preset.name }
        : (cur.tile || { widthCm: 20, heightCm: 20, shape: 'rect', reference: null });

      const groutW = el('qssGroutWidth', 'subSurfGroutWidth');
      const groutC = el('qssGroutColor', 'subSurfGroutColor');
      cur.grout = {
        widthCm: groutW ? Math.max(0, Number(groutW.value) || 0.2) : (cur.grout?.widthCm ?? 0.2),
        colorHex: groutC ? groutC.value : (cur.grout?.colorHex ?? '#ffffff'),
      };

      const patternSel = el('qssPattern', 'subSurfPattern');
      cur.pattern = {
        type: patternSel ? patternSel.value : (cur.pattern?.type || 'grid'),
        bondFraction: cur.pattern?.bondFraction ?? 0.5,
        rotationDeg: cur.pattern?.rotationDeg ?? 0,
        offsetXcm: cur.pattern?.offsetXcm ?? 0,
        offsetYcm: cur.pattern?.offsetYcm ?? 0,
        origin: cur.pattern?.origin ?? { preset: 'tl', xCm: 0, yCm: 0 },
      };
    }

    commit(label, next);
  }

  return {
    getSelectedExcl,
    addRect,
    addCircle,
    addTri,
    addFreeform,
    deleteSelectedExcl,
    commitExclProps,
    commitSubSurface,
  };
}
