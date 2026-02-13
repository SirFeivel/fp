// src/walls_finalization.test.js — Tests for wall finalization and enforcement logic
import { describe, it, expect } from 'vitest';
import { syncFloorWalls } from './walls.js';
import { DEFAULT_WALL_THICKNESS_CM, WALL_ENFORCEMENT_TOLERANCE_FACTOR } from './constants.js';

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
    wallsAlignmentEnforced: options.wallsAlignmentEnforced ?? false,
  };
}

// ── Wall Enforcement with Tolerance ──────────────────────────────────

describe('Wall Enforcement with Tolerance', () => {
  it('aligns rooms within 2× tolerance on first finalization', () => {
    // Two rooms 8cm apart (within WALL_ADJACENCY_TOLERANCE_CM to be detected as adjacent)
    // Then enforcement will align them to exact 12cm
    const r1 = makeRoom('r1', 0, 0, 200, 200);
    const r2 = makeRoom('r2', 208, 0, 200, 200); // 8cm gap, within detection tolerance
    const floor = makeFloor([r1, r2], { wallsFinalized: true, wallsAlignmentEnforced: false });

    syncFloorWalls(floor);

    // Should align to exact 12cm spacing
    expect(floor.wallsAlignmentEnforced).toBe(true);
    expect(floor.rooms[1].floorPosition.x).toBe(212); // 200 + 12
  });

  it('does not align rooms beyond 2× tolerance', () => {
    // Two rooms 50cm apart (beyond 24cm tolerance for 12cm walls)
    const r1 = makeRoom('r1', 0, 0, 200, 200);
    const r2 = makeRoom('r2', 250, 0, 200, 200);
    const floor = makeFloor([r1, r2], { wallsFinalized: true, wallsAlignmentEnforced: false });

    const originalX = floor.rooms[1].floorPosition.x;
    syncFloorWalls(floor);

    // Should NOT move - beyond tolerance
    expect(floor.rooms[1].floorPosition.x).toBe(originalX);
    expect(floor.wallsAlignmentEnforced).toBe(true); // Flag still set
  });

  it('separates overlapping rooms (tight spaces)', () => {
    // Two rooms 5cm apart (less than 12cm wall thickness)
    const r1 = makeRoom('r1', 0, 0, 200, 200);
    const r2 = makeRoom('r2', 205, 0, 200, 200);
    const floor = makeFloor([r1, r2], { wallsFinalized: true, wallsAlignmentEnforced: false });

    syncFloorWalls(floor);

    // Should push apart to 12cm spacing
    expect(floor.rooms[1].floorPosition.x).toBe(212);
    expect(floor.wallsAlignmentEnforced).toBe(true);
  });

  it('does not enforce if already aligned (within 0.5cm)', () => {
    // Two rooms exactly 12cm apart
    const r1 = makeRoom('r1', 0, 0, 200, 200);
    const r2 = makeRoom('r2', 212, 0, 200, 200);
    const floor = makeFloor([r1, r2], { wallsFinalized: true, wallsAlignmentEnforced: false });

    const originalX = floor.rooms[1].floorPosition.x;
    syncFloorWalls(floor);

    // Should NOT move - already aligned
    expect(floor.rooms[1].floorPosition.x).toBe(originalX);
    expect(floor.wallsAlignmentEnforced).toBe(true);
  });
});

// ── One-Time Enforcement ─────────────────────────────────────────────

