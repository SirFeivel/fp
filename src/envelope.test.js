import { describe, it, expect } from "vitest";
import { matchEdgeToEnvelope, classifyRoomEdges, assignWallTypesFromClassification, extendSkeletonForRoom, recomputeEnvelope, alignToEnvelope, syncFloorWallsAndEnvelope } from "./envelope.js";
import { DEFAULT_WALL_TYPES } from "./floor-plan-rules.js";
import { syncFloorWalls } from "./walls.js";

// ── matchEdgeToEnvelope ─────────────────────────────────────────────

describe("matchEdgeToEnvelope", () => {
  // Simple rectangular envelope: 0,0 → 1000,0 → 1000,800 → 0,800
  const envelope = [
    { x: 0, y: 0 },
    { x: 1000, y: 0 },
    { x: 1000, y: 800 },
    { x: 0, y: 800 },
  ];

  it("matches a room edge that lies on an envelope edge", () => {
    // Room edge along the top wall (edge 0: 0,0 → 1000,0)
    const result = matchEdgeToEnvelope(
      { x: 100, y: 0 },
      { x: 500, y: 0 },
      envelope,
    );
    expect(result).not.toBeNull();
    expect(result.envelopeEdgeIndex).toBe(0);
    expect(result.overlapCm).toBeCloseTo(400, 0);
    expect(result.perpDistCm).toBeCloseTo(0, 1);
  });

  it("matches a room edge slightly inside the envelope (within tolerance)", () => {
    // Room edge 3cm inside the top wall
    const result = matchEdgeToEnvelope(
      { x: 100, y: 3 },
      { x: 500, y: 3 },
      envelope,
    );
    expect(result).not.toBeNull();
    expect(result.envelopeEdgeIndex).toBe(0);
    expect(result.perpDistCm).toBeCloseTo(3, 1);
  });

  it("returns null when edge is parallel but too far away", () => {
    // Room edge 50cm away from the top wall (beyond default tolerance of 6cm)
    const result = matchEdgeToEnvelope(
      { x: 100, y: 50 },
      { x: 500, y: 50 },
      envelope,
    );
    expect(result).toBeNull();
  });

  it("returns null when edge is at wrong angle", () => {
    // Diagonal edge — not parallel to any envelope edge
    const result = matchEdgeToEnvelope(
      { x: 100, y: 100 },
      { x: 300, y: 300 },
      envelope,
    );
    expect(result).toBeNull();
  });

  it("returns null when edge is parallel but no overlap", () => {
    // Room edge parallel to top wall but outside the envelope horizontally
    const result = matchEdgeToEnvelope(
      { x: 1100, y: 0 },
      { x: 1500, y: 0 },
      envelope,
    );
    expect(result).toBeNull();
  });

  it("computes correct overlap for partial coverage", () => {
    // Room edge extends beyond envelope on one side
    const result = matchEdgeToEnvelope(
      { x: -100, y: 0 },
      { x: 500, y: 0 },
      envelope,
    );
    expect(result).not.toBeNull();
    expect(result.envelopeEdgeIndex).toBe(0);
    // Overlap is from 0 to 500 on room edge axis = clamped by envelope start
    // Room edge goes from -100 to 500 (length 600). Envelope edge 0→1000.
    // Project envelope onto room edge: t1 = 100 (0,0 - (-100,0) projected), t2 = 600 (1000,0)
    // Overlap: max(0, min(100,600)) to min(600, max(100,600)) = 100 to 600 = 500
    expect(result.overlapCm).toBeCloseTo(500, 0);
  });

  it("matches the right edge (vertical)", () => {
    // Room edge along the right wall (edge 1: 1000,0 → 1000,800)
    const result = matchEdgeToEnvelope(
      { x: 1000, y: 100 },
      { x: 1000, y: 600 },
      envelope,
    );
    expect(result).not.toBeNull();
    expect(result.envelopeEdgeIndex).toBe(1);
    expect(result.overlapCm).toBeCloseTo(500, 0);
  });

  it("returns null for a degenerate (zero-length) room edge", () => {
    const result = matchEdgeToEnvelope(
      { x: 100, y: 0 },
      { x: 100, y: 0 },
      envelope,
    );
    expect(result).toBeNull();
  });

  it("returns null for a degenerate envelope", () => {
    const result = matchEdgeToEnvelope(
      { x: 100, y: 0 },
      { x: 500, y: 0 },
      [{ x: 0, y: 0 }],
    );
    expect(result).toBeNull();
  });

  it("picks the envelope edge with the largest overlap when multiple match", () => {
    // L-shaped envelope where two horizontal edges could match
    const lEnvelope = [
      { x: 0, y: 0 },
      { x: 600, y: 0 },
      { x: 600, y: 400 },
      { x: 400, y: 400 },
      { x: 400, y: 800 },
      { x: 0, y: 800 },
    ];
    // Room edge along y=0 covering 0→500 — overlaps edge 0 (0,0→600,0)
    const result = matchEdgeToEnvelope(
      { x: 0, y: 0 },
      { x: 500, y: 0 },
      lEnvelope,
    );
    expect(result).not.toBeNull();
    expect(result.envelopeEdgeIndex).toBe(0);
    expect(result.overlapCm).toBeCloseTo(500, 0);
  });

  it("matches a room inner edge ~wallThickness away from envelope outer edge", () => {
    // Room inner edge at y=30, envelope outer edge at y=0, wall thickness=30cm
    const wallThicknessEdges = [
      { edgeIndex: 0, thicknessCm: 30 },
      { edgeIndex: 1, thicknessCm: 30 },
      { edgeIndex: 2, thicknessCm: 30 },
      { edgeIndex: 3, thicknessCm: 30 },
    ];
    const result = matchEdgeToEnvelope(
      { x: 100, y: 30 },
      { x: 500, y: 30 },
      envelope,
      undefined,
      wallThicknessEdges,
    );
    expect(result).not.toBeNull();
    expect(result.envelopeEdgeIndex).toBe(0);
    expect(result.perpDistCm).toBeCloseTo(30, 1);
    expect(result.overlapCm).toBeCloseTo(400, 0);
  });

  it("still rejects edge beyond wallThickness + tolerance", () => {
    const wallThicknessEdges = [
      { edgeIndex: 0, thicknessCm: 30 },
    ];
    // Edge at y=40 with wall thickness 30 + tolerance 6 = 36 max → 40 > 36 → no match
    const result = matchEdgeToEnvelope(
      { x: 100, y: 40 },
      { x: 500, y: 40 },
      envelope,
      undefined,
      wallThicknessEdges,
    );
    expect(result).toBeNull();
  });
});

