/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRemovalController } from "./removal.js";
import { defaultState, uuid, deepClone, getCurrentRoom, getSelectedWall } from "./core.js";
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

function makeStateWithWall() {
  const state = defaultState();
  const floor = state.floors[0];
  const roomId = uuid();
  const wallId = uuid();
  const surfaceId = uuid();

  floor.rooms.push({
    id: roomId,
    name: "Test Room",
    widthCm: 400,
    heightCm: 300,
    polygonVertices: [
      { x: 0, y: 0 }, { x: 400, y: 0 },
      { x: 400, y: 300 }, { x: 0, y: 300 }
    ],
    floorPosition: { x: 0, y: 0 },
    tile: { widthCm: 40, heightCm: 20, shape: "rect" },
    grout: { widthCm: 0.2, colorHex: "#fff" },
    pattern: { type: "grid" },
    exclusions: [],
    excludedTiles: [],
  });

  floor.walls = [{
    id: wallId,
    start: { x: 0, y: 0 },
    end: { x: 400, y: 0 },
    thicknessCm: 10,
    heightStartCm: 250,
    heightEndCm: 250,
    roomEdge: { roomId, edgeIndex: 0 },
    doorways: [],
    surfaces: [{
      id: surfaceId,
      side: "left",
      roomId,
      edgeIndex: 0,
      fromCm: 0,
      toCm: 400,
      tile: { widthCm: 40, heightCm: 20, shape: "rect" },
      grout: { widthCm: 0.2, colorHex: "#fff" },
      pattern: { type: "grid" },
      exclusions: [],
      excludedTiles: [],
    }],
  }];

  state.selectedRoomId = roomId;
  state.selectedWallId = null;
  state.selectedSurfaceIdx = 0;

  return { state, roomId, wallId, surfaceId };
}

describe("removal mode — surface vs room scoping", () => {
  it("toggles tile on room.excludedTiles when no wall is selected", () => {
    const { state } = makeStateWithWall();
    const store = createStateStore(() => state, validateStateFn);
    const renderAll = vi.fn();
    const ctrl = createRemovalController(store, renderAll);

    // Enable removal mode
    ctrl.toggleRemovalMode();

    // Create a mock pointerdown event with a tile target
    const tileEl = document.createElement("div");
    tileEl.dataset.tileid = "floor-tile-1";
    const svg = document.createElement("svg");
    svg.id = "planSvg";
    svg.appendChild(tileEl);
    document.body.appendChild(svg);

    const event = new PointerEvent("pointerdown", { bubbles: true });
    Object.defineProperty(event, "target", { value: tileEl });

    ctrl.handlePlanClick(event);

    const room = getCurrentRoom(store.getState());
    expect(room.excludedTiles).toContain("floor-tile-1");

    // No wall selected means surface should NOT have the tile
    const wall = getSelectedWall(store.getState());
    expect(wall).toBeNull();
  });

  it("toggles tile on surface.excludedTiles when wall is selected", () => {
    const { state, wallId } = makeStateWithWall();
    // Select the wall
    state.selectedWallId = wallId;
    state.selectedSurfaceIdx = 0;

    const store = createStateStore(() => state, validateStateFn);
    const renderAll = vi.fn();
    const ctrl = createRemovalController(store, renderAll);

    // Enable removal mode
    ctrl.toggleRemovalMode();

    // Create a mock pointerdown event with a tile target
    const tileEl = document.createElement("div");
    tileEl.dataset.tileid = "wall-tile-1";
    const svg = document.createElement("svg");
    svg.id = "planSvg";
    svg.appendChild(tileEl);
    document.body.appendChild(svg);

    const event = new PointerEvent("pointerdown", { bubbles: true });
    Object.defineProperty(event, "target", { value: tileEl });

    ctrl.handlePlanClick(event);

    const finalState = store.getState();
    const wall = getSelectedWall(finalState);
    expect(wall).not.toBeNull();
    const surface = wall.surfaces[0];
    expect(surface.excludedTiles).toContain("wall-tile-1");

    // Room's excludedTiles should NOT have the wall tile
    const room = getCurrentRoom(finalState);
    expect(room.excludedTiles).not.toContain("wall-tile-1");
  });

  it("toggles tile off when clicked twice on surface", () => {
    const { state, wallId } = makeStateWithWall();
    state.selectedWallId = wallId;
    state.selectedSurfaceIdx = 0;

    const store = createStateStore(() => state, validateStateFn);
    const renderAll = vi.fn();
    const ctrl = createRemovalController(store, renderAll);
    ctrl.toggleRemovalMode();

    const tileEl = document.createElement("div");
    tileEl.dataset.tileid = "wall-tile-2";
    const svg = document.createElement("svg");
    svg.id = "planSvg";
    svg.appendChild(tileEl);
    document.body.appendChild(svg);

    const mkEvent = () => {
      const ev = new PointerEvent("pointerdown", { bubbles: true });
      Object.defineProperty(ev, "target", { value: tileEl });
      return ev;
    };

    // Click once — adds tile
    ctrl.handlePlanClick(mkEvent());
    let surface = getSelectedWall(store.getState()).surfaces[0];
    expect(surface.excludedTiles).toContain("wall-tile-2");

    // Click again — removes tile
    ctrl.handlePlanClick(mkEvent());
    surface = getSelectedWall(store.getState()).surfaces[0];
    expect(surface.excludedTiles).not.toContain("wall-tile-2");
  });
});
