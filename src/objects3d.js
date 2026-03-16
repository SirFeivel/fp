// src/objects3d.js
import { deepClone, uuid, getCurrentRoom } from './core.js';
import { t } from './i18n.js';
import { getRoomBounds } from './geometry.js';

/**
 * Creates surfaces for a 3D object based on its type.
 * rect → 5 faces: front, back, left, right, top
 * tri  → 4 faces: side-0, side-1, side-2, top
 * freeform → N+1 faces: side-0..side-(N-1), top
 */
function createSurfacesForType(type, obj) {
  let faces;
  if (type === 'tri') {
    faces = ['side-0', 'side-1', 'side-2', 'top'];
  } else if (type === 'freeform' && obj?.vertices?.length >= 3) {
    faces = obj.vertices.map((_, i) => `side-${i}`);
    faces.push('top');
  } else {
    // rect (default)
    faces = ['front', 'back', 'left', 'right', 'top'];
  }
  return faces.map(face => ({
    id: uuid(),
    face,
    tile: null,
    grout: null,
    pattern: null,
  }));
}

export function createObjects3DController({
  getState,
  commit,
  getSelectedId,
  setSelectedId,
}) {
  function getSelectedObj() {
    const state = getState();
    const id = getSelectedId();
    const room = getCurrentRoom(state);
    if (!room) return null;
    return (room.objects3d || []).find(o => o.id === id) || null;
  }

  function addRect() {
    const state = getState();
    const room = getCurrentRoom(state);
    if (!room) return;

    const bounds = getRoomBounds(room);
    const w = bounds.width;
    const h = bounds.height;
    const objCount = (room.objects3d || []).length;
    const obj = {
      id: uuid(),
      type: 'rect',
      label: `${t('objects3d.object')} ${objCount + 1}`,
      x: bounds.minX + w * 0.25,
      y: bounds.minY + h * 0.25,
      w: Math.max(10, w * 0.2),
      h: Math.max(10, h * 0.2),
      heightCm: 100,
      skirtingEnabled: true,
      surfaces: createSurfacesForType('rect'),
    };

    const next = deepClone(state);
    const nextRoom = getCurrentRoom(next);
    if (!nextRoom) return;

    nextRoom.objects3d.push(obj);
    setSelectedId(obj.id);
    commit(t('objects3d.added'), next);
  }

  function addTri() {
    const state = getState();
    const room = getCurrentRoom(state);
    if (!room) return;

    const bounds = getRoomBounds(room);
    const w = bounds.width;
    const h = bounds.height;
    const cx = bounds.minX + w * 0.5;
    const cy = bounds.minY + h * 0.5;
    const size = Math.max(10, Math.min(w, h) * 0.12);
    const objCount = (room.objects3d || []).length;
    const obj = {
      id: uuid(),
      type: 'tri',
      label: `${t('objects3d.object')} ${objCount + 1}`,
      p1: { x: cx, y: cy - size },
      p2: { x: cx - size, y: cy + size },
      p3: { x: cx + size, y: cy + size },
      heightCm: 100,
      skirtingEnabled: true,
      surfaces: createSurfacesForType('tri'),
    };

    const next = deepClone(state);
    const nextRoom = getCurrentRoom(next);
    if (!nextRoom) return;

    nextRoom.objects3d.push(obj);
    setSelectedId(obj.id);
    commit(t('objects3d.added'), next);
  }

  function addFreeform(vertices) {
    if (!vertices || vertices.length < 3) return;

    const state = getState();
    const room = getCurrentRoom(state);
    if (!room) return;

    const objCount = (room.objects3d || []).length;
    const obj = {
      id: uuid(),
      type: 'freeform',
      label: `${t('objects3d.object')} ${objCount + 1}`,
      vertices: vertices,
      heightCm: 100,
      skirtingEnabled: true,
      surfaces: createSurfacesForType('freeform', { vertices }),
    };

    const next = deepClone(state);
    const nextRoom = getCurrentRoom(next);
    if (!nextRoom) return;

    nextRoom.objects3d.push(obj);
    setSelectedId(obj.id);
    commit(t('objects3d.added'), next);
  }

  function deleteSelectedObj() {
    const state = getState();
    const id = getSelectedId();
    if (!id) return;

    const next = deepClone(state);
    const nextRoom = getCurrentRoom(next);
    if (!nextRoom) return;

    const beforeLen = nextRoom.objects3d.length;
    nextRoom.objects3d = nextRoom.objects3d.filter(o => o.id !== id);
    if (nextRoom.objects3d.length === beforeLen) return;

    setSelectedId(nextRoom.objects3d.at(-1)?.id ?? null);
    commit(t('objects3d.deleted'), next);
  }

  function commitObjProps(label) {
    const state = getState();
    const id = getSelectedId();
    if (!id) return;

    const next = deepClone(state);
    const nextRoom = getCurrentRoom(next);
    if (!nextRoom) return;

    const idx = nextRoom.objects3d.findIndex(o => o.id === id);
    if (idx < 0) return;

    const cur = nextRoom.objects3d[idx];

    const labelInp = document.getElementById('obj3dLabel');
    if (labelInp) cur.label = labelInp.value ?? cur.label;

    const readNum = (elId, def) => {
      const el = document.getElementById(elId);
      if (!el) return def;
      const v = Number(el.value);
      return Number.isFinite(v) ? v : def;
    };

    if (cur.type === 'tri') {
      cur.p1.x = readNum('obj3dP1X', cur.p1.x);
      cur.p1.y = readNum('obj3dP1Y', cur.p1.y);
      cur.p2.x = readNum('obj3dP2X', cur.p2.x);
      cur.p2.y = readNum('obj3dP2Y', cur.p2.y);
      cur.p3.x = readNum('obj3dP3X', cur.p3.x);
      cur.p3.y = readNum('obj3dP3Y', cur.p3.y);
    } else if (cur.type !== 'freeform') {
      cur.x = readNum('obj3dX', cur.x);
      cur.y = readNum('obj3dY', cur.y);
      cur.w = Math.max(0.1, readNum('obj3dW', cur.w));
      cur.h = Math.max(0.1, readNum('obj3dH', cur.h));
    }
    cur.heightCm = Math.max(1, readNum('obj3dHeight', cur.heightCm));

    const skirtInp = document.getElementById('obj3dSkirtingEnabled');
    if (skirtInp) cur.skirtingEnabled = !!skirtInp.checked;

    commit(label, next);
  }

  function updateSurface(objId, face, { tile, grout, pattern }) {
    const state = getState();
    const next = deepClone(state);
    const nextRoom = getCurrentRoom(next);
    if (!nextRoom) return;

    const obj = nextRoom.objects3d.find(o => o.id === objId);
    if (!obj) return;

    const surface = obj.surfaces.find(s => s.face === face);
    if (!surface) return;

    if (tile !== undefined) surface.tile = tile;
    if (grout !== undefined) surface.grout = grout;
    if (pattern !== undefined) surface.pattern = pattern;

    commit(t('objects3d.surfaceChanged'), next);
  }

  return {
    getSelectedObj,
    addRect,
    addTri,
    addFreeform,
    deleteSelectedObj,
    commitObjProps,
    updateSurface,
  };
}
