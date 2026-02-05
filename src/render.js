// src/render.js
import { computePlanMetrics, computeSkirtingNeeds, computeGrandTotals, computeProjectTotals, getRoomPricing } from "./calc.js";
import { validateState } from "./validation.js";
import { escapeHTML, getCurrentRoom, getCurrentFloor, DEFAULT_TILE_PRESET, DEFAULT_SKIRTING_PRESET, DEFAULT_WASTE } from "./core.js";
import { setInlineEditing, getUiState } from "./ui_state.js";
import { t } from "./i18n.js";
import {
  svgEl,
  multiPolygonToPathD,
  computeExclusionsUnion,
  computeAvailableArea,
  roomPolygon,
  tilesForPreview,
  getRoomBounds,
  computeOriginPoint,
  computeMultiPolygonPerimeter,
  computeSkirtingSegments
} from "./geometry.js";
import { EPSILON } from "./constants.js";
import { setBaseViewBox, calculateEffectiveViewBox, getViewport } from "./viewport.js";
import { getFloorBounds } from "./floor_geometry.js";
import { computePatternGroupOrigin, getEffectiveTileSettings, getRoomPatternGroup, isPatternGroupChild } from "./pattern-groups.js";

let activeSvgEdit = null;

function closeSvgEdit(commit) {
  if (!activeSvgEdit) return;
  const { group, onCommit, buffer, onKeyDown, onPointerDown } = activeSvgEdit;
  if (commit) {
    const value = Number(buffer);
    if (Number.isFinite(value)) {
      onCommit(value);
    }
  }
  if (onKeyDown) document.removeEventListener("keydown", onKeyDown);
  if (onPointerDown) document.removeEventListener("pointerdown", onPointerDown, true);
  group.remove();
  activeSvgEdit = null;
  setInlineEditing(false);
}

function updateEditText() {
  if (!activeSvgEdit) return;
  const { textEl, buffer, prefix } = activeSvgEdit;
  textEl.textContent = `${prefix || ""}|${buffer}`;
}

function startSvgEdit({ svg, x, y, angle = 0, value, onCommit, onCancel, textStyle, anchor = "middle", prefix = "" }) {
  closeSvgEdit(false);

  const group = svgEl("g", { "data-inline-edit": "true" });
  if (angle) {
    group.setAttribute("transform", `rotate(${angle} ${x} ${y})`);
  }
  const textEl = svgEl("text", { ...textStyle, x, y, "text-anchor": anchor, "dominant-baseline": "middle" });
  group.appendChild(textEl);
  svg.appendChild(group);

  activeSvgEdit = {
    group,
    textEl,
    buffer: Number.isFinite(value) ? value.toFixed(2) : String(value ?? ""),
    onCommit,
    onCancel,
    prefix,
    replaceOnType: true
  };

  updateEditText();
  setInlineEditing(true);

  const onKeyDown = (e) => {
    if (!activeSvgEdit) return;
    if (e.key === "Enter") {
      e.preventDefault();
      closeSvgEdit(true);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      closeSvgEdit(false);
      if (activeSvgEdit?.onCancel) activeSvgEdit.onCancel();
      return;
    }
    if (e.key === "Backspace") {
      e.preventDefault();
      if (activeSvgEdit.replaceOnType) {
        activeSvgEdit.buffer = "";
        activeSvgEdit.replaceOnType = false;
      } else {
        activeSvgEdit.buffer = activeSvgEdit.buffer.slice(0, -1);
      }
      updateEditText();
      return;
    }
    if (e.key.length === 1) {
      const ch = e.key === "," ? "." : e.key;
      if (/^[0-9.\-]$/.test(ch)) {
        e.preventDefault();
        if (activeSvgEdit.replaceOnType) {
          activeSvgEdit.buffer = ch;
          activeSvgEdit.replaceOnType = false;
          updateEditText();
          return;
        }
        if (ch === "-" && activeSvgEdit.buffer.length > 0) return;
        if (ch === "." && activeSvgEdit.buffer.includes(".")) return;
        activeSvgEdit.buffer += ch;
        updateEditText();
      }
    }
  };

  const onPointerDown = (e) => {
    if (!activeSvgEdit) return;
    if (e.composedPath().includes(group)) return;
    closeSvgEdit(true);
    if (activeSvgEdit?.onCancel) activeSvgEdit.onCancel();
  };

  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("pointerdown", onPointerDown, true);

  activeSvgEdit.onKeyDown = onKeyDown;
  activeSvgEdit.onPointerDown = onPointerDown;
}

let activeSvgTextEdit = null;

function closeSvgTextEdit(commit) {
  if (!activeSvgTextEdit) return;
  const { group, onCommit, onCancel, buffer, onKeyDown, onPointerDown } = activeSvgTextEdit;
  if (commit && buffer.trim()) {
    onCommit(buffer);
  } else if (!commit && onCancel) {
    onCancel();
  }
  if (onKeyDown) document.removeEventListener("keydown", onKeyDown);
  if (onPointerDown) document.removeEventListener("pointerdown", onPointerDown, true);
  group.remove();
  activeSvgTextEdit = null;
  setInlineEditing(false);
}

function updateTextEditDisplay() {
  if (!activeSvgTextEdit) return;
  const { textEl, buffer } = activeSvgTextEdit;
  textEl.textContent = buffer + "|";
}

/**
 * Start inline text editing for arbitrary text (not just numbers)
 */