// ── classifyRoomEdges ───────────────────────────────────────────────

describe("classifyRoomEdges", () => {
  // Rectangular envelope: 0,0 → 1000,0 → 1000,800 → 0,800
  const envelopePoly = [
    { x: 0, y: 0 },
    { x: 1000, y: 0 },
    { x: 1000, y: 800 },
    { x: 0, y: 800 },
  ];

  it("classifies a corner room: 2 envelope, 2 interior", () => {
    // Room in top-left corner: 0,0 → 400,0 → 400,300 → 0,300
    const room = {
      id: "r1",
      polygonVertices: [
        { x: 0, y: 0 },
        { x: 400, y: 0 },
        { x: 400, y: 300 },
        { x: 0, y: 300 },
      ],
      floorPosition: { x: 0, y: 0 },
    };
    const floor = {
      layout: { envelope: { polygonCm: envelopePoly } },
      rooms: [room],
    };

    const result = classifyRoomEdges(room, floor);
    expect(result).toHaveLength(4);

    // Edge 0: 0,0→400,0 — lies on envelope edge 0 (0,0→1000,0)
    expect(result[0].type).toBe("envelope");

    // Edge 1: 400,0→400,300 — interior (not on any envelope edge)
    expect(result[1].type).toBe("interior");

    // Edge 2: 400,300→0,300 — interior
    expect(result[2].type).toBe("interior");

    // Edge 3: 0,300→0,0 — lies on envelope edge 3→0 (0,800→0,0)
    expect(result[3].type).toBe("envelope");
  });

  it("classifies a room edge as shared when another room is adjacent", () => {
    const room1 = {
      id: "r1",
      polygonVertices: [
        { x: 0, y: 0 },
        { x: 400, y: 0 },
        { x: 400, y: 300 },
        { x: 0, y: 300 },
      ],
      floorPosition: { x: 0, y: 0 },
    };
    const room2 = {
      id: "r2",
      polygonVertices: [
        { x: 0, y: 0 },
        { x: 400, y: 0 },
        { x: 400, y: 300 },
        { x: 0, y: 300 },
      ],
      floorPosition: { x: 400, y: 0 }, // room2 is right of room1
    };
    const floor = {
      layout: { envelope: { polygonCm: envelopePoly } },
      rooms: [room1, room2],
    };

    const result = classifyRoomEdges(room1, floor);
    // Edge 1: 400,0→400,300 — shared with room2's edge 3 (0,300→0,0 at floorPos 400,0)
    expect(result[1].type).toBe("shared");
    expect(result[1].sharedMatches.length).toBeGreaterThan(0);
  });

  it("classifies a room edge as spanning when it coincides with a spanning wall", () => {
    const room = {
      id: "r1",
      polygonVertices: [
        { x: 0, y: 0 },
        { x: 400, y: 0 },
        { x: 400, y: 300 },
        { x: 0, y: 300 },
      ],
      floorPosition: { x: 0, y: 0 },
    };
    const floor = {
      layout: {
        envelope: {
          polygonCm: envelopePoly,
          spanningWalls: [
            { startCm: { x: 400, y: 0 }, endCm: { x: 400, y: 800 }, thicknessCm: 24 },
          ],
        },
      },
      rooms: [room],
    };

    const result = classifyRoomEdges(room, floor);
    // Edge 1: 400,0→400,300 — coincides with spanning wall
    expect(result[1].type).toBe("spanning");
  });

  it("classifies a room extending beyond envelope as extending", () => {
    // Room wider than envelope
    const room = {
      id: "r1",
      polygonVertices: [
        { x: 0, y: 0 },
        { x: 1200, y: 0 },  // extends 200cm beyond envelope right edge
        { x: 1200, y: 300 },
        { x: 0, y: 300 },
      ],
      floorPosition: { x: 0, y: 0 },
    };
    const floor = {
      layout: { envelope: { polygonCm: envelopePoly } },
      rooms: [room],
    };

    const result = classifyRoomEdges(room, floor);
    // Edge 0: 0,0→1200,0 — on envelope top edge but extends beyond
    expect(result[0].type).toBe("extending");
  });

  it("returns empty array for room with no vertices", () => {
    const room = { id: "r1", polygonVertices: [], floorPosition: { x: 0, y: 0 } };
    const floor = { layout: { envelope: { polygonCm: envelopePoly } }, rooms: [room] };
    expect(classifyRoomEdges(room, floor)).toEqual([]);
  });

  it("works without an envelope (all interior)", () => {
    const room = {
      id: "r1",
      polygonVertices: [
        { x: 0, y: 0 },
        { x: 400, y: 0 },
        { x: 400, y: 300 },
        { x: 0, y: 300 },
      ],
      floorPosition: { x: 0, y: 0 },
    };
    const floor = { rooms: [room] };

    const result = classifyRoomEdges(room, floor);
    expect(result).toHaveLength(4);
    for (const e of result) {
      expect(e.type).toBe("interior");
    }
  });

  it("classifies corner room with realistic wall-thickness offset as envelope edges", () => {
    // Envelope outer boundary: 0,0 → 1000,0 → 1000,800 → 0,800
    // Room inner edges offset inward by ~30cm wall thickness
    // Room at floorPos (30,30): inner verts 0,0→940,0→940,740→0,740
    // Global: (30,30)→(970,30)→(970,770)→(30,770)
    // Distance to envelope top (y=0): 30cm = wall thickness → should match
    const room = {
      id: "r1",
      polygonVertices: [
        { x: 0, y: 0 },
        { x: 940, y: 0 },
        { x: 940, y: 740 },
        { x: 0, y: 740 },
      ],
      floorPosition: { x: 30, y: 30 },
    };
    const floor = {
      layout: {
        envelope: {
          detectedPolygonCm: envelopePoly,
          wallThicknesses: {
            edges: [
              { edgeIndex: 0, thicknessCm: 30 },
              { edgeIndex: 1, thicknessCm: 30 },
              { edgeIndex: 2, thicknessCm: 30 },
              { edgeIndex: 3, thicknessCm: 30 },
            ],
          },
        },
      },
      rooms: [room],
    };

    const result = classifyRoomEdges(room, floor);
    expect(result).toHaveLength(4);
    // All 4 edges should be "envelope" — each is exactly 30cm from an envelope edge
    expect(result[0].type).toBe("envelope"); // top: y=30, env y=0, dist=30
    expect(result[1].type).toBe("envelope"); // right: x=970, env x=1000, dist=30
    expect(result[2].type).toBe("envelope"); // bottom: y=770, env y=800, dist=30
    expect(result[3].type).toBe("envelope"); // left: x=30, env x=0, dist=30
  });
});

