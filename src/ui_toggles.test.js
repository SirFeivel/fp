/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import { bindUI } from "./ui.js";

function makeState() {
  return {
    floors: [
      {
        id: "f1",
        rooms: [
          {
            id: "r1",
            name: "Room",
            polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
            tile: { widthCm: 40, heightCm: 20, shape: "rect", reference: "" },
            grout: { widthCm: 0.2, colorHex: "#ffffff" },
            pattern: { type: "grid", bondFraction: 0.5, rotationDeg: 0, offsetXcm: 0, offsetYcm: 0, origin: { preset: "tl", xCm: 0, yCm: 0 } },
            skirting: { enabled: false, type: "cutout", heightCm: 6, boughtWidthCm: 60, boughtPricePerPiece: 5 }
          }
        ]
      }
    ],
    selectedFloorId: "f1",
    selectedRoomId: "r1",
    view: { showGrid: false, showSkirting: false, removalMode: false },
    tilePresets: [],
    skirtingPresets: []
  };
}

function setupDom() {
  document.body.innerHTML = `
    <input id="roomName" />
    <input id="tileReference" />
    <select id="skirtingType"><option value="cutout">cutout</option><option value="bought">bought</option></select>
    <input id="skirtingHeight" />
    <input id="skirtingBoughtWidth" />
    <input id="skirtingPricePerPiece" />
    <input id="showGrid" type="checkbox" />
    <input id="showSkirting" type="checkbox" />
    <input id="removalMode" type="checkbox" />
    <input id="roomSkirtingEnabled" type="checkbox" />
    <input id="planningRoomSkirtingEnabled" type="checkbox" />
  `;
}

describe("UI toggles", () => {
  it("commits view toggles for showGrid/showSkirting", () => {
    const state = makeState();
    const store = {
      getState: () => state,
      commit: (_label, next) => {
        state.view = next.view;
        state.floors = next.floors;
      },
      markDirty: vi.fn(),
      getUndoStack: () => [],
      getRedoStack: () => []
    };

    setupDom();
    bindUI({
      store,
      excl: {},
      renderAll: vi.fn(),
      refreshProjectSelect: vi.fn(),
      updateMeta: vi.fn(),
      validateState: () => ({ errors: [], warns: [] }),
      defaultStateFn: () => makeState(),
      setSelectedExcl: vi.fn(),
      resetErrors: vi.fn()
    });

    const showGrid = document.getElementById("showGrid");
    const showSkirting = document.getElementById("showSkirting");
    showGrid.checked = true;
    showSkirting.checked = true;
    showGrid.dispatchEvent(new Event("change", { bubbles: true }));
    showSkirting.dispatchEvent(new Event("change", { bubbles: true }));

    expect(state.view.showGrid).toBe(true);
    expect(state.view.showSkirting).toBe(true);
  });

  it("commits room skirting enabled from setup/planning toggles", () => {
    const state = makeState();
    const store = {
      getState: () => state,
      commit: (_label, next) => {
        state.view = next.view;
        state.floors = next.floors;
      },
      markDirty: vi.fn(),
      getUndoStack: () => [],
      getRedoStack: () => []
    };

    setupDom();
    bindUI({
      store,
      excl: {},
      renderAll: vi.fn(),
      refreshProjectSelect: vi.fn(),
      updateMeta: vi.fn(),
      validateState: () => ({ errors: [], warns: [] }),
      defaultStateFn: () => makeState(),
      setSelectedExcl: vi.fn(),
      resetErrors: vi.fn()
    });

    const setupToggle = document.getElementById("roomSkirtingEnabled");
    const planningToggle = document.getElementById("planningRoomSkirtingEnabled");

    setupToggle.checked = true;
    setupToggle.dispatchEvent(new Event("change", { bubbles: true }));
    expect(state.floors[0].rooms[0].skirting.enabled).toBe(true);

    planningToggle.checked = false;
    planningToggle.dispatchEvent(new Event("change", { bubbles: true }));
    expect(state.floors[0].rooms[0].skirting.enabled).toBe(false);
  });
});
