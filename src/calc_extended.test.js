import { describe, it, expect, beforeEach } from 'vitest';
import {
  OffcutPool,
  calculateTileArea,
  analyzeCutTile,
  findComplementaryPairs,
  getRoomPricing,
  isWallSurface,
  getFloorRooms,
  getWallSurfaces,
  computePlanMetrics,
  computeFloorMetrics,
  clearMetricsCache,
} from './calc.js';
import { assertMetricsInvariants } from './test-utils/helpers.js';

beforeEach(() => clearMetricsCache());

// --- Helper ---

function createTestState(opts = {}) {
  const floorId = 'test-floor';
  const roomId = opts.roomId || 'test-room';
  const roomW = opts.roomW || 400;
  const roomH = opts.roomH || 500;

  const polygonVertices = opts.polygonVertices || [
    { x: 0, y: 0 },
    { x: roomW, y: 0 },
    { x: roomW, y: roomH },
    { x: 0, y: roomH }
  ];

  const baseRoom = {
    id: roomId,
    name: opts.roomName || 'Test Room',
    polygonVertices,
    exclusions: opts.exclusions || [],
    tile: opts.tile || { widthCm: 30, heightCm: 60 },
    grout: opts.grout || { widthCm: 1 },
    pattern: opts.pattern || { type: 'grid', rotationDeg: 0, offsetXcm: 0, offsetYcm: 0, origin: { preset: 'tl' } },
    skirting: opts.skirting || { enabled: false, heightCm: 6, type: 'cutout' },
    ...(opts.sourceRoomId ? { sourceRoomId: opts.sourceRoomId } : {}),
    ...(opts.floorPosition ? { floorPosition: opts.floorPosition } : {}),
  };

  const extraRooms = opts.extraRooms || [];

  return {
    meta: { version: 8 },
    project: { name: 'Test Project' },
    floors: [{
      id: floorId,
      name: 'Test Floor',
      rooms: [baseRoom, ...extraRooms],
      ...(opts.patternGroups ? { patternGroups: opts.patternGroups } : {}),
    }],
    selectedFloorId: floorId,
    selectedRoomId: roomId,
    pricing: opts.pricing || { pricePerM2: 50, packM2: 1, reserveTiles: 0 },
    waste: opts.waste || { allowRotate: true, optimizeCuts: false, kerfCm: 0 },
    view: opts.view || { showGrid: true, showNeeds: false },
    ...(opts.materials ? { materials: opts.materials } : {}),
  };
}

// ========== OffcutPool ==========

