// src/constrained-polygon-edit.test.js
// E2E tests for angle-constrained polygon editing (edge length input + vertex drag).

import { describe, it, expect } from "vitest";
import { snapEdgeAngleDeg, lineIntersection } from "./geometry.js";
import { rectifyPolygon, FLOOR_PLAN_RULES } from "./floor-plan-rules.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ORTHO_ANGLES = [0, 90, 180, 270];

function isAxisAligned(vertices, toleranceCm = 0.01) {
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % n];
    const dx = Math.abs(b.x - a.x);
    const dy = Math.abs(b.y - a.y);
    if (dx > toleranceCm && dy > toleranceCm) return false;
  }
  return true;
}

// Simulate the onPolygonEdgeEdit fix from main.js.
// Returns a new vertices array with the constrained edit applied.
function applyEdgeLengthEdit(vertices, edgeIndex, newLength, validAngles) {
  const verts = vertices.map(v => ({ ...v }));
  const n = verts.length;
  const v1 = verts[edgeIndex];
  const v2 = verts[(edgeIndex + 1) % n];
  const dx = v2.x - v1.x;
  const dy = v2.y - v1.y;
  const currentLength = Math.hypot(dx, dy);
  if (currentLength < 0.01) return verts;

  const scale = newLength / currentLength;
  const oldV2 = { x: v2.x, y: v2.y };
  v2.x = v1.x + dx * scale;
  v2.y = v1.y + dy * scale;

  if (validAngles?.length && n >= 4) {
    const v3 = verts[(edgeIndex + 2) % n];
    const v4 = verts[(edgeIndex + 3) % n];
    const angleNext = snapEdgeAngleDeg(v3.x - oldV2.x, v3.y - oldV2.y, validAngles);
    const angleAfter = snapEdgeAngleDeg(v4.x - v3.x, v4.y - v3.y, validAngles);
    const pt = lineIntersection(v2, angleNext, v4, angleAfter);
    if (pt) {
      v3.x = pt.x;
      v3.y = pt.y;
    }
  }
  return verts;
}

// Simulate the vertex drag fix from drag.js.
// Returns a new vertices array with the dragged vertex and rectification applied.
function applyVertexDrag(vertices, vertexIndex, newX, newY, validAngles) {
  const verts = vertices.map(v => ({ ...v }));
  verts[vertexIndex].x = newX;
  verts[vertexIndex].y = newY;
  if (validAngles?.length) {
    const rules = { ...FLOOR_PLAN_RULES, standardAngles: validAngles };
    const rectified = rectifyPolygon(verts, rules);
    if (rectified.length === verts.length) return rectified;
  }
  return verts;
}

// ---------------------------------------------------------------------------
// Utility function tests
// ---------------------------------------------------------------------------

describe("snapEdgeAngleDeg", () => {
  it("snaps horizontal rightward to 0°", () => {
    expect(snapEdgeAngleDeg(10, 0, ORTHO_ANGLES)).toBe(0);
  });

  it("snaps downward to 90°", () => {
    expect(snapEdgeAngleDeg(0, 10, ORTHO_ANGLES)).toBe(90);
  });

  it("snaps leftward to 180°", () => {
    expect(snapEdgeAngleDeg(-10, 0, ORTHO_ANGLES)).toBe(180);
  });

  it("snaps upward to 270°", () => {
    expect(snapEdgeAngleDeg(0, -10, ORTHO_ANGLES)).toBe(270);
  });

  it("snaps slightly-off-horizontal to 0°", () => {
    expect(snapEdgeAngleDeg(100, 3, ORTHO_ANGLES)).toBe(0);
  });

  it("snaps slightly-off-vertical to 90°", () => {
    expect(snapEdgeAngleDeg(3, 100, ORTHO_ANGLES)).toBe(90);
  });

  it("works with diagonal valid angles", () => {
    const diag = [0, 45, 90, 135, 180, 225, 270, 315];
    expect(snapEdgeAngleDeg(10, 10, diag)).toBe(45);
    expect(snapEdgeAngleDeg(-10, 10, diag)).toBe(135);
  });
});

describe("lineIntersection", () => {
  it("finds intersection of horizontal and vertical lines", () => {
    const pt = lineIntersection({ x: 0, y: 5 }, 0, { x: 3, y: 0 }, 90);
    expect(pt).not.toBeNull();
    expect(pt.x).toBeCloseTo(3, 5);
    expect(pt.y).toBeCloseTo(5, 5);
  });

  it("returns null for parallel lines", () => {
    expect(lineIntersection({ x: 0, y: 0 }, 0, { x: 0, y: 5 }, 0)).toBeNull();
    expect(lineIntersection({ x: 0, y: 0 }, 90, { x: 5, y: 0 }, 90)).toBeNull();
  });

  it("finds intersection of two diagonal lines", () => {
    // Two lines crossing at (5, 5): one at 45° from origin, one at 135° from (10, 0)
    const pt = lineIntersection({ x: 0, y: 0 }, 45, { x: 10, y: 0 }, 135);
    expect(pt).not.toBeNull();
    expect(pt.x).toBeCloseTo(5, 3);
    expect(pt.y).toBeCloseTo(5, 3);
  });
});

// ---------------------------------------------------------------------------
// Edge length input: rectangle
// ---------------------------------------------------------------------------

