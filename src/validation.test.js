import { describe, it, expect } from 'vitest';
import { validateState } from './validation.js';

describe('validateState', () => {
  function createTestState(roomOverrides = {}, tileOverrides = {}, groutOverrides = {}, patternOverrides = {}) {
    return {
      floors: [{
        id: 'floor1',
        name: 'Test Floor',
        rooms: [{
          id: 'room1',
          name: 'Test Room',
          widthCm: 400,
          heightCm: 500,
          exclusions: [],
          tile: { widthCm: 30, heightCm: 60, ...tileOverrides },
          grout: { widthCm: 1, ...groutOverrides },
          pattern: {
            type: "grid",
            bondFraction: 0.5,
            rotationDeg: 0,
            offsetXcm: 0,
            offsetYcm: 0,
            origin: { preset: "tl", xCm: 0, yCm: 0 },
            ...patternOverrides
          },
          ...roomOverrides
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
    const state = createTestState({ widthCm: 0 });

    const result = validateState(state);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].title).toContain('Raumbreite');
  });

  it('detects negative room width', () => {
    const state = createTestState({ widthCm: -100 });

    const result = validateState(state);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.title.includes('Raumbreite'))).toBe(true);
  });

  it('detects invalid room height', () => {
    const state = createTestState({ heightCm: 0 });

    const result = validateState(state);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].title).toContain('Raumlänge');
  });

  it('detects invalid tile width', () => {
    const state = createTestState({}, { widthCm: 0 });

    const result = validateState(state);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].title).toContain('Fliesenbreite');
  });

  it('detects invalid tile height', () => {
    const state = createTestState({}, { heightCm: -10 });

    const result = validateState(state);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.title.includes('Fliesenlänge'))).toBe(true);
  });

  it('detects negative grout width', () => {
    const state = createTestState({}, {}, { widthCm: -1 });

    const result = validateState(state);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].title).toContain('Fuge');
  });

  it('rejects non-integer herringbone ratio', () => {
    const state = createTestState({}, { widthCm: 10, heightCm: 35 }, {}, { type: 'herringbone' });

    const result = validateState(state);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.title.includes('Herringbone'))).toBe(true);
  });

  it('accepts integer herringbone ratio', () => {
    const state = createTestState({}, { widthCm: 10, heightCm: 30 }, {}, { type: 'herringbone' });

    const result = validateState(state);
    expect(result.errors.length).toBe(0);
  });

  it('rejects invalid double herringbone ratio', () => {
    const state = createTestState({}, { widthCm: 10, heightCm: 30 }, {}, { type: 'doubleHerringbone' });

    const result = validateState(state);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.title.includes('Double'))).toBe(true);
  });

  it('accepts valid double herringbone ratio', () => {
    const state = createTestState({}, { widthCm: 10, heightCm: 40 }, {}, { type: 'doubleHerringbone' });

    const result = validateState(state);
    expect(result.errors.length).toBe(0);
  });

  it('rejects non-integer basketweave ratio', () => {
    const state = createTestState({}, { widthCm: 10, heightCm: 25 }, {}, { type: 'basketweave' });

    const result = validateState(state);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.title.includes('Basketweave'))).toBe(true);
  });

  it('accepts integer basketweave ratio', () => {
    const state = createTestState({}, { widthCm: 10, heightCm: 30 }, {}, { type: 'basketweave' });

    const result = validateState(state);
    expect(result.errors.length).toBe(0);
  });

  it('allows zero grout width', () => {
    const state = createTestState({}, {}, { widthCm: 0 });

    const result = validateState(state);
    expect(result.errors).toHaveLength(0);
  });

  it('warns about rotation outside 45 degree grid', () => {
    const state = createTestState({}, {}, {}, { rotationDeg: 30 });

    const result = validateState(state);
    expect(result.warns.length).toBeGreaterThan(0);
    expect(result.warns[0].title).toContain('Rotation');
  });

  it('accepts valid 45 degree rotation', () => {
    const state = createTestState({}, {}, {}, { rotationDeg: 45 });

    const result = validateState(state);
    expect(result.warns).toHaveLength(0);
  });

  it('accepts 90 degree rotation', () => {
    const state = createTestState({}, {}, {}, { rotationDeg: 90 });

    const result = validateState(state);
    expect(result.warns).toHaveLength(0);
  });

  it('warns about exclusion outside room bounds', () => {
    const state = createTestState({
      widthCm: 100,
      heightCm: 100,
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
      widthCm: 100,
      heightCm: 100,
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
      widthCm: 100,
      heightCm: 100,
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
      widthCm: 100,
      heightCm: 100,
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
    const state = createTestState({ widthCm: NaN });

    const result = validateState(state);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('handles undefined room dimensions', () => {
    const state = createTestState({ widthCm: undefined, heightCm: undefined });

    const result = validateState(state);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('detects string values in dimensions', () => {
    const state = createTestState({ widthCm: 'invalid' });

    const result = validateState(state);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('handles multiple validation errors', () => {
    const state = createTestState({ widthCm: 0, heightCm: 0 }, { widthCm: 0, heightCm: 0 }, { widthCm: -1 });

    const result = validateState(state);
    expect(result.errors.length).toBeGreaterThan(4);
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
});
