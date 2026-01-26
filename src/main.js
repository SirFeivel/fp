// src/main.js
import "./style.css";
import { computePlanMetrics } from "./calc.js";
import { validateState } from "./validation.js";
import { LS_SESSION, defaultState } from "./core.js";
import { createStateStore } from "./state.js";
import { createExclusionDragController } from "./drag.js";
import { createExclusionsController } from "./exclusions.js";
import { bindUI } from "./ui.js";
import { t, setLanguage, getLanguage } from "./i18n.js";
import { initTabs } from "./tabs.js";
import { initResize, initVerticalResize } from "./resize.js";
import { initFullscreen } from "./fullscreen.js";

import {
  renderWarnings,
  renderMetrics,
  renderStateView,
  renderCounts,
  renderRoomForm,
  renderTilePatternForm,
  renderExclList,
  renderExclProps,
  renderPlanSvg
} from "./render.js";

// Store
const store = createStateStore(defaultState, validateState);
window.__fpStore = store; // keep for console testing

let selectedExclId = null;
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

function renderAll(lastLabel) {
  try {
    const state = store.getState();

    renderRoomForm(state);
    renderTilePatternForm(state);

    renderExclList(state, selectedExclId);
    renderExclProps({
      state,
      selectedExclId,
      getSelectedExcl: excl.getSelectedExcl,
      commitExclProps: excl.commitExclProps
    });

    renderWarnings(state, validateState);
    renderMetrics(state);

    const metrics = computePlanMetrics(state);
    console.log("metrics", metrics);

    renderPlanSvg({
      state,
      selectedExclId,
      setSelectedExcl,
      onExclPointerDown: dragController.onExclPointerDown,
      lastUnionError,
      lastTileError,
      setLastUnionError: (v) => (lastUnionError = v),
      setLastTileError: (v) => (lastTileError = v),
      metrics
    });

    renderStateView(state);
    renderCounts(store.getUndoStack(), store.getRedoStack(), lastLabel);

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

const dragController = createExclusionDragController({
  getSvg: () => document.getElementById("planSvg"),
  getState: () => store.getState(),
  setStateDirect: (s) => store.setStateDirect(s),
  commit: (label, next) => commitViaStore(label, next),
  render: (label) => renderAll(label),
  getSelectedExcl: () => excl.getSelectedExcl(),
  setSelectedExcl,
  getSelectedId: () => selectedExclId
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
  initResize();
  initVerticalResize();
  initFullscreen();

  bindUI({
    store,
    excl,
    renderAll,
    refreshProjectSelect,
    updateMeta,
    validateState,
    defaultStateFn: defaultState,
    setSelectedExcl,
    resetErrors: () => {
      lastUnionError = null;
      lastTileError = null;
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