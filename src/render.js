// src/render.js
import polygonClipping from "polygon-clipping";
import { computePlanMetrics, computeSkirtingNeeds, computeGrandTotals, computeProjectTotals, getRoomPricing } from "./calc.js";
import { validateState } from "./validation.js";
import { escapeHTML, getCurrentRoom, getCurrentFloor, getSelectedWall, getSelectedSurface, DEFAULT_TILE_PRESET, DEFAULT_SKIRTING_PRESET, DEFAULT_WASTE } from "./core.js";
import { getUiState } from "./ui_state.js";
import { t } from "./i18n.js";
import {
  svgEl,
  multiPolygonToPathD,
  computeExclusionsUnion,
  computeAvailableArea,
  roomPolygon,
  tilesForPreview,
  getRoomBounds,
  isRectRoom,
  computeOriginPoint,
  computeMultiPolygonPerimeter,
  computeSkirtingSegments,
  getAllFloorExclusions
} from "./geometry.js";
import { EPSILON, DEFAULT_WALL_THICKNESS_CM, DEFAULT_WALL_HEIGHT_CM } from "./constants.js";
import { setBaseViewBox, calculateEffectiveViewBox, getViewport } from "./viewport.js";
import { getFloorBounds } from "./floor_geometry.js";
import { getWallForEdge, getWallsForRoom, getWallsForEdge, computeFloorWallGeometry, getDoorwaysInEdgeSpace, getWallRenderHelpers, computeDoorwayFloorPatches, computeSurfaceTiles, computeSubSurfaceTiles } from "./walls.js";
import { computePatternGroupOrigin, getEffectiveTileSettings, getRoomPatternGroup, isPatternGroupChild } from "./pattern-groups.js";

function isCircleRoom(room) {
  return room?.circle && room.circle.rx > 0;
}

import { startSvgEdit, startSvgTextEdit, cancelSvgEdit, commitSvgEdit } from "./svg-inline-edit.js";
export { startSvgEdit, startSvgTextEdit, cancelSvgEdit, commitSvgEdit };

/**
 * Convert hex color to RGB components
 */
export function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 255, g: 255, b: 255 };
}

export function renderWarnings(state, validateState) {
  const { errors, warns } = validateState(state);
  const wrap = document.getElementById("warningsList");
  const tipsWrap = document.getElementById("tipsList");
  const wrapper = document.getElementById("warningsWrapper");
  const tipsWrapper = document.getElementById("tipsWrapper");
  const panel = document.getElementById("warningsPanel");
  const tipsPanel = document.getElementById("tipsPanel");
  if (!wrap || !wrapper || !panel || !tipsWrap || !tipsPanel) return;

  wrap.innerHTML = "";
  tipsWrap.innerHTML = "";
  wrapper.classList.remove("status-green", "status-yellow", "status-red");
  wrapper.dataset.status = "";

  const currentRoom = getCurrentRoom(state);
  const patternType = currentRoom?.pattern?.type;
  const isComplexPattern = patternType === "herringbone" || patternType === "doubleHerringbone" || patternType === "basketweave";

  // Find ratio error if any
  const ratioError = errors.find(x => 
    x.title.includes(t("validation.herringboneRatioTitle")) || 
    x.title.includes(t("validation.doubleHerringboneRatioTitle")) || 
    x.title.includes(t("validation.basketweaveRatioTitle"))
  );

  // Other warnings/errors
  const errorMessages = [
    ...errors.filter(x => x !== ratioError).map((x) => ({ ...x, level: t("warnings.error"), severity: "error" }))
  ];
  const warnMessages = [
    ...warns.map((x) => ({ ...x, level: t("warnings.warn"), severity: "warn" }))
  ];

  const pill = document.getElementById("warnPill");
  const warningCount = errorMessages.length + warnMessages.length + (ratioError ? 1 : 0);
  if (pill) pill.textContent = String(warningCount);

  const hasErrors = errors.length > 0;
  const hasWarnings = warns.length > 0 || Boolean(ratioError);
  if (hasErrors) {
    wrapper.classList.add("status-red");
    wrapper.dataset.status = "red";
  } else if (hasWarnings) {
    wrapper.classList.add("status-yellow");
    wrapper.dataset.status = "yellow";
  } else {
    wrapper.classList.add("status-green");
    wrapper.dataset.status = "green";
  }

  const warnIcon = wrapper.querySelector(".warn-icon");
  if (warnIcon) {
    warnIcon.textContent = hasErrors ? "×" : hasWarnings ? "!" : "✓";
  }

  const tips = [];
  const ratioMessage = ratioError ? { ...ratioError, level: t("warnings.error"), severity: "error" } : null;

  // Handle the special Hint/Error box for complex patterns
  if (isComplexPattern) {
    let hintKey = "";
    if (patternType === "herringbone") hintKey = "validation.herringboneRatioText";
    if (patternType === "doubleHerringbone") hintKey = "validation.doubleHerringboneRatioText";
    if (patternType === "basketweave") hintKey = "validation.basketweaveRatioText";
    if (!ratioError) {
      let ratioText = "";
      const tileW = currentRoom?.tile?.widthCm;
      const tileH = currentRoom?.tile?.heightCm;
      if (Number.isFinite(tileW) && Number.isFinite(tileH) && tileW > 0 && tileH > 0) {
        const L = Math.max(tileW, tileH);
        const W = Math.min(tileW, tileH);
        const ratio = (L / W).toFixed(2).replace(/\.?0+$/, "");
        ratioText = `${ratio}:1`;
      }
      tips.push({
        title: t("warnings.tip"),
        text: ratioText ? `${t(hintKey)} ${ratioText}.` : t(hintKey)
      });
    }
  }

  // Add floor view hint when in floor planning mode
  if (state.view?.planningMode === "floor") {
    tips.push({
      title: t("warnings.tip"),
      text: t("floor.hintDragRooms") || "Drag rooms to position • Double-click to edit room"
    });
  }

  const createWarnItem = (title, text, className) => {
    const div = document.createElement("div");
    div.className = className;
    div.innerHTML = `${title ? `<div class="wTitle">${escapeHTML(title)}</div>` : ""}<div class="wText">${escapeHTML(text)}</div>`;
    return div;
  };

  const messages = [
    ...(ratioMessage ? [ratioMessage] : []),
    ...errorMessages,
    ...warnMessages
  ];
  if (messages.length) {
    for (const w of messages) {
      wrap.appendChild(createWarnItem(w.title, w.text, "warnItem"));
    }
  }

  if (tips.length) {
    tips.forEach(tip => {
      tipsWrap.appendChild(createWarnItem("", tip.text, "warnItem info"));
    });
  }

  wrapper.style.display = "flex";
  if (tipsWrapper) {
    tipsWrapper.style.display = "flex";
    tipsWrapper.classList.remove("hidden");
    const tipsPill = document.getElementById("tipsPill");
    if (tipsPill) tipsPill.textContent = String(tips.length);
  }

  if (!tips.length && tipsWrap) {
    tipsWrap.appendChild(createWarnItem("", t("warnings.noTips"), "warnItem info"));
  }

  if (hasErrors) {
    panel.classList.remove("hidden");
  }
}


import { renderMetrics } from "./render-metrics.js";
export { renderMetrics };

export function renderStateView(state) {
  const el = document.getElementById("stateView");
  if (!el) return;
  el.textContent = JSON.stringify(state, null, 2);
}

export function renderCounts(undoStack, redoStack, lastLabel) {
  const u = document.getElementById("undoCount");
  const r = document.getElementById("redoCount");
  const a = document.getElementById("lastAction");
  const counter = document.getElementById("undoCounter");
  const btnUndo = document.getElementById("btnUndo");
  const btnRedo = document.getElementById("btnRedo");

  if (u) u.textContent = String(undoStack.length);
  if (r) r.textContent = String(redoStack.length);
  if (a) a.textContent = lastLabel || (undoStack.at(-1)?.label ?? "–");
  if (counter) counter.textContent = `${undoStack.length} / ${redoStack.length}`;

  if (btnUndo) btnUndo.disabled = undoStack.length === 0;
  if (btnRedo) btnRedo.disabled = redoStack.length === 0;
}

export function renderRoomForm(state, selectedWallEdge) {
  const currentRoom = getCurrentRoom(state);
  const roomNameEl = document.getElementById("roomName");
  if (roomNameEl) roomNameEl.value = currentRoom?.name ?? "";
  const isCreateMode = getUiState().tileEditMode === "create";
  const tileRefEl = document.getElementById("tileReference");
  if (tileRefEl && !isCreateMode) {
    tileRefEl.value = currentRoom?.tile?.reference ?? "";
  }
  const roomSkirtingEnabled = document.getElementById("roomSkirtingEnabled");
  const planningRoomSkirtingEnabled = document.getElementById("planningRoomSkirtingEnabled");
  if (roomSkirtingEnabled) roomSkirtingEnabled.checked = currentRoom?.skirting?.enabled !== false;
  if (planningRoomSkirtingEnabled) planningRoomSkirtingEnabled.checked = currentRoom?.skirting?.enabled !== false;
  document.querySelectorAll("#showGrid").forEach(el => el.checked = Boolean(state.view?.showGrid));
  document.querySelectorAll("#showSkirting").forEach(el => el.checked = Boolean(state.view?.showSkirting));
  document.querySelectorAll("#debugShowWalls").forEach(el => el.checked = Boolean(state.view?.showWalls));
  document.querySelectorAll("#threeDShowWalls").forEach(el => el.checked = Boolean(state.view?.showWalls3D));
  document.querySelectorAll("#removalMode").forEach(el => el.checked = Boolean(state.view?.removalMode));

  const skirting = currentRoom?.skirting;
  if (skirting) {
    const skirtingTypeEl = document.getElementById("skirtingType");
    if (skirtingTypeEl) skirtingTypeEl.value = skirting.type || "cutout";
    const skirtingHeightEl = document.getElementById("skirtingHeight");
    if (skirtingHeightEl) skirtingHeightEl.value = skirting.heightCm || "";
    const skirtingBoughtWidthEl = document.getElementById("skirtingBoughtWidth");
    if (skirtingBoughtWidthEl) skirtingBoughtWidthEl.value = skirting.boughtWidthCm || "";
    const skirtingPricePerPieceEl = document.getElementById("skirtingPricePerPiece");
    if (skirtingPricePerPieceEl) skirtingPricePerPieceEl.value = skirting.boughtPricePerPiece || "";

    const ref = currentRoom?.tile?.reference;
    const preset = ref ? state.tilePresets?.find(p => p?.name && p.name === ref) : null;
    const cutoutAllowed = ref ? Boolean(preset?.useForSkirting) : true;
    const cutoutHint = document.getElementById("skirtingCutoutHint");
    const cutoutOption = skirtingTypeEl?.querySelector('option[value="cutout"]');
    if (cutoutOption) cutoutOption.disabled = !cutoutAllowed;
    if (cutoutHint) cutoutHint.style.display = cutoutAllowed ? "none" : "block";
    if (!cutoutAllowed && skirtingTypeEl) skirtingTypeEl.value = "bought";

    const effectiveType = cutoutAllowed ? skirting.type : "bought";
    const isBought = effectiveType === "bought";
    const boughtWidthWrap = document.getElementById("boughtWidthWrap");
    if (boughtWidthWrap) boughtWidthWrap.style.display = isBought ? "block" : "none";
    const boughtPriceWrap = document.getElementById("boughtPriceWrap");
    if (boughtPriceWrap) boughtPriceWrap.style.display = isBought ? "block" : "none";
    const skirtingPresetRow = document.getElementById("skirtingPresetRow");
    if (skirtingPresetRow) skirtingPresetRow.style.display = isBought ? "flex" : "none";
  }

  // Populate edge properties UI — read from wall entities
  const edgeSelect = document.getElementById("edgeSelect");
  const edgeSection = document.getElementById("edgePropertiesSection");
  if (edgeSelect && currentRoom && currentRoom.polygonVertices?.length >= 3) {
    if (edgeSection) edgeSection.style.display = "";
    const edgeCount = currentRoom.polygonVertices.length;
    const prevVal = edgeSelect.value;
    edgeSelect.innerHTML = "";
    for (let i = 0; i < edgeCount; i++) {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = (t("edge.edgeN") || "Edge {n}").replace("{n}", String(i + 1));
      edgeSelect.appendChild(opt);
    }
    if (prevVal && Number(prevVal) < edgeCount) edgeSelect.value = prevVal;

    const idx = Number(edgeSelect.value) || 0;
    const floor = getCurrentFloor(state);
    // Use first wall for wall-level properties (thickness, height)
    const edgeWalls = floor ? getWallsForEdge(floor, currentRoom.id, idx) : [];
    const wall = edgeWalls[0] || null;
    const thicknessEl = document.getElementById("edgeThickness");
    const hStartEl = document.getElementById("edgeHeightStart");
    const hEndEl = document.getElementById("edgeHeightEnd");
    if (thicknessEl) thicknessEl.value = wall?.thicknessCm ?? DEFAULT_WALL_THICKNESS_CM;
    if (hStartEl) hStartEl.value = wall?.heightStartCm ?? DEFAULT_WALL_HEIGHT_CM;
    if (hEndEl) hEndEl.value = wall?.heightEndCm ?? DEFAULT_WALL_HEIGHT_CM;

    // Aggregate doorways from ALL walls covering this edge, in room-edge-local space
    const wallGeometry = floor ? computeFloorWallGeometry(floor) : null;
    const allDoorways = [];
    for (const w of edgeWalls) {
      const wDesc = wallGeometry?.get(w.id);
      const dws = wDesc
        ? getDoorwaysInEdgeSpace(wDesc, currentRoom, idx)
        : (w.doorways || []);
      const ext = wDesc?.extensions.get(currentRoom.id) ?? { extStart: 0, extEnd: 0 };
      // Subtract extStart — form shows room-edge-local, not rendering coords with extension
      allDoorways.push(...dws.map(dw => ({ ...dw, offsetCm: dw.offsetCm - ext.extStart })));
    }
    renderDoorwaysList(allDoorways, idx);
  } else if (edgeSection) {
    edgeSection.style.display = "none";
  }

  // Update other collapsible sections' arrows
  ["structureContent", "roomDetailsContent"].forEach(id => {
    const content = document.getElementById(id);
    const header = content?.previousElementSibling;
    const toggle = header?.querySelector(".collapse-toggle");
    if (content && toggle) {
      const isHidden = content.classList.contains("hidden");
      toggle.style.transform = isHidden ? "rotate(0deg)" : "rotate(180deg)";
    }
  });
}


function renderDoorwaysList(doorways, edgeIndex) {
  const container = document.getElementById("doorwaysList");
  if (!container) return;
  container.innerHTML = "";
  if (!doorways || doorways.length === 0) return;

  for (let i = 0; i < doorways.length; i++) {
    const dw = doorways[i];
    const row = document.createElement("div");
    row.className = "field-row doorway-row";
    row.style.marginBottom = "4px";
    row.innerHTML = `
      <span style="font-size:12px;color:#94a3b8;white-space:nowrap">${t("edge.doorway")} ${i + 1}</span>
      <input class="dw-offset" data-dw-idx="${i}" data-dw-id="${dw.id || ''}" type="number" min="0" step="1" value="${dw.offsetCm ?? 0}" style="width:55px" title="${t("edge.doorwayOffset")}" />
      <input class="dw-width" data-dw-idx="${i}" data-dw-id="${dw.id || ''}" type="number" min="1" step="1" value="${dw.widthCm ?? 80}" style="width:55px" title="${t("edge.doorwayWidth")}" />
      <input class="dw-height" data-dw-idx="${i}" data-dw-id="${dw.id || ''}" type="number" min="1" step="1" value="${dw.heightCm ?? DEFAULT_WALL_HEIGHT_CM}" style="width:55px" title="${t("edge.doorwayHeight")}" />
      <button class="btn btn-small dw-remove" data-dw-idx="${i}" data-dw-id="${dw.id || ''}" title="${t("edge.removeDoorway")}">✕</button>
    `;
    container.appendChild(row);
  }
}

