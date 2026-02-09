// src/dialog.js
// Modal dialog system to replace native JS confirm/alert/prompt

import { t } from "./i18n.js";

/**
 * Show a confirmation dialog
 * @param {Object} options
 * @param {string} options.title - Dialog title
 * @param {string} options.message - Dialog message (can include HTML)
 * @param {string} [options.confirmText] - Confirm button text
 * @param {string} [options.cancelText] - Cancel button text
 * @param {boolean} [options.danger] - If true, confirm button is styled as danger
 * @returns {Promise<boolean>} - Resolves to true if confirmed, false if cancelled
 */
export function showConfirm({
  title,
  message,
  confirmText = t("dialog.confirm") || "Confirm",
  cancelText = t("dialog.cancel") || "Cancel",
  danger = false
}) {
  return new Promise((resolve) => {
    const overlay = document.getElementById("dialogOverlay");
    const dialog = document.getElementById("dialogModal");
    const titleEl = document.getElementById("dialogTitle");
    const messageEl = document.getElementById("dialogMessage");
    const inputSection = document.getElementById("dialogInputSection");
    const confirmBtn = document.getElementById("dialogConfirmBtn");
    const cancelBtn = document.getElementById("dialogCancelBtn");

    if (!overlay || !dialog) {
      // Fallback to native confirm if dialog not available
      resolve(confirm(message));
      return;
    }

    // Set content
    titleEl.textContent = title;
    messageEl.innerHTML = message;
    inputSection.classList.add("hidden");
    confirmBtn.textContent = confirmText;
    cancelBtn.textContent = cancelText;
    confirmBtn.classList.toggle("danger", danger);
    confirmBtn.classList.toggle("primary", !danger);

    // Show dialog
    overlay.classList.remove("hidden");
    dialog.classList.remove("hidden");

    // Focus confirm button
    confirmBtn.focus();

    // Cleanup function
    const cleanup = () => {
      overlay.classList.add("hidden");
      dialog.classList.add("hidden");
      confirmBtn.removeEventListener("click", onConfirm);
      cancelBtn.removeEventListener("click", onCancel);
      overlay.removeEventListener("click", onOverlayClick);
      document.removeEventListener("keydown", onKeydown);
    };

    const onConfirm = () => {
      cleanup();
      resolve(true);
    };

    const onCancel = () => {
      cleanup();
      resolve(false);
    };

    const onOverlayClick = (e) => {
      if (e.target === overlay) {
        onCancel();
      }
    };

    const onKeydown = (e) => {
      if (e.key === "Escape") {
        onCancel();
      } else if (e.key === "Enter") {
        onConfirm();
      }
    };

    confirmBtn.addEventListener("click", onConfirm);
    cancelBtn.addEventListener("click", onCancel);
    overlay.addEventListener("click", onOverlayClick);
    document.addEventListener("keydown", onKeydown);
  });
}

/**
 * Show an alert dialog (informational, single button)
 * @param {Object} options
 * @param {string} options.title - Dialog title
 * @param {string} options.message - Dialog message
 * @param {string} [options.okText] - OK button text
 * @param {string} [options.type] - "info", "warning", "error", "success"
 * @returns {Promise<void>} - Resolves when dismissed
 */
export function showAlert({
  title,
  message,
  okText = t("dialog.ok") || "OK",
  type = "info"
}) {
  return new Promise((resolve) => {
    const overlay = document.getElementById("dialogOverlay");
    const dialog = document.getElementById("dialogModal");
    const titleEl = document.getElementById("dialogTitle");
    const messageEl = document.getElementById("dialogMessage");
    const inputSection = document.getElementById("dialogInputSection");
    const confirmBtn = document.getElementById("dialogConfirmBtn");
    const cancelBtn = document.getElementById("dialogCancelBtn");

    if (!overlay || !dialog) {
      // Fallback to native alert if dialog not available
      alert(message);
      resolve();
      return;
    }

    // Set content
    titleEl.textContent = title;
    messageEl.innerHTML = message;
    inputSection.classList.add("hidden");
    confirmBtn.textContent = okText;
    cancelBtn.classList.add("hidden");
    confirmBtn.classList.remove("danger");
    confirmBtn.classList.add("primary");

    // Add type class for styling
    dialog.dataset.type = type;

    // Show dialog
    overlay.classList.remove("hidden");
    dialog.classList.remove("hidden");

    // Focus OK button
    confirmBtn.focus();

    // Cleanup function
    const cleanup = () => {
      overlay.classList.add("hidden");
      dialog.classList.add("hidden");
      cancelBtn.classList.remove("hidden");
      delete dialog.dataset.type;
      confirmBtn.removeEventListener("click", onConfirm);
      overlay.removeEventListener("click", onOverlayClick);
      document.removeEventListener("keydown", onKeydown);
    };

    const onConfirm = () => {
      cleanup();
      resolve();
    };

    const onOverlayClick = (e) => {
      if (e.target === overlay) {
        onConfirm();
      }
    };

    const onKeydown = (e) => {
      if (e.key === "Escape" || e.key === "Enter") {
        onConfirm();
      }
    };

    confirmBtn.addEventListener("click", onConfirm);
    overlay.addEventListener("click", onOverlayClick);
    document.addEventListener("keydown", onKeydown);
  });
}