// ── assignWallTypesFromClassification ───────────────────────────────

describe("assignWallTypesFromClassification", () => {
  function makeWall(roomId, edgeIndex, thicknessCm = 12) {
    return {
      id: `w-${roomId}-${edgeIndex}`,
      start: { x: 0, y: 0 },
      end: { x: 100, y: 0 },
      thicknessCm,
      heightStartCm: 240,
      heightEndCm: 240,
      roomEdge: { roomId, edgeIndex },
      doorways: [],
      surfaces: [],
    };
  }

  it("sets envelope edge wall thickness from envelope wallThicknesses", () => {
    const room = { id: "r1" };
    const walls = [makeWall("r1", 0), makeWall("r1", 1)];
    const floor = {
      walls,
      layout: {
        envelope: {
          polygonCm: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 800 }, { x: 0, y: 800 }],
          wallThicknesses: {
            edges: [
              { edgeIndex: 0, thicknessCm: 29 },  // should snap to 30 (outer)
              { edgeIndex: 1, thicknessCm: 23 },  // should snap to 24 (structural)
            ],
          },
        },
        wallDefaults: { types: DEFAULT_WALL_TYPES },
      },
    };

    const classifications = [
      { type: "envelope", envelopeMatch: { envelopeEdgeIndex: 0 } },
      { type: "envelope", envelopeMatch: { envelopeEdgeIndex: 1 } },
    ];

    assignWallTypesFromClassification(floor, room, classifications);

    expect(walls[0].thicknessCm).toBe(30);   // outer
    expect(walls[1].thicknessCm).toBe(24);   // structural
  });

  it("sets spanning wall thickness from spanning wall data", () => {
    const room = { id: "r1" };
    const walls = [makeWall("r1", 0)];
    const floor = {
      walls,
      layout: {
        envelope: {
          spanningWalls: [
            { startCm: { x: 400, y: 0 }, endCm: { x: 400, y: 800 }, thicknessCm: 23 },
          ],
        },
        wallDefaults: { types: DEFAULT_WALL_TYPES },
      },
    };

    const classifications = [
      { type: "spanning", spanningMatch: { spanningWallIndex: 0 } },
    ];

    assignWallTypesFromClassification(floor, room, classifications);
    expect(walls[0].thicknessCm).toBe(24);  // snapped structural
  });

  it("sets shared wall to partition thickness", () => {
    const room = { id: "r1" };
    const walls = [makeWall("r1", 0, 24)];
    const floor = {
      walls,
      layout: {
        wallDefaults: { types: DEFAULT_WALL_TYPES },
      },
    };

    const classifications = [
      { type: "shared", sharedMatches: [{}] },
    ];

    assignWallTypesFromClassification(floor, room, classifications);
    expect(walls[0].thicknessCm).toBe(11.5);  // partition (thinnest)
  });

  it("does not crash when wall is not found", () => {
    const room = { id: "r1" };
    const floor = { walls: [], layout: {} };
    const classifications = [{ type: "envelope", envelopeMatch: { envelopeEdgeIndex: 0 } }];

    // Should not throw
    assignWallTypesFromClassification(floor, room, classifications);
  });
});

// ── extendSkeletonForRoom ───────────────────────────────────────────