export function renderTilePresets(state, selectedId, setSelectedId) {
  const list = document.getElementById("tilePresetList");
  if (!list) return;
  const presets = state.tilePresets || [];
  list.innerHTML = "";

  if (!presets.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = t("project.none");
    list.appendChild(opt);
    list.disabled = true;
  } else {
    list.disabled = false;
    presets.forEach(p => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name || t("project.none");
      if (p.id === selectedId) opt.selected = true;
      list.appendChild(opt);
    });
  }

  const selected = presets.find(p => p.id === selectedId) || presets[0];
  if (selected && selected.id !== selectedId && setSelectedId) {
    setSelectedId(selected.id);
  }

  const name = document.getElementById("tilePresetName");
  const shape = document.getElementById("tilePresetShape");
  const w = document.getElementById("tilePresetW");
  const h = document.getElementById("tilePresetH");
  const groutW = document.getElementById("tilePresetGroutW");
  const groutColor = document.getElementById("tilePresetGroutColor");
  const pricePerM2 = document.getElementById("tilePresetPricePerM2");
  const packM2 = document.getElementById("tilePresetPackM2");
  const pricePerPack = document.getElementById("tilePresetPricePerPack");
  const useSkirting = document.getElementById("tilePresetUseSkirting");
  const roomList = document.getElementById("tilePresetRoomList");

  if (!selected) {
    [name, shape, w, h, groutW, groutColor, pricePerM2, packM2, pricePerPack, useSkirting].forEach(el => {
      if (el) el.disabled = true;
      if (el && "value" in el) el.value = "";
      if (el && el.type === "checkbox") el.checked = false;
    });
    if (roomList) roomList.innerHTML = "";
    return;
  }

  if (name) { name.disabled = false; name.value = selected.name || ""; }
  if (shape) { shape.disabled = false; shape.value = selected.shape || "rect"; }
  if (w) { w.disabled = false; w.value = selected.widthCm ?? ""; }
  if (h) { h.disabled = false; h.value = selected.heightCm ?? ""; }
  if (groutW) { groutW.disabled = false; groutW.value = Math.round((selected.groutWidthCm ?? 0) * 10); }
  if (groutColor) { groutColor.disabled = false; groutColor.value = selected.groutColorHex || "#ffffff"; }
  const groutSwatches = document.getElementById("tilePresetGroutColorPresets");
  if (groutSwatches && !groutSwatches.dataset.bound) {
    groutSwatches.dataset.bound = "true";
    groutSwatches.addEventListener("click", (e) => {
      const swatch = e.target.closest(".color-swatch");
      if (!swatch) return;
      const color = swatch.dataset.color;
      if (!color) return;
      if (groutColor) {
        groutColor.value = color;
        groutColor.dispatchEvent(new Event("input", { bubbles: true }));
      }
      groutSwatches.querySelectorAll(".color-swatch").forEach(s => s.classList.remove("selected"));
      swatch.classList.add("selected");
    });
  }
  document.querySelectorAll("#tilePresetGroutColorPresets .color-swatch").forEach(swatch => {
    if (swatch.dataset.color?.toLowerCase() === (selected.groutColorHex || "#ffffff").toLowerCase()) {
      swatch.classList.add("selected");
    } else {
      swatch.classList.remove("selected");
    }
  });
  if (pricePerM2) { pricePerM2.disabled = false; pricePerM2.value = selected.pricePerM2 ?? ""; }
  if (packM2) { packM2.disabled = false; packM2.value = selected.packM2 ?? ""; }
  if (pricePerPack) {
    pricePerPack.disabled = false;
    const canCalc = Number.isFinite(selected.pricePerM2) && Number.isFinite(selected.packM2);
    pricePerPack.value = canCalc ? (selected.pricePerM2 * selected.packM2).toFixed(2) : "";
  }
  if (useSkirting) { useSkirting.disabled = false; useSkirting.checked = Boolean(selected.useForSkirting); }

  if (roomList) {
    roomList.innerHTML = "";
    const canAssign = Boolean(selected.name);
    if (state.floors && Array.isArray(state.floors)) {
      state.floors.forEach(floor => {
        floor.rooms?.forEach(room => {
          const label = document.createElement("label");
          label.className = "preset-room-item";
          const input = document.createElement("input");
          input.type = "checkbox";
          input.className = "checkbox";
          input.dataset.roomId = room.id;
          input.disabled = !canAssign;
          input.checked = canAssign && room.tile?.reference === selected.name;
          const span = document.createElement("span");
          span.textContent = `${floor.name || t("tabs.floor")} • ${room.name || t("room.name")}`;
          label.appendChild(input);
          label.appendChild(span);
          roomList.appendChild(label);
        });
      });
    }
  }
}

export function renderSkirtingPresets(state, selectedId, setSelectedId) {
  const list = document.getElementById("skirtingPresetList");
  if (!list) return;
  const presets = state.skirtingPresets || [];
  list.innerHTML = "";

  if (!presets.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = t("project.none");
    list.appendChild(opt);
    list.disabled = true;
  } else {
    list.disabled = false;
    presets.forEach(p => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name || t("project.none");
      if (p.id === selectedId) opt.selected = true;
      list.appendChild(opt);
    });
  }

  const selected = presets.find(p => p.id === selectedId) || presets[0];
  if (selected && selected.id !== selectedId && setSelectedId) {
    setSelectedId(selected.id);
  }

  const name = document.getElementById("skirtingPresetName");
  const height = document.getElementById("skirtingPresetHeight");
  const length = document.getElementById("skirtingPresetLength");
  const price = document.getElementById("skirtingPresetPrice");

  if (!selected) {
    [name, height, length, price].forEach(el => {
      if (el) el.disabled = true;
      if (el && "value" in el) el.value = "";
    });
    return;
  }

  if (name) { name.disabled = false; name.value = selected.name || ""; }
  if (height) { height.disabled = false; height.value = selected.heightCm ?? ""; }
  if (length) { length.disabled = false; length.value = selected.lengthCm ?? ""; }
  if (price) { price.disabled = false; price.value = selected.pricePerPiece ?? ""; }
}

export function renderSkirtingRoomList(state, { onToggleRoom, onToggleSection }) {
  const wrap = document.getElementById("skirtingRoomsList");
  if (!wrap) return;
  wrap.innerHTML = "";
  wrap.classList.add("skirting-room-list");

  const floors = state.floors || [];
  if (floors.length === 0) {
    const div = document.createElement("div");
    div.className = "meta subtle";
    div.textContent = t("project.none");
    wrap.appendChild(div);
    return;
  }

  floors.forEach((floor, floorIdx) => {
    const floorLabel = document.createElement("div");
    floorLabel.className = "skirting-room-floor";
    const floorName = floor.name || `${t("tabs.floor")} ${floorIdx + 1}`;
    floorLabel.textContent = floorName;
    wrap.appendChild(floorLabel);

    const rooms = floor.rooms || [];
    rooms.forEach((room, roomIdx) => {
      const roomEnabled = room.skirting?.enabled !== false;
      const roomRow = document.createElement("div");
      roomRow.className = "skirting-room-row";
      const roomName = room.name || `${t("tabs.room")} ${roomIdx + 1}`;
      const roomNameEl = document.createElement("div");
      roomNameEl.className = "skirting-room-name";
      roomNameEl.textContent = `${roomName} · ${t("skirting.wholeRoom")}`;
      const roomToggle = document.createElement("label");
      roomToggle.className = "toggle-switch skirting-room-toggle";
      const roomInput = document.createElement("input");
      roomInput.type = "checkbox";
      roomInput.checked = roomEnabled;
      roomInput.dataset.roomId = room.id;
      const roomSlider = document.createElement("div");
      roomSlider.className = "toggle-slider";
      roomRow.appendChild(roomNameEl);
      roomToggle.appendChild(roomInput);
      roomToggle.appendChild(roomSlider);
      roomRow.appendChild(roomToggle);
      roomInput.addEventListener("change", () => {
        onToggleRoom?.(room.id, Boolean(roomInput.checked));
      });
      wrap.appendChild(roomRow);
      // Sections have been removed - rooms now use polygonVertices only
    });
  });
}


import { renderTilePatternForm } from "./render-tile-form.js";
export { renderTilePatternForm };

export function renderExclList(state, selectedExclId) {
  const sel = document.getElementById("exclList");
  sel.innerHTML = "";
  const surface = getSelectedSurface(state);
  const currentRoom = surface || getCurrentRoom(state);
  const exclusions = currentRoom?.exclusions || [];
  if (!exclusions.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = t("project.none");
    sel.appendChild(opt);
    sel.disabled = true;
    return;
  }
  sel.disabled = false;
  for (const ex of exclusions) {
    const opt = document.createElement("option");
    opt.value = ex.id;
    opt.textContent = `${ex.label || ex.type}`;
    if (ex.id === selectedExclId) opt.selected = true;
    sel.appendChild(opt);
  }
}

export function renderExclProps({
  state,
  selectedExclId,
  getSelectedExcl,
  commitExclProps
}) {
  const wrap = document.getElementById("exclProps");
  const ex = getSelectedExcl();
  wrap.innerHTML = "";

  if (!ex) {
    const div = document.createElement("div");
    div.className = "meta subtle span2";
    div.textContent = t("exclusions.noneSelected");
    wrap.appendChild(div);
    return;
  }

  const field = (label, id, value, step = "0.1") => {
    const d = document.createElement("div");
    d.className = "field";
    d.innerHTML = `<label>${escapeHTML(
      label
    )}</label><input id="${id}" type="number" step="${step}" />`;
    wrap.appendChild(d);
    const inp = d.querySelector("input");
    inp.value = Number.isFinite(value) ? value.toFixed(2) : value;
    inp.addEventListener("blur", () => commitExclProps(t("exclusions.changed")));
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        inp.blur();
      }
    });
    return inp;
  };

  const labelDiv = document.createElement("div");
  labelDiv.className = "field span2";
  labelDiv.innerHTML = `<label>${t("exclusions.label")}</label><input id="exLabel" type="text" />`;
  wrap.appendChild(labelDiv);
  const labelInp = labelDiv.querySelector("input");
  labelInp.value = ex.label || "";
  labelInp.addEventListener("blur", () => commitExclProps(t("exclusions.changed")));
  labelInp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      labelInp.blur();
    }
  });

  if (ex.type === "rect") {
    field(t("exclProps.x"), "exX", ex.x, "0.01");
    field(t("exclProps.y"), "exY", ex.y, "0.01");
    field(t("exclProps.width"), "exW", ex.w, "0.01");
    field(t("exclProps.height"), "exH", ex.h, "0.01");
  } else if (ex.type === "circle") {
    field(t("exclProps.centerX"), "exCX", ex.cx, "0.01");
    field(t("exclProps.centerY"), "exCY", ex.cy, "0.01");
    field(t("exclProps.radius"), "exR", ex.r, "0.01");
  } else if (ex.type === "tri") {
    field(t("exclProps.p1x"), "exP1X", ex.p1.x, "0.01");
    field(t("exclProps.p1y"), "exP1Y", ex.p1.y, "0.01");
    field(t("exclProps.p2x"), "exP2X", ex.p2.x, "0.01");
    field(t("exclProps.p2y"), "exP2Y", ex.p2.y, "0.01");
    field(t("exclProps.p3x"), "exP3X", ex.p3.x, "0.01");
    field(t("exclProps.p3y"), "exP3Y", ex.p3.y, "0.01");
  } else if (ex.type === "freeform" && ex.vertices) {
    // Show read-only vertex count for freeform exclusions
    const infoDiv = document.createElement("div");
    infoDiv.className = "field span2";
    infoDiv.innerHTML = `<span class="field-label">${t("exclProps.vertices")}</span><span>${ex.vertices.length} ${t("exclProps.points")}</span>`;
    wrap.appendChild(infoDiv);
  }

  // Add Skirting Toggle for Exclusion
  const div = document.createElement("div");
  div.className = "field span2";
  div.innerHTML = `
    <label class="toggle-switch">
      <span class="toggle-label">${t("skirting.enabled")}</span>
      <input id="exSkirtingEnabled" type="checkbox" ${ex.skirtingEnabled !== false ? "checked" : ""}>
      <div class="toggle-slider"></div>
    </label>
  `;
  wrap.appendChild(div);

  const inp = div.querySelector("#exSkirtingEnabled");
  inp.addEventListener("change", () => {
    commitExclProps(t("exclusions.changed"));
  });
}

export function renderQuickSubSurface({
  state,
  selectedExclId,
  getSelectedExcl,
  commitSubSurface,
}) {
  const btn = document.getElementById("quickSubSurface");
  const menu = document.getElementById("subSurfaceDropdown");
  if (!btn || !menu) return;

  const ex = getSelectedExcl();
  btn.disabled = !ex;
  menu.innerHTML = "";
  if (!ex) return;

  const enabled = !!ex.tile;

  // Enable toggle row
  const toggleRow = document.createElement("div");
  toggleRow.style.cssText = "display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid var(--line)";
  toggleRow.innerHTML = `
    <label class="quick-toggle" title="${t("subSurface.enable")}">
      <input id="qssEnabled" type="checkbox" ${enabled ? "checked" : ""}>
      <span class="quick-toggle-icon">⬚</span>
    </label>
    <span class="quick-label" style="color:var(--text)">${t("subSurface.enable")}</span>
  `;
  menu.appendChild(toggleRow);
  toggleRow.querySelector("input").addEventListener("change", () => commitSubSurface(t("subSurface.changed")));

  if (!enabled) return;

  const row = (labelText, content) => {
    const d = document.createElement("div");
    d.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 10px";
    d.innerHTML = `<span class="quick-label">${labelText}</span>`;
    d.appendChild(content);
    menu.appendChild(d);
  };

  // Preset
  const presetSel = document.createElement("select");
  presetSel.id = "qssPreset";
  presetSel.className = "quick-select";
  (state.tilePresets || []).forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    if (ex.tile?.reference === p.name) opt.selected = true;
    presetSel.appendChild(opt);
  });
  presetSel.addEventListener("change", () => commitSubSurface(t("subSurface.changed")));
  row(t("subSurface.preset"), presetSel);

  // Pattern
  const patSel = document.createElement("select");
  patSel.id = "qssPattern";
  patSel.className = "quick-select";
  [["grid","Grid"],["runningBond","Running Bond"],["herringbone","Herringbone"],["doubleHerringbone","Double Herringbone"],["basketweave","Basketweave"]].forEach(([v,l]) => {
    const opt = document.createElement("option");
    opt.value = v; opt.textContent = l;
    if ((ex.pattern?.type || "grid") === v) opt.selected = true;
    patSel.appendChild(opt);
  });
  patSel.addEventListener("change", () => commitSubSurface(t("subSurface.changed")));
  row(t("subSurface.pattern"), patSel);

  // Grout width
  const groutW = document.createElement("input");
  groutW.id = "qssGroutWidth";
  groutW.type = "number";
  groutW.className = "quick-input small no-spinner";
  groutW.min = "0";
  groutW.step = "0.01";
  groutW.value = (ex.grout?.widthCm ?? 0.2).toFixed(2);
  groutW.addEventListener("blur", () => commitSubSurface(t("subSurface.changed")));
  const gwWrap = document.createElement("div");
  gwWrap.style.cssText = "display:flex;align-items:center;gap:4px";
  gwWrap.appendChild(groutW);
  gwWrap.insertAdjacentHTML("beforeend", `<span class="quick-label">cm</span>`);
  row(t("subSurface.groutWidth"), gwWrap);

  // Grout color
  const groutC = document.createElement("input");
  groutC.id = "qssGroutColor";
  groutC.type = "color";
  groutC.value = ex.grout?.colorHex || "#ffffff";
  groutC.style.cssText = "width:36px;height:28px;padding:2px;border-radius:4px;border:1px solid var(--line);background:transparent;cursor:pointer";
  groutC.addEventListener("input", () => commitSubSurface(t("subSurface.changed")));
  row(t("subSurface.groutColor"), groutC);
}