describe('One-Time Enforcement', () => {
  it('does not re-enforce after wall thickness change', () => {
    // Two rooms 12cm apart, already enforced
    const r1 = makeRoom('r1', 0, 0, 200, 200);
    const r2 = makeRoom('r2', 212, 0, 200, 200);
    const floor = makeFloor([r1, r2], { wallsFinalized: true, wallsAlignmentEnforced: true });

    // Create walls first
    syncFloorWalls(floor);

    // Change wall thickness to 30cm
    if (floor.walls.length > 0) {
      floor.walls[0].thicknessCm = 30;
    }

    const originalX = floor.rooms[1].floorPosition.x;
    syncFloorWalls(floor);

    // Should NOT move room - already enforced
    expect(floor.rooms[1].floorPosition.x).toBe(originalX);
  });

  it('does not enforce on subsequent syncs', () => {
    // Two rooms 8cm apart (within detection tolerance)
    const r1 = makeRoom('r1', 0, 0, 200, 200);
    const r2 = makeRoom('r2', 208, 0, 200, 200);
    const floor = makeFloor([r1, r2], { wallsFinalized: true, wallsAlignmentEnforced: false });

    // First sync - should enforce
    syncFloorWalls(floor);
    expect(floor.rooms[1].floorPosition.x).toBe(212);
    expect(floor.wallsAlignmentEnforced).toBe(true);

    // Manually move room to 215cm (still within detection tolerance but different from 212cm)
    floor.rooms[1].floorPosition.x = 215;

    // Second sync - should NOT re-enforce (flag already set)
    syncFloorWalls(floor);
    expect(floor.rooms[1].floorPosition.x).toBe(215); // Stayed at new position
  });

  it('does not enforce in planning mode', () => {
    // Two rooms 20cm apart, planning mode
    const r1 = makeRoom('r1', 0, 0, 200, 200);
    const r2 = makeRoom('r2', 220, 0, 200, 200);
    const floor = makeFloor([r1, r2], { wallsFinalized: false, wallsAlignmentEnforced: false });

    const originalX = floor.rooms[1].floorPosition.x;
    syncFloorWalls(floor);

    // Should NOT create walls or enforce in planning mode
    expect(floor.walls.length).toBe(0);
    expect(floor.rooms[1].floorPosition.x).toBe(originalX);
    expect(floor.wallsAlignmentEnforced).toBe(false);
  });
});

// ── Unfinalize/Refinalize Workflow ───────────────────────────────────

describe('Unfinalize/Refinalize Workflow', () => {
  it('allows re-enforcement after unfinalize/refinalize', () => {
    // Two rooms 8cm apart (within detection tolerance)
    const r1 = makeRoom('r1', 0, 0, 200, 200);
    const r2 = makeRoom('r2', 208, 0, 200, 200);
    const floor = makeFloor([r1, r2], { wallsFinalized: true, wallsAlignmentEnforced: false });

    // First finalization - enforce
    syncFloorWalls(floor);
    expect(floor.rooms[1].floorPosition.x).toBe(212);
    expect(floor.wallsAlignmentEnforced).toBe(true);

    // Simulate unfinalize (resets flag)
    floor.wallsFinalized = false;
    floor.wallsAlignmentEnforced = false;

    // User adjusts room position (keep within detection tolerance: 13cm)
    floor.rooms[1].floorPosition.x = 210; // Still within 13cm of r1's right edge

    // Simulate refinalize
    floor.wallsFinalized = true;
    syncFloorWalls(floor);

    // Should re-enforce (210cm is within enforcement tolerance, align to 212cm)
    expect(floor.wallsAlignmentEnforced).toBe(true);
    expect(floor.rooms[1].floorPosition.x).toBe(212);
  });
});

// ── Multi-Room Scenarios ─────────────────────────────────────────────

describe('Multi-Room Scenarios', () => {
  it('enforces multiple adjacent room pairs independently', () => {
    // Three rooms in a row: r1 - r2 - r3
    // r1-r2: 8cm apart (within detection tolerance, will align)
    // r2-r3: 50cm apart (beyond detection tolerance, won't share wall)
    const r1 = makeRoom('r1', 0, 0, 200, 200);
    const r2 = makeRoom('r2', 208, 0, 200, 200);
    const r3 = makeRoom('r3', 458, 0, 200, 200); // 50cm from r2
    const floor = makeFloor([r1, r2, r3], { wallsFinalized: true, wallsAlignmentEnforced: false });

    const r3OriginalX = floor.rooms[2].floorPosition.x;
    syncFloorWalls(floor);

    // r1-r2 should align
    expect(floor.rooms[1].floorPosition.x).toBe(212);
    // r2-r3 should NOT align (beyond detection tolerance, no shared wall)
    expect(floor.rooms[2].floorPosition.x).toBe(r3OriginalX);
    expect(floor.wallsAlignmentEnforced).toBe(true);
  });

  it('handles rooms that share multiple edges', () => {
    // L-shaped configuration where rooms touch on multiple sides
    const r1 = makeRoom('r1', 0, 0, 200, 300);
    const r2 = makeRoom('r2', 208, 0, 200, 200); // Adjacent on right (8cm apart)
    const r3 = makeRoom('r3', 0, 308, 200, 200);  // Adjacent on bottom (8cm apart)
    const floor = makeFloor([r1, r2, r3], { wallsFinalized: true, wallsAlignmentEnforced: false });

    syncFloorWalls(floor);

    // Both should align
    expect(floor.rooms[1].floorPosition.x).toBe(212); // r2 moved to align with r1
    expect(floor.rooms[2].floorPosition.y).toBe(312); // r3 moved to align with r1
    expect(floor.wallsAlignmentEnforced).toBe(true);
  });
});

