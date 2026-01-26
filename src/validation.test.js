import { describe, it, expect } from 'vitest';
import { validateState } from './validation.js';

describe('validateState', () => {
  it('validates valid state without errors', () => {
    const state = {
      room: { widthCm: 400, heightCm: 500 },
      tile: { widthCm: 30, heightCm: 60 },
      grout: { widthCm: 1 },
      pattern: { rotationDeg: 0 },
      exclusions: [],
    };

    const result = validateState(state);
    expect(result.errors).toHaveLength(0);
    expect(result.warns).toHaveLength(0);
  });

  it('detects invalid room width', () => {
    const state = {
      room: { widthCm: 0, heightCm: 500 },
      tile: { widthCm: 30, heightCm: 60 },
      grout: { widthCm: 1 },
    };

    const result = validateState(state);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].title).toContain('Raumbreite');
  });

  it('detects negative room width', () => {
    const state = {
      room: { widthCm: -100, heightCm: 500 },
      tile: { widthCm: 30, heightCm: 60 },
      grout: { widthCm: 1 },
    };

    const result = validateState(state);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.title.includes('Raumbreite'))).toBe(true);
  });

  it('detects invalid room height', () => {
    const state = {
      room: { widthCm: 400, heightCm: 0 },
      tile: { widthCm: 30, heightCm: 60 },
      grout: { widthCm: 1 },
    };

    const result = validateState(state);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].title).toContain('Raumlänge');
  });

  it('detects invalid tile width', () => {
    const state = {
      room: { widthCm: 400, heightCm: 500 },
      tile: { widthCm: 0, heightCm: 60 },
      grout: { widthCm: 1 },
    };

    const result = validateState(state);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].title).toContain('Fliesenbreite');
  });

  it('detects invalid tile height', () => {
    const state = {
      room: { widthCm: 400, heightCm: 500 },
      tile: { widthCm: 30, heightCm: -10 },
      grout: { widthCm: 1 },
    };

    const result = validateState(state);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.title.includes('Fliesenlänge'))).toBe(true);
  });

  it('detects negative grout width', () => {
    const state = {
      room: { widthCm: 400, heightCm: 500 },
      tile: { widthCm: 30, heightCm: 60 },
      grout: { widthCm: -1 },
    };

    const result = validateState(state);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].title).toContain('Fuge');
  });

  it('allows zero grout width', () => {
    const state = {
      room: { widthCm: 400, heightCm: 500 },
      tile: { widthCm: 30, heightCm: 60 },
      grout: { widthCm: 0 },
    };

    const result = validateState(state);
    expect(result.errors).toHaveLength(0);
  });

  it('warns about rotation outside 45 degree grid', () => {
    const state = {
      room: { widthCm: 400, heightCm: 500 },
      tile: { widthCm: 30, heightCm: 60 },
      grout: { widthCm: 1 },
      pattern: { rotationDeg: 30 },
    };

    const result = validateState(state);
    expect(result.warns.length).toBeGreaterThan(0);
    expect(result.warns[0].title).toContain('Rotation');
  });

  it('accepts valid 45 degree rotation', () => {
    const state = {
      room: { widthCm: 400, heightCm: 500 },
      tile: { widthCm: 30, heightCm: 60 },
      grout: { widthCm: 1 },
      pattern: { rotationDeg: 45 },
    };

    const result = validateState(state);
    expect(result.warns).toHaveLength(0);
  });

  it('accepts 90 degree rotation', () => {
    const state = {
      room: { widthCm: 400, heightCm: 500 },
      tile: { widthCm: 30, heightCm: 60 },
      grout: { widthCm: 1 },
      pattern: { rotationDeg: 90 },
    };

    const result = validateState(state);
    expect(result.warns).toHaveLength(0);
  });

  it('warns about exclusion outside room bounds', () => {
    const state = {
      room: { widthCm: 100, heightCm: 100 },
      tile: { widthCm: 30, heightCm: 60 },
      grout: { widthCm: 1 },
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
      ],
    };

    const result = validateState(state);
    expect(result.warns.length).toBeGreaterThan(0);
    expect(result.warns[0].title).toContain('Ausschluss');
  });

  it('accepts exclusion within room bounds', () => {
    const state = {
      room: { widthCm: 100, heightCm: 100 },
      tile: { widthCm: 30, heightCm: 60 },
      grout: { widthCm: 1 },
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
      ],
    };

    const result = validateState(state);
    expect(result.warns).toHaveLength(0);
  });

  it('warns about circle exclusion outside room bounds', () => {
    const state = {
      room: { widthCm: 100, heightCm: 100 },
      tile: { widthCm: 30, heightCm: 60 },
      grout: { widthCm: 1 },
      exclusions: [
        {
          id: '1',
          type: 'circle',
          label: 'Test',
          cx: 95,
          cy: 95,
          r: 10,
        },
      ],
    };

    const result = validateState(state);
    expect(result.warns.length).toBeGreaterThan(0);
  });

  it('warns about triangle exclusion outside room bounds', () => {
    const state = {
      room: { widthCm: 100, heightCm: 100 },
      tile: { widthCm: 30, heightCm: 60 },
      grout: { widthCm: 1 },
      exclusions: [
        {
          id: '1',
          type: 'tri',
          label: 'Test',
          p1: { x: 90, y: 90 },
          p2: { x: 110, y: 90 },
          p3: { x: 100, y: 110 },
        },
      ],
    };

    const result = validateState(state);
    expect(result.warns.length).toBeGreaterThan(0);
  });

  it('handles NaN values in room dimensions', () => {
    const state = {
      room: { widthCm: NaN, heightCm: 500 },
      tile: { widthCm: 30, heightCm: 60 },
      grout: { widthCm: 1 },
    };

    const result = validateState(state);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('handles undefined room dimensions', () => {
    const state = {
      room: { widthCm: undefined, heightCm: undefined },
      tile: { widthCm: 30, heightCm: 60 },
      grout: { widthCm: 1 },
    };

    const result = validateState(state);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('detects string values in dimensions', () => {
    const state = {
      room: { widthCm: '400', heightCm: 500 },
      tile: { widthCm: 30, heightCm: 60 },
      grout: { widthCm: 1 },
    };

    const result = validateState(state);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('handles multiple validation errors', () => {
    const state = {
      room: { widthCm: 0, heightCm: 0 },
      tile: { widthCm: 0, heightCm: 0 },
      grout: { widthCm: -1 },
    };

    const result = validateState(state);
    expect(result.errors.length).toBeGreaterThan(4);
  });

  it('handles empty state', () => {
    const state = {};

    const result = validateState(state);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('handles missing exclusions array', () => {
    const state = {
      room: { widthCm: 400, heightCm: 500 },
      tile: { widthCm: 30, heightCm: 60 },
      grout: { widthCm: 1 },
    };

    const result = validateState(state);
    expect(() => validateState(state)).not.toThrow();
  });
});
