/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { tilesForPreview } from './geometry.js';
import { createRemovalController } from './removal.js';

describe('Tile Removal', () => {
  it('identifies excluded tiles when includeExcluded is true', () => {
    const state = {
      floors: [{
        id: 'f1',
        rooms: [{
          id: 'r1',
          name: 'Room 1',
          polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
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

  it('toggles a tile exclusion via removal handler', () => {
    const state = {
      floors: [{
        id: 'f1',
        rooms: [{
          id: 'r1',
          name: 'Room 1',
          polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
          tile: { widthCm: 50, heightCm: 50, shape: 'rect' },
          pattern: { type: 'grid' },
          excludedTiles: []
        }]
      }],
      selectedFloorId: 'f1',
      selectedRoomId: 'r1',
      view: { removalMode: true }
    };

    const availableMP = [[[ [0,0], [100,0], [100,100], [0,100], [0,0] ]]];
    const initial = tilesForPreview(state, availableMP, true);
    const targetId = initial.tiles[0].id;

    const store = {
      getState: () => state,
      commit: (_label, next) => {
        state.floors = next.floors;
        state.selectedFloorId = next.selectedFloorId;
        state.selectedRoomId = next.selectedRoomId;
        state.view = next.view;
      }
    };

    const removal = createRemovalController(store, () => {});
    const path = document.createElement('path');
    path.setAttribute('data-tileid', targetId);

    removal.handlePlanClick({ target: path, stopPropagation() {}, preventDefault() {} });
    expect(state.floors[0].rooms[0].excludedTiles).toContain(targetId);
  });
});
