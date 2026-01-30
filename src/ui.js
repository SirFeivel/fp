// src/ui.js
import { downloadText, safeParseJSON, getCurrentRoom } from "./core.js";
import { t } from "./i18n.js";
import { getRoomSections } from "./composite.js";
import { computeProjectTotals } from "./calc.js";

function wireInputCommit(el, { markDirty, commitLabel, commitFn }) {
  if (!el) return;
  el.addEventListener("input", () => markDirty());
  el.addEventListener("blur", () => commitFn(commitLabel));
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      el.blur();
    }
  });
}

async function handleImportFile(file, { validateState, commit }) {
  const text = await file.text();
  const parsed = safeParseJSON(text);
  if (!parsed.ok) {
    alert(t("importExport.importFailed"));
    return;
  }
  const candidate = parsed.value;
  const { errors } = validateState(candidate);
  if (errors.length > 0) {
    alert(
      t("importExport.importRejected") + "\n- " + errors.map((e) => e.title).join("\n- ")
    );
    return;
  }
  commit("Import JSON", candidate);
}

export function bindUI({
  store,
  excl,
  sections,
  renderAll,
  refreshProjectSelect,
  updateMeta,
  validateState,
  defaultStateFn,
  setSelectedExcl,
  setSelectedSection,
  resetErrors
}) {
  function commitFromRoomInputs(label) {
    const state = store.getState();
    const next = structuredClone(state);

    next.view = next.view || {};
    const showGridEl = document.getElementById('showGrid');
    const showSkirtingEl = document.getElementById('showSkirting');
    const removalModeEl = document.getElementById('removalMode');

    if (showGridEl) next.view.showGrid = Boolean(showGridEl.checked);
    if (showSkirtingEl) next.view.showSkirting = Boolean(showSkirtingEl.checked);
    if (removalModeEl) next.view.removalMode = Boolean(removalModeEl.checked);

    const nextRoom = getCurrentRoom(next);
    if (nextRoom) {
      nextRoom.name = document.getElementById("roomName")?.value ?? "";

      nextRoom.skirting = nextRoom.skirting || {};
    const roomSkirtingEnabled = document.getElementById("roomSkirtingEnabled");
    const planningRoomSkirtingEnabled = document.getElementById("planningRoomSkirtingEnabled");
    if (planningRoomSkirtingEnabled) {
      nextRoom.skirting.enabled = Boolean(planningRoomSkirtingEnabled.checked);
    } else if (roomSkirtingEnabled) {
      nextRoom.skirting.enabled = Boolean(roomSkirtingEnabled.checked);
    }
      const selectedTypeRaw = document.getElementById("skirtingType")?.value;
      const selectedType =
        selectedTypeRaw === "bought" || selectedTypeRaw === "cutout"
          ? selectedTypeRaw
          : "cutout";
      const ref = nextRoom.tile?.reference;
    const preset = ref ? next.tilePresets?.find(p => p?.name && p.name === ref) : null;
    const prevCutoutAllowed = Boolean(preset?.useForSkirting);
    const cutoutAllowed = ref ? Boolean(preset?.useForSkirting) : true;
    nextRoom.skirting.type = selectedType === "cutout" && !cutoutAllowed ? "bought" : selectedType;
      nextRoom.skirting.heightCm = Number(document.getElementById("skirtingHeight")?.value);
      nextRoom.skirting.boughtWidthCm = Number(document.getElementById("skirtingBoughtWidth")?.value);
      nextRoom.skirting.boughtPricePerPiece = Number(document.getElementById("skirtingPricePerPiece")?.value);
    }

    if (!prevCutoutAllowed && cutoutAllowed && ref && nextRoom.skirting?.enabled) {
      nextRoom.skirting.type = "cutout";
    }

    store.commit(label, next, { onRender: renderAll, updateMetaCb: updateMeta });
  }

  function commitFromTilePatternInputs(label) {
    const state = store.getState();
    const next = structuredClone(state);

    const currentRoom = getCurrentRoom(next);
    if (!currentRoom) return;

    const shape = document.getElementById("tileShape")?.value || "rect";
    const widthCm = Number(document.getElementById("tileW")?.value);

    currentRoom.tile.shape = shape;
    currentRoom.tile.widthCm = widthCm;
    currentRoom.tile.reference = document.getElementById("tileReference")?.value ?? "";

    if (shape === "hex") {
      const sideLength = widthCm / Math.sqrt(3);
      currentRoom.tile.heightCm = sideLength * 2;
    } else if (shape === "square") {
      currentRoom.tile.heightCm = widthCm;
    } else if (shape === "rhombus") {
      // For rhombus, we can also use width for height if they are meant to be equal-sided,
      // but let's allow custom height for now to define the other diagonal.
      currentRoom.tile.heightCm = Number(document.getElementById("tileH")?.value);
    } else {
      currentRoom.tile.heightCm = Number(document.getElementById("tileH")?.value);
    }

    // Convert mm input to cm for state
    currentRoom.grout.widthCm = Number(document.getElementById("groutW")?.value) / 10;
    currentRoom.grout.colorHex = document.getElementById("groutColor")?.value || "#ffffff";

    currentRoom.pattern.type = document.getElementById("patternType")?.value;
    currentRoom.pattern.bondFraction = Number(
      document.getElementById("bondFraction")?.value
    );
    currentRoom.pattern.rotationDeg = Number(
      document.getElementById("rotationDeg")?.value
    );
    currentRoom.pattern.offsetXcm = Number(document.getElementById("offsetX")?.value);
    currentRoom.pattern.offsetYcm = Number(document.getElementById("offsetY")?.value);

    currentRoom.pattern.origin.preset = document.getElementById("originPreset")?.value;
    currentRoom.pattern.origin.xCm = Number(document.getElementById("originX")?.value);
    currentRoom.pattern.origin.yCm = Number(document.getElementById("originY")?.value);

    // Pricing
    const reserveTiles = document.getElementById("reserveTiles");
    next.pricing = next.pricing || {};
    if (reserveTiles) next.pricing.reserveTiles = Number(reserveTiles.value);

    // Waste options
    next.waste = next.waste || {};
    const allowRotate = document.getElementById("wasteAllowRotate");
    if (allowRotate) next.waste.allowRotate = Boolean(allowRotate.checked);

    // Waste: kerfCm (Schnittbreite)
    const kerfEl = document.getElementById('wasteKerfCm');
    if (kerfEl) next.waste.kerfCm = Number(kerfEl.value);

    const optimizeCuts = document.getElementById("wasteOptimizeCuts");
    if (optimizeCuts) next.waste.optimizeCuts = Boolean(optimizeCuts.checked);

    // View debug
    next.view = next.view || {};
    const dbg = document.getElementById("debugShowNeeds");
    if (dbg) next.view.showNeeds = Boolean(dbg.checked);

    // Sync other rooms with same reference to maintain consistency
    const ref = currentRoom.tile.reference;
    if (ref) {
      next.floors.forEach((f) => {
        if (f.rooms) {
          f.rooms.forEach((rm) => {
            if (rm.id !== currentRoom.id && rm.tile?.reference === ref) {
              rm.tile.widthCm = currentRoom.tile.widthCm;
              rm.tile.heightCm = currentRoom.tile.heightCm;
              rm.tile.shape = currentRoom.tile.shape;
            }
          });
        }
      });
    }

    store.commit(label, next, { onRender: renderAll, updateMetaCb: updateMeta });
  }

  function bindExclList() {
    const sel = document.getElementById("exclList");
    if (!sel) return;
    sel.addEventListener("change", () => setSelectedExcl(sel.value || null));
  }

  function bindSectionsList() {
    const sel = document.getElementById("sectionsList");
    if (!sel) return;
    sel.addEventListener("change", () => setSelectedSection(sel.value || null));
  }

  function updateTileShapeUI() {
    const shape = document.getElementById("tileShape")?.value || "rect";
    const tileHField = document.getElementById("tileHeightField");
    const hexHint = document.getElementById("hexHint");
    const tileHInput = document.getElementById("tileH");
    const patternTypeField = document.getElementById("patternTypeField");

    if (shape === "hex") {
      if (tileHField) tileHField.style.display = "none";
      if (hexHint) hexHint.style.display = "block";
      if (patternTypeField) patternTypeField.style.display = "none";

      const widthCm = Number(document.getElementById("tileW")?.value) || 0;
      if (widthCm > 0 && tileHInput) {
        const sideLength = widthCm / Math.sqrt(3);
        tileHInput.value = (sideLength * 2).toFixed(2);
      }
    } else if (shape === "square") {
      if (tileHField) tileHField.style.display = "none";
      if (hexHint) hexHint.style.display = "none";
      if (patternTypeField) patternTypeField.style.display = "";

      const widthCm = Number(document.getElementById("tileW")?.value) || 0;
      if (widthCm > 0 && tileHInput) {
        tileHInput.value = widthCm;
      }

      // Filter patterns for square
      const patternTypeSelect = document.getElementById("patternType");
      if (patternTypeSelect) {
        Array.from(patternTypeSelect.options).forEach(opt => {
          const squareInapplicable = ["herringbone", "doubleHerringbone", "basketweave", "verticalStackAlternating"];
          opt.hidden = squareInapplicable.includes(opt.value);
          opt.disabled = opt.hidden;
        });

        // Reset if current selection is now hidden
        const currentOpt = patternTypeSelect.options[patternTypeSelect.selectedIndex];
        if (currentOpt && (currentOpt.hidden || currentOpt.disabled)) {
          patternTypeSelect.value = "grid";
        }
      }
    } else if (shape === "rhombus") {
      if (tileHField) tileHField.style.display = "";
      if (hexHint) hexHint.style.display = "none";
      if (patternTypeField) patternTypeField.style.display = "none";
    } else {
      if (tileHField) tileHField.style.display = "";
      if (hexHint) hexHint.style.display = "none";
      if (patternTypeField) patternTypeField.style.display = "";

      // Only show applicable patterns for rectangular tiles
      const patternTypeSelect = document.getElementById("patternType");
      if (patternTypeSelect) {
        const tw = Number(document.getElementById("tileW")?.value) || 0;
        const th = Number(document.getElementById("tileH")?.value) || 0;
        const isSquare = Math.abs(tw - th) < 1e-6;

        Array.from(patternTypeSelect.options).forEach(opt => {
          if (isSquare && tw > 0) {
            // Patterns that don't make sense for square tiles (even if they are shape="rect")
            const squareInapplicable = ["herringbone", "doubleHerringbone", "basketweave", "verticalStackAlternating"];
            opt.hidden = squareInapplicable.includes(opt.value);
            opt.disabled = opt.hidden;
          } else {
            opt.hidden = false;
            opt.disabled = false;
          }
        });

        // Reset if current selection is now hidden
        const currentOpt = patternTypeSelect.options[patternTypeSelect.selectedIndex];
        if (currentOpt && (currentOpt.hidden || currentOpt.disabled)) {
          patternTypeSelect.value = "grid";
        }
      }
    }
  }

  // Buttons
  document.getElementById("btnReset")?.addEventListener("click", () => {
    if (confirm(t("session.confirmReset"))) {
      setSelectedExcl(null);
      setSelectedSection(null);
      resetErrors();
      store.commit(t("session.reset"), defaultStateFn(), {
        onRender: renderAll,
        updateMetaCb: updateMeta
      });
    }
  });

  document.getElementById("btnLoadSession")?.addEventListener("click", () => {
    const ok = store.loadSessionIfAny();
    if (!ok) {
      alert(t("errors.noSession"));
      return;
    }
    setSelectedExcl(null);
    resetErrors();
    store.autosaveSession(updateMeta);
    renderAll(t("errors.sessionRestored"));
  });

  document.getElementById("btnSaveProject")?.addEventListener("click", () => {
    const state = store.getState();
    const name =
      document.getElementById("projectName")?.value.trim() ||
      (state.project?.name ?? "Projekt");
    store.saveCurrentAsProject(name);
    store.autosaveSession(updateMeta);
    renderAll(t("project.saved"));
  });

  document.getElementById("btnLoadProject")?.addEventListener("click", () => {
    const id = document.getElementById("projectSelect")?.value;
    if (!id) return;

    const res = store.loadProjectById(id);
    if (!res.ok) {
      alert(t("project.notFound"));
      return;
    }
    setSelectedExcl(null);
    resetErrors();
    renderAll(`${t("project.loaded")}: ${res.name}`);
  });

  document.getElementById("btnDeleteProject")?.addEventListener("click", () => {
    const id = document.getElementById("projectSelect")?.value;
    if (!id) return;
    store.deleteProjectById(id);
    store.autosaveSession(updateMeta);
    renderAll(t("project.deleted"));
  });

  // Room inputs
  wireInputCommit(document.getElementById("roomName"), {
    markDirty: () => store.markDirty(),
    commitLabel: t("room.changed"),
    commitFn: commitFromRoomInputs
  });
  wireInputCommit(document.getElementById("tileReference"), {
    markDirty: () => store.markDirty(),
    commitLabel: t("tile.changed"),
    commitFn: commitFromTilePatternInputs
  });
  document.getElementById("roomSkirtingEnabled")?.addEventListener("change", () => {
    commitFromRoomInputs(t("skirting.changed"));
  });
  document.getElementById("planningRoomSkirtingEnabled")?.addEventListener("change", () => {
    commitFromRoomInputs(t("skirting.changed"));
  });

  document.getElementById("btnApplyTilePreset")?.addEventListener("click", () => {
    const sel = document.getElementById("tilePresetSelect");
    const presetId = sel?.value;
    if (!presetId) return;
    const state = store.getState();
    const preset = state.tilePresets?.find(p => p.id === presetId);
    if (!preset) return;

    const next = structuredClone(state);
    const room = getCurrentRoom(next);
    if (!room) return;

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

    store.commit(t("tile.changed"), next, { onRender: renderAll, updateMetaCb: updateMeta });
  });

  document.getElementById("tileReference")?.addEventListener("change", (e) => {
    const newRef = e.target.value;
    if (!newRef) return;

    const state = store.getState();
    const currentRoom = getCurrentRoom(state);
    if (!currentRoom) return;

    // Check if this reference is already used elsewhere to sync settings
    let sourceTile = null;
    if (state.floors) {
      for (const floor of state.floors) {
        if (floor.rooms) {
          for (const room of floor.rooms) {
            if (room.id !== currentRoom.id && room.tile?.reference === newRef) {
              sourceTile = room.tile;
              break;
            }
          }
        }
        if (sourceTile) break;
      }
    }

    if (sourceTile) {
      const next = structuredClone(state);
      const nextRoom = getCurrentRoom(next);
      if (nextRoom) {
        nextRoom.tile.reference = newRef;
        nextRoom.tile.widthCm = sourceTile.widthCm;
        nextRoom.tile.heightCm = sourceTile.heightCm;
        nextRoom.tile.shape = sourceTile.shape;
        // Pricing is already handled by reference in getRoomPricing
        store.commit(t("tile.changed"), next, { onRender: renderAll, updateMetaCb: updateMeta });
      }
    }
  });
  document.addEventListener("change", (e) => {
    if (e.target.id === 'showGrid' || e.target.id === 'showSkirting' || e.target.id === 'removalMode') {
      const val = e.target.checked;
      document.querySelectorAll('#' + e.target.id).forEach(el => el.checked = val);
      commitFromRoomInputs(t("room.viewChanged"));
    }
  });

  // Skirting inputs
  document.getElementById("skirtingEnabled")?.addEventListener("change", () =>
    commitFromRoomInputs(t("skirting.changed"))
  );
  document.getElementById("skirtingType")?.addEventListener("change", () =>
    commitFromRoomInputs(t("skirting.changed"))
  );
  document.getElementById("btnApplySkirtingPreset")?.addEventListener("click", () => {
    const sel = document.getElementById("skirtingPresetSelect");
    const presetId = sel?.value;
    if (!presetId) return;
    const state = store.getState();
    const preset = state.skirtingPresets?.find(p => p.id === presetId);
    if (!preset) return;
    const next = structuredClone(state);
    const room = getCurrentRoom(next);
    if (!room) return;
    room.skirting.enabled = true;
    room.skirting.type = "bought";
    room.skirting.heightCm = Number(preset.heightCm) || room.skirting.heightCm;
    room.skirting.boughtWidthCm = Number(preset.lengthCm) || room.skirting.boughtWidthCm;
    room.skirting.boughtPricePerPiece = Number(preset.pricePerPiece) || room.skirting.boughtPricePerPiece;
    store.commit(t("skirting.changed"), next, { onRender: renderAll, updateMetaCb: updateMeta });
  });
  [
    "skirtingHeight",
    "skirtingBoughtWidth",
    "skirtingPricePerPiece"
  ].forEach(id => {
    wireInputCommit(document.getElementById(id), {
      markDirty: () => store.markDirty(),
      commitLabel: t("skirting.changed"),
      commitFn: commitFromRoomInputs
    });
  });

  // Tile + Pattern + Pricing
  [
    "tileW",
    "tileH",
    "groutW",
    "groutColor",
    "offsetX",
    "offsetY",
    "originX",
    "originY",
    "reserveTiles",
    "wasteKerfCm",
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (id === "tileW" || id === "tileH") {
      el?.addEventListener("input", () => {
        updateTileShapeUI();
        store.markDirty();
      });
      el?.addEventListener("blur", () => commitFromTilePatternInputs(t("tile.changed")));
      el?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          el.blur();
        }
      });
    } else {
      wireInputCommit(el, {
        markDirty: () => store.markDirty(),
        commitLabel: t("tile.changed"),
        commitFn: commitFromTilePatternInputs
      });
    }
  });


  // Grout color preset swatches
  document.getElementById("groutColorPresets")?.addEventListener("click", (e) => {
    const swatch = e.target.closest(".color-swatch");
    if (!swatch) return;
    const color = swatch.dataset.color;
    if (!color) return;

    // Update color picker value
    const colorInput = document.getElementById("groutColor");
    if (colorInput) colorInput.value = color;

    // Update selected state
    document.querySelectorAll("#groutColorPresets .color-swatch").forEach(s => s.classList.remove("selected"));
    swatch.classList.add("selected");

    // Commit the change
    commitFromTilePatternInputs(t("tile.changed"));
  });

  ["tileShape", "patternType", "bondFraction", "rotationDeg", "originPreset"].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", () => {
      if (id === "tileShape") updateTileShapeUI();
      commitFromTilePatternInputs(t("tile.patternChanged"));
    });
  });

  // Waste toggles
  document.getElementById("wasteAllowRotate")?.addEventListener("change", () =>
    commitFromTilePatternInputs(t("waste.changed"))
  );
  document.getElementById("wasteOptimizeCuts")?.addEventListener("change", () =>
    commitFromTilePatternInputs(t("waste.optimizeChanged"))
  );

  // Debug toggle
  document.getElementById("debugShowNeeds")?.addEventListener("change", () =>
    commitFromTilePatternInputs(t("debug.changed"))
  );

  // Offset buttons
  document.getElementById("btnOffLeft")?.addEventListener("click", () => {
    const el = document.getElementById("offsetX");
    if (el) el.value = String(Number(el.value || 0) - 1);
    commitFromTilePatternInputs(t("tile.offsetChanged"));
  });
  document.getElementById("btnOffRight")?.addEventListener("click", () => {
    const el = document.getElementById("offsetX");
    if (el) el.value = String(Number(el.value || 0) + 1);
    commitFromTilePatternInputs(t("tile.offsetChanged"));
  });
  document.getElementById("btnOffUp")?.addEventListener("click", () => {
    const el = document.getElementById("offsetY");
    if (el) el.value = String(Number(el.value || 0) - 1);
    commitFromTilePatternInputs(t("tile.offsetChanged"));
  });
  document.getElementById("btnOffDown")?.addEventListener("click", () => {
    const el = document.getElementById("offsetY");
    if (el) el.value = String(Number(el.value || 0) + 1);
    commitFromTilePatternInputs(t("tile.offsetChanged"));
  });

  document.getElementById("skirtingType")?.addEventListener("change", () => commitFromRoomInputs(t("skirting.changed")));
  wireInputCommit(document.getElementById("skirtingHeight"), {
    markDirty: () => {},
    commitLabel: t("skirting.changed"),
    commitFn: commitFromRoomInputs,
  });
  wireInputCommit(document.getElementById("skirtingBoughtWidth"), {
    markDirty: () => {},
    commitLabel: t("skirting.changed"),
    commitFn: commitFromRoomInputs,
  });
  wireInputCommit(document.getElementById("skirtingPricePerPiece"), {
    markDirty: () => {},
    commitLabel: t("skirting.changed"),
    commitFn: commitFromRoomInputs,
  });


  // Sections
  document.getElementById("btnAddSection")?.addEventListener("click", () => {
    if (sections) sections.addSection("right");
  });
  document.getElementById("btnDeleteSection")?.addEventListener("click", () => {
    if (sections) sections.deleteSelectedSection();
  });
  bindSectionsList();

  // Exclusions
  document.getElementById("btnAddRect")?.addEventListener("click", excl.addRect);
  document.getElementById("btnAddCircle")?.addEventListener("click", excl.addCircle);
  document.getElementById("btnAddTri")?.addEventListener("click", excl.addTri);
  document.getElementById("btnDeleteExcl")?.addEventListener("click", excl.deleteSelectedExcl);
  bindExclList();

  // Undo/Redo
  document.getElementById("btnUndo")?.addEventListener("click", () =>
    store.undo({ onRender: renderAll, updateMetaCb: updateMeta })
  );
  document.getElementById("btnRedo")?.addEventListener("click", () =>
    store.redo({ onRender: renderAll, updateMetaCb: updateMeta })
  );

  // Export
  const exportJson = () => {
    const state = store.getState();
    const fname = `floorplanner_state_${(state.project?.name || "projekt").replace(
      /\s+/g,
      "_"
    )}.json`;
    downloadText(fname, JSON.stringify(state, null, 2));
  };

  document.getElementById("btnExport")?.addEventListener("click", exportJson);
  document.getElementById("menuExport")?.addEventListener("click", exportJson);

  document.getElementById("btnExportCommercial")?.addEventListener("click", () => {
    const state = store.getState();
    const proj = computeProjectTotals(state);
    
    let text = `PROJECT: ${state.project?.name || "Untitled"}\n`;
    text += `DATE: ${new Date().toLocaleString()}\n\n`;
    
    text += `ROOM OVERVIEW:\n`;
    text += `--------------------------------------------------------------------------------\n`;
    text += `Floor       | Room        | Material    | Area (m2) | Tiles | Cost (€)\n`;
    text += `--------------------------------------------------------------------------------\n`;
    for (const r of proj.rooms) {
      text += `${(r.floorName || "").padEnd(11)} | ${(r.name || "").padEnd(11)} | ${(r.reference || "-").padEnd(11)} | ${r.netAreaM2.toFixed(2).padStart(9)} | ${String(r.totalTiles).padStart(5)} | ${r.totalCost.toFixed(2).padStart(8)}\n`;
    }
    
    text += `\nCONSOLIDATED MATERIALS:\n`;
    text += `----------------------------------------------------------------------------------------------------\n`;
    text += `Material    | Total Area | Total Tiles | Packs | Adjust | Price/m2 | Total Cost\n`;
    text += `----------------------------------------------------------------------------------------------------\n`;
    for (const m of proj.materials) {
      text += `${(m.reference || "Default").padEnd(11)} | ${m.netAreaM2.toFixed(2).padStart(10)} | ${String(m.totalTiles).padStart(11)} | ${String(m.totalPacks || 0).padStart(5)} | ${String(m.extraPacks || 0).padStart(6)} | ${m.pricePerM2.toFixed(2).padStart(8)} | ${m.adjustedCost.toFixed(2).padStart(10)}\n`;
    }
    
    text += `\n----------------------------------------------------------------------------------------------------\n`;
    text += `GRAND TOTAL | ${proj.totalNetAreaM2.toFixed(2).padStart(10)} | ${String(proj.totalTiles).padStart(11)} | ${String(proj.totalPacks).padStart(5)} |        |          | ${proj.totalCost.toFixed(2).padStart(10)}\n`;

    const fname = `fp-summary-${(state.project?.name || "export").replace(/\s+/g, "_")}.txt`;
    downloadText(fname, text);
  });

  // Commercial Tab Inline Edits (Event Delegation)
  document.getElementById("commercialMaterialsList")?.addEventListener("change", (e) => {
    if (e.target.classList.contains("commercial-edit")) {
      const ref = e.target.dataset.ref;
      const prop = e.target.dataset.prop;
      const val = Number(e.target.value);

      const state = store.getState();
      const next = structuredClone(state);
      next.materials = next.materials || {};
      next.materials[ref] = next.materials[ref] || { 
        pricePerM2: state.pricing?.pricePerM2 || 0, 
        packM2: state.pricing?.packM2 || 0 
      };

      if (prop === "pricePerPack") {
        // user entered price per pack, we need price per m2
        const packM2 = next.materials[ref].packM2 || state.pricing?.packM2 || 1;
        next.materials[ref].pricePerM2 = val / packM2;
      } else if (prop === "pricePerM2") {
        next.materials[ref].pricePerM2 = val;
      } else if (prop === "packM2") {
        // user changed pack size, we might want to keep price per m2 but update pack size
        next.materials[ref].packM2 = val;
      } else if (prop === "extraPacks") {
        next.materials[ref].extraPacks = val;
      }

      store.commit(`Update Material: ${ref}`, next, { onRender: renderAll, updateMetaCb: updateMeta });
    }
  });

  // Import
  document.getElementById("btnImport")?.addEventListener("click", () => {
    document.getElementById("fileImport")?.click();
  });

  document.getElementById("fileImport")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await handleImportFile(file, {
      validateState,
      commit: (label, next) =>
        store.commit(label, next, { onRender: renderAll, updateMetaCb: updateMeta })
    });
    e.target.value = "";
  });

  // Copy
  document.getElementById("btnCopy")?.addEventListener("click", async () => {
    const state = store.getState();
    try {
      await navigator.clipboard.writeText(JSON.stringify(state, null, 2));
      alert(t("importExport.stateCopied"));
    } catch {
      alert(t("importExport.copyFailed"));
    }
  });

  // unload warning
  window.addEventListener("beforeunload", (e) => {
    if (!store.isDirty()) return;
    e.preventDefault();
    e.returnValue = "";
  });

  refreshProjectSelect();
  updateMeta();

  document.getElementById("btnRoomBack")?.addEventListener("click", () => {
    document.querySelector('[data-tab="room"]').click();
  });
}
