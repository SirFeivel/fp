/**
 * @vitest-environment jsdom
 *
 * E2E tests for the Surface Divider feature.
 * Tests: splitPolygonByLine, computeZones, deriveDividerZoneName (geometry pipeline),
 *        computeZoneTiles (computation pipeline), renderPlanSvg (render layer).
 * No mocks — uses actual modules end-to-end.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  splitPolygonByLine,
  computeZones,
  deriveDividerZoneName,
  isPointInPolygon,
} from "./geometry.js";
import { computeZoneTiles } from "./walls.js";
import { renderPlanSvg, renderDividerZoneUI } from "./render.js";
import { createDividerController } from "./dividers.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** 100×100 rect vertices */
const RECT_100 = [
  { x: 0, y: 0 }, { x: 100, y: 0 },
  { x: 100, y: 100 }, { x: 0, y: 100 },
];

/** Shoelace area */
function area(verts) {
  return Math.abs(verts.reduce((s, v, i) => {
    const next = verts[(i + 1) % verts.length];
    return s + (v.x * next.y - next.x * v.y);
  }, 0)) / 2;
}

const TILE = { widthCm: 20, heightCm: 20, shape: "rect" };
const GROUT = { widthCm: 0.2, colorHex: "#cccccc" };
const PATTERN = { type: "grid", bondFraction: 0.5, rotationDeg: 0, offsetXcm: 0, offsetYcm: 0 };

function makeState(overrides = {}) {
  return {
    floors: [{
      id: "f1",
      rooms: [{
        id: "r1",
        polygonVertices: RECT_100,
        tile: TILE, grout: GROUT, pattern: PATTERN,
        exclusions: [], excludedTiles: [],
        dividers: [], zoneSettings: {},
        ...overrides,
      }],
      walls: [],
    }],
    selectedFloorId: "f1",
    selectedRoomId: "r1",
    view: {},
    tilePresets: [],
  };
}

// ── Unit: splitPolygonByLine ──────────────────────────────────────────────────

describe("splitPolygonByLine — rect", () => {
  it("H midline splits 100×100 rect into two halves, areas sum ≈ 10000", () => {
    const result = splitPolygonByLine(RECT_100, { x: 0, y: 50 }, { x: 100, y: 50 });
    expect(result).not.toBeNull();
    expect(result).toHaveLength(2);
    const [a, b] = result;
    expect(a.length).toBeGreaterThanOrEqual(3);
    expect(b.length).toBeGreaterThanOrEqual(3);
    expect(area(a) + area(b)).toBeCloseTo(10000, 0);
  });

  it("V midline splits 100×100 rect into two halves, areas sum ≈ 10000", () => {
    const result = splitPolygonByLine(RECT_100, { x: 50, y: 0 }, { x: 50, y: 100 });
    expect(result).not.toBeNull();
    const [a, b] = result;
    expect(area(a) + area(b)).toBeCloseTo(10000, 0);
  });

  it("returns null when p1 === p2 (degenerate)", () => {
    const result = splitPolygonByLine(RECT_100, { x: 50, y: 0 }, { x: 50, y: 0 });
    expect(result).toBeNull();
  });

  it("non-rectangular polygon: both halves have ≥ 3 vertices", () => {
    const tri = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 100 }];
    // Split from near-midpoint of left edge to near-midpoint of right edge
    const result = splitPolygonByLine(tri, { x: 25, y: 50 }, { x: 75, y: 50 });
    if (result) {
      expect(result[0].length).toBeGreaterThanOrEqual(3);
      expect(result[1].length).toBeGreaterThanOrEqual(3);
    }
  });
});

// ── Unit: computeZones ────────────────────────────────────────────────────────

describe("computeZones", () => {
  it("0 dividers → 1 zone with same vertices", () => {
    const zones = computeZones(RECT_100, []);
    expect(zones).toHaveLength(1);
    expect(zones[0].polygonVertices).toHaveLength(4);
  });

  it("1 H divider → 2 zones, areas sum ≈ parent", () => {
    const dividers = [{ id: "d1", p1: { x: 0, y: 50 }, p2: { x: 100, y: 50 } }];
    const zones = computeZones(RECT_100, dividers);
    expect(zones).toHaveLength(2);
    const totalArea = zones.reduce((s, z) => s + area(z.polygonVertices), 0);
    expect(totalArea).toBeCloseTo(10000, 0);
  });

  it("2 dividers → 3 zones", () => {
    const dividers = [
      { id: "d1", p1: { x: 0, y: 33 }, p2: { x: 100, y: 33 } },
      { id: "d2", p1: { x: 0, y: 66 }, p2: { x: 100, y: 66 } },
    ];
    const zones = computeZones(RECT_100, dividers);
    expect(zones).toHaveLength(3);
  });
});