describe('OffcutPool', () => {
  it('add and take exact match', () => {
    const pool = new OffcutPool();
    pool.add({ w: 10, h: 20 }, 'tile');
    const result = pool.take(10, 20, { allowRotate: false, optimizeCuts: false, kerfCm: 0 });
    expect(result.ok).toBe(true);
    expect(result.used.w).toBe(10);
    expect(result.used.h).toBe(20);
    expect(pool.count()).toBe(0);
  });

  it('take with rotation', () => {
    const pool = new OffcutPool();
    pool.add({ w: 20, h: 10 }, 'tile');
    const noRot = pool.take(10, 20, { allowRotate: false, optimizeCuts: false, kerfCm: 0 });
    expect(noRot.ok).toBe(false);

    const withRot = pool.take(10, 20, { allowRotate: true, optimizeCuts: false, kerfCm: 0 });
    expect(withRot.ok).toBe(true);
    expect(withRot.used.rotUsed).toBe(true);
  });

  it('take returns ok:false when nothing fits', () => {
    const pool = new OffcutPool();
    pool.add({ w: 5, h: 5 }, 'tile');
    const result = pool.take(10, 20, { allowRotate: true, optimizeCuts: false, kerfCm: 0 });
    expect(result.ok).toBe(false);
    expect(result.used).toBeNull();
  });

  it('best-fit with optimizeCuts', () => {
    const pool = new OffcutPool();
    pool.add({ w: 100, h: 100 }, 'tile'); // big
    pool.add({ w: 12, h: 22 }, 'tile');   // small, better fit
    const result = pool.take(10, 20, { allowRotate: false, optimizeCuts: true, kerfCm: 0 });
    expect(result.ok).toBe(true);
    // Should pick the smaller offcut (less leftover)
    expect(result.used.w).toBe(12);
    expect(result.used.h).toBe(22);
  });

  it('guillotine remainders with kerf', () => {
    const pool = new OffcutPool();
    pool.add({ w: 60, h: 60 }, 'tile');
    const result = pool.take(30, 30, { allowRotate: false, optimizeCuts: true, kerfCm: 2 });
    expect(result.ok).toBe(true);
    // After taking 30x30 from 60x60 with kerf=2:
    // Right remainder: w = 60 - 30 - 2 = 28, h = 60
    // Bottom remainder: w = 30, h = 60 - 30 - 2 = 28
    expect(result.used.remainders.length).toBe(2);
    expect(result.used.remainders[0].w).toBe(28);
    expect(result.used.remainders[0].h).toBe(60);
    expect(result.used.remainders[1].w).toBe(30);
    expect(result.used.remainders[1].h).toBe(28);
    // Pool should have the 2 remainders
    expect(pool.count()).toBe(2);
  });

  it('snapshot returns current state', () => {
    const pool = new OffcutPool();
    pool.add({ w: 10, h: 20 }, 'tile');
    pool.add({ w: 30, h: 40 }, 'offcut');
    const snap = pool.snapshot();
    expect(snap.length).toBe(2);
    expect(snap[0].w).toBe(10);
    expect(snap[1].from).toBe('offcut');
  });

  it('clear empties the pool', () => {
    const pool = new OffcutPool();
    pool.add({ w: 10, h: 20 }, 'tile');
    pool.add({ w: 30, h: 40 }, 'tile');
    expect(pool.count()).toBe(2);
    pool.clear();
    expect(pool.count()).toBe(0);
  });

  it('count returns correct number', () => {
    const pool = new OffcutPool();
    expect(pool.count()).toBe(0);
    pool.add({ w: 10, h: 20 }, 'tile');
    expect(pool.count()).toBe(1);
    pool.add({ w: 30, h: 40 }, 'tile');
    expect(pool.count()).toBe(2);
    pool.take(10, 20, { allowRotate: false, optimizeCuts: false, kerfCm: 0 });
    expect(pool.count()).toBe(1);
  });

  it('add rejects zero/negative dimensions', () => {
    const pool = new OffcutPool();
    expect(pool.add({ w: 0, h: 10 })).toBeNull();
    expect(pool.add({ w: 10, h: 0 })).toBeNull();
    expect(pool.add({ w: -5, h: 10 })).toBeNull();
    expect(pool.add(null)).toBeNull();
    expect(pool.count()).toBe(0);
  });

  it('take rejects zero/negative needs', () => {
    const pool = new OffcutPool();
    pool.add({ w: 10, h: 10 }, 'tile');
    expect(pool.take(0, 10, { allowRotate: false, optimizeCuts: false, kerfCm: 0 }).ok).toBe(false);
    expect(pool.take(10, -1, { allowRotate: false, optimizeCuts: false, kerfCm: 0 }).ok).toBe(false);
  });
});

// ========== calculateTileArea ==========

describe('calculateTileArea', () => {
  it('calculates rect tile area', () => {
    expect(calculateTileArea(30, 60, 'rect')).toBe(1800);
  });

  it('calculates hex tile area', () => {
    const tw = 20;
    const radius = tw / Math.sqrt(3);
    const expected = (3 * Math.sqrt(3) / 2) * radius * radius;
    expect(calculateTileArea(20, 20, 'hex')).toBeCloseTo(expected, 4);
  });

  it('calculates rhombus tile area', () => {
    expect(calculateTileArea(20, 30, 'rhombus')).toBe(300); // (20*30)/2
  });

  it('calculates square tile area', () => {
    expect(calculateTileArea(25, 999, 'square')).toBe(625); // tw*tw, ignores th
  });

  it('defaults to rect for unknown shape', () => {
    expect(calculateTileArea(10, 20, 'unknown')).toBe(200);
    expect(calculateTileArea(10, 20, undefined)).toBe(200);
  });
});

