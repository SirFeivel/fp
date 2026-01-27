import { describe, it, expect } from 'vitest';
import { tilesForPreview } from './geometry.js';
import { getCurrentRoom } from './core.js';

describe('Tile Removal', () => {
  it('identifies excluded tiles when includeExcluded is true', () => {
    const state = {
      floors: [{
        id: 'f1',
        rooms: [{
          id: 'r1',
          name: 'Room 1',
          sections: [{ x: 0, y: 0, widthCm: 100, heightCm: 100 }],
          tile: { widthCm: 50, heightCm: 50, shape: 'rect' },
          pattern: { type: 'grid' },
          excludedTiles: []
        }]
      }],
      selectedFloorId: 'f1',
      selectedRoomId: 'r1',
      view: {}
    };

    const availableMP = [[[ [0,0], [100,0], [100,100], [0,100], [0,0] ]]];

    // First, get all tiles to find a valid ID
    const initial = tilesForPreview(state, availableMP, false);
    const totalTiles = initial.tiles.length;
    expect(totalTiles).toBeGreaterThan(0);
    const targetId = initial.tiles[0].id;
    
    // Mark one as excluded
    state.floors[0].rooms[0].excludedTiles = [targetId];
    
    // Normal mode: excluded tile should be missing
    const resNormal = tilesForPreview(state, availableMP, false);
    expect(resNormal.tiles.length).toBe(totalTiles - 1);
    expect(resNormal.tiles.find(t => t.id === targetId)).toBeUndefined();

    // Removal mode: excluded tile should be present and marked
    const resRemoval = tilesForPreview(state, availableMP, true);
    expect(resRemoval.tiles.length).toBe(totalTiles);
    const excludedTile = resRemoval.tiles.find(t => t.id === targetId);
    expect(excludedTile).toBeDefined();
    expect(excludedTile.excluded).toBe(true);
  });
});