// ── Unit: deriveDividerZoneName ───────────────────────────────────────────────

describe("deriveDividerZoneName", () => {
  it("equal H split → top zone labeled 'top-half-1'", () => {
    const topHalf = [
      { x: 0, y: 0 }, { x: 100, y: 0 },
      { x: 100, y: 50 }, { x: 0, y: 50 },
    ];
    const label = deriveDividerZoneName(RECT_100, topHalf, []);
    expect(label).toBe("top-half-1");
  });

  it("equal H split → bottom zone labeled 'bottom-half-1'", () => {
    const bottomHalf = [
      { x: 0, y: 50 }, { x: 100, y: 50 },
      { x: 100, y: 100 }, { x: 0, y: 100 },
    ];
    const label = deriveDividerZoneName(RECT_100, bottomHalf, []);
    expect(label).toBe("bottom-half-1");
  });

  it("equal V split → left zone labeled 'left-half-1'", () => {
    const leftHalf = [
      { x: 0, y: 0 }, { x: 50, y: 0 },
      { x: 50, y: 100 }, { x: 0, y: 100 },
    ];
    const label = deriveDividerZoneName(RECT_100, leftHalf, []);
    expect(label).toBe("left-half-1");
  });

  it("~33% H split → top-third label", () => {
    const thirdZone = [
      { x: 0, y: 0 }, { x: 100, y: 0 },
      { x: 100, y: 33 }, { x: 0, y: 33 },
    ];
    const label = deriveDividerZoneName(RECT_100, thirdZone, []);
    expect(label).toContain("third");
  });
});

// ── E2E: computeZoneTiles ─────────────────────────────────────────────────────

describe("computeZoneTiles — computation pipeline", () => {
  it("0 dividers → empty array", () => {
    const state = makeState();
    const floor = state.floors[0];
    const room = floor.rooms[0];
    const results = computeZoneTiles(state, room, floor);
    expect(results).toHaveLength(0);
  });

  it("1 divider, zone has tile → tiles.length > 0", () => {
    const dividers = [{ id: "d1", p1: { x: 0, y: 50 }, p2: { x: 100, y: 50 } }];
    const state = makeState({ dividers, zoneSettings: {} });
    const floor = state.floors[0];
    const room = floor.rooms[0];
    // Find actual zone IDs
    const zones = computeZones(room.polygonVertices, room.dividers);
    expect(zones.length).toBe(2);
    // Set tile on first zone
    state.floors[0].rooms[0].zoneSettings[zones[0].id] = { tile: TILE, grout: GROUT, pattern: PATTERN };
    const results = computeZoneTiles(state, room, floor);
    const tiledZone = results.find(r => r.tiles.length > 0);
    expect(tiledZone).toBeTruthy();
  });

  it("1 divider, untiled zone → tiles: []", () => {
    const state = makeState({
      dividers: [{ id: "d1", p1: { x: 0, y: 50 }, p2: { x: 100, y: 50 } }],
      zoneSettings: {}, // no tile on any zone
    });
    const floor = state.floors[0];
    const room = floor.rooms[0];
    const results = computeZoneTiles(state, room, floor);
    expect(results.length).toBe(2);
    results.forEach(r => expect(r.tiles).toHaveLength(0));
  });
});

// ── E2E: render layer ─────────────────────────────────────────────────────────

describe("renderPlanSvg — surface dividers", () => {
  beforeEach(() => { document.body.innerHTML = '<svg id="planSvg"></svg>'; });
  afterEach(() => { document.body.innerHTML = ""; });

  it("room with 1 divider: SVG contains [data-divid] line element", () => {
    const state = makeState({
      dividers: [{ id: "d1", p1: { x: 0, y: 50 }, p2: { x: 100, y: 50 } }],
    });
    renderPlanSvg({ state, setSelectedExcl: () => {}, setLastUnionError: () => {}, setLastTileError: () => {} });
    const svg = document.getElementById("planSvg");
    const divLines = [...svg.querySelectorAll("[data-divid]")];
    expect(divLines.length).toBeGreaterThan(0);
    expect(divLines[0].getAttribute("data-divid")).toBe("d1");
  });

  it("room with 0 dividers: no [data-divid] elements in SVG", () => {
    const state = makeState({ dividers: [] });
    renderPlanSvg({ state, setSelectedExcl: () => {}, setLastUnionError: () => {}, setLastTileError: () => {} });
    const svg = document.getElementById("planSvg");
    const divLines = [...svg.querySelectorAll("[data-divid]")];
    expect(divLines).toHaveLength(0);
  });

  it("room with 1 divider: SVG contains zone polygon outline with indigo stroke", () => {
    const state = makeState({
      dividers: [{ id: "d1", p1: { x: 0, y: 50 }, p2: { x: 100, y: 50 } }],
    });
    renderPlanSvg({ state, setSelectedExcl: () => {}, setLastUnionError: () => {}, setLastTileError: () => {} });
    const svg = document.getElementById("planSvg");
    const polygons = [...svg.querySelectorAll("polygon")];
    const indigoPolygon = polygons.find(p => (p.getAttribute("stroke") || "").includes("99,102,241"));
    expect(indigoPolygon).toBeTruthy();
  });
});

