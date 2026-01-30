// src/main.js
import "./style.css";
import { computePlanMetrics, getRoomPricing } from "./calc.js";
import { isInlineEditing } from "./ui_state.js";
import { validateState } from "./validation.js";
import { LS_SESSION, defaultState, deepClone, getCurrentRoom, uuid, getDefaultPricing, getDefaultTilePresetTemplate, DEFAULT_SKIRTING_PRESET } from "./core.js";
import { createStateStore } from "./state.js";
import { createExclusionDragController, createSectionDragController } from "./drag.js";
import { createExclusionsController } from "./exclusions.js";
import { createSectionsController } from "./sections.js";
import { bindUI } from "./ui.js";
import { t, setLanguage, getLanguage } from "./i18n.js";
import { initMainTabs } from "./tabs.js";
import { initFullscreen } from "./fullscreen.js";
import { getRoomBounds } from "./geometry.js";
import { wireQuickViewToggleHandlers, syncQuickViewToggleStates } from "./quick_view_toggles.js";
import { createZoomPanController } from "./zoom-pan.js";
import { getViewport } from "./viewport.js";
import { exportRoomsPdf, exportCommercialPdf, exportCommercialXlsx } from "./export.js";

import {
  renderWarnings,
  renderMetrics,
  renderStateView,
  renderCounts,
  renderRoomForm,
  renderTilePatternForm,
  renderExclList,
  renderExclProps,
  renderSkirtingRoomList,
  renderPlanSvg,
  renderSectionsList,
  renderTilePresets,
  renderSkirtingPresets,
  renderSectionProps,
  renderCommercialTab,
  renderExportTab
} from "./render.js";
import { createStructureController } from "./structure.js";
import { createRemovalController } from "./removal.js";
import { enforceCutoutForPresetRooms } from "./skirting_rules.js";

// Store
const store = createStateStore(defaultState, validateState);
window.__fpStore = store; // keep for console testing

let selectedExclId = null;
let selectedSectionId = null;
let selectedTilePresetId = null;
let selectedSkirtingPresetId = null;
let lastUnionError = null;
let lastTileError = null;
const exportSelection = new Set();

function updateMeta() {
  const last = store.getLastSavedAt();
  document.getElementById("lastSaved").textContent = last ? last : "–";
  document.getElementById("sessionStatus").textContent = localStorage.getItem(LS_SESSION)
    ? t("session.present")
    : "–";
}

function refreshProjectSelect() {
  const sel = document.getElementById("projectSelect");
  const projects = store.loadProjects();
  sel.innerHTML = "";

  if (projects.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = t("project.none");
    sel.appendChild(opt);
    sel.disabled = true;
    return;
  }
  sel.disabled = false;

  for (const p of projects) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = `${p.name} (updated: ${p.updatedAt})`;
    sel.appendChild(opt);
  }
}

function setSelectedExcl(id) {
  const newId = id || null;
  const changed = selectedExclId !== newId || (id && selectedSectionId);
  selectedExclId = newId;
  if (id) selectedSectionId = null; // Deselect section when selecting exclusion
  if (changed) renderAll();
}
function setSelectedId(id) {
  selectedExclId = id || null;
}

function setSelectedSection(id) {
  selectedSectionId = id || null;
  renderAll();
}
function setSelectedSectionId(id) {
  selectedSectionId = id || null;
}

// Handle section selection - deselects exclusion when selecting section
function handleSectionSelect(id) {
  const newId = id || null;
  const changed = selectedSectionId !== newId || (id && selectedExclId);
  selectedSectionId = newId;
  if (id) selectedExclId = null; // Deselect exclusion when selecting section
  if (changed) renderAll();
}

// Hook for post-render sync (set by IIFE below)
let afterRenderHook = null;

const RenderScope = {
  SETUP: "setup",
  PLANNING: "planning",
  COMMERCIAL: "commercial",
  EXPORT: "export",
  PLAN_AND_COMMERCIAL: "plan_and_commercial",
  ALL: "all"
};

function resolveRenderScope(label, opts) {
  if (opts?.scope) return opts.scope;
  if (!label) return RenderScope.ALL;
  if (label.startsWith("Undo:") || label.startsWith("Redo:")) return RenderScope.ALL;
  if (label.startsWith("Update Material:")) return RenderScope.COMMERCIAL;

  const planCommercial = new Set([
    t("tile.changed"),
    t("tile.patternChanged"),
    t("tile.offsetChanged"),
    t("tile.presetChanged"),
    t("skirting.changed"),
    t("removal.modeToggled"),
    t("removal.tileToggled"),
    t("removal.skirtToggled"),
    t("exclusions.added"),
    t("exclusions.deleted"),
    t("exclusions.changed"),
    t("exclusions.moved"),
    t("room.sectionAdded"),
    t("room.sectionDeleted"),
    t("waste.changed"),
    t("waste.optimizeChanged")
  ]);

  const setupAll = new Set([
    t("structure.floorAdded"),
    t("structure.floorDeleted"),
    t("structure.floorChanged"),
    t("structure.roomAdded"),
    t("structure.roomDeleted"),
    t("room.changed"),
    t("session.reset"),
    t("project.loaded")
  ]);

  const planningOnly = new Set([
    t("room.viewChanged")
  ]);

  const exportOnly = new Set([
    t("export.selectionChanged")
  ]);

  if (planCommercial.has(label)) return RenderScope.PLAN_AND_COMMERCIAL;
  if (planningOnly.has(label)) return RenderScope.PLANNING;
  if (exportOnly.has(label)) return RenderScope.EXPORT;
  if (setupAll.has(label)) return RenderScope.ALL;
  return RenderScope.ALL;
}

function renderSetupSection(state) {
  structure.renderFloorSelect();
  structure.renderFloorName();
  structure.renderRoomSelect();
}

function renderPlanningSection(state, opts) {
  const isDrag = opts?.mode === "drag";
  renderRoomForm(state);
  renderTilePatternForm(state);

  renderSectionsList(state, selectedSectionId);
  renderTilePresets(state, selectedTilePresetId, (id) => { selectedTilePresetId = id; });
  renderSkirtingPresets(state, selectedSkirtingPresetId, (id) => { selectedSkirtingPresetId = id; });
  renderSkirtingRoomList(state, {
    onToggleRoom: setRoomSkirtingEnabledById,
    onToggleSection: setSectionSkirtingEnabledById
  });
  renderSectionProps({
    state,
    selectedSectionId,
    getSelectedSection: sections.getSelectedSection,
    commitSectionProps: sections.commitSectionProps
  });

  renderExclList(state, selectedExclId);
  renderExclProps({
    state,
    selectedExclId,
    getSelectedExcl: excl.getSelectedExcl,
    commitExclProps: excl.commitExclProps
  });

  renderWarnings(state, validateState);
  if (!isDrag) renderMetrics(state);

  const metrics = isDrag ? null : computePlanMetrics(state);
  if (metrics) console.log("metrics", metrics);

  renderPlanSvg({
    state,
    selectedExclId,
    setSelectedExcl,
    onExclPointerDown: dragController.onExclPointerDown,
    onInlineEdit: updateExclusionInline,
    onResizeHandlePointerDown: dragController.onResizeHandlePointerDown,
    lastUnionError,
    lastTileError,
    setLastUnionError: (v) => (lastUnionError = v),
    setLastTileError: (v) => (lastTileError = v),
    metrics,
    skipTiles: isDrag,
    // Section callbacks
    selectedSectionId,
    setSelectedSection: handleSectionSelect,
    onSectionPointerDown: sectionDragController.onSectionPointerDown,
    onSectionResizeHandlePointerDown: sectionDragController.onSectionResizeHandlePointerDown,
    onSectionInlineEdit: updateSectionInline,
    onAddSectionAtEdge: (direction, edgeInfo) => sections.addSection(direction, edgeInfo)
  });
}

