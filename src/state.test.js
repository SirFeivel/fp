import { describe, it, expect } from "vitest";
import { createStateStore } from "./state.js";
import { defaultState } from "./core.js";

describe("state normalization", () => {
  const validateStateFn = () => ({ errors: [], warns: [] });

  it("defaults missing skirting.type to cutout", () => {
    const store = createStateStore(defaultState, validateStateFn);
    const next = defaultState();
    delete next.floors[0].rooms[0].skirting.type;

    store.setStateDirect(next);
    const room = store.getState().floors[0].rooms[0];
    expect(room.skirting.type).toBe("cutout");
  });

  it("coerces invalid skirting.type to cutout", () => {
    const store = createStateStore(defaultState, validateStateFn);
    const next = defaultState();
    next.floors[0].rooms[0].skirting.type = "unknown";

    store.setStateDirect(next);
    const room = store.getState().floors[0].rooms[0];
    expect(room.skirting.type).toBe("cutout");
  });

  it("keeps bought skirting.type", () => {
    const store = createStateStore(defaultState, validateStateFn);
    const next = defaultState();
    next.floors[0].rooms[0].skirting.type = "bought";

    store.setStateDirect(next);
    const room = store.getState().floors[0].rooms[0];
    expect(room.skirting.type).toBe("bought");
  });

  it("includes a Standard tile preset and references it by default", () => {
    const store = createStateStore(defaultState, validateStateFn);
    const state = store.getState();
    const room = state.floors[0].rooms[0];
    const preset = state.tilePresets.find(p => p.name === "Standard");

    expect(room.tile.reference).toBe("Standard");
    expect(preset).toBeDefined();
    expect(preset.useForSkirting).toBe(true);
  });

  it("enables skirting by default and includes a skirting preset", () => {
    const store = createStateStore(defaultState, validateStateFn);
    const state = store.getState();
    const room = state.floors[0].rooms[0];
    const preset = state.skirtingPresets.find(p => p.lengthCm === 60 && p.heightCm === 6);

    expect(room.skirting.enabled).toBe(true);
    expect(room.skirting.type).toBe("cutout");
    expect(preset).toBeDefined();
  });
});
