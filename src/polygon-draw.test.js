// src/polygon-draw.test.js
// Tests for polygon drawing helper functions (snapping, geometry extraction)

import { describe, it, expect } from "vitest";
import {
  getRoomVertices,
  getRoomEdges,
  findNearestVertex,
  findNearestEdgePoint,
  closestPointOnSegment,
  snapToRoomGeometry,
  snapToGrid,
  SNAP_GRID_CM,
  VERTEX_SNAP_THRESHOLD_CM,
  EDGE_SNAP_THRESHOLD_CM
} from "./polygon-draw.js";

// Helper to create a simple rectangular room with polygonVertices
function createRectRoom(id, x, y, width, height) {
  return {
    id,
    widthCm: width,
    heightCm: height,
    floorPosition: { x, y },
    // polygonVertices are relative to floorPosition
    polygonVertices: [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height }
    ]
  };
}

// Helper to create a freeform room with polygon vertices
function createFreeformRoom(id, vertices, floorX = 0, floorY = 0) {
  const xs = vertices.map(v => v.x);
  const ys = vertices.map(v => v.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);

  return {
    id,
    widthCm: maxX - minX,
    heightCm: maxY - minY,
    floorPosition: { x: floorX, y: floorY },
    polygonVertices: vertices.map(v => ({ x: v.x - minX, y: v.y - minY }))
  };
}

describe("snapToGrid", () => {
  it("snaps to default grid size", () => {
    expect(snapToGrid(1.3)).toBe(1.5);
    expect(snapToGrid(1.2)).toBe(1.0);
    expect(snapToGrid(1.25)).toBe(1.5);
    expect(snapToGrid(0)).toBe(0);
  });

  it("snaps to custom grid size", () => {
    expect(snapToGrid(7, 5)).toBe(5);
    expect(snapToGrid(8, 5)).toBe(10);
    expect(snapToGrid(12.5, 5)).toBe(15);
  });

  it("handles negative values", () => {
    expect(snapToGrid(-1.3)).toBe(-1.5);
    expect(snapToGrid(-1.2)).toBe(-1.0);
  });

  it("handles invalid inputs gracefully", () => {
    expect(snapToGrid(NaN)).toBe(0);
    expect(snapToGrid(Infinity)).toBe(0);
    expect(snapToGrid(null)).toBe(0);
    expect(snapToGrid(undefined)).toBe(0);
    expect(snapToGrid("abc")).toBe(0);
  });

  it("handles invalid grid size", () => {
    expect(snapToGrid(5, 0)).toBe(5);
    expect(snapToGrid(5, -1)).toBe(5);
    expect(snapToGrid(5, NaN)).toBe(5);
  });

  it("exports correct default grid size", () => {
    expect(SNAP_GRID_CM).toBe(0.5);
  });
});