function startSvgTextEdit({ svg, x, y, value, onCommit, onCancel, textStyle, anchor = "middle" }) {
  closeSvgTextEdit(false);
  closeSvgEdit(false);

  const group = svgEl("g", { "data-inline-edit": "true" });
  const textEl = svgEl("text", { ...textStyle, x, y, "text-anchor": anchor, "dominant-baseline": "middle" });
  group.appendChild(textEl);
  svg.appendChild(group);

  activeSvgTextEdit = {
    group,
    textEl,
    buffer: String(value ?? ""),
    onCommit,
    onCancel,
    replaceOnType: true
  };

  updateTextEditDisplay();
  setInlineEditing(true);

  const onKeyDown = (e) => {
    if (!activeSvgTextEdit) return;
    if (e.key === "Enter") {
      e.preventDefault();
      closeSvgTextEdit(true);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      closeSvgTextEdit(false);
      return;
    }
    if (e.key === "Backspace") {
      e.preventDefault();
      if (activeSvgTextEdit.replaceOnType) {
        activeSvgTextEdit.buffer = "";
        activeSvgTextEdit.replaceOnType = false;
      } else {
        activeSvgTextEdit.buffer = activeSvgTextEdit.buffer.slice(0, -1);
      }
      updateTextEditDisplay();
      return;
    }
    // Accept any printable character
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      if (activeSvgTextEdit.replaceOnType) {
        activeSvgTextEdit.buffer = e.key;
        activeSvgTextEdit.replaceOnType = false;
      } else {
        activeSvgTextEdit.buffer += e.key;
      }
      updateTextEditDisplay();
    }
  };

  const onPointerDown = (e) => {
    if (!activeSvgTextEdit) return;
    if (e.composedPath().includes(group)) return;
    closeSvgTextEdit(true);
  };

  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("pointerdown", onPointerDown, true);

  activeSvgTextEdit.onKeyDown = onKeyDown;
  activeSvgTextEdit.onPointerDown = onPointerDown;
}

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

export function renderMetrics(state) {
  const areaEl = document.getElementById("metricArea");
  const tilesEl = document.getElementById("metricTiles");
  const packsEl = document.getElementById("metricPacks");
  const costEl = document.getElementById("metricCost");
  const cutTilesEl = document.getElementById("metricCutTiles");
  const wasteEl = document.getElementById("metricWaste");

  if (!areaEl || !tilesEl || !packsEl || !costEl) return;

  const { errors } = validateState(state);
  const ratioError = errors.find(e => 
    e.title.includes(t("validation.herringboneRatioTitle")) || 
    e.title.includes(t("validation.doubleHerringboneRatioTitle")) || 
    e.title.includes(t("validation.basketweaveRatioTitle"))
  );

  const m = computePlanMetrics(state);
  if (!m.ok || ratioError) {
    areaEl.textContent = "–";
    tilesEl.textContent = "–";
    packsEl.textContent = "–";
    costEl.textContent = ratioError ? `${t("warnings.error")}: ${ratioError.title}` : m.error;
    if (cutTilesEl) cutTilesEl.textContent = "–";
    if (wasteEl) wasteEl.textContent = "–";

    const grandBox = document.getElementById("grandTotalBox");
    if (grandBox) grandBox.style.display = "none";
    
    return;
  }

  const d = m.data;
  const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : "–");
  const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : "–");

  areaEl.textContent = `${f2(d.area.netAreaM2)} m²`;
  tilesEl.textContent = `${d.tiles.totalTilesWithReserve} (${d.tiles.fullTiles} full, ${d.tiles.cutTiles} cut, ${d.tiles.reusedCuts} reused)`;

  const packs = d.pricing.packs;
  if (packs !== null && packs > 0) {
    packsEl.textContent = `${packs} (${f2(d.material.purchasedAreaM2)} m²)`;
  } else {
    packsEl.textContent = `${f2(d.material.purchasedAreaM2)} m²`;
  }

  costEl.textContent = `${f2(d.pricing.priceTotal)} €`;

  if (cutTilesEl) {
    cutTilesEl.textContent = `${d.labor.cutTiles} (${f1(d.labor.cutTilesPct)}%)`;
  }

  if (wasteEl) {
    wasteEl.textContent = `${f2(d.material.wasteAreaM2)} m² (${f1(d.material.wastePct)}%, ~${d.material.wasteTiles_est} tiles)`;
  }

  // Skirting Metrics
  const skirting = computeSkirtingNeeds(state);
  const skirtingBox = document.getElementById("skirtingMetricsBox");
  if (skirtingBox) {
    if (skirting.enabled) {
      skirtingBox.style.display = "block";
      document.getElementById("metricSkirtingLength").textContent = skirting.totalLengthCm.toFixed(1);
      document.getElementById("metricSkirtingCount").textContent = skirting.count;
      document.getElementById("metricSkirtingCost").textContent = skirting.totalCost.toFixed(2) + " €";
      
      const labelCount = document.getElementById("labelSkirtingPieces");
      const stripsWrap = document.getElementById("stripsPerTileWrap");
      
      if (skirting.type === "bought") {
        labelCount.textContent = t("skirting.pieces");
        stripsWrap.style.display = "none";
      } else {
        labelCount.textContent = t("skirting.additionalTiles");
        stripsWrap.style.display = "block";
        document.getElementById("metricSkirtingStripsPerTile").textContent = skirting.stripsPerTile;
      }
    } else {
      skirtingBox.style.display = "none";
    }
  }

  // Grand Total Metrics
  const grand = computeGrandTotals(state);
  const grandBox = document.getElementById("grandTotalBox");
  if (grandBox) {
    if (grand.ok && grand.skirtingEnabled && !ratioError) {
      grandBox.style.display = "block";
      document.getElementById("metricGrandTotalTiles").textContent = grand.totalTiles;
      
      const packsEl = document.getElementById("metricGrandTotalPacks");
      if (grand.totalPacks !== null) {
        packsEl.textContent = `${grand.totalPacks} (${f2(grand.purchasedAreaM2)} m²)`;
      } else {
        packsEl.textContent = `${f2(grand.purchasedAreaM2)} m²`;
      }

      document.getElementById("metricGrandTotalCost").textContent = grand.totalCost.toFixed(2) + " €";
    } else {
      grandBox.style.display = "none";
    }
  }
}

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

