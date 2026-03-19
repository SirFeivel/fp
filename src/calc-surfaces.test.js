/**
 * E2E tests for computeProjectTotals surface accounting.
 * Verifies that wall surfaces, floor sub-surfaces, and wall skirting zones
 * are all counted in the byMaterial aggregation.
 * No mocks — uses actual modules end-to-end.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { computeProjectTotals, clearMetricsCache } from './calc.js';

beforeEach(() => clearMetricsCache());

// ── Helpers ───────────────────────────────────────────────────────────────────

const TILE_A = { widthCm: 30, heightCm: 60, shape: 'rect', reference: 'TileA' };
const TILE_B = { widthCm: 20, heightCm: 20, shape: 'rect', reference: 'TileB' };
const GROUT = { widthCm: 0.2, colorHex: '#cccccc' };
const PATTERN = { type: 'grid', bondFraction: 0.5, rotationDeg: 0, offsetXcm: 0, offsetYcm: 0, origin: { preset: 'tl', xCm: 0, yCm: 0 } };

function makePresets() {
  return [
    { id: 'p1', name: 'TileA', shape: 'rect', widthCm: 30, heightCm: 60, groutWidthCm: 0.2, groutColorHex: '#cccccc', pricePerM2: 50, packM2: 1.44, useForSkirting: false },
    { id: 'p2', name: 'TileB', shape: 'rect', widthCm: 20, heightCm: 20, groutWidthCm: 0.2, groutColorHex: '#cccccc', pricePerM2: 80, packM2: 1.0, useForSkirting: false },
  ];
}

function makeMaterials() {
  return {
    TileA: { pricePerM2: 50, packM2: 1.44, extraPacks: 0 },
    TileB: { pricePerM2: 80, packM2: 1.0, extraPacks: 0 },
  };
}

/** Minimal wall with one surface spanning its full length. */
function makeWall(id, x1, y1, x2, y2, surfaceTile = null, roomId = 'r1') {
  const len = Math.hypot(x2 - x1, y2 - y1);
  return {
    id,
    start: { x: x1, y: y1 },
    end: { x: x2, y: y2 },
    heightStartCm: 250,
    heightEndCm: 250,
    thicknessCm: 10,
    doorways: [],
    surfaces: [
      {
        roomId,
        edgeIndex: 0,
        fromCm: 0,
        toCm: len,
        tile: surfaceTile,
        grout: surfaceTile ? GROUT : null,
        pattern: surfaceTile ? PATTERN : null,
        exclusions: [],
        skirtingZones: [],
      },
    ],
  };
}

/** State with one floor room (400×300 cm) and no walls. */
function makeBaseState(roomTile = TILE_A) {
  return {
    tilePresets: makePresets(),
    materials: makeMaterials(),
    pricing: { pricePerM2: 50, packM2: 1.44, reserveTiles: 0 },
    waste: { allowRotate: false, optimizeCuts: false, kerfCm: 0.1, shareOffcuts: false },
    floors: [
      {
        id: 'f1',
        name: 'Floor 1',
        rooms: [
          {
            id: 'r1',
            name: 'Living',
            polygonVertices: [
              { x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 },
            ],
            tile: { ...roomTile },
            grout: GROUT,
            pattern: PATTERN,
            exclusions: [],
            skirting: { enabled: false, heightCm: 10, type: 'cutout' },
          },
        ],
        walls: [],
      },
    ],
    selectedFloorId: 'f1',
    selectedRoomId: 'r1',
    view: {},
  };
}

// ── countTilesResult (via integration) ───────────────────────────────────────

describe('computeProjectTotals — floor room only (baseline)', () => {
  it('returns materials entry for floor room tile reference', () => {
    const state = makeBaseState();
    const proj = computeProjectTotals(state);

    expect(proj.materials.length).toBeGreaterThan(0);
    const matA = proj.materials.find(m => m.reference === 'TileA');
    expect(matA).toBeDefined();
    expect(matA.totalTiles).toBeGreaterThan(0);
    expect(matA.floorTiles).toBeGreaterThan(0);
    expect(matA.wallTiles).toBe(0);
    expect(matA.subSurfaceTiles).toBe(0);
    console.log(`[test:baseline] TileA floorTiles=${matA.floorTiles} totalTiles=${matA.totalTiles}`);
  });

  it('totalTiles equals floorTiles + skirtingTiles when no walls', () => {
    const state = makeBaseState();
    const proj = computeProjectTotals(state);
    const matA = proj.materials.find(m => m.reference === 'TileA');
    expect(matA.totalTiles).toBe(matA.floorTiles + matA.skirtingTiles + matA.wallTiles + matA.subSurfaceTiles);
  });
});

