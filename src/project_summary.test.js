import { describe, it, expect, beforeEach } from 'vitest';
import { computeProjectTotals, computeGrandTotals, clearMetricsCache } from './calc.js';

beforeEach(() => clearMetricsCache());

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
              polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }], // 1m2
              tile: { widthCm: 50, heightCm: 50 },
              grout: { widthCm: 0 },
              pattern: { type: 'grid' },
              skirting: { enabled: false }
            },
            {
              id: 'r2',
              polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }], // 1m2
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
    // Each 1m² room with 50x50 tiles = exactly 4 tiles, 2 rooms = 8 tiles
    expect(result.totalTiles).toBe(8);
    // 2m² * 10€/m² = 20€
    expect(result.totalCost).toBeCloseTo(20, 2);
    // 2m² / 2m²-per-pack = 1 pack
    expect(result.totalPacks).toBe(1);
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
              polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
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
              polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
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
    // 2 rooms * 1 tile (100x100 room with 100x100 tile) = 2 tiles
    expect(result.totalTiles).toBe(2);
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
              polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
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

  it('single floor room counted in project totals', () => {
    const state = {
      meta: { version: 4 },
      pricing: { packM2: 1, pricePerM2: 10, reserveTiles: 0 },
      floors: [
        {
          id: 'f1',
          rooms: [
            {
              id: 'r1',
              polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
              tile: { widthCm: 50, heightCm: 50 },
              grout: { widthCm: 0 },
              pattern: { type: 'grid' },
              skirting: { enabled: false }
            }
          ]
        }
      ]
    };

    const result = computeProjectTotals(state);
    expect(result.roomCount).toBe(1);
    expect(result.totalNetAreaM2).toBeCloseTo(1, 2);
    // 100x100 room with 50x50 tiles = 4 tiles
    expect(result.totalTiles).toBe(4);
  });

  it('computeGrandTotals with invalid tiles returns ok:false', () => {
    const state = {
      meta: { version: 4 },
      pricing: { pricePerM2: 10, packM2: 1, reserveTiles: 0 },
      floors: [{
        id: 'f1',
        rooms: [{
          id: 'r1',
          polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
          tile: { widthCm: 0, heightCm: 0 },
          grout: { widthCm: 0 },
          pattern: { type: 'grid' },
          skirting: { enabled: false }
        }]
      }],
      selectedFloorId: 'f1',
      selectedRoomId: 'r1',
    };

    const result = computeGrandTotals(state);
    expect(result.ok).toBe(false);
  });

  it('grand totals combine floor and skirting', () => {
    const state = {
      meta: { version: 4 },
      pricing: { pricePerM2: 100, packM2: 1, reserveTiles: 0 },
      floors: [{
        id: 'f1',
        rooms: [{
          id: 'r1',
          polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
          tile: { widthCm: 50, heightCm: 50 },
          grout: { widthCm: 0 },
          pattern: { type: 'grid' },
          skirting: { enabled: true, type: 'cutout', heightCm: 10 }
        }]
      }],
      selectedFloorId: 'f1',
      selectedRoomId: 'r1',
    };

    const room = state.floors[0].rooms[0];
    const result = computeGrandTotals(state, room);
    expect(result.ok).toBe(true);
    // 100x100 room with 50x50 tiles = 4 floor tiles
    expect(result.floorTiles).toBe(4);
    // Skirting: perimeter 400cm / 50cm tile width = 8 strips, 10cm/50cm = 2 strips per tile → 4 tiles
    expect(result.skirtingTiles).toBe(4);
    expect(result.totalTiles).toBe(result.floorTiles + result.skirtingTiles);
    expect(result.totalCost).toBeGreaterThan(0);
  });

  it('project totals with mixed materials across floors', () => {
    const state = {
      meta: { version: 4 },
      pricing: { pricePerM2: 50, packM2: 1, reserveTiles: 0 },
      materials: {
        'Marble': { pricePerM2: 100, packM2: 2 },
        'Slate': { pricePerM2: 60, packM2: 1.5 },
      },
      floors: [
        {
          id: 'f1',
          rooms: [{
            id: 'r1',
            polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
            tile: { widthCm: 50, heightCm: 50, reference: 'Marble' },
            grout: { widthCm: 0 },
            pattern: { type: 'grid' },
            skirting: { enabled: false }
          }]
        },
        {
          id: 'f2',
          rooms: [{
            id: 'r2',
            polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
            tile: { widthCm: 50, heightCm: 50, reference: 'Slate' },
            grout: { widthCm: 0 },
            pattern: { type: 'grid' },
            skirting: { enabled: false }
          }]
        }
      ]
    };

    const result = computeProjectTotals(state);
    expect(result.roomCount).toBe(2);
    expect(result.materials.length).toBe(2);

    const marble = result.materials.find(m => m.reference === 'Marble');
    const slate = result.materials.find(m => m.reference === 'Slate');
    expect(marble).not.toBeUndefined();
    expect(slate).not.toBeUndefined();
    expect(marble.pricePerM2).toBe(100);
    expect(slate.pricePerM2).toBe(60);
    // Each room is 1m², 50x50 tiles = 4 tiles each
    expect(marble.totalTiles).toBe(4);
    expect(slate.totalTiles).toBe(4);
    expect(marble.netAreaM2).toBeCloseTo(1, 2);
    expect(slate.netAreaM2).toBeCloseTo(1, 2);
  });
});