function getExportOptionsFromUi() {
  return {
    roomIds: Array.from(exportSelection),
    pageSize: document.getElementById("exportPageSize")?.value || "A4",
    orientation: document.getElementById("exportOrientation")?.value || "portrait",
    scale: document.getElementById("exportScale")?.value || "fit",
    includeGrid: Boolean(document.getElementById("exportIncludeGrid")?.checked),
    includeSkirting: Boolean(document.getElementById("exportIncludeSkirting")?.checked),
    includeExclusions: Boolean(document.getElementById("exportIncludeExclusions")?.checked),
    includeLegend: Boolean(document.getElementById("exportIncludeLegend")?.checked),
    includeMetrics: Boolean(document.getElementById("exportIncludeMetrics")?.checked),
    notes: document.getElementById("exportNotes")?.value || ""
  };
}

function setExportStatus(message, isError = false) {
  const status = document.getElementById("exportStatus");
  if (!status) return;
  status.textContent = message || "–";
  status.style.color = isError ? "#ff6b6b" : "";
}

function setExportProgress(current, total) {
  const fill = document.getElementById("exportProgressFill");
  if (!fill || !total) return;
  const pct = Math.min(100, Math.round((current / total) * 100));
  fill.style.width = `${pct}%`;
}

function toggleExportProgress(show) {
  const wrap = document.getElementById("exportProgress");
  if (!wrap) return;
  wrap.classList.toggle("hidden", !show);
  if (!show) setExportProgress(0, 1);
}

function renderExportSection(state) {
  if (exportSelection.size === 0) {
    for (const floor of state.floors || []) {
      for (const room of floor.rooms || []) {
        exportSelection.add(room.id);
      }
    }
  }
  renderExportTab(state, exportSelection);
}

function renderCommercialSection(state) {
  renderCommercialTab(state);
}

function renderCommon(state, label) {
  renderStateView(state);
  renderCounts(store.getUndoStack(), store.getRedoStack(), label);
  refreshProjectSelect();
  updateMeta();
  if (afterRenderHook) afterRenderHook();
}

function renderByScope(state, scope, label, opts) {
  switch (scope) {
    case RenderScope.SETUP:
      renderSetupSection(state);
      break;
    case RenderScope.PLANNING:
      renderPlanningSection(state, opts);
      break;
    case RenderScope.COMMERCIAL:
      renderCommercialSection(state);
      break;
    case RenderScope.EXPORT:
      renderExportSection(state);
      break;
    case RenderScope.PLAN_AND_COMMERCIAL:
      renderPlanningSection(state, opts);
      renderCommercialSection(state);
      break;
    case RenderScope.ALL:
    default:
      renderSetupSection(state);
      renderPlanningSection(state, opts);
      renderCommercialSection(state);
      renderExportSection(state);
      break;
  }
  renderCommon(state, label);
}

function renderAll(lastLabel, options) {
  let opts = options || {};
  let label = lastLabel;
  if (lastLabel && typeof lastLabel === "object") {
    opts = lastLabel;
    label = undefined;
  }
  const scope = resolveRenderScope(label, opts);

  try {
    const state = store.getState();
    renderByScope(state, scope, label, opts);
  } catch (error) {
    console.error("Render failed:", error);
    const errorDiv = document.getElementById("warnings");
    if (errorDiv) {
      const div = document.createElement("div");
      div.className = "warnItem";
      div.style.border = "2px solid rgba(255,107,107,0.5)";
      const title = document.createElement("div");
      title.className = "wTitle";
      title.textContent = t("errors.renderFailed");
      const text = document.createElement("div");
      text.className = "wText";
      text.textContent = `${t("errors.reloadPage")} ${error.message}`;
      div.replaceChildren(title, text);
      errorDiv.prepend(div);
    }
  }
}

function updateExportSelectionFromList() {
  exportSelection.clear();
  const inputs = document.querySelectorAll("#exportRoomsList input[type=\"checkbox\"][data-room-id]");
  inputs.forEach((input) => {
    if (input.checked) exportSelection.add(input.dataset.roomId);
  });
}

// commit helper
const commitViaStore = (label, next) =>
  store.commit(label, next, { onRender: renderAll, updateMetaCb: updateMeta });

const excl = createExclusionsController({
  getState: () => store.getState(),
  commit: commitViaStore,
  getSelectedId: () => selectedExclId,
  setSelectedId
});

const sections = createSectionsController({
  getState: () => store.getState(),
  commit: commitViaStore,
  getSelectedId: () => selectedSectionId,
  setSelectedId: setSelectedSectionId
});

const structure = createStructureController({
  store,
  renderAll,
  updateMeta,
  resetSelectedExcl: () => setSelectedExcl(null)
});

const removal = createRemovalController(store, renderAll);

const dragController = createExclusionDragController({
  getSvg: () => document.getElementById("planSvgFullscreen") || document.getElementById("planSvg"),
  getState: () => store.getState(),
  setStateDirect: (s) => store.setStateDirect(s),
  commit: (label, next) => commitViaStore(label, next),
  render: (label) => renderAll(label),
  getSelectedExcl: () => excl.getSelectedExcl(),
  setSelectedExcl,
  setSelectedIdOnly: setSelectedId, // Set ID without triggering render (for drag start)
  getSelectedId: () => selectedExclId,
  getMoveLabel: () => t("exclusions.moved"),
  getResizeLabel: () => t("exclusions.resized")
});

const sectionDragController = createSectionDragController({
  getSvg: () => document.getElementById("planSvgFullscreen") || document.getElementById("planSvg"),
  getState: () => store.getState(),
  commit: (label, next) => commitViaStore(label, next),
  render: (label) => renderAll(label),
  getSelectedSection: () => sections.getSelectedSection(),
  setSelectedSection: handleSectionSelect,
  setSelectedIdOnly: setSelectedSectionId,
  getSelectedId: () => selectedSectionId,
  getMoveLabel: () => t("room.sectionMoved") || "Section moved",
  getResizeLabel: () => t("room.sectionResized") || "Section resized"
});

const zoomPanController = createZoomPanController({
  getSvg: () => document.getElementById("planSvgFullscreen") || document.getElementById("planSvg"),
  getCurrentRoomId: () => store.getState().selectedRoomId,
  onViewportChange: () => renderAll({ mode: "zoom" }),
  getSelectedExclId: () => selectedExclId
});

function setRoomSkirtingEnabled(enabled) {
  const next = deepClone(store.getState());
  const room = getCurrentRoom(next);
  if (!room) return;
  room.skirting = room.skirting || {};
  room.skirting.enabled = enabled;
  commitViaStore(t("skirting.changed"), next);
}

function setRoomSkirtingEnabledById(roomId, enabled) {
  const next = deepClone(store.getState());
  let targetRoom = null;
  for (const floor of next.floors || []) {
    const match = floor.rooms?.find(r => r.id === roomId);
    if (match) {
      targetRoom = match;
      break;
    }
  }
  if (!targetRoom) return;
  targetRoom.skirting = targetRoom.skirting || {};
  targetRoom.skirting.enabled = enabled;
  commitViaStore(t("skirting.changed"), next);
}

function setSectionSkirtingEnabled(id, enabled) {
  if (!id) return;
  const next = deepClone(store.getState());
  const room = getCurrentRoom(next);
  if (!room || !room.sections) return;
  const sec = room.sections.find(s => s.id === id);
  if (!sec) return;
  sec.skirtingEnabled = enabled;
  commitViaStore(t("room.sectionChanged") || "Section changed", next);
}

