// src/edge-properties.test.js — Tests for wall geometry helpers
import { describe, it, expect } from "vitest";
import { computeOuterPolygon, getEdgeFreeSegmentsByIndex } from "./floor_geometry.js";

describe("computeOuterPolygon", () => {
  it("rectangle with uniform thickness produces correct mitered outer rectangle", () => {
    // CCW rectangle (in screen coords): (0,0) → (400,0) → (400,300) → (0,300)
    const verts = [
      { x: 0, y: 0 },
      { x: 400, y: 0 },
      { x: 400, y: 300 },
      { x: 0, y: 300 },
    ];
    // Compute signed area: positive for this winding
    const thicknesses = [12, 12, 12, 12];
    const sign = 1; // Positive area → outward normals point out

    const outer = computeOuterPolygon(verts, thicknesses, sign);
    expect(outer).toHaveLength(4);

    // Outer rectangle should be expanded by 12 in all directions
    expect(outer[0].x).toBeCloseTo(-12, 1);
    expect(outer[0].y).toBeCloseTo(-12, 1);
    expect(outer[1].x).toBeCloseTo(412, 1);
    expect(outer[1].y).toBeCloseTo(-12, 1);
    expect(outer[2].x).toBeCloseTo(412, 1);
    expect(outer[2].y).toBeCloseTo(312, 1);
    expect(outer[3].x).toBeCloseTo(-12, 1);
    expect(outer[3].y).toBeCloseTo(312, 1);
  });

  it("mixed thicknesses (0 on shared edges) collapse outer vertices on shared sides", () => {
    // Rectangle with bottom edge shared (thickness = 0), others = 12
    const verts = [
      { x: 0, y: 0 },
      { x: 400, y: 0 },
      { x: 400, y: 300 },
      { x: 0, y: 300 },
    ];
    // Edge 0: top (0→1), Edge 1: right (1→2), Edge 2: bottom (2→3), Edge 3: left (3→0)
    // Top edge (0) is shared → thickness 0
    const thicknesses = [0, 12, 12, 12];
    const sign = 1;

    const outer = computeOuterPolygon(verts, thicknesses, sign);
    expect(outer).toHaveLength(4);

    // Vertex 0: intersection of edge 3 offset (thick=12) and edge 0 offset (thick=0)
    // Edge 3 is (0,300)→(0,0), offset outward by 12 (leftward → x=-12)
    // Edge 0 is (0,0)→(400,0), offset outward by 0 (stays at y=0)
    // Vertex 0 outer should be at (-12, 0) — left wall extends, top doesn't
    expect(outer[0].x).toBeCloseTo(-12, 1);
    expect(outer[0].y).toBeCloseTo(0, 1);

    // Vertex 1: intersection of edge 0 offset (thick=0) and edge 1 offset (thick=12)
    // Edge 0 offset line at y=0, edge 1 offset at x=412
    // Intersection: (412, 0)
    expect(outer[1].x).toBeCloseTo(412, 1);
    expect(outer[1].y).toBeCloseTo(0, 1);

    // Vertex 2: intersection of edge 1 offset (thick=12) and edge 2 offset (thick=12)
    expect(outer[2].x).toBeCloseTo(412, 1);
    expect(outer[2].y).toBeCloseTo(312, 1);

    // Vertex 3: intersection of edge 2 offset (thick=12) and edge 3 offset (thick=12)
    expect(outer[3].x).toBeCloseTo(-12, 1);
    expect(outer[3].y).toBeCloseTo(312, 1);
  });

  it("all zero thicknesses returns same vertices", () => {
    const verts = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const outer = computeOuterPolygon(verts, [0, 0, 0, 0], 1);
    for (let i = 0; i < 4; i++) {
      expect(outer[i].x).toBeCloseTo(verts[i].x, 5);
      expect(outer[i].y).toBeCloseTo(verts[i].y, 5);
    }
  });

  it("handles L-shaped polygon with 6 vertices", () => {
    const verts = [
      { x: 0, y: 0 },
      { x: 300, y: 0 },
      { x: 300, y: 150 },
      { x: 150, y: 150 },
      { x: 150, y: 300 },
      { x: 0, y: 300 },
    ];
    const thicknesses = [10, 10, 10, 10, 10, 10];
    const sign = 1;

    const outer = computeOuterPolygon(verts, thicknesses, sign);
    expect(outer).toHaveLength(6);

    // First vertex should be offset outward by 10 in both x and y (corner)
    expect(outer[0].x).toBeCloseTo(-10, 1);
    expect(outer[0].y).toBeCloseTo(-10, 1);
  });
});

