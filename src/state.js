// src/state.js
import {
  LS_SESSION,
  LS_PROJECTS,
  nowISO,
  deepClone,
  safeParseJSON,
  uuid,
} from './core.js';

export function createStateStore(defaultStateFn, validateStateFn) {
  // ✅ NEU: Normalizer (für alte Sessions ohne neue Felder)
  function normalizeState(s) {
    if (!s || typeof s !== "object") return defaultStateFn();

    // waste
    if (!s.waste || typeof s.waste !== "object") s.waste = { allowRotate: true };
    if (typeof s.waste.allowRotate !== "boolean") s.waste.allowRotate = true;

    return s;
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
    const entry = {
      id: uuid(),
      name: name || state.room?.name || 'Projekt',
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