// ========== analyzeCutTile ==========

describe('analyzeCutTile', () => {
  it('rectangular cut returns correct bbox and area', () => {
    const tile = { d: 'M 0 0 L 20 0 L 20 30 L 0 30 Z', isFull: false };
    const result = analyzeCutTile(tile, 1800);
    expect(result).not.toBeNull();
    expect(result.bb.w).toBeCloseTo(20, 1);
    expect(result.bb.h).toBeCloseTo(30, 1);
    expect(result.actualArea).toBeCloseTo(600, 1);
    expect(result.isTriangularCut).toBe(false);
  });

  it('triangular cut detected (area ratio ~0.5)', () => {
    // Right triangle: area = 0.5 * base * height
    const tile = { d: 'M 0 0 L 20 0 L 0 30 Z', isFull: false };
    const result = analyzeCutTile(tile, 1800);
    expect(result).not.toBeNull();
    // bbox = 20 * 30 = 600, actual area = 300, ratio = 0.5
    expect(result.areaRatio).toBeCloseTo(0.5, 1);
    expect(result.isTriangularCut).toBe(true);
  });

  it('degenerate path returns null', () => {
    const tile = { d: 'M 0 0 L 0 0 Z', isFull: false };
    const result = analyzeCutTile(tile, 1800);
    expect(result).toBeNull();
  });
});

// ========== findComplementaryPairs ==========

describe('findComplementaryPairs', () => {
  it('two complementary triangles pair correctly', () => {
    const tw = 60, th = 60;
    const tiles = [
      { isFull: false, d: 'M 0 0 L 60 0 L 0 60 Z' },   // triangle, area = 1800
      { isFull: false, d: 'M 0 0 L 60 0 L 60 60 Z' },   // complementary triangle
    ];
    const analyses = tiles.map(t => analyzeCutTile(t, tw * th));
    const pairs = findComplementaryPairs(tiles, analyses, tw, th);
    expect(pairs.size).toBe(2);
    expect(pairs.get(0)).toBe(1);
    expect(pairs.get(1)).toBe(0);
  });

  it('non-matching dimensions do not pair', () => {
    const tw = 60, th = 60;
    const tiles = [
      { isFull: false, d: 'M 0 0 L 30 0 L 0 30 Z' },   // small triangle, bbox 30x30
      { isFull: false, d: 'M 0 0 L 60 0 L 60 60 Z' },   // larger bbox 60x60
    ];
    const analyses = tiles.map(t => analyzeCutTile(t, tw * th));
    const pairs = findComplementaryPairs(tiles, analyses, tw, th);
    expect(pairs.size).toBe(0);
  });

  it('three cuts: only best two pair', () => {
    const tw = 60, th = 60;
    const tiles = [
      { isFull: false, d: 'M 0 0 L 60 0 L 0 60 Z' },   // triangle A
      { isFull: false, d: 'M 0 0 L 60 0 L 60 60 Z' },   // complement of A
      { isFull: false, d: 'M 0 0 L 60 0 L 0 60 Z' },   // same as A, no pair left
    ];
    const analyses = tiles.map(t => analyzeCutTile(t, tw * th));
    const pairs = findComplementaryPairs(tiles, analyses, tw, th);
    expect(pairs.size).toBe(2); // only first two pair
    expect(pairs.has(2)).toBe(false);
  });
});

// ========== getRoomPricing ==========

