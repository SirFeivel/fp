/**
 * @vitest-environment jsdom
 *
 * E2E tests for sub-surface tiles (exclusions carrying their own tile/pattern).
 * Exercises: exclusionToRegion, computeSubSurfaceTiles, renderPlanSvg color logic.
 * No mocks — uses actual modules end-to-end.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { exclusionToRegion } from "./geometry.js";
import { computeSubSurfaceTiles } from "./walls.js";
import { renderPlanSvg } from "./render.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

const TILE = { widthCm: 10, heightCm: 10, shape: "rect" };
const GROUT = { widthCm: 0.2, colorHex: "#aaaaaa" };
const PATTERN = { type: "grid", bondFraction: 0.5, rotationDeg: 0, offsetXcm: 0, offsetYcm: 0 };

function makeState(overrides = {}) {
  return {
    floors: [
      {
        id: "f1",
        rooms: [
          {
            id: "r1",
            polygonVertices: [
              { x: 0, y: 0 },
              { x: 100, y: 0 },
              { x: 100, y: 100 },
              { x: 0, y: 100 },
            ],
            tile: { widthCm: 20, heightCm: 20, shape: "rect" },
            grout: { widthCm: 0.2, colorHex: "#cccccc" },
            pattern: PATTERN,
            exclusions: [],
            excludedTiles: [],
            ...overrides,
          },
        ],
        walls: [],
      },
    ],
    selectedFloorId: "f1",
    selectedRoomId: "r1",
    view: {},
  };
}

function makeRectExcl(overrides = {}) {
  return { id: "e1", type: "rect", x: 10, y: 10, w: 30, h: 20, tile: TILE, grout: GROUT, pattern: PATTERN, ...overrides };
}

// ── Unit: exclusionToRegion ───────────────────────────────────────────────────

describe("exclusionToRegion — rect", () => {
  it("returns correct widthCm/heightCm", () => {
    const excl = { id: "e1", type: "rect", x: 5, y: 10, w: 40, h: 25, tile: TILE };
    const region = exclusionToRegion(excl);
    expect(region).not.toBeNull();
    expect(region.widthCm).toBeCloseTo(40, 1);
    expect(region.heightCm).toBeCloseTo(25, 1);
  });

  it("returns polygonVertices without closing duplicate", () => {
    const excl = { id: "e1", type: "rect", x: 0, y: 0, w: 20, h: 10, tile: TILE };
    const region = exclusionToRegion(excl);
    // rect ring has 5 points (closing), region should strip it to 4
    expect(region.polygonVertices).toHaveLength(4);
    const first = region.polygonVertices[0];
    const last = region.polygonVertices[region.polygonVertices.length - 1];
    // first and last should NOT be the same point
    expect(first.x === last.x && first.y === last.y).toBe(false);
  });

  it("propagates tile/grout/pattern", () => {
    const excl = makeRectExcl();
    const region = exclusionToRegion(excl);
    expect(region.tile).toBe(TILE);
    expect(region.grout).toBe(GROUT);
    expect(region.pattern).toBe(PATTERN);
  });

  it("applies grout fallback when null", () => {
    const excl = { id: "e1", type: "rect", x: 0, y: 0, w: 20, h: 10, tile: TILE, grout: null, pattern: null };
    const region = exclusionToRegion(excl);
    expect(region.grout).toEqual({ widthCm: 0.2, colorHex: "#ffffff" });
    expect(region.pattern.type).toBe("grid");
  });

  it("exclusions field is empty array", () => {
    const region = exclusionToRegion(makeRectExcl());
    expect(region.exclusions).toEqual([]);
  });
});

describe("exclusionToRegion — circle", () => {
  it("returns correct bounding box size", () => {
    const excl = { id: "e2", type: "circle", cx: 50, cy: 50, r: 15, tile: TILE };
    const region = exclusionToRegion(excl);
    expect(region).not.toBeNull();
    expect(region.widthCm).toBeCloseTo(30, 0);
    expect(region.heightCm).toBeCloseTo(30, 0);
  });

  it("strips closing vertex from circle ring", () => {
    const excl = { id: "e2", type: "circle", cx: 50, cy: 50, r: 10, tile: TILE };
    const region = exclusionToRegion(excl);
    const verts = region.polygonVertices;
    const first = verts[0];
    const last = verts[verts.length - 1];
    expect(first.x === last.x && first.y === last.y).toBe(false);
  });
});

describe("exclusionToRegion — tri", () => {
  it("returns correct vertices for triangle", () => {
    const excl = {
      id: "e3", type: "tri",
      p1: { x: 0, y: 0 }, p2: { x: 20, y: 0 }, p3: { x: 10, y: 15 },
      tile: TILE,
    };
    const region = exclusionToRegion(excl);
    expect(region).not.toBeNull();
    expect(region.polygonVertices).toHaveLength(3);
    expect(region.widthCm).toBeCloseTo(20, 1);
    expect(region.heightCm).toBeCloseTo(15, 1);
  });
});

describe("exclusionToRegion — freeform", () => {
  it("returns correct vertices for freeform polygon", () => {
    const excl = {
      id: "e4", type: "freeform",
      vertices: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 20 }, { x: 0, y: 20 }],
      tile: TILE,
    };
    const region = exclusionToRegion(excl);
    expect(region).not.toBeNull();
    expect(region.widthCm).toBeCloseTo(30, 1);
    expect(region.heightCm).toBeCloseTo(20, 1);
  });
});

describe("exclusionToRegion — unknown type", () => {
  it("returns null for unknown shape type", () => {
    const excl = { id: "e5", type: "hexagon", tile: TILE };
    expect(exclusionToRegion(excl)).toBeNull();
  });
});

// ── E2E: computeSubSurfaceTiles ───────────────────────────────────────────────

describe("computeSubSurfaceTiles — sub-surface exclusion", () => {
  it("returns one result with tiles when exclusion has tile set", () => {
    const state = makeState();
    const floor = state.floors[0];
    const excl = makeRectExcl(); // 30×20 rect with 10×10 tiles → ~6 tiles
    const results = computeSubSurfaceTiles(state, [excl], floor);
    expect(results).toHaveLength(1);
    expect(results[0].exclusionId).toBe("e1");
    expect(results[0].tiles.length).toBeGreaterThan(0);
  });

  it("returns empty array when exclusion has no tile", () => {
    const state = makeState();
    const floor = state.floors[0];
    const excl = { id: "e1", type: "rect", x: 10, y: 10, w: 30, h: 20 }; // no tile field
    const results = computeSubSurfaceTiles(state, [excl], floor);
    expect(results).toHaveLength(0);
  });

  it("returns empty array for empty exclusions list", () => {
    const state = makeState();
    const floor = state.floors[0];
    expect(computeSubSurfaceTiles(state, [], floor)).toHaveLength(0);
  });

  it("returns empty array for null exclusions", () => {
    const state = makeState();
    const floor = state.floors[0];
    expect(computeSubSurfaceTiles(state, null, floor)).toHaveLength(0);
  });
});

describe("computeSubSurfaceTiles — tile coordinates within exclusion bounding box", () => {
  it("all tile path coordinates are within the exclusion bounding box (±1cm tolerance)", () => {
    const state = makeState();
    const floor = state.floors[0];
    const excl = makeRectExcl({ x: 10, y: 10, w: 30, h: 20 });
    const results = computeSubSurfaceTiles(state, [excl], floor);
    expect(results).toHaveLength(1);

    const bbox = { minX: 10, minY: 10, maxX: 40, maxY: 30 };
    const TOL = 1.0;

    for (const tile of results[0].tiles) {
      if (!tile.d) continue;
      // Extract all numbers from the SVG path (coordinates)
      const nums = tile.d.match(/-?\d+(\.\d+)?/g)?.map(Number) || [];
      // Path alternates x, y pairs after the first letter
      for (let i = 0; i < nums.length - 1; i += 2) {
        const x = nums[i];
        const y = nums[i + 1];
        // Coordinates should be within bbox with tolerance
        expect(x).toBeGreaterThanOrEqual(bbox.minX - TOL);
        expect(x).toBeLessThanOrEqual(bbox.maxX + TOL);
        expect(y).toBeGreaterThanOrEqual(bbox.minY - TOL);
        expect(y).toBeLessThanOrEqual(bbox.maxY + TOL);
      }
    }
  });
});

describe("computeSubSurfaceTiles — groutColor propagated", () => {
  it("groutColor matches exclusion grout colorHex", () => {
    const state = makeState();
    const floor = state.floors[0];
    const excl = makeRectExcl({ grout: { widthCm: 0.3, colorHex: "#ff0000" } });
    const results = computeSubSurfaceTiles(state, [excl], floor);
    expect(results[0].groutColor).toBe("#ff0000");
  });
});

// ── Logging verification ──────────────────────────────────────────────────────

describe("computeSubSurfaceTiles — logging", () => {
  let logSpy;
  beforeEach(() => { logSpy = vi.spyOn(console, "log").mockImplementation(() => {}); });
  afterEach(() => { logSpy.mockRestore(); });

  it("emits [geometry:exclusionToRegion] log line", () => {
    const state = makeState();
    const floor = state.floors[0];
    computeSubSurfaceTiles(state, [makeRectExcl()], floor);
    const msgs = logSpy.mock.calls.map(c => c[0]);
    expect(msgs.some(m => typeof m === "string" && m.includes("[geometry:exclusionToRegion]"))).toBe(true);
  });

  it("emits [walls:subSurface] log line", () => {
    const state = makeState();
    const floor = state.floors[0];
    computeSubSurfaceTiles(state, [makeRectExcl()], floor);
    const msgs = logSpy.mock.calls.map(c => c[0]);
    expect(msgs.some(m => typeof m === "string" && m.includes("[walls:subSurface]"))).toBe(true);
  });
});

// ── 2D render: exclusion colors ───────────────────────────────────────────────

function makeSvgState(exclusions = []) {
  return {
    floors: [{
      id: "f1",
      rooms: [{
        id: "r1",
        widthCm: 100,
        heightCm: 100,
        polygonVertices: [
          { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 },
        ],
        tile: { widthCm: 20, heightCm: 20, shape: "rect" },
        grout: { widthCm: 0.2, colorHex: "#cccccc" },
        pattern: PATTERN,
        exclusions,
        excludedTiles: [],
        skirting: { enabled: false },
      }],
      walls: [],
    }],
    selectedFloorId: "f1",
    selectedRoomId: "r1",
    view: {},
    tilePresets: [],
  };
}

describe("renderPlanSvg — tiled exclusion uses green, void exclusion uses red", () => {
  beforeEach(() => { document.body.innerHTML = '<svg id="planSvg"></svg>'; });
  afterEach(() => { document.body.innerHTML = ""; });

  it("void exclusion shape stroke contains red (239,68,68)", () => {
    const state = makeSvgState([
      { id: "e1", type: "rect", x: 10, y: 10, w: 20, h: 15 },
    ]);
    renderPlanSvg({ state, setSelectedExcl: vi.fn(), setLastUnionError: vi.fn(), setLastTileError: vi.fn() });
    const svg = document.getElementById("planSvg");
    const shapes = [...svg.querySelectorAll('[data-exid="e1"]')];
    expect(shapes.length).toBeGreaterThan(0);
    const stroke = shapes[0].getAttribute("stroke") || "";
    expect(stroke).toContain("239,68,68");
  });

  it("tiled exclusion shape stroke contains green (34,197,94)", () => {
    const state = makeSvgState([
      { id: "e2", type: "rect", x: 10, y: 10, w: 20, h: 15, tile: TILE, grout: GROUT, pattern: PATTERN },
    ]);
    renderPlanSvg({ state, setSelectedExcl: vi.fn(), setLastUnionError: vi.fn(), setLastTileError: vi.fn() });
    const svg = document.getElementById("planSvg");
    const shapes = [...svg.querySelectorAll('[data-exid="e2"]')];
    expect(shapes.length).toBeGreaterThan(0);
    const stroke = shapes[0].getAttribute("stroke") || "";
    expect(stroke).toContain("34,197,94");
  });

  it("union overlay for void exclusion uses red path", () => {
    const state = makeSvgState([
      { id: "e1", type: "rect", x: 10, y: 10, w: 20, h: 15 },
    ]);
    renderPlanSvg({ state, setSelectedExcl: vi.fn(), setLastUnionError: vi.fn(), setLastTileError: vi.fn() });
    const svg = document.getElementById("planSvg");
    const paths = [...svg.querySelectorAll("path")].filter(p => !p.getAttribute("data-exid"));
    const redPath = paths.find(p => (p.getAttribute("fill") || "").includes("239,68,68"));
    expect(redPath).toBeTruthy();
  });

  it("union overlay for tiled exclusion uses green path, no red union path", () => {
    const state = makeSvgState([
      { id: "e2", type: "rect", x: 10, y: 10, w: 20, h: 15, tile: TILE, grout: GROUT, pattern: PATTERN },
    ]);
    renderPlanSvg({ state, setSelectedExcl: vi.fn(), setLastUnionError: vi.fn(), setLastTileError: vi.fn() });
    const svg = document.getElementById("planSvg");
    const paths = [...svg.querySelectorAll("path")].filter(p => !p.getAttribute("data-exid"));
    const redUnionPath = paths.find(p => (p.getAttribute("fill") || "").includes("239,68,68"));
    const greenUnionPath = paths.find(p => (p.getAttribute("fill") || "").includes("34,197,94"));
    expect(redUnionPath).toBeFalsy();
    expect(greenUnionPath).toBeTruthy();
  });
});