describe("extendSkeletonForRoom", () => {
  function makeDetectedEnvelope() {
    return [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 800 },
      { x: 0, y: 800 },
    ];
  }

  it("does not change polygonCm when room is within skeleton", () => {
    const poly = makeDetectedEnvelope();
    const floor = {
      rooms: [],
      walls: [],
      layout: {
        envelope: {
          detectedPolygonCm: makeDetectedEnvelope(),
          polygonCm: poly,
        },
      },
    };

    const room = {
      id: "r1",
      polygonVertices: [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
        { x: 200, y: 150 },
        { x: 0, y: 150 },
      ],
      floorPosition: { x: 100, y: 100 },
    };

    // All edges classified as "envelope" (within boundary), none extending
    const classifications = [
      { type: "envelope", envelopeMatch: { envelopeEdgeIndex: 0, overlapCm: 200 } },
      { type: "interior" },
      { type: "interior" },
      { type: "interior" },
    ];

    extendSkeletonForRoom(floor, room, classifications);

    // polygonCm should be unchanged
    expect(poly[0]).toEqual({ x: 0, y: 0 });
    expect(poly[1]).toEqual({ x: 1000, y: 0 });
    expect(poly[2]).toEqual({ x: 1000, y: 800 });
    expect(poly[3]).toEqual({ x: 0, y: 800 });
  });

  it("extends one edge endpoint when room overshoots", () => {
    // Envelope bottom edge: (0,800) → (0,0) is edge 3.
    // Actually let's use the top edge (0,0)→(1000,0) = edge 0.
    // Room at floorPos (950, 30) with width 55 → room edge from x=950 to x=1005.
    // Room edge 0 (top): globalA=(950,30), globalB=(1005,30)
    // This overshoots envelope edge 0 end (x=1000) by 5cm.
    const poly = makeDetectedEnvelope();
    const floor = {
      rooms: [],
      walls: [],
      layout: {
        envelope: {
          detectedPolygonCm: makeDetectedEnvelope(),
          polygonCm: poly,
        },
      },
    };

    const room = {
      id: "r1",
      polygonVertices: [
        { x: 0, y: 0 },
        { x: 55, y: 0 },
        { x: 55, y: 100 },
        { x: 0, y: 100 },
      ],
      floorPosition: { x: 950, y: 30 },
    };

    // Edge 0 (top of room) classified as extending envelope edge 0
    const classifications = [
      { type: "extending", envelopeMatch: { envelopeEdgeIndex: 0, overlapCm: 50 } },
      { type: "interior" },
      { type: "interior" },
      { type: "interior" },
    ];

    extendSkeletonForRoom(floor, room, classifications);

    // Envelope edge 0 end vertex (index 1) should move from x=1000 to x=1005
    expect(poly[1].x).toBeCloseTo(1005, 1);
    expect(poly[1].y).toBeCloseTo(0, 1);
    // Start vertex unchanged
    expect(poly[0]).toEqual({ x: 0, y: 0 });
    // Edge count preserved
    expect(poly.length).toBe(4);
  });

  it("extends corner (two edges) with shared vertex", () => {
    // Room at top-right corner, extending both edge 0 (top) and edge 1 (right)
    const poly = makeDetectedEnvelope();
    const floor = {
      rooms: [],
      walls: [],
      layout: {
        envelope: {
          detectedPolygonCm: makeDetectedEnvelope(),
          polygonCm: poly,
        },
      },
    };

    const room = {
      id: "r1",
      polygonVertices: [
        { x: 0, y: 0 },
        { x: 60, y: 0 },
        { x: 60, y: 100 },
        { x: 0, y: 100 },
      ],
      floorPosition: { x: 970, y: 30 },
    };

    // Edge 0 (top): global (970,30)→(1030,30) overshoots edge 0 end by ~30cm
    // Edge 1 (right): global (1030,30)→(1030,130) overshoots edge 1 start
    //   Edge 1 of envelope: (1000,0)→(1000,800), direction=(0,1)
    //   Room right edge global: (1030,30)→(1030,130) — but perpDist=30 so
    //   we need to use a classification that says it matched edge 1.
    const classifications = [
      { type: "extending", envelopeMatch: { envelopeEdgeIndex: 0, overlapCm: 30 } },
      { type: "extending", envelopeMatch: { envelopeEdgeIndex: 1, overlapCm: 100 } },
      { type: "interior" },
      { type: "interior" },
    ];

    extendSkeletonForRoom(floor, room, classifications);

    // Edge 0 end (vertex 1) extended rightward: x moves from 1000 to 1030
    expect(poly[1].x).toBeCloseTo(1030, 1);
    // Edge 1 is (vertex1)→(vertex2), room projects from y=30 to y=130
    // Neither extends beyond y=0 (start) or y=800 (end) along edge 1's direction,
    // but vertex1.x moved from 1000→1030, breaking vertical alignment of edge 1.
    // Propagation moves vertex2.x to 1030 to maintain axis alignment.
    expect(poly[2]).toEqual({ x: 1030, y: 800 });
    // Edge count preserved
    expect(poly.length).toBe(4);
  });

  it("preserves wallThicknesses indices (edge count stable)", () => {
    const poly = makeDetectedEnvelope();
    const wallThicknesses = {
      edges: [
        { edgeIndex: 0, thicknessCm: 30 },
        { edgeIndex: 1, thicknessCm: 30 },
        { edgeIndex: 2, thicknessCm: 30 },
        { edgeIndex: 3, thicknessCm: 30 },
      ],
    };
    const floor = {
      rooms: [],
      walls: [],
      layout: {
        envelope: {
          detectedPolygonCm: makeDetectedEnvelope(),
          polygonCm: poly,
          wallThicknesses,
        },
      },
    };

    const room = {
      id: "r1",
      polygonVertices: [
        { x: 0, y: 0 },
        { x: 55, y: 0 },
        { x: 55, y: 100 },
        { x: 0, y: 100 },
      ],
      floorPosition: { x: 950, y: 30 },
    };

    const classifications = [
      { type: "extending", envelopeMatch: { envelopeEdgeIndex: 0, overlapCm: 50 } },
      { type: "interior" },
      { type: "interior" },
      { type: "interior" },
    ];

    extendSkeletonForRoom(floor, room, classifications);

    // Edge count unchanged — wallThicknesses indices still valid
    expect(poly.length).toBe(4);
    expect(wallThicknesses.edges.length).toBe(4);
    expect(wallThicknesses.edges[0].edgeIndex).toBe(0);
    expect(wallThicknesses.edges[1].edgeIndex).toBe(1);
  });

  it("large extension propagates to adjacent vertex to maintain axis alignment", () => {
    // Envelope: rectangle (0,0)→(1000,0)→(1000,800)→(0,800)
    const poly = makeDetectedEnvelope();
    const floor = {
      rooms: [],
      walls: [],
      layout: {
        envelope: {
          detectedPolygonCm: makeDetectedEnvelope(),
          polygonCm: poly,
          wallThicknesses: { edges: [
            { edgeIndex: 0, thicknessCm: 30 },
            { edgeIndex: 1, thicknessCm: 30 },
            { edgeIndex: 2, thicknessCm: 30 },
            { edgeIndex: 3, thicknessCm: 30 },
          ]},
        },
      },
    };

    // Room extends 400cm to the right of the envelope's right edge
    const room = {
      id: "r1",
      polygonVertices: [
        { x: 0, y: 0 },
        { x: 500, y: 0 },
        { x: 500, y: 300 },
        { x: 0, y: 300 },
      ],
      floorPosition: { x: 900, y: 100 },
    };

    // Edge 0 (top): global (900,100)→(1400,100), extends edge 0 end by 400cm
    const classifications = [
      { type: "extending", envelopeMatch: { envelopeEdgeIndex: 0, overlapCm: 100 } },
      { type: "interior" },
      { type: "interior" },
      { type: "interior" },
    ];

    extendSkeletonForRoom(floor, room, classifications);

    // Edge 0 end vertex (vertex 1) moved from x=1000 to x=1400
    expect(poly[1].x).toBeCloseTo(1400, 1);
    expect(poly[1].y).toBe(0);

    // Edge 1 was vertical (x=1000). After vertex1.x→1400, propagation
    // moves vertex2.x to 1400 to keep edge 1 vertical.
    expect(poly[2].x).toBeCloseTo(1400, 1);
    expect(poly[2].y).toBe(800);

    // Edge count preserved
    expect(poly.length).toBe(4);
  });

  it("small extension (< 0.5cm) does not trigger propagation", () => {
    const poly = makeDetectedEnvelope();
    const floor = {
      rooms: [],
      walls: [],
      layout: {
        envelope: {
          detectedPolygonCm: makeDetectedEnvelope(),
          polygonCm: poly,
          wallThicknesses: { edges: [
            { edgeIndex: 0, thicknessCm: 30 },
            { edgeIndex: 1, thicknessCm: 30 },
            { edgeIndex: 2, thicknessCm: 30 },
            { edgeIndex: 3, thicknessCm: 30 },
          ]},
        },
      },
    };

    // Room extends only 0.3cm beyond envelope right edge
    const room = {
      id: "r1",
      polygonVertices: [
        { x: 0, y: 0 },
        { x: 100.3, y: 0 },
        { x: 100.3, y: 200 },
        { x: 0, y: 200 },
      ],
      floorPosition: { x: 900, y: 100 },
    };

    // Edge 0 (top): global (900,100)→(1000.3,100), extends edge 0 end by 0.3cm
    const classifications = [
      { type: "extending", envelopeMatch: { envelopeEdgeIndex: 0, overlapCm: 100 } },
      { type: "interior" },
      { type: "interior" },
      { type: "interior" },
    ];

    extendSkeletonForRoom(floor, room, classifications);

    // Edge 0 end vertex moves by 0.3cm — very small
    expect(poly[1].x).toBeCloseTo(1000.3, 1);
    expect(poly[1].y).toBe(0);

    // Edge 1 vertical: dx=0.3 < 0.5 threshold, no propagation
    // vertex 2 stays at original position
    expect(poly[2].x).toBe(1000);
    expect(poly[2].y).toBe(800);

    expect(poly.length).toBe(4);
  });
});

