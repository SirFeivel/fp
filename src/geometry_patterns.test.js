import { describe, it, expect } from 'vitest';
import { tilesForPreview, computeAvailableArea } from './geometry.js';

function createPatternState({
  patternType = 'grid',
  tileShape = 'rect',
  roomW = 200,
  roomH = 200,
  tileW = 30,
  tileH = 10,
  grout = 0.2,
  rotationDeg = 0,
  offsetXcm = 0,
  offsetYcm = 0,
  originPreset = 'tl'
} = {}) {
  const floorId = 'floor-1';
  const roomId = 'room-1';
  return {
    floors: [{
      id: floorId,
      rooms: [{
        id: roomId,
        widthCm: roomW,
        heightCm: roomH,
        tile: { widthCm: tileW, heightCm: tileH, shape: tileShape },
        grout: { widthCm: grout },
        pattern: {
          type: patternType,
          rotationDeg: rotationDeg,
          offsetXcm: offsetXcm,
          offsetYcm: offsetYcm,
          origin: { preset: originPreset }
        }
      }]
    }],
    selectedFloorId: floorId,
    selectedRoomId: roomId
  };
}

function createRoomPolygon(width, height) {
  return [[[[0, 0], [width, 0], [width, height], [0, height], [0, 0]]]];
}

describe('Geometry Patterns Extended Tests', () => {
  const availableMP = createRoomPolygon(200, 200);

  describe('Hex Pattern', () => {
    it('generates hex tiles', () => {
      const state = createPatternState({ patternType: 'grid', tileShape: 'hex', tileW: 20 });
      const result = tilesForPreview(state, availableMP);
      expect(result.error).toBeNull();
      expect(result.tiles.length).toBeGreaterThan(0);
      // Hex tiles have 6 points (plus closing point)
      // Actually tileHexPolygon returns [[points]] where points is 7 items.
    });

    it('handles hex pattern with rotation and offset', () => {
      const state = createPatternState({ 
        patternType: 'grid', 
        tileShape: 'hex', 
        tileW: 20, 
        rotationDeg: 45,
        offsetXcm: 10,
        offsetYcm: 10
      });
      const result = tilesForPreview(state, availableMP);
      expect(result.error).toBeNull();
      expect(result.tiles.length).toBeGreaterThan(0);
    });

    it('handles hex pattern with center preset', () => {
      const state = createPatternState({ 
        patternType: 'grid', 
        tileShape: 'hex', 
        tileW: 20, 
        originPreset: 'center'
      });
      const result = tilesForPreview(state, availableMP);
      expect(result.error).toBeNull();
      expect(result.tiles.length).toBeGreaterThan(0);
    });
  });

  describe('Double Herringbone Pattern', () => {
    it('generates double herringbone tiles', () => {
      const state = createPatternState({ patternType: 'doubleHerringbone', tileW: 30, tileH: 10 });
      const result = tilesForPreview(state, availableMP);
      expect(result.error).toBeNull();
      expect(result.tiles.length).toBeGreaterThan(0);
    });

    it('handles double herringbone with rotation', () => {
      const state = createPatternState({ patternType: 'doubleHerringbone', tileW: 30, tileH: 10, rotationDeg: 30 });
      const result = tilesForPreview(state, availableMP);
      expect(result.error).toBeNull();
      expect(result.tiles.length).toBeGreaterThan(0);
    });
  });

  describe('Basketweave Pattern', () => {
    it('generates basketweave tiles', () => {
      const state = createPatternState({ patternType: 'basketweave', tileW: 30, tileH: 10 });
      const result = tilesForPreview(state, availableMP);
      expect(result.error).toBeNull();
      expect(result.tiles.length).toBeGreaterThan(0);
    });

    it('handles basketweave with offset', () => {
      const state = createPatternState({ patternType: 'basketweave', tileW: 30, tileH: 10, offsetXcm: 5 });
      const result = tilesForPreview(state, availableMP);
      expect(result.error).toBeNull();
      expect(result.tiles.length).toBeGreaterThan(0);
    });
  });

  describe('Vertical Stack Alternating Pattern', () => {
    it('generates vertical stack alternating tiles', () => {
      const state = createPatternState({ patternType: 'verticalStackAlternating', tileW: 30, tileH: 10 });
      const result = tilesForPreview(state, availableMP);
      expect(result.error).toBeNull();
      expect(result.tiles.length).toBeGreaterThan(0);
    });
  });

  describe('Origin Presets', () => {
    const presets = ['tl', 'tr', 'bl', 'br', 'center'];
    for (const preset of presets) {
      it(`handles ${preset} preset for grid pattern`, () => {
        const state = createPatternState({ patternType: 'grid', originPreset: preset });
        const result = tilesForPreview(state, availableMP);
        expect(result.error).toBeNull();
        expect(result.tiles.length).toBeGreaterThan(0);
      });
    }

    it('handles free origin', () => {
        const floorId = 'floor-1';
        const roomId = 'room-1';
        const state = {
          floors: [{
            id: floorId,
            rooms: [{
              id: roomId,
              widthCm: 200,
              heightCm: 200,
              tile: { widthCm: 30, heightCm: 10, shape: 'rect' },
              grout: { widthCm: 0.2 },
              pattern: {
                type: 'grid',
                origin: { preset: 'free', xCm: 50, yCm: 50 }
              }
            }]
          }],
          selectedFloorId: floorId,
          selectedRoomId: roomId
        };
        const result = tilesForPreview(state, availableMP);
        expect(result.error).toBeNull();
        expect(result.tiles.length).toBeGreaterThan(0);
    });
  });

  describe('Edge Cases and Errors', () => {
    it('returns error when no room is selected', () => {
      const state = { floors: [], selectedFloorId: null, selectedRoomId: null };
      const result = tilesForPreview(state, availableMP);
      expect(result.error).toBe("Kein Raum ausgewählt.");
    });

    it('returns empty tiles when tile dimensions are invalid', () => {
      const state = createPatternState({ tileW: 0 });
      const result = tilesForPreview(state, availableMP);
      expect(result.tiles).toEqual([]);
      expect(result.error).toBeNull();
    });

    it('returns error when too many tiles estimated', () => {
      const state = createPatternState({ tileW: 1, tileH: 1, roomW: 1000, roomH: 1000 });
      const result = tilesForPreview(state, availableMP);
      expect(result.error).toContain("Zu viele Fliesen");
    });
  });
});