/**
 * Show a prompt dialog for text input
 * @param {Object} options
 * @param {string} options.title - Dialog title
 * @param {string} [options.message] - Optional message above input
 * @param {string} [options.placeholder] - Input placeholder
 * @param {string} [options.defaultValue] - Default input value
 * @param {string} [options.confirmText] - Confirm button text
 * @param {string} [options.cancelText] - Cancel button text
 * @returns {Promise<string|null>} - Resolves to input value or null if cancelled
 */
export function showPrompt({
  title,
  message = "",
  placeholder = "",
  defaultValue = "",
  confirmText = t("dialog.confirm") || "Confirm",
  cancelText = t("dialog.cancel") || "Cancel"
}) {
  return new Promise((resolve) => {
    const overlay = document.getElementById("dialogOverlay");
    const dialog = document.getElementById("dialogModal");
    const titleEl = document.getElementById("dialogTitle");
    const messageEl = document.getElementById("dialogMessage");
    const inputSection = document.getElementById("dialogInputSection");
    const input = document.getElementById("dialogInput");
    const confirmBtn = document.getElementById("dialogConfirmBtn");
    const cancelBtn = document.getElementById("dialogCancelBtn");

    if (!overlay || !dialog) {
      // Fallback to native prompt if dialog not available
      resolve(prompt(message || title, defaultValue));
      return;
    }

    // Set content
    titleEl.textContent = title;
    messageEl.innerHTML = message;
    messageEl.classList.toggle("hidden", !message);
    inputSection.classList.remove("hidden");
    input.placeholder = placeholder;
    input.value = defaultValue;
    confirmBtn.textContent = confirmText;
    cancelBtn.textContent = cancelText;
    confirmBtn.classList.remove("danger");
    confirmBtn.classList.add("primary");

    // Show dialog
    overlay.classList.remove("hidden");
    dialog.classList.remove("hidden");

    // Focus input
    input.focus();
    input.select();

    // Cleanup function
    const cleanup = () => {
      overlay.classList.add("hidden");
      dialog.classList.add("hidden");
      messageEl.classList.remove("hidden");
      confirmBtn.removeEventListener("click", onConfirm);
      cancelBtn.removeEventListener("click", onCancel);
      overlay.removeEventListener("click", onOverlayClick);
      input.removeEventListener("keydown", onInputKeydown);
      document.removeEventListener("keydown", onKeydown);
    };

    const onConfirm = () => {
      const value = input.value;
      cleanup();
      resolve(value);
    };

    const onCancel = () => {
      cleanup();
      resolve(null);
    };

    const onOverlayClick = (e) => {
      if (e.target === overlay) {
        onCancel();
      }
    };

    const onInputKeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        onConfirm();
      }
    };

    const onKeydown = (e) => {
      if (e.key === "Escape") {
        onCancel();
      }
    };

    confirmBtn.addEventListener("click", onConfirm);
    cancelBtn.addEventListener("click", onCancel);
    overlay.addEventListener("click", onOverlayClick);
    input.addEventListener("keydown", onInputKeydown);
    document.addEventListener("keydown", onKeydown);
  });
}

/**
 * Show a selection dialog (list of options)
 * @param {Object} options
 * @param {string} options.title - Dialog title
 * @param {string} [options.message] - Optional message
 * @param {Array<{value: string, label: string}>} options.items - Items to select from
 * @param {string} [options.defaultValue] - Default selected value
 * @param {string} [options.confirmText] - Confirm button text
 * @param {string} [options.cancelText] - Cancel button text
 * @returns {Promise<string|null>} - Resolves to selected value or null if cancelled
 */