describe("edge length input — rectangle", () => {
  // Rectangle: (0,0)→(200,0)→(200,100)→(0,100)
  const rect = [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
    { x: 200, y: 100 },
    { x: 0, y: 100 },
  ];

  it("changing right edge length keeps all edges axis-aligned", () => {
    const result = applyEdgeLengthEdit(rect, 1, 150, ORTHO_ANGLES);
    expect(isAxisAligned(result)).toBe(true);
  });

  it("changing right edge length to 150 gives correct dimensions", () => {
    const result = applyEdgeLengthEdit(rect, 1, 150, ORTHO_ANGLES);
    // v2 moves to (200, 150), v3 should become (0, 150)
    expect(result[2].x).toBeCloseTo(200, 3);
    expect(result[2].y).toBeCloseTo(150, 3);
    expect(result[3].x).toBeCloseTo(0, 3);
    expect(result[3].y).toBeCloseTo(150, 3);
  });

  it("changing top edge length keeps all edges axis-aligned", () => {
    const result = applyEdgeLengthEdit(rect, 0, 250, ORTHO_ANGLES);
    expect(isAxisAligned(result)).toBe(true);
  });

  it("changing top edge length to 250 gives correct v1 and v2", () => {
    const result = applyEdgeLengthEdit(rect, 0, 250, ORTHO_ANGLES);
    // v1 moves to (250, 0), v2 should become (250, 100)
    expect(result[1].x).toBeCloseTo(250, 3);
    expect(result[1].y).toBeCloseTo(0, 3);
    expect(result[2].x).toBeCloseTo(250, 3);
    expect(result[2].y).toBeCloseTo(100, 3);
  });

  it("without validAngles, only v2 moves (original behaviour preserved)", () => {
    const result = applyEdgeLengthEdit(rect, 1, 150, null);
    // v3 should NOT be updated — old behaviour
    expect(result[3].x).toBeCloseTo(0, 3);
    expect(result[3].y).toBeCloseTo(100, 3); // unchanged
  });
});

// ---------------------------------------------------------------------------
// Edge length input: L-shaped room
// ---------------------------------------------------------------------------

describe("edge length input — L-shaped room", () => {
  // L-shape (clockwise): TL, TR-partial, notch-inner-top, notch-inner-right, BR, BL
  //  (0,0)→(200,0)→(200,100)→(100,100)→(100,200)→(0,200)
  const lShape = [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
    { x: 200, y: 100 },
    { x: 100, y: 100 },
    { x: 100, y: 200 },
    { x: 0, y: 200 },
  ];

  it("changing top edge length keeps all edges axis-aligned", () => {
    const result = applyEdgeLengthEdit(lShape, 0, 180, ORTHO_ANGLES);
    expect(isAxisAligned(result)).toBe(true);
  });

  it("changing right edge length keeps all edges axis-aligned", () => {
    const result = applyEdgeLengthEdit(lShape, 1, 80, ORTHO_ANGLES);
    expect(isAxisAligned(result)).toBe(true);
  });

  it("changing top edge from 200→180: v1 moves left, v2 follows", () => {
    const result = applyEdgeLengthEdit(lShape, 0, 180, ORTHO_ANGLES);
    expect(result[1].x).toBeCloseTo(180, 3);
    expect(result[1].y).toBeCloseTo(0, 3);
    expect(result[2].x).toBeCloseTo(180, 3);
    expect(result[2].y).toBeCloseTo(100, 3);
  });

  it("vertex count is unchanged after edit", () => {
    const result = applyEdgeLengthEdit(lShape, 1, 80, ORTHO_ANGLES);
    expect(result.length).toBe(lShape.length);
  });
});

// ---------------------------------------------------------------------------
// Vertex drag: rectification
// ---------------------------------------------------------------------------

describe("vertex drag — angle constraint rectification", () => {
  const rect = [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
    { x: 200, y: 100 },
    { x: 0, y: 100 },
  ];

  it("small off-axis drag is rectified to axis-aligned polygon", () => {
    // Drag TR (v1) slightly off axis: (200,0) → (203, 4)
    const result = applyVertexDrag(rect, 1, 203, 4, ORTHO_ANGLES);
    expect(isAxisAligned(result)).toBe(true);
  });

  it("vertex count is unchanged after rectification", () => {
    const result = applyVertexDrag(rect, 1, 203, 4, ORTHO_ANGLES);
    expect(result.length).toBe(rect.length);
  });

  it("without validAngles, drag is free-form (no rectification)", () => {
    const result = applyVertexDrag(rect, 1, 203, 4, null);
    // Edge from v1=(203,4) to v2=(200,100) is diagonal — no rectification applied
    expect(isAxisAligned(result)).toBe(false);
  });

  it("small L-shape vertex drag is rectified", () => {
    const lShape = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 100 },
      { x: 100, y: 100 },
      { x: 100, y: 200 },
      { x: 0, y: 200 },
    ];
    // Drag inner notch vertex (v2) slightly off: (200,100) → (202, 97)
    const result = applyVertexDrag(lShape, 2, 202, 97, ORTHO_ANGLES);
    expect(isAxisAligned(result)).toBe(true);
    expect(result.length).toBe(lShape.length);
  });
});