describe('getRoomPricing', () => {
  it('material reference match uses material pricing', () => {
    const state = {
      pricing: { pricePerM2: 10, packM2: 1, reserveTiles: 0 },
      materials: { 'Marble': { pricePerM2: 80, packM2: 2.5 } }
    };
    const room = { tile: { reference: 'Marble' } };
    const p = getRoomPricing(state, room);
    expect(p.pricePerM2).toBe(80);
    expect(p.packM2).toBe(2.5);
  });

  it('no reference falls back to state.pricing', () => {
    const state = {
      pricing: { pricePerM2: 10, packM2: 1, reserveTiles: 5 },
      materials: {}
    };
    const room = { tile: {} };
    const p = getRoomPricing(state, room);
    expect(p.pricePerM2).toBe(10);
    expect(p.packM2).toBe(1);
    expect(p.reserveTiles).toBe(5);
  });

  it('missing state.pricing returns zeros', () => {
    const state = {};
    const room = { tile: {} };
    const p = getRoomPricing(state, room);
    expect(p.pricePerM2).toBe(0);
    expect(p.packM2).toBe(0);
    expect(p.reserveTiles).toBe(0);
  });
});

// ========== Wall-Awareness Helpers ==========

describe('isWallSurface', () => {
  it('returns true for rooms with sourceRoomId', () => {
    expect(isWallSurface({ id: 'w1', sourceRoomId: 'r1' })).toBe(true);
  });

  it('returns false for regular rooms', () => {
    expect(isWallSurface({ id: 'r1' })).toBe(false);
    expect(isWallSurface({ id: 'r1', sourceRoomId: '' })).toBe(false);
    expect(isWallSurface({ id: 'r1', sourceRoomId: null })).toBe(false);
  });

  it('returns false for null/undefined', () => {
    expect(isWallSurface(null)).toBe(false);
    expect(isWallSurface(undefined)).toBe(false);
  });
});

describe('getFloorRooms / getWallSurfaces', () => {
  const floor = {
    rooms: [
      { id: 'r1', name: 'Room 1' },
      { id: 'w1', name: 'Wall 1', sourceRoomId: 'r1' },
      { id: 'r2', name: 'Room 2' },
      { id: 'w2', name: 'Wall 2', sourceRoomId: 'r2' },
    ]
  };

  it('getFloorRooms returns only non-wall rooms', () => {
    const rooms = getFloorRooms(floor);
    expect(rooms.length).toBe(2);
    expect(rooms.map(r => r.id)).toEqual(['r1', 'r2']);
  });

  it('getWallSurfaces returns only wall rooms', () => {
    const walls = getWallSurfaces(floor);
    expect(walls.length).toBe(2);
    expect(walls.map(r => r.id)).toEqual(['w1', 'w2']);
  });

  it('handles null/empty floor', () => {
    expect(getFloorRooms(null)).toEqual([]);
    expect(getFloorRooms({})).toEqual([]);
    expect(getWallSurfaces(null)).toEqual([]);
    expect(getWallSurfaces({})).toEqual([]);
  });
});

// ========== Cache Key Invalidation ==========

