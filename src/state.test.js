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

describe("state migrations", () => {
  const validateStateFn = () => ({ errors: [], warns: [] });

  it("migrates v1 state to current schema with sections and view flags", () => {
    const v1 = {
      room: { name: "Alt", widthCm: 300, heightCm: 200 },
      exclusions: [],
      tile: { widthCm: 25, heightCm: 25, shape: "rect" },
      grout: { widthCm: 0.2, colorHex: "#ffffff" },
      pattern: { type: "grid", bondFraction: 0.5, rotationDeg: 0, offsetXcm: 0, offsetYcm: 0, origin: { preset: "tl", xCm: 0, yCm: 0 } },
      pricing: { packM2: 1.44, pricePerM2: 39.9, reserveTiles: 0 },
      waste: { allowRotate: true, optimizeCuts: false, kerfCm: 0.2 },
      view: { showGrid: true, showNeeds: false }
    };

    const store = createStateStore(defaultState, validateStateFn);
    store.setStateDirect(v1);
    const state = store.getState();
    const room = state.floors[0].rooms[0];

    expect(state.meta.version).toBe(7);
    expect(room.sections.length).toBe(1);
    expect(room.sections[0].widthCm).toBe(300);
    expect(room.sections[0].heightCm).toBe(200);
    expect(state.view.showSkirting).toBe(true);
  });

  it("migrates v5 state to v6 with preset arrays", () => {
    const v5 = {
      meta: { version: 5, updatedAt: "2026-01-01T00:00:00.000Z" },
      floors: [
        {
          id: "f1",
          name: "Floor",
          rooms: [
            {
              id: "r1",
              name: "Room",
              sections: [{ id: "s1", label: "Main", x: 0, y: 0, widthCm: 200, heightCm: 100, skirtingEnabled: true }],
              exclusions: [],
              tile: { widthCm: 20, heightCm: 10, shape: "rect", reference: "" },
              grout: { widthCm: 0.2, colorHex: "#ffffff" },
              pattern: { type: "grid", bondFraction: 0.5, rotationDeg: 0, offsetXcm: 0, offsetYcm: 0, origin: { preset: "tl", xCm: 0, yCm: 0 } }
            }
          ]
        }
      ],
      selectedFloorId: "f1",
      selectedRoomId: "r1",
      materials: {},
      pricing: { packM2: 1.44, pricePerM2: 39.9, reserveTiles: 0 },
      waste: { allowRotate: true, optimizeCuts: false, kerfCm: 0.2 },
      view: { showGrid: true, showNeeds: false, showSkirting: true }
    };

    const store = createStateStore(defaultState, validateStateFn);
    store.setStateDirect(v5);
    const state = store.getState();

    expect(state.meta.version).toBe(7);
    expect(Array.isArray(state.tilePresets)).toBe(true);
    expect(Array.isArray(state.skirtingPresets)).toBe(true);
  });
});
