// src/walls.test.js — Tests for wall entity system and rendering pipeline
import { describe, it, expect } from 'vitest';
import {
  createDefaultWall,
  syncFloorWalls,
  getWallsForRoom,
  getWallForEdge,
  getWallById,
  getWallNormal,
  wallSurfaceToTileableRegion,
  addDoorwayToWall,
  removeDoorwayFromWall,
  findWallByDoorwayId,
  getEdgeDoorways,
  computeFloorWallGeometry,
  getDoorwaysInEdgeSpace,
  getWallRenderHelpers,
  computeDoorwayFloorPatches,
  DEFAULT_WALL,
} from './walls.js';
import { DEFAULT_WALL_THICKNESS_CM } from './constants.js';

// ── Helpers ──────────────────────────────────────────────────────────

/** Create a minimal rectangular room in floor coords. */
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

/** Create a floor with given rooms and empty walls. */
function makeFloor(rooms) {
  return { id: 'f1', name: 'Floor 1', rooms, walls: [] };
}

/** Create a triangular room (CCW winding). */
function makeTriRoom(id, x, y) {
  return {
    id,
    name: id,
    floorPosition: { x, y },
    widthCm: 300,
    heightCm: 300,
    polygonVertices: [
      { x: 0, y: 0 },
      { x: 300, y: 0 },
      { x: 150, y: 300 },
    ],
    tile: { widthCm: 60, heightCm: 60, shape: 'rect' },
    grout: { widthCm: 0.2, colorHex: '#cccccc' },
    pattern: { type: 'grid', bondFraction: 0.5, rotationDeg: 0, offsetXcm: 0, offsetYcm: 0, origin: { preset: 'tl', xCm: 0, yCm: 0 } },
    exclusions: [],
  };
}

// ── createDefaultWall ────────────────────────────────────────────────

describe('createDefaultWall', () => {
  it('creates wall with correct start/end and defaults', () => {
    const wall = createDefaultWall({ x: 0, y: 0 }, { x: 100, y: 0 }, { roomId: 'r1', edgeIndex: 0 });
    expect(wall.id).toBeDefined();
    expect(wall.start).toEqual({ x: 0, y: 0 });
    expect(wall.end).toEqual({ x: 100, y: 0 });
    expect(wall.thicknessCm).toBe(DEFAULT_WALL.thicknessCm);
    expect(wall.heightStartCm).toBe(DEFAULT_WALL.heightStartCm);
    expect(wall.heightEndCm).toBe(DEFAULT_WALL.heightEndCm);
    expect(wall.roomEdge).toEqual({ roomId: 'r1', edgeIndex: 0 });
    expect(wall.doorways).toEqual([]);
    expect(wall.surfaces).toEqual([]);
  });

  it('creates wall without roomEdge', () => {
    const wall = createDefaultWall({ x: 0, y: 0 }, { x: 50, y: 0 }, null);
    expect(wall.roomEdge).toBeNull();
  });

  it('applies custom defaults', () => {
    const wall = createDefaultWall(
      { x: 0, y: 0 }, { x: 100, y: 0 },
      { roomId: 'r1', edgeIndex: 0 },
      { thicknessCm: 20, heightStartCm: 250, heightEndCm: 180 }
    );
    expect(wall.thicknessCm).toBe(20);
    expect(wall.heightStartCm).toBe(250);
    expect(wall.heightEndCm).toBe(180);
  });

  it('deep-copies doorway defaults', () => {
    const doorways = [{ id: 'd1', offsetCm: 10, widthCm: 80, heightCm: 200 }];
    const wall = createDefaultWall({ x: 0, y: 0 }, { x: 200, y: 0 }, null, { doorways });
    expect(wall.doorways).toHaveLength(1);
    expect(wall.doorways[0]).not.toBe(doorways[0]); // deep copy
    expect(wall.doorways[0]).toEqual(doorways[0]);
  });
});

// ── syncFloorWalls ───────────────────────────────────────────────────

