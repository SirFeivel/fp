// src/surface_contacts.test.js — Tests for computeSurfaceContacts + E2E pipeline

import { describe, it, expect } from "vitest";
import { computeSurfaceContacts, computeAvailableArea, exclusionToPolygon } from "./geometry.js";

// Minimal wall factory: horizontal wall along X axis at y=0, from x=0 to x=wallLen
function makeWall(x1, y1, x2, y2, height = 250) {
  return {
    id: "w1",
    start: { x: x1, y: y1 },
    end:   { x: x2, y: y2 },
    heightStartCm: height,
    heightEndCm:   height,
    surfaces: [],
  };
}

function makeRoom(objects3d = []) {
  return { objects3d };
}

// Rect 3D object at given position/size/height
function makeRect(x, y, w, h, heightCm = 100) {
  return { id: "obj1", type: "rect", x, y, w, h, heightCm };
}

// ─── Basic detection ────────────────────────────────────────────────────────

describe("computeSurfaceContacts — basic detection", () => {
  it("detects rect back face exactly touching wall", () => {
    // Wall: from (0,100) to (200,100) — horizontal at y=100
    // Rect: x=50, y=0, w=100, h=100 → back edge is from (150,100) to (50,100), y=100
    const wall = makeWall(0, 100, 200, 100);
    const room = makeRoom([makeRect(50, 0, 100, 100)]);
    const contacts = computeSurfaceContacts(room, wall);
    expect(contacts).toHaveLength(1);
    expect(contacts[0].face).toBe("back");
    expect(contacts[0].objId).toBe("obj1");
    expect(contacts[0].overlapStart).toBeCloseTo(50);
    expect(contacts[0].overlapEnd).toBeCloseTo(150);
    expect(contacts[0].contactH).toBeCloseTo(100);
  });

  it("detects rect front face touching wall when object faces room boundary", () => {
    // Wall: from (0,0) to (200,0) — horizontal at y=0
    // Rect: x=50, y=0, w=100, h=100 → front edge is (50,0)→(150,0) at y=0
    const wall = makeWall(0, 0, 200, 0);
    const room = makeRoom([makeRect(50, 0, 100, 100)]);
    const contacts = computeSurfaceContacts(room, wall);
    expect(contacts).toHaveLength(1);
    expect(contacts[0].face).toBe("front");
  });

  it("returns no contact when object is not touching wall (gap exists)", () => {
    // Wall at y=100, rect back edge at y=80 (gap of 20cm)
    const wall = makeWall(0, 100, 200, 100);
    const room = makeRoom([makeRect(50, 0, 100, 80)]);
    const contacts = computeSurfaceContacts(room, wall);
    expect(contacts).toHaveLength(0);
  });

  it("returns no contact when collinear edges don't overlap horizontally", () => {
    // Wall: x=0 to x=100, y=100
    // Rect back face: x=150 to x=250, y=100 — collinear but no horizontal overlap
    const wall = makeWall(0, 100, 100, 100);
    const room = makeRoom([makeRect(150, 0, 100, 100)]);
    const contacts = computeSurfaceContacts(room, wall);
    expect(contacts).toHaveLength(0);
  });

  it("returns no contact for empty objects3d", () => {
    const wall = makeWall(0, 0, 200, 0);
    const contacts = computeSurfaceContacts(makeRoom([]), wall);
    expect(contacts).toHaveLength(0);
  });
});

// ─── Contact height ──────────────────────────────────────────────────────────

describe("computeSurfaceContacts — contact height", () => {
  it("uses obj height when obj is shorter than wall", () => {
    const wall = makeWall(0, 100, 200, 100, 250);
    const room = makeRoom([makeRect(0, 0, 100, 100, 80)]);
    const contacts = computeSurfaceContacts(room, wall);
    expect(contacts[0].contactH).toBeCloseTo(80);
  });

  it("uses wall height when obj is taller than wall", () => {
    const wall = makeWall(0, 100, 200, 100, 200);
    const room = makeRoom([makeRect(0, 0, 100, 100, 300)]);
    const contacts = computeSurfaceContacts(room, wall);
    expect(contacts[0].contactH).toBeCloseTo(200);
  });

  it("skips object with zero height", () => {
    const wall = makeWall(0, 100, 200, 100);
    const room = makeRoom([makeRect(0, 0, 100, 100, 0)]);
    const contacts = computeSurfaceContacts(room, wall);
    expect(contacts).toHaveLength(0);
  });
});

// ─── Partial overlap ─────────────────────────────────────────────────────────

