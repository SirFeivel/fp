import { describe, it, expect } from "vitest";
import { createSurface } from "./surface.js";
import { DEFAULT_SKIRTING_CONFIG, DEFAULT_TILE_PRESET } from "./core.js";
import { roomPolygon, computeAvailableArea, tilesForPreview } from "./geometry.js";

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
    expect(s.circle).toEqual({ cx: 100, cy: 100, r: 100 });
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
