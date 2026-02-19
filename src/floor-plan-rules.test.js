import { describe, it, expect } from 'vitest';
import { FLOOR_PLAN_RULES, extractValidAngles, rectifyPolygon, expandPolygonOutward, alignToExistingRooms, DEFAULT_WALL_TYPES, DEFAULT_FLOOR_HEIGHT_CM, snapToWallType, classifyWallTypes } from './floor-plan-rules.js';

describe('FLOOR_PLAN_RULES config', () => {
  it('has expected top-level keys', () => {
    expect(FLOOR_PLAN_RULES).toHaveProperty('standardAngles');
    expect(FLOOR_PLAN_RULES).toHaveProperty('maxAngleDeviationDeg');
    expect(FLOOR_PLAN_RULES).toHaveProperty('minEdgeLengthCm');
    expect(FLOOR_PLAN_RULES).toHaveProperty('wallThickness');
    expect(FLOOR_PLAN_RULES).toHaveProperty('alignmentToleranceCm');
    expect(FLOOR_PLAN_RULES).toHaveProperty('mergeGapFactor');
  });

  it('has standard angles covering all four quadrants', () => {
    expect(FLOOR_PLAN_RULES.standardAngles).toEqual([0, 90, 180, 270]);
  });

  it('has sane numeric values', () => {
    expect(FLOOR_PLAN_RULES.maxAngleDeviationDeg).toBeGreaterThan(0);
    expect(FLOOR_PLAN_RULES.maxAngleDeviationDeg).toBeLessThan(45);
    expect(FLOOR_PLAN_RULES.minEdgeLengthCm).toBeGreaterThan(0);
    expect(FLOOR_PLAN_RULES.minEdgeLengthCm).toBeLessThan(50);
    expect(FLOOR_PLAN_RULES.wallThickness.minCm).toBeGreaterThan(0);
    expect(FLOOR_PLAN_RULES.wallThickness.maxCm).toBeGreaterThan(FLOOR_PLAN_RULES.wallThickness.minCm);
    expect(FLOOR_PLAN_RULES.alignmentToleranceCm).toBeGreaterThan(0);
    expect(FLOOR_PLAN_RULES.mergeGapFactor).toBeGreaterThan(0);
  });
});

// ── Helper: check all edges are at standard angles ─────────────────
function edgeAngles(verts) {
  const angles = [];
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    const deg = ((Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI) + 360) % 360;
    angles.push(Math.round(deg * 100) / 100);
  }
  return angles;
}

function allAxisAligned(verts) {
  const standard = new Set([0, 90, 180, 270]);
  for (const a of edgeAngles(verts)) {
    if (!standard.has(a)) return false;
  }
  return true;
}

// ── extractValidAngles ─────────────────────────────────────────────