function setSectionSkirtingEnabledById(roomId, sectionId, enabled) {
  if (!roomId || !sectionId) return;
  const next = deepClone(store.getState());
  let targetRoom = null;
  for (const floor of next.floors || []) {
    const match = floor.rooms?.find(r => r.id === roomId);
    if (match) {
      targetRoom = match;
      break;
    }
  }
  if (!targetRoom || !targetRoom.sections) return;
  const sec = targetRoom.sections.find(s => s.id === sectionId);
  if (!sec) return;
  sec.skirtingEnabled = enabled;
  commitViaStore(t("room.sectionChanged") || "Section changed", next);
}

function setExclusionSkirtingEnabled(id, enabled) {
  if (!id) return;
  const next = deepClone(store.getState());
  const room = getCurrentRoom(next);
  if (!room || !room.exclusions) return;
  const ex = room.exclusions.find(e => e.id === id);
  if (!ex) return;
  ex.skirtingEnabled = enabled;
  commitViaStore(t("exclusions.changed"), next);
}

function updateExclusionInline({ id, key, value }) {
  if (key !== "__delete__" && !Number.isFinite(value)) return;

  const next = deepClone(store.getState());
  const room = getCurrentRoom(next);
  if (!room) return;
  const ex = room.exclusions?.find(x => x.id === id);
  if (!ex) return;
  if (key === "__delete__") {
    room.exclusions = room.exclusions.filter(x => x.id !== id);
    const remaining = room.exclusions;
    if (remaining.length > 0) {
      setSelectedExcl(remaining.at(-1)?.id ?? null);
    } else {
      setSelectedExcl(null);
    }
    commitViaStore(t("exclusions.deleted"), next);
    return;
  }
  const bounds = getRoomBounds(room);

  const clampPos = (v) => Math.max(0.1, v);

  const getBox = (shape) => {
    if (shape.type === "rect") {
      return {
        minX: shape.x,
        minY: shape.y,
        maxX: shape.x + shape.w,
        maxY: shape.y + shape.h
      };
    }
    if (shape.type === "circle") {
      return {
        minX: shape.cx - shape.r,
        minY: shape.cy - shape.r,
        maxX: shape.cx + shape.r,
        maxY: shape.cy + shape.r
      };
    }
    const xs = [shape.p1.x, shape.p2.x, shape.p3.x];
    const ys = [shape.p1.y, shape.p2.y, shape.p3.y];
    return {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys)
    };
  };

  const moveAll = (dx, dy) => {
    if (ex.type === "rect") {
      ex.x += dx;
      ex.y += dy;
    } else if (ex.type === "circle") {
      ex.cx += dx;
      ex.cy += dy;
    } else if (ex.type === "tri") {
      ex.p1.x += dx; ex.p1.y += dy;
      ex.p2.x += dx; ex.p2.y += dy;
      ex.p3.x += dx; ex.p3.y += dy;
    }
  };

  const setSideLength = (p1, p2, nextLen) => {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.001) return p2;
    const scale = nextLen / len;
    return { x: p1.x + dx * scale, y: p1.y + dy * scale };
  };

  if (key === "x" || key === "y") {
    const box = getBox(ex);
    if (key === "x") {
      const targetLeft = bounds.minX + value;
      const dx = targetLeft - box.minX;
      moveAll(dx, 0);
    } else {
      const targetTop = bounds.minY + value;
      const dy = targetTop - box.minY;
      moveAll(0, dy);
    }
  } else if (ex.type === "rect") {
    if (key === "w") ex.w = clampPos(value);
    if (key === "h") ex.h = clampPos(value);
  } else if (ex.type === "circle") {
    if (key === "diameter") ex.r = clampPos(value) / 2;
  } else if (ex.type === "tri") {
    const nextLen = clampPos(value);
    if (key === "side-a") ex.p2 = setSideLength(ex.p1, ex.p2, nextLen);
    if (key === "side-b") ex.p3 = setSideLength(ex.p2, ex.p3, nextLen);
    if (key === "side-c") ex.p1 = setSideLength(ex.p3, ex.p1, nextLen);
  }

  commitViaStore(t("exclusions.changed"), next);
}

function updateSectionInline({ id, key, value }) {
  if (key !== "__delete__" && !Number.isFinite(value)) return;

  const next = deepClone(store.getState());
  const room = getCurrentRoom(next);
  if (!room || !room.sections) return;

  const sec = room.sections.find(s => s.id === id);
  if (!sec) return;

  if (key === "__delete__") {
    room.sections = room.sections.filter(s => s.id !== id);
    if (room.sections.length === 0) {
      delete room.sections;
      handleSectionSelect(null);
    } else {
      handleSectionSelect(room.sections.at(-1)?.id ?? null);
    }
    commitViaStore(t("room.sectionDeleted") || "Section deleted", next);
    return;
  }

  // Handle dimension edits
  if (key === "widthCm") {
    sec.widthCm = Math.max(1, value);
  } else if (key === "heightCm") {
    sec.heightCm = Math.max(1, value);
  }

  commitViaStore(t("room.sectionChanged") || "Section changed", next);
}

function nudgeSelectedExclusion(dx, dy) {
  const id = selectedExclId;
  if (!id) return;
  const next = deepClone(store.getState());
  const room = getCurrentRoom(next);
  if (!room) return;
  const ex = room.exclusions?.find(x => x.id === id);
  if (!ex) return;

  const snap = (v) => Math.round(v * 10) / 10;
  const isOnGrid = (v) => Math.abs(v - snap(v)) < 1e-6;
  const snapDir = (v, dir) => {
    if (dir === 0) return v;
    if (isOnGrid(v)) return v + dir;
    return dir > 0 ? Math.ceil(v * 10) / 10 : Math.floor(v * 10) / 10;
  };

  const getBox = (shape) => {
    if (shape.type === "rect") {
      return {
        minX: shape.x,
        minY: shape.y,
        maxX: shape.x + shape.w,
        maxY: shape.y + shape.h
      };
    }
    if (shape.type === "circle") {
      return {
        minX: shape.cx - shape.r,
        minY: shape.cy - shape.r,
        maxX: shape.cx + shape.r,
        maxY: shape.cy + shape.r
      };
    }
    const xs = [shape.p1.x, shape.p2.x, shape.p3.x];
    const ys = [shape.p1.y, shape.p2.y, shape.p3.y];
    return {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys)
    };
  };

  const box = getBox(ex);
  const targetMinX = snapDir(box.minX, dx);
  const targetMinY = snapDir(box.minY, dy);
  const moveDx = dx === 0 ? 0 : targetMinX - box.minX;
  const moveDy = dy === 0 ? 0 : targetMinY - box.minY;

  if (ex.type === "rect") {
    ex.x += moveDx;
    ex.y += moveDy;
  } else if (ex.type === "circle") {
    ex.cx += moveDx;
    ex.cy += moveDy;
  } else if (ex.type === "tri") {
    ex.p1.x += moveDx; ex.p1.y += moveDy;
    ex.p2.x += moveDx; ex.p2.y += moveDy;
    ex.p3.x += moveDx; ex.p3.y += moveDy;
  }

  commitViaStore(t("exclusions.moved"), next);
}