export function renderRoomForm(state) {
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


export function renderTilePresetPicker(state, currentRoom) {
  const sel = document.getElementById("tilePresetSelect");
  if (!sel) return;
  const presets = state.tilePresets || [];
  sel.innerHTML = "";
  sel.disabled = presets.length === 0;
  const presetRow = document.getElementById("tilePresetRow");
  const emptyRow = document.getElementById("tilePresetEmptyRow");
  if (presetRow) presetRow.classList.toggle("hidden", presets.length === 0);
  if (emptyRow) emptyRow.classList.toggle("hidden", presets.length > 0);
  let matchId = "";
  const ref = currentRoom?.tile?.reference;
  if (ref) {
    const match = presets.find(p => p?.name && p.name === ref);
    if (match) matchId = match.id;
  }
  presets.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name || t("project.none");
    if (p.id === matchId) opt.selected = true;
    sel.appendChild(opt);
  });
}

export function renderSkirtingPresetPicker(state) {
  const sel = document.getElementById("skirtingPresetSelect");
  if (!sel) return;
  const presets = state.skirtingPresets || [];
  sel.innerHTML = "";
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = presets.length ? "–" : t("project.none");
  sel.appendChild(empty);
  presets.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name || t("project.none");
    sel.appendChild(opt);
  });
}


export function renderReferencePicker(state) {
  const dl = document.getElementById("tileReferences");
  if (!dl) return;

  const refs = new Set();
  if (state.materials) {
    Object.keys(state.materials).forEach((r) => {
      if (r) refs.add(r);
    });
  }
  if (Array.isArray(state.tilePresets)) {
    state.tilePresets.forEach(p => {
      if (p?.name) refs.add(p.name);
    });
  }
  if (state.floors) {
    state.floors.forEach((f) => {
      if (f.rooms) {
        f.rooms.forEach((rm) => {
          if (rm.tile?.reference) refs.add(rm.tile.reference);
        });
      }
    });
  }

  dl.innerHTML = "";
  Array.from(refs)
    .sort()
    .forEach((r) => {
      const opt = document.createElement("option");
      opt.value = r;
      dl.appendChild(opt);
    });
}