// ── commitZoneSettings DOM element ID integration ─────────────────────────────

describe("commitZoneSettings — reads zone-specific element IDs", () => {
  beforeEach(() => { document.body.innerHTML = '<div id="app"></div>'; });
  afterEach(() => { document.body.innerHTML = ""; });

  it("commitZoneSettings reads qzEnabled_{zoneId} and commits tile to state", () => {
    const dividers = [{ id: "d1", p1: { x: 0, y: 50 }, p2: { x: 100, y: 50 } }];
    const zones = computeZones(RECT_100, dividers);
    const zoneId = zones[0].id;

    let committed = null;
    const ctrl = createDividerController({
      getState: () => ({
        floors: [{ id: "f1", rooms: [{ id: "r1", polygonVertices: RECT_100, dividers, zoneSettings: {}, exclusions: [], excludedTiles: [] }], walls: [] }],
        selectedFloorId: "f1", selectedRoomId: "r1", selectedWallId: null,
        tilePresets: [{ id: "p1", name: "Test Tile", widthCm: 15, heightCm: 15, shape: "rect" }],
        view: {},
      }),
      commit: (label, next) => { committed = next; },
      getTarget: (state) => state.floors[0].rooms[0],
      t: (key) => key,
    });

    // Simulate renderDividerZoneUI having created the per-zone elements
    const enabledEl = document.createElement("input");
    enabledEl.type = "checkbox";
    enabledEl.id = `qzEnabled_${zoneId}`;
    enabledEl.checked = true;
    document.body.appendChild(enabledEl);

    const presetEl = document.createElement("select");
    presetEl.id = `qzPreset_${zoneId}`;
    const opt = document.createElement("option");
    opt.value = "p1"; opt.selected = true;
    presetEl.appendChild(opt);
    document.body.appendChild(presetEl);

    const groutWEl = document.createElement("input");
    groutWEl.id = `qzGroutWidth_${zoneId}`;
    groutWEl.value = "0.3";
    document.body.appendChild(groutWEl);

    const groutCEl = document.createElement("input");
    groutCEl.id = `qzGroutColor_${zoneId}`;
    groutCEl.value = "#ff0000";
    document.body.appendChild(groutCEl);

    const patternEl = document.createElement("select");
    patternEl.id = `qzPattern_${zoneId}`;
    const patOpt = document.createElement("option");
    patOpt.value = "runningBond"; patOpt.selected = true;
    patternEl.appendChild(patOpt);
    document.body.appendChild(patternEl);

    ctrl.commitZoneSettings(zoneId, "test-zone");

    expect(committed).not.toBeNull();
    const z = committed.floors[0].rooms[0].zoneSettings[zoneId];
    expect(z).toBeDefined();
    expect(z.tile).not.toBeNull();
    expect(z.tile.widthCm).toBe(15);
    expect(z.grout.colorHex).toBe("#ff0000");
    expect(z.grout.widthCm).toBeCloseTo(0.3, 2);
    expect(z.pattern.type).toBe("runningBond");
    expect(z.label).toBe("test-zone");
  });

  it("commitZoneSettings returns early when zone elements not in DOM", () => {
    // Simulates the bug that was fixed: generic IDs don't exist
    const dividers = [{ id: "d1", p1: { x: 0, y: 50 }, p2: { x: 100, y: 50 } }];
    const zones = computeZones(RECT_100, dividers);
    const zoneId = zones[0].id;

    let committed = null;
    const ctrl = createDividerController({
      getState: () => ({
        floors: [{ id: "f1", rooms: [{ id: "r1", polygonVertices: RECT_100, dividers, zoneSettings: {}, exclusions: [], excludedTiles: [] }], walls: [] }],
        selectedFloorId: "f1", selectedRoomId: "r1", selectedWallId: null, tilePresets: [], view: {},
      }),
      commit: (label, next) => { committed = next; },
      getTarget: (state) => state.floors[0].rooms[0],
      t: (key) => key,
    });

    // No DOM elements created — simulates old bug where generic IDs were looked up
    ctrl.commitZoneSettings(zoneId, "irrelevant");
    // Should return early without committing
    expect(committed).toBeNull();
  });
});