export function renderSubSurfaceProps({
  state,
  selectedExclId,
  getSelectedExcl,
  commitSubSurface,
}) {
  const wrap = document.getElementById("subSurfaceProps");
  if (!wrap) return;
  wrap.innerHTML = "";

  const ex = getSelectedExcl();
  if (!ex) {
    const div = document.createElement("div");
    div.className = "meta subtle span2";
    div.textContent = t("subSurface.noneSelected");
    wrap.appendChild(div);
    return;
  }

  const enabled = !!ex.tile;

  // Toggle
  const toggleDiv = document.createElement("div");
  toggleDiv.className = "field span2";
  toggleDiv.innerHTML = `
    <label class="toggle-switch">
      <span class="toggle-label">${t("subSurface.enable")}</span>
      <input id="subSurfEnabled" type="checkbox" ${enabled ? "checked" : ""}>
      <div class="toggle-slider"></div>
    </label>
  `;
  wrap.appendChild(toggleDiv);

  if (!enabled) return;

  // Tile preset
  const presetDiv = document.createElement("div");
  presetDiv.className = "field span2";
  presetDiv.innerHTML = `<label>${t("subSurface.preset")}</label><select id="subSurfPreset"></select>`;
  wrap.appendChild(presetDiv);
  const presetSel = presetDiv.querySelector("select");
  const presets = state.tilePresets || [];
  presets.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    if (ex.tile?.reference === p.name) opt.selected = true;
    presetSel.appendChild(opt);
  });

  // Pattern
  const patternDiv = document.createElement("div");
  patternDiv.className = "field span2";
  patternDiv.innerHTML = `<label>${t("subSurface.pattern")}</label>
    <select id="subSurfPattern">
      <option value="grid">Grid</option>
      <option value="runningBond">Running Bond</option>
      <option value="herringbone">Herringbone</option>
      <option value="doubleHerringbone">Double Herringbone</option>
      <option value="basketweave">Basketweave</option>
    </select>`;
  wrap.appendChild(patternDiv);
  const patternSel = patternDiv.querySelector("select");
  if (ex.pattern?.type) patternSel.value = ex.pattern.type;

  // Grout width
  const groutWDiv = document.createElement("div");
  groutWDiv.className = "field";
  groutWDiv.innerHTML = `<label>${t("subSurface.groutWidth")}</label>
    <div class="input-with-unit">
      <input id="subSurfGroutWidth" type="number" step="0.01" min="0" />
      <span class="unit">cm</span>
    </div>`;
  wrap.appendChild(groutWDiv);
  const groutWInp = groutWDiv.querySelector("input");
  groutWInp.value = (ex.grout?.widthCm ?? 0.2).toFixed(2);

  // Grout color
  const groutCDiv = document.createElement("div");
  groutCDiv.className = "field";
  groutCDiv.innerHTML = `<label>${t("subSurface.groutColor")}</label>
    <input id="subSurfGroutColor" type="color" />`;
  wrap.appendChild(groutCDiv);
  const groutCInp = groutCDiv.querySelector("input");
  groutCInp.value = ex.grout?.colorHex || "#ffffff";

  // Wire up events — all commit on change/blur
  const onCommit = () => commitSubSurface(t("subSurface.changed"));
  toggleDiv.querySelector("input").addEventListener("change", onCommit);
  presetSel.addEventListener("change", onCommit);
  patternSel.addEventListener("change", onCommit);
  groutWInp.addEventListener("blur", onCommit);
  groutCInp.addEventListener("input", onCommit);
}

export function renderObj3dList(state, selectedObj3dId) {
  const sel = document.getElementById("obj3dList");
  if (!sel) return;
  sel.innerHTML = "";
  const currentRoom = getCurrentRoom(state);
  const objects = currentRoom?.objects3d || [];
  if (!objects.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = t("project.none");
    sel.appendChild(opt);
    sel.disabled = true;
    return;
  }
  sel.disabled = false;
  for (const obj of objects) {
    const opt = document.createElement("option");
    opt.value = obj.id;
    opt.textContent = obj.label || obj.type;
    if (obj.id === selectedObj3dId) opt.selected = true;
    sel.appendChild(opt);
  }
}

export function renderObj3dProps({
  state,
  selectedObj3dId,
  getSelectedObj,
  commitObjProps
}) {
  const wrap = document.getElementById("obj3dProps");
  if (!wrap) return;
  const obj = getSelectedObj();
  wrap.innerHTML = "";

  if (!obj) {
    const div = document.createElement("div");
    div.className = "meta subtle span2";
    div.textContent = t("objects3d.noneSelected");
    wrap.appendChild(div);
    return;
  }

  const field = (label, id, value, step = "0.1") => {
    const d = document.createElement("div");
    d.className = "field";
    d.innerHTML = `<label>${escapeHTML(label)}</label><input id="${id}" type="number" step="${step}" />`;
    wrap.appendChild(d);
    const inp = d.querySelector("input");
    inp.value = Number.isFinite(value) ? value.toFixed(2) : value;
    inp.addEventListener("blur", () => commitObjProps(t("objects3d.changed")));
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); inp.blur(); }
    });
    return inp;
  };

  // Label
  const labelDiv = document.createElement("div");
  labelDiv.className = "field span2";
  labelDiv.innerHTML = `<label>${t("objects3d.label")}</label><input id="obj3dLabel" type="text" />`;
  wrap.appendChild(labelDiv);
  const labelInp = labelDiv.querySelector("input");
  labelInp.value = obj.label || "";
  labelInp.addEventListener("blur", () => commitObjProps(t("objects3d.changed")));
  labelInp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); labelInp.blur(); }
  });

  if (obj.type === "tri") {
    field(t("exclProps.p1x"), "obj3dP1X", obj.p1.x, "0.01");
    field(t("exclProps.p1y"), "obj3dP1Y", obj.p1.y, "0.01");
    field(t("exclProps.p2x"), "obj3dP2X", obj.p2.x, "0.01");
    field(t("exclProps.p2y"), "obj3dP2Y", obj.p2.y, "0.01");
    field(t("exclProps.p3x"), "obj3dP3X", obj.p3.x, "0.01");
    field(t("exclProps.p3y"), "obj3dP3Y", obj.p3.y, "0.01");
  } else if (obj.type === "freeform" && obj.vertices) {
    const infoDiv = document.createElement("div");
    infoDiv.className = "field span2";
    infoDiv.innerHTML = `<span class="field-label">${t("exclProps.vertices")}</span><span>${obj.vertices.length} ${t("exclProps.points")}</span>`;
    wrap.appendChild(infoDiv);
  } else {
    field(t("exclProps.x"), "obj3dX", obj.x, "0.01");
    field(t("exclProps.y"), "obj3dY", obj.y, "0.01");
    field(t("exclProps.width"), "obj3dW", obj.w, "0.01");
    field(t("exclProps.height"), "obj3dH", obj.h, "0.01");
  }
  field(t("objects3d.height"), "obj3dHeight", obj.heightCm, "1");

  // Skirting toggle
  const div = document.createElement("div");
  div.className = "field span2";
  div.innerHTML = `
    <label class="toggle-switch">
      <span class="toggle-label">${t("skirting.enabled")}</span>
      <input id="obj3dSkirtingEnabled" type="checkbox" ${obj.skirtingEnabled !== false ? "checked" : ""}>
      <div class="toggle-slider"></div>
    </label>
  `;
  wrap.appendChild(div);
  div.querySelector("#obj3dSkirtingEnabled").addEventListener("change", () => {
    commitObjProps(t("objects3d.changed"));
  });
}

function _renderPlanObjects3d(svg, room, { selectedObj3dId, onObj3dPointerDown, setSelectedObj3d, onObj3dResizeHandlePointerDown }) {
  const objects3d = room.objects3d || [];
  if (objects3d.length === 0) return;
  const gObj = svgEl("g");
  for (const obj of objects3d) {
    const isSel = obj.id === selectedObj3dId;
    const common = {
      fill: isSel ? "rgba(34,197,94,0.15)" : "rgba(34,197,94,0.06)",
      stroke: isSel ? "rgba(34,197,94,1)" : "rgba(34,197,94,0.8)",
      "stroke-width": isSel ? 2 : 1.2,
      cursor: "move",
      "data-objid": obj.id
    };

    let shapeEl;
    if (obj.type === "rect") {
      shapeEl = svgEl("rect", { ...common, x: obj.x, y: obj.y, width: obj.w, height: obj.h });
    } else if (obj.type === "freeform" && obj.vertices?.length >= 3) {
      const pts = obj.vertices.map(v => `${v.x},${v.y}`).join(" ");
      shapeEl = svgEl("polygon", { ...common, points: pts });
    } else if (obj.type === "tri") {
      const pts = `${obj.p1.x},${obj.p1.y} ${obj.p2.x},${obj.p2.y} ${obj.p3.x},${obj.p3.y}`;
      shapeEl = svgEl("polygon", { ...common, points: pts });
    } else {
      continue;
    }

    if (onObj3dPointerDown) {
      shapeEl.addEventListener("pointerdown", onObj3dPointerDown);
    }
    if (setSelectedObj3d) {
      shapeEl.addEventListener("click", (e) => {
        e.stopPropagation();
        setSelectedObj3d(obj.id);
      });
    }
    gObj.appendChild(shapeEl);

    if (isSel && onObj3dResizeHandlePointerDown) {
      const handleRadius = 6;
      const handleStyle = {
        fill: "#22c55e",
        stroke: "#fff",
        "stroke-width": 1.5,
        cursor: "pointer",
        "data-objid": obj.id
      };

      if (obj.type === "rect") {
        const handles = [
          { type: "nw", x: obj.x, y: obj.y, cursor: "nwse-resize" },
          { type: "ne", x: obj.x + obj.w, y: obj.y, cursor: "nesw-resize" },
          { type: "sw", x: obj.x, y: obj.y + obj.h, cursor: "nesw-resize" },
          { type: "se", x: obj.x + obj.w, y: obj.y + obj.h, cursor: "nwse-resize" },
          { type: "n", x: obj.x + obj.w / 2, y: obj.y, cursor: "ns-resize" },
          { type: "s", x: obj.x + obj.w / 2, y: obj.y + obj.h, cursor: "ns-resize" },
          { type: "w", x: obj.x, y: obj.y + obj.h / 2, cursor: "ew-resize" },
          { type: "e", x: obj.x + obj.w, y: obj.y + obj.h / 2, cursor: "ew-resize" }
        ];
        handles.forEach(h => {
          const handle = svgEl("circle", {
            ...handleStyle, cx: h.x, cy: h.y, r: handleRadius,
            cursor: h.cursor, "data-resize-handle": h.type
          });
          handle.addEventListener("pointerdown", onObj3dResizeHandlePointerDown);
          gObj.appendChild(handle);
        });
      } else if (obj.type === "tri") {
        [{ type: "p1", ...obj.p1 }, { type: "p2", ...obj.p2 }, { type: "p3", ...obj.p3 }].forEach(p => {
          const handle = svgEl("circle", {
            ...handleStyle, cx: p.x, cy: p.y, r: handleRadius,
            cursor: "move", "data-resize-handle": p.type
          });
          handle.addEventListener("pointerdown", onObj3dResizeHandlePointerDown);
          gObj.appendChild(handle);
        });
      } else if (obj.type === "freeform" && obj.vertices?.length >= 3) {
        obj.vertices.forEach((v, i) => {
          const handle = svgEl("circle", {
            ...handleStyle, cx: v.x, cy: v.y, r: handleRadius,
            cursor: "move", "data-resize-handle": `v${i}`
          });
          handle.addEventListener("pointerdown", onObj3dResizeHandlePointerDown);
          gObj.appendChild(handle);
        });
      }
    }
  }
  svg.appendChild(gObj);
}