export function renderTilePatternForm(state) {
  const currentRoom = getCurrentRoom(state);
  const currentFloor = getCurrentFloor(state);
  const uiState = getUiState();
  const tileEditActive = uiState.tileEditActive;
  const tileEditDirty = uiState.tileEditDirty;
  const tileEditMode = uiState.tileEditMode || "edit";
  const tileEditHasPreset = uiState.tileEditHasPreset === true;

  // Check if room is a child in a pattern group (inherits settings from origin)
  const isChild = isPatternGroupChild(currentRoom, currentFloor);
  const effectiveSettings = isChild ? getEffectiveTileSettings(currentRoom, currentFloor) : null;
  const displayRoom = isChild && effectiveSettings ? {
    ...currentRoom,
    tile: effectiveSettings.tile,
    pattern: effectiveSettings.pattern,
    grout: effectiveSettings.grout
  } : currentRoom;

  // Show/hide pattern group child notice and overlay
  let childNotice = document.getElementById("patternGroupChildNotice");
  if (!childNotice) {
    // Create notice element if it doesn't exist
    const tileSection = document.getElementById("planningTileSection");
    if (tileSection) {
      childNotice = document.createElement("div");
      childNotice.id = "patternGroupChildNotice";
      childNotice.className = "pattern-group-child-notice";
      const sectionTitle = tileSection.querySelector(".panel-section-title");
      if (sectionTitle) {
        sectionTitle.after(childNotice);
      }
    }
  }

  // Get origin room info for messages
  const group = isChild ? getRoomPatternGroup(currentFloor, currentRoom?.id) : null;
  const originRoom = group ? currentFloor?.rooms?.find(r => r.id === group.originRoomId) : null;
  const originName = originRoom?.name || "Origin";

  if (childNotice) {
    childNotice.classList.toggle("hidden", !isChild);
    if (isChild) {
      childNotice.innerHTML = `<span class="notice-icon">🔗</span> ${t("patternGroups.childNotice").replace("{origin}", originName)}`;
    }
  }

  // Add locked class to settings panel sections for pattern group children
  // This enables CSS pseudo-element overlays that capture clicks
  const tileFieldsSection = document.querySelector("#planningTileSection .panel-fields");
  const groutFieldsSection = document.getElementById("groutW")?.closest(".panel-section")?.querySelector(".panel-fields");
  const patternFieldsSection = document.getElementById("patternType")?.closest(".panel-section")?.querySelector(".panel-fields");

  [tileFieldsSection, groutFieldsSection, patternFieldsSection].forEach(section => {
    if (section) {
      section.classList.toggle("pattern-group-locked", isChild);
      if (isChild) {
        section.dataset.originName = originName;
      }
    }
  });

  renderReferencePicker(state);
  renderTilePresetPicker(state, currentRoom);
  renderSkirtingPresetPicker(state);

  const editToggle = document.getElementById("tileConfigEditToggle");
  if (editToggle) {
    editToggle.checked = tileEditActive;
    editToggle.disabled = isChild;
  }

  const ref = displayRoom?.tile?.reference;
  const preset = ref ? state.tilePresets?.find(p => p?.name && p.name === ref) : null;
  const editActions = document.getElementById("tileEditActions");
  if (editActions) editActions.classList.toggle("hidden", !tileEditActive || isChild);
  const editUpdateBtn = document.getElementById("tileEditUpdateBtn");
  const editSaveBtn = document.getElementById("tileEditSaveBtn");
  const hasPreset = tileEditHasPreset || Boolean(preset);
  if (editUpdateBtn) editUpdateBtn.style.display = tileEditActive && !isChild && tileEditMode !== "create" && hasPreset ? "" : "none";
  if (editSaveBtn) editSaveBtn.style.display = tileEditActive && !isChild && (tileEditMode === "create" || hasPreset) ? "" : "none";
  if (editSaveBtn) {
    editSaveBtn.textContent = tileEditMode === "create"
      ? t("planning.tileEditSaveCreate")
      : t("planning.tileEditSaveNew");
  }

  const isCreateMode = tileEditMode === "create";
  const tileShapeEl = document.getElementById("tileShape");
  if (tileShapeEl) tileShapeEl.value = displayRoom?.tile?.shape ?? "rect";
  const tileWEl = document.getElementById("tileW");
  const tileHEl = document.getElementById("tileH");
  if (!isCreateMode) {
    if (tileWEl) tileWEl.value = displayRoom?.tile?.widthCm ?? "";
    if (tileHEl) tileHEl.value = displayRoom?.tile?.heightCm ?? "";
  }
  // Display grout in mm (state stores cm)
  document.getElementById("groutW").value = Math.round((displayRoom?.grout?.widthCm ?? 0) * 10);
  const groutColorValue = displayRoom?.grout?.colorHex ?? "#ffffff";
  document.getElementById("groutColor").value = groutColorValue;
  const pricing = displayRoom ? getRoomPricing(state, displayRoom) : { pricePerM2: 0, packM2: 0 };
  const pricePerM2 = document.getElementById("tilePricePerM2");
  if (pricePerM2 && !isCreateMode) pricePerM2.value = pricing.pricePerM2 ?? 0;
  const packM2 = document.getElementById("tilePackM2");
  if (packM2 && !isCreateMode) packM2.value = pricing.packM2 ?? 0;
  const pricePerPack = document.getElementById("tilePricePerPack");
  if (pricePerPack) {
    const packVal = Number(pricing.packM2) || 0;
    const perM2 = Number(pricing.pricePerM2) || 0;
    pricePerPack.value = packVal > 0 ? (packVal * perM2).toFixed(2) : "";
  }
  const allowSkirting = document.getElementById("tileAllowSkirting");
  if (allowSkirting && !isCreateMode) allowSkirting.checked = Boolean(preset?.useForSkirting);

  // Tile edit inputs - disabled when child in pattern group
  const editInputs = [
    "tileReference",
    "tileShape",
    "tileW",
    "tileH",
    "tilePricePerM2",
    "tilePackM2",
    "tileAllowSkirting"
  ];
  editInputs.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = isChild || !tileEditActive;
  });
  const refInput = document.getElementById("tileReference");
  if (refInput) {
    if (tileEditActive && !isChild) {
      refInput.removeAttribute("list");
    } else {
      refInput.setAttribute("list", "tileReferences");
    }
  }
  const tileConfigFields = document.querySelector(".tile-config-fields");
  if (tileConfigFields) tileConfigFields.classList.toggle("is-readonly", isChild || !tileEditActive);

  // Tile preset select - disabled when child in pattern group
  const tilePresetSelect = document.getElementById("tilePresetSelect");
  if (tilePresetSelect) tilePresetSelect.disabled = isChild;

  // Update preset swatch selection
  document.querySelectorAll("#groutColorPresets .color-swatch").forEach(swatch => {
    if (swatch.dataset.color?.toLowerCase() === groutColorValue.toLowerCase()) {
      swatch.classList.add("selected");
    } else {
      swatch.classList.remove("selected");
    }
  });

  // Grout controls - disabled when child in pattern group
  const groutWEl = document.getElementById("groutW");
  const groutColorEl = document.getElementById("groutColor");
  if (groutWEl) groutWEl.disabled = isChild;
  if (groutColorEl) groutColorEl.disabled = isChild;
  document.querySelectorAll("#groutColorPresets .color-swatch").forEach(swatch => {
    swatch.classList.toggle("disabled", isChild);
  });

  document.getElementById("patternType").value = displayRoom?.pattern?.type ?? "grid";
  document.getElementById("bondFraction").value = String(
    displayRoom?.pattern?.bondFraction ?? 0.5
  );
  document.getElementById("rotationDeg").value = String(
    displayRoom?.pattern?.rotationDeg ?? 0
  );
  document.getElementById("offsetX").value = displayRoom?.pattern?.offsetXcm ?? 0;
  document.getElementById("offsetY").value = displayRoom?.pattern?.offsetYcm ?? 0;

  document.getElementById("originPreset").value =
    displayRoom?.pattern?.origin?.preset ?? "tl";
  document.getElementById("originX").value = displayRoom?.pattern?.origin?.xCm ?? 0;
  document.getElementById("originY").value = displayRoom?.pattern?.origin?.yCm ?? 0;

  // Pattern controls - disabled when child in pattern group
  const patternInputs = [
    "patternType",
    "bondFraction",
    "rotationDeg",
    "offsetX",
    "offsetY",
    "originPreset",
    "originX",
    "originY"
  ];
  patternInputs.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = isChild;
  });

  const isRB = displayRoom?.pattern?.type === "runningBond";
  if (!isChild) {
    document.getElementById("bondFraction").disabled = !isRB;
  }
  // Also hide bondFraction field if not RB
  const bondFractionField = document.getElementById("bondFraction")?.closest(".field");
  if (bondFractionField) {
    bondFractionField.style.display = isRB ? "" : "none";
  }

  const shape = displayRoom?.tile?.shape || "rect";
  const tileHField = document.getElementById("tileHeightField");
  const hexHint = document.getElementById("hexHint");

  if (shape === "hex") {
    if (tileHField) tileHField.style.display = "none";
    if (hexHint) hexHint.style.display = "block";
    const patternTypeField = document.getElementById("patternType")?.closest(".field");
    if (patternTypeField) patternTypeField.style.display = "none";
  } else if (shape === "square") {
    if (tileHField) tileHField.style.display = "none";
    if (hexHint) hexHint.style.display = "none";
    const patternTypeField = document.getElementById("patternType")?.closest(".field");
    if (patternTypeField) patternTypeField.style.display = "";

    // Update applicable patterns for square
    const patternTypeSelect = document.getElementById("patternType");
    if (patternTypeSelect) {
      Array.from(patternTypeSelect.options).forEach(opt => {
        const squareInapplicable = ["herringbone", "doubleHerringbone", "basketweave", "verticalStackAlternating"];
        opt.hidden = squareInapplicable.includes(opt.value);
        opt.disabled = opt.hidden;
      });
    }
  } else if (shape === "rhombus") {
    if (tileHField) tileHField.style.display = "";
    if (hexHint) hexHint.style.display = "none";
    const patternTypeField = document.getElementById("patternType")?.closest(".field");
    if (patternTypeField) patternTypeField.style.display = "none";
  } else {
    if (tileHField) tileHField.style.display = "";
    if (hexHint) hexHint.style.display = "none";
    const patternTypeField = document.getElementById("patternType")?.closest(".field");
    if (patternTypeField) patternTypeField.style.display = "";

    // Update applicable patterns
    const patternTypeSelect = document.getElementById("patternType");
    if (patternTypeSelect) {
      const tw = currentRoom?.tile?.widthCm || 0;
      const th = currentRoom?.tile?.heightCm || 0;
      const isSquare = Math.abs(tw - th) < EPSILON;

      Array.from(patternTypeSelect.options).forEach(opt => {
        if (isSquare && tw > 0) {
          const squareInapplicable = ["herringbone", "doubleHerringbone", "basketweave", "verticalStackAlternating"];
          opt.hidden = squareInapplicable.includes(opt.value);
          opt.disabled = opt.hidden;
        } else {
          opt.hidden = false;
          opt.disabled = false;
        }
      });
    }
  }

  const reserveTiles = document.getElementById("reserveTiles");
  if (reserveTiles) reserveTiles.value = state.pricing?.reserveTiles ?? 0;

  // Waste options
  const allowRotate = document.getElementById("wasteAllowRotate");
  if (allowRotate) allowRotate.checked = state?.waste?.allowRotate !== false;

  const shareOffcuts = document.getElementById("wasteShareOffcuts");
  if (shareOffcuts) shareOffcuts.checked = Boolean(state?.waste?.shareOffcuts);

  const optimizeCuts = document.getElementById("wasteOptimizeCuts");
  if (optimizeCuts) optimizeCuts.checked = Boolean(state?.waste?.optimizeCuts);

  // Debug option
  const debugShowNeeds = document.getElementById("debugShowNeeds");
  if (debugShowNeeds) debugShowNeeds.checked = Boolean(state?.view?.showNeeds);

  // Schnittbreite
  const kerfEl = document.getElementById("wasteKerfCm");
  if (kerfEl) kerfEl.value = Math.round((state?.waste?.kerfCm ?? DEFAULT_WASTE.kerfCm) * 10);
}

