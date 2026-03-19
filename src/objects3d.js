// src/objects3d.js
import { deepClone, uuid, getCurrentRoom, resolvePresetTile, resolvePresetGrout } from './core.js';
import { t } from './i18n.js';
import { getRoomBounds } from './geometry.js';

/**
 * Build the virtual room-like region for a 3D object face.
 * Returns { widthCm, heightCm, polygonVertices, tile, grout, pattern, exclusions }
 * or null if dimensions cannot be determined.
 */
export function prepareObj3dFaceRegion(obj, surf, allSurfaceContacts, state) {
  // Compute face dimensions
  let faceW, faceH;
  if (obj.type === "rect") {
    const isTop = surf.face === "top";
    faceW = isTop ? obj.w : (surf.face === "left" || surf.face === "right" ? obj.h : obj.w);
    faceH = isTop ? obj.h : (obj.heightCm || 100);
  } else {
    const verts = obj.type === "tri" ? [obj.p1, obj.p2, obj.p3] : (obj.vertices || []);
    if (surf.face === "top") {
      const xs = verts.map(v => v.x), ys = verts.map(v => v.y);
      faceW = Math.max(...xs) - Math.min(...xs);
      faceH = Math.max(...ys) - Math.min(...ys);
    } else {
      const match = surf.face.match(/^side-(\d+)$/);
      if (match) {
        const idx = parseInt(match[1]);
        const a = verts[idx], b = verts[(idx + 1) % verts.length];
        if (a && b) faceW = Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
      }
      faceH = obj.heightCm || 100;
    }
  }
  if (!faceW || !faceH) return null;

  // Build polygon vertices for this face
  let polyVerts;
  if (surf.face === "top" && obj.type !== "rect") {
    const verts = obj.type === "tri" ? [obj.p1, obj.p2, obj.p3] : (obj.vertices || []);
    const xs = verts.map(v => v.x), ys = verts.map(v => v.y);
    const minX = Math.min(...xs), minY = Math.min(...ys);
    polyVerts = verts.map(v => ({ x: v.x - minX, y: v.y - minY }));
  } else {
    polyVerts = [
      { x: 0, y: 0 }, { x: faceW, y: 0 },
      { x: faceW, y: faceH }, { x: 0, y: faceH },
    ];
  }

  // Contact exclusions: areas where this face touches a wall
  const faceContacts = allSurfaceContacts.filter(c => c.objId === obj.id && c.face === surf.face);
  const exclusions = faceContacts.map(c => ({
    type: 'rect',
    x: c.faceLocalX1,
    y: 0,
    w: c.faceLocalX2 - c.faceLocalX1,
    h: c.contactH,
    _isContact: true,
  }));
  if (exclusions.length) {
    console.log(`[prepareObj3dFaceRegion] obj=${obj.id} face=${surf.face}: ${exclusions.length} contact exclusion(s)`);
  }

  const resolvedTile = resolvePresetTile(surf.tile, state);
  const resolvedGrout = surf.tile?.reference
    ? resolvePresetGrout(surf.grout, surf.tile.reference, state)
    : (surf.grout || { widthCm: 0.2, colorHex: "#ffffff" });

  return {
    widthCm: faceW,
    heightCm: faceH,
    polygonVertices: polyVerts,
    tile: resolvedTile,
    grout: resolvedGrout || { widthCm: 0.2, colorHex: "#ffffff" },
    pattern: surf.pattern || { type: "grid", bondFraction: 0.5, rotationDeg: 0, offsetXcm: 0, offsetYcm: 0 },
    exclusions,
  };
}

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

  function addCylinder() {
    const state = getState();
    const room = getCurrentRoom(state);
    if (!room) return;

    const bounds = getRoomBounds(room);
    const w = bounds.width;
    const h = bounds.height;
    const objCount = (room.objects3d || []).length;
    const obj = {
      id: uuid(),
      type: 'cylinder',
      label: `${t('objects3d.object')} ${objCount + 1}`,
      cx: bounds.minX + w * 0.5,
      cy: bounds.minY + h * 0.5,
      r: Math.max(5, Math.min(w, h) * 0.1),
      heightCm: 100,
      skirtingEnabled: true,
    };
    console.log(`[objects3d:addCylinder] cx=${obj.cx.toFixed(1)} cy=${obj.cy.toFixed(1)} r=${obj.r.toFixed(1)}`);

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
    } else if (cur.type === 'cylinder') {
      cur.cx = readNum('obj3dCX', cur.cx);
      cur.cy = readNum('obj3dCY', cur.cy);
      cur.r = Math.max(0.1, readNum('obj3dRadius', cur.r));
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
    addCylinder,
    deleteSelectedObj,
    commitObjProps,
    updateSurface,
  };
}
