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
      </div>
    `;

    // Wire spinner buttons (dynamically added, not covered by page-load querySelectorAll)
    messageEl.querySelectorAll(".quick-spinner-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const input = document.getElementById(btn.dataset.target);
        if (!input) return;
        const step = parseFloat(input.step) || 1;
        const min = parseFloat(input.min) || 0;
        let value = parseFloat(input.value) || 0;
        if (btn.dataset.action === "increment") value += step;
        else if (btn.dataset.action === "decrement") value = Math.max(min, value - step);
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    });

    const nearInput = document.getElementById("dwEdDistNear");
    const farInput = document.getElementById("dwEdDistFar");
    const widthInput = document.getElementById("dwEdWidth");

    const syncFar = () => {
      const curW = parseFloat(widthInput.value) || 0;
      const curNear = parseFloat(nearInput.value) || 0;
      farInput.value = Number(Math.max(0, edgeLength - curNear - curW).toFixed(1));
    };
    const syncNear = () => {
      const curW = parseFloat(widthInput.value) || 0;
      const curFar = parseFloat(farInput.value) || 0;
      nearInput.value = Number(Math.max(0, edgeLength - curFar - curW).toFixed(1));
    };

    nearInput.addEventListener("input", syncFar);
    farInput.addEventListener("input", syncNear);
    widthInput.addEventListener("input", syncFar);

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
      const result = {
        widthCm: parseFloat(widthInput.value) || w,
        heightCm: parseFloat(document.getElementById("dwEdHeight").value) || h,
        elevationCm: parseFloat(document.getElementById("dwEdElevation").value) || 0,
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