export function showSelect({
  title,
  message = "",
  items = [],
  defaultValue = "",
  confirmText = t("dialog.confirm") || "Confirm",
  cancelText = t("dialog.cancel") || "Cancel"
}) {
  return new Promise((resolve) => {
    const overlay = document.getElementById("dialogOverlay");
    const dialog = document.getElementById("dialogModal");
    const titleEl = document.getElementById("dialogTitle");
    const messageEl = document.getElementById("dialogMessage");
    const inputSection = document.getElementById("dialogInputSection");
    const selectSection = document.getElementById("dialogSelectSection");
    const select = document.getElementById("dialogSelect");
    const confirmBtn = document.getElementById("dialogConfirmBtn");
    const cancelBtn = document.getElementById("dialogCancelBtn");

    if (!overlay || !dialog) {
      // Fallback to native prompt
      const itemsList = items.map((item, i) => `${i + 1}. ${item.label}`).join("\n");
      const choice = prompt(`${title}\n${message}\n\n${itemsList}\n\nEnter number:`, "1");
      if (choice) {
        const idx = parseInt(choice, 10) - 1;
        if (idx >= 0 && idx < items.length) {
          resolve(items[idx].value);
          return;
        }
      }
      resolve(null);
      return;
    }

    // Set content
    titleEl.textContent = title;
    messageEl.innerHTML = message;
    messageEl.classList.toggle("hidden", !message);
    inputSection.classList.add("hidden");
    selectSection.classList.remove("hidden");

    // Populate select
    select.innerHTML = "";
    items.forEach(item => {
      const opt = document.createElement("option");
      opt.value = item.value;
      opt.textContent = item.label;
      select.appendChild(opt);
    });
    select.value = defaultValue || (items[0]?.value ?? "");

    confirmBtn.textContent = confirmText;
    cancelBtn.textContent = cancelText;
    confirmBtn.classList.remove("danger");
    confirmBtn.classList.add("primary");

    // Show dialog
    overlay.classList.remove("hidden");
    dialog.classList.remove("hidden");

    // Focus select
    select.focus();

    // Cleanup function
    const cleanup = () => {
      overlay.classList.add("hidden");
      dialog.classList.add("hidden");
      messageEl.classList.remove("hidden");
      selectSection.classList.add("hidden");
      confirmBtn.removeEventListener("click", onConfirm);
      cancelBtn.removeEventListener("click", onCancel);
      overlay.removeEventListener("click", onOverlayClick);
      document.removeEventListener("keydown", onKeydown);
    };

    const onConfirm = () => {
      const value = select.value;
      cleanup();
      resolve(value);
    };

    const onCancel = () => {
      cleanup();
      resolve(null);
    };

    const onOverlayClick = (e) => {
      if (e.target === overlay) {
        onCancel();
      }
    };

    const onKeydown = (e) => {
      if (e.key === "Escape") {
        onCancel();
      } else if (e.key === "Enter") {
        onConfirm();
      }
    };

    confirmBtn.addEventListener("click", onConfirm);
    cancelBtn.addEventListener("click", onCancel);
    overlay.addEventListener("click", onOverlayClick);
    document.addEventListener("keydown", onKeydown);
  });
}

/**
 * Show a multi-field doorway editor dialog
 * @param {Object} options
 * @param {string} options.title - Dialog title
 * @param {Object} options.doorway - Current doorway data {widthCm, heightCm, elevationCm, offsetCm}
 * @param {number} options.edgeLength - Length of the wall edge in cm
 * @param {string} [options.confirmText] - Confirm button text
 * @param {string} [options.cancelText] - Cancel button text
 * @returns {Promise<{widthCm, heightCm, elevationCm, offsetCm} | null>}
 */