// ── recomputeEnvelope ───────────────────────────────────────────────

describe("recomputeEnvelope", () => {
  function makeWall(roomId, edgeIndex, thicknessCm = 12) {
    return {
      id: `w-${roomId}-${edgeIndex}`,
      start: { x: 0, y: 0 },
      end: { x: 100, y: 0 },
      thicknessCm,
      heightStartCm: 240,
      heightEndCm: 240,
      roomEdge: { roomId, edgeIndex },
      doorways: [],
      surfaces: [],
    };
  }

  it("with no rooms, envelope equals detected boundary", () => {
    const detected = [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 800 },
      { x: 0, y: 800 },
    ];
    const floor = {
      rooms: [],
      walls: [],
      layout: { envelope: { polygonCm: [...detected] } },
    };

    recomputeEnvelope(floor);

    // detectedPolygonCm should be populated
    expect(floor.layout.envelope.detectedPolygonCm).toBeDefined();
    // polygonCm should still match detected
    expect(floor.layout.envelope.polygonCm).toHaveLength(4);
  });

  it("migrates polygonCm to detectedPolygonCm on first call", () => {
    const detected = [
      { x: 0, y: 0 },
      { x: 500, y: 0 },
      { x: 500, y: 400 },
      { x: 0, y: 400 },
    ];
    const floor = {
      rooms: [],
      walls: [],
      layout: { envelope: { polygonCm: [...detected] } },
    };

    expect(floor.layout.envelope.detectedPolygonCm).toBeUndefined();
    recomputeEnvelope(floor);
    expect(floor.layout.envelope.detectedPolygonCm).toBeDefined();
    expect(floor.layout.envelope.detectedPolygonCm).toHaveLength(4);
  });

  it("with rooms present, recomputeEnvelope is a no-op (skeleton extended incrementally)", () => {
    const detected = [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 800 },
      { x: 0, y: 800 },
    ];
    // polygonCm already extended by extendSkeletonForRoom to x=1005
    const extended = [
      { x: 0, y: 0 },
      { x: 1005, y: 0 },
      { x: 1005, y: 800 },
      { x: 0, y: 800 },
    ];

    const room = {
      id: "r1",
      polygonVertices: [
        { x: 0, y: 0 },
        { x: 400, y: 0 },
        { x: 400, y: 300 },
        { x: 0, y: 300 },
      ],
      floorPosition: { x: 100, y: 100 },
    };

    const floor = {
      rooms: [room],
      walls: [makeWall("r1", 0), makeWall("r1", 1), makeWall("r1", 2), makeWall("r1", 3)],
      layout: {
        envelope: {
          detectedPolygonCm: detected.map(p => ({ ...p })),
          polygonCm: extended.map(p => ({ ...p })),
        },
      },
    };

    recomputeEnvelope(floor);

    // polygonCm should be unchanged — recomputeEnvelope is a no-op when rooms exist
    const poly = floor.layout.envelope.polygonCm;
    expect(poly).toHaveLength(4);
    expect(poly[1].x).toBe(1005);
  });

  it("extendSkeletonForRoom grows envelope when room edge overshoots (replaces polygon union)", () => {
    // Room edge near envelope edge 0 (top: (0,0)→(1000,0)), extending 5cm past x=1000.
    // Room at floorPos (950,30), 55cm wide → room top edge from x=950 to x=1005.
    // perpDist = 30 (within wallThickness=30 + tol=6), so classified "extending".
    const detected = [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 800 },
      { x: 0, y: 800 },
    ];
    const poly = detected.map(p => ({ ...p }));

    const room = {
      id: "r1",
      polygonVertices: [
        { x: 0, y: 0 },
        { x: 55, y: 0 },
        { x: 55, y: 100 },
        { x: 0, y: 100 },
      ],
      floorPosition: { x: 950, y: 30 },
    };

    const floor = {
      rooms: [room],
      walls: [],
      layout: {
        envelope: {
          detectedPolygonCm: detected.map(p => ({ ...p })),
          polygonCm: poly,
        },
      },
    };

    const classifications = [
      { type: "extending", envelopeMatch: { envelopeEdgeIndex: 0, overlapCm: 50 } },
      { type: "interior" },
      { type: "interior" },
      { type: "interior" },
    ];

    extendSkeletonForRoom(floor, room, classifications);

    // Envelope edge 0 end vertex moved from x=1000 to x=1005
    expect(poly[1].x).toBeCloseTo(1005, 1);
    expect(poly.length).toBe(4);
  });

  it("does nothing when no envelope exists", () => {
    const floor = { rooms: [], walls: [], layout: {} };
    recomputeEnvelope(floor);
    // Should not create an envelope
    expect(floor.layout.envelope).toBeUndefined();
  });

  it("skeleton extension preserved when one room deleted, reset when all rooms deleted", () => {
    const detected = [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 800 },
      { x: 0, y: 800 },
    ];

    // polygonCm already extended to x=1005 by extendSkeletonForRoom
    const extended = [
      { x: 0, y: 0 },
      { x: 1005, y: 0 },
      { x: 1005, y: 800 },
      { x: 0, y: 800 },
    ];

    const room1 = {
      id: "r1",
      polygonVertices: [
        { x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 150 }, { x: 0, y: 150 },
      ],
      floorPosition: { x: 100, y: 100 },
    };
    const room2 = {
      id: "r2",
      polygonVertices: [
        { x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 150 }, { x: 0, y: 150 },
      ],
      floorPosition: { x: 400, y: 100 },
    };

    const floor = {
      rooms: [room1, room2],
      walls: [],
      layout: {
        envelope: {
          detectedPolygonCm: detected.map(p => ({ ...p })),
          polygonCm: extended.map(p => ({ ...p })),
        },
      },
    };

    // Delete one room — skeleton stays extended (monotonic)
    floor.rooms = [room2];
    recomputeEnvelope(floor);
    expect(floor.layout.envelope.polygonCm[1].x).toBe(1005);

    // Delete all rooms — reset to detected boundary
    floor.rooms = [];
    recomputeEnvelope(floor);
    const poly = floor.layout.envelope.polygonCm;
    expect(Math.max(...poly.map(p => p.x))).toBe(1000);
  });

  it("syncFloorWalls + recomputeEnvelope together preserve envelope", () => {
    const detected = [
      { x: 0, y: 0 },
      { x: 500, y: 0 },
      { x: 500, y: 400 },
      { x: 0, y: 400 },
    ];

    const room = {
      id: "r1",
      polygonVertices: [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
        { x: 200, y: 150 },
        { x: 0, y: 150 },
      ],
      floorPosition: { x: 50, y: 50 },
    };

    const floor = {
      rooms: [room],
      walls: [],
      layout: {
        envelope: {
          detectedPolygonCm: [...detected.map(p => ({ ...p }))],
          polygonCm: [...detected.map(p => ({ ...p }))],
        },
      },
    };

    // syncFloorWalls creates walls, recomputeEnvelope is no-op with rooms present
    syncFloorWalls(floor);
    recomputeEnvelope(floor);

    expect(floor.layout.envelope.polygonCm).toBeDefined();
    expect(floor.layout.envelope.polygonCm.length).toBe(4);
  });
});

