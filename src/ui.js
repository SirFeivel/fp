// src/ui.js
import { downloadText, safeParseJSON, getCurrentRoom } from "./core.js";
import { t } from "./i18n.js";
import { getRoomSections } from "./composite.js";

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
    next.view.showGrid = Boolean(document.getElementById("showGrid")?.checked);
    next.view.showSkirting = Boolean(document.getElementById("showSkirting")?.checked);

    const nextRoom = getCurrentRoom(next);
    if (nextRoom) {
      nextRoom.name = document.getElementById("roomName")?.value ?? "";

      nextRoom.skirting = nextRoom.skirting || {};
      nextRoom.skirting.enabled = Boolean(document.getElementById("skirtingEnabled")?.checked);
      nextRoom.skirting.type = document.getElementById("skirtingType")?.value;
      nextRoom.skirting.heightCm = Number(document.getElementById("skirtingHeight")?.value);
      nextRoom.skirting.boughtWidthCm = Number(document.getElementById("skirtingBoughtWidth")?.value);
      nextRoom.skirting.boughtPricePerPiece = Number(document.getElementById("skirtingPricePerPiece")?.value);
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

    currentRoom.grout.widthCm = Number(document.getElementById("groutW")?.value);
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
    next.pricing = next.pricing || {};
    const pricePerM2 = document.getElementById("pricePerM2");
    const packM2 = document.getElementById("packM2");
    const reserveTiles = document.getElementById("reserveTiles");
    if (pricePerM2) next.pricing.pricePerM2 = Number(pricePerM2.value);
    if (packM2) next.pricing.packM2 = Number(packM2.value);
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
    setSelectedExcl(null);
    resetErrors();
    store.commit("Reset", defaultStateFn(), {
      onRender: renderAll,
      updateMetaCb: updateMeta
    });
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
  document.getElementById("showGrid")?.addEventListener("change", () =>
    commitFromRoomInputs(t("room.viewChanged"))
  );
  document.getElementById("showSkirting")?.addEventListener("change", () =>
    commitFromRoomInputs(t("room.viewChanged"))
  );

  // Skirting inputs
  document.getElementById("skirtingEnabled")?.addEventListener("change", () =>
    commitFromRoomInputs(t("skirting.changed"))
  );
  document.getElementById("skirtingType")?.addEventListener("change", () =>
    commitFromRoomInputs(t("skirting.changed"))
  );
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
    "pricePerM2",
    "packM2",
    'reserveTiles',
    'wasteKerfCm',
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
  document.getElementById("btnExport")?.addEventListener("click", () => {
    const state = store.getState();
    const fname = `floorplanner_state_${(state.project?.name || "projekt").replace(
      /\s+/g,
      "_"
    )}.json`;
    downloadText(fname, JSON.stringify(state, null, 2));
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
}