export function showDoorwayEditor({
  title,
  doorway,
  edgeLength,
  heightStartCm = 200,
  heightEndCm = 200,
  siblings = [],
  confirmText = t("dialog.confirm") || "Confirm",
  cancelText = t("dialog.cancel") || "Cancel"
}) {
  return new Promise((resolve) => {
    const overlay = document.getElementById("dialogOverlay");
    const dialog = document.getElementById("dialogModal");
    const titleEl = document.getElementById("dialogTitle");
    const messageEl = document.getElementById("dialogMessage");
    const inputSection = document.getElementById("dialogInputSection");
    const confirmBtn = document.getElementById("dialogConfirmBtn");
    const cancelBtn = document.getElementById("dialogCancelBtn");

    if (!overlay || !dialog) {
      resolve(null);
      return;
    }

    const w = doorway.widthCm ?? 101;
    const h = doorway.heightCm ?? 211;
    const elev = doorway.elevationCm ?? 0;
    const off = doorway.offsetCm ?? 0;
    const farDist = Math.max(0, edgeLength - off - w);

    titleEl.textContent = title;
    inputSection.classList.add("hidden");
    confirmBtn.textContent = confirmText;
    cancelBtn.textContent = cancelText;
    confirmBtn.classList.remove("danger");
    confirmBtn.classList.add("primary");

    const spinnerField = (label, id, value, min = 0, step = 1) => `
      <div class="doorway-editor-field">
        <label>${label}</label>
        <div class="quick-spinner">
          <button type="button" class="quick-spinner-btn" data-action="decrement" data-target="${id}">\u2212</button>
          <input type="number" class="quick-input no-spinner dialog-input" id="${id}" value="${value}" min="${min}" step="${step}">
          <button type="button" class="quick-spinner-btn" data-action="increment" data-target="${id}">+</button>
        </div>
      </div>`;

    messageEl.innerHTML = `
      <div class="doorway-editor-form">
        ${spinnerField(t("edge.doorwayWidth"), "dwEdWidth", w, 1)}
        ${spinnerField(t("edge.doorwayHeight"), "dwEdHeight", h, 1)}
        ${spinnerField(t("edge.doorwayElevation"), "dwEdElevation", elev, 0)}
        ${spinnerField(t("edge.doorwayDistNear"), "dwEdDistNear", Number(off.toFixed(1)), 0)}
        ${spinnerField(t("edge.doorwayDistFar"), "dwEdDistFar", Number(farDist.toFixed(1)), 0)}
        <div id="dwEdConstraintWarn" class="warnItem tile-edit-warning hidden">
          <div class="wText" id="dwEdConstraintWarnText"></div>
        </div>
      </div>
    `;

    // Wire spinner buttons (dynamically added, not covered by page-load querySelectorAll)
    messageEl.querySelectorAll(".quick-spinner-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const input = document.getElementById(btn.dataset.target);
        if (!input) return;
        const step = parseFloat(input.step) || 1;
        const min = parseFloat(input.min) || 0;
        const max = input.max !== "" ? parseFloat(input.max) : Infinity;
        let value = parseFloat(input.value) || 0;
        if (btn.dataset.action === "increment") value = Math.min(max, value + step);
        else if (btn.dataset.action === "decrement") value = Math.max(min, value - step);
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    });

    const nearInput = document.getElementById("dwEdDistNear");
    const farInput = document.getElementById("dwEdDistFar");
    const widthInput = document.getElementById("dwEdWidth");
    const heightInput = document.getElementById("dwEdHeight");
    const elevInput = document.getElementById("dwEdElevation");

    // Compute minimum wall height over the doorway span (accounts for slope)
    const getMaxDoorH = () => {
      const offset = parseFloat(nearInput.value) || 0;
      const curW = parseFloat(widthInput.value) || 0;
      const L = edgeLength || 1;
      const hAtStart = heightStartCm + (heightEndCm - heightStartCm) * (offset / L);
      const hAtEnd = heightStartCm + (heightEndCm - heightStartCm) * (Math.min(offset + curW, L) / L);
      return Math.min(hAtStart, hAtEnd);
    };

    const warnEl = document.getElementById("dwEdConstraintWarn");
    const warnTextEl = document.getElementById("dwEdConstraintWarnText");

    const enforceMax = (input, max) => {
      const m = Math.max(0, Math.round(max));
      input.max = m;
      if ((parseFloat(input.value) || 0) > m) input.value = m;
    };

    const checkOverlap = () => {
      const curOff = parseFloat(nearInput.value) || 0;
      const curW = parseFloat(widthInput.value) || 0;
      const curElev = parseFloat(elevInput.value) || 0;
      const curH = parseFloat(heightInput.value) || 0;
      for (const sib of siblings) {
        const hOverlap = curOff < sib.offsetCm + sib.widthCm && curOff + curW > sib.offsetCm;
        const vOverlap = curElev < (sib.elevationCm ?? 0) + sib.heightCm && curElev + curH > (sib.elevationCm ?? 0);
        if (hOverlap && vOverlap) return true;
      }
      return false;
    };

    const updateConstraints = () => {
      const maxH = getMaxDoorH();
      const curElev = parseFloat(elevInput.value) || 0;
      const curH = parseFloat(heightInput.value) || 0;
      const curNear = parseFloat(nearInput.value) || 0;

      enforceMax(widthInput, edgeLength - curNear);
      enforceMax(heightInput, maxH - curElev);
      enforceMax(elevInput, maxH - curH);

      // Collect active constraint messages
      const messages = [];
      if ((parseFloat(widthInput.value) || 0) >= parseFloat(widthInput.max) - 0.5) {
        messages.push(t("edge.doorwayMaxWidth").replace("{0}", Math.round(edgeLength)));
      }
      if (curElev + (parseFloat(heightInput.value) || 0) >= maxH - 0.5) {
        messages.push(t("edge.doorwayMaxHeight").replace("{0}", Math.round(maxH)));
      }
      const hasOverlap = checkOverlap();
      if (hasOverlap) {
        messages.push(t("edge.doorwayOverlap"));
      }
      if (warnEl) {
        warnEl.classList.toggle("hidden", messages.length === 0);
        if (messages.length && warnTextEl) warnTextEl.textContent = messages.join(" · ");
      }
      // Disable confirm when overlapping
      confirmBtn.disabled = hasOverlap;
    };

    const syncFar = () => {
      const curW = parseFloat(widthInput.value) || 0;
      const curNear = parseFloat(nearInput.value) || 0;
      farInput.value = Number(Math.max(0, edgeLength - curNear - curW).toFixed(1));
      updateConstraints();
    };
    const syncNear = () => {
      const curW = parseFloat(widthInput.value) || 0;
      const curFar = parseFloat(farInput.value) || 0;
      nearInput.value = Number(Math.max(0, edgeLength - curFar - curW).toFixed(1));
      updateConstraints();
    };

    nearInput.addEventListener("input", syncFar);
    farInput.addEventListener("input", syncNear);
    widthInput.addEventListener("input", syncFar);
    heightInput.addEventListener("input", updateConstraints);
    elevInput.addEventListener("input", updateConstraints);
    updateConstraints();

    overlay.classList.remove("hidden");
    dialog.classList.remove("hidden");

    widthInput.focus();
    widthInput.select();

    const cleanup = () => {
      overlay.classList.add("hidden");
      dialog.classList.add("hidden");
      confirmBtn.removeEventListener("click", onConfirm);
      cancelBtn.removeEventListener("click", onCancel);
      overlay.removeEventListener("click", onOverlayClick);
      document.removeEventListener("keydown", onKeydown);
    };

    const onConfirm = () => {
      updateConstraints();
      const result = {
        widthCm: parseFloat(widthInput.value) || w,
        heightCm: parseFloat(heightInput.value) || h,
        elevationCm: parseFloat(elevInput.value) || 0,
        offsetCm: parseFloat(nearInput.value) || 0
      };
      cleanup();
      resolve(result);
    };

    const onCancel = () => {
      cleanup();
      resolve(null);
    };

    const onOverlayClick = (e) => {
      if (e.target === overlay) onCancel();
    };

    const onKeydown = (e) => {
      if (e.key === "Escape") {
        onCancel();
      } else if (e.key === "Enter") {
        onConfirm();
      }
    };

    confirmBtn.addEventListener("click", onConfirm);
    cancelBtn.addEventListener("click", onCancel);
    overlay.addEventListener("click", onOverlayClick);
    document.addEventListener("keydown", onKeydown);
  });
}

