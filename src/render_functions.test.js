/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderCounts, renderExclList, renderTilePresets } from "./render.js";

describe("render.js targeted function tests", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  describe("renderCounts", () => {
    function setupCountsDOM() {
      document.body.innerHTML = `
        <span id="undoCount"></span>
        <span id="redoCount"></span>
        <span id="lastAction"></span>
        <span id="undoCounter"></span>
        <button id="btnUndo"></button>
        <button id="btnRedo"></button>
      `;
    }

    it("displays undo/redo counts", () => {
      setupCountsDOM();
      renderCounts([{ label: "a" }, { label: "b" }], [{ label: "c" }]);
      expect(document.getElementById("undoCount").textContent).toBe("2");
      expect(document.getElementById("redoCount").textContent).toBe("1");
    });

    it("displays last action label", () => {
      setupCountsDOM();
      renderCounts([{ label: "last action" }], [], "My Label");
      expect(document.getElementById("lastAction").textContent).toBe("My Label");
    });

    it("disables buttons when stacks empty", () => {
      setupCountsDOM();
      renderCounts([], []);
      expect(document.getElementById("btnUndo").disabled).toBe(true);
      expect(document.getElementById("btnRedo").disabled).toBe(true);
    });

    it("enables buttons when stacks non-empty", () => {
      setupCountsDOM();
      renderCounts([{ label: "x" }], [{ label: "y" }]);
      expect(document.getElementById("btnUndo").disabled).toBe(false);
      expect(document.getElementById("btnRedo").disabled).toBe(false);
    });
  });

  describe("renderExclList", () => {
    function setupExclDOM() {
      document.body.innerHTML = `<select id="exclList"></select>`;
    }

    it("empty room shows 'none' option and disables select", () => {
      setupExclDOM();
      const state = {
        floors: [{ id: "f1", rooms: [{ id: "r1", exclusions: [] }] }],
        selectedFloorId: "f1",
        selectedRoomId: "r1"
      };
      renderExclList(state, null);
      const sel = document.getElementById("exclList");
      expect(sel.options).toHaveLength(1);
      expect(sel.disabled).toBe(true);
    });

    it("renders exclusion options from data", () => {
      setupExclDOM();
      const state = {
        floors: [{
          id: "f1",
          rooms: [{
            id: "r1",
            exclusions: [
              { id: "ex1", type: "rect", label: "Door" },
              { id: "ex2", type: "circle", label: "" }
            ]
          }]
        }],
        selectedFloorId: "f1",
        selectedRoomId: "r1"
      };
      renderExclList(state, "ex1");
      const sel = document.getElementById("exclList");
      expect(sel.options).toHaveLength(2);
      expect(sel.options[0].textContent).toBe("Door");
      expect(sel.options[0].selected).toBe(true);
      expect(sel.disabled).toBe(false);
    });

    it("marks selected exclusion", () => {
      setupExclDOM();
      const state = {
        floors: [{
          id: "f1",
          rooms: [{
            id: "r1",
            exclusions: [
              { id: "ex1", type: "rect", label: "A" },
              { id: "ex2", type: "rect", label: "B" }
            ]
          }]
        }],
        selectedFloorId: "f1",
        selectedRoomId: "r1"
      };
      renderExclList(state, "ex2");
      expect(document.getElementById("exclList").value).toBe("ex2");
    });
  });

  describe("renderTilePresets", () => {
    function setupPresetDOM() {
      document.body.innerHTML = `
        <select id="tilePresetList"></select>
        <input id="tilePresetName" />
        <select id="tilePresetShape"></select>
        <input id="tilePresetW" />
        <input id="tilePresetH" />
        <input id="tilePresetGroutW" />
        <input id="tilePresetGroutColor" type="color" />
        <input id="tilePresetPricePerM2" />
        <input id="tilePresetPackM2" />
        <input id="tilePresetPricePerPack" />
        <input id="tilePresetUseSkirting" type="checkbox" />
        <div id="tilePresetRoomList"></div>
      `;
    }

    it("renders preset options in select list", () => {
      setupPresetDOM();
      const state = {
        tilePresets: [
          { id: "p1", name: "Standard", shape: "rect", widthCm: 40, heightCm: 20, groutWidthCm: 0.2, groutColorHex: "#ffffff", pricePerM2: 39.9, packM2: 1.44 }
        ],
        floors: []
      };
      renderTilePresets(state, "p1", vi.fn());
      const list = document.getElementById("tilePresetList");
      expect(list.options).toHaveLength(1);
      expect(list.options[0].textContent).toBe("Standard");
    });

    it("fills form fields from selected preset", () => {
      setupPresetDOM();
      const state = {
        tilePresets: [
          { id: "p1", name: "MyTile", shape: "hex", widthCm: 30, heightCm: 15, groutWidthCm: 0.3, groutColorHex: "#000000", pricePerM2: 50, packM2: 2, useForSkirting: true }
        ],
        floors: []
      };
      renderTilePresets(state, "p1", vi.fn());
      expect(document.getElementById("tilePresetName").value).toBe("MyTile");
      expect(document.getElementById("tilePresetW").value).toBe("30");
      expect(document.getElementById("tilePresetH").value).toBe("15");
      expect(document.getElementById("tilePresetUseSkirting").checked).toBe(true);
    });

    it("marks active preset as selected", () => {
      setupPresetDOM();
      const state = {
        tilePresets: [
          { id: "p1", name: "A", shape: "rect", widthCm: 40, heightCm: 20 },
          { id: "p2", name: "B", shape: "rect", widthCm: 30, heightCm: 10 }
        ],
        floors: []
      };
      renderTilePresets(state, "p2", vi.fn());
      expect(document.getElementById("tilePresetList").value).toBe("p2");
    });

    it("handles empty presets array", () => {
      setupPresetDOM();
      const state = { tilePresets: [], floors: [] };
      renderTilePresets(state, null, vi.fn());
      const list = document.getElementById("tilePresetList");
      expect(list.options).toHaveLength(1);
      expect(list.disabled).toBe(true);
    });

    it("disables form when no selected preset", () => {
      setupPresetDOM();
      const state = { tilePresets: [], floors: [] };
      renderTilePresets(state, null, vi.fn());
      expect(document.getElementById("tilePresetName").disabled).toBe(true);
    });

    it("renders room list with checkboxes for preset assignment", () => {
      setupPresetDOM();
      const state = {
        tilePresets: [
          { id: "p1", name: "Standard", shape: "rect", widthCm: 40, heightCm: 20 }
        ],
        floors: [{
          id: "f1",
          name: "EG",
          rooms: [
            { id: "r1", name: "Bath", tile: { reference: "Standard" } },
            { id: "r2", name: "Kitchen", tile: { reference: "" } }
          ]
        }]
      };
      renderTilePresets(state, "p1", vi.fn());
      const roomList = document.getElementById("tilePresetRoomList");
      const labels = roomList.querySelectorAll("label");
      expect(labels).toHaveLength(2);
      // First room should be checked (reference matches)
      const firstCheckbox = labels[0].querySelector("input");
      expect(firstCheckbox.checked).toBe(true);
      // Second room should not be checked
      const secondCheckbox = labels[1].querySelector("input");
      expect(secondCheckbox.checked).toBe(false);
    });
  });
});
