/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { wireQuickViewToggleHandlers, syncQuickViewToggleStates } from "./quick_view_toggles.js";

function setupDom() {
  document.body.innerHTML = `
    <input id="quickShowGrid" type="checkbox" />
    <input id="quickShowSkirting" type="checkbox" />
    <input id="showGrid" type="checkbox" />
    <input id="showSkirting" type="checkbox" />
  `;
}

describe("quick view toggles", () => {
  it("propagates quick toggles to main toggles", () => {
    setupDom();
    const mainShowGrid = document.getElementById("showGrid");
    const mainShowSkirting = document.getElementById("showSkirting");
    let gridChanged = false;
    let skirtingChanged = false;

    mainShowGrid.addEventListener("change", () => {
      gridChanged = true;
    });
    mainShowSkirting.addEventListener("change", () => {
      skirtingChanged = true;
    });

    wireQuickViewToggleHandlers();

    const quickShowGrid = document.getElementById("quickShowGrid");
    const quickShowSkirting = document.getElementById("quickShowSkirting");

    quickShowGrid.checked = true;
    quickShowGrid.dispatchEvent(new Event("change", { bubbles: true }));

    quickShowSkirting.checked = true;
    quickShowSkirting.dispatchEvent(new Event("change", { bubbles: true }));

    expect(mainShowGrid.checked).toBe(true);
    expect(mainShowSkirting.checked).toBe(true);
    expect(gridChanged).toBe(true);
    expect(skirtingChanged).toBe(true);
  });

  it("syncs quick toggles from main toggles", () => {
    setupDom();
    const mainShowGrid = document.getElementById("showGrid");
    const mainShowSkirting = document.getElementById("showSkirting");
    const quickShowGrid = document.getElementById("quickShowGrid");
    const quickShowSkirting = document.getElementById("quickShowSkirting");

    mainShowGrid.checked = true;
    mainShowSkirting.checked = true;
    quickShowGrid.checked = false;
    quickShowSkirting.checked = false;

    syncQuickViewToggleStates();

    expect(quickShowGrid.checked).toBe(true);
    expect(quickShowSkirting.checked).toBe(true);
  });
});
