// src/render.js
import { computePlanMetrics } from "./calc.js";
import { escapeHTML, getCurrentRoom } from "./core.js";
import { t } from "./i18n.js";
import {
  svgEl,
  multiPolygonToPathD,
  computeExclusionsUnion,
  computeAvailableArea,
  tilesForPreview
} from "./geometry.js";

export function renderWarnings(state, validateState) {
  const { errors, warns } = validateState(state);
  const wrap = document.getElementById("warnings");
  if (!wrap) return;

  wrap.innerHTML = "";

  const all = [
    ...errors.map((x) => ({ ...x, level: t("warnings.error") })),
    ...warns.map((x) => ({ ...x, level: t("warnings.warn") }))
  ];

  const pill = document.getElementById("warnPill");
  if (pill) pill.textContent = String(all.length);

  if (all.length === 0) {
    const div = document.createElement("div");
    div.className = "warnItem";
    div.innerHTML = `<div class="wTitle">${t("warnings.none")}</div><div class="wText">${t("warnings.validationOk")}</div>`;
    wrap.appendChild(div);
    return;
  }

  for (const w of all) {
    const div = document.createElement("div");
    div.className = "warnItem";
    div.innerHTML = `<div class="wTitle">${w.level}: ${escapeHTML(
      w.title
    )}</div><div class="wText">${escapeHTML(w.text)}</div>`;
    wrap.appendChild(div);
  }
}

export function renderMetrics(state) {
  const areaEl = document.getElementById("metricArea");
  const tilesEl = document.getElementById("metricTiles");
  const packsEl = document.getElementById("metricPacks");
  const costEl = document.getElementById("metricCost");

  if (!areaEl || !tilesEl || !packsEl || !costEl) return;

  const m = computePlanMetrics(state);
  if (!m.ok) {
    areaEl.textContent = "–";
    tilesEl.textContent = "–";
    packsEl.textContent = "–";
    costEl.textContent = m.error;
    return;
  }

  const d = m.data;
  const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : "–");

  areaEl.textContent = `${f2(d.area.netAreaM2)} m²`;
  tilesEl.textContent = `${d.tiles.totalTilesWithReserve} (${d.tiles.fullTiles} full, ${d.tiles.cutTiles} cut, ${d.tiles.reusedCuts} reused)`;

  const packs = d.pricing.packs;
  if (packs !== null && packs > 0) {
    packsEl.textContent = `${packs} (${f2(d.material.purchasedAreaM2)} m²)`;
  } else {
    packsEl.textContent = `${f2(d.material.purchasedAreaM2)} m²`;
  }

  costEl.textContent = `${f2(d.pricing.priceTotal)} €`;
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
  document.getElementById("roomW").value = currentRoom?.widthCm ?? "";
  document.getElementById("roomH").value = currentRoom?.heightCm ?? "";
  document.getElementById("showGrid").checked = Boolean(state.view?.showGrid);
}

