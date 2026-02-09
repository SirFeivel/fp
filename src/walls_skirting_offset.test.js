// src/walls_skirting_offset.test.js — Tests for wall surface tiling offset with floor skirting

import { describe, it, expect, beforeEach } from "vitest";
import { edgeHasActiveSkirting, computeWallSkirtingOffset, wallSurfaceToTileableRegion, syncFloorWalls } from "./walls.js";
import { computeSkirtingSegments } from "./geometry.js";

// Helper to create a minimal rectangular room
function makeRoom(id, x, y, w, h) {
  return {
    id,
    name: id,
    floorPosition: { x, y },
    widthCm: w,
    heightCm: h,
    polygonVertices: [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ],
    tile: { widthCm: 60, heightCm: 60, shape: 'rect' },
    grout: { widthCm: 0.2, colorHex: '#cccccc' },
    pattern: { type: 'grid', bondFraction: 0.5, rotationDeg: 0, offsetXcm: 0, offsetYcm: 0, origin: { preset: 'tl', xCm: 0, yCm: 0 } },
    exclusions: [],
  };
}

describe("edgeHasActiveSkirting", () => {
  let room, floor;

  beforeEach(() => {
    room = makeRoom("room1", 0, 0, 400, 300);
    room.skirting = {
      enabled: true,
      type: "cutout",
      heightCm: 6
    };
    room.excludedSkirts = [];

    floor = {
      id: "floor1",
      name: "Floor 1",
      rooms: [room],
      walls: []
    };
  });

  it("returns true when room has skirting enabled with no exclusions", () => {
    const result = edgeHasActiveSkirting(room, 0, floor);
    expect(result).toBe(true);
  });

  it("returns false when skirting is disabled", () => {
    room.skirting.enabled = false;
    const result = edgeHasActiveSkirting(room, 0, floor);
    expect(result).toBe(false);
  });

  it("returns false when room has no skirting config", () => {
    delete room.skirting;
    const result = edgeHasActiveSkirting(room, 0, floor);
    expect(result).toBe(false);
  });

  it("returns false when edgeIndex is null", () => {
    const result = edgeHasActiveSkirting(room, null, floor);
    expect(result).toBe(false);
  });

  it("returns true when some pieces are excluded but not all on this edge", () => {
    // Exclude one piece but not all
    room.excludedSkirts = ["w0.00,0.00-400.00,0.00-p0"];
    const result = edgeHasActiveSkirting(room, 0, floor);
    // Should still return true if there are other pieces on this edge
    expect(result).toBe(true);
  });

  it("returns false when all pieces are excluded on the edge", () => {
    // This test assumes we know the skirting piece IDs for the edge
    // For a 400cm edge with default tile size, we'd have multiple pieces
    // Excluding all of them should make this return false

    const segments = computeSkirtingSegments(room, true, floor);

    // Get all piece IDs for edge 0 (bottom edge: 0,0 to 400,0)
    const edge0Pieces = segments
      .filter(seg => {
        const [p1x, p1y] = seg.p1;
        const [p2x, p2y] = seg.p2;
        return Math.abs(p1y) < 0.01 && Math.abs(p2y) < 0.01; // Y=0 edge
      })
      .map(seg => seg.id);

    room.excludedSkirts = edge0Pieces;
    const result = edgeHasActiveSkirting(room, 0, floor);
    expect(result).toBe(false);
  });
});

describe("computeWallSkirtingOffset", () => {
  let room, floor;

  beforeEach(() => {
    room = makeRoom("room1", 0, 0, 400, 300);
    room.skirting = {
      enabled: true,
      type: "cutout",
      heightCm: 6
    };
    room.excludedSkirts = [];

    floor = {
      id: "floor1",
      name: "Floor 1",
      rooms: [room],
      walls: []
    };
  });

  it("returns correct offset when skirting is active", () => {
    const groutWidth = 0.2;
    const offset = computeWallSkirtingOffset(room, 0, floor, groutWidth);
    // offset = skirting height + 2 × grout width
    expect(offset).toBe(6 + 2 * 0.2); // 6.4
  });

  it("returns 0 when skirting is disabled", () => {
    room.skirting.enabled = false;
    const offset = computeWallSkirtingOffset(room, 0, floor, 0.2);
    expect(offset).toBe(0);
  });

  it("returns 0 when room is null", () => {
    const offset = computeWallSkirtingOffset(null, 0, floor, 0.2);
    expect(offset).toBe(0);
  });

  it("handles different skirting heights", () => {
    room.skirting.heightCm = 10;
    const groutWidth = 0.3;
    const offset = computeWallSkirtingOffset(room, 0, floor, groutWidth);
    expect(offset).toBe(10 + 2 * 0.3); // 10.6
  });

  it("handles zero grout width", () => {
    const offset = computeWallSkirtingOffset(room, 0, floor, 0);
    expect(offset).toBe(6); // Just the skirting height
  });

  it("returns 0 when all skirting pieces are excluded on the edge", () => {
    const segments = computeSkirtingSegments(room, true, floor);

    // Exclude all pieces on edge 0
    const edge0Pieces = segments
      .filter(seg => {
        const [p1x, p1y] = seg.p1;
        const [p2x, p2y] = seg.p2;
        return Math.abs(p1y) < 0.01 && Math.abs(p2y) < 0.01;
      })
      .map(seg => seg.id);

    room.excludedSkirts = edge0Pieces;
    const offset = computeWallSkirtingOffset(room, 0, floor, 0.2);
    expect(offset).toBe(0);
  });
});

