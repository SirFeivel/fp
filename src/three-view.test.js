// src/three-view.test.js
import { describe, it, expect } from "vitest";
import { parseTilePathD, parseHexColor, createWallMapper, createFloorMapper, exclusionToShape } from "./three-view.js";

describe("parseTilePathD", () => {
  it("parses a simple M/L/Z path into one ring", () => {
    const rings = parseTilePathD("M 0 0 L 10 0 L 10 10 L 0 10 Z");
    expect(rings).toHaveLength(1);
    expect(rings[0]).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]);
  });

  it("parses multi-ring paths", () => {
    const rings = parseTilePathD("M 0 0 L 5 0 L 5 5 Z M 10 10 L 20 10 L 20 20 Z");
    expect(rings).toHaveLength(2);
    expect(rings[0]).toHaveLength(3);
    expect(rings[1]).toHaveLength(3);
  });

  it("parses implicit L continuations (bare coordinate pairs)", () => {
    const rings = parseTilePathD("M 0 0 L 10 0 20 0 30 0 Z");
    expect(rings).toHaveLength(1);
    expect(rings[0]).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 30, y: 0 },
    ]);
  });

  it("returns empty array for empty string", () => {
    expect(parseTilePathD("")).toEqual([]);
  });

  it("handles NaN coordinates gracefully", () => {
    const rings = parseTilePathD("M abc def L 10 0 Z");
    expect(rings).toHaveLength(1);
    // NaN coordinates from "abc def" are skipped; only valid "L 10 0" is kept
    expect(rings[0]).toHaveLength(1);
    expect(rings[0][0]).toEqual({ x: 10, y: 0 });
  });

  it("parses decimal coordinates", () => {
    const rings = parseTilePathD("M 1.5 2.7 L 3.14 4.0 Z");
    expect(rings[0][0]).toEqual({ x: 1.5, y: 2.7 });
    expect(rings[0][1]).toEqual({ x: 3.14, y: 4.0 });
  });
});

describe("parseHexColor", () => {
  it("returns white for null input", () => {
    const c = parseHexColor(null);
    expect(c.r).toBeCloseTo(1);
    expect(c.g).toBeCloseTo(1);
    expect(c.b).toBeCloseTo(1);
  });

  it("returns white for non-string input", () => {
    const c = parseHexColor(42);
    expect(c.r).toBeCloseTo(1);
  });

  it("parses valid #rrggbb hex string", () => {
    const c = parseHexColor("#ff0000");
    expect(c.r).toBeCloseTo(1);
    expect(c.g).toBeCloseTo(0);
    expect(c.b).toBeCloseTo(0);
  });

  it("parses black", () => {
    const c = parseHexColor("#000000");
    expect(c.r).toBeCloseTo(0);
    expect(c.g).toBeCloseTo(0);
    expect(c.b).toBeCloseTo(0);
  });
});

describe("createWallMapper", () => {
  it("returns null for null surfaceVerts", () => {
    expect(createWallMapper(null, 0, 0, 10, 0, 200, 200)).toBeNull();
  });

  it("returns null for fewer than 4 surfaceVerts", () => {
    const verts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
    expect(createWallMapper(verts, 0, 0, 10, 0, 200, 200)).toBeNull();
  });

  it("returns null for degenerate (zero-area) surface", () => {
    // All points on a line → det ≈ 0
    const verts = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 30, y: 0 },
    ];
    expect(createWallMapper(verts, 0, 0, 10, 0, 200, 200)).toBeNull();
  });

  it("maps corners of a unit square surface correctly", () => {
    // Surface verts: A@ground, B@ground, B@height, A@height
    // Unit square: (0,0)→(100,0)→(100,200)→(0,200)
    const verts = [
      { x: 0, y: 0 },     // A@ground
      { x: 100, y: 0 },   // B@ground
      { x: 100, y: 200 }, // B@height
      { x: 0, y: 200 },   // A@height
    ];
    // Wall goes from (0,0,0) to (100,0,0) in 3D, height 200
    const mapper = createWallMapper(verts, 0, 0, 100, 0, 200, 200);
    expect(mapper).not.toBeNull();

    // Bottom-left corner (0,0) → 3D (0, 0, 0)
    const bl = mapper(0, 0);
    expect(bl.x).toBeCloseTo(0);
    expect(bl.y).toBeCloseTo(0);
    expect(bl.z).toBeCloseTo(0);

    // Bottom-right corner (100,0) → 3D (100, 0, 0)
    const br = mapper(100, 0);
    expect(br.x).toBeCloseTo(100);
    expect(br.y).toBeCloseTo(0);
    expect(br.z).toBeCloseTo(0);

    // Top-left corner (0,200) → 3D (0, 200, 0)
    const tl = mapper(0, 200);
    expect(tl.x).toBeCloseTo(0);
    expect(tl.y).toBeCloseTo(200);
    expect(tl.z).toBeCloseTo(0);

    // Top-right corner (100,200) → 3D (100, 200, 0)
    const tr = mapper(100, 200);
    expect(tr.x).toBeCloseTo(100);
    expect(tr.y).toBeCloseTo(200);
    expect(tr.z).toBeCloseTo(0);
  });
});

describe("createFloorMapper", () => {
  it("maps 2D coords to XZ plane with offset", () => {
    const mapper = createFloorMapper({ x: 10, y: 20 });
    const p = mapper(5, 7);
    expect(p.x).toBe(15);
    expect(p.y).toBe(0);
    expect(p.z).toBe(27);
  });

  it("maps origin with zero offset", () => {
    const mapper = createFloorMapper({ x: 0, y: 0 });
    const p = mapper(0, 0);
    expect(p).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe("exclusionToShape", () => {
  it("returns a Shape for rect exclusion", () => {
    const shape = exclusionToShape({ type: "rect", x: 10, y: 20, w: 50, h: 30 });
    expect(shape).not.toBeNull();
    const points = shape.getPoints();
    expect(points.length).toBeGreaterThanOrEqual(4);
  });

  it("returns a Shape for circle exclusion with rx/ry", () => {
    const shape = exclusionToShape({ type: "circle", cx: 50, cy: 50, rx: 30, ry: 20 });
    expect(shape).not.toBeNull();
    const points = shape.getPoints();
    expect(points.length).toBeGreaterThanOrEqual(10);
  });

  it("returns a Shape for circle exclusion falling back to r", () => {
    const shape = exclusionToShape({ type: "circle", cx: 50, cy: 50, r: 25 });
    expect(shape).not.toBeNull();
  });

  it("returns a Shape for tri exclusion", () => {
    const shape = exclusionToShape({
      type: "tri",
      p1: { x: 0, y: 0 },
      p2: { x: 100, y: 0 },
      p3: { x: 50, y: 80 },
    });
    expect(shape).not.toBeNull();
    const points = shape.getPoints();
    expect(points.length).toBeGreaterThanOrEqual(3);
  });

  it("returns a Shape for freeform exclusion with >= 3 vertices", () => {
    const shape = exclusionToShape({
      type: "freeform",
      vertices: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
    });
    expect(shape).not.toBeNull();
  });

  it("returns null for freeform exclusion with < 3 vertices", () => {
    const shape = exclusionToShape({
      type: "freeform",
      vertices: [{ x: 0, y: 0 }, { x: 10, y: 10 }],
    });
    expect(shape).toBeNull();
  });

  it("returns null for unknown type", () => {
    const shape = exclusionToShape({ type: "unknown" });
    expect(shape).toBeNull();
  });
});
