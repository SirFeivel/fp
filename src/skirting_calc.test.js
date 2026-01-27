import { describe, it, expect } from 'vitest';
import { computeSkirtingNeeds, computeGrandTotals } from './calc.js';

describe('computeSkirtingNeeds', () => {
  const baseState = {
    floors: [{
      id: 'f1',
      rooms: [{
        id: 'r1',
        widthCm: 100,
        heightCm: 100, // 400cm perimeter
        tile: { widthCm: 60, heightCm: 30 },
        skirting: {
          enabled: true,
          type: 'cutout',
          heightCm: 10
        }
      }]
    }],
    selectedFloorId: 'f1',
    selectedRoomId: 'r1',
    pricing: { pricePerM2: 100 }
  };

  it('calculates needs for cutout skirting (max 2 strips)', () => {
    // Perimeter 400cm.
    // Tile 60x30. Skirt height 10.
    // Strips per tile: min(2, floor(30 / 10)) = 2 strips (due to practical limit).
    // Length per tile: 60 * 2 = 120cm.
    // Tiles needed: ceil(400 / 120) = ceil(3.33) = 4 tiles.
    const result = computeSkirtingNeeds(baseState);
    expect(result.enabled).toBe(true);
    expect(result.totalLengthCm).toBe(400);
    expect(result.stripsPerTile).toBe(2);
    expect(result.additionalTiles).toBe(4);
    expect(result.totalCost).toBeCloseTo(4 * (60 * 30 / 10000) * 100); // 4 tiles * 0.18m2 * 100€ = 72€
  });

  it('yields 1 strip if tile height only allows for one', () => {
    const state = {
      ...baseState,
      floors: [{
        ...baseState.floors[0],
        rooms: [{
          ...baseState.floors[0].rooms[0],
          tile: { widthCm: 60, heightCm: 15 },
          skirting: {
            enabled: true,
            type: 'cutout',
            heightCm: 10
          }
        }]
      }]
    };
    // 15 / 10 = 1.5 -> 1 strip.
    const result = computeSkirtingNeeds(state);
    expect(result.stripsPerTile).toBe(1);
    // Each 100cm segment needs ceil(100/60) = 2 strips.
    // 4 segments * 2 strips = 8 strips.
    expect(result.additionalTiles).toBe(8); 
  });

  it('calculates needs for bought skirting', () => {
    const state = {
      ...baseState,
      floors: [{
        ...baseState.floors[0],
        rooms: [{
          ...baseState.floors[0].rooms[0],
          skirting: {
            enabled: true,
            type: 'bought',
            boughtWidthCm: 100,
            boughtPricePerPiece: 10
          }
        }]
      }]
    };
    // Perimeter 400cm. Piece length 100cm.
    // Count: 400 / 100 = 4 pieces.
    // Cost: 4 * 10 = 40.
    const result = computeSkirtingNeeds(state);
    expect(result.type).toBe('bought');
    expect(result.count).toBe(4);
    expect(result.totalCost).toBe(40);
  });

  it('considers segments for bought skirting (no wrap around)', () => {
    const state = {
      ...baseState,
      floors: [{
        ...baseState.floors[0],
        rooms: [{
          ...baseState.floors[0].rooms[0],
          widthCm: 100,
          heightCm: 10, // Perimeter: 100, 10, 100, 10. Total 220.
          skirting: {
            enabled: true,
            type: 'bought',
            boughtWidthCm: 60,
            boughtPricePerPiece: 10
          }
        }]
      }]
    };
    // Segments: 100, 10, 100, 10.
    // Piece length: 60.
    // Segment 100 needs: ceil(100/60) = 2 pieces.
    // Segment 10 needs: ceil(10/60) = 1 piece.
    // Segment 100 needs: ceil(100/60) = 2 pieces.
    // Segment 10 needs: ceil(10/60) = 1 piece.
    // Total pieces: 2 + 1 + 2 + 1 = 6 pieces.
    // (If it was perimeter based: ceil(220 / 60) = 4)
    
    const result = computeSkirtingNeeds(state);
    expect(result.count).toBe(6);
  });

  it('returns 0 strips if skirt height > tile height', () => {
    const state = {
      ...baseState,
      floors: [{
        ...baseState.floors[0],
        rooms: [{
          ...baseState.floors[0].rooms[0],
          skirting: {
            enabled: true,
            type: 'cutout',
            heightCm: 40 // Tile height is 30
          }
        }]
      }]
    };
    const result = computeSkirtingNeeds(state);
    expect(result.stripsPerTile).toBe(0);
    expect(result.additionalTiles).toBe(0);
  });
});

describe('computeGrandTotals', () => {
  const baseState = {
    floors: [{
      id: 'f1',
      rooms: [{
        id: 'r1',
        widthCm: 100,
        heightCm: 100,
        tile: { widthCm: 50, heightCm: 50 },
        grout: { widthCm: 0 },
        pattern: { type: 'grid' },
        skirting: { enabled: false }
      }]
    }],
    selectedFloorId: 'f1',
    selectedRoomId: 'r1',
    pricing: { pricePerM2: 100, packM2: 0, reserveTiles: 0 }
  };

  it('aggregates floor and cutout skirting', () => {
    // Floor: 100x100 = 4 tiles (50x50). Cost = 1m2 * 100 = 100.
    // Skirting: 400cm perimeter. Skirt height 10cm.
    // Strips per tile: min(2, 50/10) = 2.
    // Length per tile: 50 * 2 = 100cm.
    // Additional tiles: 400 / 100 = 4.
    // Total tiles: 4 (floor) + 4 (skirting) = 8 tiles.
    // Total area: 8 * (50*50/10000) = 8 * 0.25 = 2m2.
    // Total cost: 2m2 * 100 = 200.
    
    const state = {
      ...baseState,
      floors: [{
        ...baseState.floors[0],
        rooms: [{
          ...baseState.floors[0].rooms[0],
          skirting: { enabled: true, type: 'cutout', heightCm: 10 }
        }]
      }]
    };

    const result = computeGrandTotals(state);
    expect(result.ok).toBe(true);
    expect(result.totalTiles).toBe(8);
    expect(result.totalCost).toBeCloseTo(200);
    expect(result.totalAreaM2).toBeCloseTo(2.0);
  });

  it('aggregates floor and bought skirting', () => {
    // Floor: 100.
    // Skirting: 400cm perimeter. 100cm pieces. 10€ each. 4 pieces = 40€.
    // Total cost: 100 + 40 = 140.
    
    const state = {
      ...baseState,
      floors: [{
        ...baseState.floors[0],
        rooms: [{
          ...baseState.floors[0].rooms[0],
          skirting: { enabled: true, type: 'bought', boughtWidthCm: 100, boughtPricePerPiece: 10 }
        }]
      }]
    };

    const result = computeGrandTotals(state);
    expect(result.ok).toBe(true);
    expect(result.totalTiles).toBe(4); // Only floor tiles
    expect(result.totalCost).toBeCloseTo(140);
  });
});