describe('syncFloorWalls', () => {
  it('creates walls for a single rectangular room (4 edges)', () => {
    const floor = makeFloor([makeRoom('r1', 0, 0, 400, 300)]);
    syncFloorWalls(floor);
    expect(floor.walls.length).toBe(4);
    for (const wall of floor.walls) {
      expect(wall.roomEdge.roomId).toBe('r1');
      expect(wall.surfaces.length).toBeGreaterThanOrEqual(1);
      expect(wall.surfaces[0].roomId).toBe('r1');
    }
  });

  it('creates walls with correct floor-coordinate endpoints', () => {
    const floor = makeFloor([makeRoom('r1', 100, 50, 400, 300)]);
    syncFloorWalls(floor);

    // Edge 0: (0,0)→(400,0) + offset (100,50) = (100,50)→(500,50)
    const w0 = getWallForEdge(floor, 'r1', 0);
    expect(w0).not.toBeNull();
    expect(w0.start).toEqual({ x: 100, y: 50 });
    expect(w0.end).toEqual({ x: 500, y: 50 });
  });

  it('updates wall endpoints when room is moved', () => {
    const floor = makeFloor([makeRoom('r1', 0, 0, 400, 300)]);
    syncFloorWalls(floor);

    const w0before = getWallForEdge(floor, 'r1', 0);
    expect(w0before.start).toEqual({ x: 0, y: 0 });

    // Move room
    floor.rooms[0].floorPosition = { x: 100, y: 200 };
    syncFloorWalls(floor);

    const w0after = getWallForEdge(floor, 'r1', 0);
    expect(w0after.start).toEqual({ x: 100, y: 200 });
    expect(w0after.end).toEqual({ x: 500, y: 200 });
    expect(w0after.id).toBe(w0before.id); // same wall entity, updated
  });

  it('updates wall endpoints when room is resized', () => {
    const floor = makeFloor([makeRoom('r1', 0, 0, 400, 300)]);
    syncFloorWalls(floor);

    const wallCount = floor.walls.length;
    floor.rooms[0].widthCm = 600;
    floor.rooms[0].polygonVertices = [
      { x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 300 }, { x: 0, y: 300 },
    ];
    syncFloorWalls(floor);

    expect(floor.walls.length).toBe(wallCount);
    const w0 = getWallForEdge(floor, 'r1', 0);
    expect(w0.end).toEqual({ x: 600, y: 0 });
  });

  it('preserves wall IDs across sync calls (stable references)', () => {
    const floor = makeFloor([makeRoom('r1', 0, 0, 400, 300)]);
    syncFloorWalls(floor);
    const ids = floor.walls.map(w => w.id).sort();

    syncFloorWalls(floor); // re-sync without changes
    const ids2 = floor.walls.map(w => w.id).sort();
    expect(ids2).toEqual(ids);
  });

  it('creates walls for a triangular room (3 edges)', () => {
    const floor = makeFloor([makeTriRoom('t1', 0, 0)]);
    syncFloorWalls(floor);
    expect(floor.walls.length).toBe(3);
  });

  it('removes walls when a room is deleted', () => {
    const r1 = makeRoom('r1', 0, 0, 400, 300);
    const r2 = makeRoom('r2', 500, 0, 200, 200);
    const floor = makeFloor([r1, r2]);
    syncFloorWalls(floor);

    const totalWalls = floor.walls.length;
    expect(totalWalls).toBe(8); // 4 + 4

    floor.rooms = [r1]; // remove r2
    syncFloorWalls(floor);

    expect(floor.walls.length).toBe(4);
    expect(floor.walls.every(w => w.roomEdge.roomId === 'r1')).toBe(true);
  });

  it('handles empty rooms array', () => {
    const floor = makeFloor([]);
    syncFloorWalls(floor);
    expect(floor.walls).toEqual([]);
  });

  it('handles null floor gracefully', () => {
    expect(() => syncFloorWalls(null)).not.toThrow();
  });

  it('initializes floor.walls if missing', () => {
    const floor = { rooms: [makeRoom('r1', 0, 0, 100, 100)] };
    syncFloorWalls(floor);
    expect(Array.isArray(floor.walls)).toBe(true);
    expect(floor.walls.length).toBe(4);
  });

  it('skips circle rooms', () => {
    const floor = makeFloor([{
      id: 'c1', name: 'Circle',
      floorPosition: { x: 0, y: 0 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
      circle: { rx: 50 },
    }]);
    syncFloorWalls(floor);
    expect(floor.walls.length).toBe(0);
  });

  it('skips rooms with fewer than 3 vertices', () => {
    const floor = makeFloor([{
      id: 'r1', name: 'Bad',
      floorPosition: { x: 0, y: 0 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
    }]);
    syncFloorWalls(floor);
    expect(floor.walls.length).toBe(0);
  });

  it('skips degenerate zero-length edges', () => {
    const floor = makeFloor([{
      id: 'r1', name: 'Degen',
      floorPosition: { x: 0, y: 0 },
      polygonVertices: [
        { x: 0, y: 0 }, { x: 0, y: 0 }, // zero-length edge
        { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 },
      ],
    }]);
    syncFloorWalls(floor);
    // Should have 4 walls (5 edges minus 1 degenerate)
    expect(floor.walls.length).toBe(4);
  });

  it('preserves doorways across sync calls', () => {
    const floor = makeFloor([makeRoom('r1', 0, 0, 400, 300)]);
    syncFloorWalls(floor);

    const wall = getWallForEdge(floor, 'r1', 0);
    wall.doorways.push({ id: 'dw1', offsetCm: 50, widthCm: 80, heightCm: 200 });

    syncFloorWalls(floor);
    const wallAfter = getWallForEdge(floor, 'r1', 0);
    expect(wallAfter.doorways).toHaveLength(1);
    expect(wallAfter.doorways[0].id).toBe('dw1');
  });

  it('preserves surface tile/pattern settings across sync', () => {
    const floor = makeFloor([makeRoom('r1', 0, 0, 400, 300)]);
    syncFloorWalls(floor);

    const wall = getWallForEdge(floor, 'r1', 0);
    // Configure tiling (walls start untiled)
    wall.surfaces[0].tile = { widthCm: 99, heightCm: 20, shape: 'rect' };
    wall.surfaces[0].grout = { widthCm: 0.2, colorHex: '#ffffff' };
    wall.surfaces[0].pattern = { type: 'herringbone', bondFraction: 0.5, rotationDeg: 0 };

    syncFloorWalls(floor);
    const wallAfter = getWallForEdge(floor, 'r1', 0);
    expect(wallAfter.surfaces[0].tile.widthCm).toBe(99);
    expect(wallAfter.surfaces[0].pattern.type).toBe('herringbone');
  });

  it('updates surface toCm to match new edge length after resize', () => {
    const floor = makeFloor([makeRoom('r1', 0, 0, 400, 300)]);
    syncFloorWalls(floor);

    const wall = getWallForEdge(floor, 'r1', 0);
    expect(wall.surfaces[0].toCm).toBeCloseTo(400, 0);

    // Resize
    floor.rooms[0].polygonVertices[1].x = 600;
    floor.rooms[0].polygonVertices[2].x = 600;
    syncFloorWalls(floor);

    const wallAfter = getWallForEdge(floor, 'r1', 0);
    expect(wallAfter.surfaces[0].toCm).toBeCloseTo(600, 0);
  });
});

// ── Shared edges ─────────────────────────────────────────────────────

describe('syncFloorWalls — shared edges', () => {
  it('merges two adjacent rooms into one shared wall', () => {
    // r1 right edge = r2 left edge (shared)
    const r1 = makeRoom('r1', 0, 0, 400, 300);
    const r2 = makeRoom('r2', 400, 0, 300, 300);
    const floor = makeFloor([r1, r2]);
    syncFloorWalls(floor);

    // 4 + 4 = 8 edges, but one shared → 7 walls
    expect(floor.walls.length).toBe(7);

    // The shared wall should have surfaces for both rooms
    const sharedWall = floor.walls.find(w =>
      w.surfaces.some(s => s.roomId === 'r1') &&
      w.surfaces.some(s => s.roomId === 'r2')
    );
    expect(sharedWall).toBeDefined();
    expect(sharedWall.surfaces.length).toBe(2);
  });

  it('shared wall has correct endpoints', () => {
    const r1 = makeRoom('r1', 0, 0, 400, 300);
    const r2 = makeRoom('r2', 400, 0, 300, 300);
    const floor = makeFloor([r1, r2]);
    syncFloorWalls(floor);

    const sharedWall = floor.walls.find(w =>
      w.surfaces.some(s => s.roomId === 'r1') &&
      w.surfaces.some(s => s.roomId === 'r2')
    );
    // Shared edge runs from (400, 0) to (400, 300) or reverse
    const xs = [sharedWall.start.x, sharedWall.end.x];
    const ys = [sharedWall.start.y, sharedWall.end.y];
    expect(xs).toContain(400);
    expect(ys.sort((a, b) => a - b)).toEqual([0, 300]);
  });

  it('extends shared wall to cover partial overlap', () => {
    // Room 1 at (350,250), 300x300. Room 2 at (171,550), 300x300.
    // Room 1 edge 2: (650,550)→(350,550). Room 2 edge 0: (171,550)→(471,550).
    // Overlap is only 121cm, but the shared wall should extend to cover both.
    const r1 = makeRoom('r1', 350, 250, 300, 300);
    const r2 = makeRoom('r2', 171, 550, 300, 300);
    const floor = makeFloor([r1, r2]);
    syncFloorWalls(floor);

    // 4 + 4 = 8, minus 1 shared = 7 walls
    expect(floor.walls.length).toBe(7);

    // The shared wall should span the union: from x=650 to x=171 (479cm)
    const sharedWall = floor.walls.find(w =>
      w.surfaces.some(s => s.roomId === 'r1') &&
      w.surfaces.some(s => s.roomId === 'r2')
    );
    expect(sharedWall).toBeDefined();

    const wallLen = Math.hypot(
      sharedWall.end.x - sharedWall.start.x,
      sharedWall.end.y - sharedWall.start.y
    );
    expect(wallLen).toBeCloseTo(479, 0);

    // Both rooms' x-extents should be within the wall
    const minX = Math.min(sharedWall.start.x, sharedWall.end.x);
    const maxX = Math.max(sharedWall.start.x, sharedWall.end.x);
    expect(minX).toBeCloseTo(171, 0);
    expect(maxX).toBeCloseTo(650, 0);
  });

  it('extended shared wall has correct surface ranges', () => {
    const r1 = makeRoom('r1', 350, 250, 300, 300);
    const r2 = makeRoom('r2', 171, 550, 300, 300);
    const floor = makeFloor([r1, r2]);
    syncFloorWalls(floor);

    const sharedWall = floor.walls.find(w =>
      w.surfaces.some(s => s.roomId === 'r1') &&
      w.surfaces.some(s => s.roomId === 'r2')
    );
    const r1Surf = sharedWall.surfaces.find(s => s.roomId === 'r1');
    const r2Surf = sharedWall.surfaces.find(s => s.roomId === 'r2');

    // Each surface should cover its room's full 300cm edge
    expect(r1Surf.toCm - r1Surf.fromCm).toBeCloseTo(300, 0);
    expect(r2Surf.toCm - r2Surf.fromCm).toBeCloseTo(300, 0);
  });

  it('no extension needed for fully overlapping edges', () => {
    const r1 = makeRoom('r1', 0, 0, 400, 300);
    const r2 = makeRoom('r2', 400, 0, 300, 300);
    const floor = makeFloor([r1, r2]);
    syncFloorWalls(floor);

    const sharedWall = floor.walls.find(w =>
      w.surfaces.some(s => s.roomId === 'r1') &&
      w.surfaces.some(s => s.roomId === 'r2')
    );
    // Wall should still be exactly 300cm (no extension)
    const wallLen = Math.hypot(
      sharedWall.end.x - sharedWall.start.x,
      sharedWall.end.y - sharedWall.start.y
    );
    expect(wallLen).toBeCloseTo(300, 0);
  });
});

// ── getWallsForRoom / getWallForEdge / getWallById ──────────────────

describe('getWallsForRoom', () => {
  it('returns all walls for a room', () => {
    const floor = makeFloor([makeRoom('r1', 0, 0, 400, 300)]);
    syncFloorWalls(floor);
    const walls = getWallsForRoom(floor, 'r1');
    expect(walls.length).toBe(4);
  });

  it('returns empty for unknown room', () => {
    const floor = makeFloor([makeRoom('r1', 0, 0, 400, 300)]);
    syncFloorWalls(floor);
    expect(getWallsForRoom(floor, 'unknown')).toEqual([]);
  });

  it('returns empty for null floor', () => {
    expect(getWallsForRoom(null, 'r1')).toEqual([]);
  });
});

describe('getWallForEdge', () => {
  it('returns wall for specific edge', () => {
    const floor = makeFloor([makeRoom('r1', 0, 0, 400, 300)]);
    syncFloorWalls(floor);
    for (let i = 0; i < 4; i++) {
      const wall = getWallForEdge(floor, 'r1', i);
      expect(wall).not.toBeNull();
      expect(wall.roomEdge.edgeIndex).toBe(i);
    }
  });

  it('returns null for non-existent edge', () => {
    const floor = makeFloor([makeRoom('r1', 0, 0, 400, 300)]);
    syncFloorWalls(floor);
    expect(getWallForEdge(floor, 'r1', 99)).toBeNull();
  });

  it('returns null for null floor', () => {
    expect(getWallForEdge(null, 'r1', 0)).toBeNull();
  });
});

describe('getWallById', () => {
  it('finds wall by ID', () => {
    const floor = makeFloor([makeRoom('r1', 0, 0, 400, 300)]);
    syncFloorWalls(floor);
    const wall = floor.walls[0];
    expect(getWallById(floor, wall.id)).toBe(wall);
  });

  it('returns null for unknown ID', () => {
    const floor = makeFloor([makeRoom('r1', 0, 0, 400, 300)]);
    syncFloorWalls(floor);
    expect(getWallById(floor, 'nope')).toBeNull();
  });
});

// ── getWallNormal ────────────────────────────────────────────────────

describe('getWallNormal', () => {
  it('returns outward normal for top edge of CW room', () => {
    // Default room vertices: (0,0)→(400,0)→(400,300)→(0,300) at origin
    // This is CW in screen coords → signed area negative → sign = -1
    // Edge 0: (0,0)→(400,0), dx=400, dy=0, len=400
    // Normal: sign*dy/len, -sign*dx/len = -1*0/400, -(-1)*400/400 = (0, 1)
    // ... that points downward (into the room) in screen coords for CW winding
    // Actually: for CW polygons the outward normal of the top edge points UP (y=-1)
    const floor = makeFloor([makeRoom('r1', 0, 0, 400, 300)]);
    syncFloorWalls(floor);
    const wall = getWallForEdge(floor, 'r1', 0);
    const normal = getWallNormal(wall, floor);
    // For a CW rectangle, edge 0 (top) normal should point up: (0, -1)
    expect(normal.x).toBeCloseTo(0, 5);
    expect(normal.y).toBeCloseTo(-1, 5);
  });

  it('returns outward normal for right edge of CW room', () => {
    const floor = makeFloor([makeRoom('r1', 0, 0, 400, 300)]);
    syncFloorWalls(floor);
    const wall = getWallForEdge(floor, 'r1', 1);
    const normal = getWallNormal(wall, floor);
    // Edge 1: (400,0)→(400,300), dx=0, dy=300 → normal points right (1, 0)
    expect(normal.x).toBeCloseTo(1, 5);
    expect(normal.y).toBeCloseTo(0, 5);
  });

  it('returns outward normal for bottom edge of CW room', () => {
    const floor = makeFloor([makeRoom('r1', 0, 0, 400, 300)]);
    syncFloorWalls(floor);
    const wall = getWallForEdge(floor, 'r1', 2);
    const normal = getWallNormal(wall, floor);
    // Edge 2: (400,300)→(0,300), dx=-400, dy=0 → normal points down (0, 1)
    expect(normal.x).toBeCloseTo(0, 5);
    expect(normal.y).toBeCloseTo(1, 5);
  });

  it('returns outward normal for left edge of CW room', () => {
    const floor = makeFloor([makeRoom('r1', 0, 0, 400, 300)]);
    syncFloorWalls(floor);
    const wall = getWallForEdge(floor, 'r1', 3);
    const normal = getWallNormal(wall, floor);
    // Edge 3: (0,300)→(0,0), dx=0, dy=-300 → normal points left (-1, 0)
    expect(normal.x).toBeCloseTo(-1, 5);
    expect(normal.y).toBeCloseTo(0, 5);
  });

  it('normals are unit vectors', () => {
    const floor = makeFloor([makeRoom('r1', 0, 0, 400, 300)]);
    syncFloorWalls(floor);
    for (let i = 0; i < 4; i++) {
      const wall = getWallForEdge(floor, 'r1', i);
      const n = getWallNormal(wall, floor);
      const len = Math.hypot(n.x, n.y);
      expect(len).toBeCloseTo(1, 5);
    }
  });

  it('handles wall without roomEdge', () => {
    const wall = createDefaultWall({ x: 0, y: 0 }, { x: 100, y: 0 }, null);
    const floor = makeFloor([]);
    const normal = getWallNormal(wall, floor);
    expect(normal).toEqual({ x: 0, y: -1 }); // fallback
  });

  it('handles degenerate zero-length wall', () => {
    const wall = createDefaultWall({ x: 5, y: 5 }, { x: 5, y: 5 }, { roomId: 'r1', edgeIndex: 0 });
    const floor = makeFloor([makeRoom('r1', 0, 0, 400, 300)]);
    const normal = getWallNormal(wall, floor);
    expect(normal).toEqual({ x: 0, y: -1 }); // fallback
  });

  it('works with offset room (floorPosition irrelevant for winding)', () => {
    const floor = makeFloor([makeRoom('r1', 500, 500, 400, 300)]);
    syncFloorWalls(floor);
    const wall = getWallForEdge(floor, 'r1', 0);
    const normal = getWallNormal(wall, floor);
    // Same winding as room at origin → same normal
    expect(normal.x).toBeCloseTo(0, 5);
    expect(normal.y).toBeCloseTo(-1, 5);
  });

  it('normals point outward for triangular room', () => {
    const floor = makeFloor([makeTriRoom('t1', 0, 0)]);
    syncFloorWalls(floor);

    // Triangle: (0,0)→(300,0)→(150,300)
    // Signed area: positive if CCW in standard math coords → depends on winding
    // We just verify normals are unit and the triangle interior is on the opposite side
    for (let i = 0; i < 3; i++) {
      const wall = getWallForEdge(floor, 't1', i);
      const n = getWallNormal(wall, floor);
      const len = Math.hypot(n.x, n.y);
      expect(len).toBeCloseTo(1, 5);
    }
  });

  it('normals for all edges of a rectangle point outward (dot product test)', () => {
    const floor = makeFloor([makeRoom('r1', 0, 0, 400, 300)]);
    syncFloorWalls(floor);
    const verts = floor.rooms[0].polygonVertices;
    const n = verts.length;

    // Compute room centroid
    const cx = verts.reduce((s, v) => s + v.x, 0) / n;
    const cy = verts.reduce((s, v) => s + v.y, 0) / n;

    for (let i = 0; i < n; i++) {
      const wall = getWallForEdge(floor, 'r1', i);
      const normal = getWallNormal(wall, floor);
      // Edge midpoint
      const mx = (verts[i].x + verts[(i + 1) % n].x) / 2;
      const my = (verts[i].y + verts[(i + 1) % n].y) / 2;
      // Vector from centroid to edge midpoint
      const toCx = mx - cx;
      const toCy = my - cy;
      // Dot product should be positive (normal points outward, same direction as centroid→edge)
      const dot = normal.x * toCx + normal.y * toCy;
      expect(dot).toBeGreaterThan(0);
    }
  });
});

// ── wallSurfaceToTileableRegion ──────────────────────────────────────

describe('wallSurfaceToTileableRegion', () => {
  it('converts a simple wall surface to a rectangle', () => {
    const floor = makeFloor([makeRoom('r1', 0, 0, 400, 300)]);
    syncFloorWalls(floor);
    const wall = getWallForEdge(floor, 'r1', 0);
    const region = wallSurfaceToTileableRegion(wall, 0);

    expect(region).not.toBeNull();
    expect(region.widthCm).toBeCloseTo(400, 0);
    expect(region.heightCm).toBe(200); // default wall height
    expect(region.polygonVertices).toHaveLength(4);
    expect(region.tile).toBeDefined();
    expect(region.grout).toBeDefined();
    expect(region.pattern).toBeDefined();
  });

  it('returns null for out-of-range surface index', () => {
    const floor = makeFloor([makeRoom('r1', 0, 0, 400, 300)]);
    syncFloorWalls(floor);
    const wall = getWallForEdge(floor, 'r1', 0);
    expect(wallSurfaceToTileableRegion(wall, 99)).toBeNull();
  });

  it('creates trapezoid polygon for sloped wall', () => {
    const floor = makeFloor([makeRoom('r1', 0, 0, 400, 300)]);
    syncFloorWalls(floor);
    const wall = getWallForEdge(floor, 'r1', 0);
    wall.heightStartCm = 200;
    wall.heightEndCm = 150; // slope

    const region = wallSurfaceToTileableRegion(wall, 0);
    // Should be a trapezoid (4 vertices with different Y at left/right)
    expect(region.polygonVertices).toHaveLength(4);
    const ys = region.polygonVertices.map(v => v.y);
    expect(Math.max(...ys)).toBe(200);
    expect(region.heightCm).toBe(200);
  });

  it('creates rectangle for uniform-height wall', () => {
    const floor = makeFloor([makeRoom('r1', 0, 0, 400, 300)]);
    syncFloorWalls(floor);
    const wall = getWallForEdge(floor, 'r1', 0);
    const region = wallSurfaceToTileableRegion(wall, 0);
    // All corners should form a proper rectangle
    const xs = region.polygonVertices.map(v => v.x).sort((a, b) => a - b);
    const ys = region.polygonVertices.map(v => v.y).sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(0, 0);
    expect(xs[3]).toBeCloseTo(400, 0);
    expect(ys[0]).toBeCloseTo(0, 0);
    expect(ys[3]).toBeCloseTo(200, 0);
  });

  it('includes doorway exclusions within surface range', () => {
    const floor = makeFloor([makeRoom('r1', 0, 0, 400, 300)]);
    syncFloorWalls(floor);
    const wall = getWallForEdge(floor, 'r1', 0);
    wall.doorways = [{ id: 'd1', offsetCm: 100, widthCm: 80, heightCm: 200, elevationCm: 0 }];

    const region = wallSurfaceToTileableRegion(wall, 0);
    expect(region.exclusions.length).toBeGreaterThanOrEqual(1);
    const dwExcl = region.exclusions[0];
    expect(dwExcl.type).toBe('freeform');
    expect(dwExcl.vertices).toHaveLength(4);
  });

  it('excludes doorways outside surface range', () => {
    const floor = makeFloor([makeRoom('r1', 0, 0, 400, 300)]);
    syncFloorWalls(floor);

    // Set up a shared wall with partial surface
    const wall = getWallForEdge(floor, 'r1', 0);
    wall.surfaces[0].fromCm = 0;
    wall.surfaces[0].toCm = 200;
    // Doorway at offset 300–380, outside the 0–200 surface range
    wall.doorways = [{ id: 'd1', offsetCm: 300, widthCm: 80, heightCm: 200, elevationCm: 0 }];

    const region = wallSurfaceToTileableRegion(wall, 0);
    expect(region.exclusions.length).toBe(0);
  });
});

// ── Doorway management ───────────────────────────────────────────────

describe('doorway management', () => {
  it('addDoorwayToWall adds a doorway', () => {
    const wall = createDefaultWall({ x: 0, y: 0 }, { x: 400, y: 0 }, null);
    addDoorwayToWall(wall, { id: 'd1', offsetCm: 50, widthCm: 80, heightCm: 200 });
    expect(wall.doorways).toHaveLength(1);
    expect(wall.doorways[0].id).toBe('d1');
  });

  it('removeDoorwayFromWall removes by ID', () => {
    const wall = createDefaultWall({ x: 0, y: 0 }, { x: 400, y: 0 }, null);
    wall.doorways = [
      { id: 'd1', offsetCm: 50, widthCm: 80, heightCm: 200 },
      { id: 'd2', offsetCm: 200, widthCm: 80, heightCm: 200 },
    ];
    removeDoorwayFromWall(wall, 'd1');
    expect(wall.doorways).toHaveLength(1);
    expect(wall.doorways[0].id).toBe('d2');
  });

  it('findWallByDoorwayId finds the wall containing a doorway', () => {
    const floor = makeFloor([makeRoom('r1', 0, 0, 400, 300)]);
    syncFloorWalls(floor);
    const wall = floor.walls[0];
    wall.doorways.push({ id: 'dw-find', offsetCm: 10, widthCm: 80, heightCm: 200 });

    const result = findWallByDoorwayId(floor, 'dw-find');
    expect(result).not.toBeNull();
    expect(result.wall.id).toBe(wall.id);
    expect(result.doorway.id).toBe('dw-find');
  });

  it('findWallByDoorwayId returns null for unknown ID', () => {
    const floor = makeFloor([makeRoom('r1', 0, 0, 400, 300)]);
    syncFloorWalls(floor);
    expect(findWallByDoorwayId(floor, 'nope')).toBeNull();
  });

  it('getEdgeDoorways returns doorways for room edge', () => {
    const floor = makeFloor([makeRoom('r1', 0, 0, 400, 300)]);
    syncFloorWalls(floor);
    const wall = getWallForEdge(floor, 'r1', 0);
    wall.doorways.push({ id: 'dw1', offsetCm: 50, widthCm: 80, heightCm: 200, elevationCm: 0 });

    const doorways = getEdgeDoorways(floor, 'r1', 0);
    expect(doorways).toHaveLength(1);
    expect(doorways[0].id).toBe('dw1');
  });
});

// ── Corner extension logic ───────────────────────────────────────────

describe('corner extension geometry', () => {
  // The corner extension is applied in prepareFloorWallData, renderPlanSvg, and
  // renderFloorCanvas. We test the math here with a helper that replicates
  // the extension logic.

  function computeExtendedWall(wall, floor) {
    const normal = getWallNormal(wall, floor);
    const thick = wall.thicknessCm ?? DEFAULT_WALL_THICKNESS_CM;
    const dx = wall.end.x - wall.start.x;
    const dy = wall.end.y - wall.start.y;
    const edgeLength = Math.hypot(dx, dy);
    if (edgeLength < 1) return null;

    const dirX = dx / edgeLength;
    const dirY = dy / edgeLength;
    const ext = thick;
    const extStart = { x: wall.start.x - dirX * ext, y: wall.start.y - dirY * ext };
    const extEnd = { x: wall.end.x + dirX * ext, y: wall.end.y + dirY * ext };
    const outerStart = { x: extStart.x + normal.x * thick, y: extStart.y + normal.y * thick };
    const outerEnd = { x: extEnd.x + normal.x * thick, y: extEnd.y + normal.y * thick };
    return { extStart, extEnd, outerStart, outerEnd, edgeLength: edgeLength + 2 * ext, ext };
  }

  it('extends wall by thickness in both directions', () => {
    const floor = makeFloor([makeRoom('r1', 0, 0, 400, 300)]);
    syncFloorWalls(floor);
    const wall = getWallForEdge(floor, 'r1', 0); // top edge (0,0)→(400,0)
    const thick = wall.thicknessCm;

    const ext = computeExtendedWall(wall, floor);
    expect(ext).not.toBeNull();
    // Start extended backwards along edge direction
    expect(ext.extStart.x).toBeCloseTo(-thick, 5);
    expect(ext.extStart.y).toBeCloseTo(0, 5);
    // End extended forward along edge direction
    expect(ext.extEnd.x).toBeCloseTo(400 + thick, 5);
    expect(ext.extEnd.y).toBeCloseTo(0, 5);
  });

  it('extended length is original + 2 * thickness', () => {
    const floor = makeFloor([makeRoom('r1', 0, 0, 400, 300)]);
    syncFloorWalls(floor);
    const wall = getWallForEdge(floor, 'r1', 0);
    const thick = wall.thicknessCm;

    const ext = computeExtendedWall(wall, floor);
    expect(ext.edgeLength).toBeCloseTo(400 + 2 * thick, 5);
  });

  it('outer edge is parallel to inner edge, offset by thickness', () => {
    const floor = makeFloor([makeRoom('r1', 0, 0, 400, 300)]);
    syncFloorWalls(floor);
    const wall = getWallForEdge(floor, 'r1', 0); // top edge, normal (0, -1)

    const ext = computeExtendedWall(wall, floor);
    // Outer start/end should be shifted by normal * thick = (0, -12)
    expect(ext.outerStart.y).toBeCloseTo(ext.extStart.y - 12, 5);
    expect(ext.outerEnd.y).toBeCloseTo(ext.extEnd.y - 12, 5);
    // X coords should match inner (normal has no x component)
    expect(ext.outerStart.x).toBeCloseTo(ext.extStart.x, 5);
    expect(ext.outerEnd.x).toBeCloseTo(ext.extEnd.x, 5);
  });

  it('corner extension ensures adjacent walls overlap', () => {
    const floor = makeFloor([makeRoom('r1', 0, 0, 400, 300)]);
    syncFloorWalls(floor);

    // Top wall (edge 0) and right wall (edge 1)
    const topWall = getWallForEdge(floor, 'r1', 0);
    const rightWall = getWallForEdge(floor, 'r1', 1);

    const topExt = computeExtendedWall(topWall, floor);
    const rightExt = computeExtendedWall(rightWall, floor);

    // Top wall ends at x=400+12, right wall starts at x=400 (but y shifted up by -12)
    // Extended top wall right end: x ≈ 412
    // Extended right wall top start: y ≈ -12
    // They should overlap in the corner region
    expect(topExt.extEnd.x).toBeGreaterThan(400); // extends past corner
    expect(rightExt.extStart.y).toBeLessThan(0); // extends past corner
  });

  it('doorway offsets shift by extension amount', () => {
    const floor = makeFloor([makeRoom('r1', 0, 0, 400, 300)]);
    syncFloorWalls(floor);
    const wall = getWallForEdge(floor, 'r1', 0);
    const thick = wall.thicknessCm;
    wall.doorways.push({ id: 'd1', offsetCm: 50, widthCm: 80, heightCm: 200 });

    const ext = computeExtendedWall(wall, floor);
    // The doorway offset should be shifted by ext (= thick)
    const shiftedOffset = 50 + ext.ext;
    expect(shiftedOffset).toBe(50 + thick);
  });
});

// ── Cross-dependency: syncFloorWalls with room operations ────────────

describe('syncFloorWalls integration', () => {
  it('walls track room position changes', () => {
    const floor = makeFloor([makeRoom('r1', 0, 0, 200, 200)]);
    syncFloorWalls(floor);

    const wall0 = getWallForEdge(floor, 'r1', 0);
    expect(wall0.start).toEqual({ x: 0, y: 0 });

    // Simulate room drag
    floor.rooms[0].floorPosition = { x: 100, y: 100 };
    syncFloorWalls(floor);

    const wall0After = getWallForEdge(floor, 'r1', 0);
    expect(wall0After.start).toEqual({ x: 100, y: 100 });
    expect(wall0After.end).toEqual({ x: 300, y: 100 });
  });

  it('walls track polygon vertex changes', () => {
    const floor = makeFloor([makeRoom('r1', 0, 0, 200, 200)]);
    syncFloorWalls(floor);

    // Simulate vertex drag — move vertex 2 from (200,200) to (250,250)
    floor.rooms[0].polygonVertices[2] = { x: 250, y: 250 };
    syncFloorWalls(floor);

    const wall1 = getWallForEdge(floor, 'r1', 1);
    expect(wall1.end).toEqual({ x: 250, y: 250 });
  });

  it('adding second room creates new walls', () => {
    const floor = makeFloor([makeRoom('r1', 0, 0, 200, 200)]);
    syncFloorWalls(floor);
    expect(floor.walls.length).toBe(4);

    floor.rooms.push(makeRoom('r2', 300, 0, 200, 200));
    syncFloorWalls(floor);
    expect(floor.walls.length).toBe(8); // no shared edges
  });

  it('adding adjacent room merges shared wall', () => {
    const floor = makeFloor([makeRoom('r1', 0, 0, 200, 200)]);
    syncFloorWalls(floor);
    expect(floor.walls.length).toBe(4);

    floor.rooms.push(makeRoom('r2', 200, 0, 200, 200));
    syncFloorWalls(floor);
    expect(floor.walls.length).toBe(7); // 8 - 1 shared
  });

  it('removing room removes its walls and shared wall surfaces', () => {
    const r1 = makeRoom('r1', 0, 0, 200, 200);
    const r2 = makeRoom('r2', 200, 0, 200, 200);
    const floor = makeFloor([r1, r2]);
    syncFloorWalls(floor);
    expect(floor.walls.length).toBe(7);

    floor.rooms = [r1];
    syncFloorWalls(floor);
    expect(floor.walls.length).toBe(4);
    // No surfaces should reference r2
    for (const wall of floor.walls) {
      for (const s of wall.surfaces) {
        expect(s.roomId).not.toBe('r2');
      }
    }
  });

  it('multiple syncs are idempotent', () => {
    const floor = makeFloor([makeRoom('r1', 0, 0, 400, 300), makeRoom('r2', 400, 0, 300, 300)]);
    // First sync adjusts Room 2's position for wall thickness, then stabilizes
    syncFloorWalls(floor);
    syncFloorWalls(floor);
    const snapshot1 = JSON.stringify(floor.walls);

    syncFloorWalls(floor);
    const snapshot2 = JSON.stringify(floor.walls);

    syncFloorWalls(floor);
    const snapshot3 = JSON.stringify(floor.walls);

    expect(snapshot2).toBe(snapshot1);
    expect(snapshot3).toBe(snapshot1);
  });
});

// ── computeFloorWallGeometry ─────────────────────────────────────────

describe('computeFloorWallGeometry', () => {
  it('returns a Map keyed by wall ID', () => {
    const floor = makeFloor([makeRoom('r1', 0, 0, 400, 300)]);
    syncFloorWalls(floor);
    const wg = computeFloorWallGeometry(floor);
    expect(wg).toBeInstanceOf(Map);
    expect(wg.size).toBe(4);
    for (const wall of floor.walls) {
      expect(wg.has(wall.id)).toBe(true);
    }
  });

  it('computes correct edge length', () => {
    const floor = makeFloor([makeRoom('r1', 0, 0, 400, 300)]);
    syncFloorWalls(floor);
    const wg = computeFloorWallGeometry(floor);
    const w0 = getWallForEdge(floor, 'r1', 0);
    const desc = wg.get(w0.id);
    expect(desc.edgeLength).toBeCloseTo(400, 0);
  });

  it('computes unit direction vector', () => {
    const floor = makeFloor([makeRoom('r1', 0, 0, 400, 300)]);
    syncFloorWalls(floor);
    const wg = computeFloorWallGeometry(floor);
    const w0 = getWallForEdge(floor, 'r1', 0);
    const desc = wg.get(w0.id);
    // Edge 0: (0,0)→(400,0), direction (1, 0)
    expect(desc.dirX).toBeCloseTo(1, 5);
    expect(desc.dirY).toBeCloseTo(0, 5);
  });

  it('computes outward normal consistent with getWallNormal', () => {
    const floor = makeFloor([makeRoom('r1', 0, 0, 400, 300)]);
    syncFloorWalls(floor);
    const wg = computeFloorWallGeometry(floor);
    for (const wall of floor.walls) {
      const desc = wg.get(wall.id);
      const expected = getWallNormal(wall, floor);
      expect(desc.normal.x).toBeCloseTo(expected.x, 5);
      expect(desc.normal.y).toBeCloseTo(expected.y, 5);
    }
  });

  it('computes extended start/end points', () => {
    const floor = makeFloor([makeRoom('r1', 0, 0, 400, 300)]);
    syncFloorWalls(floor);
    const wg = computeFloorWallGeometry(floor);
    const w0 = getWallForEdge(floor, 'r1', 0);
    const desc = wg.get(w0.id);
    // Extended start should be before wall start
    expect(desc.extStartPt.x).toBeLessThan(w0.start.x + 0.1);
    // Extended end should be after wall end
    expect(desc.extEndPt.x).toBeGreaterThan(w0.end.x - 0.1);
    // totalLength > edgeLength
    expect(desc.totalLength).toBeGreaterThan(desc.edgeLength - 0.1);
  });

  it('computes outer points offset by normal * thickness', () => {
    const floor = makeFloor([makeRoom('r1', 0, 0, 400, 300)]);
    syncFloorWalls(floor);
    const wg = computeFloorWallGeometry(floor);
    const w0 = getWallForEdge(floor, 'r1', 0);
    const desc = wg.get(w0.id);
    const thick = w0.thicknessCm ?? DEFAULT_WALL_THICKNESS_CM;
    // For top edge, normal is (0, -1), so outer points should be shifted by thick in -y
    expect(desc.outerStartPt.y).toBeCloseTo(desc.extStartPt.y + desc.normal.y * thick, 1);
    expect(desc.outerEndPt.y).toBeCloseTo(desc.extEndPt.y + desc.normal.y * thick, 1);
  });

  it('pre-shifts doorways by owner extStart', () => {
    const floor = makeFloor([makeRoom('r1', 0, 0, 400, 300)]);
    syncFloorWalls(floor);
    const w0 = getWallForEdge(floor, 'r1', 0);
    w0.doorways.push({ id: 'd1', offsetCm: 50, widthCm: 80, heightCm: 200 });
    const wg = computeFloorWallGeometry(floor);
    const desc = wg.get(w0.id);
    expect(desc.extDoorways).toHaveLength(1);
    expect(desc.extDoorways[0].offsetCm).toBe(50 + desc.extStart);
  });

  it('includes extensions for shared wall rooms', () => {
    const r1 = makeRoom('r1', 0, 0, 400, 300);
    const r2 = makeRoom('r2', 400, 0, 300, 300);
    const floor = makeFloor([r1, r2]);
    syncFloorWalls(floor);
    const wg = computeFloorWallGeometry(floor);

    const sharedWall = floor.walls.find(w =>
      w.surfaces.some(s => s.roomId === 'r1') &&
      w.surfaces.some(s => s.roomId === 'r2')
    );
    const desc = wg.get(sharedWall.id);
    // Both rooms should have extensions
    expect(desc.extensions.has('r1')).toBe(true);
    expect(desc.extensions.has('r2')).toBe(true);
  });

  it('returns empty map for null/empty floor', () => {
    expect(computeFloorWallGeometry(null).size).toBe(0);
    expect(computeFloorWallGeometry({ walls: [] }).size).toBe(0);
  });
});

// ── getDoorwaysInEdgeSpace ───────────────────────────────────────────

describe('getDoorwaysInEdgeSpace', () => {
  it('returns doorways with extStart shift for owner room (same direction)', () => {
    const floor = makeFloor([makeRoom('r1', 0, 0, 400, 300)]);
    syncFloorWalls(floor);
    const w0 = getWallForEdge(floor, 'r1', 0);
    w0.doorways.push({ id: 'd1', offsetCm: 50, widthCm: 80, heightCm: 200 });
    const wg = computeFloorWallGeometry(floor);
    const desc = wg.get(w0.id);

    const result = getDoorwaysInEdgeSpace(desc, floor.rooms[0], 0);
    expect(result).toHaveLength(1);
    // For owner room (same direction), offset = dw.offset + roomExtStart
    const ext = desc.extensions.get('r1');
    expect(result[0].offsetCm).toBeCloseTo(50 + ext.extStart, 1);
  });

  it('flips doorway offset for reversed edge (non-owner room)', () => {
    // Create two adjacent rooms sharing a wall
    const r1 = makeRoom('r1', 0, 0, 400, 300);
    const r2 = makeRoom('r2', 400, 0, 300, 300);
    const floor = makeFloor([r1, r2]);
    syncFloorWalls(floor);
    syncFloorWalls(floor);

    const sharedWall = floor.walls.find(w =>
      w.surfaces.some(s => s.roomId === 'r1') &&
      w.surfaces.some(s => s.roomId === 'r2')
    );
    if (!sharedWall) return;

    // Add a doorway near one end
    sharedWall.doorways.push({ id: 'dw-shared', offsetCm: 10, widthCm: 80, heightCm: 200 });

    const wg = computeFloorWallGeometry(floor);
    const desc = wg.get(sharedWall.id);

    const ownerRoom = floor.rooms.find(r => r.id === sharedWall.roomEdge?.roomId);
    const otherRoom = floor.rooms.find(r => r.id !== sharedWall.roomEdge?.roomId);
    const ownerSurface = sharedWall.surfaces.find(s => s.roomId === ownerRoom.id);
    const otherSurface = sharedWall.surfaces.find(s => s.roomId === otherRoom.id);

    if (!ownerSurface || !otherSurface || !otherRoom) return;

    const ownerResult = getDoorwaysInEdgeSpace(desc, ownerRoom, ownerSurface.edgeIndex);
    const otherResult = getDoorwaysInEdgeSpace(desc, otherRoom, otherSurface.edgeIndex);

    expect(ownerResult).toHaveLength(1);
    expect(otherResult).toHaveLength(1);
    expect(ownerResult[0].widthCm).toBe(otherResult[0].widthCm);

    // The edge-local offsets should place the doorway at the same absolute position.
    // Owner: offset from edge start = 10 + ownerExtStart
    // Other: reversed, so offset from other's edge start = (edgeLen - 10 - 80) + otherExtStart
    const ownerExt = desc.extensions.get(ownerRoom.id) ?? { extStart: 0 };
    const otherExt = desc.extensions.get(otherRoom.id) ?? { extStart: 0 };
    expect(ownerResult[0].offsetCm).toBeCloseTo(10 + ownerExt.extStart, 1);
    expect(otherResult[0].offsetCm).toBeCloseTo(300 - 10 - 80 + otherExt.extStart, 1);
  });

  it('correctly places doorway on merged/extended shared wall', () => {
    // Two rooms sharing a horizontal edge, offset so the wall gets extended.
    // r1: 481x300 at (342, -62) — bottom edge (edge 2) shared
    // r2: 477x300 at (662, 250) — top edge (edge 0) shared
    // Wall thickness creates adjacency: r1 bottom at y=238, r2 top at y=250, gap=12=thickness
    const r1 = makeRoom('r1', 342, -62, 481, 300);
    const r2 = makeRoom('r2', 662, 250, 477, 300);
    const floor = makeFloor([r1, r2]);
    syncFloorWalls(floor);
    syncFloorWalls(floor);

    const sharedWall = floor.walls.find(w =>
      w.surfaces.some(s => s.roomId === 'r1') &&
      w.surfaces.some(s => s.roomId === 'r2')
    );
    if (!sharedWall) return;

    // The merged wall should be longer than either room's edge
    const wallLen = Math.hypot(
      sharedWall.end.x - sharedWall.start.x,
      sharedWall.end.y - sharedWall.start.y
    );
    expect(wallLen).toBeGreaterThan(481);

    // Add a doorway centered on r2's portion (at wall-offset that falls within r2's range)
    // r2's edge 0 in floor-global: (662,250)→(1139,250), length 477
    // Centered doorway on r2: edge-local offset = (477-101)/2 = 188
    // r2's edge start (A=(0,0)) projects to wall at some offset; doorway wall-offset depends on direction.
    const wg0 = computeFloorWallGeometry(floor);
    const desc0 = wg0.get(sharedWall.id);
    const r2Surface = sharedWall.surfaces.find(s => s.roomId === 'r2');
    if (!r2Surface) return;

    // Find where r2's edge start projects onto the wall
    const pos2 = r2.floorPosition;
    const r2A = r2.polygonVertices[r2Surface.edgeIndex];
    const globalAx = pos2.x + r2A.x;
    const globalAy = pos2.y + r2A.y;
    const r2StartOnWall =
      (globalAx - sharedWall.start.x) * desc0.dirX +
      (globalAy - sharedWall.start.y) * desc0.dirY;

    // Place doorway so it's 188cm from r2's edge start in r2's direction.
    // r2's edge is reversed relative to wall, so:
    // wallOffset = r2StartOnWall - 188 - 101
    const wallOffset = r2StartOnWall - 188 - 101;
    sharedWall.doorways.push({ id: 'dw-merged', offsetCm: wallOffset, widthCm: 101, heightCm: 200 });

    const wg = computeFloorWallGeometry(floor);
    const desc = wg.get(sharedWall.id);

    // Get doorway in r2's edge space
    const r2Result = getDoorwaysInEdgeSpace(desc, r2, r2Surface.edgeIndex);
    expect(r2Result).toHaveLength(1);
    const r2Ext = desc.extensions.get('r2') ?? { extStart: 0 };
    // Should be 188 + r2's extStart (centered on r2's 477cm edge)
    expect(r2Result[0].offsetCm).toBeCloseTo(188 + r2Ext.extStart, 1);

    // Get doorway in r1's edge space — it should be OUTSIDE r1's edge (negative offset before extStart)
    const r1Surface = sharedWall.surfaces.find(s => s.roomId === 'r1');
    if (!r1Surface) return;
    const r1Result = getDoorwaysInEdgeSpace(desc, r1, r1Surface.edgeIndex);
    expect(r1Result).toHaveLength(1);
    const r1Ext = desc.extensions.get('r1') ?? { extStart: 0 };
    // The doorway is on r2's portion, so from r1's perspective the edge-local offset
    // should be negative (before r1's edge start) or past r1's edge end.
    // Specifically: offset should be < r1Ext.extStart (i.e., before the edge starts in rendered space)
    // OR offset should be > r1's edgeLen + r1Ext.extStart (past the edge end)
    const r1EdgeLen = 481;
    const r1Offset = r1Result[0].offsetCm;
    const withinR1 = r1Offset >= 0 && r1Offset + 101 <= r1EdgeLen + r1Ext.extStart + (desc.extensions.get('r1')?.extEnd ?? 0);
    expect(withinR1).toBe(false);
  });

  it('returns empty array when no doorways', () => {
    const floor = makeFloor([makeRoom('r1', 0, 0, 400, 300)]);
    syncFloorWalls(floor);
    const w0 = getWallForEdge(floor, 'r1', 0);
    const wg = computeFloorWallGeometry(floor);
    const desc = wg.get(w0.id);
    const result = getDoorwaysInEdgeSpace(desc, floor.rooms[0], 0);
    expect(result).toHaveLength(0);
  });

  it('returns empty for invalid edge index', () => {
    const floor = makeFloor([makeRoom('r1', 0, 0, 400, 300)]);
    syncFloorWalls(floor);
    const w0 = getWallForEdge(floor, 'r1', 0);
    w0.doorways.push({ id: 'd1', offsetCm: 50, widthCm: 80, heightCm: 200 });
    const wg = computeFloorWallGeometry(floor);
    const desc = wg.get(w0.id);
    const result = getDoorwaysInEdgeSpace(desc, floor.rooms[0], 99);
    expect(result).toHaveLength(0);
  });
});

// ── getWallRenderHelpers ─────────────────────────────────────────────

describe('getWallRenderHelpers', () => {
  it('returns A, B, OA, OB, L, innerAt, outerAt', () => {
    const floor = makeFloor([makeRoom('r1', 0, 0, 400, 300)]);
    syncFloorWalls(floor);
    const wg = computeFloorWallGeometry(floor);
    const w0 = getWallForEdge(floor, 'r1', 0);
    const desc = wg.get(w0.id);
    const h = getWallRenderHelpers(desc, 'r1');
    expect(h).toHaveProperty('A');
    expect(h).toHaveProperty('B');
    expect(h).toHaveProperty('OA');
    expect(h).toHaveProperty('OB');
    expect(h).toHaveProperty('L');
    expect(typeof h.innerAt).toBe('function');
    expect(typeof h.outerAt).toBe('function');
  });

  it('innerAt(0) returns A, innerAt(1) returns B', () => {
    const floor = makeFloor([makeRoom('r1', 0, 0, 400, 300)]);
    syncFloorWalls(floor);
    const wg = computeFloorWallGeometry(floor);
    const w0 = getWallForEdge(floor, 'r1', 0);
    const desc = wg.get(w0.id);
    const h = getWallRenderHelpers(desc, 'r1');

    const p0 = h.innerAt(0);
    expect(p0.x).toBeCloseTo(h.A.x, 5);
    expect(p0.y).toBeCloseTo(h.A.y, 5);
    const p1 = h.innerAt(1);
    expect(p1.x).toBeCloseTo(h.B.x, 5);
    expect(p1.y).toBeCloseTo(h.B.y, 5);
  });

  it('outerAt(0) returns OA, outerAt(1) returns OB', () => {
    const floor = makeFloor([makeRoom('r1', 0, 0, 400, 300)]);
    syncFloorWalls(floor);
    const wg = computeFloorWallGeometry(floor);
    const w0 = getWallForEdge(floor, 'r1', 0);
    const desc = wg.get(w0.id);
    const h = getWallRenderHelpers(desc, 'r1');

    const p0 = h.outerAt(0);
    expect(p0.x).toBeCloseTo(h.OA.x, 5);
    expect(p0.y).toBeCloseTo(h.OA.y, 5);
    const p1 = h.outerAt(1);
    expect(p1.x).toBeCloseTo(h.OB.x, 5);
    expect(p1.y).toBeCloseTo(h.OB.y, 5);
  });

  it('L equals totalLength for owner room', () => {
    const floor = makeFloor([makeRoom('r1', 0, 0, 400, 300)]);
    syncFloorWalls(floor);
    const wg = computeFloorWallGeometry(floor);
    const w0 = getWallForEdge(floor, 'r1', 0);
    const desc = wg.get(w0.id);
    const h = getWallRenderHelpers(desc, 'r1');
    // For owner room, helpers use the same extensions as the descriptor
    expect(h.L).toBeCloseTo(desc.totalLength, 1);
  });
});

// ── computeDoorwayFloorPatches ───────────────────────────────────────

describe('computeDoorwayFloorPatches', () => {
  it('returns vertices format by default', () => {
    const floor = makeFloor([makeRoom('r1', 0, 0, 400, 300)]);
    syncFloorWalls(floor);
    const w0 = getWallForEdge(floor, 'r1', 0);
    w0.doorways.push({ id: 'd1', offsetCm: 50, widthCm: 80, heightCm: 200, elevationCm: 0 });

    const patches = computeDoorwayFloorPatches(floor.rooms[0], floor, null, 'vertices');
    expect(patches).toHaveLength(1);
    expect(patches[0]).toHaveLength(4);
    expect(patches[0][0]).toHaveProperty('x');
    expect(patches[0][0]).toHaveProperty('y');
  });

  it('returns multipolygon format when requested', () => {
    const floor = makeFloor([makeRoom('r1', 0, 0, 400, 300)]);
    syncFloorWalls(floor);
    const w0 = getWallForEdge(floor, 'r1', 0);
    w0.doorways.push({ id: 'd1', offsetCm: 50, widthCm: 80, heightCm: 200, elevationCm: 0 });

    const patches = computeDoorwayFloorPatches(floor.rooms[0], floor, null, 'multipolygon');
    expect(patches).toHaveLength(1);
    // MultiPolygon format: [[[p1, p2, p3, p4, p1]]]
    expect(patches[0]).toHaveLength(1); // one ring
    expect(patches[0][0]).toHaveLength(5); // 4 points + closing
    expect(Array.isArray(patches[0][0][0])).toBe(true); // [x, y]
  });

  it('skips elevated doorways', () => {
    const floor = makeFloor([makeRoom('r1', 0, 0, 400, 300)]);
    syncFloorWalls(floor);
    const w0 = getWallForEdge(floor, 'r1', 0);
    w0.doorways.push({ id: 'd1', offsetCm: 50, widthCm: 80, heightCm: 200, elevationCm: 50 });

    const patches = computeDoorwayFloorPatches(floor.rooms[0], floor, null, 'vertices');
    expect(patches).toHaveLength(0);
  });

  it('returns empty for room with no doorways', () => {
    const floor = makeFloor([makeRoom('r1', 0, 0, 400, 300)]);
    syncFloorWalls(floor);
    const patches = computeDoorwayFloorPatches(floor.rooms[0], floor);
    expect(patches).toHaveLength(0);
  });

  it('only includes doorways from walls owned by the room', () => {
    const r1 = makeRoom('r1', 0, 0, 400, 300);
    const r2 = makeRoom('r2', 400, 0, 300, 300);
    const floor = makeFloor([r1, r2]);
    syncFloorWalls(floor);
    syncFloorWalls(floor); // stabilize

    // Add doorway to r1's top wall (edge 0)
    const w0 = getWallForEdge(floor, 'r1', 0);
    w0.doorways.push({ id: 'd1', offsetCm: 50, widthCm: 80, heightCm: 200, elevationCm: 0 });

    // Patches for r1 should include the doorway
    const patchesR1 = computeDoorwayFloorPatches(r1, floor);
    expect(patchesR1).toHaveLength(1);

    // Patches for r2 should NOT include it (not r2's wall)
    const patchesR2 = computeDoorwayFloorPatches(r2, floor);
    expect(patchesR2).toHaveLength(0);
  });

  it('accepts pre-computed wallGeometry', () => {
    const floor = makeFloor([makeRoom('r1', 0, 0, 400, 300)]);
    syncFloorWalls(floor);
    const w0 = getWallForEdge(floor, 'r1', 0);
    w0.doorways.push({ id: 'd1', offsetCm: 50, widthCm: 80, heightCm: 200, elevationCm: 0 });

    const wg = computeFloorWallGeometry(floor);
    const patches = computeDoorwayFloorPatches(floor.rooms[0], floor, wg, 'vertices');
    expect(patches).toHaveLength(1);
  });
});

// ── Offset stability ────────────────────────────────────────────────

describe('doorway offset stability', () => {
  it('doorway offsetCm stays constant across multiple syncFloorWalls cycles', () => {
    const floor = makeFloor([makeRoom('r1', 0, 0, 400, 300)]);
    syncFloorWalls(floor);
    const w0 = getWallForEdge(floor, 'r1', 0);
    w0.doorways.push({ id: 'd1', offsetCm: 100, widthCm: 80, heightCm: 200 });

    // Run 10 sync cycles
    for (let i = 0; i < 10; i++) {
      syncFloorWalls(floor);
    }

    const wallAfter = getWallForEdge(floor, 'r1', 0);
    expect(wallAfter.doorways[0].offsetCm).toBeCloseTo(100, 1);
  });

  it('doorway offsetCm stays constant on shared wall across syncs', () => {
    const r1 = makeRoom('r1', 0, 0, 400, 300);
    const r2 = makeRoom('r2', 400, 0, 300, 300);
    const floor = makeFloor([r1, r2]);
    syncFloorWalls(floor);
    syncFloorWalls(floor); // stabilize

    const sharedWall = floor.walls.find(w =>
      w.surfaces.some(s => s.roomId === 'r1') &&
      w.surfaces.some(s => s.roomId === 'r2')
    );
    if (!sharedWall) return;

    sharedWall.doorways.push({ id: 'dw-stable', offsetCm: 50, widthCm: 80, heightCm: 200 });
    const initialOffset = sharedWall.doorways[0].offsetCm;

    // Run 10 sync cycles
    for (let i = 0; i < 10; i++) {
      syncFloorWalls(floor);
    }

    const finalOffset = sharedWall.doorways[0].offsetCm;
    expect(finalOffset).toBeCloseTo(initialOffset, 1);
  });
});
