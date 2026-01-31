import { describe, it, expect } from 'vitest';
import polygonClipping from 'polygon-clipping';
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
  tilesForPreviewHerringbone,
  tilesForPreview,
} from './geometry.js';

function pathDToPolygon(d) {
  const commands = d.match(/[MLZ][^MLZ]*/g) || [];
  const points = [];

  for (const cmd of commands) {
    const type = cmd[0];
    if (type === 'M' || type === 'L') {
      const nums = cmd
        .slice(1)
        .trim()
        .split(/[\s,]+/)
        .map((x) => Number(x))
        .filter((x) => Number.isFinite(x));
      if (nums.length >= 2) points.push([nums[0], nums[1]]);
    }
  }

  if (points.length < 3) return null;
  const first = points[0];
  const last = points[points.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    points.push([first[0], first[1]]);
  }

  return [[points]];
}

function herringboneState({ roomW = 100, roomH = 200, tileW = 10, tileH = 20, grout = 0.2 } = {}) {
  return {
    floors: [{
      id: 'floor-1',
      rooms: [{
        id: 'room-1',
        sections: [{ id: 'sec1', x: 0, y: 0, widthCm: roomW, heightCm: roomH }],
        tile: { widthCm: tileW, heightCm: tileH },
        grout: { widthCm: grout },
        pattern: {
          type: 'herringbone',
          rotationDeg: 0,
          offsetXcm: 0,
          offsetYcm: 0,
          origin: { preset: 'tl' }
        }
      }]
    }],
    selectedFloorId: 'floor-1',
    selectedRoomId: 'room-1'
  };
}

function createPatternState({
  patternType = 'grid',
  roomW = 120,
  roomH = 120,
  tileW = 30,
  tileH = 10,
  grout = 0.2
} = {}) {
  return {
    floors: [{
      id: 'floor-1',
      rooms: [{
        id: 'room-1',
        sections: [{ id: 'sec1', x: 0, y: 0, widthCm: roomW, heightCm: roomH }],
        tile: { widthCm: tileW, heightCm: tileH, shape: 'rect' },
        grout: { widthCm: grout },
        pattern: {
          type: patternType,
          rotationDeg: 0,
          offsetXcm: 0,
          offsetYcm: 0,
          origin: { preset: 'tl' }
        }
      }]
    }],
    selectedFloorId: 'floor-1',
    selectedRoomId: 'room-1'
  };
}

function overlapArea(polys) {
  let area = 0;
  for (let i = 0; i < polys.length; i++) {
    for (let j = i + 1; j < polys.length; j++) {
      const inter = polygonClipping.intersection(polys[i], polys[j]);
      if (inter && inter.length) {
        area += multiPolyArea(inter);
      }
    }
  }
  return area;
}

function createRoomPolygon(width, height) {
  return [[[[0, 0], [width, 0], [width, height], [0, height], [0, 0]]]];
}