function _renderPlanWalls(room, state, { isExportBW, selectedWallEdge, selectedDoorwayId, onWallClick, onWallDoubleClick, onDoorwayPointerDown, onDoorwayResizePointerDown, addPillLabel }) {
  if (isExportBW || isCircleRoom(room) || !(room.polygonVertices?.length >= 3)) return null;
  const verts = room.polygonVertices;
  const n = verts.length;
  const floor = getCurrentFloor(state);
  const roomWalls = floor ? getWallsForRoom(floor, room.id) : [];

  let roomArea2 = 0;
  for (let k = 0; k < n; k++) {
    const kn = (k + 1) % n;
    roomArea2 += verts[k].x * verts[kn].y - verts[kn].x * verts[k].y;
  }
  const windingSign = roomArea2 > 0 ? 1 : -1;

  // Centralized wall geometry for doorway direction + extensions
  const wallGeometry = floor ? computeFloorWallGeometry(floor) : new Map();

  const wallsGroup = svgEl("g", {});
  const renderedEdges = new Set();

  for (const wall of roomWalls) {
    const surface = wall.surfaces?.find(s => s.roomId === room.id);
    if (!surface) continue;
    const edgeIdx = surface.edgeIndex;
    if (edgeIdx == null || edgeIdx < 0 || edgeIdx >= n) continue;
    if (renderedEdges.has(edgeIdx)) continue;
    renderedEdges.add(edgeIdx);

    const origA = verts[edgeIdx];
    const origB = verts[(edgeIdx + 1) % n];
    const thick = wall.thicknessCm ?? DEFAULT_WALL_THICKNESS_CM;
    if (thick <= 0) continue;

    const edgeDx = origB.x - origA.x;
    const edgeDy = origB.y - origA.y;
    const origL = Math.hypot(edgeDx, edgeDy);
    if (origL < 1) continue;

    const edgeDirX = edgeDx / origL;
    const edgeDirY = edgeDy / origL;

    // Outward normal from CURRENT room's polygon (not the wall's owning room)
    const normal = { x: windingSign * edgeDy / origL, y: -windingSign * edgeDx / origL };

    // Angle-aware corner extensions from centralized wall geometry
    const wallDesc = wallGeometry.get(wall.id);
    const roomExt = wallDesc?.extensions.get(room.id) ?? { extStart: thick, extEnd: thick };
    const extStart = roomExt.extStart;
    const extEnd = roomExt.extEnd;
    const A = { x: origA.x - edgeDirX * extStart, y: origA.y - edgeDirY * extStart };
    const B = { x: origB.x + edgeDirX * extEnd, y: origB.y + edgeDirY * extEnd };
    const L = origL + extStart + extEnd;
    const OA = { x: A.x + normal.x * thick, y: A.y + normal.y * thick };
    const OB = { x: B.x + normal.x * thick, y: B.y + normal.y * thick };

    const isSel = (edgeIdx === selectedWallEdge);
    const wallFill = isSel ? "rgba(59,130,246,0.25)" : "rgba(148,163,184,0.2)";
    const wallStroke = isSel ? "rgba(59,130,246,0.5)" : "rgba(148,163,184,0.35)";

    const eDx = B.x - A.x, eDy = B.y - A.y;
    const innerAt = (t) => ({ x: A.x + t * eDx, y: A.y + t * eDy });
    const outerAt = (t) => ({ x: OA.x + t * (OB.x - OA.x), y: OA.y + t * (OB.y - OA.y) });

    // Aggregate doorways from ALL walls that affect this edge
    const allDoorways = [];
    for (const w of roomWalls) {
      const wSurf = w.surfaces?.find(s => s.roomId === room.id && s.edgeIndex === edgeIdx);
      if (!wSurf) continue;
      const wDesc = wallGeometry.get(w.id);
      const dws = wDesc
        ? getDoorwaysInEdgeSpace(wDesc, room, edgeIdx)
        : (w.doorways || []);
      allDoorways.push(...dws);
    }
    const sortedDw = [...allDoorways].sort((a, b) => a.offsetCm - b.offsetCm);

    const drawWallSeg = (tStart, tEnd) => {
      const iC = innerAt(tStart), iD = innerAt(tEnd);
      const oC = outerAt(tStart), oD = outerAt(tEnd);
      const segD = `M ${iC.x} ${iC.y} L ${iD.x} ${iD.y} L ${oD.x} ${oD.y} L ${oC.x} ${oC.y} Z`;
      const wallSeg = svgEl("path", {
        d: segD, fill: wallFill, stroke: wallStroke, "stroke-width": 0.5,
        "pointer-events": "auto", "data-wall-edge": edgeIdx, cursor: "pointer"
      });
      wallSeg.addEventListener("pointerenter", () => {
        if (edgeIdx !== selectedWallEdge) wallSeg.setAttribute("fill", "rgba(59,130,246,0.15)");
      });
      wallSeg.addEventListener("pointerleave", () => {
        if (edgeIdx !== selectedWallEdge) wallSeg.setAttribute("fill", wallFill);
      });
      wallSeg.addEventListener("click", (e) => {
        e.stopPropagation();
        if (onWallClick) onWallClick(edgeIdx);
      });
      wallSeg.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        if (onWallDoubleClick) onWallDoubleClick(edgeIdx);
      });
      wallsGroup.appendChild(wallSeg);
    };

    let cursor = 0;
    for (const dw of sortedDw) {
      const dwStart = Math.max(0, dw.offsetCm);
      const dwEnd = Math.min(L, dw.offsetCm + dw.widthCm);
      if (dwEnd <= dwStart) continue;
      if (dwStart > cursor + 0.5) drawWallSeg(cursor / L, dwStart / L);
      cursor = Math.max(cursor, dwEnd);
    }
    if (cursor < L - 0.5) drawWallSeg(cursor / L, 1);

    // Render doorway rectangles
    for (const dw of sortedDw) {
      const dwStart = Math.max(0, dw.offsetCm);
      const dwEnd = Math.min(L, dw.offsetCm + dw.widthCm);
      const dwWidth = dwEnd - dwStart;
      if (dwWidth < 0.5) continue;

      const tS = dwStart / L, tE = dwEnd / L;
      const iS = innerAt(tS), iE = innerAt(tE);
      const oS = outerAt(tS), oE = outerAt(tE);

      const isDwSel = (dw.id === selectedDoorwayId);
      const dwFill = isDwSel ? "rgba(239,68,68,0.15)" : "rgba(239,68,68,0.06)";
      const dwStroke = isDwSel ? "rgba(239,68,68,1)" : "rgba(239,68,68,0.8)";
      const dwStrokeW = isDwSel ? 2 : 1.2;

      const dwD = `M ${iS.x} ${iS.y} L ${iE.x} ${iE.y} L ${oE.x} ${oE.y} L ${oS.x} ${oS.y} Z`;
      const dwEl = svgEl("path", {
        d: dwD, fill: dwFill, stroke: dwStroke, "stroke-width": dwStrokeW,
        cursor: "move", "data-doorway-id": dw.id, "data-wall-edge": edgeIdx,
        "pointer-events": "auto"
      });
      dwEl.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        if (onDoorwayPointerDown) onDoorwayPointerDown(e, dw.id, edgeIdx);
      });
      wallsGroup.appendChild(dwEl);

      // Dimension indicators and resize handles for selected doorway
      if (isDwSel) {
        const accent = "rgba(122,162,255,1)";
        const dimOffset = thick + 10;
        const ox = normal.x * dimOffset;
        const oy = normal.y * dimOffset;
        const tick = 6;
        const wx = normal.x * tick / 2;
        const wy = normal.y * tick / 2;

        let edgeAngle = Math.atan2(edgeDirY, edgeDirX) * 180 / Math.PI;
        if (edgeAngle > 90 || edgeAngle < -90) edgeAngle += 180;

        const drawIndicator = (p1, p2, valueCm) => {
          const mx = (p1.x + p2.x) / 2;
          const my = (p1.y + p2.y) / 2;
          wallsGroup.appendChild(svgEl("line", {
            x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y,
            stroke: accent, "stroke-width": 1, "pointer-events": "none"
          }));
          wallsGroup.appendChild(svgEl("line", {
            x1: p1.x - wx, y1: p1.y - wy, x2: p1.x + wx, y2: p1.y + wy,
            stroke: accent, "stroke-width": 1, "pointer-events": "none"
          }));
          wallsGroup.appendChild(svgEl("line", {
            x1: p2.x - wx, y1: p2.y - wy, x2: p2.x + wx, y2: p2.y + wy,
            stroke: accent, "stroke-width": 1, "pointer-events": "none"
          }));
          addPillLabel(`${Number(valueCm.toFixed(1))} cm`, mx + normal.x * 6, my + normal.y * 6, { parent: wallsGroup, angle: edgeAngle });
        };

        const edgeStart = { x: A.x + ox, y: A.y + oy };
        const dwOuterStart = { x: iS.x + ox, y: iS.y + oy };
        const dwOuterEnd = { x: iE.x + ox, y: iE.y + oy };
        const edgeEnd = { x: B.x + ox, y: B.y + oy };

        if (dwStart > 1) drawIndicator(edgeStart, dwOuterStart, dwStart);
        drawIndicator(dwOuterStart, dwOuterEnd, dwWidth);
        const rightDist = L - dwEnd;
        if (rightDist > 1) drawIndicator(dwOuterEnd, edgeEnd, rightDist);

        // Resize handles
        if (onDoorwayResizePointerDown) {
          const handleR = thick * 0.4;
          const handleStyle = {
            fill: "var(--accent, #3b82f6)", stroke: "#fff", "stroke-width": 1.5,
            "pointer-events": "auto"
          };
          const lMid = { x: (iS.x + oS.x) / 2, y: (iS.y + oS.y) / 2 };
          const rMid = { x: (iE.x + oE.x) / 2, y: (iE.y + oE.y) / 2 };

          const lHandle = svgEl("circle", {
            ...handleStyle, cx: lMid.x, cy: lMid.y, r: handleR,
            cursor: "ew-resize", "data-doorway-id": dw.id,
            "data-wall-edge": edgeIdx, "data-doorway-resize": "start"
          });
          lHandle.addEventListener("pointerdown", (e) => {
            e.stopPropagation();
            onDoorwayResizePointerDown(e, dw.id, edgeIdx, "start");
          });
          wallsGroup.appendChild(lHandle);

          const rHandle = svgEl("circle", {
            ...handleStyle, cx: rMid.x, cy: rMid.y, r: handleR,
            cursor: "ew-resize", "data-doorway-id": dw.id,
            "data-wall-edge": edgeIdx, "data-doorway-resize": "end"
          });
          rHandle.addEventListener("pointerdown", (e) => {
            e.stopPropagation();
            onDoorwayResizePointerDown(e, dw.id, edgeIdx, "end");
          });
          wallsGroup.appendChild(rHandle);
        }
      }
    }
  }
  return wallsGroup;
}

function _renderPlanExclusions(svg, displayExclusions, { selectedExclId, isExportBW, onExclPointerDown, setSelectedExcl, onResizeHandlePointerDown, onInlineEdit, addPillLabel, labelBaseStyle, fmtCm }) {
  const gEx = svgEl("g");
  for (const ex of displayExclusions) {
    const isSel = ex.id === selectedExclId;
    const isTiled = !!ex.tile;
    const r = isTiled ? "34,197,94" : "239,68,68";
    const common = {
      fill: isExportBW ? "rgba(0,0,0,0.12)" : (isSel ? `rgba(${r},0.15)` : `rgba(${r},0.06)`),
      stroke: isExportBW ? "#111111" : (isSel ? `rgba(${r},1)` : `rgba(${r},0.8)`),
      "stroke-width": isExportBW ? 1.2 : (isSel ? 2 : 1.2),
      cursor: "move",
      "data-exid": ex.id
    };
    if (isExportBW) {
      common["stroke-dasharray"] = "6 4";
    }

    let shapeEl;
    if (ex.type === "rect") {
      shapeEl = svgEl("rect", { ...common, x: ex.x, y: ex.y, width: ex.w, height: ex.h });
    } else if (ex.type === "circle") {
      shapeEl = svgEl("circle", { ...common, cx: ex.cx, cy: ex.cy, r: ex.r });
    } else if (ex.type === "freeform" && ex.vertices?.length >= 3) {
      const pts = ex.vertices.map(v => `${v.x},${v.y}`).join(" ");
      shapeEl = svgEl("polygon", { ...common, points: pts });
    } else {
      const pts = `${ex.p1.x},${ex.p1.y} ${ex.p2.x},${ex.p2.y} ${ex.p3.x},${ex.p3.y}`;
      shapeEl = svgEl("polygon", { ...common, points: pts });
    }

    shapeEl.addEventListener("pointerdown", onExclPointerDown);
    shapeEl.addEventListener("click", (e) => {
      e.stopPropagation();
      setSelectedExcl(ex.id);
    });
    gEx.appendChild(shapeEl);

    if (isSel && onResizeHandlePointerDown) {
      const handleRadius = 6;
      const handleStyle = {
        fill: "var(--accent, #3b82f6)",
        stroke: "#fff",
        "stroke-width": 1.5,
        cursor: "pointer",
        "data-exid": ex.id
      };
      const addEditableLabel = (text, value, key, x, y, anchor = "middle", angle = 0) => {
        let finalAngle = angle;
        if (finalAngle > 90 || finalAngle < -90) {
          finalAngle += 180;
        }
        const labelGroup = addPillLabel(text, x, y, {
          anchor,
          angle: finalAngle,
          parent: gEx
        });
        if (!onInlineEdit) return;
        const openEdit = (e) => {
          e.preventDefault();
          e.stopPropagation();
          labelGroup.style.display = "none";
          const isPosLabel = key === "x" || key === "y";
          startSvgEdit({
            svg,
            x,
            y,
            angle: finalAngle,
            value,
            textStyle: labelBaseStyle,
            onCommit: (nextVal) => {
              labelGroup.style.display = "";
              onInlineEdit({ id: ex.id, key, value: nextVal });
            },
            onCancel: () => {
              labelGroup.style.display = "";
              setSelectedExcl(null);
            },
            anchor,
            prefix: isPosLabel ? `${key} ` : ""
          });
        };
        labelGroup.addEventListener("pointerdown", openEdit);
        labelGroup.addEventListener("click", openEdit);
      };

      const pad = 10;

      if (ex.type === "rect") {
        const handles = [
          { type: "nw", x: ex.x, y: ex.y, cursor: "nwse-resize" },
          { type: "ne", x: ex.x + ex.w, y: ex.y, cursor: "nesw-resize" },
          { type: "sw", x: ex.x, y: ex.y + ex.h, cursor: "nesw-resize" },
          { type: "se", x: ex.x + ex.w, y: ex.y + ex.h, cursor: "nwse-resize" },
          { type: "n", x: ex.x + ex.w / 2, y: ex.y, cursor: "ns-resize" },
          { type: "s", x: ex.x + ex.w / 2, y: ex.y + ex.h, cursor: "ns-resize" },
          { type: "w", x: ex.x, y: ex.y + ex.h / 2, cursor: "ew-resize" },
          { type: "e", x: ex.x + ex.w, y: ex.y + ex.h / 2, cursor: "ew-resize" }
        ];
        handles.forEach(h => {
          const handle = svgEl("circle", {
            ...handleStyle,
            cx: h.x,
            cy: h.y,
            r: handleRadius,
            cursor: h.cursor,
            "data-resize-handle": h.type
          });
          handle.addEventListener("pointerdown", onResizeHandlePointerDown);
          gEx.appendChild(handle);
        });
        addEditableLabel(`${fmtCm(ex.w)} cm`, ex.w, "w", ex.x + ex.w / 2, ex.y - pad, "middle", 0);
        addEditableLabel(`${fmtCm(ex.h)} cm`, ex.h, "h", ex.x + ex.w + pad, ex.y + ex.h / 2, "middle", 90);
      } else if (ex.type === "circle") {
        const handle = svgEl("circle", {
          ...handleStyle,
          cx: ex.cx + ex.r,
          cy: ex.cy,
          r: handleRadius,
          cursor: "ew-resize",
          "data-resize-handle": "r"
        });
        handle.addEventListener("pointerdown", onResizeHandlePointerDown);
        gEx.appendChild(handle);
        addEditableLabel(`Ø ${fmtCm(ex.r * 2)} cm`, ex.r * 2, "diameter", ex.cx, ex.cy - ex.r - pad);
      } else if (ex.type === "tri") {
        const points = [
          { type: "p1", x: ex.p1.x, y: ex.p1.y },
          { type: "p2", x: ex.p2.x, y: ex.p2.y },
          { type: "p3", x: ex.p3.x, y: ex.p3.y }
        ];
        points.forEach(p => {
          const handle = svgEl("circle", {
            ...handleStyle,
            cx: p.x,
            cy: p.y,
            r: handleRadius,
            cursor: "move",
            "data-resize-handle": p.type
          });
          handle.addEventListener("pointerdown", onResizeHandlePointerDown);
          gEx.appendChild(handle);
        });
        const sides = [
          { key: "side-a", p1: ex.p1, p2: ex.p2 },
          { key: "side-b", p1: ex.p2, p2: ex.p3 },
          { key: "side-c", p1: ex.p3, p2: ex.p1 }
        ];
        sides.forEach(side => {
          const midX = (side.p1.x + side.p2.x) / 2;
          const midY = (side.p1.y + side.p2.y) / 2;
          const dx = side.p2.x - side.p1.x;
          const dy = side.p2.y - side.p1.y;
          const len = Math.sqrt(dx * dx + dy * dy) || 1;
          const nx = -dy / len;
          const ny = dx / len;
          const offset = 8;
          const x = midX + nx * offset;
          const y = midY + ny * offset;
          const angle = Math.atan2(dy, dx) * 180 / Math.PI;
          addEditableLabel(`${fmtCm(len)} cm`, len, side.key, x, y, "middle", angle);
        });
      } else if (ex.type === "freeform" && ex.vertices?.length >= 3) {
        ex.vertices.forEach((v, i) => {
          const handle = svgEl("circle", {
            ...handleStyle,
            cx: v.x,
            cy: v.y,
            r: handleRadius,
            cursor: "move",
            "data-resize-handle": `v${i}`
          });
          handle.addEventListener("pointerdown", onResizeHandlePointerDown);
          gEx.appendChild(handle);
        });
        for (let i = 0; i < ex.vertices.length; i++) {
          const p1 = ex.vertices[i];
          const p2 = ex.vertices[(i + 1) % ex.vertices.length];
          const midX = (p1.x + p2.x) / 2;
          const midY = (p1.y + p2.y) / 2;
          const dx = p2.x - p1.x;
          const dy = p2.y - p1.y;
          const len = Math.sqrt(dx * dx + dy * dy) || 1;
          const nx = -dy / len;
          const ny = dx / len;
          const offset = 8;
          const x = midX + nx * offset;
          const y = midY + ny * offset;
          const angle = Math.atan2(dy, dx) * 180 / Math.PI;
          addPillLabel(`${fmtCm(len)} cm`, x, y, { angle, parent: gEx });
        }
      }
    }
  }
  svg.appendChild(gEx);
}

