// src/edge-properties.test.js — Tests for edgeProperties, doorways, sloped walls
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createStateStore } from "./state.js";
import { defaultState, DEFAULT_EDGE_PROPERTIES, uuid, deepClone } from "./core.js";
import { createSurface, unfoldRoomWalls } from "./surface.js";
import { computeOuterPolygon, getEdgeFreeSegmentsByIndex } from "./floor_geometry.js";

function validateStateFn() { return { errors: [], warnings: [] }; }

function makeV11State() {
  const floorId = uuid();
  const roomId = uuid();
  return {
    meta: { version: 11 },
    project: { name: "Test" },
    floors: [{
      id: floorId,
      name: "EG",
      layout: { enabled: false, background: null },
      patternLinking: { enabled: false, globalOrigin: { x: 0, y: 0 } },
      offcutSharing: { enabled: false },
      patternGroups: [],
      rooms: [{
        id: roomId,
        name: "Room 1",
        wallHeightCm: 250,
        polygonVertices: [
          { x: 0, y: 0 },
          { x: 400, y: 0 },
          { x: 400, y: 300 },
          { x: 0, y: 300 },
        ],
        tile: { widthCm: 40, heightCm: 20, shape: "rect", reference: "" },
        grout: { widthCm: 0.2, colorHex: "#ffffff" },
        pattern: { type: "grid", bondFraction: 0.5, rotationDeg: 0, offsetXcm: 0, offsetYcm: 0, origin: { preset: "tl", xCm: 0, yCm: 0 } },
        skirting: { enabled: true, type: "cutout", heightCm: 6, boughtWidthCm: 60, boughtPricePerPiece: 5 },
        exclusions: [],
        excludedTiles: [],
        excludedSkirts: [],
        floorPosition: { x: 0, y: 0 },
        patternLink: { mode: "independent", linkedRoomId: null },
      }]
    }],
    selectedFloorId: floorId,
    selectedRoomId: roomId,
    pricing: { packM2: 1.44, pricePerM2: 39.9, reserveTiles: 0 },
    waste: { allowRotate: true, shareOffcuts: false, optimizeCuts: false, kerfCm: 0.2 },
    view: { showGrid: true, showNeeds: false, showSkirting: true, showFloorTiles: false, showWalls: false, planningMode: "room" },
    tilePresets: [],
    skirtingPresets: [],
  };
}

describe("edgeProperties migration v11→v12", () => {
  it("migrates v11 state and populates edgeProperties on all floor rooms", () => {
    const v11 = makeV11State();
    const store = createStateStore(() => v11, validateStateFn);
    const s = store.getState();

    expect(s.meta.version).toBe(12);
    const room = s.floors[0].rooms[0];
    expect(room.edgeProperties).toBeDefined();
    expect(room.edgeProperties).toHaveLength(4); // 4 vertices = 4 edges
  });

  it("preserves wallHeightCm as heightStartCm/heightEndCm on migrated edges", () => {
    const v11 = makeV11State();
    v11.floors[0].rooms[0].wallHeightCm = 250;
    const store = createStateStore(() => v11, validateStateFn);
    const room = store.getState().floors[0].rooms[0];

    for (const ep of room.edgeProperties) {
      expect(ep.heightStartCm).toBe(250);
      expect(ep.heightEndCm).toBe(250);
      expect(ep.thicknessCm).toBe(12);
      expect(ep.doorways).toEqual([]);
    }
  });

  it("does NOT add edgeProperties to wall surfaces (rooms with sourceRoomId)", () => {
    const v11 = makeV11State();
    // Add a wall surface manually
    const wallId = uuid();
    v11.floors[0].rooms.push({
      id: wallId,
      name: "Wall 1",
      sourceRoomId: v11.floors[0].rooms[0].id,
      wallEdgeIndex: 0,
      polygonVertices: [
        { x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 200 }, { x: 0, y: 200 }
      ],
      tile: { widthCm: 40, heightCm: 20, shape: "rect", reference: "" },
      grout: { widthCm: 0.2, colorHex: "#ffffff" },
      pattern: { type: "grid", bondFraction: 0.5, rotationDeg: 0, offsetXcm: 0, offsetYcm: 0, origin: { preset: "tl", xCm: 0, yCm: 0 } },
      exclusions: [],
      excludedTiles: [],
      excludedSkirts: [],
    });

    const store = createStateStore(() => v11, validateStateFn);
    const wallRoom = store.getState().floors[0].rooms.find(r => r.id === wallId);
    expect(wallRoom.edgeProperties).toBeUndefined();
  });

  it("normalizes edgeProperties length when vertices change", () => {
    const store = createStateStore(defaultState, validateStateFn);
    const state = deepClone(store.getState());

    // Add a room with 4 vertices
    const room = createSurface({ name: "Test", widthCm: 300, heightCm: 200 });
    room.edgeProperties = [
      { thicknessCm: 15, heightStartCm: 200, heightEndCm: 200, doorways: [] },
      { thicknessCm: 12, heightStartCm: 200, heightEndCm: 200, doorways: [] },
    ]; // Intentionally wrong length
    state.floors[0].rooms.push(room);
    state.selectedRoomId = room.id;

    store.commit("add room", state);
    const normalized = store.getState().floors[0].rooms.find(r => r.id === room.id);
    // Normalization should have corrected the length to 4 (matching polygonVertices)
    expect(normalized.edgeProperties).toHaveLength(4);
  });
});