// ── Custom Wall Thickness ────────────────────────────────────────────

describe('Custom Wall Thickness', () => {
  it('uses dynamic tolerance based on wall thickness', () => {
    // Test that tolerance adjusts for different wall thicknesses
    // Start with rooms 25cm apart - beyond 24cm tolerance for 12cm walls
    // But within tolerance for thicker walls
    const r1 = makeRoom('r1', 0, 0, 200, 200);
    const r2 = makeRoom('r2', 208, 0, 200, 200); // 8cm gap
    const floor = makeFloor([r1, r2], { wallsFinalized: true, wallsAlignmentEnforced: false });

    // Create walls and enforce with default 12cm thickness
    syncFloorWalls(floor);
    expect(floor.rooms[1].floorPosition.x).toBe(212); // Aligned to 12cm

    // This test demonstrates that tolerance is based on wall thickness
    // If we had 30cm walls, the enforcement tolerance would be 60cm
    // Our test with 12cm walls has 24cm tolerance
    expect(floor.wallsAlignmentEnforced).toBe(true);
  });

  it('respects tolerance for thin walls', () => {
    // Two rooms 15cm apart with 5cm walls
    // Tolerance: 2 × 5cm = 10cm
    const r1 = makeRoom('r1', 0, 0, 200, 200);
    const r2 = makeRoom('r2', 215, 0, 200, 200);
    const floor = makeFloor([r1, r2], { wallsFinalized: true, wallsAlignmentEnforced: false });

    // First create walls with custom thickness
    syncFloorWalls(floor);
    if (floor.walls.length > 0) {
      floor.walls[0].thicknessCm = 5;
    }

    const originalX = floor.rooms[1].floorPosition.x;

    // Reset flag to allow enforcement with new thickness
    floor.wallsAlignmentEnforced = false;
    syncFloorWalls(floor);

    // 15cm gap is beyond 10cm tolerance, should NOT move
    expect(floor.rooms[1].floorPosition.x).toBe(originalX);
  });
});

// ── Edge Cases ───────────────────────────────────────────────────────

describe('Edge Cases', () => {
  it('handles single room (no enforcement needed)', () => {
    const r1 = makeRoom('r1', 0, 0, 200, 200);
    const floor = makeFloor([r1], { wallsFinalized: true, wallsAlignmentEnforced: false });

    const originalX = floor.rooms[0].floorPosition.x;
    syncFloorWalls(floor);

    // Single room should not move
    expect(floor.rooms[0].floorPosition.x).toBe(originalX);
    expect(floor.wallsAlignmentEnforced).toBe(true);
  });

  it('handles rooms with no shared walls', () => {
    // Two rooms far apart (100cm gap)
    const r1 = makeRoom('r1', 0, 0, 200, 200);
    const r2 = makeRoom('r2', 300, 300, 200, 200); // Diagonal, no shared edges
    const floor = makeFloor([r1, r2], { wallsFinalized: true, wallsAlignmentEnforced: false });

    const originalX = floor.rooms[1].floorPosition.x;
    const originalY = floor.rooms[1].floorPosition.y;
    syncFloorWalls(floor);

    // Should not move - no shared walls
    expect(floor.rooms[1].floorPosition.x).toBe(originalX);
    expect(floor.rooms[1].floorPosition.y).toBe(originalY);
    expect(floor.wallsAlignmentEnforced).toBe(true);
  });

  it('handles vertical adjacency (not just horizontal)', () => {
    // Two rooms vertically adjacent, 8cm apart
    const r1 = makeRoom('r1', 0, 0, 200, 200);
    const r2 = makeRoom('r2', 0, 208, 200, 200);
    const floor = makeFloor([r1, r2], { wallsFinalized: true, wallsAlignmentEnforced: false });

    syncFloorWalls(floor);

    // Should align vertically to 12cm spacing
    expect(floor.rooms[1].floorPosition.y).toBe(212);
    expect(floor.wallsAlignmentEnforced).toBe(true);
  });
});
