// src/render.js
import { computePlanMetrics, computeSkirtingNeeds, computeGrandTotals, computeProjectTotals } from "./calc.js";
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
import { getRoomSections } from "./composite.js";

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
  const wrap = document.getElementById("warnings");
  const wrapper = document.getElementById("warningsWrapper");
  if (!wrap || !wrapper) return;

  wrap.innerHTML = "";

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
  const otherMessages = [
    ...errors.filter(x => x !== ratioError).map((x) => ({ ...x, level: t("warnings.warn") })),
    ...warns.map((x) => ({ ...x, level: t("warnings.warn") }))
  ];

  const pill = document.getElementById("warnPill");
  if (pill) {
    let count = otherMessages.length;
    if (ratioError) count++;
    pill.textContent = String(count);
  }

  // Handle the special Hint/Error box for complex patterns
  if (isComplexPattern) {
    let hintKey = "";
    if (patternType === "herringbone") hintKey = "validation.herringboneRatioText";
    if (patternType === "doubleHerringbone") hintKey = "validation.doubleHerringboneRatioText";
    if (patternType === "basketweave") hintKey = "validation.basketweaveRatioText";

    const div = document.createElement("div");
    if (ratioError) {
      div.className = "warnItem ratio-error"; // We'll assume CSS handles the yellow hue
      div.style.backgroundColor = "rgba(255, 193, 7, 0.2)";
      div.style.borderLeft = "4px solid #ffc107";
      div.innerHTML = `<div class="wTitle">${t("warnings.error")}: ${ratioError.title}</div><div class="wText">${escapeHTML(ratioError.text)}</div>`;
    } else {
      div.className = "warnItem info";
      div.innerHTML = `<div class="wTitle">${t("warnings.warn")}:</div><div class="wText">${t(hintKey)}</div>`;
    }
    wrap.appendChild(div);
  }

  for (const w of otherMessages) {
    const div = document.createElement("div");
    div.className = "warnItem";
    div.innerHTML = `<div class="wTitle">${escapeHTML(w.level)}: ${escapeHTML(
      w.title
    )}</div><div class="wText">${escapeHTML(w.text)}</div>`;
    wrap.appendChild(div);
  }

  // Hide wrapper if there are no messages
  const hasMessages = otherMessages.length > 0 || isComplexPattern;
  wrapper.style.display = hasMessages ? "block" : "none";
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
  document.getElementById("tileReference").value = currentRoom?.tile?.reference ?? "";
  document.querySelectorAll("#showGrid").forEach(el => el.checked = Boolean(state.view?.showGrid));
  document.querySelectorAll("#showSkirting").forEach(el => el.checked = Boolean(state.view?.showSkirting));
  document.querySelectorAll("#removalMode").forEach(el => el.checked = Boolean(state.view?.removalMode));

  const skirting = currentRoom?.skirting;
  if (skirting) {
    document.getElementById("skirtingType").value = skirting.type || "cutout";
    document.getElementById("skirtingHeight").value = skirting.heightCm || "";
    document.getElementById("skirtingBoughtWidth").value = skirting.boughtWidthCm || "";
    document.getElementById("skirtingPricePerPiece").value = skirting.boughtPricePerPiece || "";

    const isBought = skirting.type === "bought";
    document.getElementById("boughtWidthWrap").style.display = isBought ? "block" : "none";
    document.getElementById("boughtPriceWrap").style.display = isBought ? "block" : "none";
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
      <span class="toggle-label">${t("skirting.showSkirting")}</span>
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
  renderReferencePicker(state);

  document.getElementById("tileShape").value = currentRoom?.tile?.shape ?? "rect";
  document.getElementById("tileW").value = currentRoom?.tile?.widthCm ?? "";
  document.getElementById("tileH").value = currentRoom?.tile?.heightCm ?? "";
  // Display grout in mm (state stores cm)
  document.getElementById("groutW").value = Math.round((currentRoom?.grout?.widthCm ?? 0) * 10);
  const groutColorValue = currentRoom?.grout?.colorHex ?? "#ffffff";
  document.getElementById("groutColor").value = groutColorValue;

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

  // Pricing
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
  if (kerfEl) kerfEl.value = state?.waste?.kerfCm ?? 0;
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
    inp.value = value;
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
    field(t("exclProps.x"), "exX", ex.x);
    field(t("exclProps.y"), "exY", ex.y);
    field(t("exclProps.width"), "exW", ex.w);
    field(t("exclProps.height"), "exH", ex.h);
  } else if (ex.type === "circle") {
    field(t("exclProps.centerX"), "exCX", ex.cx);
    field(t("exclProps.centerY"), "exCY", ex.cy);
    field(t("exclProps.radius"), "exR", ex.r);
  } else if (ex.type === "tri") {
    field(t("exclProps.p1x"), "exP1X", ex.p1.x);
    field(t("exclProps.p1y"), "exP1Y", ex.p1.y);
    field(t("exclProps.p2x"), "exP2X", ex.p2.x);
    field(t("exclProps.p2y"), "exP2Y", ex.p2.y);
    field(t("exclProps.p3x"), "exP3X", ex.p3.x);
    field(t("exclProps.p3y"), "exP3Y", ex.p3.y);
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
  lastUnionError,
  lastTileError,
  setLastUnionError,
  setLastTileError,
  metrics, // optional; if omitted we compute it here
  skipTiles = false
}) {
  const svg = document.getElementById("planSvg");
  const currentRoom = getCurrentRoom(state);

  if (!currentRoom) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.setAttribute("viewBox", "0 0 100 100");
    return;
  }

  const bounds = getRoomBounds(currentRoom);
  const w = bounds.width;
  const h = bounds.height;
  const minX = bounds.minX;
  const minY = bounds.minY;
  const maxX = bounds.maxX;
  const maxY = bounds.maxY;
  const exclusions = currentRoom.exclusions || [];
  const sections = getRoomSections(currentRoom);

  while (svg.firstChild) svg.removeChild(svg.firstChild);

  const viewBoxPadding = 20;
  svg.setAttribute("viewBox", `${minX - viewBoxPadding} ${minY - viewBoxPadding} ${w + 2 * viewBoxPadding} ${h + 2 * viewBoxPadding}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

  svg.appendChild(svgEl("rect", {
    x: minX - viewBoxPadding,
    y: minY - viewBoxPadding,
    width: w + 2 * viewBoxPadding,
    height: h + 2 * viewBoxPadding,
    fill: "#081022"
  }));

  // grid
  if (state.view?.showGrid) {
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
  for (const section of sections) {
    if (!(section.widthCm > 0 && section.heightCm > 0)) continue;

    svg.appendChild(svgEl("rect", {
      x: section.x,
      y: section.y,
      width: section.widthCm,
      height: section.heightCm,
      fill: "rgba(122,162,255,0.06)",
      stroke: "rgba(122,162,255,0.8)",
      "stroke-width": 1.2
    }));

    if (section.label && sections.length > 1) {
      const sectionLabel = svgEl("text", {
        x: section.x + 8,
        y: section.y + 18,
        fill: "rgba(231,238,252,0.70)",
        "font-size": 12,
        "font-family": "system-ui, -apple-system, Segoe UI, Roboto, Arial"
      });
      sectionLabel.textContent = section.label;
      svg.appendChild(sectionLabel);
    }
  }

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

  if (!skipTiles && ratioError) {
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

  if (!skipTiles && !ratioError) {
    const isRemovalMode = Boolean(state.view?.removalMode);
    const avail = computeAvailableArea(currentRoom, exclusions);
    if (avail.error) setLastTileError(avail.error);
    else setLastTileError(null);

    if (avail.mp) {
      const t = tilesForPreview(state, avail.mp, isRemovalMode);
      if (t.error) setLastTileError(t.error);
      else setLastTileError(null);

      previewTiles = t.tiles;

      const g = svgEl("g", { opacity: 1 });
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
    const common = {
      fill: isSel ? "rgba(239,68,68,0.25)" : "rgba(239,68,68,0.15)",
      stroke: isSel ? "rgba(239,68,68,0.95)" : "rgba(239,68,68,0.55)",
      "stroke-width": isSel ? 2 : 1,
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
      const exclusionShapes = svgFullscreen.querySelectorAll('[data-exid]');
      exclusionShapes.forEach(shape => {
        shape.addEventListener('pointerdown', onExclPointerDown);
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
  let roomsHtml = `<table class="commercial-table">
    <thead>
      <tr>
        <th>${t("tabs.floor")}</th>
        <th>${t("tabs.room")}</th>
        <th>${t("tile.reference")}</th>
        <th style="text-align:right">${t("metrics.netArea")}</th>
        <th style="text-align:right">${t("metrics.totalTiles")}</th>
        <th style="text-align:right">${t("metrics.price")}</th>
      </tr>
    </thead>
    <tbody>`;

  for (const r of proj.rooms) {
    roomsHtml += `<tr>
      <td class="subtle">${escapeHTML(r.floorName)}</td>
      <td class="room-name">${escapeHTML(r.name)}</td>
      <td class="material-ref">${escapeHTML(r.reference || "-")}</td>
      <td style="text-align:right">${r.netAreaM2.toFixed(2)} m²</td>
      <td style="text-align:right">${r.totalTiles}</td>
      <td style="text-align:right">${r.totalCost.toFixed(2)} €</td>
    </tr>`;
  }
  roomsHtml += `</tbody></table>`;
  roomsListEl.innerHTML = roomsHtml;

  // 2. Render Consolidated Materials Table
  let matsHtml = `<table class="commercial-table">
    <thead>
      <tr>
        <th>${t("tile.reference")}</th>
        <th style="text-align:right">${t("commercial.totalM2")}</th>
        <th style="text-align:right">${t("commercial.totalTiles")}</th>
        <th style="text-align:right">${t("commercial.totalPacks")}</th>
        <th style="text-align:right">${t("commercial.amountOverride")}</th>
        <th style="text-align:right">${t("commercial.pricePerM2")}</th>
        <th style="text-align:right">${t("commercial.pricePerPack")}</th>
        <th style="text-align:right">${t("commercial.packSize")}</th>
        <th style="text-align:right">${t("commercial.totalCost")}</th>
      </tr>
    </thead>
    <tbody>`;

  for (const m of proj.materials) {
    const ref = m.reference || "";
    const pricePerPack = (m.pricePerM2 * m.packM2).toFixed(2);
    matsHtml += `<tr>
      <td class="material-ref">${escapeHTML(ref || t("commercial.defaultMaterial"))}</td>
      <td style="text-align:right">${m.netAreaM2.toFixed(2)} m²</td>
      <td style="text-align:right">${m.totalTiles}</td>
      <td style="text-align:right"><strong>${m.totalPacks || 0}</strong></td>
      <td style="text-align:right">
        <input type="number" step="1" class="commercial-edit" data-ref="${escapeHTML(ref)}" data-prop="extraPacks" value="${m.extraPacks}" style="width:40px" />
      </td>
      <td style="text-align:right">
        <input type="number" step="0.01" class="commercial-edit" data-ref="${escapeHTML(ref)}" data-prop="pricePerM2" value="${m.pricePerM2.toFixed(2)}" style="width:60px" /> €
      </td>
      <td style="text-align:right">
        <input type="number" step="0.01" class="commercial-edit" data-ref="${escapeHTML(ref)}" data-prop="pricePerPack" value="${pricePerPack}" style="width:60px" /> €
      </td>
      <td style="text-align:right">
        <input type="number" step="0.01" class="commercial-edit" data-ref="${escapeHTML(ref)}" data-prop="packM2" value="${m.packM2}" /> m²
      </td>
      <td style="text-align:right"><strong>${m.adjustedCost.toFixed(2)} €</strong></td>
    </tr>`;
  }
  
  // Grand Total Row
  matsHtml += `<tr style="border-top: 2px solid var(--line2); font-weight:bold;">
    <td>${t("commercial.grandTotal")}</td>
    <td style="text-align:right">${proj.totalNetAreaM2.toFixed(2)} m²</td>
    <td style="text-align:right">${proj.totalTiles}</td>
    <td style="text-align:right">${proj.totalPacks}</td>
    <td colspan="4"></td>
    <td style="text-align:right; color:var(--accent);">${proj.totalCost.toFixed(2)} €</td>
  </tr>`;

  matsHtml += `</tbody></table>`;
  materialsListEl.innerHTML = matsHtml;
}