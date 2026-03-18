import { describe, it, expect } from 'vitest';
import { computeSkirtingPerimeter, computeSkirtingArea, multiPolygonToPathD } from './geometry.js';

describe('computeSkirtingPerimeter', () => {
  it('calculates perimeter for a simple rectangular room', () => {
    const room = {
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 200 }, { x: 0, y: 200 }],
      exclusions: [],
      skirting: { enabled: true }
    };
    // (100 + 200) * 2 = 600
    expect(computeSkirtingPerimeter(room)).toBeCloseTo(600);
  });

  it('calculates perimeter for an L-shaped room with polygonVertices', () => {
    const room = {
      // L-shape: 200 wide at top, 100 wide at bottom, heights 100 and 200
      polygonVertices: [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
        { x: 200, y: 200 },
        { x: 100, y: 200 },
        { x: 100, y: 100 },
        { x: 0, y: 100 }
      ],
      skirting: { enabled: true },
      exclusions: []
    };
    // Outer perimeter:
    // Top: 200
    // Right: 200
    // Bottom: 100
    // Up: 100
    // Left: 100
    // Left: 100
    // Total: 200 + 200 + 100 + 100 + 100 + 100 = 800
    expect(computeSkirtingPerimeter(room)).toBeCloseTo(800);
  });

  it('2D exclusion does not add skirting perimeter (only 3D objects do)', () => {
    const room = {
      polygonVertices: [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 500 }, { x: 0, y: 500 }],
      skirting: { enabled: true },
      exclusions: [
        { id: 'ex1', type: 'rect', x: 100, y: 100, w: 50, h: 50, skirtingEnabled: true }
      ]
    };
    // 2D exclusions are zones/voids, not vertical objects — no skirting contribution.
    // Only room perimeter: 500 * 4 = 2000
    expect(computeSkirtingPerimeter(room)).toBeCloseTo(2000);
  });

  it('2D exclusion on edge does not interrupt room wall skirting', () => {
    const room = {
      polygonVertices: [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 500 }, { x: 0, y: 500 }],
      skirting: { enabled: true },
      exclusions: [
        { id: 'ex1', type: 'rect', x: 0, y: 100, w: 50, h: 50, skirtingEnabled: true }
      ]
    };
    // 2D exclusions don't affect skirting at all — room walls run uninterrupted.
    // Room perimeter: 500 * 4 = 2000
    expect(computeSkirtingPerimeter(room)).toBeCloseTo(2000);
  });

  it('returns 0 for null room', () => {
    expect(computeSkirtingPerimeter(null)).toBe(0);
  });

  it('ignores exclusions that have skirting disabled', () => {
    const room = {
      polygonVertices: [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 500 }, { x: 0, y: 500 }],
      skirting: { enabled: true },
      exclusions: [
        { id: 'ex1', type: 'rect', x: 100, y: 100, w: 50, h: 50, skirtingEnabled: false }
      ]
    };
    // Room perimeter: 500 * 4 = 2000
    // Exclusion is ignored for skirting.
    expect(computeSkirtingPerimeter(room)).toBeCloseTo(2000);
  });

  it('2D exclusion touching boundary does not interrupt wall skirting', () => {
    const room = {
      polygonVertices: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 0, y: 100 }],
      skirting: { enabled: true },
      exclusions: [
        { id: 'ex1', type: 'rect', x: 0, y: 20, w: 30, h: 30, skirtingEnabled: false }
      ]
    };
    // 2D exclusions don't affect skirting at all — room walls run uninterrupted.
    // Room perimeter: 200 * 2 + 100 * 2 = 600
    expect(computeSkirtingPerimeter(room)).toBeCloseTo(600);
  });

  it('handles room with no skirting enabled', () => {
    // Test that room skirting can be disabled
    const room = {
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
      skirting: { enabled: false },
      exclusions: []
    };
    // With skirting disabled, only exclusion skirting is counted
    const result = computeSkirtingPerimeter(room);
    expect(result).toBe(0);
  });

  it('2D exclusion produces no skirting even when room skirting is disabled', () => {
    const room = {
      polygonVertices: [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 500 }, { x: 0, y: 500 }],
      skirting: { enabled: false },
      exclusions: [
        { id: 'ex1', type: 'rect', x: 100, y: 100, w: 50, h: 50, skirtingEnabled: true }
      ]
    };
    // 2D exclusions never add skirting; room skirting disabled → result = 0
    expect(computeSkirtingPerimeter(room)).toBeCloseTo(0);
  });

  it('keeps exclusion skirting when room skirting is disabled', () => {
    const room = {
      polygonVertices: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 0, y: 100 }],
      skirting: { enabled: false },
      exclusions: [
        { id: 'ex1', type: 'rect', x: 50, y: 20, w: 30, h: 30, skirtingEnabled: true }
      ]
    };

    const { mp } = computeSkirtingArea(room, room.exclusions);
    expect(mp).toBeDefined();

    const d = multiPolygonToPathD(mp || []);
    expect(d).not.toContain("0 0");
    expect(d).toContain("50 20");
  });

  it('calculates perimeter for freeform room with polygonVertices', () => {
    const room = {
      polygonVertices: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 }
      ],
      exclusions: [],
      skirting: { enabled: true }
    };
    // Square 100x100: perimeter = 400
    expect(computeSkirtingPerimeter(room)).toBeCloseTo(400);
  });

  it('calculates skirting area for freeform L-shaped room', () => {
    const room = {
      polygonVertices: [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
        { x: 200, y: 100 },
        { x: 100, y: 100 },
        { x: 100, y: 200 },
        { x: 0, y: 200 }
      ],
      exclusions: [],
      skirting: { enabled: true }
    };
    const { mp, error } = computeSkirtingArea(room, room.exclusions);
    expect(error).toBeNull();
    expect(mp).toBeDefined();
    expect(mp.length).toBeGreaterThan(0);
  });

  it('handles freeform room with exclusion — only room perimeter counts', () => {
    const room = {
      polygonVertices: [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
        { x: 200, y: 200 },
        { x: 0, y: 200 }
      ],
      exclusions: [
        { id: 'ex1', type: 'rect', x: 50, y: 50, w: 30, h: 30, skirtingEnabled: true }
      ],
      skirting: { enabled: true }
    };
    // 2D exclusion has no skirting contribution. Room perimeter: 200 * 4 = 800
    expect(computeSkirtingPerimeter(room)).toBeCloseTo(800);
  });

  it('returns null for freeform room when skirting is disabled', () => {
    const room = {
      polygonVertices: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 }
      ],
      exclusions: [],
      skirting: { enabled: false }
    };
    const { mp } = computeSkirtingArea(room, room.exclusions);
    expect(mp).toBeNull();
  });
});