export function renderPlanSvg({
  state,
  selectedExclId,
  setSelectedExcl,
  onExclPointerDown,
  onInlineEdit,
  onResizeHandlePointerDown,
  lastUnionError,
  lastTileError,
  setLastUnionError,
  setLastTileError,
  metrics, // optional; if omitted we compute it here
  skipTiles = false,
  svgOverride = null,
  includeExclusions = true,
  exportStyle = null,
  selectedWallEdge = null,
  selectedDoorwayId = null,
  onWallClick = null,
  onWallDoubleClick = null,
  onDoorwayPointerDown = null,
  onDoorwayResizePointerDown = null,
  roomOverride = null,
  selectedObj3dId = null,
  setSelectedObj3d = null,
  onObj3dPointerDown = null,
  onObj3dResizeHandlePointerDown = null
}) {
  const svg = svgOverride || document.getElementById("planSvg");
  const currentRoom = roomOverride || getCurrentRoom(state);
  const isExportBW = exportStyle === "bw";

  if (!currentRoom) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.setAttribute("viewBox", "0 0 100 100");
    return;
  }

  const fmtCm = (v) => {
    if (!Number.isFinite(v)) return "0.00";
    return Number(v).toFixed(2);
  };

  const labelBaseStyle = {
    fill: isExportBW ? "#111111" : "rgba(231,238,252,0.95)",
    "font-size": 9,
    "font-family": "system-ui, -apple-system, Segoe UI, Roboto, Arial",
    "text-anchor": "middle",
    "dominant-baseline": "middle"
  };

  function addPillLabel(text, x, y, opts = {}) {
    const { anchor = "middle", onClick, parent = svg, angle = 0 } = opts;
    const g = svgEl("g", { cursor: onClick ? "text" : "default" });
    if (angle) {
      g.setAttribute("transform", `rotate(${angle} ${x} ${y})`);
    }
    const t = svgEl("text", { ...labelBaseStyle, x, y, "text-anchor": anchor });
    t.textContent = text;
    g.appendChild(t);
    if (onClick) {
      g.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      });
      g.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
    }
    parent.appendChild(g);
    return g;
  }

  function bboxFromPathD(d) {
    const nums = d
      .trim()
      .split(/[\s,]+/)
      .map((x) => Number(x))
      .filter((x) => Number.isFinite(x));
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i + 1 < nums.length; i += 2) {
      const x = nums[i];
      const y = nums[i + 1];
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    if (!Number.isFinite(minX)) return null;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  function drawDimensionLine(
    x1,
    y1,
    x2,
    y2,
    label,
    offsetX,
    offsetY,
    labelShiftX = 0,
    labelShiftY = 0,
    labelAngle = 0
  ) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = dx / len;
    const ny = dy / len;
    const px = -ny;
    const py = nx;
    const tick = 8;

    const lx1 = x1 + offsetX;
    const ly1 = y1 + offsetY;
    const lx2 = x2 + offsetX;
    const ly2 = y2 + offsetY;

    svg.appendChild(svgEl("line", { x1: lx1, y1: ly1, x2: lx2, y2: ly2, stroke: "#111111", "stroke-width": 1 }));
    svg.appendChild(svgEl("line", {
      x1: lx1 - px * (tick / 2),
      y1: ly1 - py * (tick / 2),
      x2: lx1 + px * (tick / 2),
      y2: ly1 + py * (tick / 2),
      stroke: "#111111",
      "stroke-width": 1
    }));
    svg.appendChild(svgEl("line", {
      x1: lx2 - px * (tick / 2),
      y1: ly2 - py * (tick / 2),
      x2: lx2 + px * (tick / 2),
      y2: ly2 + py * (tick / 2),
      stroke: "#111111",
      "stroke-width": 1
    }));
    const labelX = (lx1 + lx2) / 2 + labelShiftX;
    const labelY = (ly1 + ly2) / 2 + labelShiftY;
    addPillLabel(label, labelX, labelY, { parent: svg, angle: labelAngle });
  }

  // Inline edit handled by module-level SVG editor

  const bounds = getRoomBounds(currentRoom);
  const w = bounds.width;
  const h = bounds.height;
  const minX = bounds.minX;
  const minY = bounds.minY;
  const maxX = bounds.maxX;
  const maxY = bounds.maxY;
  // When a wall surface is selected, currentRoom is the wall surface region whose
  // exclusions are doorway shapes in surface-space — not floor exclusions. Use the
  // actual room's exclusions for the floor plan display.
  const displayExclRaw = roomOverride
    ? (currentRoom.exclusions || []).filter(e => e.id && !e._isContact)
    : (currentRoom?.exclusions || []);
  const displayExclusions = includeExclusions ? displayExclRaw : [];

  if (!svgOverride) {
    const resizeOverlay = document.getElementById("resizeMetrics");
    if (resizeOverlay) {
      resizeOverlay.classList.add("hidden");
    }
    cancelSvgEdit();
  }

  while (svg.firstChild) svg.removeChild(svg.firstChild);

  const dimMargin = isExportBW ? 18 : 0;
  const basePadding = isExportBW ? 24 : 50;
  const viewBoxPadding = basePadding + dimMargin;
  const baseViewBox = {
    minX: minX - viewBoxPadding,
    minY: minY - viewBoxPadding,
    width: w + 2 * viewBoxPadding,
    height: h + 2 * viewBoxPadding
  };

  let vb = baseViewBox;
  if (!svgOverride) {
    // Store base viewBox for zoom/pan calculations
    setBaseViewBox(state.selectedRoomId, baseViewBox);

    // Calculate effective viewBox with zoom/pan applied
    const effectiveViewBox = calculateEffectiveViewBox(state.selectedRoomId);
    vb = effectiveViewBox || baseViewBox;
  }

  svg.setAttribute("viewBox", `${vb.minX} ${vb.minY} ${vb.width} ${vb.height}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

  // Background extends beyond normal bounds to cover zoomed out views
  const bgPadding = Math.max(baseViewBox.width, baseViewBox.height) * 10;
  svg.appendChild(svgEl("rect", {
    x: baseViewBox.minX - bgPadding,
    y: baseViewBox.minY - bgPadding,
    width: baseViewBox.width + 2 * bgPadding,
    height: baseViewBox.height + 2 * bgPadding,
    fill: isExportBW ? "#ffffff" : "#081022"
  }));

  // Room outline - always visible (needed for freeform rooms during exclusion editing)
  if (isCircleRoom(currentRoom)) {
    const { cx, cy, rx, ry } = currentRoom.circle;
    svg.appendChild(svgEl("ellipse", {
      cx, cy, rx, ry,
      fill: "none",
      stroke: "rgba(122, 162, 255, 0.4)",
      "stroke-width": 1.5,
      "pointer-events": "none"
    }));
  } else {
    const roomPoly = roomPolygon(currentRoom);
    if (roomPoly && roomPoly.length > 0) {
      const pathD = multiPolygonToPathD(roomPoly);
      svg.appendChild(svgEl("path", {
        d: pathD,
        fill: "none",
        stroke: "rgba(122, 162, 255, 0.4)",
        "stroke-width": 1.5,
        "pointer-events": "none"
      }));
    }
  }

  // Walls group — appended to svg AFTER tiles so walls draw on top (no tile bleed-through)
  const wallsGroup = _renderPlanWalls(currentRoom, state, {
    isExportBW, selectedWallEdge, selectedDoorwayId,
    onWallClick, onWallDoubleClick,
    onDoorwayPointerDown, onDoorwayResizePointerDown,
    addPillLabel
  });

  const suppressDetails = Boolean(selectedExclId);

  if (isExportBW) {
    const widthLabel = `${Math.round(w)} cm`;
    const heightLabel = `${Math.round(h)} cm`;
    drawDimensionLine(minX, minY, maxX, minY, widthLabel, 0, -dimMargin, 0, -6);
    drawDimensionLine(minX, minY, minX, maxY, heightLabel, -dimMargin, 0, -6, 0, -90);
  }

  // grid
  if (state.view?.showGrid) {
    const g = svgEl("g", { opacity: 0.8 });
    const minor = 10, major = 100;
    for (let x = minX; x <= maxX; x += minor) {
      const isMajor = (x - minX) % major === 0;
      g.appendChild(svgEl("line", {
        x1: x, y1: minY, x2: x, y2: maxY,
        stroke: isExportBW ? (isMajor ? "#d0d0d0" : "#e6e6e6") : (isMajor ? "#1f2b46" : "#14203a"),
        "stroke-width": isMajor ? 0.6 : 0.3
      }));
    }
    for (let y = minY; y <= maxY; y += minor) {
      const isMajor = (y - minY) % major === 0;
      g.appendChild(svgEl("line", {
        x1: minX, y1: y, x2: maxX, y2: y,
        stroke: isExportBW ? (isMajor ? "#d0d0d0" : "#e6e6e6") : (isMajor ? "#1f2b46" : "#14203a"),
        "stroke-width": isMajor ? 0.6 : 0.3
      }));
    }
    svg.appendChild(g);
  }

  if (isExportBW) {
    const origin = computeOriginPoint(currentRoom, currentRoom.pattern);
    const markerRadius = 6;
    svg.appendChild(svgEl("circle", {
      cx: origin.x,
      cy: origin.y,
      r: markerRadius,
      fill: "#ffffff",
      stroke: "#111111",
      "stroke-width": 2.5
    }));
  }

  // Update dynamic plan title in header
  const planTitleEl = document.getElementById("planTitle");
  if (planTitleEl) {
    const currentFloor = getCurrentFloor(state);
    const floorName = currentFloor?.name || "–";
    const roomName = currentRoom?.name || "–";
    const totalArea = (w * h / 10000).toFixed(2);
    planTitleEl.textContent = `${floorName} / ${roomName} — ${totalArea} m²`;
  }

  // tiles
  let previewTiles = [];
  const { errors } = validateState(state);
  const ratioError = errors.find(e => 
    e.title.includes(t("validation.herringboneRatioTitle")) || 
    e.title.includes(t("validation.doubleHerringboneRatioTitle")) || 
    e.title.includes(t("validation.basketweaveRatioTitle"))
  );

  if (!skipTiles && !suppressDetails && ratioError) {
    const boxG = svgEl("g");
    const boxW = Math.min(w * 0.8, 300);
    const boxH = 100;
    const boxX = minX + w / 2 - boxW / 2;
    const boxY = minY + h / 2 - boxH / 2;

    boxG.appendChild(svgEl("rect", {
      x: boxX,
      y: boxY,
      width: boxW,
      height: boxH,
      rx: 8,
      fill: "rgba(255, 193, 7, 0.1)",
      stroke: "rgba(255, 193, 7, 0.6)",
      "stroke-width": 2
    }));

    const textX = boxX + boxW / 2;
    const textY = boxY + 35;
    const titleText = `${t("warnings.error")}: ${ratioError.title}`;
    
    const title = svgEl("text", {
      x: textX,
      y: textY,
      fill: "#ffc107",
      "font-size": 14,
      "font-weight": "bold",
      "text-anchor": "middle",
      "font-family": "system-ui, -apple-system, Segoe UI, Roboto, Arial"
    });

    // Simple word wrapping for the title if it's too long
    const words = titleText.split(" ");
    let line = "";
    const maxCharsPerLine = Math.floor(boxW / 7); // Rough estimate
    let tspanCount = 0;

    for (let i = 0; i < words.length; i++) {
      const testLine = line + words[i] + " ";
      if (testLine.length > maxCharsPerLine && i > 0) {
        const tspan = svgEl("tspan", { x: textX, dy: tspanCount === 0 ? 0 : 18 });
        tspan.textContent = line.trim();
        title.appendChild(tspan);
        line = words[i] + " ";
        tspanCount++;
      } else {
        line = testLine;
      }
    }
    const tspanFinal = svgEl("tspan", { x: textX, dy: tspanCount === 0 ? 0 : 18 });
    tspanFinal.textContent = line.trim();
    title.appendChild(tspanFinal);

    boxG.appendChild(title);
    svg.appendChild(boxG);
  }

  if (!skipTiles && !suppressDetails && !ratioError) {
    const isRemovalMode = Boolean(state.view?.removalMode);
    const currentFloor = state.floors?.find(f => f.id === state.selectedFloorId);
    const effectiveSettings = getEffectiveTileSettings(currentRoom, currentFloor);
    const patternGroupOrigin = computePatternGroupOrigin(currentRoom, currentFloor);
    const tileResult = computeSurfaceTiles(state, currentRoom, currentFloor, {
      exclusions: roomOverride ? (currentRoom.exclusions || []) : getAllFloorExclusions(currentRoom),
      includeDoorwayPatches: !roomOverride,
      effectiveSettings,
      originOverride: patternGroupOrigin,
      isRemovalMode,
    });
    if (tileResult.error) setLastTileError(tileResult.error);
    else setLastTileError(null);

    if (tileResult.tiles.length > 0 || !tileResult.error) {
      console.log(`[render:2D-room] room=${currentRoom?.id} tiles=${tileResult.tiles.length} error=${tileResult.error || 'none'}`);
      previewTiles = tileResult.tiles;

      const g = svgEl("g", { opacity: 1, "pointer-events": isRemovalMode ? "auto" : "none" });
      svg.appendChild(g);

      const groutWidth = effectiveSettings.grout?.widthCm || 0;
      const groutHex = groutWidth > 0 ? (effectiveSettings.grout?.colorHex || "#ffffff") : "#ffffff";
      const groutRgb = hexToRgb(groutHex);

    for (const tile of tileResult.tiles) {
      const isExcluded = tile.excluded;
      const attrs = {
        d: tile.d,
        fill: isExportBW
          ? (isExcluded ? "rgba(0,0,0,0.12)" : "none")
          : (isExcluded 
            ? "rgba(239,68,68,0.25)" 
            : (tile.isFull ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.08)")),
        stroke: isExportBW
          ? "#222222"
          : (isExcluded
              ? "rgba(239,68,68,0.8)"
              : (tile.isFull
                  ? `rgba(${groutRgb.r},${groutRgb.g},${groutRgb.b},0.50)`
                  : `rgba(${groutRgb.r},${groutRgb.g},${groutRgb.b},0.90)`)),
        "stroke-width": isExportBW ? 0.5 : (isExcluded ? 2.0 : (tile.isFull ? 0.5 : 1.2))
      };
      if (isExcluded) {
        attrs["stroke-dasharray"] = "4 2";
        attrs["class"] = "tile-excluded";
        if (isExportBW) {
          const bb = bboxFromPathD(tile.d);
          if (bb) {
            const cx = bb.x + bb.w / 2;
            const cy = bb.y + bb.h / 2;
            const size = Math.min(bb.w, bb.h) * 0.2;
            g.appendChild(svgEl("line", { x1: cx - size, y1: cy - size, x2: cx + size, y2: cy + size, stroke: "#111111", "stroke-width": 1 }));
            g.appendChild(svgEl("line", { x1: cx - size, y1: cy + size, x2: cx + size, y2: cy - size, stroke: "#111111", "stroke-width": 1 }));
          }
        }
      }
        if (tile.id) attrs["data-tileid"] = tile.id;
        g.appendChild(svgEl("path", attrs));
      }
    }

    // Sub-surface tile groups (exclusions that carry their own tile/pattern)
    const subExcls = roomOverride ? (currentRoom.exclusions || []) : getAllFloorExclusions(currentRoom);
    const subSurfResults = computeSubSurfaceTiles(state, subExcls, currentFloor, { isRemovalMode });
    for (const ss of subSurfResults) {
      if (!ss.tiles.length) continue;
      const ssGroutRgb = hexToRgb(ss.groutColor);
      const ssG = svgEl("g", { opacity: 1, "pointer-events": "none" });
      for (const tile of ss.tiles) {
        if (!tile.d) continue;
        ssG.appendChild(svgEl("path", {
          d: tile.d,
          fill: tile.isFull ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.08)",
          stroke: `rgba(${ssGroutRgb.r},${ssGroutRgb.g},${ssGroutRgb.b},0.50)`,
          "stroke-width": tile.isFull ? 0.5 : 1.2,
        }));
      }
      svg.appendChild(ssG);
      console.log(`[render:2D-subSurface] excl=${ss.exclusionId} tiles=${ss.tiles.length}`);
    }
  }

  // Render actual skirting segments in wall surface view
  if (state.view?.showSkirting && currentRoom.skirtingSegments && currentRoom.skirtingSegments.length > 0 && currentRoom.skirtingConfig) {
    const isRemovalMode = Boolean(state.view?.removalMode);
    const skirting = currentRoom.skirtingConfig;

    const gSkirting = svgEl("g", {
      fill: "none",
      stroke: isExportBW ? "#111111" : "var(--accent)",
      "stroke-width": isExportBW ? 3 : 4,
      opacity: 0.6,
      "stroke-linejoin": "round",
      "pointer-events": isRemovalMode ? "auto" : "none"
    });

    const tileW = Number(skirting.tile?.widthCm) || DEFAULT_TILE_PRESET.widthCm;
    const tileH = Number(skirting.tile?.heightCm) || DEFAULT_TILE_PRESET.heightCm;
    const longSide = Math.max(tileW, tileH);
    const pieceLength = skirting.type === "bought"
      ? (Number(skirting.boughtWidthCm) || DEFAULT_SKIRTING_PRESET.lengthCm)
      : longSide;
    const gap = 2.5;

    // Y position in wall surface coords - at the adjusted floor boundary
    // The polygon floor is at heightCm - skirtingOffset, skirting renders there
    const skirtingY = currentRoom.heightCm - currentRoom.skirtingOffset;

    for (const seg of currentRoom.skirtingSegments) {
      const { x1, x2, id, excluded } = seg;
      const d = `M ${x1} ${skirtingY} L ${x2} ${skirtingY}`;

      if (isRemovalMode) {
        const hitArea = svgEl("path", {
          d,
          stroke: "transparent",
          "stroke-width": 20,
          "data-skirtid": id,
          cursor: "pointer"
        });
        gSkirting.appendChild(hitArea);
      }

      const attrs = {
        d,
        "stroke-dasharray": isExportBW ? "8 4" : (excluded ? "none" : `${pieceLength - gap} ${gap}`),
        "stroke-linecap": "butt"
      };
      if (id) attrs["data-skirtid"] = id;

      if (excluded) {
        if (isExportBW) {
          gSkirting.appendChild(svgEl("path", {
            d,
            stroke: "#bdbdbd",
            "stroke-width": 7,
            "stroke-linecap": "butt"
          }));
        }
        attrs.stroke = isExportBW ? "#111111" : "rgba(239,68,68,0.8)";
        attrs["stroke-width"] = isExportBW ? 3 : 8;
        if (!isExportBW) attrs["class"] = "skirt-excluded";
        if (isExportBW) {
          const cx = (x1 + x2) / 2;
          const cy = skirtingY;
          const size = 6;
          gSkirting.appendChild(svgEl("line", { x1: cx - size, y1: cy - size, x2: cx + size, y2: cy + size, stroke: "#111111", "stroke-width": 1 }));
          gSkirting.appendChild(svgEl("line", { x1: cx - size, y1: cy + size, x2: cx + size, y2: cy - size, stroke: "#111111", "stroke-width": 1 }));
        }
      }

      gSkirting.appendChild(svgEl("path", attrs));
    }

    svg.appendChild(gSkirting);
  }

  // Append walls group on top of tiles so wall quads cover tile bleed-through
  if (wallsGroup) svg.appendChild(wallsGroup);

// DEBUG overlay: show real cut polygons (not bbox)
const showNeeds = Boolean(state?.view?.showNeeds);
const m = metrics && metrics.ok ? metrics : null;

if (showNeeds && m?.data?.debug?.tileUsage?.length && previewTiles?.length) {
  const gDbg = svgEl("g", { opacity: 1 });
  svg.appendChild(gDbg);

  const usage = m.data.debug.tileUsage;

  // usage + previewTiles are generated in the same order (tilesForPreview loop)
  const n = Math.min(usage.length, previewTiles.length);

  for (let i = 0; i < n; i++) {
    const u = usage[i];
    const tile = previewTiles[i];
    if (!tile || tile.isFull) continue; // only cut tiles

    const reused = Boolean(u?.reused);

    gDbg.appendChild(
      svgEl("path", {
        d: tile.d, // <- real clipped polygon
        fill: "none",
        stroke: reused ? "rgba(0,255,0,0.95)" : "rgba(255,165,0,0.95)",
        "stroke-width": 2,
        "stroke-dasharray": "6 4",
      })
    );
  }
}

  // union overlay
  if (!skipTiles && !isExportBW) {
    const voidExcls = displayExclusions.filter(e => !e.tile);
    const tiledExcls = displayExclusions.filter(e => !!e.tile);

    const u = computeExclusionsUnion(voidExcls);
    if (u.error) setLastUnionError(u.error);
    else setLastUnionError(null);

    if (u.mp) {
      const unionPath = multiPolygonToPathD(u.mp);
      svg.appendChild(svgEl("path", {
        d: unionPath,
        fill: "rgba(239,68,68,0.15)",
        stroke: "rgba(239,68,68,0.55)",
        "stroke-width": 1.5,
        "pointer-events": "none"
      }));
    }

    if (tiledExcls.length > 0) {
      const ut = computeExclusionsUnion(tiledExcls);
      if (ut.mp) {
        const unionPath = multiPolygonToPathD(ut.mp);
        svg.appendChild(svgEl("path", {
          d: unionPath,
          fill: "rgba(34,197,94,0.12)",
          stroke: "rgba(34,197,94,0.50)",
          "stroke-width": 1.5,
          "pointer-events": "none"
        }));
      }
    }
  }

  // Skirting Visualization
  if (state.view?.showSkirting) {
    const isRemovalMode = Boolean(state.view?.removalMode);
    const skirtingFloor = getCurrentFloor(state);
    const segments = computeSkirtingSegments(currentRoom, isRemovalMode, skirtingFloor);

    if (segments.length > 0) {
      const gSkirting = svgEl("g", { 
        fill: "none", 
        stroke: isExportBW ? "#111111" : "var(--accent)", 
        "stroke-width": isExportBW ? 3 : 4, 
        opacity: 0.6,
        "stroke-linejoin": "round",
        "pointer-events": isRemovalMode ? "auto" : "none"
      });
      
      const skirting = currentRoom.skirting || {};
      const pieceLength = skirting.type === "bought" 
        ? (Number(skirting.boughtWidthCm) || DEFAULT_SKIRTING_PRESET.lengthCm)
        : (Math.max(Number(currentRoom.tile?.widthCm) || 0, Number(currentRoom.tile?.heightCm) || 0) || DEFAULT_TILE_PRESET.widthCm);

      const gap = 2.5; // visible gap in cm

      for (const seg of segments) {
        const { p1, p2, id, excluded } = seg;
        const d = `M ${p1[0]} ${p1[1]} L ${p2[0]} ${p2[1]}`;
        
        if (isRemovalMode) {
          // Transparent hit area for easier clicking in removal mode
          const hitArea = svgEl("path", {
            d,
            stroke: "transparent",
            "stroke-width": 20,
            "data-skirtid": id,
            cursor: "pointer"
          });
          gSkirting.appendChild(hitArea);
        }

        const attrs = {
          d,
          "stroke-dasharray": isExportBW ? "8 4" : (excluded ? "none" : `${pieceLength - gap} ${gap}`),
          "stroke-linecap": "butt"
        };
        if (id) attrs["data-skirtid"] = id;
        if (excluded) {
          if (isExportBW) {
            gSkirting.appendChild(svgEl("path", {
              d,
              stroke: "#bdbdbd",
              "stroke-width": 7,
              "stroke-linecap": "butt"
            }));
          }
          attrs.stroke = isExportBW ? "#111111" : "rgba(239,68,68,0.8)";
          attrs["stroke-width"] = isExportBW ? 3 : 8;
          if (!isExportBW) attrs["class"] = "skirt-excluded";
          if (isExportBW) {
            const cx = (p1[0] + p2[0]) / 2;
            const cy = (p1[1] + p2[1]) / 2;
            const size = 6;
            gSkirting.appendChild(svgEl("line", { x1: cx - size, y1: cy - size, x2: cx + size, y2: cy + size, stroke: "#111111", "stroke-width": 1 }));
            gSkirting.appendChild(svgEl("line", { x1: cx - size, y1: cy + size, x2: cx + size, y2: cy - size, stroke: "#111111", "stroke-width": 1 }));
          }
        }

        // Pieces (dashed line) - show gaps to background for better recognition
        gSkirting.appendChild(svgEl("path", attrs));
      }
      svg.appendChild(gSkirting);
    }
  }

  // Removal mode class
  if (state.view?.removalMode) {
    svg.classList.add("removal-mode");
  } else {
    svg.classList.remove("removal-mode");
  }

  // exclusion shapes
  _renderPlanExclusions(svg, displayExclusions, {
    selectedExclId, isExportBW, onExclPointerDown, setSelectedExcl,
    onResizeHandlePointerDown, onInlineEdit, addPillLabel, labelBaseStyle, fmtCm
  });

  // 3D object footprints
  _renderPlanObjects3d(svg, currentRoom, { selectedObj3dId, onObj3dPointerDown, setSelectedObj3d, onObj3dResizeHandlePointerDown });

  // errors overlay
  if (lastUnionError) {
    const t = svgEl("text", {
      x: minX + 8, y: minY + 38,
      fill: "rgba(255,107,107,0.95)",
      "font-size": 12,
      "font-family": "system-ui, -apple-system, Segoe UI, Roboto, Arial"
    });
    t.textContent = `Union: ${lastUnionError}`;
    svg.appendChild(t);
  }
  if (lastTileError) {
    const t2 = svgEl("text", {
      x: minX + 8, y: minY + 54,
      fill: "rgba(255,204,102,0.95)",
      "font-size": 12,
      "font-family": "system-ui, -apple-system, Segoe UI, Roboto, Arial"
    });
    t2.textContent = `Tiles: ${lastTileError}`;
    svg.appendChild(t2);
  }

  // Wall surface rotation — no longer needed (walls are not separate rooms)
  if (false) {
    const v0 = currentRoom.polygonVertices[0];
    const v1 = currentRoom.polygonVertices[1];
    const edgeAngleDeg = Math.atan2(v1.y - v0.y, v1.x - v0.x) * 180 / Math.PI;

    let rotDeg = -edgeAngleDeg;

    // Determine whether the floor edge ends up at the bottom (larger Y) after
    // the initial rotation; if not, flip 180° so it does.
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const rotRad = rotDeg * Math.PI / 180;
    const cosR = Math.cos(rotRad), sinR = Math.sin(rotRad);
    const floorY = (v0.x - cx) * sinR + (v0.y - cy) * cosR + cy;
    const ceilY = (currentRoom.polygonVertices[3].x - cx) * sinR
                + (currentRoom.polygonVertices[3].y - cy) * cosR + cy;
    if (floorY < ceilY) rotDeg += 180;

    // Normalise to [0, 360) and skip if effectively zero
    const normRot = ((rotDeg % 360) + 360) % 360;
    if (normRot > 0.1 && normRot < 359.9) {
      const g = svgEl("g", { transform: `rotate(${rotDeg} ${cx} ${cy})` });
      while (svg.firstChild) g.appendChild(svg.firstChild);
      svg.appendChild(g);

      // Recompute viewBox from the rotated polygon bounds
      const finalRad = rotDeg * Math.PI / 180;
      const cosF = Math.cos(finalRad), sinF = Math.sin(finalRad);
      let rMinX = Infinity, rMinY = Infinity, rMaxX = -Infinity, rMaxY = -Infinity;
      for (const v of currentRoom.polygonVertices) {
        const rx = cx + (v.x - cx) * cosF - (v.y - cy) * sinF;
        const ry = cy + (v.x - cx) * sinF + (v.y - cy) * cosF;
        rMinX = Math.min(rMinX, rx);
        rMinY = Math.min(rMinY, ry);
        rMaxX = Math.max(rMaxX, rx);
        rMaxY = Math.max(rMaxY, ry);
      }
      const rW = rMaxX - rMinX;
      const rH = rMaxY - rMinY;
      svg.setAttribute("viewBox",
        `${rMinX - viewBoxPadding} ${rMinY - viewBoxPadding} ${rW + 2 * viewBoxPadding} ${rH + 2 * viewBoxPadding}`);
    }
  }

  const svgFullscreen = !svgOverride ? document.getElementById("planSvgFullscreen") : null;
  if (svgFullscreen) {
    svgFullscreen.innerHTML = svg.innerHTML;
    svgFullscreen.setAttribute('viewBox', svg.getAttribute('viewBox'));
    svgFullscreen.setAttribute('preserveAspectRatio', svg.getAttribute('preserveAspectRatio'));
    
    if (state.view?.removalMode) {
      svgFullscreen.classList.add("removal-mode");
    } else {
      svgFullscreen.classList.remove("removal-mode");
    }

    if (onExclPointerDown) {
      const exclusionShapes = svgFullscreen.querySelectorAll('[data-exid]:not([data-resize-handle])');
      exclusionShapes.forEach(shape => {
        shape.addEventListener('pointerdown', onExclPointerDown);
      });
    }

    if (onResizeHandlePointerDown) {
      const resizeHandles = svgFullscreen.querySelectorAll('[data-resize-handle]');
      resizeHandles.forEach(handle => {
        handle.addEventListener('pointerdown', onResizeHandlePointerDown);
      });
    }
  }
}

import { renderCommercialTab, renderExportTab } from "./render-commercial.js";
export { renderCommercialTab, renderExportTab };


function _renderFloorRoom(svg, room, floor, opts) {
  const {
    state,
    selectedRoomId,
    onRoomClick,
    onRoomDoubleClick,
    onRoomPointerDown,
    onRoomResizePointerDown,
    onRoomInlineEdit,
    onVertexPointerDown,
    onRoomNameEdit,
    onPolygonEdgeEdit
  } = opts;

  const pos = room.floorPosition || { x: 0, y: 0 };
  const roomGroup = svgEl("g", {
    transform: `translate(${pos.x}, ${pos.y})`,
    "data-roomid": room.id,
    cursor: "pointer"
  });

  const isSelected = room.id === selectedRoomId;

  // Get room polygon for rendering (in room-local coordinates)
  // The group transform handles floor positioning
  if (isCircleRoom(room)) {
    const { cx, cy, rx, ry } = room.circle;
    roomGroup.appendChild(svgEl("ellipse", {
      cx, cy, rx, ry,
      fill: isSelected ? "rgba(59, 130, 246, 0.25)" : "rgba(100, 150, 200, 0.15)",
      stroke: isSelected ? "#3b82f6" : "rgba(200, 220, 255, 0.5)",
      "stroke-width": isSelected ? 3 : 2
    }));
  }

  const roomPoly = roomPolygon(room);
  if (!isCircleRoom(room) && roomPoly && roomPoly.length > 0) {
    // Convert polygon to path
    const pathD = multiPolygonToPathD(roomPoly);

    // Room fill with clear visibility
    roomGroup.appendChild(svgEl("path", {
      d: pathD,
      fill: isSelected ? "rgba(59, 130, 246, 0.25)" : "rgba(100, 150, 200, 0.15)",
      stroke: isSelected ? "#3b82f6" : "rgba(200, 220, 255, 0.5)",
      "stroke-width": isSelected ? 3 : 2
    }));

    // Render tiles preview if enabled and room has tile config
    // Use effective settings (from origin room if in pattern group)
    const effectiveSettings = getEffectiveTileSettings(room, floor);
    const effectiveTile = effectiveSettings.tile;
    if (state.view?.showFloorTiles && effectiveTile?.widthCm > 0 && effectiveTile?.heightCm > 0) {
      try {
        const tileResult = computeSurfaceTiles(
          { ...state, selectedRoomId: room.id },
          room,
          floor,
          {
            exclusions: getAllFloorExclusions(room),
            includeDoorwayPatches: true,
            effectiveSettings,
            originOverride: computePatternGroupOrigin(room, floor),
            isRemovalMode: false,
          }
        );
        if (tileResult.error) {
          console.warn(`Floor tiles error for room ${room.name || room.id}:`, tileResult.error);
        }

        if (tileResult.tiles.length > 0) {
          // Create a group for tiles
          const tilesGroup = svgEl("g", { opacity: 0.8 });

          for (const tile of tileResult.tiles.slice(0, 1000)) { // Limit tiles for performance
            if (!tile.d) continue;
            tilesGroup.appendChild(svgEl("path", {
              d: tile.d,
              fill: "rgba(100, 116, 139, 0.5)",
              stroke: tileResult.groutColor,
              "stroke-width": effectiveSettings.grout?.widthCm || 0.2
            }));
          }

          roomGroup.appendChild(tilesGroup);
        }

        // Sub-surface tile groups in floor overview
        const ovSubSurfs = computeSubSurfaceTiles(
          { ...state, selectedRoomId: room.id }, room.exclusions || [], floor, { isRemovalMode: false }
        );
        for (const ss of ovSubSurfs) {
          if (!ss.tiles.length) continue;
          const ssGroutRgb = hexToRgb(ss.groutColor);
          const ssG = svgEl("g", { opacity: 0.8 });
          for (const tile of ss.tiles.slice(0, 1000)) {
            if (!tile.d) continue;
            ssG.appendChild(svgEl("path", {
              d: tile.d,
              fill: "rgba(100, 116, 139, 0.5)",
              stroke: ss.groutColor,
              "stroke-width": 0.2,
            }));
          }
          roomGroup.appendChild(ssG);
          console.log(`[render:2D-subSurface-overview] room=${room.id} excl=${ss.exclusionId} tiles=${ss.tiles.length}`);
        }
      } catch (e) {
        console.warn(`Floor tiles rendering failed for room ${room.name || room.id}:`, e);
      }
    }
  }

  // Room label
  const roomBounds = getRoomBounds(room);
  const labelX = roomBounds.width / 2 + roomBounds.minX;
  const labelY = roomBounds.height / 2 + roomBounds.minY;

  const labelGroup = svgEl("g", { cursor: isSelected ? "text" : "pointer" });

  // Background pill for label
  const labelText = room.name || t("tabs.room");
  const fontSize = Math.min(16, Math.max(10, roomBounds.width / 10));

  const textEl = svgEl("text", {
    x: labelX,
    y: labelY,
    fill: isSelected ? "#3b82f6" : "rgba(231, 238, 252, 0.9)",
    "font-size": fontSize,
    "font-family": "system-ui, -apple-system, Segoe UI, Roboto, Arial",
    "font-weight": isSelected ? "600" : "500",
    "text-anchor": "middle",
    "dominant-baseline": "middle"
  });
  textEl.appendChild(document.createTextNode(labelText));
  labelGroup.appendChild(textEl);

  // Add click handler for inline name editing (matching exclusion label pattern)
  if (isSelected && onRoomNameEdit) {
    const openNameEdit = (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Hide the label group
      labelGroup.style.display = "none";

      // Start text editing mode - use absolute coordinates
      const absX = pos.x + labelX;
      const absY = pos.y + labelY;
      startSvgTextEdit({
        svg,
        x: absX,
        y: absY,
        value: room.name || "",
        textStyle: {
          fill: "#3b82f6",
          "font-size": fontSize,
          "font-family": "system-ui, -apple-system, Segoe UI, Roboto, Arial",
          "font-weight": "600"
        },
        onCommit: (newName) => {
          labelGroup.style.display = "";
          if (newName && newName.trim() !== (room.name || "").trim()) {
            onRoomNameEdit({ id: room.id, name: newName.trim() });
          }
        },
        onCancel: () => {
          labelGroup.style.display = "";
        }
      });
    };
    labelGroup.addEventListener("pointerdown", openNameEdit);
    labelGroup.addEventListener("click", openNameEdit);
  }

  roomGroup.appendChild(labelGroup);

  // Event handlers
  if (onRoomClick) {
    roomGroup.addEventListener("click", (e) => {
      e.stopPropagation();
      onRoomClick(room.id);
    });
  }

  if (onRoomDoubleClick) {
    roomGroup.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      onRoomDoubleClick(room.id);
    });
  }

  if (onRoomPointerDown) {
    roomGroup.addEventListener("pointerdown", (e) => {
      if (e.button === 0) { // Left mouse button
        onRoomPointerDown(e, room.id);
      }
    });
  }

  svg.appendChild(roomGroup);

  // Add resize handles for selected room (only for true axis-aligned rectangles)
  if (isSelected && onRoomResizePointerDown && isRectRoom(room)) {
    const handleRadius = 6;
    const handles = [
      { type: "nw", x: roomBounds.minX, y: roomBounds.minY, cursor: "nwse-resize" },
      { type: "ne", x: roomBounds.maxX, y: roomBounds.minY, cursor: "nesw-resize" },
      { type: "se", x: roomBounds.maxX, y: roomBounds.maxY, cursor: "nwse-resize" },
      { type: "sw", x: roomBounds.minX, y: roomBounds.maxY, cursor: "nesw-resize" },
      { type: "n", x: (roomBounds.minX + roomBounds.maxX) / 2, y: roomBounds.minY, cursor: "ns-resize" },
      { type: "s", x: (roomBounds.minX + roomBounds.maxX) / 2, y: roomBounds.maxY, cursor: "ns-resize" },
      { type: "e", x: roomBounds.maxX, y: (roomBounds.minY + roomBounds.maxY) / 2, cursor: "ew-resize" },
      { type: "w", x: roomBounds.minX, y: (roomBounds.minY + roomBounds.maxY) / 2, cursor: "ew-resize" }
    ];

    for (const h of handles) {
      const handle = svgEl("circle", {
        cx: pos.x + h.x,
        cy: pos.y + h.y,
        r: handleRadius,
        fill: "#3b82f6",
        stroke: "#fff",
        "stroke-width": 1.5,
        cursor: h.cursor,
        "data-roomid": room.id,
        "data-resize-handle": h.type
      });
      handle.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        onRoomResizePointerDown(e, room.id, h.type);
      });
      svg.appendChild(handle);
    }

    // Editable dimension labels (matching section pattern)
    const labelBaseStyle = {
      fill: "#3b82f6",
      "font-size": 11,
      "font-family": "system-ui, -apple-system, Segoe UI, Roboto, Arial",
      "font-weight": 500,
      "dominant-baseline": "middle"
    };
    const pad = 14;

    const fmtCm = (v) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return "0";
      return n % 1 === 0 ? String(n) : n.toFixed(1);
    };

    const addRoomEditableLabel = (text, value, key, x, y, anchor = "middle", angle = 0) => {
      const labelGroup = svgEl("g", { cursor: "text" });
      if (angle) {
        labelGroup.setAttribute("transform", `rotate(${angle} ${x} ${y})`);
      }
      const textEl = svgEl("text", { ...labelBaseStyle, x, y, "text-anchor": anchor });
      textEl.textContent = text;
      labelGroup.appendChild(textEl);
      svg.appendChild(labelGroup);

      if (!onRoomInlineEdit) return;
      const openEdit = (e) => {
        e.preventDefault();
        e.stopPropagation();
        labelGroup.style.display = "none";
        startSvgEdit({
          svg,
          x,
          y,
          angle,
          value,
          textStyle: labelBaseStyle,
          onCommit: (nextVal) => {
            labelGroup.style.display = "";
            onRoomInlineEdit({ id: room.id, key, value: nextVal });
          },
          onCancel: () => {
            labelGroup.style.display = "";
          },
          anchor
        });
      };
      labelGroup.addEventListener("pointerdown", openEdit);
      labelGroup.addEventListener("click", openEdit);
    };

    // Width label (bottom center)
    const widthLabelX = pos.x + roomBounds.minX + roomBounds.width / 2;
    const widthLabelY = pos.y + roomBounds.maxY + pad;
    addRoomEditableLabel(`${fmtCm(roomBounds.width)} cm`, roomBounds.width, "widthCm", widthLabelX, widthLabelY, "middle", 0);

    // Height label (right side, rotated)
    const heightLabelX = pos.x + roomBounds.maxX + pad;
    const heightLabelY = pos.y + roomBounds.minY + roomBounds.height / 2;
    addRoomEditableLabel(`${fmtCm(roomBounds.height)} cm`, roomBounds.height, "heightCm", heightLabelX, heightLabelY, "middle", 90);
  }

  // Add resize handles for selected circle/ellipse rooms
  if (isSelected && isCircleRoom(room) && onRoomResizePointerDown) {
    const { cx, cy, rx, ry } = room.circle;
    const handleRadius = 6;
    const handles = [
      { type: "n", x: cx, y: cy - ry, cursor: "ns-resize" },
      { type: "s", x: cx, y: cy + ry, cursor: "ns-resize" },
      { type: "e", x: cx + rx, y: cy, cursor: "ew-resize" },
      { type: "w", x: cx - rx, y: cy, cursor: "ew-resize" }
    ];

    for (const h of handles) {
      const handle = svgEl("circle", {
        cx: pos.x + h.x,
        cy: pos.y + h.y,
        r: handleRadius,
        fill: "#3b82f6",
        stroke: "#fff",
        "stroke-width": 1.5,
        cursor: h.cursor,
        "data-roomid": room.id,
        "data-resize-handle": h.type
      });
      handle.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        onRoomResizePointerDown(e, room.id, h.type);
      });
      svg.appendChild(handle);
    }

    // Editable dimension labels for circle/ellipse
    const labelBaseStyle = {
      fill: "#3b82f6",
      "font-size": 11,
      "font-family": "system-ui, -apple-system, Segoe UI, Roboto, Arial",
      "font-weight": 500,
      "dominant-baseline": "middle"
    };
    const pad = 14;

    const fmtCm = (v) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return "0";
      return n % 1 === 0 ? String(n) : n.toFixed(1);
    };

    const addRoomEditableLabel = (text, value, key, x, y, anchor = "middle", angle = 0) => {
      const labelGroup = svgEl("g", { cursor: "text" });
      if (angle) {
        labelGroup.setAttribute("transform", `rotate(${angle} ${x} ${y})`);
      }
      const textEl = svgEl("text", { ...labelBaseStyle, x, y, "text-anchor": anchor });
      textEl.textContent = text;
      labelGroup.appendChild(textEl);
      svg.appendChild(labelGroup);

      if (!onRoomInlineEdit) return;
      const openEdit = (e) => {
        e.preventDefault();
        e.stopPropagation();
        labelGroup.style.display = "none";
        startSvgEdit({
          svg,
          x,
          y,
          angle,
          value,
          textStyle: labelBaseStyle,
          onCommit: (nextVal) => {
            labelGroup.style.display = "";
            onRoomInlineEdit({ id: room.id, key, value: nextVal });
          },
          onCancel: () => {
            labelGroup.style.display = "";
          },
          anchor
        });
      };
      labelGroup.addEventListener("pointerdown", openEdit);
      labelGroup.addEventListener("click", openEdit);
    };

    // Width label (bottom center)
    const widthLabelX = pos.x + cx;
    const widthLabelY = pos.y + cy + ry + pad;
    addRoomEditableLabel(`${fmtCm(2 * rx)} cm`, 2 * rx, "widthCm", widthLabelX, widthLabelY, "middle", 0);

    // Height label (right side, rotated)
    const heightLabelX = pos.x + cx + rx + pad;
    const heightLabelY = pos.y + cy;
    addRoomEditableLabel(`${fmtCm(2 * ry)} cm`, 2 * ry, "heightCm", heightLabelX, heightLabelY, "middle", 90);
  }


  // Add vertex handles for selected free-form rooms (polygonVertices)
  if (isSelected && onVertexPointerDown && room.polygonVertices?.length > 0 && !isCircleRoom(room)) {
    const vertexHandleRadius = 6;

    for (let i = 0; i < room.polygonVertices.length; i++) {
      const vertex = room.polygonVertices[i];
      const absX = pos.x + vertex.x;
      const absY = pos.y + vertex.y;

      const handle = svgEl("circle", {
        cx: absX,
        cy: absY,
        r: vertexHandleRadius,
        fill: "#3b82f6",
        stroke: "#fff",
        "stroke-width": 2,
        cursor: "move",
        "data-vertex-roomid": room.id,
        "data-vertex-index": i
      });

      handle.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        onVertexPointerDown(e, room.id, i);
      });

      svg.appendChild(handle);
    }

    // Editable edge length labels for free-form rooms
    const edgeLabelStyle = {
      fill: "#3b82f6",
      "font-size": 11,
      "font-family": "system-ui, -apple-system, Segoe UI, Roboto, Arial",
      "font-weight": 500,
      "text-anchor": "middle",
      "dominant-baseline": "middle"
    };

    const fmtCm = (v) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return "0";
      return n % 1 === 0 ? String(n) : n.toFixed(1);
    };

    for (let i = 0; i < room.polygonVertices.length; i++) {
      const v1 = room.polygonVertices[i];
      const v2 = room.polygonVertices[(i + 1) % room.polygonVertices.length];

      // Calculate edge properties
      const dx = v2.x - v1.x;
      const dy = v2.y - v1.y;
      const edgeLength = Math.hypot(dx, dy);
      const midX = pos.x + (v1.x + v2.x) / 2;
      const midY = pos.y + (v1.y + v2.y) / 2;

      // Calculate angle for label rotation (perpendicular offset)
      let angle = Math.atan2(dy, dx) * (180 / Math.PI);
      // Flip text if it would be upside down
      if (angle > 90 || angle < -90) {
        angle += 180;
      }

      // Offset label perpendicular to edge (outside the polygon)
      const offsetDist = 12;
      const perpX = -dy / edgeLength * offsetDist;
      const perpY = dx / edgeLength * offsetDist;
      const labelX = midX + perpX;
      const labelY = midY + perpY;

      const labelGroup = svgEl("g", { cursor: "text" });
      labelGroup.setAttribute("transform", `rotate(${angle} ${labelX} ${labelY})`);
      const textEl = svgEl("text", { ...edgeLabelStyle, x: labelX, y: labelY });
      textEl.textContent = `${fmtCm(edgeLength)} cm`;
      labelGroup.appendChild(textEl);

      // Show secondary info: wall height if sloped, thickness if non-default
      const edgeLabelWall = floor ? getWallForEdge(floor, room.id, i) : null;
      if (edgeLabelWall) {
        const isSloped = edgeLabelWall.heightStartCm !== edgeLabelWall.heightEndCm;
        const nonDefaultThick = edgeLabelWall.thicknessCm !== 12;
        if (isSloped || nonDefaultThick) {
          const parts = [];
          if (nonDefaultThick) parts.push(`${fmtCm(edgeLabelWall.thicknessCm)}cm`);
          if (isSloped) parts.push(`↕${fmtCm(edgeLabelWall.heightStartCm)}→${fmtCm(edgeLabelWall.heightEndCm)}`);
          const subText = svgEl("text", {
            ...edgeLabelStyle,
            x: labelX,
            y: labelY + 12,
            fill: "#94a3b8",
            "font-size": 9
          });
          subText.textContent = parts.join(" · ");
          labelGroup.appendChild(subText);
        }
      }

      svg.appendChild(labelGroup);

      // Add click handler for inline edge length editing
      if (onPolygonEdgeEdit) {
        const edgeIndex = i;
        const openEdgeEdit = (e) => {
          e.preventDefault();
          e.stopPropagation();
          labelGroup.style.display = "none";
          startSvgEdit({
            svg,
            x: labelX,
            y: labelY,
            angle,
            value: edgeLength,
            textStyle: edgeLabelStyle,
            onCommit: (newLength) => {
              labelGroup.style.display = "";
              if (newLength > 0 && Math.abs(newLength - edgeLength) > 0.01) {
                onPolygonEdgeEdit({ id: room.id, edgeIndex, length: newLength });
              }
            },
            onCancel: () => {
              labelGroup.style.display = "";
            },
            anchor: "middle"
          });
        };
        labelGroup.addEventListener("pointerdown", openEdgeEdit);
        labelGroup.addEventListener("click", openEdgeEdit);
      }
    }
  }
}

/**
 * Renders a floor-level canvas showing all rooms on the floor.
 * Used in Floor View mode within the Planning tab.
 */
export function renderFloorCanvas({
  state,
  floor,
  selectedRoomId,
  onRoomClick,
  onRoomDoubleClick,
  onRoomPointerDown,
  onRoomResizePointerDown,
  onRoomInlineEdit,
  onVertexPointerDown,
  onRoomNameEdit,
  onPolygonEdgeEdit,
  svgOverride = null
}) {
  const svg = svgOverride || document.getElementById("planSvg");
  if (!svg) return;

  // Clear existing content
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  if (!floor) {
    svg.setAttribute("viewBox", "0 0 100 100");
    return;
  }

  // Get floor bounds - include background image extent if present
  let bounds;
  if (floor.rooms?.length) {
    bounds = getFloorBounds(floor);
  } else {
    // No rooms yet - use a default canvas size for background tracing
    bounds = { minX: 0, minY: 0, maxX: 1000, maxY: 800, width: 1000, height: 800 };
  }

  // Expand bounds to include background image if present
  const bg = floor.layout?.background;
  if (bg?.nativeWidth && bg?.nativeHeight) {
    const nativeW = bg.nativeWidth;
    const nativeH = bg.nativeHeight;
    let pixelsPerCm;
    if (bg.scale?.calibrated && bg.scale.pixelsPerCm) {
      pixelsPerCm = bg.scale.pixelsPerCm;
    } else {
      pixelsPerCm = nativeW / 1000;
    }
    const imgWidth = nativeW / pixelsPerCm;
    const imgHeight = nativeH / pixelsPerCm;
    const imgX = bg.position?.x || 0;
    const imgY = bg.position?.y || 0;

    // Expand bounds to include image
    bounds = {
      minX: Math.min(bounds.minX, imgX),
      minY: Math.min(bounds.minY, imgY),
      maxX: Math.max(bounds.maxX, imgX + imgWidth),
      maxY: Math.max(bounds.maxY, imgY + imgHeight),
    };
    bounds.width = bounds.maxX - bounds.minX;
    bounds.height = bounds.maxY - bounds.minY;
  }

  const padding = 80; // Padding around the floor

  const baseViewBox = {
    minX: bounds.minX - padding,
    minY: bounds.minY - padding,
    width: bounds.width + 2 * padding,
    height: bounds.height + 2 * padding
  };

  // Use floor-specific viewport key
  const viewportKey = `floor:${floor.id}`;
  setBaseViewBox(viewportKey, baseViewBox);

  // Apply zoom/pan from viewport
  const effectiveViewBox = calculateEffectiveViewBox(viewportKey) || baseViewBox;
  const viewBox = effectiveViewBox;

  svg.setAttribute("viewBox", `${viewBox.minX} ${viewBox.minY} ${viewBox.width} ${viewBox.height}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

  // Background
  const bgPadding = Math.max(viewBox.width, viewBox.height) * 2;
  svg.appendChild(svgEl("rect", {
    x: viewBox.minX - bgPadding,
    y: viewBox.minY - bgPadding,
    width: viewBox.width + 2 * bgPadding,
    height: viewBox.height + 2 * bgPadding,
    fill: "#081022"
  }));

  // Render background image if available
  if (floor.layout?.background?.dataUrl) {
    const bg = floor.layout.background;
    const imgAttrs = {
      href: bg.dataUrl,
      x: bg.position?.x || 0,
      y: bg.position?.y || 0,
      opacity: bg.opacity ?? 0.5,
      "pointer-events": bg.locked ? "none" : "all",
      preserveAspectRatio: "xMinYMin meet"
    };

    // Always render at native size with scale transform for consistency
    // This ensures calibration and rendering use the same coordinate system
    const nativeW = bg.nativeWidth || 1000;
    const nativeH = bg.nativeHeight || 1000;

    let pixelsPerCm;
    if (bg.scale?.calibrated && bg.scale.pixelsPerCm) {
      pixelsPerCm = bg.scale.pixelsPerCm;
    } else {
      // Default: fit image to ~1000 cm wide
      pixelsPerCm = nativeW / 1000;
    }

    const scale = 1 / pixelsPerCm;
    imgAttrs.transform = `scale(${scale})`;

    // White backing rect so transparent SVGs render with a white background
    const backingRect = svgEl("rect", {
      x: bg.position?.x || 0,
      y: bg.position?.y || 0,
      width: nativeW,
      height: nativeH,
      fill: "#ffffff",
      opacity: imgAttrs.opacity,
      transform: imgAttrs.transform,
      "pointer-events": "none"
    });
    svg.appendChild(backingRect);

    const imgEl = svgEl("image", imgAttrs);
    svg.appendChild(imgEl);
  }

  // Render grid if enabled - use viewBox with extra padding for aspect ratio letterboxing
  if (state.view?.showGrid) {
    const gridGroup = svgEl("g", { opacity: 0.5 });
    const minor = 10, major = 100;
    // Add extra padding to cover letterboxing from preserveAspectRatio
    const gridPadding = Math.max(viewBox.width, viewBox.height) * 0.5;
    const gridBounds = {
      minX: Math.floor((viewBox.minX - gridPadding) / major) * major,
      minY: Math.floor((viewBox.minY - gridPadding) / major) * major,
      maxX: Math.ceil((viewBox.minX + viewBox.width + gridPadding) / major) * major,
      maxY: Math.ceil((viewBox.minY + viewBox.height + gridPadding) / major) * major
    };

    for (let x = gridBounds.minX; x <= gridBounds.maxX; x += minor) {
      const isMajor = x % major === 0;
      gridGroup.appendChild(svgEl("line", {
        x1: x, y1: gridBounds.minY, x2: x, y2: gridBounds.maxY,
        stroke: isMajor ? "#1f2b46" : "#14203a",
        "stroke-width": isMajor ? 0.6 : 0.3
      }));
    }
    for (let y = gridBounds.minY; y <= gridBounds.maxY; y += minor) {
      const isMajor = y % major === 0;
      gridGroup.appendChild(svgEl("line", {
        x1: gridBounds.minX, y1: y, x2: gridBounds.maxX, y2: y,
        stroke: isMajor ? "#1f2b46" : "#14203a",
        "stroke-width": isMajor ? 0.6 : 0.3
      }));
    }
    svg.appendChild(gridGroup);
  }

  // Render rooms
  const roomsToRenderFloor = floor.rooms;

  for (const room of roomsToRenderFloor) {
    _renderFloorRoom(svg, room, floor, {
      state,
      selectedRoomId,
      onRoomClick,
      onRoomDoubleClick,
      onRoomPointerDown,
      onRoomResizePointerDown,
      onRoomInlineEdit,
      onVertexPointerDown,
      onRoomNameEdit,
      onPolygonEdgeEdit
    });
  }

  // Centralized wall geometry for floor-level rendering
  const floorWallGeometry = computeFloorWallGeometry(floor);

  // Render wall thickness outlines from wall entities (floor-level, once per wall)
  for (const wall of (floor.walls || [])) {
    if ((wall.thicknessCm ?? DEFAULT_WALL_THICKNESS_CM) <= 0) continue;
    const wallDesc = floorWallGeometry.get(wall.id);
    if (!wallDesc) continue;

    const ownerRoomId = wall.roomEdge?.roomId;
    const { A: s, B: e, OA: oS, OB: oE, L, innerAt, outerAt, dirX, dirY } = getWallRenderHelpers(wallDesc, ownerRoomId);

    const isWallSelected = ownerRoomId === selectedRoomId;
    const wallFill = isWallSelected ? "rgba(148, 163, 184, 0.35)" : "rgba(148, 163, 184, 0.15)";
    const wallStroke = isWallSelected ? "rgba(148, 163, 184, 0.7)" : "rgba(148, 163, 184, 0.35)";

    // Use pre-shifted doorways from centralized geometry (owner extStart already applied)
    const sortedDw = [...wallDesc.extDoorways].sort((a, b) => a.offsetCm - b.offsetCm);

    let cursor = 0;
    for (const dw of sortedDw) {
      const dwStart = Math.max(0, dw.offsetCm);
      const dwEnd = Math.min(L, dw.offsetCm + dw.widthCm);
      if (dwEnd <= dwStart) continue; // doorway entirely outside [0, L]
      if (dwStart > cursor + 0.5) {
        const tC = cursor / L, tD = dwStart / L;
        const iC = innerAt(tC), iD = innerAt(tD);
        const oC = outerAt(tC), oD = outerAt(tD);
        svg.appendChild(svgEl("path", {
          d: `M ${iC.x} ${iC.y} L ${iD.x} ${iD.y} L ${oD.x} ${oD.y} L ${oC.x} ${oC.y} Z`,
          fill: wallFill, stroke: wallStroke, "stroke-width": 0.5, "pointer-events": "none"
        }));
      }
      // Doorway gap marker
      const gapSx = s.x + dirX * dwStart;
      const gapSy = s.y + dirY * dwStart;
      const gapEx = s.x + dirX * dwEnd;
      const gapEy = s.y + dirY * dwEnd;
      svg.appendChild(svgEl("line", {
        x1: gapSx, y1: gapSy, x2: gapEx, y2: gapEy,
        stroke: "#f59e0b", "stroke-width": 2, "stroke-dasharray": "4 2", "pointer-events": "none"
      }));
      cursor = Math.max(cursor, dwEnd);
    }
    if (cursor < L - 0.5) {
      const tC = cursor / L;
      const iC = innerAt(tC), iD = innerAt(1);
      const oC = outerAt(tC), oD = outerAt(1);
      svg.appendChild(svgEl("path", {
        d: `M ${iC.x} ${iC.y} L ${iD.x} ${iD.y} L ${oD.x} ${oD.y} L ${oC.x} ${oC.y} Z`,
        fill: wallFill, stroke: wallStroke, "stroke-width": 0.5, "pointer-events": "none"
      }));
    }
  }

  // Render global origin marker if pattern linking is enabled
  if (floor.patternLinking?.enabled) {
    const origin = floor.patternLinking.globalOrigin || { x: 0, y: 0 };
    const markerSize = 8;

    const markerGroup = svgEl("g", {
      transform: `translate(${origin.x}, ${origin.y})`,
      cursor: "move"
    });

    // Crosshair
    markerGroup.appendChild(svgEl("line", {
      x1: -markerSize,
      y1: 0,
      x2: markerSize,
      y2: 0,
      stroke: "#22c55e",
      "stroke-width": 2
    }));
    markerGroup.appendChild(svgEl("line", {
      x1: 0,
      y1: -markerSize,
      x2: 0,
      y2: markerSize,
      stroke: "#22c55e",
      "stroke-width": 2
    }));

    // Circle around crosshair
    markerGroup.appendChild(svgEl("circle", {
      cx: 0,
      cy: 0,
      r: markerSize + 2,
      fill: "none",
      stroke: "#22c55e",
      "stroke-width": 1.5
    }));

    svg.appendChild(markerGroup);
  }

  // Update scale indicator if background is calibrated
  const scaleIndicator = document.getElementById("floorScaleIndicator");
  const scaleText = document.getElementById("floorScaleText");
  if (scaleIndicator && scaleText) {
    const bg = floor.layout?.background;
    if (bg?.scale?.calibrated && bg.scale.pixelsPerCm) {
      scaleIndicator.classList.remove("hidden");
      // Just show "100 cm" - the bar visually represents this length
      scaleText.textContent = "100 cm";
    } else {
      scaleIndicator.classList.add("hidden");
    }
  }
}


export { renderPatternGroupsCanvas } from "./render-pattern-groups.js";
