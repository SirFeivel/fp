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

    const nextRoom = getCurrentRoom(next);
    if (nextRoom) {
      nextRoom.name = document.getElementById("roomName")?.value ?? "";
      nextRoom.widthCm = Number(document.getElementById("roomW")?.value);
      nextRoom.heightCm = Number(document.getElementById("roomH")?.value);
    }

    next.view = next.view || {};
    next.view.showGrid = Boolean(document.getElementById("showGrid")?.checked);

    store.commit(label, next, { onRender: renderAll, updateMetaCb: updateMeta });
  }

  function commitFromTilePatternInputs(label) {
    const state = store.getState();
    const next = structuredClone(state);

    const currentRoom = getCurrentRoom(next);
    if (!currentRoom) return;

    currentRoom.tile.widthCm = Number(document.getElementById("tileW")?.value);
    currentRoom.tile.heightCm = Number(document.getElementById("tileH")?.value);
    currentRoom.grout.widthCm = Number(document.getElementById("groutW")?.value);

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
  wireInputCommit(document.getElementById("roomW"), {
    markDirty: () => store.markDirty(),
    commitLabel: t("room.changed"),
    commitFn: commitFromRoomInputs
  });
  wireInputCommit(document.getElementById("roomH"), {
    markDirty: () => store.markDirty(),
    commitLabel: t("room.changed"),
    commitFn: commitFromRoomInputs
  });
  document.getElementById("showGrid")?.addEventListener("change", () =>
    commitFromRoomInputs(t("room.viewChanged"))
  );

  // Tile + Pattern + Pricing
  [
    "tileW",
    "tileH",
    "groutW",
    "offsetX",
    "offsetY",
    "originX",
    "originY",
    "pricePerM2",
    "packM2",
    'reserveTiles',
    'wasteKerfCm',
  ].forEach((id) =>
    wireInputCommit(document.getElementById(id), {
      markDirty: () => store.markDirty(),
      commitLabel: t("tile.changed"),
      commitFn: commitFromTilePatternInputs
    })
  );

  ["patternType", "bondFraction", "rotationDeg", "originPreset"].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", () =>
      commitFromTilePatternInputs(t("tile.patternChanged"))
    );
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
  document.getElementById("btnConvertToSections")?.addEventListener("click", () => {
    if (sections) sections.convertToSections();
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