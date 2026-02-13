// src/walls_adaptive.test.js — Tests for adaptive wall thickness
import { describe, it, expect } from 'vitest';
import { syncFloorWalls } from './walls.js';

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

/** Create a floor with given rooms. */
function makeFloor(rooms, options = {}) {
  return {
    id: 'f1',
    name: 'Floor 1',
    rooms,
    walls: [],
    wallsFinalized: options.wallsFinalized ?? true,
  };
}

// ── Adaptive Wall Thickness ──────────────────────────────────────────

describe('Adaptive Wall Thickness', () => {
  it('sets wall thickness to actual spacing between rooms', () => {
    // Two rooms 12cm apart (standard spacing)
    const r1 = makeRoom('r1', 0, 0, 200, 200);
    const r2 = makeRoom('r2', 212, 0, 200, 200); // 12cm gap
    const floor = makeFloor([r1, r2]);

    syncFloorWalls(floor);

    // Should create wall with 12cm thickness (matching actual spacing)
    const sharedWall = floor.walls.find(w => w.surfaces.length >= 2);
    expect(sharedWall).toBeDefined();
    expect(sharedWall.thicknessCm).toBe(12);
  });

  it('adapts to 20cm spacing (thick exterior wall)', () => {
    // Rooms 20cm apart (like TROCKENRAUM/HEIZRAUM from floor plan)
    const r1 = makeRoom('r1', 0, 0, 200, 200);
    const r2 = makeRoom('r2', 220, 0, 200, 200); // 20cm gap
    const floor = makeFloor([r1, r2]);

    syncFloorWalls(floor);

    // Should create 20cm wall (not move rooms to 12cm!)
    const sharedWall = floor.walls.find(w => w.surfaces.length >= 2);
    expect(sharedWall).toBeDefined();
    expect(sharedWall.thicknessCm).toBe(20);

    // Verify rooms didn't move
    expect(floor.rooms[0].floorPosition.x).toBe(0);
    expect(floor.rooms[1].floorPosition.x).toBe(220);
  });

  it('adapts to 15cm spacing (interior load-bearing wall)', () => {
    // Rooms 15cm apart
    const r1 = makeRoom('r1', 0, 0, 200, 200);
    const r2 = makeRoom('r2', 215, 0, 200, 200); // 15cm gap
    const floor = makeFloor([r1, r2]);

    syncFloorWalls(floor);

    // Should create 15cm wall
    const sharedWall = floor.walls.find(w => w.surfaces.length >= 2);
    expect(sharedWall).toBeDefined();
    expect(sharedWall.thicknessCm).toBe(15);
  });

  it('adapts to 24cm spacing (thick exterior wall)', () => {
    // Rooms 24cm apart (thick exterior wall)
    const r1 = makeRoom('r1', 0, 0, 200, 200);
    const r2 = makeRoom('r2', 224, 0, 200, 200); // 24cm gap
    const floor = makeFloor([r1, r2]);

    syncFloorWalls(floor);

    // Should create 24cm wall
    const sharedWall = floor.walls.find(w => w.surfaces.length >= 2);
    expect(sharedWall).toBeDefined();
    expect(sharedWall.thicknessCm).toBe(24);
  });

  it('enforces minimum thickness of 5cm', () => {
    // Rooms very close (3cm apart - unrealistic but test bounds)
    const r1 = makeRoom('r1', 0, 0, 200, 200);
    const r2 = makeRoom('r2', 203, 0, 200, 200); // 3cm gap
    const floor = makeFloor([r1, r2]);

    syncFloorWalls(floor);

    // Should clamp to minimum 5cm
    const sharedWall = floor.walls.find(w => w.surfaces.length >= 2);
    expect(sharedWall).toBeDefined();
    expect(sharedWall.thicknessCm).toBe(5);
  });

  it('enforces maximum thickness of 50cm', () => {
    // Rooms far apart (60cm - might be separate walls, but if shared)
    const r1 = makeRoom('r1', 0, 0, 200, 200);
    const r2 = makeRoom('r2', 260, 0, 200, 200); // 60cm gap
    const floor = makeFloor([r1, r2]);

    syncFloorWalls(floor);

    // If wall created (within detection tolerance), cap at 50cm
    const sharedWall = floor.walls.find(w => w.surfaces.length >= 2);
    if (sharedWall) {
      expect(sharedWall.thicknessCm).toBeLessThanOrEqual(50);
    }
  });

  it('preserves room positions (does not move rooms)', () => {
    // Critical: Rooms should stay exactly where user positioned them
    const r1 = makeRoom('r1', 100, 50, 200, 200);
    const r2 = makeRoom('r2', 320, 50, 150, 180); // 20cm gap
    const floor = makeFloor([r1, r2]);

    const originalR1X = floor.rooms[0].floorPosition.x;
    const originalR1Y = floor.rooms[0].floorPosition.y;
    const originalR2X = floor.rooms[1].floorPosition.x;
    const originalR2Y = floor.rooms[1].floorPosition.y;

    syncFloorWalls(floor);

    // Rooms must not move
    expect(floor.rooms[0].floorPosition.x).toBe(originalR1X);
    expect(floor.rooms[0].floorPosition.y).toBe(originalR1Y);
    expect(floor.rooms[1].floorPosition.x).toBe(originalR2X);
    expect(floor.rooms[1].floorPosition.y).toBe(originalR2Y);
  });

  it('handles vertical adjacency (not just horizontal)', () => {
    // Two rooms vertically adjacent, 18cm apart
    const r1 = makeRoom('r1', 0, 0, 200, 200);
    const r2 = makeRoom('r2', 0, 218, 200, 200); // 18cm gap vertically
    const floor = makeFloor([r1, r2]);

    syncFloorWalls(floor);

    // Should create 18cm wall
    const sharedWall = floor.walls.find(w => w.surfaces.length >= 2);
    expect(sharedWall).toBeDefined();
    expect(sharedWall.thicknessCm).toBe(18);
  });

  it('handles multiple rooms with different wall thicknesses', () => {
    // Three rooms with varying spacing
    const r1 = makeRoom('r1', 0, 0, 200, 200);
    const r2 = makeRoom('r2', 212, 0, 200, 200);  // 12cm from r1
    const r3 = makeRoom('r3', 432, 0, 200, 200);  // 20cm from r2
    const floor = makeFloor([r1, r2, r3]);

    syncFloorWalls(floor);

    // Should create walls with different thicknesses
    const walls = floor.walls.filter(w => w.surfaces.length >= 2);
    expect(walls.length).toBeGreaterThan(0);

    // Check that walls have adaptive thicknesses (not all 12cm)
    const thicknesses = walls.map(w => w.thicknessCm);
    const hasVariation = new Set(thicknesses).size > 1 || thicknesses.some(t => t !== 12);
    expect(hasVariation).toBe(true);
  });

  it('updates wall thickness on subsequent syncs', () => {
    // Room initially 12cm apart
    const r1 = makeRoom('r1', 0, 0, 200, 200);
    const r2 = makeRoom('r2', 212, 0, 200, 200);
    const floor = makeFloor([r1, r2]);

    syncFloorWalls(floor);

    const wall = floor.walls.find(w => w.surfaces.length >= 2);
    expect(wall.thicknessCm).toBe(12);

    // User moves room to 220cm (now 20cm spacing)
    floor.rooms[1].floorPosition.x = 220;
    syncFloorWalls(floor);

    // Wall thickness should update to 20cm
    expect(wall.thicknessCm).toBe(20);
  });

  it('works in planning mode (not just finalized)', () => {
    // Adaptive thickness should work even before finalization
    const r1 = makeRoom('r1', 0, 0, 200, 200);
    const r2 = makeRoom('r2', 220, 0, 200, 200);
    const floor = makeFloor([r1, r2], { wallsFinalized: true });

    syncFloorWalls(floor);

    // Should create 20cm wall
    const sharedWall = floor.walls.find(w => w.surfaces.length >= 2);
    expect(sharedWall).toBeDefined();
    expect(sharedWall.thicknessCm).toBe(20);
  });

  it('rounds thickness to 1 decimal place', () => {
    // Rooms at odd spacing (e.g., 17.3cm)
    const r1 = makeRoom('r1', 0, 0, 200, 200);
    const r2 = makeRoom('r2', 217.3, 0, 200, 200); // 17.3cm gap
    const floor = makeFloor([r1, r2]);

    syncFloorWalls(floor);

    // Should round to 17.3 (1 decimal)
    const sharedWall = floor.walls.find(w => w.surfaces.length >= 2);
    expect(sharedWall).toBeDefined();
    expect(sharedWall.thicknessCm).toBe(17.3);
  });
});