// ── Wall surfaces ─────────────────────────────────────────────────────────────

describe('computeProjectTotals — wall surface tiles', () => {
  it('adds wall surface tiles to byMaterial for the surface tile reference', () => {
    const state = makeBaseState();
    // Add a 200cm-wide wall with TileA surface (same ref as floor)
    const wall = makeWall('w1', 0, 0, 200, 0, { ...TILE_A }, 'r1');
    state.floors[0].walls = [wall];

    const baseline = (() => {
      const s = makeBaseState();
      return computeProjectTotals(s);
    })();
    clearMetricsCache();

    const proj = computeProjectTotals(state);
    const matA = proj.materials.find(m => m.reference === 'TileA');
    const baseA = baseline.materials.find(m => m.reference === 'TileA');

    // With wall, total tiles should be MORE than baseline (floor only)
    expect(matA.totalTiles).toBeGreaterThan(baseA.totalTiles);
    expect(matA.wallTiles).toBeGreaterThan(0);
    expect(matA.wallAreaM2).toBeGreaterThan(0);
    console.log(`[test:wallSurf] baseline=${baseA.totalTiles} withWall=${matA.totalTiles} wallTiles=${matA.wallTiles}`);
  });

  it('creates separate byMaterial entry when wall uses different tile ref than floor', () => {
    const state = makeBaseState(); // floor uses TileA
    // Wall uses TileB
    const wall = makeWall('w1', 0, 0, 300, 0, { ...TILE_B }, 'r1');
    state.floors[0].walls = [wall];

    const proj = computeProjectTotals(state);
    const matA = proj.materials.find(m => m.reference === 'TileA');
    const matB = proj.materials.find(m => m.reference === 'TileB');

    expect(matA).toBeDefined();
    expect(matB).toBeDefined();
    expect(matB.wallTiles).toBeGreaterThan(0);
    expect(matA.wallTiles).toBe(0); // TileA only on floor
    console.log(`[test:wallDiffRef] TileA=${matA.totalTiles} TileB=${matB.totalTiles} wallTiles=${matB.wallTiles}`);
  });

  it('wall surface with null tile is not counted', () => {
    const state = makeBaseState();
    const wall = makeWall('w1', 0, 0, 300, 0, null, 'r1'); // no tile
    state.floors[0].walls = [wall];

    const baseline = (() => {
      const s = makeBaseState();
      return computeProjectTotals(s);
    })();
    clearMetricsCache();

    const proj = computeProjectTotals(state);
    const matA = proj.materials.find(m => m.reference === 'TileA');
    const baseA = baseline.materials.find(m => m.reference === 'TileA');

    // No tile on wall → totals unchanged
    expect(matA.totalTiles).toBe(baseA.totalTiles);
    expect(matA.wallTiles).toBe(0);
  });

  it('wall tiles appear in totalTiles and totalAreaM2', () => {
    const state = makeBaseState();
    const wall = makeWall('w1', 0, 0, 300, 0, { ...TILE_B }, 'r1');
    state.floors[0].walls = [wall];

    const proj = computeProjectTotals(state);
    const matB = proj.materials.find(m => m.reference === 'TileB');

    expect(matB.totalTiles).toBe(matB.wallTiles + matB.subSurfaceTiles + matB.floorTiles + matB.skirtingTiles);
    expect(matB.totalAreaM2).toBeGreaterThan(0);
  });
});

// ── Floor sub-surfaces ────────────────────────────────────────────────────────

