import { describe, it, expect } from 'vitest';
import {
  roomPolygon,
  multiPolygonToPathD,
  rotatePoint2,
  tileRectPolygon,
  ringArea,
  multiPolyArea,
  exclusionToPolygon,
  computeExclusionsUnion,
  computeAvailableArea,
  computeOriginPoint,
} from './geometry.js';

describe('roomPolygon', () => {
  it('creates correct polygon for room dimensions', () => {
    const room = { widthCm: 100, heightCm: 200 };
    const result = roomPolygon(room);

    expect(result).toEqual([
      [
        [
          [0, 0],
          [100, 0],
          [100, 200],
          [0, 200],
          [0, 0],
        ],
      ],
    ]);
  });

  it('handles zero dimensions', () => {
    const room = { widthCm: 0, heightCm: 0 };
    const result = roomPolygon(room);

    expect(result[0][0]).toHaveLength(5);
  });
});

describe('multiPolygonToPathD', () => {
  it('converts simple polygon to SVG path', () => {
    const mp = [
      [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
      ],
    ];

    const result = multiPolygonToPathD(mp);
    expect(result).toBe('M 0 0 L 10 0 L 10 10 L 0 10 L 0 0 Z');
  });

  it('handles empty polygon', () => {
    const result = multiPolygonToPathD([]);
    expect(result).toBe('');
  });

  it('handles polygon with empty rings', () => {
    const mp = [[[]]];
    const result = multiPolygonToPathD(mp);
    expect(result).toBe('');
  });
});

describe('rotatePoint2', () => {
  it('rotates point 90 degrees', () => {
    const result = rotatePoint2(10, 0, 0, 0, Math.PI / 2);

    expect(result.x).toBeCloseTo(0, 10);
    expect(result.y).toBeCloseTo(10, 10);
  });

  it('rotates point 180 degrees', () => {
    const result = rotatePoint2(10, 0, 0, 0, Math.PI);

    expect(result.x).toBeCloseTo(-10, 10);
    expect(result.y).toBeCloseTo(0, 10);
  });

  it('rotates around custom origin', () => {
    const result = rotatePoint2(20, 10, 10, 10, Math.PI / 2);

    expect(result.x).toBeCloseTo(10, 10);
    expect(result.y).toBeCloseTo(20, 10);
  });

  it('no rotation returns same point', () => {
    const result = rotatePoint2(5, 5, 0, 0, 0);

    expect(result.x).toBe(5);
    expect(result.y).toBe(5);
  });
});

describe('tileRectPolygon', () => {
  it('creates unrotated tile polygon', () => {
    const result = tileRectPolygon(0, 0, 10, 20, 0, 0, 0);

    expect(result).toEqual([
      [
        [
          [0, 0],
          [10, 0],
          [10, 20],
          [0, 20],
          [0, 0],
        ],
      ],
    ]);
  });

  it('creates rotated tile polygon', () => {
    const result = tileRectPolygon(0, 0, 10, 10, 0, 0, Math.PI / 2);

    const points = result[0][0];
    expect(points[0][0]).toBeCloseTo(0, 10);
    expect(points[0][1]).toBeCloseTo(0, 10);
    expect(points[1][0]).toBeCloseTo(0, 10);
    expect(points[1][1]).toBeCloseTo(10, 10);
  });
});

describe('ringArea', () => {
  it('calculates area of square', () => {
    const ring = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ];

    const result = Math.abs(ringArea(ring));
    expect(result).toBe(100);
  });

  it('calculates area of triangle', () => {
    const ring = [
      [0, 0],
      [10, 0],
      [5, 10],
      [0, 0],
    ];

    const result = Math.abs(ringArea(ring));
    expect(result).toBe(50);
  });

  it('handles single point', () => {
    const ring = [[0, 0]];
    const result = ringArea(ring);
    expect(result).toBe(0);
  });
});

describe('multiPolyArea', () => {
  it('calculates area of simple polygon', () => {
    const mp = [
      [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
      ],
    ];

    const result = multiPolyArea(mp);
    expect(result).toBe(100);
  });

  it('handles polygon with hole', () => {
    const mp = [
      [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
        [
          [2, 2],
          [8, 2],
          [8, 8],
          [2, 8],
          [2, 2],
        ],
      ],
    ];

    const result = multiPolyArea(mp);
    expect(result).toBe(64);
  });

  it('handles empty multipolygon', () => {
    const result = multiPolyArea([]);
    expect(result).toBe(0);
  });

  it('handles null input', () => {
    const result = multiPolyArea(null);
    expect(result).toBe(0);
  });

  it('handles multiple polygons', () => {
    const mp = [
      [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
      ],
      [
        [
          [20, 20],
          [30, 20],
          [30, 30],
          [20, 30],
          [20, 20],
        ],
      ],
    ];

    const result = multiPolyArea(mp);
    expect(result).toBe(200);
  });
});

