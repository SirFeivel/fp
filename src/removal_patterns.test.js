import { describe, it, expect } from 'vitest';
import { tilesForPreview } from './geometry.js';

function createPatternState({
  patternType = 'grid',
  tileShape = 'rect',
  roomW = 100,
  roomH = 100,
  tileW = 20,
  tileH = 10,
  excludedTiles = []
} = {}) {
  const floorId = 'floor-1';
  const roomId = 'room-1';
  return {
    floors: [{
      id: floorId,
      rooms: [{
        id: roomId,
        polygonVertices: [
          { x: 0, y: 0 },
          { x: roomW, y: 0 },
          { x: roomW, y: roomH },
          { x: 0, y: roomH }
        ],
        tile: { widthCm: tileW, heightCm: tileH, shape: tileShape },
        grout: { widthCm: 0.2 },
        pattern: {
          type: patternType,
          rotationDeg: 0,
          offsetXcm: 0,
          offsetYcm: 0,
          origin: { preset: 'tl' }
        },
        excludedTiles
      }]
    }],
    selectedFloorId: floorId,
    selectedRoomId: roomId,
    view: { removalMode: true }
  };
}

function createRoomPolygon(width, height) {
  return [[[[0, 0], [width, 0], [width, height], [0, height], [0, 0]]]];
}

describe('Removal Mode Pattern Consistency', () => {
  const availableMP = createRoomPolygon(100, 100);

  const patterns = [
    { type: 'grid', idPrefix: 'r' },
    { type: 'runningBond', idPrefix: 'r' },
    { type: 'herringbone', idPrefix: 'hb-' },
    { type: 'doubleHerringbone', idPrefix: 'dhb-' },
    { type: 'basketweave', idPrefix: 'bw-' },
    { type: 'verticalStackAlternating', idPrefix: 'vsa-' }
  ];

  for (const pattern of patterns) {
    it(`supports excluded tiles for ${pattern.type} pattern`, () => {
      // We first need to know some valid ID for this pattern
      const initialState = createPatternState({ patternType: pattern.type });
      const initialResult = tilesForPreview(initialState, availableMP, true);
      expect(initialResult.tiles.length).toBeGreaterThan(0);
      
      const targetTile = initialResult.tiles[0];
      expect(targetTile.id).toBeDefined();
      expect(targetTile.id).toContain(pattern.idPrefix);

      // Now exclude it
      const state = createPatternState({ 
        patternType: pattern.type, 
        excludedTiles: [targetTile.id] 
      });
      const result = tilesForPreview(state, availableMP, true);
      
      const excludedTile = result.tiles.find(t => t.id === targetTile.id);
      expect(excludedTile, `Tile ${targetTile.id} should be present in results`).toBeDefined();
      expect(excludedTile.excluded, `Tile ${targetTile.id} should be marked as excluded`).toBe(true);
    });
  }

  it('supports excluded tiles for hex shape', () => {
    const initialState = createPatternState({ tileShape: 'hex', tileW: 20 });
    const initialResult = tilesForPreview(initialState, availableMP, true);
    const targetTile = initialResult.tiles[0];
    
    const state = createPatternState({ 
      tileShape: 'hex', 
      tileW: 20, 
      excludedTiles: [targetTile.id] 
    });
    const result = tilesForPreview(state, availableMP, true);
    const excludedTile = result.tiles.find(t => t.id === targetTile.id);
    expect(excludedTile.excluded).toBe(true);
  });

  it('supports excluded tiles for rhombus shape', () => {
    const initialState = createPatternState({ tileShape: 'rhombus', tileW: 20, tileH: 10 });
    const initialResult = tilesForPreview(initialState, availableMP, true);
    const targetTile = initialResult.tiles[0];
    
    const state = createPatternState({ 
      tileShape: 'rhombus', 
      tileW: 20, 
      tileH: 10,
      excludedTiles: [targetTile.id] 
    });
    const result = tilesForPreview(state, availableMP, true);
    const excludedTile = result.tiles.find(t => t.id === targetTile.id);
    expect(excludedTile.excluded).toBe(true);
  });
});