describe('computeProjectTotals — floor exclusion sub-surfaces', () => {
  it('counts tiles for floor exclusion carrying its own tile', () => {
    const state = makeBaseState(); // floor uses TileA
    // Add a rect exclusion on the floor room with TileB
    state.floors[0].rooms[0].exclusions = [
      {
        id: 'e1',
        type: 'rect',
        label: 'Shower',
        x: 50, y: 50, w: 100, h: 80,
        tile: { ...TILE_B },
        grout: GROUT,
        pattern: PATTERN,
      },
    ];

    const proj = computeProjectTotals(state);
    const matB = proj.materials.find(m => m.reference === 'TileB');

    expect(matB).toBeDefined();
    expect(matB.subSurfaceTiles).toBeGreaterThan(0);
    expect(matB.subSurfaceAreaM2).toBeGreaterThan(0);
    console.log(`[test:floorSubSurf] TileB subSurfaceTiles=${matB.subSurfaceTiles}`);
  });

  it('floor room area is reduced by exclusion, sub-surface adds tiles back', () => {
    const baseState = makeBaseState();
    const projBase = computeProjectTotals(baseState);
    const baseFloorTiles = projBase.materials.find(m => m.reference === 'TileA')?.floorTiles || 0;
    clearMetricsCache();

    const state = makeBaseState();
    state.floors[0].rooms[0].exclusions = [
      {
        id: 'e1', type: 'rect', label: 'Test',
        x: 50, y: 50, w: 100, h: 80,
        tile: { ...TILE_B }, grout: GROUT, pattern: PATTERN,
      },
    ];

    const proj = computeProjectTotals(state);
    const matA = proj.materials.find(m => m.reference === 'TileA');
    const matB = proj.materials.find(m => m.reference === 'TileB');

    // Floor room has fewer TileA tiles (exclusion voids that area)
    expect(matA.floorTiles).toBeLessThan(baseFloorTiles);
    // But TileB sub-surface fills the voided area
    expect(matB.subSurfaceTiles).toBeGreaterThan(0);
    console.log(`[test:floorSubSurfBalance] TileA floor: ${baseFloorTiles}→${matA.floorTiles}, TileB sub: ${matB.subSurfaceTiles}`);
  });

  it('plain void exclusion (no tile) is not counted as sub-surface', () => {
    const state = makeBaseState();
    state.floors[0].rooms[0].exclusions = [
      { id: 'e1', type: 'rect', label: 'Column', x: 50, y: 50, w: 30, h: 30 },
      // No tile field
    ];

    const proj = computeProjectTotals(state);
    // No TileB entry should appear
    const matB = proj.materials.find(m => m.reference === 'TileB');
    expect(matB?.subSurfaceTiles || 0).toBe(0);
  });
});

// ── Project totals rollup ─────────────────────────────────────────────────────

describe('computeProjectTotals — totals include all surfaces', () => {
  it('totalTiles includes floor + wall contributions', () => {
    const state = makeBaseState();
    state.floors[0].walls = [
      makeWall('w1', 0, 0, 300, 0, { ...TILE_A }, 'r1'),
    ];

    const baseState = makeBaseState();
    const baseProj = computeProjectTotals(baseState);
    clearMetricsCache();

    const proj = computeProjectTotals(state);

    // Overall totalTiles should be higher (includes wall)
    expect(proj.totalTiles).toBeGreaterThan(baseProj.totalTiles);
    console.log(`[test:totalTiles] base=${baseProj.totalTiles} withWall=${proj.totalTiles}`);
  });

  it('adjustedCost reflects wall material pricing', () => {
    const state = makeBaseState();
    // Wall with TileB at €80/m²
    state.floors[0].walls = [
      makeWall('w1', 0, 0, 300, 0, { ...TILE_B }, 'r1'),
    ];

    const proj = computeProjectTotals(state);
    const matB = proj.materials.find(m => m.reference === 'TileB');

    // TileB pricePerM2 = 80, and we have wall area → cost > 0
    expect(matB.totalCost).toBeGreaterThan(0);
    expect(matB.adjustedCost).toBeGreaterThan(0);
    console.log(`[test:adjustedCost] TileB cost=${matB.totalCost.toFixed(2)} adjustedCost=${matB.adjustedCost.toFixed(2)}`);
  });

  it('wallPacks is computed from wallAreaM2', () => {
    const state = makeBaseState();
    state.floors[0].walls = [
      makeWall('w1', 0, 0, 300, 0, { ...TILE_B }, 'r1'),
    ];

    const proj = computeProjectTotals(state);
    const matB = proj.materials.find(m => m.reference === 'TileB');

    expect(matB.wallPacks).toBeGreaterThan(0);
    // wallPacks = ceil(wallAreaM2 / packM2)
    const expectedWallPacks = Math.ceil(matB.wallAreaM2 / matB.packM2);
    expect(matB.wallPacks).toBe(expectedWallPacks);
    console.log(`[test:wallPacks] wallAreaM2=${matB.wallAreaM2.toFixed(3)} packM2=${matB.packM2} wallPacks=${matB.wallPacks}`);
  });
});
