// src/state.js
import {
  LS_SESSION,
  LS_PROJECTS,
  nowISO,
  deepClone,
  safeParseJSON,
  uuid,
  getCurrentRoom,
} from './core.js';

export function createStateStore(defaultStateFn, validateStateFn) {
  function normalizeState(s) {
    if (!s || typeof s !== "object") return defaultStateFn();

    const version = s.meta?.version || 1;

    if (version === 1) {
      s = migrateV1ToV2(s);
    }

    if (s.tile || s.grout || s.pattern) {
      const globalTile = s.tile || { widthCm: 40, heightCm: 20, shape: "rect" };
      const globalGrout = s.grout || { widthCm: 0.2 };
      const globalPattern = s.pattern || {
        type: "grid",
        bondFraction: 0.5,
        rotationDeg: 0,
        offsetXcm: 0,
        offsetYcm: 0,
        origin: { preset: "tl", xCm: 0, yCm: 0 }
      };

      if (s.floors && Array.isArray(s.floors)) {
        for (const floor of s.floors) {
          if (floor.rooms && Array.isArray(floor.rooms)) {
            for (const room of floor.rooms) {
              if (!room.tile) room.tile = deepClone(globalTile);
              if (!room.tile.shape) room.tile.shape = "rect";
              if (!room.grout) room.grout = deepClone(globalGrout);
              if (!room.grout.colorHex) room.grout.colorHex = "#ffffff";
              if (!room.pattern) room.pattern = deepClone(globalPattern);
            }
          }
        }
      }

      delete s.tile;
      delete s.grout;
      delete s.pattern;
    }

    if (!s.waste || typeof s.waste !== "object") s.waste = { allowRotate: true };
    if (typeof s.waste.allowRotate !== "boolean") s.waste.allowRotate = true;

    return s;
  }

  function migrateV1ToV2(oldState) {
    const floorId = uuid();
    const roomId = uuid();

    const newState = {
      meta: { version: 2, updatedAt: nowISO() },
      project: { name: oldState.room?.name || "Projekt" },
      floors: [
        {
          id: floorId,
          name: "Erdgeschoss",
          rooms: [
            {
              id: roomId,
              name: oldState.room?.name || "Raum",
              widthCm: oldState.room?.widthCm || 600,
              heightCm: oldState.room?.heightCm || 400,
              exclusions: oldState.exclusions || [],
              tile: oldState.tile || { widthCm: 40, heightCm: 20, shape: "rect" },
              grout: oldState.grout || { widthCm: 0.2, colorHex: "#ffffff" },
              pattern: oldState.pattern || {
                type: "grid",
                bondFraction: 0.5,
                rotationDeg: 0,
                offsetXcm: 0,
                offsetYcm: 0,
                origin: { preset: "tl", xCm: 0, yCm: 0 }
              }
            }
          ]
        }
      ],
      selectedFloorId: floorId,
      selectedRoomId: roomId,
      pricing: oldState.pricing || { packM2: 1.44, pricePerM2: 39.9, reserveTiles: 0 },
      waste: oldState.waste || { allowRotate: true },
      view: oldState.view || { showGrid: true, showNeeds: false }
    };

    return newState;
  }

  let state = normalizeState(defaultStateFn());
  let undoStack = [];
  let redoStack = [];
  let dirty = false;
  let lastSavedAt = null;

  function getState() {
    return state;
  }
  function setStateDirect(next) {
    state = normalizeState(next);
  }

  function getUndoStack() {
    return undoStack;
  }
  function getRedoStack() {
    return redoStack;
  }
  function isDirty() {
    return dirty;
  }
  function markDirty() {
    dirty = true;
  }
  function getLastSavedAt() {
    return lastSavedAt;
  }

  function autosaveSession(updateMetaCb) {
    try {
      localStorage.setItem(LS_SESSION, JSON.stringify(state));
      lastSavedAt = nowISO();
      dirty = false;
      updateMetaCb?.();
    } catch (e) {
      console.warn('Autosave failed:', e);
    }
  }

  function loadSessionIfAny() {
    const raw = localStorage.getItem(LS_SESSION);
    if (!raw) return false;

    const parsed = safeParseJSON(raw);
    if (!parsed.ok) return false;

    // ✅ NEU: Migration anwenden bevor Validierung/Benutzung
    const candidate = normalizeState(parsed.value);

    const { errors } = validateStateFn(candidate);
    if (errors.length > 0) return false;

    state = candidate;
    lastSavedAt = state?.meta?.updatedAt ?? null;
    return true;
  }

  function commit(label, nextState, { onRender, updateMetaCb } = {}) {
    const before = deepClone(state);
    const after = normalizeState(deepClone(nextState));
    after.meta = after.meta || {};
    after.meta.updatedAt = nowISO();

    const same = JSON.stringify(before) === JSON.stringify(after);
    if (same) {
      onRender?.();
      return;
    }

    undoStack.push({ label, before, after, ts: nowISO() });
    redoStack = [];
    state = after;

    autosaveSession(updateMetaCb);
    onRender?.(label);
  }

  function undo({ onRender, updateMetaCb } = {}) {
    if (undoStack.length === 0) return;
    const entry = undoStack.pop();
    redoStack.push(entry);
    state = normalizeState(deepClone(entry.before));
    autosaveSession(updateMetaCb);
    onRender?.(`Undo: ${entry.label}`);
  }

  function redo({ onRender, updateMetaCb } = {}) {
    if (redoStack.length === 0) return;
    const entry = redoStack.pop();
    undoStack.push(entry);
    state = normalizeState(deepClone(entry.after));
    autosaveSession(updateMetaCb);
    onRender?.(`Redo: ${entry.label}`);
  }

  // Projects
  function loadProjects() {
    const raw = localStorage.getItem(LS_PROJECTS);
    if (!raw) return [];
    const parsed = safeParseJSON(raw);
    if (!parsed.ok || !Array.isArray(parsed.value)) return [];
    return parsed.value;
  }
  function saveProjects(list) {
    localStorage.setItem(LS_PROJECTS, JSON.stringify(list));
  }

  function saveCurrentAsProject(name) {
    const projects = loadProjects();
    const currentRoom = getCurrentRoom(state);
    const entry = {
      id: uuid(),
      name: name || state.project?.name || currentRoom?.name || 'Projekt',
      updatedAt: nowISO(),
      data: deepClone(state),
    };
    projects.unshift(entry);
    saveProjects(projects);
    return entry.id;
  }

  function loadProjectById(id) {
    const projects = loadProjects();
    const entry = projects.find((p) => p.id === id);
    if (!entry) return { ok: false, name: null };

    state = normalizeState(deepClone(entry.data));
    undoStack = [];
    redoStack = [];
    autosaveSession();
    return { ok: true, name: entry.name };
  }

  function deleteProjectById(id) {
    let projects = loadProjects();
    const beforeLen = projects.length;
    projects = projects.filter((p) => p.id !== id);
    saveProjects(projects);
    return projects.length !== beforeLen;
  }

  return {
    // state
    getState,
    setStateDirect,

    // meta
    getUndoStack,
    getRedoStack,
    isDirty,
    markDirty,
    getLastSavedAt,

    // session + history
    autosaveSession,
    loadSessionIfAny,
    commit,
    undo,
    redo,

    // projects
    loadProjects,
    saveCurrentAsProject,
    loadProjectById,
    deleteProjectById,
  };
}