describe("computeSurfaceContacts — partial overlap", () => {
  it("clamps overlapStart/End to wall boundaries", () => {
    // Wall: x=50 to x=150, y=100
    // Rect back face: x=0 to x=200, y=100 → only 50..150 overlaps the wall
    const wall = makeWall(50, 100, 150, 100);
    const room = makeRoom([makeRect(0, 0, 200, 100)]);
    const contacts = computeSurfaceContacts(room, wall);
    expect(contacts).toHaveLength(1);
    expect(contacts[0].overlapStart).toBeCloseTo(0);  // 50 - 50 = 0
    expect(contacts[0].overlapEnd).toBeCloseTo(100);  // 150 - 50 = 100
  });
});

// ─── Face-local coordinates ──────────────────────────────────────────────────

describe("computeSurfaceContacts — face-local coordinates", () => {
  it("computes faceLocalX1/X2 for full overlap", () => {
    // Wall: x=0 to x=100, y=100
    // Rect back face: x=0 to x=100, y=100 → full overlap, face goes right-to-left (back is reversed)
    // Back face edge: (100,100)→(0,100) — face-local x=0 at (100,100), x=100 at (0,100)
    const wall = makeWall(0, 100, 100, 100);
    const room = makeRoom([makeRect(0, 0, 100, 100)]);
    const contacts = computeSurfaceContacts(room, wall);
    expect(contacts).toHaveLength(1);
    expect(contacts[0].faceLocalX1).toBeCloseTo(0);
    expect(contacts[0].faceLocalX2).toBeCloseTo(100);
  });

  it("computes faceLocalX1/X2 for partial overlap", () => {
    // Wall: x=25 to x=75, y=100
    // Rect back face: x=0 to x=100, y=100 (back edge from (100,100) to (0,100))
    // Wall starts at x=25 → face-local: 100-25=75 from face edge start p1=(100,100)
    // Wait, face edge p1=(100,100), p2=(0,100), direction (-1,0)
    // overlapStart = 25 (distance from wall start x=25 to ... wait wall start is x=25)
    // Actually: wall goes from (25,100) to (75,100), wallDir=(1,0)
    // back edge: p1=(100,100), p2=(0,100), edgeDir=(-1,0)
    // overlapStart=0, overlapEnd=50 (50 = 75-25)
    // pt_start = (25,100) + 0*(1,0) = (25,100)
    // faceX1 = (25-100)*(-1) + (100-100)*0 = 75
    // pt_end = (25,100) + 50*(1,0) = (75,100)
    // faceX2 = (75-100)*(-1) = 25
    // faceLocalX1=min(75,25)=25, faceLocalX2=max(75,25)=75
    const wall = makeWall(25, 100, 75, 100);
    const room = makeRoom([makeRect(0, 0, 100, 100)]);
    const contacts = computeSurfaceContacts(room, wall);
    expect(contacts).toHaveLength(1);
    expect(contacts[0].faceLocalX1).toBeCloseTo(25);
    expect(contacts[0].faceLocalX2).toBeCloseTo(75);
  });
});

// ─── Triangle object ─────────────────────────────────────────────────────────

describe("computeSurfaceContacts — freeform/tri objects", () => {
  it("detects freeform object edge touching wall", () => {
    // Freeform: triangle with one edge on y=100
    const wall = makeWall(0, 100, 200, 100);
    const room = makeRoom([{
      id: "obj2",
      type: "freeform",
      vertices: [
        { x: 50, y: 0 },
        { x: 150, y: 0 },
        { x: 150, y: 100 },  // edge side-1: (150,0)→(150,100) — right edge
        // closed by wrapping
      ],
      heightCm: 100,
    }]);
    // Edge side-2: (150,100)→(50,0) — diagonal, not collinear with wall
    // Only side-1 might be partially touching — actually none of these edges lie on y=100
    // Let's test with a proper edge on y=100
    // Actually: side-2 goes from vertex[2]=(150,100) to vertex[0]=(50,0) — diagonal
    // So no edge lies on y=100. Add vertex at (50,100):
    const room2 = makeRoom([{
      id: "obj3",
      type: "freeform",
      vertices: [
        { x: 50, y: 50 },
        { x: 150, y: 50 },
        { x: 150, y: 100 },
        { x: 50, y: 100 },  // edge side-2 from (150,100)→(50,100) on y=100
      ],
      heightCm: 80,
    }]);
    const contacts2 = computeSurfaceContacts(room2, wall);
    expect(contacts2).toHaveLength(1);
    expect(contacts2[0].face).toBe("side-2");
    expect(contacts2[0].overlapStart).toBeCloseTo(50);
    expect(contacts2[0].overlapEnd).toBeCloseTo(150);
    expect(contacts2[0].contactH).toBeCloseTo(80);
  });

  it("detects no contact when freeform object has no edge on wall line", () => {
    const wall = makeWall(0, 100, 200, 100);
    const room = makeRoom([{
      id: "obj4",
      type: "freeform",
      vertices: [
        { x: 50, y: 20 },
        { x: 150, y: 20 },
        { x: 150, y: 80 },
        { x: 50, y: 80 },
      ],
      heightCm: 80,
    }]);
    const contacts = computeSurfaceContacts(room, wall);
    expect(contacts).toHaveLength(0);
  });
});