function bindPresetCollection() {
  const tileList = document.getElementById("tilePresetList");
  const tileName = document.getElementById("tilePresetName");
  const tileShape = document.getElementById("tilePresetShape");
  const tileW = document.getElementById("tilePresetW");
  const tileH = document.getElementById("tilePresetH");
  const groutW = document.getElementById("tilePresetGroutW");
  const groutColor = document.getElementById("tilePresetGroutColor");
  const pricePerM2 = document.getElementById("tilePresetPricePerM2");
  const packM2 = document.getElementById("tilePresetPackM2");
  const pricePerPack = document.getElementById("tilePresetPricePerPack");
  const useSkirting = document.getElementById("tilePresetUseSkirting");
  const roomList = document.getElementById("tilePresetRoomList");
  const addTile = document.getElementById("btnAddTilePreset");
  const delTile = document.getElementById("btnDeleteTilePreset");
  const tilePresetDeleteWarning = document.getElementById("tilePresetDeleteWarning");
  const tilePresetDeleteWarningText = document.getElementById("tilePresetDeleteWarningText");
  const tilePresetDeleteConfirm = document.getElementById("btnConfirmDeleteTilePreset");
  const tilePresetDeleteCancel = document.getElementById("btnCancelDeleteTilePreset");

  const skirtList = document.getElementById("skirtingPresetList");
  const skirtName = document.getElementById("skirtingPresetName");
  const skirtHeight = document.getElementById("skirtingPresetHeight");
  const skirtLength = document.getElementById("skirtingPresetLength");
  const skirtPrice = document.getElementById("skirtingPresetPrice");
  const addSkirt = document.getElementById("btnAddSkirtingPreset");
  const delSkirt = document.getElementById("btnDeleteSkirtingPreset");

  let pendingTilePresetDelete = null;
  const hideTilePresetDeleteWarning = () => {
    pendingTilePresetDelete = null;
    tilePresetDeleteWarning?.classList.add("hidden");
    if (tilePresetDeleteWarningText) tilePresetDeleteWarningText.textContent = "";
  };

  const applyTilePresetDelete = (next, presetName, roomsUsingPreset) => {
    if (!roomsUsingPreset?.length) return;
    const roomIdSet = new Set(roomsUsingPreset);
    next.floors?.forEach(floor => {
      floor.rooms?.forEach(room => {
        if (roomIdSet.has(room.id)) {
          room.tile.reference = "";
          room.tile.shape = "rect";
          room.tile.widthCm = 0;
          room.tile.heightCm = 0;
        }
      });
    });
    if (presetName && next.materials?.[presetName]) {
      delete next.materials[presetName];
    }
  };

  if (tileList) {
    tileList.addEventListener("change", (e) => {
      selectedTilePresetId = e.target.value || null;
      hideTilePresetDeleteWarning();
      renderAll();
    });
  }
  if (skirtList) {
    skirtList.addEventListener("change", (e) => {
      selectedSkirtingPresetId = e.target.value || null;
      renderAll();
    });
  }

  addTile?.addEventListener("click", () => {
    const next = deepClone(store.getState());
    const room = getCurrentRoom(next);
    const defaults = getDefaultTilePresetTemplate(next);
    const base = room?.tile && room.tile.widthCm > 0 && room.tile.heightCm > 0
      ? room.tile
      : defaults;
    const grout = room?.grout || { widthCm: defaults.groutWidthCm, colorHex: defaults.groutColorHex };
    const pricing = room ? getRoomPricing(next, room) : getDefaultPricing(next);
    const preset = {
      id: uuid(),
      name: `${t("tile.preset")} ${next.tilePresets.length + 1}`,
      shape: base.shape || defaults.shape || "rect",
      widthCm: Number(base.widthCm) || defaults.widthCm || 0,
      heightCm: Number(base.heightCm) || defaults.heightCm || 0,
      groutWidthCm: Number(grout.widthCm) || defaults.groutWidthCm || 0,
      groutColorHex: grout.colorHex || defaults.groutColorHex || "#ffffff",
      pricePerM2: Number(pricing.pricePerM2) || 0,
      packM2: Number(pricing.packM2) || 0,
      useForSkirting: Boolean(defaults.useForSkirting)
    };
    next.tilePresets.push(preset);
    selectedTilePresetId = preset.id;
    commitViaStore(t("tile.presetAdded"), next);
  });

  delTile?.addEventListener("click", () => {
    if (!selectedTilePresetId) return;
    const next = deepClone(store.getState());
    const preset = next.tilePresets.find(p => p.id === selectedTilePresetId);
    const presetName = preset?.name || "";
    const roomsUsingPreset = [];
    if (presetName) {
      next.floors?.forEach(floor => {
        floor.rooms?.forEach(room => {
          if (room.tile?.reference === presetName) roomsUsingPreset.push(room.id);
        });
      });
    }

    if (roomsUsingPreset.length > 0) {
      pendingTilePresetDelete = { id: selectedTilePresetId, name: presetName, rooms: roomsUsingPreset };
      if (tilePresetDeleteWarningText) {
        tilePresetDeleteWarningText.textContent =
          `${t("tile.presetDeleteWarn")} ${roomsUsingPreset.length} ${t("tile.presetDeleteWarnTail")}`;
      }
      tilePresetDeleteWarning?.classList.remove("hidden");
      return;
    }

    next.tilePresets = next.tilePresets.filter(p => p.id !== selectedTilePresetId);
    selectedTilePresetId = next.tilePresets.at(-1)?.id ?? null;
    commitViaStore(t("tile.presetDeleted"), next);
  });

  tilePresetDeleteConfirm?.addEventListener("click", () => {
    if (!pendingTilePresetDelete?.id) return;
    const next = deepClone(store.getState());
    const { id, name, rooms } = pendingTilePresetDelete;
    applyTilePresetDelete(next, name, rooms);
    next.tilePresets = next.tilePresets.filter(p => p.id !== id);
    selectedTilePresetId = next.tilePresets.at(-1)?.id ?? null;
    hideTilePresetDeleteWarning();
    commitViaStore(t("tile.presetDeleted"), next);
  });

  tilePresetDeleteCancel?.addEventListener("click", () => {
    hideTilePresetDeleteWarning();
  });

  const commitTilePreset = () => {
    if (!selectedTilePresetId) return;
    const next = deepClone(store.getState());
    const p = next.tilePresets.find(x => x.id === selectedTilePresetId);
    if (!p) return;
    const prevName = p.name;
    if (tileName) p.name = tileName.value ?? p.name;
    if (tileShape) p.shape = tileShape.value || p.shape;
    if (tileW) p.widthCm = Number(tileW.value);
    if (tileH) p.heightCm = Number(tileH.value);
    if (groutW) p.groutWidthCm = Number(groutW.value) / 10;
    if (groutColor) p.groutColorHex = groutColor.value || p.groutColorHex;
    if (pricePerM2) p.pricePerM2 = Number(pricePerM2.value);
    if (packM2) p.packM2 = Number(packM2.value);
    const prevUseForSkirting = Boolean(p.useForSkirting);
    if (useSkirting) p.useForSkirting = Boolean(useSkirting.checked);

    if (prevName && p.name && prevName !== p.name) {
      next.floors?.forEach(floor => {
        floor.rooms?.forEach(room => {
          if (room.tile?.reference === prevName) room.tile.reference = p.name;
        });
      });
      if (next.materials?.[prevName] && !next.materials[p.name]) {
        next.materials[p.name] = next.materials[prevName];
        delete next.materials[prevName];
      }
    }

    if (!prevUseForSkirting && p.useForSkirting && p.name) {
      enforceCutoutForPresetRooms(next, p.name);
    }

    commitViaStore(t("tile.presetChanged"), next);
  };

  [tileName, tileW, tileH, groutW, pricePerM2, packM2].forEach(el => {
    el?.addEventListener("blur", commitTilePreset);
  });
  tileShape?.addEventListener("change", commitTilePreset);
  groutColor?.addEventListener("change", commitTilePreset);
  useSkirting?.addEventListener("change", commitTilePreset);
  pricePerPack?.addEventListener("change", () => {
    const pack = Number(packM2?.value);
    const price = Number(pricePerPack.value);
    if (!Number.isFinite(pack) || pack <= 0) return;
    if (!Number.isFinite(price)) return;
    if (pricePerM2) pricePerM2.value = (price / pack).toFixed(2);
    commitTilePreset();
  });

  roomList?.addEventListener("change", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (!target.dataset.roomId) return;
    if (!selectedTilePresetId) return;
    const next = deepClone(store.getState());
    const preset = next.tilePresets.find(x => x.id === selectedTilePresetId);
    if (!preset || !preset.name) return;

    let room = null;
    next.floors?.forEach(floor => {
      floor.rooms?.forEach(r => {
        if (r.id === target.dataset.roomId) room = r;
      });
    });
    if (!room) return;

    if (target.checked) {
      room.tile.shape = preset.shape || room.tile.shape;
      room.tile.widthCm = Number(preset.widthCm) || room.tile.widthCm;
      room.tile.heightCm = Number(preset.heightCm) || room.tile.heightCm;
      room.tile.reference = preset.name || room.tile.reference;
      room.grout.widthCm = Number(preset.groutWidthCm) || 0;
      room.grout.colorHex = preset.groutColorHex || room.grout.colorHex;
      if (preset.useForSkirting) {
        room.skirting.enabled = true;
        room.skirting.type = "cutout";
      }
      if (preset.name) {
        next.materials = next.materials || {};
        next.materials[preset.name] = next.materials[preset.name] || {
          pricePerM2: next.pricing?.pricePerM2 || 0,
          packM2: next.pricing?.packM2 || 0
        };
        if (Number.isFinite(preset.pricePerM2)) next.materials[preset.name].pricePerM2 = Number(preset.pricePerM2);
        if (Number.isFinite(preset.packM2)) next.materials[preset.name].packM2 = Number(preset.packM2);
      }
    } else if (room.tile?.reference === preset.name) {
      room.tile.reference = "";
    }

    commitViaStore(t("tile.presetChanged"), next);
  });

  addSkirt?.addEventListener("click", () => {
    const next = deepClone(store.getState());
    const room = getCurrentRoom(next);
    const base = room?.skirting || {};
    const preset = {
      id: uuid(),
      name: `${t("skirting.preset")} ${next.skirtingPresets.length + 1}`,
      heightCm: Number(base.heightCm) || DEFAULT_SKIRTING_PRESET.heightCm,
      lengthCm: Number(base.boughtWidthCm) || DEFAULT_SKIRTING_PRESET.lengthCm,
      pricePerPiece: Number(base.boughtPricePerPiece) || DEFAULT_SKIRTING_PRESET.pricePerPiece
    };
    next.skirtingPresets.push(preset);
    selectedSkirtingPresetId = preset.id;
    commitViaStore(t("skirting.presetAdded"), next);
  });

  delSkirt?.addEventListener("click", () => {
    if (!selectedSkirtingPresetId) return;
    const next = deepClone(store.getState());
    next.skirtingPresets = next.skirtingPresets.filter(p => p.id !== selectedSkirtingPresetId);
    selectedSkirtingPresetId = next.skirtingPresets.at(-1)?.id ?? null;
    commitViaStore(t("skirting.presetDeleted"), next);
  });

  const commitSkirtingPreset = () => {
    if (!selectedSkirtingPresetId) return;
    const next = deepClone(store.getState());
    const p = next.skirtingPresets.find(x => x.id === selectedSkirtingPresetId);
    if (!p) return;
    if (skirtName) p.name = skirtName.value ?? p.name;
    if (skirtHeight) p.heightCm = Number(skirtHeight.value);
    if (skirtLength) p.lengthCm = Number(skirtLength.value);
    if (skirtPrice) p.pricePerPiece = Number(skirtPrice.value);
    commitViaStore(t("skirting.presetChanged"), next);
  };

  [skirtName, skirtHeight, skirtLength, skirtPrice].forEach(el => {
    el?.addEventListener("blur", commitSkirtingPreset);
  });
}

