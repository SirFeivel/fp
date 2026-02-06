import { describe, it, expect } from "vitest";
import { createStateStore } from "./state.js";
import { defaultState, defaultStateWithRoom } from "./core.js";

describe("state normalization", () => {
  const validateStateFn = () => ({ errors: [], warns: [] });

  it("defaults missing skirting.type to cutout", () => {
    const store = createStateStore(defaultStateWithRoom, validateStateFn);
    const next = defaultStateWithRoom();
    delete next.floors[0].rooms[0].skirting.type;

    store.setStateDirect(next);
    const room = store.getState().floors[0].rooms[0];
    expect(room.skirting.type).toBe("cutout");
  });

  it("coerces invalid skirting.type to cutout", () => {
    const store = createStateStore(defaultStateWithRoom, validateStateFn);
    const next = defaultStateWithRoom();
    next.floors[0].rooms[0].skirting.type = "unknown";

    store.setStateDirect(next);
    const room = store.getState().floors[0].rooms[0];
    expect(room.skirting.type).toBe("cutout");
  });

  it("keeps bought skirting.type", () => {
    const store = createStateStore(defaultStateWithRoom, validateStateFn);
    const next = defaultStateWithRoom();
    next.floors[0].rooms[0].skirting.type = "bought";

    store.setStateDirect(next);
    const room = store.getState().floors[0].rooms[0];
    expect(room.skirting.type).toBe("bought");
  });

  it("includes a Standard tile preset and references it by default", () => {
    const store = createStateStore(defaultStateWithRoom, validateStateFn);
    const state = store.getState();
    const room = state.floors[0].rooms[0];
    const preset = state.tilePresets.find(p => p.name === "Standard");

    expect(room.tile.reference).toBe("Standard");
    expect(preset).toBeDefined();
    expect(preset.useForSkirting).toBe(true);
  });

  it("enables skirting by default and includes a skirting preset", () => {
    const store = createStateStore(defaultStateWithRoom, validateStateFn);
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

  it("migrates v1 state to current schema with polygonVertices and view flags", () => {
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

    expect(state.meta.version).toBe(10);
    // Sections are converted to polygonVertices
    expect(room.polygonVertices).toBeDefined();
    expect(room.polygonVertices.length).toBe(4);
    // Check the room bounds are correct (300x200)
    const xs = room.polygonVertices.map(v => v.x);
    const ys = room.polygonVertices.map(v => v.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBe(300);
    expect(Math.max(...ys) - Math.min(...ys)).toBe(200);
    expect(room.sections).toBeUndefined();
    expect(state.view.showSkirting).toBe(true);
  });

  it("migrates v5 state with sections to v8 with polygonVertices", () => {
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
    const room = state.floors[0].rooms[0];

    expect(state.meta.version).toBe(10);
    expect(Array.isArray(state.tilePresets)).toBe(true);
    expect(Array.isArray(state.skirtingPresets)).toBe(true);
    // Sections are converted to polygonVertices
    expect(room.polygonVertices).toBeDefined();
    expect(room.polygonVertices.length).toBe(4);
    expect(room.sections).toBeUndefined();
  });

  it("migrates L-shaped room with multiple sections to single polygon", () => {
    const v7 = {
      meta: { version: 7, updatedAt: "2026-01-01T00:00:00.000Z" },
      floors: [
        {
          id: "f1",
          name: "Floor",
          layout: { enabled: false, background: null },
          patternLinking: { enabled: false, globalOrigin: { x: 0, y: 0 } },
          offcutSharing: { enabled: false },
          patternGroups: [],
          rooms: [
            {
              id: "r1",
              name: "L-Room",
              floorPosition: { x: 0, y: 0 },
              patternLink: { mode: "independent", linkedRoomId: null },
              // L-shaped room: main + extension
              sections: [
                { id: "s1", label: "Main", x: 0, y: 0, widthCm: 300, heightCm: 200 },
                { id: "s2", label: "Extension", x: 300, y: 0, widthCm: 100, heightCm: 100 }
              ],
              exclusions: [],
              tile: { widthCm: 20, heightCm: 10, shape: "rect", reference: "" },
              grout: { widthCm: 0.2, colorHex: "#ffffff" },
              pattern: { type: "grid", bondFraction: 0.5, rotationDeg: 0, offsetXcm: 0, offsetYcm: 0, origin: { preset: "tl", xCm: 0, yCm: 0 } },
              skirting: { enabled: true, type: "cutout", heightCm: 6, boughtWidthCm: 60, boughtPricePerPiece: 5 }
            }
          ]
        }
      ],
      selectedFloorId: "f1",
      selectedRoomId: "r1",
      materials: {},
      tilePresets: [],
      skirtingPresets: [],
      pricing: { packM2: 1.44, pricePerM2: 39.9, reserveTiles: 0 },
      waste: { allowRotate: true, optimizeCuts: false, kerfCm: 0.2 },
      view: { showGrid: true, showNeeds: false, showSkirting: true, planningMode: "room" }
    };

    const store = createStateStore(defaultState, validateStateFn);
    store.setStateDirect(v7);
    const state = store.getState();
    const room = state.floors[0].rooms[0];

    expect(state.meta.version).toBe(10);
    expect(room.polygonVertices).toBeDefined();
    // L-shape should have 6 vertices (not 4)
    expect(room.polygonVertices.length).toBe(6);
    expect(room.sections).toBeUndefined();
  });
});