// ─── E2E: geometry pipeline integration ─────────────────────────────────────

describe("E2E: contact exclusions correctly clip tile available area", () => {
  // Wall: horizontal at y=200, from x=0 to x=400, h=250
  // Rect object: x=100, y=100, w=200, h=100, heightCm=150
  //   back face edge: (300,200)→(100,200) exactly on the wall
  //   contact: overlapStart=100, overlapEnd=300, contactH=150
  const wall = {
    id: "w1",
    start: { x: 0, y: 200 },
    end:   { x: 400, y: 200 },
    heightStartCm: 250,
    heightEndCm:   250,
    surfaces: [],
  };
  const obj = { id: "obj1", type: "rect", x: 100, y: 100, w: 200, h: 100, heightCm: 150 };
  const room = { objects3d: [obj] };

  it("detects the back-face contact with correct coordinates", () => {
    const contacts = computeSurfaceContacts(room, wall);
    expect(contacts).toHaveLength(1);
    expect(contacts[0].face).toBe("back");
    expect(contacts[0].overlapStart).toBeCloseTo(100);
    expect(contacts[0].overlapEnd).toBeCloseTo(300);
    expect(contacts[0].contactH).toBeCloseTo(150);
    expect(contacts[0].faceLocalX1).toBeCloseTo(0);
    expect(contacts[0].faceLocalX2).toBeCloseTo(200);
  });

  it("wall surface available area is reduced by contact exclusion", () => {
    const contacts = computeSurfaceContacts(room, wall);
    const c = contacts[0];
    const maxH = 250;

    // Wall surface region: 400x250, Y flipped (0=ceiling, 250=floor)
    const wallRegion = {
      widthCm: 400, heightCm: maxH,
      polygonVertices: [
        { x: 0,   y: 0 }, { x: 400, y: 0 },
        { x: 400, y: maxH }, { x: 0, y: maxH },
      ],
      skirting: { enabled: false },
    };
    const contactExcl = {
      type: 'rect',
      x: c.overlapStart,
      y: maxH - c.contactH,
      w: c.overlapEnd - c.overlapStart,
      h: c.contactH,
    };

    const { mp } = computeAvailableArea(wallRegion, [contactExcl]);
    expect(mp).toBeTruthy();

    // Full wall = 400*250=100000, contact = 200*150=30000, remaining = 70000
    let totalArea = 0;
    for (const poly of mp) {
      for (const ring of poly) {
        let area = 0;
        for (let i = 0; i < ring.length - 1; i++) {
          area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
        }
        totalArea += Math.abs(area) / 2;
      }
    }
    expect(totalArea).toBeCloseTo(400 * 250 - 200 * 150, 0);
  });

  it("object back face available area is zeroed when fully covered by contact", () => {
    const contacts = computeSurfaceContacts(room, wall);
    const c = contacts[0];

    // Back face region: 200x150
    const faceRegion = {
      widthCm: obj.w, heightCm: obj.heightCm,
      polygonVertices: [
        { x: 0, y: 0 }, { x: obj.w, y: 0 },
        { x: obj.w, y: obj.heightCm }, { x: 0, y: obj.heightCm },
      ],
      skirting: { enabled: false },
    };
    const contactExcl = {
      type: 'rect',
      x: c.faceLocalX1, y: 0,
      w: c.faceLocalX2 - c.faceLocalX1,
      h: c.contactH,
    };

    const { mp } = computeAvailableArea(faceRegion, [contactExcl]);
    // faceLocalX1=0, faceLocalX2=200, h=150 covers the entire face
    let totalArea = 0;
    if (mp) {
      for (const poly of mp) {
        for (const ring of poly) {
          let area = 0;
          for (let i = 0; i < ring.length - 1; i++) {
            area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
          }
          totalArea += Math.abs(area) / 2;
        }
      }
    }
    expect(totalArea).toBeCloseTo(0, 0);
  });
});