function updateAllTranslations() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    const text = t(key);
    if (el.tagName === "INPUT" && el.type !== "checkbox" && el.type !== "radio") {
      return;
    }
    el.textContent = text;
  });

  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    el.placeholder = t(key);
  });

  renderAll();
}

(function main() {
  const hadSession = store.loadSessionIfAny();
  store.autosaveSession(updateMeta);

  initMainTabs();
  initFullscreen(dragController, renderAll);

  // Initialize zoom/pan controller
  zoomPanController.attach();

  bindUI({
    store,
    excl,
    sections,
    renderAll,
    refreshProjectSelect,
    updateMeta,
    validateState,
    defaultStateFn: defaultState,
    setSelectedExcl,
    setSelectedSection,
    resetErrors: () => {
      lastUnionError = null;
      lastTileError = null;
    }
  });
  bindPresetCollection();

  document.getElementById("floorSelect")?.addEventListener("change", (e) => {
    structure.selectFloor(e.target.value);
  });

  document.getElementById("roomSelect")?.addEventListener("change", (e) => {
    structure.selectRoom(e.target.value);
  });

  document.getElementById("floorName")?.addEventListener("change", () => {
    structure.commitFloorName();
  });

  document.getElementById("btnAddFloor")?.addEventListener("click", () => {
    structure.addFloor();
  });

  document.getElementById("btnDeleteFloor")?.addEventListener("click", () => {
    structure.deleteFloor();
  });

  document.getElementById("btnAddRoom")?.addEventListener("click", () => {
    structure.addRoom();
  });

  document.getElementById("btnDeleteRoom")?.addEventListener("click", () => {
    structure.deleteRoom();
  });

  document.addEventListener("click", (e) => {
    if (isInlineEditing()) return;
    const inPlan = e.target.closest("#planSvg, #planSvgFullscreen");
    if (!inPlan) return;
    const inInteractive = e.target.closest("[data-exid], [data-secid], [data-resize-handle], [data-inline-edit], [data-add-btn]");
    if (inInteractive) return;
    setSelectedExcl(null);
  });

  document.addEventListener("keydown", (e) => {
    if (isInlineEditing()) return;
    if (!selectedExclId) return;
    const step = e.shiftKey ? 5 : 0.1;
    let dx = 0;
    let dy = 0;
    if (e.key === "ArrowLeft") dx = -step;
    if (e.key === "ArrowRight") dx = step;
    if (e.key === "ArrowUp") dy = -step;
    if (e.key === "ArrowDown") dy = step;
    if (dx === 0 && dy === 0) return;
    e.preventDefault();
    nudgeSelectedExclusion(dx, dy);
  });

  document.addEventListener("keydown", (e) => {
    if (isInlineEditing()) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target;
    if (target?.isContentEditable) return;
    const tag = target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (e.key !== "s" && e.key !== "S") return;
    e.preventDefault();

    const state = store.getState();
    const room = getCurrentRoom(state);
    if (!room) return;

    if (selectedExclId) {
      const ex = room.exclusions?.find(x => x.id === selectedExclId);
      if (!ex) return;
      setExclusionSkirtingEnabled(selectedExclId, ex.skirtingEnabled === false);
      return;
    }

    if (selectedSectionId) {
      const sec = room.sections?.find(s => s.id === selectedSectionId);
      if (!sec) return;
      setSectionSkirtingEnabled(selectedSectionId, sec.skirtingEnabled === false);
      return;
    }

    setRoomSkirtingEnabled(room.skirting?.enabled === false);
  });

  const langSelect = document.getElementById("langSelect");
  if (langSelect) {
    langSelect.value = getLanguage();
    langSelect.addEventListener("change", () => {
      setLanguage(langSelect.value);
      updateAllTranslations();
    });
  }

  // Settings menu toggle
  const settingsToggle = document.getElementById("btnSettingsToggle");
  const settingsDropdown = document.getElementById("settingsDropdown");
  if (settingsToggle && settingsDropdown) {
    settingsToggle.addEventListener("click", (e) => {
      e.stopPropagation();
      settingsDropdown.classList.toggle("hidden");
    });

    document.addEventListener("click", (e) => {
      if (!settingsDropdown.contains(e.target) && e.target !== settingsToggle) {
        settingsDropdown.classList.add("hidden");
      }
    });

    // Settings menu actions
    document.getElementById("menuSaveProject")?.addEventListener("click", () => {
      settingsDropdown.classList.add("hidden");
      const state = store.getState();
      const name = prompt(t("project.nameLabel"), state.project?.name || "");
      if (!name) return;
      store.saveCurrentAsProject(name);
      store.autosaveSession(updateMeta);
      renderAll(t("project.saved"));
    });

    document.getElementById("menuLoadProject")?.addEventListener("click", () => {
      settingsDropdown.classList.add("hidden");
      const projects = store.loadProjects();
      if (projects.length === 0) {
        alert(t("project.none"));
        return;
      }
      const names = projects.map((p, i) => `${i + 1}. ${p.name}`).join("\n");
      const choice = prompt(`${t("project.load")}:\n${names}\n\nEnter number:`, "1");
      if (choice) {
        const idx = parseInt(choice, 10) - 1;
        if (idx >= 0 && idx < projects.length) {
          const proj = projects[idx];
          const res = store.loadProjectById(proj.id);
          if (!res.ok) {
            alert(t("project.notFound"));
            return;
          }
          setSelectedExcl(null);
          setSelectedSection(null);
          lastUnionError = null;
          lastTileError = null;
          renderAll(`${t("project.loaded")}: ${res.name}`);
        }
      }
    });

    document.getElementById("menuExport")?.addEventListener("click", () => {
      settingsDropdown.classList.add("hidden");
      document.getElementById("btnExport")?.click();
    });

    document.getElementById("menuImport")?.addEventListener("click", () => {
      settingsDropdown.classList.add("hidden");
      document.getElementById("fileImport")?.click();
    });

    document.getElementById("menuDebug")?.addEventListener("click", () => {
      settingsDropdown.classList.add("hidden");
      const debugPanel = document.getElementById("debugPanel");
      if (!debugPanel) return;
      debugPanel.classList.toggle("hidden");
    });

    document.getElementById("btnCloseDebug")?.addEventListener("click", () => {
      document.getElementById("debugPanel")?.classList.add("hidden");
    });

    document.getElementById("menuReset")?.addEventListener("click", () => {
      settingsDropdown.classList.add("hidden");
      if (confirm(t("session.confirmReset"))) {
        setSelectedExcl(null);
        setSelectedSection(null);
        lastUnionError = null;
        lastTileError = null;
        store.commit(t("session.reset"), defaultState(), {
          onRender: renderAll,
          updateMetaCb: updateMeta
        });
      }
    });
  }

  const openWarningsPanel = () => {
    document.getElementById("warningsPanel")?.classList.remove("hidden");
  };
  const openTipsPanel = () => {
    document.getElementById("tipsPanel")?.classList.remove("hidden");
  };

  document.getElementById("warningsWrapper")?.addEventListener("click", openWarningsPanel);
  document.getElementById("tipsWrapper")?.addEventListener("click", openTipsPanel);
  document.getElementById("btnCloseWarnings")?.addEventListener("click", () => {
    document.getElementById("warningsPanel")?.classList.add("hidden");
  });
  document.getElementById("btnCloseTips")?.addEventListener("click", () => {
    document.getElementById("tipsPanel")?.classList.add("hidden");
  });

  // Continue to Planning button
  document.getElementById("btnContinuePlanning")?.addEventListener("click", () => {
    const planningTab = document.querySelector('[data-main-tab="planning"]');
    if (planningTab) {
      planningTab.click();
    }
  });

  // Planning Settings Panel Toggle
  const settingsPanel = document.getElementById("settingsPanel");
  const btnCloseSettings = document.getElementById("btnCloseSettings");
  const quickOpenSettings = document.getElementById("quickOpenSettings");
  const quickCreateTilePreset = document.getElementById("quickCreateTilePreset");
  const setSettingsPanelOpen = (open) => {
    if (!settingsPanel) return;
    settingsPanel.classList.toggle("hidden", !open);
    if (quickOpenSettings) quickOpenSettings.classList.toggle("active", open);
  };

  if (settingsPanel && btnCloseSettings) {
    btnCloseSettings.addEventListener("click", () => {
      setSettingsPanelOpen(false);
    });

    // Close on click outside
    document.addEventListener("click", (e) => {
      if (!settingsPanel.classList.contains("hidden") &&
          !settingsPanel.contains(e.target) &&
          e.target !== quickOpenSettings &&
          !(quickOpenSettings && quickOpenSettings.contains(e.target)) &&
          e.target !== quickCreateTilePreset &&
          !(quickCreateTilePreset && quickCreateTilePreset.contains(e.target))) {
        setSettingsPanelOpen(false);
      }
    });
  }

  if (quickOpenSettings) {
    quickOpenSettings.addEventListener("click", () => {
      const isOpen = settingsPanel && !settingsPanel.classList.contains("hidden");
      setSettingsPanelOpen(!isOpen);
    });
  }

  if (quickCreateTilePreset) {
    quickCreateTilePreset.addEventListener("click", () => {
      setSettingsPanelOpen(true);
      document.getElementById("planningTileSection")?.scrollIntoView({ behavior: "smooth", block: "start" });
      const state = store.getState();
      const hasPresets = (state.tilePresets?.length || 0) > 0;
      if (!hasPresets) {
        document.getElementById("btnCreateTilePreset")?.click();
      }
    });
  }

  // Export UI
  const exportRoomsList = document.getElementById("exportRoomsList");
  exportRoomsList?.addEventListener("change", () => {
    updateExportSelectionFromList();
    renderAll(t("export.selectionChanged"), { scope: RenderScope.EXPORT });
  });

  document.getElementById("exportSelectAllRooms")?.addEventListener("click", () => {
    document.querySelectorAll("#exportRoomsList input[type=\"checkbox\"][data-room-id]").forEach((input) => {
      input.checked = true;
    });
    updateExportSelectionFromList();
    renderAll(t("export.selectionChanged"), { scope: RenderScope.EXPORT });
  });

  document.getElementById("exportClearRooms")?.addEventListener("click", () => {
    document.querySelectorAll("#exportRoomsList input[type=\"checkbox\"][data-room-id]").forEach((input) => {
      input.checked = false;
    });
    updateExportSelectionFromList();
    renderAll(t("export.selectionChanged"), { scope: RenderScope.EXPORT });
  });

  document.getElementById("btnExportRoomsPdf")?.addEventListener("click", async () => {
    updateExportSelectionFromList();
    const options = getExportOptionsFromUi();
    if (!options.roomIds.length) {
      setExportStatus(t("export.noRoomsSelected"), true);
      return;
    }

    toggleExportProgress(true);
    setExportStatus(t("export.exporting"));
    try {
      await exportRoomsPdf(store.getState(), options, ({ current, total }) => {
        setExportProgress(current, total);
        setExportStatus(t("export.exportingRoom").replace("{0}", String(current)).replace("{1}", String(total)));
      });
      setExportStatus(t("export.success"));
    } catch (err) {
      console.error("Export failed:", err);
      setExportStatus(`${t("export.error")}: ${err.message}`, true);
    } finally {
      toggleExportProgress(false);
    }
  });

  document.getElementById("btnExportCommercialPdf")?.addEventListener("click", async () => {
    try {
      await exportCommercialPdf(store.getState(), getExportOptionsFromUi());
      setExportStatus(t("export.success"));
    } catch (err) {
      console.error("Export failed:", err);
      setExportStatus(`${t("export.error")}: ${err.message}`, true);
    }
  });

  document.getElementById("btnExportCommercialXlsx")?.addEventListener("click", async () => {
    try {
      await exportCommercialXlsx(store.getState(), getExportOptionsFromUi());
      setExportStatus(t("export.success"));
    } catch (err) {
      console.error("Export failed:", err);
      setExportStatus(`${t("export.error")}: ${err.message}`, true);
    }
  });

  // Planning Floor Selector
  const planningFloorSelect = document.getElementById("planningFloorSelect");
  if (planningFloorSelect) {
    planningFloorSelect.addEventListener("change", (e) => {
      structure.selectFloor(e.target.value);
    });
  }

  // Planning Room Selector
  const planningRoomSelect = document.getElementById("planningRoomSelect");
  if (planningRoomSelect) {
    planningRoomSelect.addEventListener("change", (e) => {
      structure.selectRoom(e.target.value);
    });
  }

  // Quick Controls
  const quickTilePreset = document.getElementById("quickTilePreset");
  const quickPattern = document.getElementById("quickPattern");
  const quickGrout = document.getElementById("quickGrout");
  const quickRemovalMode = document.getElementById("quickRemovalMode");

  // Quick toggle event handlers
  wireQuickViewToggleHandlers();

  const syncRemovalCheckboxes = (checked) => {
    const mainRemovalMode = document.getElementById("removalMode");
    if (mainRemovalMode) mainRemovalMode.checked = checked;
    if (quickRemovalMode) quickRemovalMode.checked = checked;
  };

  quickRemovalMode?.addEventListener("change", (e) => {
    const checked = Boolean(e.target.checked);
    syncRemovalCheckboxes(checked);
    removal.setRemovalMode(checked);
  });

  document.getElementById("removalMode")?.addEventListener("change", (e) => {
    const checked = Boolean(e.target.checked);
    syncRemovalCheckboxes(checked);
    removal.setRemovalMode(checked);
  });

  // Exclusion dropdown
  const quickAddExclusion = document.getElementById("quickAddExclusion");
  const exclDropdown = document.getElementById("exclDropdown");

  quickAddExclusion?.addEventListener("click", (e) => {
    e.stopPropagation();
    exclDropdown?.classList.toggle("hidden");
  });

  // Close dropdown when clicking outside
  document.addEventListener("click", (e) => {
    if (exclDropdown && !exclDropdown.classList.contains("hidden") &&
        !exclDropdown.contains(e.target) &&
        e.target !== quickAddExclusion) {
      exclDropdown.classList.add("hidden");
    }
  });

  // Exclusion dropdown items
  document.querySelectorAll(".quick-dropdown-item[data-excl-type]").forEach(item => {
    item.addEventListener("click", () => {
      const type = item.dataset.exclType;
      exclDropdown?.classList.add("hidden");

      if (type === "rect") {
        excl.addRect();
      } else if (type === "circle") {
        excl.addCircle();
      } else if (type === "triangle") {
        excl.addTri();
      }
    });
  });

  // Zoom controls
  document.getElementById("zoomIn")?.addEventListener("click", () => {
    zoomPanController.zoomIn();
  });
  document.getElementById("zoomOut")?.addEventListener("click", () => {
    zoomPanController.zoomOut();
  });
  document.getElementById("zoomReset")?.addEventListener("click", () => {
    zoomPanController.reset();
  });

  function syncQuickControls() {
    const state = store.getState();
    const room = state.floors
      ?.find(f => f.id === state.selectedFloorId)
      ?.rooms?.find(r => r.id === state.selectedRoomId);

    if (room) {
      if (quickTilePreset) {
        quickTilePreset.innerHTML = "";
        const presets = state.tilePresets || [];
        presets.forEach(p => {
          const opt = document.createElement("option");
          opt.value = p.id;
          opt.textContent = p.name || t("project.none");
          quickTilePreset.appendChild(opt);
        });
        const match = presets.find(p => p.name && p.name === room.tile?.reference);
        quickTilePreset.value = match ? match.id : (presets[0]?.id || "");
        quickTilePreset.disabled = presets.length === 0;
        const quickGroup = document.getElementById("quickTilePresetGroup");
        if (quickGroup) quickGroup.classList.toggle("no-presets", presets.length === 0);
        const quickCreate = document.getElementById("quickCreateTilePreset");
        if (quickCreate) quickCreate.classList.toggle("hidden", presets.length > 0);
        quickTilePreset.classList.toggle("hidden", presets.length === 0);
      }
      if (quickPattern) quickPattern.value = room.pattern?.type || "grid";
      // Display grout in mm (state stores cm)
      if (quickGrout) quickGrout.value = Math.round((room.grout?.widthCm || 0) * 10);
    }

    // Sync quick toggles with main toggles
    const mainRemovalMode = document.getElementById("removalMode");
    syncQuickViewToggleStates();
    if (quickRemovalMode && mainRemovalMode) quickRemovalMode.checked = mainRemovalMode.checked;

    // Sync planning floor selector
    if (planningFloorSelect) {
      planningFloorSelect.innerHTML = "";
      state.floors?.forEach(f => {
        const opt = document.createElement("option");
        opt.value = f.id;
        opt.textContent = f.name || "Untitled";
        if (f.id === state.selectedFloorId) opt.selected = true;
        planningFloorSelect.appendChild(opt);
      });
    }

    // Sync planning room selector
    if (planningRoomSelect) {
      const floor = state.floors?.find(f => f.id === state.selectedFloorId);
      planningRoomSelect.innerHTML = "";
      floor?.rooms?.forEach(r => {
        const opt = document.createElement("option");
        opt.value = r.id;
        opt.textContent = r.name || "Untitled";
        if (r.id === state.selectedRoomId) opt.selected = true;
        planningRoomSelect.appendChild(opt);
      });
    }

    // Update area display
    const planningArea = document.getElementById("planningArea");
    if (planningArea && room) {
      const sections = room.sections || [];
      let totalArea = 0;
      if (sections.length > 0) {
        sections.forEach(s => {
          totalArea += (s.widthCm || 0) * (s.heightCm || 0) / 10000;
        });
      } else {
        // Legacy: use room dimensions directly
        totalArea = (room.widthCm || 0) * (room.heightCm || 0) / 10000;
      }
      planningArea.textContent = totalArea.toFixed(2) + " m²";
    }
  }

  function enhanceNumberSpinners() {
    document.querySelectorAll('input[type="number"]').forEach(input => {
      if (input.dataset.spinner === "true") return;
      if (input.closest(".quick-spinner")) {
        input.classList.add("spinner-input");
        input.dataset.spinner = "true";
        return;
      }

      const wrapper = document.createElement("div");
      wrapper.className = "quick-spinner";

      const dec = document.createElement("button");
      dec.type = "button";
      dec.className = "quick-spinner-btn";
      dec.textContent = "−";

      const inc = document.createElement("button");
      inc.type = "button";
      inc.className = "quick-spinner-btn";
      inc.textContent = "+";

      const stepValue = () => {
        const step = parseFloat(input.step);
        return Number.isFinite(step) && step > 0 ? step : 1;
      };
      const minValue = () => {
        if (input.min === "") return null;
        const min = parseFloat(input.min);
        return Number.isFinite(min) ? min : null;
      };

      const applyDelta = (dir) => {
        let value = parseFloat(input.value);
        if (!Number.isFinite(value)) value = 0;
        value += dir * stepValue();
        const min = minValue();
        if (min !== null) value = Math.max(min, value);
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      };

      dec.addEventListener("click", () => applyDelta(-1));
      inc.addEventListener("click", () => applyDelta(1));

      input.classList.add("no-spinner", "spinner-input");
      input.dataset.spinner = "true";

      input.replaceWith(wrapper);
      wrapper.appendChild(dec);
      wrapper.appendChild(input);
      wrapper.appendChild(inc);
    });
  }

  // Update zoom indicator
  function updateZoomIndicator() {
    const state = store.getState();
    const vp = getViewport(state.selectedRoomId);
    const zoomLevel = document.getElementById("zoomLevel");
    if (zoomLevel) {
      zoomLevel.textContent = `${Math.round(vp.zoom * 100)}%`;
    }
  }

  // Register the sync function as the post-render hook
  afterRenderHook = () => {
    syncDimensionsFromState();
    syncQuickControls();
    enhanceNumberSpinners();
    updateZoomIndicator();
  };

  function commitQuickTilePreset() {
    const presetId = quickTilePreset?.value;
    if (!presetId) return;
    const state = store.getState();
    const preset = state.tilePresets?.find(p => p.id === presetId);
    if (!preset) return;
    const floorIdx = state.floors?.findIndex(f => f.id === state.selectedFloorId);
    const roomIdx = state.floors?.[floorIdx]?.rooms?.findIndex(r => r.id === state.selectedRoomId);
    if (floorIdx < 0 || roomIdx < 0) return;

    const next = JSON.parse(JSON.stringify(state));
    const room = next.floors[floorIdx].rooms[roomIdx];
    room.tile.shape = preset.shape || room.tile.shape;
    room.tile.widthCm = Number(preset.widthCm) || room.tile.widthCm;
    room.tile.heightCm = Number(preset.heightCm) || room.tile.heightCm;
    room.tile.reference = preset.name || room.tile.reference;
    room.grout.widthCm = Number(preset.groutWidthCm) || 0;
    room.grout.colorHex = preset.groutColorHex || room.grout.colorHex;
    if (preset.useForSkirting) {
      room.skirting.enabled = true;
      room.skirting.type = "cutout";
    }
    const ref = room.tile.reference;
    if (ref) {
      next.materials = next.materials || {};
      next.materials[ref] = next.materials[ref] || {
        pricePerM2: next.pricing?.pricePerM2 || 0,
        packM2: next.pricing?.packM2 || 0
      };
      if (Number.isFinite(preset.pricePerM2)) next.materials[ref].pricePerM2 = Number(preset.pricePerM2);
      if (Number.isFinite(preset.packM2)) next.materials[ref].packM2 = Number(preset.packM2);
    }
    commitViaStore(t("tile.changed"), next);
  }

  function commitQuickPattern() {
    const state = store.getState();
    const floorIdx = state.floors?.findIndex(f => f.id === state.selectedFloorId);
    const roomIdx = state.floors?.[floorIdx]?.rooms?.findIndex(r => r.id === state.selectedRoomId);
    if (floorIdx < 0 || roomIdx < 0) return;

    const next = JSON.parse(JSON.stringify(state));
    next.floors[floorIdx].rooms[roomIdx].pattern.type = quickPattern?.value || "grid";
    commitViaStore(t("tile.patternChanged"), next);
  }

  function commitQuickGrout() {
    const state = store.getState();
    const floorIdx = state.floors?.findIndex(f => f.id === state.selectedFloorId);
    const roomIdx = state.floors?.[floorIdx]?.rooms?.findIndex(r => r.id === state.selectedRoomId);
    if (floorIdx < 0 || roomIdx < 0) return;

    // Convert mm input to cm for state
    const newGmm = parseFloat(quickGrout?.value) || 0;
    if (newGmm < 0) return;
    const newGcm = newGmm / 10;

    const next = JSON.parse(JSON.stringify(state));
    next.floors[floorIdx].rooms[roomIdx].grout.widthCm = newGcm;
    commitViaStore(t("tile.changed"), next);
  }

  quickTilePreset?.addEventListener("change", commitQuickTilePreset);
  quickPattern?.addEventListener("change", commitQuickPattern);
  quickGrout?.addEventListener("change", commitQuickGrout);

  // Spinner button handlers
  document.querySelectorAll(".quick-spinner-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const targetId = btn.dataset.target;
      const action = btn.dataset.action;
      const input = document.getElementById(targetId);
      if (!input) return;

      const step = parseFloat(input.step) || 1;
      const min = parseFloat(input.min) || 0;
      let value = parseFloat(input.value) || 0;

      if (action === "increment") {
        value += step;
      } else if (action === "decrement") {
        value = Math.max(min, value - step);
      }

      input.value = value;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  });

  // Room dimensions (sync with first section)
  const roomWidthInput = document.getElementById("roomWidth");
  const roomLengthInput = document.getElementById("roomLength");

  function syncDimensionsFromState() {
    const state = store.getState();
    const room = state.floors
      ?.find(f => f.id === state.selectedFloorId)
      ?.rooms?.find(r => r.id === state.selectedRoomId);

    if (room?.sections?.length > 0) {
      const firstSection = room.sections[0];
      if (roomWidthInput) roomWidthInput.value = firstSection.widthCm || "";
      if (roomLengthInput) roomLengthInput.value = firstSection.heightCm || "";
    }

    // Show/hide sections panel based on count
    const sectionsPanel = document.getElementById("sectionsPanel");
    const sectionsHint = document.getElementById("sectionsHint");
    if (room?.sections?.length > 1) {
      sectionsPanel?.classList.remove("hidden");
      if (sectionsHint) sectionsHint.style.display = "none";
    } else {
      sectionsPanel?.classList.add("hidden");
      if (sectionsHint) sectionsHint.style.display = "";
    }
  }

  function commitDimensions() {
    const state = store.getState();
    const floorIdx = state.floors?.findIndex(f => f.id === state.selectedFloorId);
    const roomIdx = state.floors?.[floorIdx]?.rooms?.findIndex(r => r.id === state.selectedRoomId);

    if (floorIdx < 0 || roomIdx < 0) return;

    const room = state.floors[floorIdx].rooms[roomIdx];
    if (!room.sections?.length) return;

    const newW = parseFloat(roomWidthInput?.value) || 0;
    const newH = parseFloat(roomLengthInput?.value) || 0;

    if (newW <= 0 || newH <= 0) return;

    const next = JSON.parse(JSON.stringify(state));
    next.floors[floorIdx].rooms[roomIdx].sections[0].widthCm = newW;
    next.floors[floorIdx].rooms[roomIdx].sections[0].heightCm = newH;

    commitViaStore(t("room.changed"), next);
  }

  roomWidthInput?.addEventListener("change", commitDimensions);
  roomLengthInput?.addEventListener("change", commitDimensions);

  // Alternative add section button
  document.getElementById("btnAddSectionAlt")?.addEventListener("click", () => {
    sections.addSection();
  });

  updateAllTranslations();
  renderAll(hadSession ? t("init.withSession") : t("init.default"));
})();