// ── alignToEnvelope ─────────────────────────────────────────────────

describe("alignToEnvelope", () => {
  const envelopePoly = [
    { x: 0, y: 0 },
    { x: 1000, y: 0 },
    { x: 1000, y: 800 },
    { x: 0, y: 800 },
  ];

  it("snaps room edge within tolerance of envelope inner face", () => {
    const envelope = {
      polygonCm: envelopePoly,
      wallThicknesses: {
        edges: [
          { edgeIndex: 0, thicknessCm: 30 },
          { edgeIndex: 1, thicknessCm: 30 },
          { edgeIndex: 2, thicknessCm: 30 },
          { edgeIndex: 3, thicknessCm: 30 },
        ],
      },
    };

    // Room placed 3cm off from the inner face of the left wall
    // Left wall (edge 3: 0,800→0,0) inner face at x = 30
    // Room's left edge at floorPos.x = 33 → delta = 30 - 33 = -3 → snaps
    const verts = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 150 },
      { x: 0, y: 150 },
    ];

    const result = alignToEnvelope(verts, { x: 33, y: 100 }, envelope);
    expect(result.floorPosition.x).toBeCloseTo(30, 0);
  });

  it("does not snap when room is far from envelope edge", () => {
    const envelope = {
      polygonCm: envelopePoly,
      wallThicknesses: { edges: [] },
    };

    const verts = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 150 },
      { x: 0, y: 150 },
    ];

    // Room 100cm from any envelope edge — beyond tolerance
    const result = alignToEnvelope(verts, { x: 100, y: 100 }, envelope);
    expect(result.floorPosition.x).toBe(100);
    expect(result.floorPosition.y).toBe(100);
  });

  it("returns unchanged position when no envelope", () => {
    const verts = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 150 },
      { x: 0, y: 150 },
    ];

    const result = alignToEnvelope(verts, { x: 50, y: 50 }, null);
    expect(result.floorPosition.x).toBe(50);
    expect(result.floorPosition.y).toBe(50);
  });

  it("snaps to envelope without wall thickness when no measurements", () => {
    const envelope = {
      polygonCm: envelopePoly,
      wallThicknesses: { edges: [] },
    };

    // Room's top edge at y=3 (floorPos.y + vertex.y), envelope top at y=0
    // delta = 0 - 3 = -3 → snaps
    const verts = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 150 },
      { x: 0, y: 150 },
    ];

    const result = alignToEnvelope(verts, { x: 100, y: 3 }, envelope);
    expect(result.floorPosition.y).toBeCloseTo(0, 0);
  });
});