describe('Cache key invalidation on origin change', () => {
  it('cache invalidates when origin room tile changes in pattern group', () => {
    clearMetricsCache();

    const originRoom = {
      id: 'origin-room',
      name: 'Origin',
      polygonVertices: [
        { x: 0, y: 0 }, { x: 100, y: 0 },
        { x: 100, y: 100 }, { x: 0, y: 100 }
      ],
      exclusions: [],
      tile: { widthCm: 50, heightCm: 50 },
      grout: { widthCm: 0 },
      pattern: { type: 'grid', rotationDeg: 0 },
      skirting: { enabled: false },
      floorPosition: { x: 0, y: 0 },
    };

    const childRoom = {
      id: 'child-room',
      name: 'Child',
      polygonVertices: [
        { x: 0, y: 0 }, { x: 100, y: 0 },
        { x: 100, y: 100 }, { x: 0, y: 100 }
      ],
      exclusions: [],
      tile: { widthCm: 50, heightCm: 50 },
      grout: { widthCm: 0 },
      pattern: { type: 'grid', rotationDeg: 0 },
      skirting: { enabled: false },
      floorPosition: { x: 100, y: 0 },
    };

    const state1 = {
      meta: { version: 8 },
      floors: [{
        id: 'f1',
        name: 'Floor 1',
        rooms: [originRoom, childRoom],
        patternGroups: [{
          id: 'pg1',
          originRoomId: 'origin-room',
          memberRoomIds: ['origin-room', 'child-room'],
        }],
      }],
      selectedFloorId: 'f1',
      selectedRoomId: 'child-room',
      pricing: { pricePerM2: 50, packM2: 1, reserveTiles: 0 },
      waste: { allowRotate: true, optimizeCuts: false, kerfCm: 0 },
    };

    const result1 = computePlanMetrics(state1, childRoom);
    expect(result1.ok).toBe(true);

    // Now change the origin room's tile — the child's cache should be invalidated
    const state2 = JSON.parse(JSON.stringify(state1));
    state2.floors[0].rooms[0].tile = { widthCm: 25, heightCm: 25 };

    const result2 = computePlanMetrics(state2, state2.floors[0].rooms[1]);
    expect(result2.ok).toBe(true);
    // With 25x25 tiles vs 50x50, the tile count should be different
    expect(result2.data.tiles.fullTiles).not.toBe(result1.data.tiles.fullTiles);

    clearMetricsCache();
  });
});

// ========== computeFloorMetrics ==========