describe('extractValidAngles', () => {
  it('returns [0, 90, 180, 270] for an axis-aligned rectangle', () => {
    const rect = [
      { x: 0, y: 0 }, { x: 300, y: 0 },
      { x: 300, y: 200 }, { x: 0, y: 200 },
    ];
    expect(extractValidAngles(rect)).toEqual([0, 90, 180, 270]);
  });

  it('returns [45, 135, 225, 315] for a 45°-rotated square', () => {
    // Diamond shape: edges at 315°, 225°, 135°, 45°
    const s = 100;
    const diamond = [
      { x: s, y: 0 },   // top
      { x: 2 * s, y: s }, // right
      { x: s, y: 2 * s }, // bottom
      { x: 0, y: s },   // left
    ];
    expect(extractValidAngles(diamond)).toEqual([45, 135, 225, 315]);
  });

  it('returns [0, 90, 180, 270] for an L-shaped polygon', () => {
    const lShape = [
      { x: 0, y: 0 }, { x: 300, y: 0 },
      { x: 300, y: 150 }, { x: 400, y: 150 },
      { x: 400, y: 400 }, { x: 0, y: 400 },
    ];
    expect(extractValidAngles(lShape)).toEqual([0, 90, 180, 270]);
  });

  it('filters out short diagonal noise edges', () => {
    // Rectangle with a tiny 3cm diagonal noise edge at one corner
    const poly = [
      { x: 0, y: 0 }, { x: 300, y: 0 },
      { x: 300, y: 200 }, { x: 0, y: 200 },
      { x: 0, y: 3 }, { x: 3, y: 0 },  // 4.2cm diagonal noise
    ];
    const angles = extractValidAngles(poly);
    // The diagonal edge (≈4.2cm) is below minEdgeLengthCm (5), so it's filtered out
    // Only orthogonal angles survive
    expect(angles).toEqual([0, 90, 180, 270]);
  });

  it('returns FLOOR_PLAN_RULES.standardAngles for empty/degenerate polygon', () => {
    expect(extractValidAngles(null)).toEqual([...FLOOR_PLAN_RULES.standardAngles]);
    expect(extractValidAngles([])).toEqual([...FLOOR_PLAN_RULES.standardAngles]);
    expect(extractValidAngles([{ x: 0, y: 0 }])).toEqual([...FLOOR_PLAN_RULES.standardAngles]);
    expect(extractValidAngles([{ x: 0, y: 0 }, { x: 1, y: 0 }])).toEqual([...FLOOR_PLAN_RULES.standardAngles]);
  });

  it('spanning walls contribute angles', () => {
    // Small polygon with only vertical edges (short horizontals below threshold)
    const thinVertical = [
      { x: 0, y: 0 }, { x: 2, y: 0 },
      { x: 2, y: 200 }, { x: 0, y: 200 },
    ];
    // Without spanning walls: only 90°/270° survive (horizontals are 2cm, below minEdgeLengthCm=5)
    const withoutWalls = extractValidAngles(thinVertical);
    expect(withoutWalls).toContain(90);
    expect(withoutWalls).toContain(270);

    // Add a horizontal spanning wall
    const spanningWalls = [{
      startCm: { x: 0, y: 100 },
      endCm: { x: 500, y: 100 },
    }];
    const withWalls = extractValidAngles(thinVertical, spanningWalls);
    expect(withWalls).toContain(0);
    expect(withWalls).toContain(180);
    expect(withWalls).toContain(90);
    expect(withWalls).toContain(270);
  });

  it('complements are always present (every angle has its +180° pair)', () => {
    // Triangle with edges at 0°, ~120°, ~240° — all long enough
    const triangle = [
      { x: 0, y: 0 }, { x: 200, y: 0 },
      { x: 100, y: 173.2 },  // equilateral-ish
    ];
    const angles = extractValidAngles(triangle);
    for (const a of angles) {
      const complement = (a + 180) % 360;
      expect(angles, `angle ${a} missing complement ${complement}`).toContain(complement);
    }
  });
});

// ── rectifyPolygon ─────────────────────────────────────────────────