// ── recomputeEnvelope collinear merge ─────────────────────────────────

describe("recomputeEnvelope collinear merge", () => {
  function makeWall(roomId, edgeIndex, thicknessCm = 12) {
    return {
      id: `w-${roomId}-${edgeIndex}`,
      start: { x: 0, y: 0 },
      end: { x: 100, y: 0 },
      thicknessCm,
      heightStartCm: 240,
      heightEndCm: 240,
      roomEdge: { roomId, edgeIndex },
      doorways: [],
      surfaces: [],
    };
  }

  it("recomputeEnvelope preserves polygonCm when rooms exist (no-op)", () => {
    // Two adjacent rooms — polygonCm already set correctly by extendSkeletonForRoom
    const detected = [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 800 },
      { x: 0, y: 800 },
    ];

    const room1 = {
      id: "r1",
      polygonVertices: [
        { x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 400 }, { x: 0, y: 400 },
      ],
      floorPosition: { x: 100, y: 100 },
    };

    const floor = {
      rooms: [room1],
      walls: [],
      layout: {
        envelope: {
          detectedPolygonCm: detected.map(p => ({ ...p })),
          polygonCm: detected.map(p => ({ ...p })),
        },
      },
    };

    recomputeEnvelope(floor);
    const poly = floor.layout.envelope.polygonCm;
    // polygonCm preserved as-is (no-op)
    expect(poly.length).toBe(4);
    expect(poly[0]).toEqual({ x: 0, y: 0 });
    expect(poly[1]).toEqual({ x: 1000, y: 0 });
  });

  it("recomputeEnvelope preserves L-shaped polygonCm when rooms exist", () => {
    const detected = [
      { x: 0, y: 0 },
      { x: 600, y: 0 },
      { x: 600, y: 400 },
      { x: 400, y: 400 },
      { x: 400, y: 600 },
      { x: 0, y: 600 },
    ];

    const room = {
      id: "r1",
      polygonVertices: [
        { x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 200 },
        { x: 200, y: 200 }, { x: 200, y: 400 }, { x: 0, y: 400 },
      ],
      floorPosition: { x: 100, y: 100 },
    };

    const floor = {
      rooms: [room],
      walls: [],
      layout: {
        envelope: {
          detectedPolygonCm: detected.map(p => ({ ...p })),
          polygonCm: detected.map(p => ({ ...p })),
        },
      },
    };

    recomputeEnvelope(floor);
    // L-shape preserved as-is
    expect(floor.layout.envelope.polygonCm.length).toBe(6);
  });

  it("recomputeEnvelope preserves triangle polygonCm when rooms exist", () => {
    const detected = [
      { x: 0, y: 0 },
      { x: 500, y: 0 },
      { x: 250, y: 433 },
    ];

    const room = {
      id: "r1",
      polygonVertices: [
        { x: 0, y: 0 }, { x: 300, y: 0 }, { x: 150, y: 260 },
      ],
      floorPosition: { x: 100, y: 100 },
    };

    const floor = {
      rooms: [room],
      walls: [],
      layout: {
        envelope: {
          detectedPolygonCm: detected.map(p => ({ ...p })),
          polygonCm: detected.map(p => ({ ...p })),
          validAngles: [0, 60, 120, 180, 240, 300],
        },
      },
    };

    recomputeEnvelope(floor);
    expect(floor.layout.envelope.polygonCm.length).toBe(3);
  });
});

