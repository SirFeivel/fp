/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRemovalController } from "./removal.js";
import { defaultStateWithRoom, deepClone, getCurrentRoom } from "./core.js";
import { createStateStore } from "./state.js";
import { clearMetricsCache } from "./calc.js";

const validateStateFn = () => ({ errors: [], warns: [] });

let storage = {};
const mockStorage = {
  getItem: (key) => storage[key] ?? null,
  setItem: (key, value) => { storage[key] = String(value); },
  removeItem: (key) => { delete storage[key]; }
};

try {
  Object.defineProperty(globalThis, "localStorage", {
    value: mockStorage,
    configurable: true
  });
} catch {
  globalThis.localStorage = mockStorage;
}

beforeEach(() => {
  storage = {};
  clearMetricsCache();
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("removal.js extended tests", () => {
  function createTestStore() {
    const store = createStateStore(defaultStateWithRoom, validateStateFn);
    return store;
  }

  describe("toggleRemovalMode", () => {
    it("toggles false -> true", () => {
      const store = createTestStore();
      const renderAll = vi.fn();
      const ctrl = createRemovalController(store, renderAll);

      expect(store.getState().view.removalMode).toBeFalsy();
      ctrl.toggleRemovalMode();
      expect(store.getState().view.removalMode).toBe(true);
    });

    it("toggles true -> false", () => {
      const store = createTestStore();
      const renderAll = vi.fn();
      const ctrl = createRemovalController(store, renderAll);

      ctrl.toggleRemovalMode(); // false -> true
      ctrl.toggleRemovalMode(); // true -> false
      expect(store.getState().view.removalMode).toBe(false);
    });

    it("commits state", () => {
      const store = createTestStore();
      const renderAll = vi.fn();
      const ctrl = createRemovalController(store, renderAll);

      ctrl.toggleRemovalMode();
      expect(store.getUndoStack().length).toBeGreaterThan(0);
    });
  });

  describe("setRemovalMode", () => {
    it("sets true when false", () => {
      const store = createTestStore();
      const renderAll = vi.fn();
      const ctrl = createRemovalController(store, renderAll);

      ctrl.setRemovalMode(true);
      expect(store.getState().view.removalMode).toBe(true);
    });

    it("no-op when already in desired mode", () => {
      const store = createTestStore();
      const renderAll = vi.fn();
      const ctrl = createRemovalController(store, renderAll);

      const undoBefore = store.getUndoStack().length;
      ctrl.setRemovalMode(false); // already false
      expect(store.getUndoStack().length).toBe(undoBefore);
    });

    it("sets false when true", () => {
      const store = createTestStore();
      const renderAll = vi.fn();
      const ctrl = createRemovalController(store, renderAll);

      ctrl.setRemovalMode(true);
      ctrl.setRemovalMode(false);
      expect(store.getState().view.removalMode).toBe(false);
    });
  });

  describe("handlePlanClick skirt", () => {
    it("adds skirtId to excludedSkirts", () => {
      const store = createTestStore();
      const renderAll = vi.fn();
      const ctrl = createRemovalController(store, renderAll);

      // Enable removal mode
      ctrl.setRemovalMode(true);

      // Create a fake event with a skirtid target
      const skirtEl = document.createElement("div");
      skirtEl.dataset.skirtid = "skirt-1";
      document.body.appendChild(skirtEl);

      const event = new MouseEvent("click", { bubbles: true });
      Object.defineProperty(event, "target", { value: skirtEl });
      event.stopPropagation = vi.fn();
      event.preventDefault = vi.fn();

      ctrl.handlePlanClick(event);

      const room = getCurrentRoom(store.getState());
      expect(room.excludedSkirts).toContain("skirt-1");
    });

    it("removes skirtId on second click (toggle)", () => {
      const store = createTestStore();
      const renderAll = vi.fn();
      const ctrl = createRemovalController(store, renderAll);

      ctrl.setRemovalMode(true);

      const skirtEl = document.createElement("div");
      skirtEl.dataset.skirtid = "skirt-2";
      document.body.appendChild(skirtEl);

      const makeEvent = () => {
        const event = new MouseEvent("click", { bubbles: true });
        Object.defineProperty(event, "target", { value: skirtEl });
        event.stopPropagation = vi.fn();
        event.preventDefault = vi.fn();
        return event;
      };

      ctrl.handlePlanClick(makeEvent()); // add
      expect(getCurrentRoom(store.getState()).excludedSkirts).toContain("skirt-2");

      ctrl.handlePlanClick(makeEvent()); // remove
      expect(getCurrentRoom(store.getState()).excludedSkirts).not.toContain("skirt-2");
    });

    it("no-op when removalMode off", () => {
      const store = createTestStore();
      const renderAll = vi.fn();
      const ctrl = createRemovalController(store, renderAll);

      const skirtEl = document.createElement("div");
      skirtEl.dataset.skirtid = "skirt-3";
      document.body.appendChild(skirtEl);

      const event = new MouseEvent("click", { bubbles: true });
      Object.defineProperty(event, "target", { value: skirtEl });

      const undoBefore = store.getUndoStack().length;
      ctrl.handlePlanClick(event);
      expect(store.getUndoStack().length).toBe(undoBefore);
    });

    it("no-op when target has no data attributes", () => {
      const store = createTestStore();
      const renderAll = vi.fn();
      const ctrl = createRemovalController(store, renderAll);

      ctrl.setRemovalMode(true);

      const plainEl = document.createElement("div");
      document.body.appendChild(plainEl);

      const event = new MouseEvent("click", { bubbles: true });
      Object.defineProperty(event, "target", { value: plainEl });

      const undoBefore = store.getUndoStack().length;
      ctrl.handlePlanClick(event);
      // Only the setRemovalMode commit should be there
      expect(store.getUndoStack().length).toBe(undoBefore);
    });
  });
});