describe('rectifyPolygon', () => {
  it('returns input unchanged for already-clean rectangle', () => {
    const rect = [
      { x: 0, y: 0 }, { x: 300, y: 0 },
      { x: 300, y: 200 }, { x: 0, y: 200 },
    ];
    const out = rectifyPolygon(rect);
    expect(out).toHaveLength(4);
    expect(allAxisAligned(out)).toBe(true);
  });

  it('returns input for fewer than 3 vertices', () => {
    expect(rectifyPolygon(null)).toBeNull();
    expect(rectifyPolygon([])).toEqual([]);
    expect(rectifyPolygon([{ x: 0, y: 0 }])).toEqual([{ x: 0, y: 0 }]);
  });

  // ── Real Projekt 64 polygons ─────────────────────────────────────

  it('rectifies Room 1 (6 vertices, 2 off-axis edges)', () => {
    // Room 1: edges 3 and 5 are ~5.6° and ~0.38° off vertical
    const raw = [
      { x: 0, y: 0 },
      { x: 494.7, y: 0 },
      { x: 494.7, y: 362.5 },
      { x: 470.9, y: 362.5 },
      { x: 468.3, y: 388.9 },
      { x: 2.6, y: 388.9 },
    ];
    const out = rectifyPolygon(raw);
    expect(allAxisAligned(out)).toBe(true);
    // Should retain the step shape (6 vertices)
    expect(out.length).toBe(6);
  });

  it('rectifies Room 2 (6 vertices, small step at top-left)', () => {
    const raw = [
      { x: 198.4, y: 0 },
      { x: 412.7, y: 0 },
      { x: 412.7, y: 394.2 },
      { x: 0, y: 394.2 },
      { x: 0, y: 4 },
      { x: 198.4, y: 4 },
    ];
    const out = rectifyPolygon(raw);
    expect(allAxisAligned(out)).toBe(true);
    // L-shape: 6 vertices
    expect(out.length).toBe(6);
  });

  it('rectifies Room 3 (7 vertices, L-shape with 3.7cm noise edge)', () => {
    // Edge 6 is a 3.7cm diagonal — detection noise
    const raw = [
      { x: 2.6, y: 0 },
      { x: 276.5, y: 0 },
      { x: 276.5, y: 149.5 },
      { x: 381, y: 149.5 },
      { x: 381, y: 378.3 },
      { x: 0, y: 378.3 },
      { x: 0, y: 2.6 },
    ];
    const out = rectifyPolygon(raw);
    expect(allAxisAligned(out)).toBe(true);
    // Noise edge removed → 6-vertex L-shape
    expect(out.length).toBe(6);
    // First vertex should be at the intersection of left wall (X≈0) and top edge (Y≈0)
    expect(out[0].x).toBeCloseTo(0, 0);
    expect(out[0].y).toBeCloseTo(0, 0);
  });

  it('rectifies Room 4 (4 vertices, slight bottom slope)', () => {
    // Bottom edge has dy=2.7cm over dx=296.3cm (~0.5° off horizontal)
    const raw = [
      { x: 0, y: 0 },
      { x: 296.3, y: 0 },
      { x: 296.3, y: 227.5 },
      { x: 0, y: 230.2 },
    ];
    const out = rectifyPolygon(raw);
    expect(allAxisAligned(out)).toBe(true);
    // Rectangle: 4 vertices
    expect(out.length).toBe(4);
    // Bottom edge should be at a single Y (average of 227.5 and 230.2)
    const bottomY = Math.max(out[2].y, out[3].y);
    expect(out[2].y).toBeCloseTo(out[3].y, 0);
    expect(bottomY).toBeCloseTo(228.9, 1);
  });

  it('rectifies Room 5 (already a clean rectangle)', () => {
    const raw = [
      { x: 0, y: 0 },
      { x: 214.3, y: 0 },
      { x: 214.3, y: 145.5 },
      { x: 0, y: 145.5 },
    ];
    const out = rectifyPolygon(raw);
    expect(allAxisAligned(out)).toBe(true);
    expect(out.length).toBe(4);
  });

  it('removes short diagonal noise edges', () => {
    // Triangle with a tiny diagonal noise edge at one corner
    const raw = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 150 },
      { x: 0, y: 150 },
      { x: 0, y: 3 },  // 3cm noise edge to next vertex
      { x: 3, y: 0 },  // 4.2cm diagonal noise → should be removed
    ];
    const out = rectifyPolygon(raw);
    expect(allAxisAligned(out)).toBe(true);
    // Noise edges removed, collinear merged → clean rectangle
    expect(out.length).toBe(4);
  });

  it('merges collinear edges after snapping', () => {
    // Rectangle with a redundant vertex on the top edge
    const raw = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 200, y: 0 }, // collinear with prev
      { x: 200, y: 150 },
      { x: 0, y: 150 },
    ];
    const out = rectifyPolygon(raw);
    expect(allAxisAligned(out)).toBe(true);
    expect(out.length).toBe(4);
  });
});

// ── expandPolygonOutward ──────────────────────────────────────────