describe("getEdgeFreeSegmentsByIndex", () => {
  it("returns full free segments for a single room (no neighbors)", () => {
    const room = {
      polygonVertices: [
        { x: 0, y: 0 },
        { x: 400, y: 0 },
        { x: 400, y: 300 },
        { x: 0, y: 300 },
      ],
      floorPosition: { x: 0, y: 0 },
    };

    const result = getEdgeFreeSegmentsByIndex(room, []);
    expect(result).toHaveLength(4);
    // Each edge should be fully free
    for (const edgeSegs of result) {
      expect(edgeSegs).toHaveLength(1);
      expect(edgeSegs[0].tStart).toBeCloseTo(0, 2);
      expect(edgeSegs[0].tEnd).toBeCloseTo(1, 2);
    }
  });

  it("detects shared edge between two adjacent rooms", () => {
    // Room A: 0,0 to 400,300
    const roomA = {
      id: "a",
      polygonVertices: [
        { x: 0, y: 0 },
        { x: 400, y: 0 },
        { x: 400, y: 300 },
        { x: 0, y: 300 },
      ],
      floorPosition: { x: 0, y: 0 },
    };

    // Room B: right of A, sharing edge at x=400
    const roomB = {
      id: "b",
      polygonVertices: [
        { x: 0, y: 0 },
        { x: 300, y: 0 },
        { x: 300, y: 300 },
        { x: 0, y: 300 },
      ],
      floorPosition: { x: 400, y: 0 },
    };

    const result = getEdgeFreeSegmentsByIndex(roomA, [roomB]);
    expect(result).toHaveLength(4);

    // Edge 0 (top: 0,0→400,0): fully free
    expect(result[0]).toHaveLength(1);

    // Edge 1 (right: 400,0→400,300): fully shared with roomB's left edge
    expect(result[1]).toHaveLength(0);

    // Edge 2 (bottom: 400,300→0,300): fully free
    expect(result[2]).toHaveLength(1);

    // Edge 3 (left: 0,300→0,0): fully free
    expect(result[3]).toHaveLength(1);
  });

  it("detects partially shared edge", () => {
    // Room A: 0,0 to 400,300
    const roomA = {
      id: "a",
      polygonVertices: [
        { x: 0, y: 0 },
        { x: 400, y: 0 },
        { x: 400, y: 300 },
        { x: 0, y: 300 },
      ],
      floorPosition: { x: 0, y: 0 },
    };

    // Room B: shorter, shares only part of the right edge
    const roomB = {
      id: "b",
      polygonVertices: [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
        { x: 200, y: 150 },
        { x: 0, y: 150 },
      ],
      floorPosition: { x: 400, y: 0 },
    };

    const result = getEdgeFreeSegmentsByIndex(roomA, [roomB]);
    // Edge 1 (right: 400,0→400,300): partially shared (0→150 shared, 150→300 free)
    expect(result[1].length).toBeGreaterThanOrEqual(1);
    // The free portion should be approximately from t=0.5 to t=1
    const freeSeg = result[1][0];
    expect(freeSeg.tStart).toBeCloseTo(0.5, 1);
    expect(freeSeg.tEnd).toBeCloseTo(1, 1);
  });
});
