// src/ui.js
import { downloadText, safeParseJSON, getCurrentRoom, getCurrentFloor, uuid, getDefaultPricing, getDefaultTilePresetTemplate, DEFAULT_TILE_PRESET, DEFAULT_PRICING } from "./core.js";
import { ensureRoomWalls } from "./surface.js";
import { t } from "./i18n.js";
import { computeProjectTotals } from "./calc.js";
import { EPSILON } from "./constants.js";
import { getUiState, setUiState } from "./ui_state.js";
import { showConfirm, showAlert } from "./dialog.js";

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
    await showAlert({
      title: t("dialog.importFailedTitle") || "Import Failed",
      message: t("importExport.importFailed") || "Failed to parse import file.",
      type: "error"
    });
    return;
  }
  const candidate = parsed.value;
  const { errors } = validateState(candidate);
  if (errors.length > 0) {
    await showAlert({
      title: t("dialog.importRejectedTitle") || "Import Rejected",
      message: t("importExport.importRejected") + "\n- " + errors.map((e) => e.title).join("\n- "),
      type: "error"
    });
    return;
  }
  commit("Import JSON", candidate);
}

export function bindUI({
  store,
  excl,
  renderAll,
  refreshProjectSelect,
  updateMeta,
  validateState,
  defaultStateFn,
  setSelectedExcl,
  resetErrors
}) {
  let tileEditActive = false;
  let tileEditDirty = false;
  let tileEditMode = "edit";
  let tileEditSnapshot = null;
  let tileEditUpdateArmed = false;
  let tileEditCreateIntent = false;
  let tileEditSuppressWarningReset = false;
  setUiState({ tileEditActive, tileEditDirty, tileEditMode });

  const setTileEditError = (msg) => {
    const el = document.getElementById("tileEditError");
    if (!el) return;
    if (!msg) {
      el.textContent = "";
      el.classList.add("hidden");
      return;
    }
    el.textContent = msg;
    el.classList.remove("hidden");
  };

  const normalizePresetName = (name) => (name || "").trim().toLowerCase();

  const resolvePresetName = (state, { presetId, refRaw, fallback, allowSuffixOnConflict }) => {
    const presets = state.tilePresets || [];
    const raw = (refRaw ?? "").trim();
    if (raw) {
      const normalized = normalizePresetName(raw);
      const conflict = presets.find(p => normalizePresetName(p?.name) === normalized && p?.id !== presetId);
      if (conflict) {
        if (!allowSuffixOnConflict) return { ok: false, name: raw };
        return { ok: true, name: getUniqueName(presets, raw) };
      }
      return { ok: true, name: raw };
    }

    const base = fallback || `${t("tile.preset")} ${presets.length + 1}`;
    return { ok: true, name: getUniqueName(presets, base) };
  };

  const getUniqueName = (presets, base) => {
    let candidate = base;
    let idx = 2;
    while (presets.find(p => normalizePresetName(p?.name) === normalizePresetName(candidate))) {
      candidate = `${base} ${idx}`;
      idx += 1;
    }
    return candidate;
  };

  const getCurrentPresetId = () => {
    const state = store.getState();
    const room = getCurrentRoom(state);
    const ref = room?.tile?.reference;
    if (!ref) return "";
    const match = state.tilePresets?.find(p => p?.name && p.name === ref);
    return match?.id || "";
  };

  const setTileEditMode = (mode) => {
    tileEditMode = mode;
    setUiState({ tileEditMode });
  };

  const normalizeTileValues = (values) => {
    const widthCm = Number(values.widthCm) || 0;
    let heightCm = Number(values.heightCm) || 0;
    if (values.shape === "hex" && widthCm > 0) {
      const sideLength = widthCm / Math.sqrt(3);
      heightCm = sideLength * 2;
    } else if (values.shape === "square" && widthCm > 0) {
      heightCm = widthCm;
    }
    return { ...values, widthCm, heightCm };
  };

  const validateTilePresetValues = (values) => {
    if (!(values.widthCm > 0) || !(values.heightCm > 0)) {
      setTileEditError(t("planning.tileEditInvalidDims"));
      return false;
    }
    if (values.pricePerM2 < 0 || values.packM2 < 0) {
      setTileEditError(t("planning.tileEditInvalidPrice"));
      return false;
    }
    return true;
  };

  const setTileEditWarning = (show) => {
    const warnEl = document.getElementById("tileEditWarning");
    if (!warnEl) return;
    warnEl.classList.toggle("hidden", !show);
  };

  const resetTileEditWarning = () => {
    if (tileEditSuppressWarningReset) return;
    tileEditUpdateArmed = false;
    setTileEditWarning(false);
    const updateBtn = document.getElementById("tileEditUpdateBtn");
    updateBtn?.classList.remove("armed");
  };

  const armTileEditWarning = () => {
    tileEditUpdateArmed = true;
    setTileEditWarning(true);
    const updateBtn = document.getElementById("tileEditUpdateBtn");
    updateBtn?.classList.add("armed");
  };

  const syncTileEditActions = () => {
    const actions = document.getElementById("tileEditActions");
    if (!actions) return;
    if (tileEditMode === "create" && !tileEditCreateIntent) {
      setTileEditMode("edit");
    }
    const mode = tileEditMode;
    actions.classList.toggle("hidden", !tileEditActive);
    const hasPreset = getUiState().tileEditHasPreset === true;
    const updateBtn = document.getElementById("tileEditUpdateBtn");
    const saveBtn = document.getElementById("tileEditSaveBtn");
    if (updateBtn) updateBtn.style.display = tileEditActive && mode !== "create" && hasPreset ? "" : "none";
    if (saveBtn) saveBtn.style.display = tileEditActive && (mode === "create" || hasPreset) ? "" : "none";
  };

  const setTileEditActive = (active) => {
    tileEditActive = active;
    setUiState({ tileEditActive });
    if (!active) {
      tileEditDirty = false;
      setUiState({ tileEditDirty });
      tileEditCreateIntent = false;
      setUiState({ tileEditHasPreset: false });
      resetTileEditWarning();
      setTileEditMode("edit");
    }
    renderAll();
    syncTileEditActions();
  };

  const markTileEditDirty = () => {
    if (tileEditActive) {
      tileEditDirty = true;
      setUiState({ tileEditDirty });
      setTileEditError("");
      resetTileEditWarning();
      if (tileEditMode === "create") {
        // keep create mode
      }
      syncTileEditActions();
    }
  };

  const snapshotTileEditState = () => {
    const state = store.getState();
    const room = getCurrentRoom(state);
    if (!room) return;
    const ref = room.tile?.reference;
    const preset = ref ? state.tilePresets?.find(p => p?.name && p.name === ref) : null;
    setUiState({ tileEditHasPreset: Boolean(preset) });
    tileEditSnapshot = {
      roomId: room.id,
      tile: structuredClone(room.tile || {}),
      grout: structuredClone(room.grout || {}),
      reference: ref || "",
      presetId: preset?.id || null,
      presetName: preset?.name || "",
      materialsRef: ref && state.materials ? structuredClone(state.materials[ref] || null) : null
    };
  };

  const readTileInputs = () => {
    const refRaw = document.getElementById("tileReference")?.value ?? "";
    const ref = refRaw.trim();
    const shape = document.getElementById("tileShape")?.value || "rect";
    const widthCm = Number(document.getElementById("tileW")?.value) || 0;
    const heightCm = Number(document.getElementById("tileH")?.value) || 0;
    const pricePerM2 = Number(document.getElementById("tilePricePerM2")?.value) || 0;
    const packM2 = Number(document.getElementById("tilePackM2")?.value) || 0;
    const useForSkirting = Boolean(document.getElementById("tileAllowSkirting")?.checked);
    return { ref, refRaw, shape, widthCm, heightCm, pricePerM2, packM2, useForSkirting };
  };

  const readGroutInputs = () => {
    const groutWidthCm = (Number(document.getElementById("groutW")?.value) || 0) / 10;
    const groutColorHex = document.getElementById("groutColor")?.value || "#ffffff";
    return { groutWidthCm, groutColorHex };
  };

  const applyTilePresetUpdate = (next, { preset, values, grout, asNew, oldName }) => {
    const room = getCurrentRoom(next);
    if (!room) return;
    const name = values.ref || preset?.name || `${t("tile.preset")} ${next.tilePresets?.length + 1}`;
    let targetPreset = preset;
    if (asNew || !targetPreset) {
      targetPreset = {
        id: uuid(),
        name,
        shape: values.shape,
        widthCm: values.widthCm,
        heightCm: values.heightCm,
        pricePerM2: values.pricePerM2,
        packM2: values.packM2,
        useForSkirting: values.useForSkirting
      };
      next.tilePresets = next.tilePresets || [];
      next.tilePresets.push(targetPreset);
    } else {
      targetPreset.name = name;
      targetPreset.shape = values.shape;
      targetPreset.widthCm = values.widthCm;
      targetPreset.heightCm = values.heightCm;
      targetPreset.pricePerM2 = values.pricePerM2;
      targetPreset.packM2 = values.packM2;
      targetPreset.useForSkirting = values.useForSkirting;
    }

    room.tile.shape = values.shape;
    room.tile.widthCm = values.widthCm;
    room.tile.heightCm = values.heightCm;
    room.tile.reference = targetPreset.name || room.tile.reference;
    room.grout.widthCm = grout.groutWidthCm;
    room.grout.colorHex = grout.groutColorHex;

    if (values.useForSkirting) {
      room.skirting.enabled = true;
      room.skirting.type = "cutout";
    }

    const ref = room.tile.reference;
    if (ref) {
      next.materials = next.materials || {};
      next.materials[ref] = next.materials[ref] || {};
      next.materials[ref].pricePerM2 = values.pricePerM2;
      next.materials[ref].packM2 = values.packM2;
    }

    if (!asNew && oldName) {
      next.floors?.forEach((floor) => {
        floor.rooms?.forEach((rm) => {
          if (rm.tile?.reference === oldName) {
            if (oldName !== ref) rm.tile.reference = ref;
            rm.tile.shape = values.shape;
            rm.tile.widthCm = values.widthCm;
            rm.tile.heightCm = values.heightCm;
          }
        });
      });
      if (oldName !== ref && next.materials?.[oldName]) {
        delete next.materials[oldName];
      }
    }
  };

  const revertTileEdits = (next) => {
    const room = getCurrentRoom(next);
    if (!room || !tileEditSnapshot) return;
    room.tile = structuredClone(tileEditSnapshot.tile || {});
    room.grout = structuredClone(tileEditSnapshot.grout || {});
    room.tile.reference = tileEditSnapshot.reference || room.tile.reference;
    const ref = tileEditSnapshot.reference;
    if (ref) {
      next.materials = next.materials || {};
      if (tileEditSnapshot.materialsRef) {
        next.materials[ref] = structuredClone(tileEditSnapshot.materialsRef);
      } else {
        delete next.materials[ref];
      }
    }
  };

  const finishTileEdit = () => {
    if (!tileEditDirty) {
      setTileEditActive(false);
      return;
    }
    // Keep edit mode on and show inline actions instead of a browser prompt.
    tileEditDirty = true;
    setUiState({ tileEditDirty });
    renderAll();
    syncTileEditActions();
    resetTileEditWarning();
  };

  const applyTileEditChoice = (choice, overrideName) => {
    const state = store.getState();
    const next = structuredClone(state);
    const values = normalizeTileValues(readTileInputs());
    const grout = readGroutInputs();
    const currentRoom = getCurrentRoom(next);
    const snapshotPreset = tileEditSnapshot?.presetId
      ? next.tilePresets?.find(p => p.id === tileEditSnapshot.presetId)
      : null;
    const refPreset = currentRoom?.tile?.reference
      ? next.tilePresets?.find(p => p?.name && p.name === currentRoom.tile.reference)
      : null;
    const preset = snapshotPreset || refPreset;
    const hasPreset = Boolean(preset);

    if (choice === "discard") {
      revertTileEdits(next);
      store.commit(t("tile.changed"), next, { onRender: renderAll, updateMetaCb: updateMeta });
      tileEditDirty = false;
      setUiState({ tileEditDirty });
      tileEditCreateIntent = false;
      setTileEditActive(false);
      setTileEditError("");
      resetTileEditWarning();
      setTileEditMode("edit");
      return;
    }

    if (choice === "new" || (choice === "update" && !hasPreset)) {
      if (!validateTilePresetValues(values)) return;
      const nameResult = resolvePresetName(next, {
        presetId: null,
        refRaw: overrideName ?? values.refRaw,
        fallback: values.ref || preset?.name,
        allowSuffixOnConflict: true
      });
      values.ref = nameResult.name;
      applyTilePresetUpdate(next, { preset: null, values, grout, asNew: true });
      store.commit(t("tile.presetChanged"), next, { onRender: renderAll, updateMetaCb: updateMeta });
      tileEditDirty = false;
      setUiState({ tileEditDirty });
      tileEditCreateIntent = false;
      setTileEditActive(false);
      setTileEditError("");
      resetTileEditWarning();
      setTileEditMode("edit");
      return;
    }

    if (choice === "update") {
      if (!validateTilePresetValues(values)) return;
      const nameResult = resolvePresetName(next, {
        presetId: preset?.id || null,
        refRaw: values.refRaw,
        fallback: values.ref || preset?.name,
        allowSuffixOnConflict: false
      });
      if (!nameResult.ok) {
        setTileEditError(t("planning.tileEditDuplicateName"));
        return;
      }
      const oldName = preset?.name || "";
      values.ref = nameResult.name;
      applyTilePresetUpdate(next, { preset, values, grout, asNew: false, oldName });
      store.commit(t("tile.presetChanged"), next, { onRender: renderAll, updateMetaCb: updateMeta });
      tileEditDirty = false;
      setUiState({ tileEditDirty });
      tileEditCreateIntent = false;
      setTileEditActive(false);
      setTileEditError("");
      resetTileEditWarning();
      setTileEditMode("edit");
      return;
    }
  };
  function commitFromRoomInputs(label) {
    const state = store.getState();
    const next = structuredClone(state);

    next.view = next.view || {};
    const showGridEl = document.getElementById('showGrid');
    const showSkirtingEl = document.getElementById('showSkirting');
    const debugShowWallsEl = document.getElementById('debugShowWalls');
    const threeDShowWallsEl = document.getElementById('threeDShowWalls');
    const removalModeEl = document.getElementById('removalMode');

    if (showGridEl) next.view.showGrid = Boolean(showGridEl.checked);
    if (showSkirtingEl) next.view.showSkirting = Boolean(showSkirtingEl.checked);
    if (debugShowWallsEl) next.view.showWalls = Boolean(debugShowWallsEl.checked);
    if (threeDShowWallsEl) next.view.showWalls3D = Boolean(threeDShowWallsEl.checked);
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
      const skirtingTypeEl = document.getElementById("skirtingType");
      const skirtingHeightEl = document.getElementById("skirtingHeight");
      const skirtingBoughtWidthEl = document.getElementById("skirtingBoughtWidth");
      const skirtingPricePerPieceEl = document.getElementById("skirtingPricePerPiece");
      const ref = nextRoom.tile?.reference;
      const preset = ref ? next.tilePresets?.find(p => p?.name && p.name === ref) : null;
      const prevCutoutAllowed = Boolean(preset?.useForSkirting);
      const cutoutAllowed = ref ? Boolean(preset?.useForSkirting) : true;

      if (skirtingTypeEl) {
        const selectedTypeRaw = skirtingTypeEl.value;
        const selectedType =
          selectedTypeRaw === "bought" || selectedTypeRaw === "cutout"
            ? selectedTypeRaw
            : "cutout";
        nextRoom.skirting.type = selectedType === "cutout" && !cutoutAllowed ? "bought" : selectedType;
      }
      if (skirtingHeightEl) nextRoom.skirting.heightCm = Number(skirtingHeightEl.value);
      if (skirtingBoughtWidthEl) nextRoom.skirting.boughtWidthCm = Number(skirtingBoughtWidthEl.value);
      if (skirtingPricePerPieceEl) nextRoom.skirting.boughtPricePerPiece = Number(skirtingPricePerPieceEl.value);

      if (!prevCutoutAllowed && cutoutAllowed && ref && nextRoom.skirting?.enabled && skirtingTypeEl) {
        nextRoom.skirting.type = "cutout";
      }

      nextRoom.wallHeightCm = Number(document.getElementById("wallHeightCm")?.value) || 200;

      // Read edge properties from UI
      const edgeSelectEl = document.getElementById("edgeSelect");
      if (edgeSelectEl && Array.isArray(nextRoom.edgeProperties)) {
        const idx = Number(edgeSelectEl.value) || 0;
        if (idx >= 0 && idx < nextRoom.edgeProperties.length) {
          const ep = nextRoom.edgeProperties[idx];
          ep.thicknessCm = Number(document.getElementById("edgeThickness")?.value) || 12;
          ep.heightStartCm = Number(document.getElementById("edgeHeightStart")?.value) || 200;
          ep.heightEndCm = Number(document.getElementById("edgeHeightEnd")?.value) || 200;

          // Read doorway inputs
          const dwContainer = document.getElementById("doorwaysList");
          if (dwContainer) {
            const offsets = dwContainer.querySelectorAll(".dw-offset");
            const widths = dwContainer.querySelectorAll(".dw-width");
            const heights = dwContainer.querySelectorAll(".dw-height");
            if (offsets.length > 0) {
              ep.doorways = [];
              for (let d = 0; d < offsets.length; d++) {
                ep.doorways.push({
                  id: nextRoom.edgeProperties[idx]?.doorways?.[d]?.id || crypto?.randomUUID?.() || String(Date.now()),
                  offsetCm: Number(offsets[d].value) || 0,
                  widthCm: Number(widths[d]?.value) || 80,
                  heightCm: Number(heights[d]?.value) || 200
                });
              }
            }
          }
        }
      }

      // Regenerate walls when height changes
      const nextFloor = getCurrentFloor(next);
      if (nextFloor) {
        ensureRoomWalls(nextRoom, nextFloor, { forceRegenerate: true });
      }
    }

    store.commit(label, next, { onRender: renderAll, updateMetaCb: updateMeta });
  }

  function commitFromProjectInputs(label) {
    const state = store.getState();
    const next = structuredClone(state);
    next.project = next.project || {};
    next.project.name = document.getElementById("projectName")?.value ?? "";
    store.commit(label, next, { onRender: renderAll, updateMetaCb: updateMeta });
  }

  function commitFromTilePatternInputs(label) {
    if (tileEditMode === "create") return;
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

    const shareOffcuts = document.getElementById("wasteShareOffcuts");
    if (shareOffcuts) next.waste.shareOffcuts = Boolean(shareOffcuts.checked);

    // Waste: kerfCm (Schnittbreite)
    const kerfEl = document.getElementById('wasteKerfCm');
    if (kerfEl) next.waste.kerfCm = Number(kerfEl.value) / 10;

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


  function bindSettingsPanelSelectionReset() {
    const settingsPanel = document.getElementById("settingsPanel");
    if (!settingsPanel) return;
    settingsPanel.addEventListener("click", (e) => {
      const inExclControls = e.target.closest(
        "#exclList, #exclProps, #btnAddRect, #btnAddCircle, #btnAddTri, #btnDeleteExcl"
      );
      if (inExclControls) return;
      setSelectedExcl(null);
    });
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
        const isSquare = Math.abs(tw - th) < EPSILON;

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
  document.getElementById("btnReset")?.addEventListener("click", async () => {
    const confirmed = await showConfirm({
      title: t("dialog.confirmResetTitle") || "Reset Everything?",
      message: t("dialog.confirmResetText") || "All changes to the current project will be lost. This action cannot be undone.",
      confirmText: t("dialog.reset") || "Reset",
      cancelText: t("dialog.cancel") || "Cancel",
      danger: true
    });
    if (confirmed) {
      setSelectedExcl(null);
      resetErrors();
      store.commit(t("session.reset"), defaultStateFn(), {
        onRender: renderAll,
        updateMetaCb: updateMeta
      });
    }
  });

  document.getElementById("btnLoadSession")?.addEventListener("click", async () => {
    const ok = store.loadSessionIfAny();
    if (!ok) {
      await showAlert({
        title: t("dialog.noSessionTitle") || "No Session",
        message: t("dialog.noSessionText") || "No valid session found to restore.",
        type: "info"
      });
      return;
    }
    setSelectedExcl(null);
    resetErrors();
    store.autosaveSession(updateMeta);
    renderAll(t("errors.sessionRestored"));
  });

  document.getElementById("btnSaveProject")?.addEventListener("click", () => {
    commitFromProjectInputs(t("project.changed"));
    const state = store.getState();
    const name =
      document.getElementById("projectName")?.value.trim() ||
      (state.project?.name ?? "Projekt");
    store.saveCurrentAsProject(name);
    store.autosaveSession(updateMeta);
    renderAll(t("project.saved"));
  });

  document.getElementById("btnDeleteProject")?.addEventListener("click", () => {
    const warningEl = document.getElementById("projectDeleteWarning");
    const id = document.getElementById("projectSelect")?.value;
    if (!id) return;
    warningEl?.classList.remove("hidden");
  });
  document.getElementById("btnConfirmDeleteProject")?.addEventListener("click", () => {
    const warningEl = document.getElementById("projectDeleteWarning");
    const id = document.getElementById("projectSelect")?.value;
    if (!id) return;
    store.deleteProjectById(id);
    store.autosaveSession(updateMeta);
    warningEl?.classList.add("hidden");
    renderAll(t("project.deleted"));
  });
  document.getElementById("btnCancelDeleteProject")?.addEventListener("click", () => {
    document.getElementById("projectDeleteWarning")?.classList.add("hidden");
  });
  document.getElementById("projectSelect")?.addEventListener("change", async () => {
    document.getElementById("projectDeleteWarning")?.classList.add("hidden");
    const id = document.getElementById("projectSelect")?.value;
    if (!id) return;
    const res = store.loadProjectById(id);
    if (!res.ok) {
      await showAlert({
        title: t("dialog.projectNotFoundTitle") || "Not Found",
        message: t("project.notFound") || "Project not found.",
        type: "error"
      });
      return;
    }
    setSelectedExcl(null);
    resetErrors();
    renderAll(`${t("project.loaded")}: ${res.name}`);
  });

  // Room inputs
  wireInputCommit(document.getElementById("projectName"), {
    markDirty: () => store.markDirty(),
    commitLabel: t("project.changed"),
    commitFn: commitFromProjectInputs
  });
  wireInputCommit(document.getElementById("roomName"), {
    markDirty: () => store.markDirty(),
    commitLabel: t("room.changed"),
    commitFn: commitFromRoomInputs
  });
  wireInputCommit(document.getElementById("wallHeightCm"), {
    markDirty: () => store.markDirty(),
    commitLabel: t("room.changed"),
    commitFn: commitFromRoomInputs
  });

  // Edge property inputs
  const edgeSelectEl = document.getElementById("edgeSelect");
  edgeSelectEl?.addEventListener("change", () => renderAll());
  wireInputCommit(document.getElementById("edgeThickness"), {
    markDirty: () => store.markDirty(),
    commitLabel: t("edge.changed"),
    commitFn: commitFromRoomInputs
  });
  wireInputCommit(document.getElementById("edgeHeightStart"), {
    markDirty: () => store.markDirty(),
    commitLabel: t("edge.changed"),
    commitFn: commitFromRoomInputs
  });
  wireInputCommit(document.getElementById("edgeHeightEnd"), {
    markDirty: () => store.markDirty(),
    commitLabel: t("edge.changed"),
    commitFn: commitFromRoomInputs
  });

  // Add doorway button
  document.getElementById("addDoorwayBtn")?.addEventListener("click", () => {
    const state = store.getState();
    const next = structuredClone(state);
    const room = getCurrentRoom(next);
    if (!room || !Array.isArray(room.edgeProperties)) return;
    const idx = Number(document.getElementById("edgeSelect")?.value) || 0;
    if (idx < 0 || idx >= room.edgeProperties.length) return;
    const ep = room.edgeProperties[idx];
    if (!ep.doorways) ep.doorways = [];
    ep.doorways.push({
      id: crypto?.randomUUID?.() || String(Date.now()),
      offsetCm: 50,
      widthCm: 101,
      heightCm: 211,
      elevationCm: 0
    });
    const nextFloor = getCurrentFloor(next);
    if (nextFloor) ensureRoomWalls(room, nextFloor, { forceRegenerate: true });
    store.commit(t("edge.doorwayChanged"), next, { onRender: renderAll, updateMetaCb: updateMeta });
  });

  // Doorway remove & edit (event delegation)
  document.getElementById("doorwaysList")?.addEventListener("click", (e) => {
    if (!e.target.classList.contains("dw-remove")) return;
    const dwIdx = Number(e.target.dataset.dwIdx);
    const state = store.getState();
    const next = structuredClone(state);
    const room = getCurrentRoom(next);
    if (!room || !Array.isArray(room.edgeProperties)) return;
    const idx = Number(document.getElementById("edgeSelect")?.value) || 0;
    if (idx < 0 || idx >= room.edgeProperties.length) return;
    room.edgeProperties[idx].doorways.splice(dwIdx, 1);
    const nextFloor = getCurrentFloor(next);
    if (nextFloor) ensureRoomWalls(room, nextFloor, { forceRegenerate: true });
    store.commit(t("edge.doorwayChanged"), next, { onRender: renderAll, updateMetaCb: updateMeta });
  });
  document.getElementById("doorwaysList")?.addEventListener("change", (e) => {
    if (e.target.classList.contains("dw-offset") || e.target.classList.contains("dw-width") || e.target.classList.contains("dw-height")) {
      commitFromRoomInputs(t("edge.doorwayChanged"));
    }
  });

  wireInputCommit(document.getElementById("tileReference"), {
    markDirty: () => store.markDirty(),
    commitLabel: t("tile.changed"),
    commitFn: commitFromTilePatternInputs
  });
  const roomSkirtingEnabledEl = document.getElementById("roomSkirtingEnabled");
  const planningRoomSkirtingEnabledEl = document.getElementById("planningRoomSkirtingEnabled");
  roomSkirtingEnabledEl?.addEventListener("change", () => {
    if (planningRoomSkirtingEnabledEl) {
      planningRoomSkirtingEnabledEl.checked = roomSkirtingEnabledEl.checked;
    }
    commitFromRoomInputs(t("skirting.changed"));
  });
  planningRoomSkirtingEnabledEl?.addEventListener("change", () => {
    if (roomSkirtingEnabledEl) {
      roomSkirtingEnabledEl.checked = planningRoomSkirtingEnabledEl.checked;
    }
    commitFromRoomInputs(t("skirting.changed"));
  });

  const applyTilePreset = (presetId) => {
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
  };

  document.getElementById("tilePresetSelect")?.addEventListener("change", (e) => {
    if (!e.target.value) {
      renderAll();
      return;
    }
    if (tileEditActive) {
      if (tileEditDirty) {
        setTileEditError(t("planning.tileEditSwitchBlocked"));
        syncTileEditActions();
        e.target.value = getCurrentPresetId();
        return;
      }
      setTileEditActive(false);
    }
    resetTileEditWarning();
    tileEditCreateIntent = false;
    setTileEditMode("edit");
    setTileEditError("");
    applyTilePreset(e.target.value);
  });

  document.getElementById("btnCreateTilePreset")?.addEventListener("click", () => {
    tileEditDirty = false;
    setUiState({ tileEditDirty });
    setTileEditError("");
    snapshotTileEditState();
    setUiState({ tileEditHasPreset: false });
    if (!tileEditActive) setTileEditActive(true);
    tileEditCreateIntent = true;
    setTileEditMode("create");
    openTileEditNewPreset();
    syncTileEditActions();
  });

  document.getElementById("tileConfigEditToggle")?.addEventListener("change", (e) => {
    if (e.target.checked) {
      tileEditDirty = false;
      setUiState({ tileEditDirty });
      setTileEditError("");
      snapshotTileEditState();
      tileEditCreateIntent = false;
      setTileEditMode("edit");
      setTileEditActive(true);
    } else {
      finishTileEdit();
      e.target.checked = tileEditActive;
    }
  });

  const openTileEditNewPreset = () => {
    const state = store.getState();
    const values = normalizeTileValues(readTileInputs());
    const base = values.ref || tileEditSnapshot?.presetName || `${t("tile.preset")} ${state.tilePresets?.length + 1}`;
    const suggested = getUniqueName(state.tilePresets || [], base);
    const refInput = document.getElementById("tileReference");
    if (refInput) {
      refInput.value = suggested;
      refInput.focus();
      refInput.select();
    }
    const defaults = getDefaultTilePresetTemplate(state);
    const pricingDefaults = getDefaultPricing(state);
    const shape = document.getElementById("tileShape")?.value || defaults.shape || "rect";
    const tileW = document.getElementById("tileW");
    const tileH = document.getElementById("tileH");
    const pricePerM2 = document.getElementById("tilePricePerM2");
    const packM2 = document.getElementById("tilePackM2");
    const allowSkirting = document.getElementById("tileAllowSkirting");
    const defaultW = values.widthCm > 0 ? values.widthCm : (Number(defaults.widthCm) || DEFAULT_TILE_PRESET.widthCm);
    const defaultH = values.heightCm > 0 ? values.heightCm : (Number(defaults.heightCm) || DEFAULT_TILE_PRESET.heightCm);
    if (tileW && (!values.widthCm || values.widthCm <= 0)) tileW.value = String(defaultW);
    if (tileH && (!values.heightCm || values.heightCm <= 0)) {
      if (shape === "square") {
        tileH.value = String(defaultW);
      } else if (shape === "hex") {
        const sideLength = defaultW / Math.sqrt(3);
        tileH.value = String((sideLength * 2).toFixed(2));
      } else {
        tileH.value = String(defaultH);
      }
    }
    if (pricePerM2 && (pricePerM2.value === "" || Number(pricePerM2.value) < 0)) {
      pricePerM2.value = String(pricingDefaults.pricePerM2 ?? DEFAULT_PRICING.pricePerM2);
    }
    if (packM2 && (packM2.value === "" || Number(packM2.value) < 0)) {
      packM2.value = String(pricingDefaults.packM2 ?? DEFAULT_PRICING.packM2);
    }
    if (allowSkirting) allowSkirting.checked = Boolean(defaults.useForSkirting);
    syncTileEditActions();
  };

  document.getElementById("tileEditUpdateBtn")?.addEventListener("click", () => {
    setTileEditError("");
    setTileEditMode("edit");
    if (!tileEditUpdateArmed) {
      armTileEditWarning();
      return;
    }
    applyTileEditChoice("update");
  });
  document.getElementById("tileEditUpdateBtn")?.addEventListener("mousedown", () => {
    tileEditSuppressWarningReset = true;
    setTimeout(() => {
      tileEditSuppressWarningReset = false;
    }, 0);
  });
  document.getElementById("tileEditSaveBtn")?.addEventListener("click", () => {
    setTileEditError("");
    applyTileEditChoice("new");
  });
  document.getElementById("tileEditDiscardBtn")?.addEventListener("click", () => {
    setTileEditError("");
    applyTileEditChoice("discard");
  });

  document.getElementById("tileReference")?.addEventListener("change", (e) => {
    setTileEditError("");
    if (tileEditMode === "create") return;
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
    if (e.target.id === 'showGrid' || e.target.id === 'showSkirting') {
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

  [
    "tileReference",
    "tileShape",
    "tileW",
    "tileH",
    "tilePricePerM2",
    "tilePackM2",
  ].forEach((id) => {
    const el = document.getElementById(id);
    el?.addEventListener("input", markTileEditDirty);
    el?.addEventListener("change", markTileEditDirty);
    if (id === "tileReference") {
      el?.addEventListener("input", () => setTileEditError(""));
    }
  });
  document.getElementById("tileAllowSkirting")?.addEventListener("change", markTileEditDirty);


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


  // Exclusions
  document.getElementById("btnAddRect")?.addEventListener("click", excl.addRect);
  document.getElementById("btnAddCircle")?.addEventListener("click", excl.addCircle);
  document.getElementById("btnAddTri")?.addEventListener("click", excl.addTri);
  document.getElementById("btnDeleteExcl")?.addEventListener("click", excl.deleteSelectedExcl);
  bindExclList();
  bindSettingsPanelSelectionReset();

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
      await showAlert({
        title: t("dialog.success") || "Success",
        message: t("dialog.copiedToClipboard") || "State copied to clipboard.",
        type: "success"
      });
    } catch {
      await showAlert({
        title: t("dialog.error") || "Error",
        message: t("dialog.copyFailed") || "Failed to copy to clipboard.",
        type: "error"
      });
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