describe('expandPolygonOutward', () => {
  it('expands a rectangle outward by d on all sides', () => {
    const rect = [
      { x: 100, y: 100 }, { x: 400, y: 100 },
      { x: 400, y: 300 }, { x: 100, y: 300 },
    ];
    const d = 12;
    const out = expandPolygonOutward(rect, d);
    expect(out).toHaveLength(4);
    // Each side moves outward by 12
    expect(out[0]).toEqual({ x: 88, y: 88 });
    expect(out[1]).toEqual({ x: 412, y: 88 });
    expect(out[2]).toEqual({ x: 412, y: 312 });
    expect(out[3]).toEqual({ x: 88, y: 312 });
  });

  it('expands an L-shaped polygon outward correctly', () => {
    // L-shape: step in the upper-right corner
    const lShape = [
      { x: 0, y: 0 }, { x: 500, y: 0 },
      { x: 500, y: 360 }, { x: 470, y: 360 },
      { x: 470, y: 390 }, { x: 0, y: 390 },
    ];
    const d = 12;
    const out = expandPolygonOutward(lShape, d);
    expect(out).toHaveLength(6);
    expect(allAxisAligned(out)).toBe(true);
    // Top edge moves up by d
    expect(out[0].y).toBeCloseTo(-12, 0);
    // Right side moves right by d
    expect(out[1].x).toBeCloseTo(512, 0);
    // Bottom edge moves down by d
    expect(out[5].y).toBeCloseTo(402, 0);
    // Left side moves left by d
    expect(out[0].x).toBeCloseTo(-12, 0);
    // The inner step also expands outward
    expect(out[2].y).toBeCloseTo(372, 0); // step H edge moves down
    expect(out[3].x).toBeCloseTo(482, 0); // step V edge moves right
  });

  it('returns input unchanged for zero or negative expansion', () => {
    const rect = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
    expect(expandPolygonOutward(rect, 0)).toBe(rect);
    expect(expandPolygonOutward(rect, -5)).toBe(rect);
  });

  it('returns input unchanged for fewer than 3 vertices', () => {
    expect(expandPolygonOutward(null, 10)).toBeNull();
    expect(expandPolygonOutward([], 10)).toEqual([]);
  });

  it('closes the gap between two adjacent rooms when both expand by half wall thickness', () => {
    // Room A: bottom edge at y=400. Room B: top edge at y=424 (24 cm gap = wall thickness)
    const roomA = [
      { x: 0, y: 0 }, { x: 300, y: 0 },
      { x: 300, y: 400 }, { x: 0, y: 400 },
    ];
    const roomB = [
      { x: 0, y: 424 }, { x: 300, y: 424 },
      { x: 300, y: 800 }, { x: 0, y: 800 },
    ];
    const halfWall = 12; // half of 24 cm wall
    const expandedA = expandPolygonOutward(roomA, halfWall);
    const expandedB = expandPolygonOutward(roomB, halfWall);

    // Room A bottom should move down to y=412
    expect(expandedA[2].y).toBeCloseTo(412, 0);
    // Room B top should move up to y=412
    expect(expandedB[0].y).toBeCloseTo(412, 0);
    // They meet at the wall centerline!
    expect(expandedA[2].y).toBeCloseTo(expandedB[0].y, 0);
  });
});

// ── alignToExistingRooms ───────────────────────────────────────────