export function renderTilePatternForm(state) {
  document.getElementById("tileW").value = state.tile?.widthCm ?? "";
  document.getElementById("tileH").value = state.tile?.heightCm ?? "";
  document.getElementById("groutW").value = state.grout?.widthCm ?? "";

  document.getElementById("patternType").value = state.pattern?.type ?? "grid";
  document.getElementById("bondFraction").value = String(
    state.pattern?.bondFraction ?? 0.5
  );
  document.getElementById("rotationDeg").value = String(
    state.pattern?.rotationDeg ?? 0
  );
  document.getElementById("offsetX").value = state.pattern?.offsetXcm ?? 0;
  document.getElementById("offsetY").value = state.pattern?.offsetYcm ?? 0;

  document.getElementById("originPreset").value =
    state.pattern?.origin?.preset ?? "tl";
  document.getElementById("originX").value = state.pattern?.origin?.xCm ?? 0;
  document.getElementById("originY").value = state.pattern?.origin?.yCm ?? 0;

  const isRB = state.pattern?.type === "runningBond";
  document.getElementById("bondFraction").disabled = !isRB;

  // Pricing
  const pricePerM2 = document.getElementById("pricePerM2");
  const packM2 = document.getElementById("packM2");
  const reserveTiles = document.getElementById("reserveTiles");
  if (pricePerM2) pricePerM2.value = state.pricing?.pricePerM2 ?? 0;
  if (packM2) packM2.value = state.pricing?.packM2 ?? 0;
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
  metrics // optional; if omitted we compute it here
}) {
  const svg = document.getElementById("planSvg");
  const currentRoom = getCurrentRoom(state);

  if (!currentRoom) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.setAttribute("viewBox", "0 0 100 100");
    return;
  }

  const w = currentRoom.widthCm;
  const h = currentRoom.heightCm;
  const exclusions = currentRoom.exclusions || [];

  while (svg.firstChild) svg.removeChild(svg.firstChild);

  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

  svg.appendChild(svgEl("rect", { x: 0, y: 0, width: w, height: h, fill: "#081022" }));

  // grid
  if (state.view?.showGrid) {
    const g = svgEl("g", { opacity: 0.8 });
    const minor = 10, major = 100;
    for (let x = 0; x <= w; x += minor) {
      const isMajor = x % major === 0;
      g.appendChild(svgEl("line", {
        x1: x, y1: 0, x2: x, y2: h,
        stroke: isMajor ? "#1f2b46" : "#14203a",
        "stroke-width": isMajor ? 0.8 : 0.4
      }));
    }
    for (let y = 0; y <= h; y += minor) {
      const isMajor = y % major === 0;
      g.appendChild(svgEl("line", {
        x1: 0, y1: y, x2: w, y2: y,
        stroke: isMajor ? "#1f2b46" : "#14203a",
        "stroke-width": isMajor ? 0.8 : 0.4
      }));
    }
    svg.appendChild(g);
  }

  // room outline
  svg.appendChild(svgEl("rect", {
    x: 0, y: 0, width: w, height: h,
    fill: "rgba(122,162,255,0.06)",
    stroke: "rgba(122,162,255,0.8)",
    "stroke-width": 1.2
  }));

  const label = svgEl("text", {
    x: 8,
    y: 18,
    fill: "rgba(231,238,252,0.95)",
    "font-size": 14,
    "font-family": "system-ui, -apple-system, Segoe UI, Roboto, Arial"
  });
  label.textContent = `${currentRoom.name} — ${w}×${h} cm`;
  svg.appendChild(label);

  // tiles
  const avail = computeAvailableArea(currentRoom, exclusions);
  if (avail.error) setLastTileError(avail.error);
  else setLastTileError(null);

  let previewTiles = [];
  if (avail.mp) {
    const t = tilesForPreview(state, avail.mp);
    if (t.error) setLastTileError(t.error);
    else setLastTileError(null);

    previewTiles = t.tiles;

    const g = svgEl("g", { opacity: 1 });
    svg.appendChild(g);

    for (const tile of t.tiles) {
      g.appendChild(svgEl("path", {
        d: tile.d,
        fill: tile.isFull ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.05)",
        stroke: tile.isFull ? "rgba(255,255,255,0.30)" : "rgba(255,255,255,0.80)",
        "stroke-width": tile.isFull ? 0.5 : 1.2
      }));
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
  const u = computeExclusionsUnion(exclusions);
  if (u.error) setLastUnionError(u.error);
  else setLastUnionError(null);

  if (u.mp) {
    const unionPath = multiPolygonToPathD(u.mp);
    svg.appendChild(svgEl("path", {
      d: unionPath,
      fill: "rgba(239,68,68,0.15)",
      stroke: "rgba(239,68,68,0.55)",
      "stroke-width": 1.5
    }));
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
  svg.addEventListener("click", () => setSelectedExcl(null));

  // errors overlay
  if (lastUnionError) {
    const t = svgEl("text", {
      x: 8, y: 38,
      fill: "rgba(255,107,107,0.95)",
      "font-size": 12,
      "font-family": "system-ui, -apple-system, Segoe UI, Roboto, Arial"
    });
    t.textContent = `Union: ${lastUnionError}`;
    svg.appendChild(t);
  }
  if (lastTileError) {
    const t2 = svgEl("text", {
      x: 8, y: 54,
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

    if (onExclPointerDown) {
      const exclusionShapes = svgFullscreen.querySelectorAll('[data-exid]');
      exclusionShapes.forEach(shape => {
        shape.addEventListener('pointerdown', onExclPointerDown);
      });
    }
  }
}