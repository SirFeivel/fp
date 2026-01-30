// src/render.js
import { computePlanMetrics, computeSkirtingNeeds, computeGrandTotals, computeProjectTotals, getRoomPricing } from "./calc.js";
import { validateState } from "./validation.js";
import { escapeHTML, getCurrentRoom, getCurrentFloor } from "./core.js";
import { t } from "./i18n.js";
import {
  svgEl,
  multiPolygonToPathD,
  computeExclusionsUnion,
  computeAvailableArea,
  roomPolygon,
  tilesForPreview,
  getRoomBounds,
  computeMultiPolygonPerimeter,
  computeSkirtingSegments
} from "./geometry.js";
import { getRoomSections, computeCompositePolygon, computeCompositeBounds } from "./composite.js";
import { setBaseViewBox, calculateEffectiveViewBox, getViewport } from "./viewport.js";

let activeSvgEdit = null;

function setInlineEditing(isEditing) {
  if (isEditing) {
    document.body.dataset.inlineEditing = "true";
  } else {
    delete document.body.dataset.inlineEditing;
  }
}

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
  document.getElementById("roomName").value = currentRoom?.name ?? "";
  const isCreateMode = document.body?.dataset?.tileEditMode === "create";
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

export function renderSectionsList(state, selectedSectionId) {
  const sel = document.getElementById("sectionsList");
  if (!sel) return;

  sel.innerHTML = "";
  const currentRoom = getCurrentRoom(state);
  const sections = getRoomSections(currentRoom);

  if (!sections.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = t("project.none");
    sel.appendChild(opt);
    sel.disabled = true;
    return;
  }

  sel.disabled = false;
  for (const sec of sections) {
    const opt = document.createElement("option");
    opt.value = sec.id;
    const label = sec.label || `Section ${sec.id}`;
    opt.textContent = `${label} (${sec.widthCm}×${sec.heightCm} cm)`;
    if (sec.id === selectedSectionId) opt.selected = true;
    sel.appendChild(opt);
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

      const sections = getRoomSections(room);
      sections.forEach((sec, secIdx) => {
        const secRow = document.createElement("div");
        secRow.className = "skirting-room-row is-section";
        if (!roomEnabled) secRow.classList.add("is-disabled");
        const secName = sec.label || `${t("room.section")} ${secIdx + 1}`;
        const secNameEl = document.createElement("div");
        secNameEl.className = "skirting-room-name";
        secNameEl.textContent = `${t("room.section")}: ${secName}`;
        const secToggle = document.createElement("label");
        secToggle.className = "toggle-switch skirting-room-toggle";
        const secInput = document.createElement("input");
        secInput.type = "checkbox";
        secInput.checked = sec.skirtingEnabled !== false;
        secInput.dataset.roomId = room.id;
        secInput.dataset.secId = sec.id;
        if (!roomEnabled) secInput.disabled = true;
        const secSlider = document.createElement("div");
        secSlider.className = "toggle-slider";
        secRow.appendChild(secNameEl);
        secToggle.appendChild(secInput);
        secToggle.appendChild(secSlider);
        secRow.appendChild(secToggle);
        secInput.addEventListener("change", () => {
          onToggleSection?.(room.id, sec.id, Boolean(secInput.checked));
        });
        wrap.appendChild(secRow);
      });
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

export function renderSectionProps({
  state,
  selectedSectionId,
  getSelectedSection,
  commitSectionProps
}) {
  const wrap = document.getElementById("sectionProps");
  if (!wrap) return;

  const sec = getSelectedSection();
  wrap.innerHTML = "";

  if (!sec) {
    const div = document.createElement("div");
    div.className = "meta subtle span2";
    div.textContent = t("room.noSectionSelected");
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
    inp.value = value;
    inp.addEventListener("blur", () => commitSectionProps(t("room.sectionChanged")));
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
  labelDiv.innerHTML = `<label>${t("secProps.label")}</label><input id="secLabel" type="text" />`;
  wrap.appendChild(labelDiv);
  const labelInp = labelDiv.querySelector("input");
  labelInp.value = sec.label || "";
  labelInp.addEventListener("blur", () => commitSectionProps(t("room.sectionChanged")));
  labelInp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      labelInp.blur();
    }
  });

  field(t("secProps.x"), "secX", sec.x, "1");
  field(t("secProps.y"), "secY", sec.y, "1");
  field(t("secProps.width"), "secW", sec.widthCm, "0.1");
  field(t("secProps.height"), "secH", sec.heightCm, "0.1");

  // Add Skirting Toggle for Section
  const div = document.createElement("div");
  div.className = "field span2";
  div.innerHTML = `
    <label class="toggle-switch">
      <span class="toggle-label">${t("skirting.sectionEnabled")}</span>
      <input id="secSkirtingEnabled" type="checkbox" ${sec.skirtingEnabled !== false ? "checked" : ""}>
      <div class="toggle-slider"></div>
    </label>
  `;
  wrap.appendChild(div);

  const inp = div.querySelector("#secSkirtingEnabled");
  inp.addEventListener("change", () => {
    commitSectionProps(t("room.sectionChanged"));
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
  const tileEditActive = document.body?.dataset?.tileEdit === "true";
  const tileEditDirty = document.body?.dataset?.tileEditDirty === "true";
  const tileEditMode = document.body?.dataset?.tileEditMode || "edit";
  renderReferencePicker(state);
  renderTilePresetPicker(state, currentRoom);
  renderSkirtingPresetPicker(state);

  const editToggle = document.getElementById("tileConfigEditToggle");
  if (editToggle) editToggle.checked = tileEditActive;

  const ref = currentRoom?.tile?.reference;
  const preset = ref ? state.tilePresets?.find(p => p?.name && p.name === ref) : null;
  const editActions = document.getElementById("tileEditActions");
  if (editActions) editActions.classList.toggle("hidden", !tileEditActive);
  const editUpdateBtn = document.getElementById("tileEditUpdateBtn");
  const editSaveBtn = document.getElementById("tileEditSaveBtn");
  if (editUpdateBtn) editUpdateBtn.style.display = tileEditActive && tileEditMode !== "create" && preset ? "" : "none";
  if (editSaveBtn) editSaveBtn.style.display = tileEditActive && (tileEditMode === "create" || preset) ? "" : "none";
  if (editSaveBtn) {
    editSaveBtn.textContent = tileEditMode === "create"
      ? t("planning.tileEditSaveCreate")
      : t("planning.tileEditSaveNew");
  }

  const isCreateMode = tileEditMode === "create";
  const tileShapeEl = document.getElementById("tileShape");
  if (tileShapeEl) tileShapeEl.value = currentRoom?.tile?.shape ?? "rect";
  const tileWEl = document.getElementById("tileW");
  const tileHEl = document.getElementById("tileH");
  if (!isCreateMode) {
    if (tileWEl) tileWEl.value = currentRoom?.tile?.widthCm ?? "";
    if (tileHEl) tileHEl.value = currentRoom?.tile?.heightCm ?? "";
  }
  // Display grout in mm (state stores cm)
  document.getElementById("groutW").value = Math.round((currentRoom?.grout?.widthCm ?? 0) * 10);
  const groutColorValue = currentRoom?.grout?.colorHex ?? "#ffffff";
  document.getElementById("groutColor").value = groutColorValue;
  const pricing = currentRoom ? getRoomPricing(state, currentRoom) : { pricePerM2: 0, packM2: 0 };
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
    if (el) el.disabled = !tileEditActive;
  });
  const refInput = document.getElementById("tileReference");
  if (refInput) {
    if (tileEditActive) {
      refInput.removeAttribute("list");
    } else {
      refInput.setAttribute("list", "tileReferences");
    }
  }
  const tileConfigFields = document.querySelector(".tile-config-fields");
  if (tileConfigFields) tileConfigFields.classList.toggle("is-readonly", !tileEditActive);

  // Update preset swatch selection
  document.querySelectorAll("#groutColorPresets .color-swatch").forEach(swatch => {
    if (swatch.dataset.color?.toLowerCase() === groutColorValue.toLowerCase()) {
      swatch.classList.add("selected");
    } else {
      swatch.classList.remove("selected");
    }
  });

  document.getElementById("patternType").value = currentRoom?.pattern?.type ?? "grid";
  document.getElementById("bondFraction").value = String(
    currentRoom?.pattern?.bondFraction ?? 0.5
  );
  document.getElementById("rotationDeg").value = String(
    currentRoom?.pattern?.rotationDeg ?? 0
  );
  document.getElementById("offsetX").value = currentRoom?.pattern?.offsetXcm ?? 0;
  document.getElementById("offsetY").value = currentRoom?.pattern?.offsetYcm ?? 0;

  document.getElementById("originPreset").value =
    currentRoom?.pattern?.origin?.preset ?? "tl";
  document.getElementById("originX").value = currentRoom?.pattern?.origin?.xCm ?? 0;
  document.getElementById("originY").value = currentRoom?.pattern?.origin?.yCm ?? 0;

  const isRB = currentRoom?.pattern?.type === "runningBond";
  document.getElementById("bondFraction").disabled = !isRB;
  // Also hide bondFraction field if not RB
  const bondFractionField = document.getElementById("bondFraction")?.closest(".field");
  if (bondFractionField) {
    bondFractionField.style.display = isRB ? "" : "none";
  }

  const shape = currentRoom?.tile?.shape || "rect";
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
      const isSquare = Math.abs(tw - th) < 1e-6;

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

  const optimizeCuts = document.getElementById("wasteOptimizeCuts");
  if (optimizeCuts) optimizeCuts.checked = Boolean(state?.waste?.optimizeCuts);

  // Debug option
  const debugShowNeeds = document.getElementById("debugShowNeeds");
  if (debugShowNeeds) debugShowNeeds.checked = Boolean(state?.view?.showNeeds);

  // Schnittbreite
  const kerfEl = document.getElementById("wasteKerfCm");
  if (kerfEl) kerfEl.value = Math.round((state?.waste?.kerfCm ?? 0.2) * 10);
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
  // Section-related callbacks
  selectedSectionId = null,
  setSelectedSection = null,
  onSectionPointerDown = null,
  onSectionResizeHandlePointerDown = null,
  onSectionInlineEdit = null,
  onAddSectionAtEdge = null
}) {
  const svg = document.getElementById("planSvg");
  const currentRoom = getCurrentRoom(state);

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
    fill: "rgba(231,238,252,0.95)",
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

  // Inline edit handled by module-level SVG editor

  const bounds = getRoomBounds(currentRoom);
  const w = bounds.width;
  const h = bounds.height;
  const minX = bounds.minX;
  const minY = bounds.minY;
  const maxX = bounds.maxX;
  const maxY = bounds.maxY;
  const exclusions = currentRoom.exclusions || [];

  const resizeOverlay = document.getElementById("resizeMetrics");
  if (resizeOverlay) {
    resizeOverlay.classList.add("hidden");
  }
  closeSvgEdit(false);

  const sections = getRoomSections(currentRoom);

  while (svg.firstChild) svg.removeChild(svg.firstChild);

  const viewBoxPadding = 50;
  const baseViewBox = {
    minX: minX - viewBoxPadding,
    minY: minY - viewBoxPadding,
    width: w + 2 * viewBoxPadding,
    height: h + 2 * viewBoxPadding
  };

  // Store base viewBox for zoom/pan calculations
  setBaseViewBox(state.selectedRoomId, baseViewBox);

  // Calculate effective viewBox with zoom/pan applied
  const effectiveViewBox = calculateEffectiveViewBox(state.selectedRoomId);
  const vb = effectiveViewBox || baseViewBox;

  svg.setAttribute("viewBox", `${vb.minX} ${vb.minY} ${vb.width} ${vb.height}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

  // Background extends beyond normal bounds to cover zoomed out views
  const bgPadding = Math.max(baseViewBox.width, baseViewBox.height) * 10;
  svg.appendChild(svgEl("rect", {
    x: baseViewBox.minX - bgPadding,
    y: baseViewBox.minY - bgPadding,
    width: baseViewBox.width + 2 * bgPadding,
    height: baseViewBox.height + 2 * bgPadding,
    fill: "#081022"
  }));

  const suppressDetails = Boolean(selectedExclId);

  // grid
  if (state.view?.showGrid && !suppressDetails) {
    const g = svgEl("g", { opacity: 0.8 });
    const minor = 10, major = 100;
    for (let x = minX; x <= maxX; x += minor) {
      const isMajor = (x - minX) % major === 0;
      g.appendChild(svgEl("line", {
        x1: x, y1: minY, x2: x, y2: maxY,
        stroke: isMajor ? "#1f2b46" : "#14203a",
        "stroke-width": isMajor ? 0.8 : 0.4
      }));
    }
    for (let y = minY; y <= maxY; y += minor) {
      const isMajor = (y - minY) % major === 0;
      g.appendChild(svgEl("line", {
        x1: minX, y1: y, x2: maxX, y2: y,
        stroke: isMajor ? "#1f2b46" : "#14203a",
        "stroke-width": isMajor ? 0.8 : 0.4
      }));
    }
    svg.appendChild(g);
  }

  // room sections
  const gSec = svgEl("g");
  for (const section of sections) {
    if (!(section.widthCm > 0 && section.heightCm > 0)) continue;

    const isSectionSelected = section.id === selectedSectionId;
    const sectionRect = svgEl("rect", {
      x: section.x,
      y: section.y,
      width: section.widthCm,
      height: section.heightCm,
      fill: isSectionSelected ? "rgba(122,162,255,0.15)" : "rgba(122,162,255,0.06)",
      stroke: isSectionSelected ? "rgba(122,162,255,1)" : "rgba(122,162,255,0.8)",
      "stroke-width": isSectionSelected ? 2 : 1.2,
      cursor: sections.length > 1 ? "move" : "default",
      "data-secid": section.id
    });

    // Add click handler for selection (only if multiple sections)
    if (sections.length > 1 && setSelectedSection) {
      sectionRect.addEventListener("click", (e) => {
        e.stopPropagation();
        setSelectedSection(section.id);
      });
      if (onSectionPointerDown) {
        sectionRect.addEventListener("pointerdown", onSectionPointerDown);
      }
    }

    gSec.appendChild(sectionRect);

    if (section.label && sections.length > 1) {
      const sectionLabel = svgEl("text", {
        x: section.x + 8,
        y: section.y + 18,
        fill: isSectionSelected ? "rgba(231,238,252,0.95)" : "rgba(231,238,252,0.70)",
        "font-size": 12,
        "font-family": "system-ui, -apple-system, Segoe UI, Roboto, Arial",
        "pointer-events": "none"
      });
      sectionLabel.textContent = section.label;
      gSec.appendChild(sectionLabel);
    }

    // Add resize handles and dimension labels for selected section
    if (isSectionSelected && sections.length > 1) {
      const handleRadius = 4;
      const handleStyle = {
        fill: "var(--accent, #3b82f6)",
        stroke: "#fff",
        "stroke-width": 1.5,
        cursor: "pointer",
        "data-secid": section.id
      };
      const pad = 10;

      // Corner handles (nw, ne, sw, se) and edge handles (n, s, e, w)
      const handles = [
        { type: "nw", x: section.x, y: section.y, cursor: "nwse-resize" },
        { type: "ne", x: section.x + section.widthCm, y: section.y, cursor: "nesw-resize" },
        { type: "sw", x: section.x, y: section.y + section.heightCm, cursor: "nesw-resize" },
        { type: "se", x: section.x + section.widthCm, y: section.y + section.heightCm, cursor: "nwse-resize" },
        { type: "n", x: section.x + section.widthCm / 2, y: section.y, cursor: "ns-resize" },
        { type: "s", x: section.x + section.widthCm / 2, y: section.y + section.heightCm, cursor: "ns-resize" },
        { type: "w", x: section.x, y: section.y + section.heightCm / 2, cursor: "ew-resize" },
        { type: "e", x: section.x + section.widthCm, y: section.y + section.heightCm / 2, cursor: "ew-resize" }
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
        if (onSectionResizeHandlePointerDown) {
          handle.addEventListener("pointerdown", onSectionResizeHandlePointerDown);
        }
        gSec.appendChild(handle);
      });

      // Editable dimension labels (matching exclusion pattern)
      const addSectionEditableLabel = (text, value, key, x, y, anchor = "middle", angle = 0) => {
        let finalAngle = angle;
        if (finalAngle > 90 || finalAngle < -90) {
          finalAngle += 180;
        }
        const labelGroup = addPillLabel(text, x, y, {
          anchor,
          angle: finalAngle,
          parent: gSec
        });
        if (!onSectionInlineEdit) return;
        const openEdit = (e) => {
          e.preventDefault();
          e.stopPropagation();
          labelGroup.style.display = "none";
          startSvgEdit({
            svg,
            x,
            y,
            angle: finalAngle,
            value,
            textStyle: labelBaseStyle,
            onCommit: (nextVal) => {
              labelGroup.style.display = "";
              onSectionInlineEdit({ id: section.id, key, value: nextVal });
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

      addSectionEditableLabel(`${fmtCm(section.widthCm)} cm`, section.widthCm, "widthCm", section.x + section.widthCm / 2, section.y - pad, "middle", 0);
      addSectionEditableLabel(`${fmtCm(section.heightCm)} cm`, section.heightCm, "heightCm", section.x + section.widthCm + pad, section.y + section.heightCm / 2, "middle", 90);

      // Delete button (X icon) - matching exclusion style
      if (sections.length > 1) {
        const removeBtnX = section.x + section.widthCm + 12;
        const removeBtnY = section.y - pad;
        const removeGroup = svgEl("g");
        const crossStyle = {
          stroke: "rgba(239,68,68,0.95)",
          "stroke-width": 1.6,
          "stroke-linecap": "round",
          cursor: "pointer"
        };
        const crossSize = 2;
        removeGroup.appendChild(svgEl("line", {
          ...crossStyle,
          x1: removeBtnX - crossSize,
          y1: removeBtnY - crossSize,
          x2: removeBtnX + crossSize,
          y2: removeBtnY + crossSize
        }));
        removeGroup.appendChild(svgEl("line", {
          ...crossStyle,
          x1: removeBtnX - crossSize,
          y1: removeBtnY + crossSize,
          x2: removeBtnX + crossSize,
          y2: removeBtnY - crossSize
        }));
        removeGroup.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (onSectionInlineEdit) {
            onSectionInlineEdit({ id: section.id, key: "__delete__" });
          }
        });
        gSec.appendChild(removeGroup);
      }
    }
  }

  // Add "+" indicators on all outer edges for adding new sections
  if (onAddSectionAtEdge && !selectedExclId) {
    const plusBtnRadius = 10;
    const plusBtnOffset = 25; // Distance from edge
    const plusStyle = {
      fill: "rgba(122,162,255,0.15)",
      stroke: "rgba(122,162,255,0.8)",
      "stroke-width": 1.5,
      cursor: "pointer"
    };
    const plusLineStyle = {
      stroke: "rgba(122,162,255,0.9)",
      "stroke-width": 2,
      "stroke-linecap": "round",
      "pointer-events": "none"
    };
    const plusSize = 5;

    // Helper to check if two edges overlap (share a segment)
    const edgesOverlap = (a1, a2, b1, b2) => {
      const min1 = Math.min(a1, a2);
      const max1 = Math.max(a1, a2);
      const min2 = Math.min(b1, b2);
      const max2 = Math.max(b1, b2);
      const overlapStart = Math.max(min1, min2);
      const overlapEnd = Math.min(max1, max2);
      return overlapEnd - overlapStart > 0.01; // More than a point
    };

    // Check if a section edge is adjacent to another section
    const isEdgeShared = (sec, edge) => {
      const eps = 0.01;
      for (const other of sections) {
        if (other.id === sec.id) continue;

        const oLeft = other.x;
        const oRight = other.x + other.widthCm;
        const oTop = other.y;
        const oBottom = other.y + other.heightCm;

        const sLeft = sec.x;
        const sRight = sec.x + sec.widthCm;
        const sTop = sec.y;
        const sBottom = sec.y + sec.heightCm;

        if (edge === "right" && Math.abs(sRight - oLeft) < eps) {
          if (edgesOverlap(sTop, sBottom, oTop, oBottom)) return true;
        }
        if (edge === "left" && Math.abs(sLeft - oRight) < eps) {
          if (edgesOverlap(sTop, sBottom, oTop, oBottom)) return true;
        }
        if (edge === "bottom" && Math.abs(sBottom - oTop) < eps) {
          if (edgesOverlap(sLeft, sRight, oLeft, oRight)) return true;
        }
        if (edge === "top" && Math.abs(sTop - oBottom) < eps) {
          if (edgesOverlap(sLeft, sRight, oLeft, oRight)) return true;
        }
      }
      return false;
    };

    // Collect all outer edges from all sections
    const outerEdges = [];
    for (const sec of sections) {
      if (!(sec.widthCm > 0 && sec.heightCm > 0)) continue;

      const sLeft = sec.x;
      const sRight = sec.x + sec.widthCm;
      const sTop = sec.y;
      const sBottom = sec.y + sec.heightCm;

      // Check each edge
      if (!isEdgeShared(sec, "right")) {
        outerEdges.push({
          dir: "right",
          x: sRight + plusBtnOffset,
          y: (sTop + sBottom) / 2,
          edgeInfo: { x: sRight, y1: sTop, y2: sBottom, secId: sec.id }
        });
      }
      if (!isEdgeShared(sec, "left")) {
        outerEdges.push({
          dir: "left",
          x: sLeft - plusBtnOffset,
          y: (sTop + sBottom) / 2,
          edgeInfo: { x: sLeft, y1: sTop, y2: sBottom, secId: sec.id }
        });
      }
      if (!isEdgeShared(sec, "bottom")) {
        outerEdges.push({
          dir: "bottom",
          x: (sLeft + sRight) / 2,
          y: sBottom + plusBtnOffset,
          edgeInfo: { y: sBottom, x1: sLeft, x2: sRight, secId: sec.id }
        });
      }
      if (!isEdgeShared(sec, "top")) {
        outerEdges.push({
          dir: "top",
          x: (sLeft + sRight) / 2,
          y: sTop - plusBtnOffset,
          edgeInfo: { y: sTop, x1: sLeft, x2: sRight, secId: sec.id }
        });
      }
    }

    // Render "+" button for each outer edge
    outerEdges.forEach(btn => {
      const btnGroup = svgEl("g", { cursor: "pointer" });

      // Circle background
      btnGroup.appendChild(svgEl("circle", {
        ...plusStyle,
        cx: btn.x,
        cy: btn.y,
        r: plusBtnRadius
      }));

      // Plus sign (horizontal line)
      btnGroup.appendChild(svgEl("line", {
        ...plusLineStyle,
        x1: btn.x - plusSize,
        y1: btn.y,
        x2: btn.x + plusSize,
        y2: btn.y
      }));

      // Plus sign (vertical line)
      btnGroup.appendChild(svgEl("line", {
        ...plusLineStyle,
        x1: btn.x,
        y1: btn.y - plusSize,
        x2: btn.x,
        y2: btn.y + plusSize
      }));

      btnGroup.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        onAddSectionAtEdge(btn.dir, btn.edgeInfo);
      });

      gSec.appendChild(btnGroup);
    });
  }

  svg.appendChild(gSec);

  // Update dynamic plan title in header
  const planTitleEl = document.getElementById("planTitle");
  if (planTitleEl) {
    const currentFloor = getCurrentFloor(state);
    const floorName = currentFloor?.name || "–";
    const roomName = currentRoom?.name || "–";
    const totalArea = (w * h / 10000).toFixed(2);
    const sectionInfo = sections.length > 1 ? ` (${sections.length} ${t("room.sectionsList")})` : "";
    planTitleEl.textContent = `${floorName} / ${roomName} — ${totalArea} m²${sectionInfo}`;
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
      const t = tilesForPreview(state, avail.mp, isRemovalMode);
      if (t.error) setLastTileError(t.error);
      else setLastTileError(null);

      previewTiles = t.tiles;

      const g = svgEl("g", { opacity: 1, "pointer-events": isRemovalMode ? "auto" : "none" });
      svg.appendChild(g);

      // Get grout color from state - use default white if grout width is 0
      const groutWidth = currentRoom?.grout?.widthCm || 0;
      const groutHex = groutWidth > 0 ? (currentRoom?.grout?.colorHex || "#ffffff") : "#ffffff";
      const groutRgb = hexToRgb(groutHex);

      for (const tile of t.tiles) {
        const isExcluded = tile.excluded;
        const attrs = {
          d: tile.d,
          // Tile fill stays white - only grout (stroke) gets the color
          fill: isExcluded 
            ? "rgba(239,68,68,0.25)" 
            : (tile.isFull ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.08)"),
          stroke: isExcluded
            ? "rgba(239,68,68,0.8)"
            : (tile.isFull
                ? `rgba(${groutRgb.r},${groutRgb.g},${groutRgb.b},0.50)`
                : `rgba(${groutRgb.r},${groutRgb.g},${groutRgb.b},0.90)`),
          "stroke-width": isExcluded ? 2.0 : (tile.isFull ? 0.5 : 1.2)
        };
        if (isExcluded) {
          attrs["stroke-dasharray"] = "4 2";
          attrs["class"] = "tile-excluded";
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
  if (!skipTiles) {
    const u = computeExclusionsUnion(exclusions);
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
        stroke: "var(--accent)", 
        "stroke-width": 4, 
        opacity: 0.6,
        "stroke-linejoin": "round",
        "pointer-events": isRemovalMode ? "auto" : "none"
      });
      
      const skirting = currentRoom.skirting || {};
      const pieceLength = skirting.type === "bought" 
        ? (Number(skirting.boughtWidthCm) || 60)
        : (Number(currentRoom.tile?.widthCm) || 60);

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
          "stroke-dasharray": excluded ? "none" : `${pieceLength - gap} ${gap}`,
          "stroke-linecap": "butt"
        };
        if (id) attrs["data-skirtid"] = id;
        if (excluded) {
          attrs.stroke = "rgba(239,68,68,0.8)";
          attrs["stroke-width"] = 8;
          attrs["class"] = "skirt-excluded";
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
  for (const ex of exclusions) {
    const isSel = ex.id === selectedExclId;
    // Match section styling pattern: selected has higher opacity, unselected is more subtle
    const common = {
      fill: isSel ? "rgba(239,68,68,0.15)" : "rgba(239,68,68,0.06)",
      stroke: isSel ? "rgba(239,68,68,1)" : "rgba(239,68,68,0.8)",
      "stroke-width": isSel ? 2 : 1.2,
      cursor: "move",
      "data-exid": ex.id
    };

    let shapeEl;
    if (ex.type === "rect") {
      shapeEl = svgEl("rect", { ...common, x: ex.x, y: ex.y, width: ex.w, height: ex.h });
    } else if (ex.type === "circle") {
      shapeEl = svgEl("circle", { ...common, cx: ex.cx, cy: ex.cy, r: ex.r });
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
      const handleRadius = 4;
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

      const box = ex.type === "rect"
        ? { minX: ex.x, minY: ex.y, maxX: ex.x + ex.w, maxY: ex.y + ex.h }
        : ex.type === "circle"
          ? { minX: ex.cx - ex.r, minY: ex.cy - ex.r, maxX: ex.cx + ex.r, maxY: ex.cy + ex.r }
          : {
            minX: Math.min(ex.p1.x, ex.p2.x, ex.p3.x),
            minY: Math.min(ex.p1.y, ex.p2.y, ex.p3.y),
            maxX: Math.max(ex.p1.x, ex.p2.x, ex.p3.x),
            maxY: Math.max(ex.p1.y, ex.p2.y, ex.p3.y)
          };

      const pad = 10;
      // Consistent delete button position: top-right corner (matching section pattern)
      const removeBtnX = box.maxX + 12;
      const removeBtnY = box.minY - pad;
      const removeGroup = svgEl("g");
      const crossStyle = {
        stroke: "rgba(239,68,68,0.95)",
        "stroke-width": 1.6,
        "stroke-linecap": "round",
        cursor: "pointer"
      };
      const crossSize = 2;
      removeGroup.appendChild(svgEl("line", {
        ...crossStyle,
        x1: removeBtnX - crossSize,
        y1: removeBtnY - crossSize,
        x2: removeBtnX + crossSize,
        y2: removeBtnY + crossSize
      }));
      removeGroup.appendChild(svgEl("line", {
        ...crossStyle,
        x1: removeBtnX - crossSize,
        y1: removeBtnY + crossSize,
        x2: removeBtnX + crossSize,
        y2: removeBtnY - crossSize
      }));
      removeGroup.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (onInlineEdit) {
          onInlineEdit({ id: ex.id, key: "__delete__" });
        }
      });
      gEx.appendChild(removeGroup);

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

  const svgFullscreen = document.getElementById("planSvgFullscreen");
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
