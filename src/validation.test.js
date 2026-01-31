import { describe, it, expect } from 'vitest';
import { validateState } from './validation.js';

describe('validateState', () => {
  function createTestState(opts = {}) {
    const widthCm = opts.hasOwnProperty('roomW') ? opts.roomW : 400;
    const heightCm = opts.hasOwnProperty('roomH') ? opts.roomH : 500;
    const sections = opts.sections || [
      { id: 'sec1', x: 0, y: 0, widthCm, heightCm }
    ];
    return {
      tilePresets: [{
        id: 'preset1',
        name: 'Standard',
        shape: 'rect',
        widthCm: 40,
        heightCm: 20,
        groutWidthCm: 0.2,
        groutColorHex: '#ffffff',
        pricePerM2: 39.9,
        packM2: 1.44,
        useForSkirting: true
      }],
      floors: [{
        id: 'floor1',
        name: 'Test Floor',
        rooms: [{
          id: 'room1',
          name: 'Test Room',
          sections,
          exclusions: opts.exclusions || [],
          tile: { widthCm: 30, heightCm: 60, reference: "Standard", ...opts.tile },
          grout: { widthCm: 1, ...opts.grout },
          pattern: {
            type: "grid",
            bondFraction: 0.5,
            rotationDeg: 0,
            offsetXcm: 0,
            offsetYcm: 0,
            origin: { preset: "tl", xCm: 0, yCm: 0 },
            ...opts.pattern
          },
          skirting: opts.skirting || { enabled: false, heightCm: 6, type: 'cutout' }
        }]
      }],
      selectedFloorId: 'floor1',
      selectedRoomId: 'room1'
    };
  }

  it('validates valid state without errors', () => {
    const state = createTestState();

    const result = validateState(state);
    expect(result.errors).toHaveLength(0);
    expect(result.warns).toHaveLength(0);
  });

  it('detects invalid room width', () => {
    const state = createTestState({ roomW: 0 });

    const result = validateState(state);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some(e => e.title.includes('Raumbreite'))).toBe(true);
  });

  it('detects negative room width', () => {
    const state = createTestState({ roomW: -100 });

    const result = validateState(state);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.title.includes('Raumbreite'))).toBe(true);
  });

  it('detects invalid room height', () => {
    const state = createTestState({ roomH: 0 });

    const result = validateState(state);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some(e => e.title.includes('Raumlänge'))).toBe(true);
  });

  it('detects invalid tile width', () => {
    const state = createTestState({ tile: { widthCm: 0 } });

    const result = validateState(state);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].title).toContain('Fliesenbreite');
  });

  it('detects invalid tile height', () => {
    const state = createTestState({ tile: { heightCm: -10 } });

    const result = validateState(state);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.title.includes('Fliesenlänge'))).toBe(true);
  });

  it('detects negative grout width', () => {
    const state = createTestState({ grout: { widthCm: -1 } });

    const result = validateState(state);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].title).toContain('Fuge');
  });

  it('rejects non-integer herringbone ratio', () => {
    const state = createTestState({ tile: { widthCm: 10, heightCm: 35 }, pattern: { type: 'herringbone' } });

    const result = validateState(state);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.title.includes('Herringbone'))).toBe(true);
  });

  it('accepts integer herringbone ratio', () => {
    const state = createTestState({ tile: { widthCm: 10, heightCm: 30 }, pattern: { type: 'herringbone' } });

    const result = validateState(state);
    expect(result.errors.length).toBe(0);
  });

  it('rejects invalid double herringbone ratio', () => {
    const state = createTestState({ tile: { widthCm: 10, heightCm: 30 }, pattern: { type: 'doubleHerringbone' } });

    const result = validateState(state);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.title.includes('Double'))).toBe(true);
  });

  it('accepts valid double herringbone ratio', () => {
    const state = createTestState({ tile: { widthCm: 10, heightCm: 40 }, pattern: { type: 'doubleHerringbone' } });

    const result = validateState(state);
    expect(result.errors.length).toBe(0);
  });

  it('rejects non-integer basketweave ratio', () => {
    const state = createTestState({ tile: { widthCm: 10, heightCm: 25 }, pattern: { type: 'basketweave' } });

    const result = validateState(state);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.title.includes('Basketweave'))).toBe(true);
  });

  it('accepts integer basketweave ratio', () => {
    const state = createTestState({ tile: { widthCm: 10, heightCm: 30 }, pattern: { type: 'basketweave' } });

    const result = validateState(state);
    expect(result.errors.length).toBe(0);
  });

  it('allows zero grout width', () => {
    const state = createTestState({ grout: { widthCm: 0 } });

    const result = validateState(state);
    expect(result.errors).toHaveLength(0);
  });

  it('warns about rotation outside 45 degree grid', () => {
    const state = createTestState({ pattern: { rotationDeg: 30 } });

    const result = validateState(state);
    expect(result.warns.length).toBeGreaterThan(0);
    expect(result.warns[0].title).toContain('Rotation');
  });

  it('accepts valid 45 degree rotation', () => {
    const state = createTestState({ pattern: { rotationDeg: 45 } });

    const result = validateState(state);
    expect(result.warns).toHaveLength(0);
  });

  it('accepts 90 degree rotation', () => {
    const state = createTestState({ pattern: { rotationDeg: 90 } });

    const result = validateState(state);
    expect(result.warns).toHaveLength(0);
  });

  it('warns about exclusion outside room bounds', () => {
    const state = createTestState({
      roomW: 100,
      roomH: 100,
      exclusions: [
        {
          id: '1',
          type: 'rect',
          label: 'Test',
          x: 90,
          y: 90,
          w: 20,
          h: 20,
        },
      ]
    });

    const result = validateState(state);
    expect(result.warns.length).toBeGreaterThan(0);
    expect(result.warns[0].title).toContain('Ausschluss');
  });

  it('accepts exclusion within room bounds', () => {
    const state = createTestState({
      roomW: 100,
      roomH: 100,
      exclusions: [
        {
          id: '1',
          type: 'rect',
          label: 'Test',
          x: 10,
          y: 10,
          w: 20,
          h: 20,
        },
      ]
    });

    const result = validateState(state);
    expect(result.warns).toHaveLength(0);
  });

  it('warns about circle exclusion outside room bounds', () => {
    const state = createTestState({
      roomW: 100,
      roomH: 100,
      exclusions: [
        {
          id: '1',
          type: 'circle',
          label: 'Test',
          cx: 95,
          cy: 95,
          r: 10,
        },
      ]
    });

    const result = validateState(state);
    expect(result.warns.length).toBeGreaterThan(0);
  });

  it('warns about triangle exclusion outside room bounds', () => {
    const state = createTestState({
      roomW: 100,
      roomH: 100,
      exclusions: [
        {
          id: '1',
          type: 'tri',
          label: 'Test',
          p1: { x: 90, y: 90 },
          p2: { x: 110, y: 90 },
          p3: { x: 100, y: 110 },
        },
      ]
    });

    const result = validateState(state);
    expect(result.warns.length).toBeGreaterThan(0);
  });

  it('handles NaN values in room dimensions', () => {
    const state = createTestState({ roomW: NaN });

    const result = validateState(state);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('handles undefined room dimensions', () => {
    const state = createTestState({ roomW: undefined, roomH: undefined });

    const result = validateState(state);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('detects string values in dimensions', () => {
    const state = createTestState({ roomW: 'invalid' });

    const result = validateState(state);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('handles multiple validation errors', () => {
    const state = createTestState({ roomW: 0, roomH: 0, tile: { widthCm: 0, heightCm: 0 }, grout: { widthCm: -1 } });

    const result = validateState(state);
    expect(result.errors.length).toBeGreaterThan(2);
  });

  it('handles empty state', () => {
    const state = {};

    const result = validateState(state);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('handles missing exclusions array', () => {
    const state = createTestState();
    delete state.floors[0].rooms[0].exclusions;

    const result = validateState(state);
    expect(() => validateState(state)).not.toThrow();
  });
  it('validates skirting with invalid height', () => {
    const state = createTestState({ 
      skirting: { enabled: true, heightCm: 0, type: 'cutout' }
    });

    const result = validateState(state);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].text).toContain('Höhe');
  });

  it('validates bought skirting with invalid length', () => {
    const state = createTestState({
      skirting: { enabled: true, heightCm: 6, type: 'bought', boughtWidthCm: 0 }
    });

    const result = validateState(state);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].text).toContain('Länge');
  });

  describe('free-form rooms (polygonVertices)', () => {
    function createFreeFormState(opts = {}) {
      // Create a triangular room with polygonVertices
      const polygonVertices = opts.polygonVertices || [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
        { x: 100, y: 150 }
      ];
      return {
        tilePresets: [{
          id: 'preset1',
          name: 'Standard',
          shape: 'rect',
          widthCm: 40,
          heightCm: 20,
          groutWidthCm: 0.2,
          groutColorHex: '#ffffff',
          pricePerM2: 39.9,
          packM2: 1.44,
          useForSkirting: true
        }],
        floors: [{
          id: 'floor1',
          name: 'Test Floor',
          rooms: [{
            id: 'room1',
            name: 'Test Room',
            polygonVertices,
            // No sections array - this is a free-form room
            exclusions: opts.exclusions || [],
            tile: { widthCm: 30, heightCm: 60, reference: "Standard", ...opts.tile },
            grout: { widthCm: 1, ...opts.grout },
            pattern: {
              type: "grid",
              bondFraction: 0.5,
              rotationDeg: 0,
              offsetXcm: 0,
              offsetYcm: 0,
              origin: { preset: "tl", xCm: 0, yCm: 0 },
              ...opts.pattern
            },
            skirting: opts.skirting || { enabled: false, heightCm: 6, type: 'cutout' }
          }]
        }],
        selectedFloorId: 'floor1',
        selectedRoomId: 'room1'
      };
    }

    it('validates free-form room with polygonVertices without errors', () => {
      const state = createFreeFormState();

      const result = validateState(state);
      // Should not have "invalid room width" error
      expect(result.errors.filter(e => e.title.includes('Raumbreite'))).toHaveLength(0);
    });

    it('calculates room bounds from polygonVertices', () => {
      const state = createFreeFormState({
        polygonVertices: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 100, y: 100 },
          { x: 0, y: 100 }
        ],
        exclusions: [
          { id: '1', type: 'rect', label: 'Test', x: 90, y: 90, w: 20, h: 20 }
        ]
      });

      const result = validateState(state);
      // Should warn about exclusion outside bounds (100x100 room, exclusion extends to 110x110)
      expect(result.warns.some(w => w.title.includes('Ausschluss'))).toBe(true);
    });

    it('accepts free-form room with valid tile configuration', () => {
      const state = createFreeFormState({
        tile: { widthCm: 30, heightCm: 60 }
      });

      const result = validateState(state);
      expect(result.errors.filter(e => e.title.includes('Fliesen'))).toHaveLength(0);
    });

    it('detects invalid tile in free-form room', () => {
      const state = createFreeFormState({
        tile: { widthCm: 0, heightCm: 60 }
      });

      const result = validateState(state);
      expect(result.errors.some(e => e.title.includes('Fliesenbreite'))).toBe(true);
    });

    it('handles free-form room with only 2 vertices as invalid', () => {
      const state = createFreeFormState({
        polygonVertices: [
          { x: 0, y: 0 },
          { x: 100, y: 0 }
        ]
      });

      const result = validateState(state);
      // With only 2 vertices, it's not a valid polygon, should trigger room invalid error
      expect(result.errors.some(e => e.title.includes('Raumbreite'))).toBe(true);
    });
  });
});