describe("DEFAULT_EDGE_PROPERTIES", () => {
  it("has expected default values", () => {
    expect(DEFAULT_EDGE_PROPERTIES.thicknessCm).toBe(12);
    expect(DEFAULT_EDGE_PROPERTIES.heightStartCm).toBe(200);
    expect(DEFAULT_EDGE_PROPERTIES.heightEndCm).toBe(200);
    expect(DEFAULT_EDGE_PROPERTIES.doorways).toEqual([]);
  });
});

describe("unfoldRoomWalls with uniform heights", () => {
  it("generates rectangular walls for uniform height edges", () => {
    const room = createSurface({ name: "R", widthCm: 400, heightCm: 300 });
    room.edgeProperties = [
      { thicknessCm: 12, heightStartCm: 200, heightEndCm: 200, doorways: [] },
      { thicknessCm: 12, heightStartCm: 200, heightEndCm: 200, doorways: [] },
      { thicknessCm: 12, heightStartCm: 200, heightEndCm: 200, doorways: [] },
      { thicknessCm: 12, heightStartCm: 200, heightEndCm: 200, doorways: [] },
    ];

    const walls = unfoldRoomWalls(room, 200);
    expect(walls).toHaveLength(4);

    for (const wall of walls) {
      expect(wall.sourceRoomId).toBe(room.id);
      expect(wall.polygonVertices).toHaveLength(4);
      // All corners should form a rectangle (uniform height)
      const v = wall.polygonVertices;
      // Bottom-left y and bottom-right y should be same (floor level)
      // Top-left y and top-right y should be same (wall height)
      expect(wall.heightStartCm).toBe(200);
      expect(wall.heightEndCm).toBe(200);
    }
  });
});

describe("unfoldRoomWalls with sloped heights (trapezoid)", () => {
  it("generates trapezoid walls when heightStart !== heightEnd", () => {
    const room = createSurface({ name: "R", widthCm: 400, heightCm: 300 });
    room.edgeProperties = [
      { thicknessCm: 12, heightStartCm: 200, heightEndCm: 150, doorways: [] },
      { thicknessCm: 12, heightStartCm: 150, heightEndCm: 150, doorways: [] },
      { thicknessCm: 12, heightStartCm: 150, heightEndCm: 200, doorways: [] },
      { thicknessCm: 12, heightStartCm: 200, heightEndCm: 200, doorways: [] },
    ];

    const walls = unfoldRoomWalls(room, 200);
    expect(walls).toHaveLength(4);

    // First wall: sloped (200 → 150)
    const wall0 = walls[0];
    expect(wall0.heightStartCm).toBe(200);
    expect(wall0.heightEndCm).toBe(150);

    // Second wall: uniform 150
    const wall1 = walls[1];
    expect(wall1.heightStartCm).toBe(150);
    expect(wall1.heightEndCm).toBe(150);
  });
});

