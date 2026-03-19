// src/render-tile-form.js
import { getCurrentRoom, getCurrentFloor, getSelectedSurface, DEFAULT_WASTE } from "./core.js";
import { getUiState } from "./ui_state.js";
import { isPatternGroupChild, getEffectiveTileSettings, getRoomPatternGroup } from "./pattern-groups.js";
import { getRoomPricing } from "./calc.js";
import { EPSILON } from "./constants.js";
import { t } from "./i18n.js";

function renderTilePresetPicker(state, currentRoom) {
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

function renderSkirtingPresetPicker(state) {
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

function renderReferencePicker(state) {
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

  // When a wall surface is selected, show its tile/grout/pattern in the form
  const selectedSurface = getSelectedSurface(state);
  const surfaceHasTiling = selectedSurface?.tile != null;

  // Check if room is a child in a pattern group (inherits settings from origin)
  const isChild = !surfaceHasTiling && isPatternGroupChild(currentRoom, currentFloor);
  const effectiveSettings = isChild ? getEffectiveTileSettings(currentRoom, currentFloor, state) : null;
  const displayRoom = surfaceHasTiling ? {
    ...currentRoom,
    tile: selectedSurface.tile,
    grout: selectedSurface.grout,
    pattern: selectedSurface.pattern
  } : isChild && effectiveSettings ? {
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
  // When a preset is linked and not in create mode, always show the preset's authoritative values
  // (room.tile may be stale if the preset was updated while a different room was selected)
  const resolvedShape = (preset && !isCreateMode ? preset.shape : displayRoom?.tile?.shape) ?? "rect";
  const resolvedWidthCm = preset && !isCreateMode ? (preset.widthCm ?? displayRoom?.tile?.widthCm) : displayRoom?.tile?.widthCm;
  const resolvedHeightCm = preset && !isCreateMode ? (preset.heightCm ?? displayRoom?.tile?.heightCm) : displayRoom?.tile?.heightCm;
  const tileShapeEl = document.getElementById("tileShape");
  if (tileShapeEl) tileShapeEl.value = resolvedShape;
  const tileWEl = document.getElementById("tileW");
  const tileHEl = document.getElementById("tileH");
  if (!isCreateMode) {
    if (tileWEl) tileWEl.value = resolvedWidthCm ?? "";
    if (tileHEl) tileHEl.value = resolvedHeightCm ?? "";
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

  // Dimension fields are also locked when a preset is linked (edit via Setup panel or "Update Preset")
  const isPresetLinked = !isChild && !surfaceHasTiling && Boolean(preset) && !isCreateMode;
  const dimInputs = ["tileShape", "tileW", "tileH"];
  dimInputs.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = isChild || !tileEditActive || isPresetLinked;
  });
  const nonDimInputs = ["tileReference", "tilePricePerM2", "tilePackM2", "tileAllowSkirting"];
  nonDimInputs.forEach((id) => {
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

  const shape = resolvedShape;
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
