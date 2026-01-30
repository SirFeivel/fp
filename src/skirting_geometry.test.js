import { describe, it, expect } from 'vitest';
import { computeSkirtingPerimeter, computeSkirtingArea, multiPolygonToPathD } from './geometry.js';

describe('computeSkirtingPerimeter', () => {
  it('calculates perimeter for a simple rectangular room', () => {
    const room = {
      sections: [{ id: 's1', x: 0, y: 0, widthCm: 100, heightCm: 200, skirtingEnabled: true }],
      exclusions: [],
      skirting: { enabled: true }
    };
    // (100 + 200) * 2 = 600
    expect(computeSkirtingPerimeter(room)).toBeCloseTo(600);
  });

  it('calculates perimeter for a room with sections (L-shape)', () => {
    const room = {
      sections: [
        { x: 0, y: 0, widthCm: 100, heightCm: 100, skirtingEnabled: true },
        { x: 100, y: 0, widthCm: 100, heightCm: 200, skirtingEnabled: true }
      ],
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

  it('calculates perimeter including an internal exclusion', () => {
    const room = {
      sections: [{ id: 's1', x: 0, y: 0, widthCm: 500, heightCm: 500, skirtingEnabled: true }],
      skirting: { enabled: true },
      exclusions: [
        { id: 'ex1', type: 'rect', x: 100, y: 100, w: 50, h: 50, skirtingEnabled: true }
      ]
    };
    // Room perimeter: 500 * 4 = 2000
    // Exclusion perimeter: 50 * 4 = 200
    // Total: 2200
    expect(computeSkirtingPerimeter(room)).toBeCloseTo(2200);
  });

  it('calculates perimeter for an exclusion on the edge (cutout)', () => {
    const room = {
      sections: [{ id: 's1', x: 0, y: 0, widthCm: 500, heightCm: 500, skirtingEnabled: true }],
      skirting: { enabled: true },
      exclusions: [
        { id: 'ex1', type: 'rect', x: 0, y: 100, w: 50, h: 50, skirtingEnabled: true }
      ]
    };
    // Room was 0->500 width.
    // Exclusion at x=0, width 50. 
    // New boundary:
    // x=0 from y=0 to 100 (100)
    // y=100 from x=0 to 50 (50)
    // x=50 from y=100 to 150 (50)
    // y=150 from x=50 to 0 (50)
    // x=0 from y=150 to 500 (350)
    // Bottom: 500
    // Right: 500
    // Top: 500
    // Total: 100 + 50 + 50 + 50 + 350 + 500 + 500 + 500 = 2100
    // (Original 2000 - 50 (removed edge) + 50 + 50 + 50 (new edges) = 2100)
    expect(computeSkirtingPerimeter(room)).toBeCloseTo(2100);
  });

  it('returns 0 for null room', () => {
    expect(computeSkirtingPerimeter(null)).toBe(0);
  });

  it('ignores exclusions that have skirting disabled', () => {
    const room = {
      sections: [{ id: 's1', x: 0, y: 0, widthCm: 500, heightCm: 500, skirtingEnabled: true }],
      skirting: { enabled: true },
      exclusions: [
        { id: 'ex1', type: 'rect', x: 100, y: 100, w: 50, h: 50, skirtingEnabled: false }
      ]
    };
    // Room perimeter: 500 * 4 = 2000
    // Exclusion is ignored for skirting.
    expect(computeSkirtingPerimeter(room)).toBeCloseTo(2000);
  });

  it('keeps wall skirting when a disabled exclusion touches the boundary', () => {
    const room = {
      sections: [{ id: 's1', x: 0, y: 0, widthCm: 200, heightCm: 100, skirtingEnabled: true }],
      skirting: { enabled: true },
      exclusions: [
        { id: 'ex1', type: 'rect', x: 0, y: 20, w: 30, h: 30, skirtingEnabled: false }
      ]
    };
    // Room perimeter: 200 * 2 + 100 * 2 = 600
    // Exclusion touches wall; only the overlap is removed from wall skirting.
    expect(computeSkirtingPerimeter(room)).toBeCloseTo(570);
  });

  it('ignores sections that have skirting disabled', () => {
    const room = {
      sections: [
        { id: 's1', x: 0, y: 0, widthCm: 100, heightCm: 100, skirtingEnabled: true },
        { id: 's2', x: 100, y: 0, widthCm: 100, heightCm: 100, skirtingEnabled: false }
      ],
      exclusions: []
    };
    // The second section is removed from the active geometry.
    // Perimeter of section 1: 100 * 4 = 400.
    // BUT the inner border is removed, so 300.
    const result = computeSkirtingPerimeter(room);
    expect(result).toBeLessThan(600); // Should definitely be less than the merged 200x100 perimeter
    expect(result).toBeCloseTo(300);
  });

  it('allows skirting on exclusions even if room/sections are disabled', () => {
    const room = {
      sections: [{ id: 's1', x: 0, y: 0, widthCm: 500, heightCm: 500, skirtingEnabled: false }],
      skirting: { enabled: false }, // Room walls OFF
      exclusions: [
        { id: 'ex1', type: 'rect', x: 100, y: 100, w: 50, h: 50, skirtingEnabled: true } // Pillar ON
      ]
    };
    // Only exclusion perimeter: 50 * 4 = 200
    expect(computeSkirtingPerimeter(room)).toBeCloseTo(200);
  });

  it('skips room walls when room skirting is disabled but keeps exclusions', () => {
    const room = {
      sections: [{ id: 's1', x: 0, y: 0, widthCm: 200, heightCm: 100, skirtingEnabled: true }],
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
});