describe('exclusionToPolygon', () => {
  it('converts rectangle exclusion', () => {
    const ex = { type: 'rect', x: 5, y: 10, w: 20, h: 30 };
    const result = exclusionToPolygon(ex);

    expect(result).toEqual([
      [
        [
          [5, 10],
          [25, 10],
          [25, 40],
          [5, 40],
          [5, 10],
        ],
      ],
    ]);
  });

  it('converts circle exclusion', () => {
    const ex = { type: 'circle', cx: 50, cy: 50, r: 10 };
    const result = exclusionToPolygon(ex);

    expect(result).toBeDefined();
    expect(result[0][0].length).toBeGreaterThan(10);

    const firstPoint = result[0][0][0];
    expect(firstPoint[0]).toBeCloseTo(60, 5);
    expect(firstPoint[1]).toBeCloseTo(50, 5);
  });

  it('converts triangle exclusion', () => {
    const ex = {
      type: 'tri',
      p1: { x: 0, y: 0 },
      p2: { x: 10, y: 0 },
      p3: { x: 5, y: 10 },
    };
    const result = exclusionToPolygon(ex);

    expect(result).toEqual([
      [
        [
          [0, 0],
          [10, 0],
          [5, 10],
          [0, 0],
        ],
      ],
    ]);
  });

  it('returns null for invalid type', () => {
    const ex = { type: 'invalid' };
    const result = exclusionToPolygon(ex);
    expect(result).toBeNull();
  });
});

describe('computeExclusionsUnion', () => {
  it('handles empty exclusions', () => {
    const result = computeExclusionsUnion([]);
    expect(result.mp).toBeNull();
    expect(result.error).toBeNull();
  });

  it('handles null exclusions', () => {
    const result = computeExclusionsUnion(null);
    expect(result.mp).toBeNull();
    expect(result.error).toBeNull();
  });

  it('handles single exclusion', () => {
    const exclusions = [{ type: 'rect', x: 0, y: 0, w: 10, h: 10 }];
    const result = computeExclusionsUnion(exclusions);

    expect(result.error).toBeNull();
    expect(result.mp).toBeDefined();
  });

  it('handles multiple non-overlapping exclusions', () => {
    const exclusions = [
      { type: 'rect', x: 0, y: 0, w: 10, h: 10 },
      { type: 'rect', x: 20, y: 20, w: 10, h: 10 },
    ];
    const result = computeExclusionsUnion(exclusions);

    expect(result.error).toBeNull();
    expect(result.mp).toBeDefined();
    expect(result.mp.length).toBe(2);
  });
});

describe('computeAvailableArea', () => {
  it('returns full room when no exclusions', () => {
    const room = { widthCm: 100, heightCm: 100 };
    const result = computeAvailableArea(room, []);

    expect(result.error).toBeNull();
    expect(result.mp).toBeDefined();

    const area = multiPolyArea(result.mp);
    expect(area).toBe(10000);
  });

  it('subtracts exclusion from room', () => {
    const room = { widthCm: 100, heightCm: 100 };
    const exclusions = [{ type: 'rect', x: 0, y: 0, w: 50, h: 50 }];
    const result = computeAvailableArea(room, exclusions);

    expect(result.error).toBeNull();
    expect(result.mp).toBeDefined();

    const area = multiPolyArea(result.mp);
    expect(area).toBe(7500);
  });

  it('handles exclusion covering entire room', () => {
    const room = { widthCm: 100, heightCm: 100 };
    const exclusions = [{ type: 'rect', x: 0, y: 0, w: 100, h: 100 }];
    const result = computeAvailableArea(room, exclusions);

    expect(result.mp).toBeDefined();
    const area = multiPolyArea(result.mp);
    expect(area).toBeCloseTo(0, 1);
  });
});

describe('computeOriginPoint', () => {
  const room = { widthCm: 100, heightCm: 200 };

  it('computes top-left origin', () => {
    const pattern = { origin: { preset: 'tl' } };
    const result = computeOriginPoint(room, pattern);
    expect(result).toEqual({ x: 0, y: 0 });
  });

  it('computes top-right origin', () => {
    const pattern = { origin: { preset: 'tr' } };
    const result = computeOriginPoint(room, pattern);
    expect(result).toEqual({ x: 100, y: 0 });
  });

  it('computes bottom-left origin', () => {
    const pattern = { origin: { preset: 'bl' } };
    const result = computeOriginPoint(room, pattern);
    expect(result).toEqual({ x: 0, y: 200 });
  });

  it('computes bottom-right origin', () => {
    const pattern = { origin: { preset: 'br' } };
    const result = computeOriginPoint(room, pattern);
    expect(result).toEqual({ x: 100, y: 200 });
  });

  it('computes center origin', () => {
    const pattern = { origin: { preset: 'center' } };
    const result = computeOriginPoint(room, pattern);
    expect(result).toEqual({ x: 50, y: 100 });
  });

  it('computes free origin', () => {
    const pattern = { origin: { preset: 'free', xCm: 25, yCm: 75 } };
    const result = computeOriginPoint(room, pattern);
    expect(result).toEqual({ x: 25, y: 75 });
  });

  it('defaults to top-left when no pattern', () => {
    const result = computeOriginPoint(room, null);
    expect(result).toEqual({ x: 0, y: 0 });
  });

  it('handles invalid coordinates in free origin', () => {
    const pattern = { origin: { preset: 'free', xCm: 'invalid', yCm: null } };
    const result = computeOriginPoint(room, pattern);
    expect(result).toEqual({ x: 0, y: 0 });
  });
});