describe('roomPolygon', () => {
  it('creates correct polygon for room dimensions', () => {
    const room = { sections: [{ id: 's1', x: 0, y: 0, widthCm: 100, heightCm: 200 }] };
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
    const room = { sections: [{ id: 's1', x: 0, y: 0, widthCm: 0, heightCm: 0 }] };
    const result = roomPolygon(room);

    expect(result).toBeDefined();
    expect(Array.isArray(result)).toBe(true);
  });

  it('creates correct polygon for free-form room with polygonVertices', () => {
    const room = {
      polygonVertices: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 50, y: 100 }
      ]
    };
    const result = roomPolygon(room);

    // Should return MultiPolygon format: [Polygon[Ring[Point]]]
    expect(result).toEqual([
      [
        [
          [0, 0],
          [100, 0],
          [50, 100],
          [0, 0]  // Closed ring
        ]
      ]
    ]);
  });

  it('closes free-form polygon ring if not already closed', () => {
    const room = {
      polygonVertices: [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
        { x: 200, y: 150 },
        { x: 0, y: 150 }
      ]
    };
    const result = roomPolygon(room);

    // Last point should equal first point (closed ring)
    const ring = result[0][0];
    expect(ring[ring.length - 1]).toEqual(ring[0]);
  });

  it('does not double-close already closed free-form polygon', () => {
    const room = {
      polygonVertices: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
        { x: 0, y: 0 }  // Already closed
      ]
    };
    const result = roomPolygon(room);

    const ring = result[0][0];
    // Should have exactly 5 points, not 6
    expect(ring.length).toBe(5);
  });

  it('prefers polygonVertices over sections when both exist', () => {
    const room = {
      polygonVertices: [
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 25, y: 50 }
      ],
      sections: [{ id: 's1', x: 0, y: 0, widthCm: 100, heightCm: 200 }]
    };
    const result = roomPolygon(room);

    // Should use polygonVertices (triangle), not sections (rectangle)
    expect(result[0][0].length).toBe(4);  // Triangle has 3 points + closing point
    expect(result[0][0][0]).toEqual([0, 0]);
    expect(result[0][0][1]).toEqual([50, 0]);
    expect(result[0][0][2]).toEqual([25, 50]);
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
    const room = { sections: [{ id: 's1', x: 0, y: 0, widthCm: 100, heightCm: 100 }] };
    const result = computeAvailableArea(room, []);

    expect(result.error).toBeNull();
    expect(result.mp).toBeDefined();

    const area = multiPolyArea(result.mp);
    expect(area).toBe(10000);
  });

  it('subtracts exclusion from room', () => {
    const room = { sections: [{ id: 's1', x: 0, y: 0, widthCm: 100, heightCm: 100 }] };
    const exclusions = [{ type: 'rect', x: 0, y: 0, w: 50, h: 50 }];
    const result = computeAvailableArea(room, exclusions);

    expect(result.error).toBeNull();
    expect(result.mp).toBeDefined();

    const area = multiPolyArea(result.mp);
    expect(area).toBe(7500);
  });

  it('handles exclusion covering entire room', () => {
    const room = { sections: [{ id: 's1', x: 0, y: 0, widthCm: 100, heightCm: 100 }] };
    const exclusions = [{ type: 'rect', x: 0, y: 0, w: 100, h: 100 }];
    const result = computeAvailableArea(room, exclusions);

    expect(result.mp).toBeDefined();
    const area = multiPolyArea(result.mp);
    expect(area).toBeCloseTo(0, 1);
  });
});