/**
 * Show surface tiling configuration editor with wall properties
 * @param {Object} options
 * @param {string} options.title - Dialog title
 * @param {Object} options.wall - Wall properties {thicknessCm, heightStartCm, heightEndCm}
 * @param {Object|null} options.tile - Current tile config {widthCm, heightCm, shape, reference}
 * @param {Object|null} options.grout - Current grout config {widthCm, colorHex}
 * @param {Object|null} options.pattern - Current pattern config {type, bondFraction, rotationDeg, origin, offsetXcm, offsetYcm}
 * @param {Array} [options.tilePresets] - Available tile presets
 * @param {string} [options.confirmText] - Confirm button text
 * @param {string} [options.cancelText] - Cancel button text
 * @returns {Promise<{wall, tile, grout, pattern, enabled} | null>}
 */
export function showSurfaceEditor({
  title,
  wall,
  tile,
  grout,
  pattern,
  tilePresets = [],
  confirmText = t("dialog.confirm") || "Confirm",
  cancelText = t("dialog.cancel") || "Cancel"
}) {
  return new Promise((resolve) => {
    const overlay = document.getElementById("dialogOverlay");
    const dialog = document.getElementById("dialogModal");
    const titleEl = document.getElementById("dialogTitle");
    const messageEl = document.getElementById("dialogMessage");
    const inputSection = document.getElementById("dialogInputSection");
    const confirmBtn = document.getElementById("dialogConfirmBtn");
    const cancelBtn = document.getElementById("dialogCancelBtn");

    if (!overlay || !dialog) {
      resolve(null);
      return;
    }

    // Wall defaults
    const wallThickness = wall?.thicknessCm ?? 15;
    const wallHeightStart = wall?.heightStartCm ?? 250;
    const wallHeightEnd = wall?.heightEndCm ?? 250;

    // Surface tiling defaults
    const isEnabled = tile !== null;
    const tileW = tile?.widthCm ?? 40;
    const tileH = tile?.heightCm ?? 20;
    const tileShape = tile?.shape ?? "rect";
    const groutW = grout?.widthCm ?? 0.2;
    const groutColor = grout?.colorHex ?? "#ffffff";
    const patternType = pattern?.type ?? "grid";
    const bondFraction = pattern?.bondFraction ?? 0.5;
    const rotationDeg = pattern?.rotationDeg ?? 0;
    const originPreset = pattern?.origin?.preset ?? "tl";

    titleEl.textContent = title;
    inputSection.classList.add("hidden");
    confirmBtn.textContent = confirmText;
    cancelBtn.textContent = cancelText;
    confirmBtn.classList.remove("danger");
    confirmBtn.classList.add("primary");

    messageEl.innerHTML = `
      <div class="surface-editor-form">
        <!-- Wall Configuration Section -->
        <div class="surface-editor-section">
          <h3 class="surface-editor-section-title" data-i18n="wall.configuration">Wall Configuration</h3>
          <div class="surface-editor-field">
            <label data-i18n="wall.thickness">Wall Thickness (cm)</label>
            <input type="number" id="wallThickness" value="${wallThickness}" min="1" step="1" class="dialog-input" />
          </div>
          <div class="surface-editor-row">
            <div class="surface-editor-field">
              <label data-i18n="wall.heightStart">Height Start (cm)</label>
              <input type="number" id="wallHeightStart" value="${wallHeightStart}" min="1" step="1" class="dialog-input" />
            </div>
            <div class="surface-editor-field">
              <label data-i18n="wall.heightEnd">Height End (cm)</label>
              <input type="number" id="wallHeightEnd" value="${wallHeightEnd}" min="1" step="1" class="dialog-input" />
            </div>
          </div>
        </div>

        <!-- Divider -->
        <div class="surface-editor-divider"></div>

        <!-- Surface Tiling Section -->
        <div class="surface-editor-section">
          <label class="toggle-switch">
            <span class="toggle-label" data-i18n="surface.enableTiling">Enable Tiling</span>
            <input id="surfEnableTiling" type="checkbox" ${isEnabled ? "checked" : ""} />
            <div class="toggle-slider"></div>
          </label>
          <div id="surfTilingFields" class="surface-tiling-fields" style="display: ${isEnabled ? "flex" : "none"}; flex-direction: column; gap: 12px; margin-top: 8px;">
            ${tilePresets.length > 0 ? `
            <div class="surface-editor-field">
              <label data-i18n="tile.presetSelect">Tile Preset</label>
              <select id="surfTilePreset" class="dialog-input">
                <option value="" data-i18n="tile.presetCustom">Custom</option>
                ${tilePresets.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}
              </select>
            </div>
            ` : ''}
          <div class="surface-editor-field">
            <label data-i18n="tile.shape">Tile Shape</label>
            <select id="surfTileShape" class="dialog-input">
              <option value="rect" ${tileShape === "rect" ? "selected" : ""} data-i18n="tile.shapeRect">Rectangular</option>
              <option value="square" ${tileShape === "square" ? "selected" : ""} data-i18n="tile.shapeSquare">Square</option>
              <option value="hex" ${tileShape === "hex" ? "selected" : ""} data-i18n="tile.shapeHex">Hexagonal</option>
              <option value="rhombus" ${tileShape === "rhombus" ? "selected" : ""} data-i18n="tile.shapeRhombus">Rhombus</option>
            </select>
          </div>
          <div class="surface-editor-row">
            <div class="surface-editor-field">
              <label data-i18n="tile.width">Width (cm)</label>
              <input type="number" id="surfTileW" value="${tileW}" min="0.1" step="0.1" class="dialog-input" />
            </div>
            <div class="surface-editor-field" id="surfTileHField">
              <label data-i18n="tile.height">Height (cm)</label>
              <input type="number" id="surfTileH" value="${tileH}" min="0.1" step="0.1" class="dialog-input" />
            </div>
          </div>
          <div class="surface-editor-row">
            <div class="surface-editor-field">
              <label data-i18n="tile.grout">Grout (mm)</label>
              <input type="number" id="surfGroutW" value="${groutW * 10}" min="0" step="0.1" class="dialog-input" />
            </div>
            <div class="surface-editor-field">
              <label data-i18n="tile.groutColor">Grout Color</label>
              <input type="color" id="surfGroutColor" value="${groutColor}" class="dialog-input" />
            </div>
          </div>
          <div class="surface-editor-field">
            <label data-i18n="tile.pattern">Pattern</label>
            <select id="surfPatternType" class="dialog-input">
              <option value="grid" ${patternType === "grid" ? "selected" : ""} data-i18n="tile.patternGrid">Grid</option>
              <option value="runningBond" ${patternType === "runningBond" ? "selected" : ""} data-i18n="tile.patternRunningBond">Running Bond</option>
              <option value="herringbone" ${patternType === "herringbone" ? "selected" : ""} data-i18n="tile.patternHerringbone">Herringbone</option>
              <option value="doubleHerringbone" ${patternType === "doubleHerringbone" ? "selected" : ""} data-i18n="tile.patternDoubleHerringbone">Double Herringbone</option>
              <option value="basketweave" ${patternType === "basketweave" ? "selected" : ""} data-i18n="tile.patternBasketweave">Basketweave</option>
              <option value="verticalStackAlternating" ${patternType === "verticalStackAlternating" ? "selected" : ""} data-i18n="tile.patternVerticalStackAlternating">Vertical Stack Alt.</option>
            </select>
          </div>
          <div class="surface-editor-row">
            <div class="surface-editor-field">
              <label data-i18n="tile.bondFraction">Bond Fraction</label>
              <select id="surfBondFraction" class="dialog-input">
                <option value="0.5" ${bondFraction === 0.5 ? "selected" : ""}>1/2</option>
                <option value="0.3333333333" ${Math.abs(bondFraction - 0.3333333333) < 0.001 ? "selected" : ""}>1/3</option>
                <option value="0.25" ${bondFraction === 0.25 ? "selected" : ""}>1/4</option>
              </select>
            </div>
            <div class="surface-editor-field">
              <label data-i18n="tile.rotation">Rotation</label>
              <select id="surfRotationDeg" class="dialog-input">
                <option value="0" ${rotationDeg === 0 ? "selected" : ""}>0°</option>
                <option value="45" ${rotationDeg === 45 ? "selected" : ""}>45°</option>
                <option value="90" ${rotationDeg === 90 ? "selected" : ""}>90°</option>
                <option value="135" ${rotationDeg === 135 ? "selected" : ""}>135°</option>
                <option value="180" ${rotationDeg === 180 ? "selected" : ""}>180°</option>
                <option value="225" ${rotationDeg === 225 ? "selected" : ""}>225°</option>
                <option value="270" ${rotationDeg === 270 ? "selected" : ""}>270°</option>
                <option value="315" ${rotationDeg === 315 ? "selected" : ""}>315°</option>
              </select>
            </div>
          </div>
          <div class="surface-editor-field">
            <label data-i18n="origin.preset">Origin Preset</label>
            <select id="surfOriginPreset" class="dialog-input">
              <option value="tl" ${originPreset === "tl" ? "selected" : ""} data-i18n="origin.presetTL">Top Left</option>
              <option value="tr" ${originPreset === "tr" ? "selected" : ""} data-i18n="origin.presetTR">Top Right</option>
              <option value="bl" ${originPreset === "bl" ? "selected" : ""} data-i18n="origin.presetBL">Bottom Left</option>
              <option value="br" ${originPreset === "br" ? "selected" : ""} data-i18n="origin.presetBR">Bottom Right</option>
              <option value="center" ${originPreset === "center" ? "selected" : ""} data-i18n="origin.presetCenter">Center</option>
            </select>
          </div>
        </div>
        </div>
      </div>
    `;

    const enableToggle = document.getElementById("surfEnableTiling");
    const tilingFields = document.getElementById("surfTilingFields");
    const tileShapeSelect = document.getElementById("surfTileShape");
    const tileHField = document.getElementById("surfTileHField");

    // Toggle tiling fields visibility
    enableToggle.addEventListener("change", () => {
      tilingFields.style.display = enableToggle.checked ? "flex" : "none";
    });

    // Hide height field for square tiles
    const updateShapeFields = () => {
      const shape = tileShapeSelect.value;
      tileHField.style.display = (shape === "square") ? "none" : "";
    };
    tileShapeSelect.addEventListener("change", updateShapeFields);
    updateShapeFields();

    // Tile preset selector - populate fields when preset selected
    const presetSelect = document.getElementById("surfTilePreset");
    if (presetSelect) {
      presetSelect.addEventListener("change", (e) => {
        const presetId = e.target.value;
        if (!presetId) return;
        const preset = tilePresets.find(p => p.id === presetId);
        if (!preset) return;

        // Populate fields from preset
        const shapeInput = document.getElementById("surfTileShape");
        const wInput = document.getElementById("surfTileW");
        const hInput = document.getElementById("surfTileH");
        const groutWInput = document.getElementById("surfGroutW");
        const groutColorInput = document.getElementById("surfGroutColor");

        if (shapeInput) shapeInput.value = preset.shape || "rect";
        if (wInput) wInput.value = preset.widthCm || 40;
        if (hInput) hInput.value = preset.heightCm || 20;
        if (groutWInput) groutWInput.value = (preset.groutWidthCm || 0.2) * 10; // cm to mm
        if (groutColorInput) groutColorInput.value = preset.groutColorHex || "#ffffff";

        updateShapeFields();
      });
    }

    overlay.classList.remove("hidden");
    dialog.classList.remove("hidden");

    const cleanup = () => {
      overlay.classList.add("hidden");
      dialog.classList.add("hidden");
      confirmBtn.removeEventListener("click", onConfirm);
      cancelBtn.removeEventListener("click", onCancel);
      overlay.removeEventListener("click", onOverlayClick);
      document.removeEventListener("keydown", onKeydown);
    };

    const onConfirm = () => {
      // Get wall configuration values
      const wallThicknessInput = document.getElementById("wallThickness");
      const wallHeightStartInput = document.getElementById("wallHeightStart");
      const wallHeightEndInput = document.getElementById("wallHeightEnd");

      const wallConfig = {
        thicknessCm: parseFloat(wallThicknessInput.value) || 15,
        heightStartCm: parseFloat(wallHeightStartInput.value) || 250,
        heightEndCm: parseFloat(wallHeightEndInput.value) || 250,
      };

      const enabled = enableToggle.checked;
      if (!enabled) {
        cleanup();
        resolve({ wall: wallConfig, tile: null, grout: null, pattern: null, enabled: false });
        return;
      }

      const tileWInput = document.getElementById("surfTileW");
      const tileHInput = document.getElementById("surfTileH");
      const tileShapeInput = document.getElementById("surfTileShape");
      const groutWInput = document.getElementById("surfGroutW");
      const groutColorInput = document.getElementById("surfGroutColor");
      const patternTypeInput = document.getElementById("surfPatternType");
      const bondFractionInput = document.getElementById("surfBondFraction");
      const rotationDegInput = document.getElementById("surfRotationDeg");
      const originPresetInput = document.getElementById("surfOriginPreset");

      const result = {
        enabled: true,
        wall: wallConfig,
        tile: {
          widthCm: parseFloat(tileWInput.value) || 40,
          heightCm: parseFloat(tileHInput.value) || 20,
          shape: tileShapeInput.value
        },
        grout: {
          widthCm: (parseFloat(groutWInput.value) || 2) / 10, // mm to cm
          colorHex: groutColorInput.value
        },
        pattern: {
          type: patternTypeInput.value,
          bondFraction: parseFloat(bondFractionInput.value) || 0.5,
          rotationDeg: parseInt(rotationDegInput.value, 10) || 0,
          offsetXcm: 0,
          offsetYcm: 0,
          origin: {
            preset: originPresetInput.value,
            xCm: 0,
            yCm: 0
          }
        }
      };

      cleanup();
      resolve(result);
    };

    const onCancel = () => {
      cleanup();
      resolve(null);
    };

    const onOverlayClick = (e) => {
      if (e.target === overlay) onCancel();
    };

    const onKeydown = (e) => {
      if (e.key === "Escape") {
        onCancel();
      } else if (e.key === "Enter") {
        e.preventDefault();
        onConfirm();
      }
    };

    confirmBtn.addEventListener("click", onConfirm);
    cancelBtn.addEventListener("click", onCancel);
    overlay.addEventListener("click", onOverlayClick);
    document.addEventListener("keydown", onKeydown);
  });
}