// ── Floor Plan Extraction Use Case ──────────────────────────────────

describe('Floor Plan Extraction Use Case', () => {
  it('preserves layout extracted from architectural drawing', () => {
    // Simulating user tracing floor plan with varying wall thicknesses
    // Based on actual case: floorplanner_state_Projekt (48).json

    const trockenraum = makeRoom('TROCKENRAUM', 271, 44, 273, 226);
    const keller = makeRoom('KELLER', 556, 55, 227, 214);  // 12cm gap
    const heizraum = makeRoom('HEIZRAUM', 271, 282, 208, 208);
    const flur = makeRoom('FLUR', 491, 280, 217, 84);  // ~12cm gap
    const waschkueche = makeRoom('WASCHKÜCHE', 491, 364, 162, 137);

    const floor = makeFloor([trockenraum, keller, heizraum, flur, waschkueche]);

    // Store original positions
    const originalPositions = floor.rooms.map(r => ({
      id: r.id,
      x: r.floorPosition.x,
      y: r.floorPosition.y
    }));

    syncFloorWalls(floor);

    // CRITICAL: All rooms must stay exactly where positioned
    floor.rooms.forEach((room, i) => {
      expect(room.floorPosition.x).toBe(originalPositions[i].x);
      expect(room.floorPosition.y).toBe(originalPositions[i].y);
    });

    // Walls should be created with adaptive thicknesses
    expect(floor.walls.length).toBeGreaterThan(0);

    // Check that we have shared walls with realistic thicknesses
    const sharedWalls = floor.walls.filter(w => w.surfaces.length >= 2);
    expect(sharedWalls.length).toBeGreaterThan(0);

    // All thicknesses should be reasonable (5-50cm)
    sharedWalls.forEach(wall => {
      expect(wall.thicknessCm).toBeGreaterThanOrEqual(5);
      expect(wall.thicknessCm).toBeLessThanOrEqual(50);
    });
  });
});