describe('alignToExistingRooms', () => {
  it('snaps Y when new room top is near existing room top', () => {
    // Room 1 top at Y=1023.9, Room 2 top at Y=1021.3 → align to 1023.9
    const existingRoom = {
      id: 'r1',
      floorPosition: { x: 674.6, y: 1023.9 },
      polygonVertices: [
        { x: 0, y: 0 },
        { x: 494.7, y: 0 },
        { x: 494.7, y: 389 },
        { x: 0, y: 389 },
      ],
    };

    const newVerts = [
      { x: 0, y: 0 },
      { x: 412.7, y: 0 },
      { x: 412.7, y: 394.2 },
      { x: 0, y: 394.2 },
    ];
    const newPos = { x: 1201.1, y: 1021.3 };

    const result = alignToExistingRooms(newVerts, newPos, [existingRoom]);
    // Should snap Y from 1021.3 to 1023.9 (delta = 2.6)
    expect(result.floorPosition.y).toBeCloseTo(1023.9, 1);
    // X should be unchanged (no X alignment)
    expect(result.floorPosition.x).toBeCloseTo(1201.1, 1);
    // Vertices unchanged
    expect(result.vertices).toBe(newVerts);
  });

  it('does not snap when gap exceeds tolerance', () => {
    const existingRoom = {
      id: 'r1',
      floorPosition: { x: 0, y: 0 },
      polygonVertices: [
        { x: 0, y: 0 }, { x: 300, y: 0 },
        { x: 300, y: 200 }, { x: 0, y: 200 },
      ],
    };

    const newVerts = [
      { x: 0, y: 0 }, { x: 200, y: 0 },
      { x: 200, y: 150 }, { x: 0, y: 150 },
    ];
    // 20 cm gap — well beyond 6 cm tolerance
    const newPos = { x: 0, y: 20 };

    const result = alignToExistingRooms(newVerts, newPos, [existingRoom]);
    expect(result.floorPosition.y).toBe(20);
  });

  it('snaps X when vertical edges are nearly aligned', () => {
    const existingRoom = {
      id: 'r1',
      floorPosition: { x: 100, y: 0 },
      polygonVertices: [
        { x: 0, y: 0 }, { x: 300, y: 0 },
        { x: 300, y: 200 }, { x: 0, y: 200 },
      ],
    };
    // Room 1 right edge at X=100+300=400
    // New room left edge at X=403 → should snap to 400
    const newVerts = [
      { x: 0, y: 0 }, { x: 200, y: 0 },
      { x: 200, y: 150 }, { x: 0, y: 150 },
    ];
    const newPos = { x: 403, y: 0 };

    const result = alignToExistingRooms(newVerts, newPos, [existingRoom]);
    expect(result.floorPosition.x).toBeCloseTo(400, 1);
  });

  it('returns unchanged when no existing rooms', () => {
    const verts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
    const pos = { x: 50, y: 50 };
    const result = alignToExistingRooms(verts, pos, []);
    expect(result.floorPosition).toEqual(pos);
  });

  it('picks the alignment from the longest matching edge', () => {
    // Existing room: 500cm wide top edge at Y=0, 100cm wide bottom at Y=200
    const existingRoom = {
      id: 'r1',
      floorPosition: { x: 0, y: 0 },
      polygonVertices: [
        { x: 0, y: 0 }, { x: 500, y: 0 },
        { x: 500, y: 200 }, { x: 0, y: 200 },
      ],
    };

    // New room: top at Y=3 (near existing top at 0), bottom at Y=203 (near existing bottom at 200)
    // Both within tolerance (3cm). The top edge is 400cm long, bottom is also 400cm.
    // But existing top is 500cm and bottom is 500cm. min(400,500)=400 for both.
    // When tied, the first match wins (Y=0 alignment).
    const newVerts = [
      { x: 0, y: 0 }, { x: 400, y: 0 },
      { x: 400, y: 200 }, { x: 0, y: 200 },
    ];
    const newPos = { x: 0, y: 3 };

    const result = alignToExistingRooms(newVerts, newPos, [existingRoom]);
    // Should align to Y=0 (delta = -3)
    expect(result.floorPosition.y).toBeCloseTo(0, 1);
  });
});

// ── snapToWallType ────────────────────────────────────────────────