export function renderExclList(state, selectedExclId) {
  const sel = document.getElementById("exclList");
  sel.innerHTML = "";
  const currentRoom = getCurrentRoom(state);
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
  exportStyle = null
}) {
  const svg = svgOverride || document.getElementById("planSvg");
  const currentRoom = getCurrentRoom(state);
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
  const exclusions = currentRoom.exclusions || [];
  const displayExclusions = includeExclusions ? exclusions : [];

  if (!svgOverride) {
    const resizeOverlay = document.getElementById("resizeMetrics");
    if (resizeOverlay) {
      resizeOverlay.classList.add("hidden");
    }
    closeSvgEdit(false);
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
    const avail = computeAvailableArea(currentRoom, exclusions);
    if (avail.error) setLastTileError(avail.error);
    else setLastTileError(null);

    if (avail.mp) {
      // Check if room is in a pattern group and compute shared origin
      const currentFloor = state.floors?.find(f => f.id === state.selectedFloorId);
      const patternGroupOrigin = computePatternGroupOrigin(currentRoom, currentFloor);

      // Get effective settings (from origin room if in pattern group)
      const effectiveSettings = getEffectiveTileSettings(currentRoom, currentFloor);

      const t = tilesForPreview(state, avail.mp, isRemovalMode, false, currentFloor, { originOverride: patternGroupOrigin, effectiveSettings });
      if (t.error) setLastTileError(t.error);
      else setLastTileError(null);

      previewTiles = t.tiles;

      const g = svgEl("g", { opacity: 1, "pointer-events": isRemovalMode ? "auto" : "none" });
      svg.appendChild(g);

      const groutWidth = effectiveSettings.grout?.widthCm || 0;
      const groutHex = groutWidth > 0 ? (effectiveSettings.grout?.colorHex || "#ffffff") : "#ffffff";
      const groutRgb = hexToRgb(groutHex);

    for (const tile of t.tiles) {
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
  }

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
    const u = computeExclusionsUnion(displayExclusions);
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
  }

  // Skirting Visualization
  if (state.view?.showSkirting) {
    const isRemovalMode = Boolean(state.view?.removalMode);
    const segments = computeSkirtingSegments(currentRoom, isRemovalMode);

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
        : (Number(currentRoom.tile?.widthCm) || DEFAULT_TILE_PRESET.widthCm);

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
  const gEx = svgEl("g");
  for (const ex of displayExclusions) {
    const isSel = ex.id === selectedExclId;
    // Match section styling pattern: selected has higher opacity, unselected is more subtle
    const common = {
      fill: isExportBW ? "rgba(0,0,0,0.12)" : (isSel ? "rgba(239,68,68,0.15)" : "rgba(239,68,68,0.06)"),
      stroke: isExportBW ? "#111111" : (isSel ? "rgba(239,68,68,1)" : "rgba(239,68,68,0.8)"),
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

    // Add resize handles for selected exclusion
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
        // Corner handles (nw, ne, sw, se) and edge handles (n, s, e, w)
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
        // Single handle on the edge for radius
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
        // Handles at each vertex
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
        // Vertex handles for freeform exclusions
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

        // Edge length labels
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
export function renderCommercialTab(state) {
  const roomsListEl = document.getElementById("commercialRoomsList");
  const materialsListEl = document.getElementById("commercialMaterialsList");
  if (!roomsListEl || !materialsListEl) return;

  const proj = computeProjectTotals(state);

  // 1. Render Rooms Table
  roomsListEl.replaceChildren();
  const roomsTable = document.createElement("table");
  roomsTable.className = "commercial-table";
  const roomsThead = document.createElement("thead");
  const roomsHeadRow = document.createElement("tr");
  const roomsHeaders = [
    { label: t("tabs.floor") },
    { label: t("tabs.room") },
    { label: t("tile.reference") },
    { label: t("metrics.netArea"), align: "right" },
    { label: t("metrics.totalTiles"), align: "right" },
    { label: t("metrics.price"), align: "right" }
  ];
  roomsHeaders.forEach(({ label, align }) => {
    const th = document.createElement("th");
    th.textContent = label;
    if (align) th.style.textAlign = align;
    roomsHeadRow.appendChild(th);
  });
  roomsThead.appendChild(roomsHeadRow);
  roomsTable.appendChild(roomsThead);
  const roomsTbody = document.createElement("tbody");
  for (const r of proj.rooms) {
    const tr = document.createElement("tr");
    const floorTd = document.createElement("td");
    floorTd.className = "subtle";
    floorTd.textContent = r.floorName || "";
    const roomTd = document.createElement("td");
    roomTd.className = "room-name";
    roomTd.textContent = r.name || "";
    const refTd = document.createElement("td");
    refTd.className = "material-ref";
    refTd.textContent = r.reference || "-";
    const areaTd = document.createElement("td");
    areaTd.style.textAlign = "right";
    areaTd.textContent = `${r.netAreaM2.toFixed(2)} m²`;
    const tilesTd = document.createElement("td");
    tilesTd.style.textAlign = "right";
    tilesTd.textContent = String(r.totalTiles);
    const costTd = document.createElement("td");
    costTd.style.textAlign = "right";
    costTd.textContent = `${r.totalCost.toFixed(2)} €`;
    tr.append(floorTd, roomTd, refTd, areaTd, tilesTd, costTd);
    roomsTbody.appendChild(tr);
  }
  roomsTable.appendChild(roomsTbody);
  roomsListEl.appendChild(roomsTable);

  // 2. Render Consolidated Materials Table
  materialsListEl.replaceChildren();
  const matsTable = document.createElement("table");
  matsTable.className = "commercial-table";
  const matsThead = document.createElement("thead");
  const matsHeadRow = document.createElement("tr");
  const matsHeaders = [
    { label: t("tile.reference") },
    { label: t("commercial.totalM2"), align: "right" },
    { label: t("commercial.totalTiles"), align: "right" },
    { label: t("commercial.totalPacks"), align: "right" },
    { label: t("commercial.packsFloor"), align: "right" },
    { label: t("commercial.packsSkirting"), align: "right" },
    { label: t("commercial.amountOverride"), align: "right" },
    { label: t("commercial.pricePerM2"), align: "right" },
    { label: t("commercial.pricePerPack"), align: "right" },
    { label: t("commercial.packSize"), align: "right" },
    { label: t("commercial.totalCost"), align: "right" }
  ];
  matsHeaders.forEach(({ label, align }) => {
    const th = document.createElement("th");
    th.textContent = label;
    if (align) th.style.textAlign = align;
    matsHeadRow.appendChild(th);
  });
  matsThead.appendChild(matsHeadRow);
  matsTable.appendChild(matsThead);
  const matsTbody = document.createElement("tbody");
  for (const m of proj.materials) {
    const ref = m.reference || "";
    const pricePerPack = (m.pricePerM2 * m.packM2).toFixed(2);
    const tr = document.createElement("tr");
    const refTd = document.createElement("td");
    refTd.className = "material-ref";
    refTd.textContent = ref || t("commercial.defaultMaterial");
    const areaTd = document.createElement("td");
    areaTd.style.textAlign = "right";
    areaTd.textContent = `${m.netAreaM2.toFixed(2)} m²`;
    const tilesTd = document.createElement("td");
    tilesTd.style.textAlign = "right";
    tilesTd.textContent = String(m.totalTiles);
    const packsTd = document.createElement("td");
    packsTd.style.textAlign = "right";
    const packsStrong = document.createElement("strong");
    packsStrong.textContent = String(m.totalPacks || 0);
    packsTd.appendChild(packsStrong);
    const floorPacksTd = document.createElement("td");
    floorPacksTd.style.textAlign = "right";
    floorPacksTd.textContent = String(m.floorPacks || 0);
    const skirtingPacksTd = document.createElement("td");
    skirtingPacksTd.style.textAlign = "right";
    skirtingPacksTd.textContent = String(m.skirtingPacks || 0);
    const extraTd = document.createElement("td");
    extraTd.style.textAlign = "right";
    const extraInput = document.createElement("input");
    extraInput.type = "number";
    extraInput.step = "1";
    extraInput.className = "commercial-edit";
    extraInput.dataset.ref = ref;
    extraInput.dataset.prop = "extraPacks";
    extraInput.value = String(m.extraPacks);
    extraInput.style.width = "40px";
    extraTd.appendChild(extraInput);
    const priceM2Td = document.createElement("td");
    priceM2Td.style.textAlign = "right";
    const priceM2Input = document.createElement("input");
    priceM2Input.type = "number";
    priceM2Input.step = "0.01";
    priceM2Input.className = "commercial-edit";
    priceM2Input.dataset.ref = ref;
    priceM2Input.dataset.prop = "pricePerM2";
    priceM2Input.value = m.pricePerM2.toFixed(2);
    priceM2Input.style.width = "60px";
    const priceM2Unit = document.createElement("span");
    priceM2Unit.textContent = " €";
    priceM2Td.append(priceM2Input, priceM2Unit);
    const pricePackTd = document.createElement("td");
    pricePackTd.style.textAlign = "right";
    const pricePackInput = document.createElement("input");
    pricePackInput.type = "number";
    pricePackInput.step = "0.01";
    pricePackInput.className = "commercial-edit";
    pricePackInput.dataset.ref = ref;
    pricePackInput.dataset.prop = "pricePerPack";
    pricePackInput.value = pricePerPack;
    pricePackInput.style.width = "60px";
    const pricePackUnit = document.createElement("span");
    pricePackUnit.textContent = " €";
    pricePackTd.append(pricePackInput, pricePackUnit);
    const packSizeTd = document.createElement("td");
    packSizeTd.style.textAlign = "right";
    const packSizeInput = document.createElement("input");
    packSizeInput.type = "number";
    packSizeInput.step = "0.01";
    packSizeInput.className = "commercial-edit";
    packSizeInput.dataset.ref = ref;
    packSizeInput.dataset.prop = "packM2";
    packSizeInput.value = String(m.packM2);
    const packSizeUnit = document.createElement("span");
    packSizeUnit.textContent = " m²";
    packSizeTd.append(packSizeInput, packSizeUnit);
    const costTd = document.createElement("td");
    costTd.style.textAlign = "right";
    const costStrong = document.createElement("strong");
    costStrong.textContent = `${m.adjustedCost.toFixed(2)} €`;
    costTd.appendChild(costStrong);
    tr.append(
      refTd,
      areaTd,
      tilesTd,
      packsTd,
      floorPacksTd,
      skirtingPacksTd,
      extraTd,
      priceM2Td,
      pricePackTd,
      packSizeTd,
      costTd
    );
    matsTbody.appendChild(tr);
  }
  const totalRow = document.createElement("tr");
  totalRow.style.borderTop = "2px solid var(--line2)";
  totalRow.style.fontWeight = "bold";
  const totalLabel = document.createElement("td");
  totalLabel.textContent = t("commercial.grandTotal");
  const totalArea = document.createElement("td");
  totalArea.style.textAlign = "right";
  totalArea.textContent = `${proj.totalNetAreaM2.toFixed(2)} m²`;
  const totalTiles = document.createElement("td");
  totalTiles.style.textAlign = "right";
  totalTiles.textContent = String(proj.totalTiles);
  const totalPacks = document.createElement("td");
  totalPacks.style.textAlign = "right";
  totalPacks.textContent = String(proj.totalPacks);
  const totalFloor = document.createElement("td");
  totalFloor.style.textAlign = "right";
  totalFloor.textContent = "–";
  const totalSkirting = document.createElement("td");
  totalSkirting.style.textAlign = "right";
  totalSkirting.textContent = "–";
  const totalSpacer = document.createElement("td");
  totalSpacer.colSpan = 4;
  const totalCost = document.createElement("td");
  totalCost.style.textAlign = "right";
  totalCost.style.color = "var(--accent)";
  totalCost.textContent = `${proj.totalCost.toFixed(2)} €`;
  totalRow.append(
    totalLabel,
    totalArea,
    totalTiles,
    totalPacks,
    totalFloor,
    totalSkirting,
    totalSpacer,
    totalCost
  );
  matsTbody.appendChild(totalRow);
  matsTable.appendChild(matsTbody);
  materialsListEl.appendChild(matsTable);
}

export function renderExportTab(state, selection = null) {
  const listEl = document.getElementById("exportRoomsList");
  if (!listEl) return;

  listEl.replaceChildren();

  const floors = state.floors || [];
  const roomCount = floors.reduce((sum, floor) => sum + (floor.rooms?.length || 0), 0);
  const btnRoomsPdf = document.getElementById("btnExportRoomsPdf");
  const btnCommercialPdf = document.getElementById("btnExportCommercialPdf");
  const btnCommercialXlsx = document.getElementById("btnExportCommercialXlsx");

  if (btnRoomsPdf) btnRoomsPdf.disabled = roomCount === 0;
  if (btnCommercialPdf) btnCommercialPdf.disabled = roomCount === 0;
  if (btnCommercialXlsx) btnCommercialXlsx.disabled = roomCount === 0;

  if (!floors.length || roomCount === 0) {
    const empty = document.createElement("div");
    empty.className = "subtle";
    empty.textContent = t("export.noRoomsSelected");
    listEl.appendChild(empty);
    return;
  }

  const hasSelection = selection instanceof Set;

  for (const floor of floors) {
    if (!floor.rooms || floor.rooms.length === 0) continue;

    const group = document.createElement("div");
    group.className = "export-room-group";

    const title = document.createElement("div");
    title.className = "export-room-group-title";
    title.textContent = floor.name || t("tabs.floor");
    group.appendChild(title);

    for (const room of floor.rooms) {
      const row = document.createElement("div");
      row.className = "export-room-item";

      const labelWrap = document.createElement("div");
      labelWrap.className = "export-room-label";

      const name = document.createElement("div");
      name.className = "export-room-name";
      name.textContent = room.name || t("tabs.room");

      const meta = document.createElement("div");
      meta.className = "export-room-meta";
      const bounds = getRoomBounds(room);
      if (bounds.width > 0 && bounds.height > 0) {
        meta.textContent = `${Math.round(bounds.width)} x ${Math.round(bounds.height)} cm`;
      } else {
        meta.textContent = "–";
      }

      labelWrap.append(name, meta);

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "checkbox export-room-checkbox";
      checkbox.dataset.roomId = room.id;
      checkbox.checked = hasSelection ? selection.has(room.id) : true;

      row.append(checkbox, labelWrap);
      group.appendChild(row);
    }

    listEl.appendChild(group);
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


  // Render each room
  for (const room of floor.rooms) {
    const pos = room.floorPosition || { x: 0, y: 0 };
    const roomGroup = svgEl("g", {
      transform: `translate(${pos.x}, ${pos.y})`,
      "data-roomid": room.id,
      cursor: "pointer"
    });

    const isSelected = room.id === selectedRoomId;

    // Get room polygon for rendering (in room-local coordinates)
    // The group transform handles floor positioning
    const roomPoly = roomPolygon(room);
    if (roomPoly && roomPoly.length > 0) {
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
          // Compute available area (room polygon minus exclusions)
          const avail = computeAvailableArea(room, room.exclusions || []);
          if (avail.mp) {
            const roomState = { ...state, selectedRoomId: room.id };
            // Use shared origin for pattern group
            const patternGroupOrigin = computePatternGroupOrigin(room, floor);
            const result = tilesForPreview(roomState, avail.mp, room, false, floor, { originOverride: patternGroupOrigin, effectiveSettings });
            const groutColor = effectiveSettings.grout?.colorHex || "#ffffff";

            if (result.error) {
              console.warn(`Floor tiles error for room ${room.name || room.id}:`, result.error);
            }

            // Create a group for tiles
            const tilesGroup = svgEl("g", { opacity: 0.8 });

            for (const tile of (result.tiles || []).slice(0, 1000)) { // Limit tiles for performance
              if (!tile.d) continue;
              tilesGroup.appendChild(svgEl("path", {
                d: tile.d,
                fill: "rgba(100, 116, 139, 0.5)",
                stroke: groutColor,
                "stroke-width": effectiveSettings.grout?.widthCm || 0.2
              }));
            }

            roomGroup.appendChild(tilesGroup);
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

    // Add resize handles for selected room (only for simple rectangular rooms)
    const isSimpleRect = room.polygonVertices?.length === 4;
    if (isSelected && onRoomResizePointerDown && isSimpleRect) {
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

    // Add vertex handles for selected free-form rooms (polygonVertices)
    if (isSelected && onVertexPointerDown && room.polygonVertices?.length > 0) {
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

/**
 * Renders the Pattern Groups view - shows all rooms with group visualization.
 * Similar to floor view but focuses on pattern group management.
 */
export function renderPatternGroupsCanvas({
  state,
  floor,
  selectedRoomId,
  activeGroupId = null,
  onRoomClick,
  onRoomDoubleClick,
  svgOverride = null
}) {
  const svg = svgOverride || document.getElementById("planSvg");
  if (!svg) return;

  // Clear existing content
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  if (!floor || !floor.rooms?.length) {
    svg.setAttribute("viewBox", "0 0 100 100");
    return;
  }

  // Get floor bounds encompassing all rooms
  const bounds = getFloorBounds(floor);
  const padding = 80;

  const baseViewBox = {
    minX: bounds.minX - padding,
    minY: bounds.minY - padding,
    width: bounds.width + 2 * padding,
    height: bounds.height + 2 * padding
  };

  // Use floor-specific viewport key (shared with floor view)
  const viewportKey = `floor:${floor.id}`;
  setBaseViewBox(viewportKey, baseViewBox);

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

  // Render grid - use viewBox with extra padding for aspect ratio letterboxing
  if (state.view?.showGrid) {
    const gridGroup = svgEl("g", { opacity: 0.5 });
    const minor = 10, major = 100;
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

  // Render each room
  for (const room of floor.rooms) {
    const pos = room.floorPosition || { x: 0, y: 0 };
    const roomGroup = svgEl("g", {
      transform: `translate(${pos.x}, ${pos.y})`,
      "data-roomid": room.id,
      cursor: "pointer"
    });

    const isSelected = room.id === selectedRoomId;
    const patternGroup = getRoomPatternGroup(floor, room.id);
    const isInGroup = !!patternGroup;
    const isOrigin = patternGroup?.originRoomId === room.id;
    const isActiveGroup = isInGroup && patternGroup.id === activeGroupId;

    // Get room polygon
    const roomPoly = roomPolygon(room);
    if (roomPoly && roomPoly.length > 0) {
      const pathD = multiPolygonToPathD(roomPoly);

      // Determine colors based on group membership and active state
      let fillColor, strokeColor, strokeWidth;

      if (isActiveGroup) {
        // Active group - blue
        fillColor = isOrigin ? "rgba(59, 130, 246, 0.35)" : "rgba(59, 130, 246, 0.2)";
        strokeColor = "#3b82f6";
        strokeWidth = isOrigin ? 4 : 3;
      } else if (isInGroup) {
        // Grouped but not active - neutral with thicker outline
        fillColor = "rgba(100, 116, 139, 0.2)";
        strokeColor = "rgba(148, 163, 184, 0.8)";
        strokeWidth = 3;
      } else {
        // Independent room - neutral gray, thin outline
        fillColor = "rgba(100, 116, 139, 0.15)";
        strokeColor = "rgba(148, 163, 184, 0.5)";
        strokeWidth = 2;
      }

      // Room fill
      roomGroup.appendChild(svgEl("path", {
        d: pathD,
        fill: fillColor,
        stroke: strokeColor,
        "stroke-width": strokeWidth
      }));

      // Add selection highlight ring for selected room (visible over any group color)
      if (isSelected) {
        // Outer glow/selection ring
        roomGroup.appendChild(svgEl("path", {
          d: pathD,
          fill: "none",
          stroke: "#ffffff",
          "stroke-width": 6,
          "stroke-opacity": 0.6
        }));
        // Inner bright border
        roomGroup.appendChild(svgEl("path", {
          d: pathD,
          fill: "none",
          stroke: "#3b82f6",
          "stroke-width": 3,
          "stroke-dasharray": "8,4"
        }));
      }

      // Add origin marker for origin rooms
      if (isOrigin) {
        const roomBounds = getRoomBounds(room);
        const markerX = roomBounds.minX + 15;
        const markerY = roomBounds.minY + 15;
        const markerColor = isActiveGroup ? "#3b82f6" : "rgba(148, 163, 184, 0.8)";
        const markerFill = isActiveGroup ? "rgba(59, 130, 246, 0.35)" : "rgba(100, 116, 139, 0.3)";

        // Target/origin icon
        roomGroup.appendChild(svgEl("circle", {
          cx: markerX, cy: markerY, r: 10,
          fill: markerFill,
          stroke: markerColor,
          "stroke-width": 2
        }));
        roomGroup.appendChild(svgEl("circle", {
          cx: markerX, cy: markerY, r: 4,
          fill: markerColor
        }));
      }
    }

    // Room label
    const roomBounds = getRoomBounds(room);
    const labelX = roomBounds.width / 2 + roomBounds.minX;
    const labelY = roomBounds.height / 2 + roomBounds.minY;

    const labelColor = isActiveGroup
      ? "#3b82f6"
      : (isSelected ? "#94a3b8" : "rgba(148, 163, 184, 0.8)");

    const fontSize = Math.min(14, Math.max(9, roomBounds.width / 12));

    const textEl = svgEl("text", {
      x: labelX,
      y: labelY,
      fill: labelColor,
      "font-size": fontSize,
      "font-family": "system-ui, -apple-system, Segoe UI, Roboto, Arial",
      "font-weight": isOrigin ? "700" : (isInGroup ? "600" : "500"),
      "text-anchor": "middle",
      "dominant-baseline": "middle"
    });
    textEl.appendChild(document.createTextNode(room.name || t("tabs.room")));
    roomGroup.appendChild(textEl);

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

    svg.appendChild(roomGroup);
  }
}
