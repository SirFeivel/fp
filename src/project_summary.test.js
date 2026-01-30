import { describe, it, expect } from 'vitest';
import { computeProjectTotals } from './calc.js';

describe('computeProjectTotals', () => {
  it('sums up multiple rooms correctly', () => {
    const state = {
      meta: { version: 4 },
      pricing: { packM2: 2, pricePerM2: 10, reserveTiles: 0 },
      floors: [
        {
          id: 'f1',
          rooms: [
            {
              id: 'r1',
              sections: [{ x: 0, y: 0, widthCm: 100, heightCm: 100 }], // 1m2
              tile: { widthCm: 50, heightCm: 50 },
              grout: { widthCm: 0 },
              pattern: { type: 'grid' },
              skirting: { enabled: false }
            },
            {
              id: 'r2',
              sections: [{ x: 0, y: 0, widthCm: 100, heightCm: 100 }], // 1m2
              tile: { widthCm: 50, heightCm: 50 },
              grout: { widthCm: 0 },
              pattern: { type: 'grid' },
              skirting: { enabled: false }
            }
          ]
        }
      ]
    };

    // Each room is 1m2 net. With 50x50 tiles, each room needs exactly 4 tiles if they fit perfectly.
    // However, the calc engine might add reserve or handle edges differently.
    
    const result = computeProjectTotals(state);
    expect(result.roomCount).toBe(2);
    expect(result.totalNetAreaM2).toBeCloseTo(2, 2);
    expect(result.totalTiles).toBeGreaterThanOrEqual(8);
    expect(result.totalCost).toBeGreaterThanOrEqual(20);
    expect(result.totalPacks).toBeGreaterThanOrEqual(1);
  });

  it('handles multiple floors', () => {
    const state = {
      meta: { version: 4 },
      pricing: { packM2: 1, pricePerM2: 10, reserveTiles: 0 },
      floors: [
        {
          id: 'f1',
          rooms: [
            {
              id: 'r1',
              sections: [{ x: 0, y: 0, widthCm: 100, heightCm: 100 }],
              tile: { widthCm: 100, heightCm: 100 },
              grout: { widthCm: 0 },
              pattern: { type: 'grid' },
              skirting: { enabled: false }
            }
          ]
        },
        {
          id: 'f2',
          rooms: [
            {
              id: 'r2',
              sections: [{ x: 0, y: 0, widthCm: 100, heightCm: 100 }],
              tile: { widthCm: 100, heightCm: 100 },
              grout: { widthCm: 0 },
              pattern: { type: 'grid' },
              skirting: { enabled: false }
            }
          ]
        }
      ]
    };

    const result = computeProjectTotals(state);
    expect(result.roomCount).toBe(2);
    expect(result.totalNetAreaM2).toBeCloseTo(2, 2);
    expect(result.totalTiles).toBeGreaterThanOrEqual(2);
  });

  it('returns zero totals for empty project', () => {
    const state = {
      meta: { version: 4 },
      floors: []
    };
    const result = computeProjectTotals(state);
    expect(result.roomCount).toBe(0);
    expect(result.totalTiles).toBe(0);
  });

  it('splits packs between floor and cutout skirting', () => {
    const state = {
      meta: { version: 4 },
      pricing: { packM2: 1, pricePerM2: 10, reserveTiles: 0 },
      floors: [
        {
          id: 'f1',
          rooms: [
            {
              id: 'r1',
              sections: [{ x: 0, y: 0, widthCm: 100, heightCm: 100 }],
              tile: { widthCm: 50, heightCm: 50 },
              grout: { widthCm: 0 },
              pattern: { type: 'grid' },
              skirting: { enabled: true, type: 'cutout', heightCm: 10 }
            }
          ]
        }
      ]
    };

    const result = computeProjectTotals(state);
    const mat = result.materials[0];

    expect(mat.totalPacks).toBe(2);
    expect(mat.floorPacks).toBe(1);
    expect(mat.skirtingPacks).toBe(1);
  });
});
