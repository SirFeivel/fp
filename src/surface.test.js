import { describe, it, expect } from "vitest";
import { createSurface, transformWallExclusions } from "./surface.js";
import { DEFAULT_SKIRTING_CONFIG, DEFAULT_TILE_PRESET } from "./core.js";
import { roomPolygon, computeAvailableArea, tilesForPreview, getRoomBounds } from "./geometry.js";

// --- A. Factory correctness ---

describe("createSurface — factory correctness", () => {
  it("creates valid surface from widthCm + heightCm", () => {
    const s = createSurface({ widthCm: 200, heightCm: 100 });

    expect(s.id).toBeTruthy();
    expect(s.widthCm).toBe(200);
    expect(s.heightCm).toBe(100);
    expect(s.polygonVertices).toEqual([
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 100 },
      { x: 0, y: 100 },
    ]);
    expect(s.surfaceType).toBe("floor");
    expect(s.exclusions).toEqual([]);
    expect(s.tile.widthCm).toBe(DEFAULT_TILE_PRESET.widthCm);
  });

  it("derives widthCm/heightCm from polygonVertices", () => {
    const s = createSurface({
      polygonVertices: [
        { x: 10, y: 20 },
        { x: 310, y: 20 },
        { x: 310, y: 270 },
        { x: 10, y: 270 },
      ],
    });

    expect(s.widthCm).toBe(300);
    expect(s.heightCm).toBe(250);
    expect(s.polygonVertices).toHaveLength(4);
  });

  it("deep-merges tile — partial override keeps defaults", () => {
    const s = createSurface({
      widthCm: 100,
      heightCm: 100,
      tile: { reference: "Marble" },
    });

    expect(s.tile.reference).toBe("Marble");
    expect(s.tile.widthCm).toBe(DEFAULT_TILE_PRESET.widthCm);
    expect(s.tile.heightCm).toBe(DEFAULT_TILE_PRESET.heightCm);
    expect(s.tile.shape).toBe("rect");
  });

  it("deep-merges pattern — partial override keeps default origin", () => {
    const s = createSurface({
      widthCm: 100,
      heightCm: 100,
      pattern: { type: "herringbone" },
    });

    expect(s.pattern.type).toBe("herringbone");
    expect(s.pattern.origin.preset).toBe("tl");
    expect(s.pattern.bondFraction).toBe(0.5);
    expect(s.pattern.rotationDeg).toBe(0);
  });

  it("floor gets skirting, wall gets null", () => {
    const floor = createSurface({ widthCm: 100, heightCm: 100, surfaceType: "floor" });
    const wall = createSurface({ widthCm: 100, heightCm: 100, surfaceType: "wall" });

    expect(floor.skirting).toEqual(expect.objectContaining({ enabled: true }));
    expect(wall.skirting).toBeNull();
  });

  it("explicit skirting: null overrides floor default", () => {
    const s = createSurface({
      widthCm: 100,
      heightCm: 100,
      surfaceType: "floor",
      skirting: null,
    });

    expect(s.skirting).toBeNull();
  });

  it("each call gets a unique id", () => {
    const a = createSurface({ widthCm: 100, heightCm: 100 });
    const b = createSurface({ widthCm: 100, heightCm: 100 });

    expect(a.id).not.toBe(b.id);
  });

  it("creates circle surface from circleRadius", () => {
    const s = createSurface({ circleRadius: 100 });

    expect(s.id).toBeTruthy();
    expect(s.widthCm).toBe(200);
    expect(s.heightCm).toBe(200);
    expect(s.circle).toEqual({ cx: 100, cy: 100, rx: 100, ry: 100 });
    expect(s.polygonVertices).toBeNull();
    expect(s.surfaceType).toBe("floor");
  });

  it("non-circle surface has circle: null", () => {
    const s = createSurface({ widthCm: 100, heightCm: 100 });
    expect(s.circle).toBeNull();
  });
});

// --- B. Validation ---

describe("createSurface — validation", () => {
  it("throws if no polygon and no dimensions", () => {
    expect(() => createSurface({})).toThrow("Surface needs a shape");
    expect(() => createSurface({ name: "oops" })).toThrow("Surface needs a shape");
  });

  it("throws if polygonVertices has < 3 points", () => {
    expect(() =>
      createSurface({ polygonVertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }] })
    ).toThrow("at least 3 points");
  });

  it("rejects circleRadius of 0 or negative", () => {
    expect(() => createSurface({ circleRadius: 0 })).toThrow("Surface needs a shape");
    expect(() => createSurface({ circleRadius: -5 })).toThrow("Surface needs a shape");
  });
});