describe('computeFloorMetrics', () => {
  it('2-room floor aggregation', () => {
    const state = createTestState({
      roomW: 100, roomH: 100,
      roomId: 'r1',
      tile: { widthCm: 50, heightCm: 50 },
      grout: { widthCm: 0 },
      pattern: { type: 'grid', rotationDeg: 0 },
      pricing: { pricePerM2: 10, packM2: 1, reserveTiles: 0 },
      waste: {},
      extraRooms: [{
        id: 'r2',
        name: 'Room 2',
        polygonVertices: [
          { x: 0, y: 0 }, { x: 100, y: 0 },
          { x: 100, y: 100 }, { x: 0, y: 100 }
        ],
        exclusions: [],
        tile: { widthCm: 50, heightCm: 50 },
        grout: { widthCm: 0 },
        pattern: { type: 'grid', rotationDeg: 0 },
        skirting: { enabled: false },
      }],
    });

    const floor = state.floors[0];
    const result = computeFloorMetrics(state, floor);
    expect(result.ok).toBe(true);
    expect(result.rooms.length).toBe(2);
    expect(result.totals.netAreaM2).toBeCloseTo(2, 2);
    expect(result.totals.purchasedTiles).toBeGreaterThanOrEqual(8);
  });

  it('floor with rooms + walls separates wall totals', () => {
    const state = createTestState({
      roomW: 100, roomH: 100,
      roomId: 'r1',
      tile: { widthCm: 50, heightCm: 50 },
      grout: { widthCm: 0 },
      pattern: { type: 'grid', rotationDeg: 0 },
      pricing: { pricePerM2: 10, packM2: 1, reserveTiles: 0 },
      waste: {},
      extraRooms: [{
        id: 'w1',
        name: 'Wall Surface',
        sourceRoomId: 'r1',
        polygonVertices: [
          { x: 0, y: 0 }, { x: 100, y: 0 },
          { x: 100, y: 50 }, { x: 0, y: 50 }
        ],
        exclusions: [],
        tile: { widthCm: 50, heightCm: 50 },
        grout: { widthCm: 0 },
        pattern: { type: 'grid', rotationDeg: 0 },
        skirting: { enabled: false },
      }],
    });

    const floor = state.floors[0];
    const result = computeFloorMetrics(state, floor);
    expect(result.ok).toBe(true);

    // Wall should NOT be in floor totals
    const floorEntries = result.rooms.filter(r => r.type === 'floor');
    const wallEntries = result.rooms.filter(r => r.type === 'wall');
    expect(floorEntries.length).toBe(1);
    expect(wallEntries.length).toBe(1);

    // Wall totals separate
    expect(result.wallTotals.totalTiles).toBeGreaterThan(0);
    expect(result.wallTotals.netAreaM2).toBeCloseTo(0.5, 2);

    // Floor totals should only contain the floor room
    expect(result.totals.netAreaM2).toBeCloseTo(1, 2);
  });

  it('offcut sharing enabled shows sharedPool', () => {
    const state = createTestState({
      roomW: 100, roomH: 100,
      roomId: 'r1',
      tile: { widthCm: 60, heightCm: 60 },
      grout: { widthCm: 1 },
      pattern: { type: 'grid', rotationDeg: 0 },
      pricing: { pricePerM2: 10, packM2: 1, reserveTiles: 0 },
      waste: { allowRotate: true, optimizeCuts: false, kerfCm: 0, shareOffcuts: true },
      extraRooms: [{
        id: 'r2',
        name: 'Room 2',
        polygonVertices: [
          { x: 0, y: 0 }, { x: 100, y: 0 },
          { x: 100, y: 100 }, { x: 0, y: 100 }
        ],
        exclusions: [],
        tile: { widthCm: 60, heightCm: 60 },
        grout: { widthCm: 1 },
        pattern: { type: 'grid', rotationDeg: 0 },
        skirting: { enabled: false },
      }],
    });

    const floor = state.floors[0];
    const result = computeFloorMetrics(state, floor);
    expect(result.ok).toBe(true);
    expect(result.sharedPool).not.toBeNull();
    expect(Array.isArray(result.sharedPool)).toBe(true);
  });

  it('offcut sharing disabled shows null sharedPool', () => {
    const state = createTestState({
      roomW: 100, roomH: 100,
      waste: { allowRotate: true, optimizeCuts: false, kerfCm: 0, shareOffcuts: false },
    });

    const floor = state.floors[0];
    const result = computeFloorMetrics(state, floor);
    expect(result.ok).toBe(true);
    expect(result.sharedPool).toBeNull();
  });

  it('empty floor returns ok: false', () => {
    const result = computeFloorMetrics({}, { rooms: [] });
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

// ========== Edge Cases ==========

describe('computePlanMetrics edge cases', () => {
  it('room with all area excluded returns error or zero tiles', () => {
    const state = createTestState({
      roomW: 100, roomH: 100,
      tile: { widthCm: 50, heightCm: 50 },
      grout: { widthCm: 0 },
      exclusions: [{ type: 'rect', x: 0, y: 0, w: 100, h: 100 }],
      pattern: { type: 'grid', rotationDeg: 0 },
      pricing: { reserveTiles: 0 },
      waste: {},
    });

    const result = computePlanMetrics(state);
    // Engine may return ok:false (no area) or ok:true with 0 tiles
    if (result.ok) {
      expect(result.data.tiles.fullTiles + result.data.tiles.cutTiles).toBe(0);
    } else {
      expect(result.error).toBeTruthy();
    }
  });

  it('zero-dimension tiles return error', () => {
    const state = createTestState({ tile: { widthCm: 0, heightCm: 0 } });
    const result = computePlanMetrics(state);
    expect(result.ok).toBe(false);
  });

  it('purchasedCost is present and correct', () => {
    const state = createTestState({
      roomW: 200, roomH: 200,
      tile: { widthCm: 50, heightCm: 50 },
      grout: { widthCm: 0 },
      exclusions: [],
      pattern: { type: 'grid', rotationDeg: 0 },
      pricing: { pricePerM2: 100, packM2: 2, reserveTiles: 0 },
      waste: {},
    });

    const result = computePlanMetrics(state);
    expect(result.ok).toBe(true);
    expect(result.data.pricing.purchasedCost).toBeDefined();
    // purchasedCost = packs * packM2 * pricePerM2
    const packs = result.data.pricing.packs;
    expect(result.data.pricing.purchasedCost).toBeCloseTo(packs * 2 * 100, 2);
    // purchasedCost >= priceTotal (pack-based rounding always >= installed area price)
    expect(result.data.pricing.purchasedCost).toBeGreaterThanOrEqual(
      result.data.pricing.priceTotal - 0.01
    );
  });

  it('purchasedCost falls back to priceTotal when no packs', () => {
    const state = createTestState({
      roomW: 100, roomH: 100,
      tile: { widthCm: 50, heightCm: 50 },
      grout: { widthCm: 0 },
      exclusions: [],
      pattern: { type: 'grid', rotationDeg: 0 },
      pricing: { pricePerM2: 50, packM2: 0, reserveTiles: 0 },
      waste: {},
    });

    const result = computePlanMetrics(state);
    expect(result.ok).toBe(true);
    expect(result.data.pricing.purchasedCost).toBe(result.data.pricing.priceTotal);
  });

  it('herringbone pattern produces valid output', () => {
    const state = createTestState({
      roomW: 200, roomH: 200,
      tile: { widthCm: 30, heightCm: 60 },
      grout: { widthCm: 1 },
      pattern: { type: 'herringbone', rotationDeg: 0 },
      pricing: { reserveTiles: 0 },
      waste: {},
    });

    const result = computePlanMetrics(state);
    expect(result.ok).toBe(true);
    expect(result.data.tiles.fullTiles).toBeGreaterThan(0);
  });

  it('basketweave pattern produces valid output', () => {
    const state = createTestState({
      roomW: 200, roomH: 200,
      tile: { widthCm: 30, heightCm: 60 },
      grout: { widthCm: 1 },
      pattern: { type: 'basketweave', rotationDeg: 0 },
      pricing: { reserveTiles: 0 },
      waste: {},
    });

    const result = computePlanMetrics(state);
    expect(result.ok).toBe(true);
    expect(result.data.tiles.fullTiles + result.data.tiles.cutTiles).toBeGreaterThan(0);
  });

  it('doubleHerringbone pattern produces valid output', () => {
    const state = createTestState({
      roomW: 200, roomH: 200,
      tile: { widthCm: 30, heightCm: 60 },
      grout: { widthCm: 1 },
      pattern: { type: 'doubleHerringbone', rotationDeg: 0 },
      pricing: { reserveTiles: 0 },
      waste: {},
    });

    const result = computePlanMetrics(state);
    expect(result.ok).toBe(true);
    expect(result.data.labor.totalPlacedTiles).toBeGreaterThan(0);
  });

  it('verticalStackAlternating pattern produces valid output', () => {
    const state = createTestState({
      roomW: 200, roomH: 200,
      tile: { widthCm: 30, heightCm: 60 },
      grout: { widthCm: 1 },
      pattern: { type: 'verticalStackAlternating', rotationDeg: 0 },
      pricing: { reserveTiles: 0 },
      waste: {},
    });

    const result = computePlanMetrics(state);
    expect(result.ok).toBe(true);
    expect(result.data.labor.totalPlacedTiles).toBeGreaterThan(0);
  });

  it('hex tile area matches formula', () => {
    const tw = 20;
    const state = createTestState({
      roomW: 200, roomH: 200,
      tile: { widthCm: tw, heightCm: tw, shape: 'hex' },
      grout: { widthCm: 0 },
      pattern: { type: 'grid', rotationDeg: 0 },
      pricing: { reserveTiles: 0 },
      waste: {},
    });

    const result = computePlanMetrics(state);
    expect(result.ok).toBe(true);

    const radius = tw / Math.sqrt(3);
    const expectedArea = (3 * Math.sqrt(3) / 2) * radius * radius;
    expect(result.data.material.tileAreaCm2).toBeCloseTo(expectedArea, 2);
  });
});