describe('snapToWallType', () => {
  // Snap boundaries for defaults [11.5, 24, 30]:
  //   partition: [5, 17.75)
  //   structural: [17.75, 27)
  //   outer: [27, 51)

  it('snaps 31 → outer (30)', () => {
    expect(snapToWallType(31)).toEqual({ snappedCm: 30, typeId: "outer" });
  });

  it('snaps 26 → structural (24) — below midpoint 27', () => {
    expect(snapToWallType(26)).toEqual({ snappedCm: 24, typeId: "structural" });
  });

  it('snaps 28 → outer (30) — above midpoint 27', () => {
    expect(snapToWallType(28)).toEqual({ snappedCm: 30, typeId: "outer" });
  });

  it('snaps 27 → outer (30) — at midpoint (>= boundary)', () => {
    expect(snapToWallType(27)).toEqual({ snappedCm: 30, typeId: "outer" });
  });

  it('snaps 12 → partition (11.5)', () => {
    expect(snapToWallType(12)).toEqual({ snappedCm: 11.5, typeId: "partition" });
  });

  it('snaps 18 → structural (24) — above midpoint 17.75', () => {
    expect(snapToWallType(18)).toEqual({ snappedCm: 24, typeId: "structural" });
  });

  it('snaps 5 → partition (11.5) — at minCm', () => {
    expect(snapToWallType(5)).toEqual({ snappedCm: 11.5, typeId: "partition" });
  });

  it('snaps 50 → outer (30) — at maxCm', () => {
    expect(snapToWallType(50)).toEqual({ snappedCm: 30, typeId: "outer" });
  });

  it('returns raw rounded for empty types', () => {
    expect(snapToWallType(25.7, [])).toEqual({ snappedCm: 26, typeId: null });
  });

  it('works with custom types [8, 40]', () => {
    const custom = [
      { id: "thin", thicknessCm: 8 },
      { id: "thick", thicknessCm: 40 },
    ];
    // midpoint = (8 + 40) / 2 = 24
    expect(snapToWallType(20, custom)).toEqual({ snappedCm: 8, typeId: "thin" });
    expect(snapToWallType(25, custom)).toEqual({ snappedCm: 40, typeId: "thick" });
  });
});

// ── classifyWallTypes ─────────────────────────────────────────────

describe('classifyWallTypes', () => {
  it('clusters [25, 30, 30, 30] into structural + outer', () => {
    const result = classifyWallTypes([25, 30, 30, 30]);
    expect(result).toEqual([
      { id: "structural", thicknessCm: 24 },
      { id: "outer", thicknessCm: 30 },
    ]);
  });

  it('clusters [30, 30, 31] into one outer type', () => {
    const result = classifyWallTypes([30, 30, 31]);
    expect(result).toEqual([
      { id: "outer", thicknessCm: 30 },
    ]);
  });

  it('clusters [12, 12, 25, 30, 30] into three types', () => {
    const result = classifyWallTypes([12, 12, 25, 30, 30]);
    expect(result).toEqual([
      { id: "partition", thicknessCm: 11.5 },
      { id: "structural", thicknessCm: 24 },
      { id: "outer", thicknessCm: 30 },
    ]);
  });

  it('filters out-of-bounds values [3, 55, 30]', () => {
    const result = classifyWallTypes([3, 55, 30]);
    expect(result).toEqual([
      { id: "outer", thicknessCm: 30 },
    ]);
  });

  it('returns empty for empty input', () => {
    expect(classifyWallTypes([])).toEqual([]);
  });
});

// ── Constants ─────────────────────────────────────────────────────

describe('DEFAULT_WALL_TYPES', () => {
  it('has 3 types in ascending thickness order', () => {
    expect(DEFAULT_WALL_TYPES).toHaveLength(3);
    expect(DEFAULT_WALL_TYPES[0].id).toBe("partition");
    expect(DEFAULT_WALL_TYPES[1].id).toBe("structural");
    expect(DEFAULT_WALL_TYPES[2].id).toBe("outer");
    for (let i = 1; i < DEFAULT_WALL_TYPES.length; i++) {
      expect(DEFAULT_WALL_TYPES[i].thicknessCm).toBeGreaterThan(DEFAULT_WALL_TYPES[i - 1].thicknessCm);
    }
  });
});

describe('DEFAULT_FLOOR_HEIGHT_CM', () => {
  it('is 240', () => {
    expect(DEFAULT_FLOOR_HEIGHT_CM).toBe(240);
  });
});
