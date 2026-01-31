// src/quick_view_toggles.js

export function wireQuickViewToggleHandlers() {
  const quickShowGrid = document.getElementById("quickShowGrid");
  const quickShowSkirting = document.getElementById("quickShowSkirting");
  const floorShowGrid = document.getElementById("floorShowGrid");
  const pgShowGrid = document.getElementById("pgShowGrid");

  quickShowGrid?.addEventListener("change", (e) => {
    const mainShowGrid = document.getElementById("showGrid");
    if (mainShowGrid) {
      mainShowGrid.checked = e.target.checked;
      mainShowGrid.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });

  quickShowSkirting?.addEventListener("change", (e) => {
    const mainShowSkirting = document.getElementById("showSkirting");
    if (mainShowSkirting) {
      mainShowSkirting.checked = e.target.checked;
      mainShowSkirting.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });

  // Floor view grid toggle - syncs with main showGrid
  floorShowGrid?.addEventListener("change", (e) => {
    const mainShowGrid = document.getElementById("showGrid");
    if (mainShowGrid) {
      mainShowGrid.checked = e.target.checked;
      mainShowGrid.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });

  // Pattern groups view grid toggle - syncs with main showGrid
  pgShowGrid?.addEventListener("change", (e) => {
    const mainShowGrid = document.getElementById("showGrid");
    if (mainShowGrid) {
      mainShowGrid.checked = e.target.checked;
      mainShowGrid.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
}

export function syncQuickViewToggleStates() {
  const quickShowGrid = document.getElementById("quickShowGrid");
  const quickShowSkirting = document.getElementById("quickShowSkirting");
  const floorShowGrid = document.getElementById("floorShowGrid");
  const pgShowGrid = document.getElementById("pgShowGrid");
  const mainShowGrid = document.getElementById("showGrid");
  const mainShowSkirting = document.getElementById("showSkirting");

  if (quickShowGrid && mainShowGrid) quickShowGrid.checked = mainShowGrid.checked;
  if (quickShowSkirting && mainShowSkirting) quickShowSkirting.checked = mainShowSkirting.checked;
  if (floorShowGrid && mainShowGrid) floorShowGrid.checked = mainShowGrid.checked;
  if (pgShowGrid && mainShowGrid) pgShowGrid.checked = mainShowGrid.checked;
}