// ── syncFloorWallsAndEnvelope E2E ─────────────────────────────────────

describe("syncFloorWallsAndEnvelope", () => {
  const detected = [
    { x: 0, y: 0 },
    { x: 1000, y: 0 },
    { x: 1000, y: 800 },
    { x: 0, y: 800 },
  ];
  const wallThicknesses = {
    edges: [
      { edgeIndex: 0, thicknessCm: 29 },
      { edgeIndex: 1, thicknessCm: 29 },
      { edgeIndex: 2, thicknessCm: 29 },
      { edgeIndex: 3, thicknessCm: 29 },
    ],
  };

  it("E2E: add room → wall thicknesses are classified, envelope preserved", () => {
    const room = {
      id: "r1",
      polygonVertices: [
        { x: 0, y: 0 },
        { x: 400, y: 0 },
        { x: 400, y: 300 },
        { x: 0, y: 300 },
      ],
      floorPosition: { x: 30, y: 30 },
    };

    const floor = {
      rooms: [room],
      walls: [],
      layout: {
        envelope: {
          detectedPolygonCm: detected.map(p => ({ ...p })),
          polygonCm: detected.map(p => ({ ...p })),
          wallThicknesses,
        },
        wallDefaults: { types: DEFAULT_WALL_TYPES },
      },
    };

    syncFloorWallsAndEnvelope(floor);

    // Envelope should be clean (4 vertices preserved by no-op recomputeEnvelope)
    const poly = floor.layout.envelope.polygonCm;
    expect(poly).toBeDefined();
    expect(poly.length).toBe(4);

    // Wall thicknesses should be classified (not all default 12cm)
    const wallThicks = floor.walls.map(w => w.thicknessCm);
    // At least one wall should have been classified to outer (30cm)
    const hasOuter = wallThicks.some(t => t === 30);
    expect(hasOuter).toBe(true);
  });

  it("E2E: delete all rooms → envelope returns to detected boundary", () => {
    const room = {
      id: "r1",
      polygonVertices: [
        { x: 0, y: 0 },
        { x: 400, y: 0 },
        { x: 400, y: 300 },
        { x: 0, y: 300 },
      ],
      floorPosition: { x: 30, y: 30 },
    };

    const floor = {
      rooms: [room],
      walls: [],
      layout: {
        envelope: {
          detectedPolygonCm: detected.map(p => ({ ...p })),
          polygonCm: detected.map(p => ({ ...p })),
          wallThicknesses,
        },
        wallDefaults: { types: DEFAULT_WALL_TYPES },
      },
    };

    // Add room
    syncFloorWallsAndEnvelope(floor);
    expect(floor.layout.envelope.polygonCm).toBeDefined();

    // Delete all rooms → reset to detected boundary
    floor.rooms = [];
    syncFloorWallsAndEnvelope(floor);
    const poly = floor.layout.envelope.polygonCm;
    expect(poly.length).toBe(4);
    expect(Math.max(...poly.map(p => p.x))).toBe(1000);
  });

  it("E2E: classification runs for ALL rooms, not just new ones", () => {
    const room1 = {
      id: "r1",
      polygonVertices: [
        { x: 0, y: 0 },
        { x: 400, y: 0 },
        { x: 400, y: 300 },
        { x: 0, y: 300 },
      ],
      floorPosition: { x: 30, y: 30 },
    };
    const room2 = {
      id: "r2",
      polygonVertices: [
        { x: 0, y: 0 },
        { x: 400, y: 0 },
        { x: 400, y: 300 },
        { x: 0, y: 300 },
      ],
      floorPosition: { x: 500, y: 30 },
    };

    const floor = {
      rooms: [room1, room2],
      walls: [],
      layout: {
        envelope: {
          detectedPolygonCm: detected.map(p => ({ ...p })),
          wallThicknesses,
        },
        wallDefaults: { types: DEFAULT_WALL_TYPES },
      },
    };

    syncFloorWallsAndEnvelope(floor);

    // Both rooms should have walls with classified thicknesses
    const r1Walls = floor.walls.filter(w => w.roomEdge?.roomId === "r1");
    const r2Walls = floor.walls.filter(w => w.roomEdge?.roomId === "r2");
    expect(r1Walls.length).toBeGreaterThan(0);
    expect(r2Walls.length).toBeGreaterThan(0);

    // Both rooms should have at least one outer wall (30cm)
    expect(r1Walls.some(w => w.thicknessCm === 30)).toBe(true);
    expect(r2Walls.some(w => w.thicknessCm === 30)).toBe(true);
  });
});