// --- C. Pipeline integration ---

describe("createSurface — circle pipeline integration", () => {
  it("roomPolygon() returns valid MultiPolygon for circle surface", () => {
    const s = createSurface({ circleRadius: 100 });
    const mp = roomPolygon(s);

    expect(mp).toHaveLength(1);
    expect(mp[0]).toHaveLength(1);
    // Ring should have many points (circle approximation + closure)
    expect(mp[0][0].length).toBeGreaterThan(30);
  });

  it("roomPolygon() works for ellipse (rx !== ry)", () => {
    const room = {
      circle: { cx: 150, cy: 100, rx: 150, ry: 100 },
      widthCm: 300,
      heightCm: 200
    };
    const mp = roomPolygon(room);

    expect(mp).toHaveLength(1);
    expect(mp[0]).toHaveLength(1);
    expect(mp[0][0].length).toBeGreaterThan(30);

    // Check that the polygon spans the full ellipse width and height
    const xs = mp[0][0].map(p => p[0]);
    const ys = mp[0][0].map(p => p[1]);
    const polyWidth = Math.max(...xs) - Math.min(...xs);
    const polyHeight = Math.max(...ys) - Math.min(...ys);
    expect(polyWidth).toBeCloseTo(300, 0);
    expect(polyHeight).toBeCloseTo(200, 0);
  });

  it("getRoomBounds() returns correct asymmetric bounds for ellipse", () => {
    const room = {
      circle: { cx: 150, cy: 100, rx: 150, ry: 100 },
      widthCm: 300,
      heightCm: 200
    };
    const bounds = getRoomBounds(room);

    expect(bounds.minX).toBe(0);
    expect(bounds.minY).toBe(0);
    expect(bounds.maxX).toBe(300);
    expect(bounds.maxY).toBe(200);
    expect(bounds.width).toBe(300);
    expect(bounds.height).toBe(200);
  });

  it("computeAvailableArea() works with circle surface", () => {
    const s = createSurface({ circleRadius: 100 });
    const result = computeAvailableArea(s, s.exclusions);

    expect(result.mp).toBeTruthy();
    expect(result.error).toBeNull();
  });

  it("tilesForPreview() generates tiles for circle surface", () => {
    const s = createSurface({
      circleRadius: 100,
      tile: { widthCm: 20, heightCm: 10 },
    });

    const { mp } = computeAvailableArea(s, s.exclusions);
    const dummyState = { floors: [], selectedFloorId: null, selectedRoomId: null };
    const result = tilesForPreview(dummyState, mp, s);

    expect(result.error).toBeNull();
    expect(result.tiles.length).toBeGreaterThan(0);
  });
});

describe("createSurface — pipeline integration", () => {
  it("roomPolygon() returns valid MultiPolygon from surface", () => {
    const s = createSurface({ widthCm: 200, heightCm: 100 });
    const mp = roomPolygon(s);

    // MultiPolygon format: [Polygon[Ring[Point]]]
    expect(mp).toHaveLength(1);
    expect(mp[0]).toHaveLength(1);
    // Ring should be closed (5 points for a rectangle)
    expect(mp[0][0].length).toBeGreaterThanOrEqual(4);
  });

  it("computeAvailableArea() returns valid area from surface", () => {
    const s = createSurface({ widthCm: 200, heightCm: 100 });
    const result = computeAvailableArea(s, s.exclusions);

    expect(result.mp).toBeTruthy();
    expect(result.error).toBeNull();
  });

  it("tilesForPreview() generates tiles from surface", () => {
    const s = createSurface({
      widthCm: 200,
      heightCm: 100,
      tile: { widthCm: 20, heightCm: 10 },
    });

    const { mp } = computeAvailableArea(s, s.exclusions);
    // tilesForPreview needs a state-like object or a room override
    const dummyState = { floors: [], selectedFloorId: null, selectedRoomId: null };
    const result = tilesForPreview(dummyState, mp, s);

    expect(result.error).toBeNull();
    expect(result.tiles.length).toBeGreaterThan(0);
    // Each tile has expected shape
    const tile = result.tiles[0];
    expect(tile).toHaveProperty("d");
    expect(tile).toHaveProperty("isFull");
    expect(tile).toHaveProperty("id");
  });
});

