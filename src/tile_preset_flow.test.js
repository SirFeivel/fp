/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { bindUI } from "./ui.js";
import { defaultStateWithRoom, defaultState } from "./core.js";

const setupDom = () => {
  document.body.innerHTML = `
    <div id="tilePresetRow"><select id="tilePresetSelect"></select></div>
    <div id="tilePresetEmptyRow" class="tile-preset-empty hidden"></div>
    <button id="btnCreateTilePreset"></button>
    <label class="toggle-switch"><input id="tileConfigEditToggle" type="checkbox" /></label>
    <div class="tile-config-fields"></div>

    <div id="tileEditActions" class="tile-edit-actions hidden">
      <div id="tileEditWarning" class="warnItem tile-edit-warning hidden"></div>
      <button id="tileEditUpdateBtn"></button>
      <button id="tileEditSaveBtn"></button>
      <button id="tileEditDiscardBtn"></button>
    </div>

    <div id="tileReferenceField">
      <input id="tileReference" type="text" />
      <div id="tileEditError" class="field-error hidden"></div>
    </div>
    <select id="tileShape">
      <option value="rect">rect</option>
      <option value="square">square</option>
      <option value="hex">hex</option>
    </select>
    <input id="tileW" type="number" />
    <input id="tileH" type="number" />
    <input id="tilePricePerM2" type="number" />
    <input id="tilePackM2" type="number" />
    <input id="tileAllowSkirting" type="checkbox" />

    <input id="groutW" type="number" />
    <input id="groutColor" type="color" value="#ffffff" />
  `;
};

const createStore = (initial) => {
  let current = initial;
  return {
    getState: () => current,
    commit: (_label, next) => {
      current = next;
    },
    markDirty: vi.fn(),
    getUndoStack: () => [],
    getRedoStack: () => []
  };
};

describe("tile preset lifecycle flow", () => {
  it("handles empty -> create -> save as new -> update with warning", () => {
    const base = defaultStateWithRoom();
    base.tilePresets = [];
    base.floors[0].rooms[0].tile.reference = "";
    const store = createStore(base);

    setupDom();
    bindUI({
      store,
      excl: {},
      renderAll: vi.fn(),
      refreshProjectSelect: vi.fn(),
      updateMeta: vi.fn(),
      validateState: () => ({ errors: [], warns: [] }),
      defaultStateFn: defaultState,
      setSelectedExcl: vi.fn(),
      resetErrors: vi.fn()
    });

    document.getElementById("btnCreateTilePreset").click();
    const ref = document.getElementById("tileReference");
    const tileW = document.getElementById("tileW");
    const tileH = document.getElementById("tileH");
    ref.value = "Kitchen";
    tileW.value = "40";
    tileH.value = "20";
    document.getElementById("tileEditSaveBtn").click();

    let state = store.getState();
    expect(state.tilePresets.length).toBe(1);
    expect(state.tilePresets[0].name).toBe("Kitchen");
    expect(state.floors[0].rooms[0].tile.reference).toBe("Kitchen");

    const editToggle = document.getElementById("tileConfigEditToggle");
    editToggle.checked = true;
    editToggle.dispatchEvent(new Event("change", { bubbles: true }));
    tileW.value = "55";
    tileH.value = "25";
    tileW.dispatchEvent(new Event("input", { bubbles: true }));
    tileH.dispatchEvent(new Event("input", { bubbles: true }));
    document.getElementById("tileEditSaveBtn").click();

    state = store.getState();
    expect(state.tilePresets.length).toBe(2);
    expect(state.tilePresets.map(p => p.name)).toContain("Kitchen 2");
    expect(state.floors[0].rooms[0].tile.reference).toBe("Kitchen 2");

    editToggle.checked = true;
    editToggle.dispatchEvent(new Event("change", { bubbles: true }));
    ref.value = "Kitchen Final";
    tileW.value = "60";
    tileH.value = "30";
    ref.dispatchEvent(new Event("input", { bubbles: true }));
    tileW.dispatchEvent(new Event("input", { bubbles: true }));
    tileH.dispatchEvent(new Event("input", { bubbles: true }));

    const warning = document.getElementById("tileEditWarning");
    document.getElementById("tileEditUpdateBtn").click();
    expect(warning.classList.contains("hidden")).toBe(false);

    document.getElementById("tileEditUpdateBtn").click();
    state = store.getState();
    const updated = state.tilePresets.find(p => p.name === "Kitchen Final");
    expect(updated).toBeDefined();
    expect(updated.widthCm).toBe(60);
    expect(updated.heightCm).toBe(30);
    expect(state.tilePresets.find(p => p.name === "Kitchen 2")).toBeUndefined();
    expect(state.floors[0].rooms[0].tile.reference).toBe("Kitchen Final");
  });
});
