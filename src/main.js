// src/main.js
import "./style.css";
import { computePlanMetrics } from "./calc.js";
import { validateState } from "./validation.js";
import { LS_SESSION, defaultState } from "./core.js";
import { createStateStore } from "./state.js";
import { createExclusionDragController } from "./drag.js";
import { createExclusionsController } from "./exclusions.js";
import { createSectionsController } from "./sections.js";
import { bindUI } from "./ui.js";
import { t, setLanguage, getLanguage } from "./i18n.js";
import { initTabs, initMainTabs } from "./tabs.js";
import { initResize } from "./resize.js";
import { initFullscreen } from "./fullscreen.js";
import { initCollapse } from "./collapse.js";

import {
  renderWarnings,
  renderMetrics,
  renderStateView,
  renderCounts,
  renderRoomForm,
  renderTilePatternForm,
  renderExclList,
  renderExclProps,
  renderPlanSvg,
  renderSectionsList,
  renderSectionProps,
  renderCommercialTab
} from "./render.js";
import { createStructureController } from "./structure.js";
import { createRemovalController } from "./removal.js";

// Store
const store = createStateStore(defaultState, validateState);
window.__fpStore = store; // keep for console testing

let selectedExclId = null;
let selectedSectionId = null;
let lastUnionError = null;
let lastTileError = null;

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
  selectedExclId = id || null;
  renderAll();
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

function renderAll(lastLabel, options) {
  let opts = options || {};
  let label = lastLabel;
  if (lastLabel && typeof lastLabel === "object") {
    opts = lastLabel;
    label = undefined;
  }
  const isDrag = opts.mode === "drag";

  try {
    const state = store.getState();

    structure.renderFloorSelect();
    structure.renderFloorName();
    structure.renderRoomSelect();
    renderRoomForm(state);
    renderTilePatternForm(state);

    renderSectionsList(state, selectedSectionId);
    renderSectionProps({
      state,
      selectedSectionId,
      getSelectedSection: sections.getSelectedSection,
      commitSectionProps: sections.commitSectionProps
    });

    renderCommercialTab(state);

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
      lastUnionError,
      lastTileError,
      setLastUnionError: (v) => (lastUnionError = v),
      setLastTileError: (v) => (lastTileError = v),
      metrics,
      skipTiles: isDrag
    });

    renderStateView(state);
    renderCounts(store.getUndoStack(), store.getRedoStack(), label);

    refreshProjectSelect();
    updateMeta();
  } catch (error) {
    console.error("Render failed:", error);
    const errorDiv = document.getElementById("warnings");
    if (errorDiv) {
      const div = document.createElement("div");
      div.className = "warnItem";
      div.style.border = "2px solid rgba(255,107,107,0.5)";
      div.innerHTML = `<div class="wTitle">${t("errors.renderFailed")}</div><div class="wText">${t("errors.reloadPage")} ${error.message}</div>`;
      errorDiv.prepend(div);
    }
  }
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
  getMoveLabel: () => t("exclusions.moved")
});

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

  initTabs();
  initMainTabs();
  initResize();
  initCollapse();
  initFullscreen(dragController, renderAll);

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

  document.addEventListener("change", (e) => {
    if (e.target.id === "removalMode") {
      const val = e.target.checked;
      document.querySelectorAll("#removalMode").forEach(el => el.checked = val);
      removal.toggleRemovalMode();
    }
  });

  document.addEventListener("click", (e) => {
    if (e.target.id === "planSvg" || e.target.id === "planSvgFullscreen") {
      setSelectedExcl(null);
    }
  });

  const langSelect = document.getElementById("langSelect");
  if (langSelect) {
    langSelect.value = getLanguage();
    langSelect.addEventListener("change", () => {
      setLanguage(langSelect.value);
      updateAllTranslations();
    });
  }

  updateAllTranslations();
  renderAll(hadSession ? t("init.withSession") : t("init.default"));
})();