// --- D. transformWallExclusions ---

describe("transformWallExclusions", () => {
  // Axis-aligned rectangle: P0=(0,0), P1=(300,0), P2=(300,200), P3=(0,200)
  const axisAlignedVerts = [
    { x: 0, y: 0 },
    { x: 300, y: 0 },
    { x: 300, y: 200 },
    { x: 0, y: 200 },
  ];

  // Parallelogram (wall tilted 45°): same edge length & height but skewed
  const skewedVerts = [
    { x: 0, y: 200 },
    { x: 300, y: 200 },
    { x: 300, y: 0 },
    { x: 0, y: 0 },
  ];

  it("returns [] for empty exclusions", () => {
    expect(transformWallExclusions([], axisAlignedVerts, 300, 200)).toEqual([]);
  });

  it("returns [] for null/undefined exclusions", () => {
    expect(transformWallExclusions(null, axisAlignedVerts, 300, 200)).toEqual([]);
    expect(transformWallExclusions(undefined, axisAlignedVerts, 300, 200)).toEqual([]);
  });

  it("returns [] for insufficient surface verts", () => {
    expect(transformWallExclusions(
      [{ type: "rect", x: 10, y: 10, w: 20, h: 20 }],
      [{ x: 0, y: 0 }, { x: 1, y: 0 }],
      300, 200
    )).toEqual([]);
  });

  it("returns [] for zero edgeLength or wallH", () => {
    const ex = [{ type: "rect", x: 10, y: 10, w: 20, h: 20 }];
    expect(transformWallExclusions(ex, axisAlignedVerts, 0, 200)).toEqual([]);
    expect(transformWallExclusions(ex, axisAlignedVerts, 300, 0)).toEqual([]);
    expect(transformWallExclusions(ex, axisAlignedVerts, -1, 200)).toEqual([]);
  });

  it("returns [] for degenerate (collinear) surface verts", () => {
    const collinear = [
      { x: 0, y: 0 }, { x: 100, y: 0 },
      { x: 200, y: 0 }, { x: 300, y: 0 },
    ];
    expect(transformWallExclusions(
      [{ type: "rect", x: 10, y: 10, w: 20, h: 20 }],
      collinear, 300, 200
    )).toEqual([]);
  });

  it("transforms rect exclusion on axis-aligned surface (identity mapping)", () => {
    const result = transformWallExclusions(
      [{ type: "rect", x: 50, y: 50, w: 100, h: 60 }],
      axisAlignedVerts, 300, 200
    );
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("freeform");
    expect(result[0].vertices).toHaveLength(4);
    // On axis-aligned surface with matching dimensions, coords map 1:1
    expect(result[0].vertices[0].x).toBeCloseTo(50);
    expect(result[0].vertices[0].y).toBeCloseTo(50);
    expect(result[0].vertices[2].x).toBeCloseTo(150);
    expect(result[0].vertices[2].y).toBeCloseTo(110);
  });

  it("transforms rect exclusion on flipped surface", () => {
    // skewedVerts: P0=(0,200), P1=(300,200), P3=(0,0)
    // U = (300,0), V = (0,-200), so Y is inverted
    // A full-surface rect should still cover the full target, with flipped Y
    const result = transformWallExclusions(
      [{ type: "rect", x: 0, y: 0, w: 300, h: 200 }],
      skewedVerts, 300, 200
    );
    expect(result).toHaveLength(1);
    expect(result[0].vertices).toHaveLength(4);
    // All four corners of the target rect should appear (possibly reordered)
    const xs = result[0].vertices.map(v => v.x).sort((a, b) => a - b);
    const ys = result[0].vertices.map(v => v.y).sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(0);
    expect(xs[1]).toBeCloseTo(0);
    expect(xs[2]).toBeCloseTo(300);
    expect(xs[3]).toBeCloseTo(300);
    expect(ys[0]).toBeCloseTo(0);
    expect(ys[1]).toBeCloseTo(0);
    expect(ys[2]).toBeCloseTo(200);
    expect(ys[3]).toBeCloseTo(200);
  });

  it("transforms triangle exclusion", () => {
    const result = transformWallExclusions(
      [{ type: "tri", p1: { x: 0, y: 0 }, p2: { x: 150, y: 0 }, p3: { x: 75, y: 100 } }],
      axisAlignedVerts, 300, 200
    );
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("freeform");
    expect(result[0].vertices).toHaveLength(3);
    expect(result[0].vertices[0].x).toBeCloseTo(0);
    expect(result[0].vertices[0].y).toBeCloseTo(0);
    expect(result[0].vertices[1].x).toBeCloseTo(150);
    expect(result[0].vertices[2].x).toBeCloseTo(75);
    expect(result[0].vertices[2].y).toBeCloseTo(100);
  });

  it("transforms circle exclusion to 48-point polygon", () => {
    const result = transformWallExclusions(
      [{ type: "circle", cx: 150, cy: 100, r: 30 }],
      axisAlignedVerts, 300, 200
    );
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("freeform");
    expect(result[0].vertices).toHaveLength(48);
    // Center point of circle should roughly map to center
    const xs = result[0].vertices.map(v => v.x);
    const ys = result[0].vertices.map(v => v.y);
    const avgX = xs.reduce((a, b) => a + b) / xs.length;
    const avgY = ys.reduce((a, b) => a + b) / ys.length;
    expect(avgX).toBeCloseTo(150, 0);
    expect(avgY).toBeCloseTo(100, 0);
  });

  it("transforms circle exclusion with rx/ry (ellipse)", () => {
    const result = transformWallExclusions(
      [{ type: "circle", cx: 100, cy: 50, rx: 40, ry: 20 }],
      axisAlignedVerts, 300, 200
    );
    expect(result).toHaveLength(1);
    expect(result[0].vertices).toHaveLength(48);
  });

  it("transforms freeform exclusion", () => {
    const result = transformWallExclusions(
      [{ type: "freeform", vertices: [{ x: 10, y: 10 }, { x: 50, y: 10 }, { x: 30, y: 40 }] }],
      axisAlignedVerts, 300, 200
    );
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("freeform");
    expect(result[0].vertices).toHaveLength(3);
    expect(result[0].vertices[0].x).toBeCloseTo(10);
    expect(result[0].vertices[0].y).toBeCloseTo(10);
  });

  it("skips unknown exclusion types", () => {
    const result = transformWallExclusions(
      [{ type: "unknown" }, { type: "rect", x: 0, y: 0, w: 10, h: 10 }],
      axisAlignedVerts, 300, 200
    );
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("freeform");
  });

  it("skips freeform with fewer than 3 vertices", () => {
    const result = transformWallExclusions(
      [{ type: "freeform", vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }],
      axisAlignedVerts, 300, 200
    );
    expect(result).toEqual([]);
  });

  it("handles multiple exclusions", () => {
    const result = transformWallExclusions(
      [
        { type: "rect", x: 10, y: 10, w: 20, h: 20 },
        { type: "tri", p1: { x: 0, y: 0 }, p2: { x: 10, y: 0 }, p3: { x: 5, y: 10 } },
        { type: "circle", cx: 200, cy: 100, r: 25 },
      ],
      axisAlignedVerts, 300, 200
    );
    expect(result).toHaveLength(3);
    expect(result[0].vertices).toHaveLength(4);
    expect(result[1].vertices).toHaveLength(3);
    expect(result[2].vertices).toHaveLength(48);
  });

  it("scales correctly when target dimensions differ from surface", () => {
    // Surface is 300x200, but we map to 600x400 target
    const result = transformWallExclusions(
      [{ type: "rect", x: 150, y: 100, w: 150, h: 100 }],
      axisAlignedVerts, 600, 400
    );
    expect(result).toHaveLength(1);
    // Original at (0.5, 0.5) parametric → (300, 200) in target
    expect(result[0].vertices[0].x).toBeCloseTo(300);
    expect(result[0].vertices[0].y).toBeCloseTo(200);
    // Corner at (1.0, 1.0) → (600, 400)
    expect(result[0].vertices[2].x).toBeCloseTo(600);
    expect(result[0].vertices[2].y).toBeCloseTo(400);
  });
});