describe("closestPointOnSegment", () => {
  it("finds point on horizontal segment", () => {
    const result = closestPointOnSegment(
      { x: 5, y: 2 },
      { x: 0, y: 0 },
      { x: 10, y: 0 }
    );
    expect(result.x).toBe(5);
    expect(result.y).toBe(0);
    expect(result.t).toBe(0.5);
  });

  it("finds point on vertical segment", () => {
    const result = closestPointOnSegment(
      { x: 3, y: 5 },
      { x: 0, y: 0 },
      { x: 0, y: 10 }
    );
    expect(result.x).toBe(0);
    expect(result.y).toBe(5);
    expect(result.t).toBe(0.5);
  });

  it("clamps to segment start", () => {
    const result = closestPointOnSegment(
      { x: -5, y: 0 },
      { x: 0, y: 0 },
      { x: 10, y: 0 }
    );
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
    expect(result.t).toBe(0);
  });

  it("clamps to segment end", () => {
    const result = closestPointOnSegment(
      { x: 15, y: 0 },
      { x: 0, y: 0 },
      { x: 10, y: 0 }
    );
    expect(result.x).toBe(10);
    expect(result.y).toBe(0);
    expect(result.t).toBe(1);
  });

  it("handles diagonal segments", () => {
    const result = closestPointOnSegment(
      { x: 5, y: 0 },
      { x: 0, y: 0 },
      { x: 10, y: 10 }
    );
    expect(result.x).toBeCloseTo(2.5);
    expect(result.y).toBeCloseTo(2.5);
  });

  it("handles zero-length segment (point)", () => {
    const result = closestPointOnSegment(
      { x: 5, y: 5 },
      { x: 0, y: 0 },
      { x: 0, y: 0 }
    );
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
    expect(result.t).toBe(0);
  });

  it("handles null inputs", () => {
    expect(closestPointOnSegment(null, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeNull();
    expect(closestPointOnSegment({ x: 5, y: 0 }, null, { x: 10, y: 0 })).toBeNull();
    expect(closestPointOnSegment({ x: 5, y: 0 }, { x: 0, y: 0 }, null)).toBeNull();
  });

  it("handles invalid coordinates", () => {
    expect(closestPointOnSegment({ x: NaN, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeNull();
    expect(closestPointOnSegment({ x: 5, y: 0 }, { x: Infinity, y: 0 }, { x: 10, y: 0 })).toBeNull();
  });
});

describe("getRoomVertices", () => {
  it("returns empty array for null floor", () => {
    expect(getRoomVertices(null)).toEqual([]);
  });

  it("returns empty array for floor with no rooms", () => {
    expect(getRoomVertices({ rooms: [] })).toEqual([]);
  });

  it("returns empty array for floor with invalid rooms array", () => {
    expect(getRoomVertices({ rooms: "invalid" })).toEqual([]);
    expect(getRoomVertices({ rooms: null })).toEqual([]);
  });

  it("extracts vertices from rectangular room", () => {
    const floor = {
      rooms: [createRectRoom("room1", 0, 0, 100, 50)]
    };
    const vertices = getRoomVertices(floor);

    expect(vertices.length).toBe(4);
    expect(vertices.every(v => v.roomId === "room1")).toBe(true);

    // Check corners exist (order may vary based on polygon generation)
    const coords = vertices.map(v => `${v.vertex.x},${v.vertex.y}`);
    expect(coords).toContain("0,0");
    expect(coords).toContain("100,0");
    expect(coords).toContain("100,50");
    expect(coords).toContain("0,50");
  });

  it("extracts vertices with floor position offset", () => {
    const floor = {
      rooms: [createRectRoom("room1", 50, 30, 100, 50)]
    };
    const vertices = getRoomVertices(floor);

    expect(vertices.length).toBe(4);
    const coords = vertices.map(v => `${v.vertex.x},${v.vertex.y}`);
    expect(coords).toContain("50,30");
    expect(coords).toContain("150,30");
    expect(coords).toContain("150,80");
    expect(coords).toContain("50,80");
  });

  it("extracts vertices from multiple rooms", () => {
    const floor = {
      rooms: [
        createRectRoom("room1", 0, 0, 100, 50),
        createRectRoom("room2", 100, 0, 80, 50)
      ]
    };
    const vertices = getRoomVertices(floor);

    expect(vertices.length).toBe(8);
    expect(vertices.filter(v => v.roomId === "room1").length).toBe(4);
    expect(vertices.filter(v => v.roomId === "room2").length).toBe(4);
  });

  it("skips rooms with missing id", () => {
    const floor = {
      rooms: [
        { widthCm: 100, heightCm: 50 }, // no id
        createRectRoom("room1", 0, 0, 100, 50)
      ]
    };
    const vertices = getRoomVertices(floor);

    expect(vertices.length).toBe(4);
    expect(vertices.every(v => v.roomId === "room1")).toBe(true);
  });

  it("handles rooms with default floor position", () => {
    const floor = {
      rooms: [{
        id: "room1",
        widthCm: 100,
        heightCm: 50,
        polygonVertices: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 50 },
          { x: 0, y: 50 }
        ]
      }]
    };
    const vertices = getRoomVertices(floor);

    expect(vertices.length).toBe(4);
    const coords = vertices.map(v => `${v.vertex.x},${v.vertex.y}`);
    expect(coords).toContain("0,0");
  });
});

describe("getRoomEdges", () => {
  it("returns empty array for null floor", () => {
    expect(getRoomEdges(null)).toEqual([]);
  });

  it("returns empty array for floor with no rooms", () => {
    expect(getRoomEdges({ rooms: [] })).toEqual([]);
  });

  it("extracts edges from rectangular room", () => {
    const floor = {
      rooms: [createRectRoom("room1", 0, 0, 100, 50)]
    };
    const edges = getRoomEdges(floor);

    expect(edges.length).toBe(4);
    expect(edges.every(e => e.roomId === "room1")).toBe(true);

    // Check that edges form a closed rectangle
    const edgeLengths = edges.map(e =>
      Math.hypot(e.edge.p2.x - e.edge.p1.x, e.edge.p2.y - e.edge.p1.y)
    );
    edgeLengths.sort((a, b) => a - b);
    expect(edgeLengths[0]).toBeCloseTo(50);
    expect(edgeLengths[1]).toBeCloseTo(50);
    expect(edgeLengths[2]).toBeCloseTo(100);
    expect(edgeLengths[3]).toBeCloseTo(100);
  });

  it("extracts edges with floor position offset", () => {
    const floor = {
      rooms: [createRectRoom("room1", 50, 30, 100, 50)]
    };
    const edges = getRoomEdges(floor);

    expect(edges.length).toBe(4);
    // All edge points should be offset
    for (const e of edges) {
      expect(e.edge.p1.x).toBeGreaterThanOrEqual(50);
      expect(e.edge.p1.y).toBeGreaterThanOrEqual(30);
    }
  });

  it("extracts edges from multiple rooms", () => {
    const floor = {
      rooms: [
        createRectRoom("room1", 0, 0, 100, 50),
        createRectRoom("room2", 100, 0, 80, 50)
      ]
    };
    const edges = getRoomEdges(floor);

    expect(edges.length).toBe(8);
    expect(edges.filter(e => e.roomId === "room1").length).toBe(4);
    expect(edges.filter(e => e.roomId === "room2").length).toBe(4);
  });
});

describe("findNearestVertex", () => {
  const vertices = [
    { roomId: "room1", vertex: { x: 0, y: 0 } },
    { roomId: "room1", vertex: { x: 100, y: 0 } },
    { roomId: "room1", vertex: { x: 100, y: 50 } },
    { roomId: "room1", vertex: { x: 0, y: 50 } }
  ];

  it("finds nearest vertex", () => {
    const result = findNearestVertex({ x: 2, y: 1 }, vertices);
    expect(result.vertex).toEqual({ x: 0, y: 0 });
    expect(result.roomId).toBe("room1");
    expect(result.distance).toBeCloseTo(Math.hypot(2, 1));
  });

  it("finds vertex at exact position", () => {
    const result = findNearestVertex({ x: 100, y: 50 }, vertices);
    expect(result.vertex).toEqual({ x: 100, y: 50 });
    expect(result.distance).toBe(0);
  });

  it("returns null for empty vertices array", () => {
    expect(findNearestVertex({ x: 0, y: 0 }, [])).toBeNull();
  });

  it("returns null for null inputs", () => {
    expect(findNearestVertex(null, vertices)).toBeNull();
    expect(findNearestVertex({ x: 0, y: 0 }, null)).toBeNull();
  });

  it("returns null for invalid point coordinates", () => {
    expect(findNearestVertex({ x: NaN, y: 0 }, vertices)).toBeNull();
    expect(findNearestVertex({ x: 0, y: Infinity }, vertices)).toBeNull();
  });

  it("skips vertices with invalid data", () => {
    const mixedVertices = [
      { roomId: "room1", vertex: { x: NaN, y: 0 } },
      { roomId: "room1", vertex: { x: 100, y: 50 } },
      { roomId: null, vertex: { x: 0, y: 0 } }
    ];
    const result = findNearestVertex({ x: 99, y: 49 }, mixedVertices);
    expect(result.vertex).toEqual({ x: 100, y: 50 });
  });

  it("finds correct vertex among multiple rooms", () => {
    const multiRoomVertices = [
      { roomId: "room1", vertex: { x: 0, y: 0 } },
      { roomId: "room2", vertex: { x: 50, y: 50 } }
    ];
    const result = findNearestVertex({ x: 48, y: 52 }, multiRoomVertices);
    expect(result.roomId).toBe("room2");
  });
});

describe("findNearestEdgePoint", () => {
  const edges = [
    { roomId: "room1", edge: { p1: { x: 0, y: 0 }, p2: { x: 100, y: 0 } } },   // top
    { roomId: "room1", edge: { p1: { x: 100, y: 0 }, p2: { x: 100, y: 50 } } }, // right
    { roomId: "room1", edge: { p1: { x: 100, y: 50 }, p2: { x: 0, y: 50 } } },  // bottom
    { roomId: "room1", edge: { p1: { x: 0, y: 50 }, p2: { x: 0, y: 0 } } }      // left
  ];

  it("finds nearest point on horizontal edge", () => {
    const result = findNearestEdgePoint({ x: 50, y: 5 }, edges);
    expect(result.point.x).toBe(50);
    expect(result.point.y).toBe(0);
    expect(result.distance).toBe(5);
    expect(result.roomId).toBe("room1");
  });

  it("finds nearest point on vertical edge", () => {
    const result = findNearestEdgePoint({ x: 95, y: 25 }, edges);
    expect(result.point.x).toBe(100);
    expect(result.point.y).toBe(25);
    expect(result.distance).toBe(5);
  });

  it("snaps to corner when closest to corner", () => {
    const result = findNearestEdgePoint({ x: 2, y: 2 }, edges);
    // Should snap to the nearest point on one of the edges meeting at (0,0)
    expect(result.distance).toBeCloseTo(2);
  });

  it("returns null for empty edges array", () => {
    expect(findNearestEdgePoint({ x: 50, y: 5 }, [])).toBeNull();
  });

  it("returns null for null inputs", () => {
    expect(findNearestEdgePoint(null, edges)).toBeNull();
    expect(findNearestEdgePoint({ x: 50, y: 5 }, null)).toBeNull();
  });

  it("returns null for invalid point coordinates", () => {
    expect(findNearestEdgePoint({ x: NaN, y: 5 }, edges)).toBeNull();
  });

  it("skips edges with invalid data", () => {
    const mixedEdges = [
      { roomId: "room1", edge: { p1: { x: 0, y: 0 }, p2: { x: NaN, y: 0 } } },
      { roomId: "room1", edge: { p1: { x: 0, y: 50 }, p2: { x: 100, y: 50 } } }
    ];
    const result = findNearestEdgePoint({ x: 50, y: 48 }, mixedEdges);
    expect(result.point.y).toBe(50);
  });
});

describe("snapToRoomGeometry", () => {
  const vertices = [
    { roomId: "room1", vertex: { x: 0, y: 0 } },
    { roomId: "room1", vertex: { x: 100, y: 0 } },
    { roomId: "room1", vertex: { x: 100, y: 50 } },
    { roomId: "room1", vertex: { x: 0, y: 50 } }
  ];

  const edges = [
    { roomId: "room1", edge: { p1: { x: 0, y: 0 }, p2: { x: 100, y: 0 } } },
    { roomId: "room1", edge: { p1: { x: 100, y: 0 }, p2: { x: 100, y: 50 } } },
    { roomId: "room1", edge: { p1: { x: 100, y: 50 }, p2: { x: 0, y: 50 } } },
    { roomId: "room1", edge: { p1: { x: 0, y: 50 }, p2: { x: 0, y: 0 } } }
  ];

  it("snaps to vertex when within threshold", () => {
    const result = snapToRoomGeometry({ x: 1, y: 1 }, vertices, edges, null, false);
    expect(result.type).toBe("vertex");
    expect(result.point).toEqual({ x: 0, y: 0 });
    expect(result.roomId).toBe("room1");
  });

  it("snaps to edge when within threshold but not vertex", () => {
    const result = snapToRoomGeometry({ x: 50, y: 1 }, vertices, edges, null, false);
    expect(result.type).toBe("edge");
    expect(result.point.x).toBe(50);
    expect(result.point.y).toBe(0);
    expect(result.roomId).toBe("room1");
  });

  it("falls back to grid snap when outside thresholds", () => {
    const result = snapToRoomGeometry({ x: 50, y: 25 }, vertices, edges, null, false);
    expect(result.type).toBe("grid");
    expect(result.point.x).toBe(50);
    expect(result.point.y).toBe(25);
    expect(result.roomId).toBeUndefined();
  });

  it("prefers vertex over edge when both are close", () => {
    // Point very close to corner
    const result = snapToRoomGeometry({ x: 0.5, y: 0.5 }, vertices, edges, null, false);
    expect(result.type).toBe("vertex");
  });

  it("respects custom thresholds", () => {
    // With very small threshold, should not snap
    const result = snapToRoomGeometry(
      { x: 1, y: 1 },
      vertices,
      edges,
      null,
      false,
      0.5, // vertex threshold
      0.5  // edge threshold
    );
    expect(result.type).toBe("grid");
  });

  it("handles empty vertices array", () => {
    const result = snapToRoomGeometry({ x: 50, y: 1 }, [], edges, null, false);
    expect(result.type).toBe("edge");
  });

  it("handles empty edges array", () => {
    const result = snapToRoomGeometry({ x: 50, y: 25 }, vertices, [], null, false);
    expect(result.type).toBe("grid");
  });

  it("handles null arrays", () => {
    const result = snapToRoomGeometry({ x: 50, y: 25 }, null, null, null, false);
    expect(result.type).toBe("grid");
  });

  it("handles invalid point input", () => {
    const result = snapToRoomGeometry(null, vertices, edges, null, false);
    expect(result.type).toBe("grid");
    expect(result.point).toEqual({ x: 0, y: 0 });
  });

  it("handles NaN coordinates", () => {
    const result = snapToRoomGeometry({ x: NaN, y: 5 }, vertices, edges, null, false);
    expect(result.type).toBe("grid");
  });

  it("exports correct threshold constants", () => {
    expect(VERTEX_SNAP_THRESHOLD_CM).toBe(2);
    expect(EDGE_SNAP_THRESHOLD_CM).toBe(2);
  });
});

describe("integration: vertex and edge extraction", () => {
  it("extracted vertices and edges are compatible with snapping", () => {
    const floor = {
      rooms: [
        createRectRoom("room1", 0, 0, 100, 50),
        createRectRoom("room2", 100, 0, 80, 50)
      ]
    };

    const vertices = getRoomVertices(floor);
    const edges = getRoomEdges(floor);

    // Test snapping to shared corner between rooms
    const result = snapToRoomGeometry({ x: 100, y: 1 }, vertices, edges, null, false);
    expect(result.type).toBe("vertex");
    expect(result.point.x).toBe(100);
    expect(result.point.y).toBe(0);
  });

  it("handles L-shaped freeform room", () => {
    // L-shape: 6 vertices
    const lRoom = createFreeformRoom("lroom", [
      { x: 0, y: 0 },
      { x: 60, y: 0 },
      { x: 60, y: 30 },
      { x: 30, y: 30 },
      { x: 30, y: 60 },
      { x: 0, y: 60 }
    ], 10, 10);

    const floor = { rooms: [lRoom] };
    const vertices = getRoomVertices(floor);
    const edges = getRoomEdges(floor);

    expect(vertices.length).toBe(6);
    expect(edges.length).toBe(6);

    // Test snapping to inner corner of L
    const result = snapToRoomGeometry({ x: 41, y: 41 }, vertices, edges, null, false);
    expect(result.type).toBe("vertex");
    expect(result.point.x).toBe(40); // 30 + 10 offset
    expect(result.point.y).toBe(40); // 30 + 10 offset
  });
});

describe("edge cases and robustness", () => {
  it("handles room with zero dimensions gracefully", () => {
    const floor = {
      rooms: [{ id: "tiny", widthCm: 0, heightCm: 0, floorPosition: { x: 0, y: 0 } }]
    };
    // Should not crash, may return empty or single point
    const vertices = getRoomVertices(floor);
    const edges = getRoomEdges(floor);
    expect(Array.isArray(vertices)).toBe(true);
    expect(Array.isArray(edges)).toBe(true);
  });

  it("handles very large coordinates", () => {
    const floor = {
      rooms: [createRectRoom("big", 0, 0, 100000, 100000)]
    };
    const vertices = getRoomVertices(floor);
    expect(vertices.length).toBe(4);

    const result = findNearestVertex({ x: 99999, y: 99999 }, vertices);
    expect(result.vertex).toEqual({ x: 100000, y: 100000 });
  });

  it("handles negative coordinates", () => {
    const floor = {
      rooms: [createRectRoom("neg", -100, -50, 100, 50)]
    };
    const vertices = getRoomVertices(floor);
    const coords = vertices.map(v => `${v.vertex.x},${v.vertex.y}`);

    expect(coords).toContain("-100,-50");
    expect(coords).toContain("0,0");
  });

  it("handles mixed valid and invalid rooms", () => {
    const floor = {
      rooms: [
        null,
        {
          id: "valid",
          widthCm: 100,
          heightCm: 50,
          polygonVertices: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
            { x: 100, y: 50 },
            { x: 0, y: 50 }
          ]
        },
        undefined,
        { widthCm: 100 }, // missing id
        "invalid"
      ]
    };
    const vertices = getRoomVertices(floor);
    expect(vertices.length).toBe(4);
    expect(vertices.every(v => v.roomId === "valid")).toBe(true);
  });

  it("finds correct edge even with many edges", () => {
    // Create floor with many rooms
    const rooms = [];
    for (let i = 0; i < 10; i++) {
      rooms.push(createRectRoom(`room${i}`, i * 100, 0, 100, 50));
    }
    const floor = { rooms };

    const edges = getRoomEdges(floor);
    expect(edges.length).toBe(40); // 4 edges per room × 10 rooms

    // Find edge on room 5
    const result = findNearestEdgePoint({ x: 550, y: 1 }, edges);
    expect(result.roomId).toBe("room5");
    expect(result.point.x).toBe(550);
    expect(result.point.y).toBe(0);
  });
});
