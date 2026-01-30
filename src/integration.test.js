import { describe, it, expect } from "vitest";
import { createStateStore } from "./state.js";
import { defaultState, deepClone } from "./core.js";
import { computePlanMetrics, computeSkirtingNeeds } from "./calc.js";

const validateStateFn = () => ({ errors: [], warns: [] });

function getRoom(state) {
  return state.floors[0].rooms[0];
}

const mockStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {}
};

try {
  Object.defineProperty(globalThis, "localStorage", {
    value: mockStorage,
    configurable: true
  });
} catch {
  globalThis.localStorage = mockStorage;
}

describe("integration flow", () => {
  it("updates metrics when tile size changes", () => {
    const store = createStateStore(defaultState, validateStateFn);
    const base = computePlanMetrics(store.getState());

    const next = deepClone(store.getState());
    const room = getRoom(next);
    room.tile.widthCm = 50;
    room.tile.heightCm = 50;
    store.setStateDirect(next);

    const updated = computePlanMetrics(store.getState());
    expect(updated.data.material.tileAreaCm2).not.toBe(base.data.material.tileAreaCm2);
  });

  it("reduces installed area when adding an exclusion", () => {
    const store = createStateStore(defaultState, validateStateFn);
    const base = computePlanMetrics(store.getState());

    const next = deepClone(store.getState());
    const room = getRoom(next);
    room.exclusions.push({
      id: "ex-1",
      type: "rect",
      label: "Exclusion",
      x: 0,
      y: 0,
      w: 100,
      h: 100,
    });
    store.setStateDirect(next);

    const updated = computePlanMetrics(store.getState());
    expect(updated.data.material.installedAreaM2).toBeCloseTo(base.data.material.installedAreaM2 - 1, 2);
  });

  it("reflects skirting toggle in skirting needs", () => {
    const store = createStateStore(defaultState, validateStateFn);
    const withSkirting = computeSkirtingNeeds(store.getState());

    const next = deepClone(store.getState());
    const room = getRoom(next);
    room.skirting.enabled = false;
    store.setStateDirect(next);

    const withoutSkirting = computeSkirtingNeeds(store.getState());
    expect(withSkirting.enabled).toBe(true);
    expect(withoutSkirting.enabled).toBe(false);
  });

  it("undo/redo restores state", () => {
    const store = createStateStore(defaultState, validateStateFn);
    const initial = store.getState();

    const next = deepClone(initial);
    getRoom(next).tile.widthCm = 55;
    store.commit("tile change", next);

    expect(getRoom(store.getState()).tile.widthCm).toBe(55);

    store.undo();
    expect(getRoom(store.getState()).tile.widthCm).toBe(getRoom(initial).tile.widthCm);

    store.redo();
    expect(getRoom(store.getState()).tile.widthCm).toBe(55);
  });

  it("round-trips export/import JSON", () => {
    const original = defaultState();
    const raw = JSON.stringify(original);
    const parsed = JSON.parse(raw);

    const store = createStateStore(defaultState, validateStateFn);
    store.setStateDirect(parsed);

    const state = store.getState();
    expect(state.floors.length).toBe(original.floors.length);
    expect(state.tilePresets.length).toBeGreaterThan(0);
    expect(getRoom(state).tile.reference).toBe("Standard");
  });
});