describe("unfoldRoomWalls with doorways", () => {
  it("injects doorway exclusions into wall surfaces", () => {
    const room = createSurface({ name: "R", widthCm: 400, heightCm: 300 });
    room.edgeProperties = [
      {
        thicknessCm: 12,
        heightStartCm: 200,
        heightEndCm: 200,
        doorways: [
          { id: "dw1", offsetCm: 50, widthCm: 80, heightCm: 200 }
        ]
      },
      { thicknessCm: 12, heightStartCm: 200, heightEndCm: 200, doorways: [] },
      { thicknessCm: 12, heightStartCm: 200, heightEndCm: 200, doorways: [] },
      { thicknessCm: 12, heightStartCm: 200, heightEndCm: 200, doorways: [] },
    ];

    const walls = unfoldRoomWalls(room, 200);
    const wall0 = walls[0];

    // Wall 0 should have the doorway exclusion as freeform polygon
    expect(wall0.exclusions).toHaveLength(1);
    expect(wall0.exclusions[0].type).toBe("freeform");
    const v = wall0.exclusions[0].vertices;
    expect(v).toHaveLength(4);
    // For horizontal edge: width along x, height along y
    const exW = Math.hypot(v[1].x - v[0].x, v[1].y - v[0].y);
    const exH = Math.hypot(v[3].x - v[0].x, v[3].y - v[0].y);
    expect(exW).toBeCloseTo(80, 0);
    expect(exH).toBeCloseTo(200, 0);

    // Other walls should have no exclusions
    for (let i = 1; i < walls.length; i++) {
      expect(walls[i].exclusions).toHaveLength(0);
    }
  });

  it("injects multiple doorways on the same edge", () => {
    const room = createSurface({ name: "R", widthCm: 600, heightCm: 300 });
    room.edgeProperties = [
      {
        thicknessCm: 12,
        heightStartCm: 200,
        heightEndCm: 200,
        doorways: [
          { id: "dw1", offsetCm: 50, widthCm: 80, heightCm: 200 },
          { id: "dw2", offsetCm: 300, widthCm: 100, heightCm: 200 }
        ]
      },
      { thicknessCm: 12, heightStartCm: 200, heightEndCm: 200, doorways: [] },
      { thicknessCm: 12, heightStartCm: 200, heightEndCm: 200, doorways: [] },
      { thicknessCm: 12, heightStartCm: 200, heightEndCm: 200, doorways: [] },
    ];

    const walls = unfoldRoomWalls(room, 200);
    expect(walls[0].exclusions).toHaveLength(2);
    expect(walls[0].exclusions[0].type).toBe("freeform");
    expect(walls[0].exclusions[1].type).toBe("freeform");
    // Verify each doorway has 4 vertices
    expect(walls[0].exclusions[0].vertices).toHaveLength(4);
    expect(walls[0].exclusions[1].vertices).toHaveLength(4);
  });
});

describe("edgeProperties sync on vertex operations", () => {
  it("normalization fixes mismatched edgeProperties length", () => {
    const store = createStateStore(defaultState, validateStateFn);
    const state = deepClone(store.getState());

    // Create L-shaped room with 6 vertices
    const room = createSurface({
      name: "L-room",
      polygonVertices: [
        { x: 0, y: 0 },
        { x: 300, y: 0 },
        { x: 300, y: 150 },
        { x: 150, y: 150 },
        { x: 150, y: 300 },
        { x: 0, y: 300 },
      ]
    });
    // Give it wrong number of edgeProperties
    room.edgeProperties = [
      { thicknessCm: 12, heightStartCm: 200, heightEndCm: 200, doorways: [] }
    ];
    state.floors[0].rooms.push(room);
    state.selectedRoomId = room.id;

    store.commit("add L-room", state);
    const normalized = store.getState().floors[0].rooms.find(r => r.id === room.id);
    expect(normalized.edgeProperties).toHaveLength(6);
  });

  it("normalization adds edgeProperties when missing", () => {
    const store = createStateStore(defaultState, validateStateFn);
    const state = deepClone(store.getState());

    const room = createSurface({ name: "Test", widthCm: 300, heightCm: 200 });
    delete room.edgeProperties;
    state.floors[0].rooms.push(room);

    store.commit("add room", state);
    const normalized = store.getState().floors[0].rooms.find(r => r.id === room.id);
    expect(normalized.edgeProperties).toHaveLength(4);
    expect(normalized.edgeProperties[0].thicknessCm).toBe(12);
  });
});

describe("backward compatibility", () => {
  it("rooms without edgeProperties behave identically to before", () => {
    const room = createSurface({ name: "R", widthCm: 400, heightCm: 300 });
    // No edgeProperties set — fallback to uniform heightCm
    delete room.edgeProperties;

    const walls = unfoldRoomWalls(room, 250);
    expect(walls).toHaveLength(4);
    // All walls should use the fallback height
    for (const wall of walls) {
      expect(wall.heightStartCm).toBe(250);
      expect(wall.heightEndCm).toBe(250);
      expect(wall.exclusions).toHaveLength(0);
    }
  });

  it("wallHeightCm on room remains as convenience fallback", () => {
    const store = createStateStore(defaultState, validateStateFn);
    const state = deepClone(store.getState());

    const room = createSurface({ name: "Test", widthCm: 300, heightCm: 200, wallHeightCm: 180 });
    state.floors[0].rooms.push(room);
    state.selectedRoomId = room.id;

    store.commit("add", state);
    const r = store.getState().floors[0].rooms.find(r => r.id === room.id);
    expect(r.wallHeightCm).toBe(180);
    // edgeProperties should use wallHeightCm for defaults
    for (const ep of r.edgeProperties) {
      expect(ep.heightStartCm).toBe(180);
      expect(ep.heightEndCm).toBe(180);
    }
  });
});

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
