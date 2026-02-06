import { describe, it, expect } from 'vitest';
import { computeProjectTotals, computeGrandTotals } from './calc.js';

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

  it('walls excluded from project totals', () => {
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
            },
            {
              id: 'w1',
              sourceRoomId: 'r1',
              polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }],
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
    // Only the floor room should be counted
    expect(result.roomCount).toBe(1);
    expect(result.rooms.length).toBe(1);
    expect(result.totalNetAreaM2).toBeCloseTo(1, 2);

    // wallRooms should have the wall
    expect(result.wallRooms.length).toBe(1);
    expect(result.wallRooms[0].sourceRoomId).toBe('r1');
    expect(result.wallTotalTiles).toBeGreaterThan(0);
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
    expect(result.floorTiles).toBeGreaterThan(0);
    expect(result.skirtingTiles).toBeGreaterThan(0);
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
    expect(marble).toBeDefined();
    expect(slate).toBeDefined();
    expect(marble.pricePerM2).toBe(100);
    expect(slate.pricePerM2).toBe(60);
  });
});