describe('computeOriginPoint', () => {
  const room = { sections: [{ id: 's1', x: 0, y: 0, widthCm: 100, heightCm: 200 }] };

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

describe('tilesForPreviewHerringbone', () => {
  // Helper to create minimal state for testing
  function createTestState(roomWidth, roomHeight, tileWidth, tileHeight, grout = 0) {
    return {
      floors: [{
        id: 'floor-1',
        rooms: [{
          id: 'room-1',
          sections: [{ id: 'sec1', x: 0, y: 0, widthCm: roomWidth, heightCm: roomHeight }],
          tile: { widthCm: tileWidth, heightCm: tileHeight },
          grout: { widthCm: grout },
          pattern: {
            type: 'herringbone',
            rotationDeg: 0,
            offsetXcm: 0,
            offsetYcm: 0,
            origin: { preset: 'tl' }
          }
        }]
      }],
      selectedFloorId: 'floor-1',
      selectedRoomId: 'room-1'
    };
  }

  // Helper to create available area polygon
  function createRoomPolygon(width, height) {
    return [[[[0, 0], [width, 0], [width, height], [0, height], [0, 0]]]];
  }

  it('generates tiles for a simple room', () => {
    const state = createTestState(200, 200, 30, 10, 0);
    const availableMP = createRoomPolygon(200, 200);

    const result = tilesForPreviewHerringbone(state, availableMP, 30, 10, 0);

    expect(result.error).toBeNull();
    expect(result.tiles).toBeDefined();
    expect(result.tiles.length).toBeGreaterThan(0);
  });

  it('generates both full and cut tiles', () => {
    const state = createTestState(200, 200, 30, 10, 0);
    const availableMP = createRoomPolygon(200, 200);

    const result = tilesForPreviewHerringbone(state, availableMP, 30, 10, 0);

    expect(result.error).toBeNull();

    const fullTiles = result.tiles.filter(t => t.isFull);
    const cutTiles = result.tiles.filter(t => !t.isFull);

    // Should have some full tiles in the interior
    expect(fullTiles.length).toBeGreaterThan(0);
    // Should have some cut tiles at the edges
    expect(cutTiles.length).toBeGreaterThan(0);
  });

  it('respects grout spacing', () => {
    const state = createTestState(200, 200, 30, 10, 2);
    const availableMP = createRoomPolygon(200, 200);

    const resultNoGrout = tilesForPreviewHerringbone(state, availableMP, 30, 10, 0);
    const resultWithGrout = tilesForPreviewHerringbone(state, availableMP, 30, 10, 2);

    expect(resultNoGrout.error).toBeNull();
    expect(resultWithGrout.error).toBeNull();

    // With grout, fewer tiles should fit in the same space
    expect(resultWithGrout.tiles.length).toBeLessThanOrEqual(resultNoGrout.tiles.length);
  });

  it('handles square-ish tiles', () => {
    const state = createTestState(200, 200, 20, 15, 0);
    const availableMP = createRoomPolygon(200, 200);

    const result = tilesForPreviewHerringbone(state, availableMP, 20, 15, 0);

    expect(result.error).toBeNull();
    expect(result.tiles.length).toBeGreaterThan(0);
  });

  it('handles narrow room', () => {
    const state = createTestState(50, 300, 30, 10, 0);
    const availableMP = createRoomPolygon(50, 300);

    const result = tilesForPreviewHerringbone(state, availableMP, 30, 10, 0);

    expect(result.error).toBeNull();
    expect(result.tiles.length).toBeGreaterThan(0);
  });

  it('uses longer dimension as tile length', () => {
    const state = createTestState(200, 200, 10, 30, 0); // Note: width < height
    const availableMP = createRoomPolygon(200, 200);

    const result = tilesForPreviewHerringbone(state, availableMP, 10, 30, 0);

    expect(result.error).toBeNull();
    expect(result.tiles.length).toBeGreaterThan(0);

    // The pattern should work the same regardless of which dimension is larger
    const stateSwapped = createTestState(200, 200, 30, 10, 0);
    const resultSwapped = tilesForPreviewHerringbone(stateSwapped, availableMP, 30, 10, 0);

    // Both should produce similar tile counts (not necessarily identical due to edge effects)
    expect(Math.abs(result.tiles.length - resultSwapped.tiles.length)).toBeLessThan(result.tiles.length * 0.1);
  });

  it('returns error for too many tiles', () => {
    // Very small tiles in a large room would exceed MAX_PREVIEW_TILES
    const state = createTestState(10000, 10000, 5, 2, 0);
    const availableMP = createRoomPolygon(10000, 10000);

    const result = tilesForPreviewHerringbone(state, availableMP, 5, 2, 0);

    expect(result.error).not.toBeNull();
    expect(result.tiles).toEqual([]);
  });

  it('tiles have valid SVG path data', () => {
    const state = createTestState(200, 200, 30, 10, 0);
    const availableMP = createRoomPolygon(200, 200);

    const result = tilesForPreviewHerringbone(state, availableMP, 30, 10, 0);

    expect(result.error).toBeNull();

    // Each tile should have a valid 'd' path attribute
    for (const tile of result.tiles) {
      expect(tile.d).toBeDefined();
      expect(typeof tile.d).toBe('string');
      expect(tile.d.length).toBeGreaterThan(0);
      // SVG path should start with 'M' (moveto)
      expect(tile.d.startsWith('M')).toBe(true);
      // SVG path should contain 'Z' (close path)
      expect(tile.d.includes('Z')).toBe(true);
    }
  });

  it('keeps overlap bounded for generic herringbone', () => {
    const state = createTestState(120, 120, 30, 10, 0);
    const availableMP = createRoomPolygon(120, 120);

    const result = tilesForPreviewHerringbone(state, availableMP, 30, 10, 0);

    expect(result.error).toBeNull();
    expect(result.tiles.length).toBeGreaterThan(0);

    const polys = result.tiles
      .map((tile) => pathDToPolygon(tile.d))
      .filter(Boolean);

    let overlapArea = 0;
    for (let i = 0; i < polys.length; i++) {
      for (let j = i + 1; j < polys.length; j++) {
        const inter = polygonClipping.intersection(polys[i], polys[j]);
        if (inter && inter.length) {
          overlapArea += multiPolyArea(inter);
        }
      }
    }

    const roomArea = 120 * 120;
    expect(overlapArea / roomArea).toBeLessThan(0.2);
  });

  it('covers the reported state within expected bounds', () => {
    const state = herringboneState({ roomW: 100, roomH: 200, tileW: 10, tileH: 20, grout: 0.2 });
    const availableMP = createRoomPolygon(100, 200);

    const result = tilesForPreviewHerringbone(state, availableMP, 10, 20, 0.2);
    expect(result.error).toBeNull();
    expect(result.tiles.length).toBeGreaterThan(0);

    const polys = result.tiles.map((tile) => pathDToPolygon(tile.d)).filter(Boolean);

    let overlapArea = 0;
    for (let i = 0; i < polys.length; i++) {
      for (let j = i + 1; j < polys.length; j++) {
        const inter = polygonClipping.intersection(polys[i], polys[j]);
        if (inter && inter.length) {
          overlapArea += multiPolyArea(inter);
        }
      }
    }
    const roomArea = 100 * 200;
    expect(overlapArea / roomArea).toBeLessThan(0.2);

    const covered = polygonClipping.union(...polys);
    const coveredArea = multiPolyArea(covered);
    const coverageRatio = coveredArea / roomArea;
    expect(coverageRatio).toBeGreaterThan(0.95);
  });

  it('renders herringbone with sections and 45° rotation', () => {
    const state = {
      floors: [{
        id: 'floor-1',
        rooms: [{
          id: 'room-1',
          name: 'Room',
          widthCm: 600,
          heightCm: 400,
          sections: [
            { id: 'main', x: 0, y: 0, widthCm: 600, heightCm: 400 },
            { id: 'ext', x: 600, y: 0, widthCm: 300, heightCm: 400 }
          ],
          exclusions: [],
          tile: { widthCm: 10, heightCm: 40, shape: 'rect' },
          grout: { widthCm: 0 },
          pattern: {
            type: 'herringbone',
            rotationDeg: 45,
            offsetXcm: 0,
            offsetYcm: 0,
            origin: { preset: 'tl' }
          }
        }]
      }],
      selectedFloorId: 'floor-1',
      selectedRoomId: 'room-1'
    };

    const room = state.floors[0].rooms[0];
    const available = computeAvailableArea(room, room.exclusions);
    const result = tilesForPreview(state, available.mp);

    expect(result.error).toBeNull();
    expect(result.tiles.length).toBeGreaterThan(0);
  });
});

describe('tilesForPreview patterns (sanity)', () => {
  const roomW = 120;
  const roomH = 120;
  const tileW = 30;
  const tileH = 10;
  const grout = 0.2;
  const availableMP = createRoomPolygon(roomW, roomH);

  const patterns = ['grid', 'runningBond', 'herringbone', 'doubleHerringbone', 'basketweave', 'verticalStackAlternating'];
  const overlapLimits = {
    grid: 0.02,
    runningBond: 0.02,
    basketweave: 0.02,
    herringbone: 0.2,
    doubleHerringbone: 0.2,
    verticalStackAlternating: 0.02,
  };

  for (const patternType of patterns) {
    it(`generates non-empty tiles for ${patternType}`, () => {
      const state = createPatternState({ patternType, roomW, roomH, tileW, tileH, grout });
      const result = tilesForPreview(state, availableMP);

      expect(result.error).toBeNull();
      expect(result.tiles.length).toBeGreaterThan(0);
    });

    it(`keeps overlap low for ${patternType}`, () => {
      const state = createPatternState({ patternType, roomW, roomH, tileW, tileH, grout });
      const result = tilesForPreview(state, availableMP);

      expect(result.error).toBeNull();
      const polys = result.tiles.map((tile) => pathDToPolygon(tile.d)).filter(Boolean);
      const area = overlapArea(polys);
      const roomArea = roomW * roomH;

      // Allow tiny numerical intersections but no significant overlap.
      expect(area / roomArea).toBeLessThan(overlapLimits[patternType]);
    });
  }
});