describe("wallSurfaceToTileableRegion with skirting offset", () => {
  let floor, room, wall;

  beforeEach(() => {
    room = makeRoom("room1", 0, 0, 400, 300);
    room.skirting = {
      enabled: true,
      type: "cutout",
      heightCm: 6
    };
    room.excludedSkirts = [];

    floor = {
      id: "floor1",
      name: "Floor 1",
      rooms: [room],
      walls: []
    };

    // Sync walls to create wall entities
    syncFloorWalls(floor);
    wall = floor.walls[0];
  });

  it("returns skirtingOffset = 0 when no room context is provided (legacy call)", () => {
    const region = wallSurfaceToTileableRegion(wall, 0);
    expect(region).toBeTruthy();
    expect(region.skirtingOffset).toBe(0);
  });

  it("returns correct skirtingOffset when room context is provided with active skirting", () => {
    const region = wallSurfaceToTileableRegion(wall, 0, { room, floor });
    expect(region).toBeTruthy();

    // Grout width from surface or 0
    const groutWidth = wall.surfaces[0]?.grout?.widthCm ?? 0;
    const expectedOffset = 6 + 2 * groutWidth;
    expect(region.skirtingOffset).toBe(expectedOffset);
  });

  it("polygon floor vertices are shifted up by skirtingOffset (uniform wall)", () => {
    const region = wallSurfaceToTileableRegion(wall, 0, { room, floor });
    expect(region).toBeTruthy();

    const groutWidth = wall.surfaces[0]?.grout?.widthCm ?? 0;
    const expectedOffset = 6 + 2 * groutWidth;
    const maxH = region.heightCm;

    // For uniform walls, polygon is a rectangle
    // Floor vertices (bottom) should be at maxH - offset
    // Ceiling vertices (top) should be at 0
    expect(region.polygonVertices[0].y).toBe(maxH - expectedOffset); // floor-left
    expect(region.polygonVertices[1].y).toBe(maxH - expectedOffset); // floor-right
    expect(region.polygonVertices[2].y).toBe(0); // ceiling-right
    expect(region.polygonVertices[3].y).toBe(0); // ceiling-left
  });

  it("polygon floor vertices are shifted for sloped walls", () => {
    // Create a sloped wall
    wall.heightStartCm = 200;
    wall.heightEndCm = 250;

    const region = wallSurfaceToTileableRegion(wall, 0, { room, floor });
    expect(region).toBeTruthy();

    const groutWidth = wall.surfaces[0]?.grout?.widthCm ?? 0;
    const expectedOffset = 6 + 2 * groutWidth;
    const maxH = Math.max(200, 250);

    // For sloped walls, floor vertices get offset, ceiling vertices are based on slope
    expect(region.polygonVertices[0].y).toBe(maxH - expectedOffset); // floor-left
    expect(region.polygonVertices[1].y).toBe(maxH - expectedOffset); // floor-right
    // Ceiling vertices should NOT have offset applied (they're based on slope)
    expect(region.polygonVertices[2].y).toBe(maxH - 250); // ceiling-right
    expect(region.polygonVertices[3].y).toBe(maxH - 200); // ceiling-left
  });

  it("returns skirtingOffset = 0 when skirting is disabled", () => {
    room.skirting.enabled = false;
    const region = wallSurfaceToTileableRegion(wall, 0, { room, floor });
    expect(region).toBeTruthy();
    expect(region.skirtingOffset).toBe(0);

    // Polygon should be unchanged (floor at maxH, ceiling at 0)
    const maxH = region.heightCm;
    expect(region.polygonVertices[0].y).toBe(maxH);
    expect(region.polygonVertices[1].y).toBe(maxH);
  });

  it("handles different grout widths correctly", () => {
    // Set grout width on surface
    wall.surfaces[0].grout = { widthCm: 0.5, colorHex: "#ffffff" };

    const region = wallSurfaceToTileableRegion(wall, 0, { room, floor });
    expect(region).toBeTruthy();

    const expectedOffset = 6 + 2 * 0.5; // 7.0
    expect(region.skirtingOffset).toBe(expectedOffset);
  });

  it("end-to-end: sync and compute offset", () => {
    // Sync walls (already done in beforeEach)
    syncFloorWalls(floor);

    // Get wall and call with context
    const testWall = floor.walls[0];
    const region = wallSurfaceToTileableRegion(testWall, 0, { room, floor });

    expect(region).toBeTruthy();
    expect(region.skirtingOffset).toBeGreaterThan(0);

    // Verify polygon integrity
    expect(region.polygonVertices).toHaveLength(4);
    expect(region.polygonVertices[0].y).toBeLessThan(region.heightCm);
  });
});

describe("wallSurfaceToTileableRegion backward compatibility", () => {
  let floor, room, wall;

  beforeEach(() => {
    room = makeRoom("room1", 0, 0, 400, 300);

    floor = {
      id: "floor1",
      name: "Floor 1",
      rooms: [room],
      walls: []
    };

    syncFloorWalls(floor);
    wall = floor.walls[0];
  });

  it("works without options parameter (legacy call)", () => {
    const region = wallSurfaceToTileableRegion(wall, 0);
    expect(region).toBeTruthy();
    expect(region.skirtingOffset).toBe(0);
    expect(region.polygonVertices).toBeTruthy();
    expect(region.widthCm).toBeGreaterThan(0);
    expect(region.heightCm).toBeGreaterThan(0);
  });

  it("polygon is unchanged without skirting", () => {
    const legacyRegion = wallSurfaceToTileableRegion(wall, 0);
    const newRegion = wallSurfaceToTileableRegion(wall, 0, {});

    expect(legacyRegion.polygonVertices).toEqual(newRegion.polygonVertices);
    expect(legacyRegion.skirtingOffset).toBe(newRegion.skirtingOffset);
  });
});
