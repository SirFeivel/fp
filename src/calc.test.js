import { describe, it, expect, beforeEach } from 'vitest';
import { computePlanMetrics, clearMetricsCache } from './calc.js';
import { assertMetricsInvariants } from './test-utils/helpers.js';

beforeEach(() => clearMetricsCache());

function createTestState(opts = {}) {
  const floorId = 'test-floor';
  const roomId = 'test-room';

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
    skirting: opts.skirting || { enabled: false, heightCm: 6, type: 'cutout' }
  };

  const newState = {
    meta: { version: 8 },
    project: { name: 'Test Project' },
    floors: [{
      id: floorId,
      name: 'Test Floor',
      rooms: [baseRoom]
    }],
    selectedFloorId: floorId,
    selectedRoomId: roomId,
    pricing: opts.pricing || { pricePerM2: 50, packM2: 1, reserveTiles: 5 },
    waste: opts.waste || { allowRotate: true, optimizeCuts: false, kerfCm: 0 },
    view: opts.view || { showGrid: true, showNeeds: false }
  };

  return newState;
}

describe('computePlanMetrics', () => {
  it('returns error for invalid tile dimensions', () => {
    const state = createTestState({ tile: { widthCm: 0, heightCm: 60 } });

    const result = computePlanMetrics(state);
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('returns error for negative grout width', () => {
    const state = createTestState({ grout: { widthCm: -1 } });

    const result = computePlanMetrics(state);
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('calculates metrics for simple room with no exclusions', () => {
    const state = createTestState();

    const result = computePlanMetrics(state);
    assertMetricsInvariants(result);

    const d = result.data;
    // Default room is 400x500 = 200000cm² = 20m²
    expect(d.material.installedAreaM2).toBeCloseTo(20.0, 0);
    expect(d.pricing.pricePerM2).toBe(50);
    expect(d.labor.totalPlacedTiles).toBe(d.tiles.fullTiles + d.tiles.cutTiles);
  });

  it('counts full and cut tiles correctly', () => {
    const state = createTestState({
      roomW: 100, roomH: 100,
      tile: { widthCm: 30, heightCm: 30 },
      grout: { widthCm: 1 },
      exclusions: [],
      pattern: { type: 'grid', rotationDeg: 0 },
      pricing: { reserveTiles: 0 },
      waste: { allowRotate: false, optimizeCuts: false, kerfCm: 0 },
    });

    const result = computePlanMetrics(state);
    assertMetricsInvariants(result);

    // 100x100 room with 30+1=31cm grid step: ceil(100/31)=4 columns, ceil(100/31)=4 rows
    // Full tiles that fit entirely: 3x3 = 9, plus edge cuts
    // The important thing: exact tile count is deterministic
    const d = result.data;
    expect(d.tiles.fullTiles).toBe(9);
    expect(d.tiles.cutTiles).toBe(7);
    expect(d.labor.totalPlacedTiles).toBe(d.tiles.fullTiles + d.tiles.cutTiles);
  });

  it('calculates installed area correctly', () => {
    const state = createTestState({
      roomW: 200, roomH: 200,
      tile: { widthCm: 50, heightCm: 50 },
      grout: { widthCm: 0 },
      exclusions: [],
      pattern: { type: 'grid', rotationDeg: 0 },
      pricing: { reserveTiles: 0 },
      waste: {},
    });

    const result = computePlanMetrics(state);
    assertMetricsInvariants(result);

    const expectedAreaM2 = (200 * 200) / 10000;
    expect(result.data.material.installedAreaM2).toBeCloseTo(expectedAreaM2, 2);
  });

  it('handles room with exclusions', () => {
    const state = createTestState({
      roomW: 200, roomH: 200,
      tile: { widthCm: 50, heightCm: 50 },
      grout: { widthCm: 0 },
      exclusions: [{ type: 'rect', x: 0, y: 0, w: 50, h: 50 }],
      pattern: { type: 'grid', rotationDeg: 0 },
      pricing: { reserveTiles: 0 },
      waste: {},
    });

    const result = computePlanMetrics(state);
    assertMetricsInvariants(result);

    const expectedAreaM2 = ((200 * 200) - (50 * 50)) / 10000;
    expect(result.data.material.installedAreaM2).toBeCloseTo(expectedAreaM2, 2);
  });

  it('includes reserve tiles in purchase calculation', () => {
    const state = createTestState({
      roomW: 100, roomH: 100,
      tile: { widthCm: 50, heightCm: 50 },
      grout: { widthCm: 0 },
      exclusions: [],
      pattern: { type: 'grid', rotationDeg: 0 },
      pricing: { reserveTiles: 10 },
      waste: {},
    });

    const result = computePlanMetrics(state);
    assertMetricsInvariants(result);
    expect(result.data.tiles.reserveTiles).toBe(10);
    expect(result.data.tiles.purchasedTilesWithReserve).toBe(
      result.data.tiles.purchasedTiles + 10
    );
  });

  it('calculates waste percentage correctly', () => {
    const state = createTestState({
      roomW: 100, roomH: 100,
      tile: { widthCm: 50, heightCm: 50 },
      grout: { widthCm: 0 },
      exclusions: [],
      pattern: { type: 'grid', rotationDeg: 0 },
      pricing: { reserveTiles: 2 },
      waste: {},
    });

    const result = computePlanMetrics(state);
    assertMetricsInvariants(result);

    // 100x100 room with 50x50 tiles and 0 grout = exact 4-tile fit
    // Reserve of 2 adds 2 purchased tiles → 6 tiles purchased
    // purchasedArea = 6 * 0.25m² = 1.5m², installed = 1.0m²
    // wastePct = (1.5 - 1.0) / 1.5 * 100 = 33.33%
    const d = result.data;
    expect(d.tiles.fullTiles).toBe(4);
    expect(d.tiles.cutTiles).toBe(0);
    expect(d.tiles.reserveTiles).toBe(2);
    expect(d.material.wastePct).toBeCloseTo(33.33, 0);
  });

  it('calculates pricing correctly', () => {
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
    assertMetricsInvariants(result);

    const areaM2 = (200 * 200) / 10000;
    const expectedPrice = areaM2 * 100;
    expect(result.data.pricing.priceTotal).toBeCloseTo(expectedPrice, 2);

    const expectedPacks = Math.ceil(areaM2 / 2);
    expect(result.data.pricing.packs).toBe(expectedPacks);
  });

  it('handles optimizeCuts option', () => {
    const state = createTestState({
      roomW: 150, roomH: 150,
      tile: { widthCm: 60, heightCm: 60 },
      grout: { widthCm: 1 },
      exclusions: [],
      pattern: { type: 'grid', rotationDeg: 0 },
      pricing: { reserveTiles: 0 },
      waste: { allowRotate: true, optimizeCuts: true, kerfCm: 0.3 },
    });

    const result = computePlanMetrics(state);
    assertMetricsInvariants(result);
    expect(result.data.waste.optimizeCuts).toBe(true);
    expect(result.data.waste.kerfCm).toBe(0.3);
  });

  it('handles allowRotate option', () => {
    const stateWithRotate = createTestState({
      roomW: 150, roomH: 150,
      tile: { widthCm: 40, heightCm: 60 },
      grout: { widthCm: 1 },
      exclusions: [],
      pattern: { type: 'grid', rotationDeg: 0 },
      pricing: { reserveTiles: 0 },
      waste: { allowRotate: true, optimizeCuts: false, kerfCm: 0 },
    });

    const resultWithRotate = computePlanMetrics(stateWithRotate);
    assertMetricsInvariants(resultWithRotate);
    expect(resultWithRotate.data.waste.allowRotate).toBe(true);

    const stateNoRotate = createTestState({
      roomW: 150, roomH: 150,
      tile: { widthCm: 40, heightCm: 60 },
      grout: { widthCm: 1 },
      exclusions: [],
      pattern: { type: 'grid', rotationDeg: 0 },
      pricing: { reserveTiles: 0 },
      waste: { allowRotate: false, optimizeCuts: false, kerfCm: 0 },
    });

    const resultNoRotate = computePlanMetrics(stateNoRotate);
    assertMetricsInvariants(resultNoRotate);
    expect(resultNoRotate.data.waste.allowRotate).toBe(false);
  });

  it('calculates cut tiles percentage', () => {
    const state = createTestState({
      roomW: 100, roomH: 100,
      tile: { widthCm: 40, heightCm: 40 },
      grout: { widthCm: 0 },
      exclusions: [],
      pattern: { type: 'grid', rotationDeg: 0 },
      pricing: { reserveTiles: 0 },
      waste: {},
    });

    const result = computePlanMetrics(state);
    expect(result.ok).toBe(true);
    assertMetricsInvariants(result);
    // 100x100 room, 40x40 tiles, 0 grout: 2 full columns (80cm), edge cuts on right+bottom
    const d = result.data;
    expect(d.labor.cutTilesPct).toBeGreaterThanOrEqual(0);
    expect(d.labor.cutTilesPct).toBeLessThanOrEqual(100);
    // cutTilesPct = cutTiles / totalPlacedTiles * 100
    if (d.labor.totalPlacedTiles > 0) {
      expect(d.labor.cutTilesPct).toBeCloseTo(
        (d.labor.cutTiles / d.labor.totalPlacedTiles) * 100, 1
      );
    }
  });

  it('tracks reused cuts when optimizing', () => {
    const state = createTestState({
      roomW: 150, roomH: 150,
      tile: { widthCm: 60, heightCm: 60 },
      grout: { widthCm: 1 },
      exclusions: [],
      pattern: { type: 'grid', rotationDeg: 0 },
      pricing: { reserveTiles: 0 },
      waste: { allowRotate: true, optimizeCuts: true, kerfCm: 0.3 },
    });

    const result = computePlanMetrics(state);
    assertMetricsInvariants(result);
    expect(result.data.tiles.reusedCuts).toBeLessThanOrEqual(result.data.tiles.cutTiles);
  });

  it('provides debug information', () => {
    const state = createTestState({
      roomW: 100, roomH: 100,
      tile: { widthCm: 50, heightCm: 50 },
      grout: { widthCm: 0 },
      exclusions: [],
      pattern: { type: 'grid', rotationDeg: 0 },
      pricing: { reserveTiles: 0 },
      waste: {},
    });

    const result = computePlanMetrics(state);
    assertMetricsInvariants(result);
    const d = result.data;
    expect(Array.isArray(d.debug.tileUsage)).toBe(true);
    expect(Array.isArray(d.debug.cutNeeds)).toBe(true);
    expect(Array.isArray(d.debug.offcutPoolFinal)).toBe(true);
    // tileUsage length should equal total placed tiles
    expect(d.debug.tileUsage.length).toBe(d.tiles.fullTiles + d.tiles.cutTiles);
  });

  it('handles running bond pattern', () => {
    const state = createTestState({
      roomW: 200, roomH: 200,
      tile: { widthCm: 60, heightCm: 30 },
      grout: { widthCm: 1 },
      exclusions: [],
      pattern: { type: 'runningBond', bondFraction: 0.5, rotationDeg: 0 },
      pricing: { reserveTiles: 0 },
      waste: {},
    });

    const result = computePlanMetrics(state);
    assertMetricsInvariants(result);
  });

  it('calculates gross room area', () => {
    const state = createTestState({
      roomW: 300, roomH: 400,
      tile: { widthCm: 50, heightCm: 50 },
      grout: { widthCm: 1 },
      exclusions: [],
      pattern: { type: 'grid', rotationDeg: 0 },
      pricing: { reserveTiles: 0 },
      waste: {},
    });

    const result = computePlanMetrics(state);
    assertMetricsInvariants(result);

    const expectedGrossM2 = (300 * 400) / 10000;
    expect(result.data.area.grossRoomAreaM2).toBeCloseTo(expectedGrossM2, 2);
  });

  it('reuses diagonally cut tiles in 45° angled pattern', () => {
    const state = createTestState({
      roomW: 200, roomH: 200,
      tile: { widthCm: 60, heightCm: 60 },
      grout: { widthCm: 1 },
      exclusions: [],
      pattern: { type: 'grid', rotationDeg: 45, offsetXcm: 0, offsetYcm: 0, origin: { preset: 'tl' } },
      pricing: { reserveTiles: 0 },
      waste: { allowRotate: true, optimizeCuts: true, kerfCm: 0.3 },
    });

    const result = computePlanMetrics(state);
    expect(result.ok).toBe(true);

    expect(result.data.tiles.cutTiles).toBeGreaterThan(0);
    expect(result.data.tiles.reusedCuts).toBeGreaterThan(0);
    expect(result.data.tiles.reusedCuts).toBeLessThanOrEqual(result.data.tiles.cutTiles);

    const purchasedTiles = result.data.tiles.purchasedTiles;
    const fullTiles = result.data.tiles.fullTiles;
    const cutTiles = result.data.tiles.cutTiles;
    const reusedCuts = result.data.tiles.reusedCuts;

    expect(purchasedTiles).toBe(fullTiles + (cutTiles - reusedCuts));

    expect(result.data.waste.allowRotate).toBe(true);
    expect(result.data.waste.optimizeCuts).toBe(true);
    expect(result.data.waste.kerfCm).toBe(0.3);
  });

  it('creates reusable offcuts from diagonal cuts', () => {
    const state = createTestState({
      roomW: 150, roomH: 150,
      tile: { widthCm: 50, heightCm: 50 },
      grout: { widthCm: 0.5 },
      exclusions: [],
      pattern: { type: 'grid', rotationDeg: 45 },
      pricing: { reserveTiles: 0 },
      waste: { allowRotate: true, optimizeCuts: true, kerfCm: 0.2 },
    });

    const result = computePlanMetrics(state);
    expect(result.ok).toBe(true);

    expect(result.data.debug).toBeDefined();
    expect(result.data.debug.tileUsage).toBeDefined();
    expect(result.data.debug.offcutPoolFinal).toBeDefined();

    const reusedTiles = result.data.debug.tileUsage.filter(t => t.reused === true);
    expect(reusedTiles.length).toBeGreaterThan(0);

    const tilesWithOffcuts = result.data.debug.tileUsage.filter(
      t => t.createdOffcuts && t.createdOffcuts.length > 0
    );
    expect(tilesWithOffcuts.length).toBeGreaterThan(0);
  });

  it('handles exact diagonal fit scenario from user bug report', () => {
    const stateWithoutOptimize = createTestState({
      roomW: 70.71, roomH: 70.71,
      tile: { widthCm: 50, heightCm: 50 },
      grout: { widthCm: 0 },
      exclusions: [],
      pattern: { type: 'grid', rotationDeg: 45, offsetXcm: 0, offsetYcm: 0, origin: { preset: 'tl' } },
      pricing: { pricePerM2: 50, packM2: 1, reserveTiles: 0 },
      waste: { allowRotate: true, optimizeCuts: false, kerfCm: 0 },
    });

    const resultWithout = computePlanMetrics(stateWithoutOptimize);
    expect(resultWithout.ok).toBe(true);

    const stateWithOptimize = createTestState({
      roomW: 70.71, roomH: 70.71,
      tile: { widthCm: 50, heightCm: 50 },
      grout: { widthCm: 0 },
      exclusions: [],
      pattern: { type: 'grid', rotationDeg: 45, offsetXcm: 0, offsetYcm: 0, origin: { preset: 'tl' } },
      pricing: { pricePerM2: 50, packM2: 1, reserveTiles: 0 },
      waste: { allowRotate: true, optimizeCuts: true, kerfCm: 0 },
    });

    const resultWith = computePlanMetrics(stateWithOptimize);
    expect(resultWith.ok).toBe(true);

    // Both modes should now handle diagonal cuts efficiently
    // The key fix: using actual polygon area instead of bounding box
    expect(resultWithout.data.tiles.reusedCuts).toBeGreaterThan(0);
    expect(resultWith.data.tiles.reusedCuts).toBeGreaterThan(0);

    // For this exact diagonal fit case, should need only 2 tiles (4 cuts, 2 reused)
    expect(resultWithout.data.tiles.purchasedTiles).toBe(2);
    expect(resultWith.data.tiles.purchasedTiles).toBe(2);

    // Should have 0% waste for this perfect fit
    expect(resultWithout.data.material.wastePct).toBeLessThan(1);
    expect(resultWith.data.material.wastePct).toBeLessThan(1);
  });

  it('handles larger diagonal room with minimal waste', () => {
    const state = createTestState({
      roomW: 282.84272, roomH: 282.84272,
      tile: { widthCm: 50, heightCm: 50 },
      grout: { widthCm: 0 },
      exclusions: [],
      pattern: { type: 'grid', rotationDeg: 45, offsetXcm: 0, offsetYcm: 0, origin: { preset: 'tl' } },
      pricing: { pricePerM2: 50, packM2: 1, reserveTiles: 0 },
      waste: { allowRotate: true, optimizeCuts: true, kerfCm: 0 },
    });

    const result = computePlanMetrics(state);
    expect(result.ok).toBe(true);

    // With proper diagonal optimization and pairing, all complementary border triangles are paired
    // For a perfect square at 45°, we achieve 0% waste through optimal pairing
    expect(result.data.tiles.reusedCuts).toBeGreaterThan(0);
    expect(result.data.material.wastePct).toBeLessThan(1);
  });
});

describe('computePlanMetrics – 3D object face tiles', () => {
  function createStateWithObject(opts = {}) {
    const roomW = opts.roomW || 200;
    const roomH = opts.roomH || 200;
    const floorId = 'test-floor';
    const roomId = 'test-room';

    const faceTile = opts.faceTile || { widthCm: 20, heightCm: 20 };
    const surfaces = opts.surfaces || [
      { id: 's-front', face: 'front', tile: faceTile, grout: { widthCm: 0, colorHex: '#fff' }, pattern: { type: 'grid', bondFraction: 0.5, rotationDeg: 0, offsetXcm: 0, offsetYcm: 0 } },
      { id: 's-back', face: 'back', tile: null, grout: null, pattern: null },
      { id: 's-left', face: 'left', tile: null, grout: null, pattern: null },
      { id: 's-right', face: 'right', tile: null, grout: null, pattern: null },
      { id: 's-top', face: 'top', tile: null, grout: null, pattern: null },
    ];

    const objects3d = opts.objects3d || [{
      id: 'obj-1',
      type: 'rect',
      label: 'Test Object',
      x: 10, y: 10,
      w: opts.objW || 100,
      h: opts.objH || 60,
      heightCm: opts.objHeight || 80,
      skirtingEnabled: false,
      surfaces,
    }];

    return {
      meta: { version: 8 },
      project: { name: 'Test Project' },
      floors: [{
        id: floorId,
        name: 'Test Floor',
        rooms: [{
          id: roomId,
          name: 'Test Room',
          polygonVertices: [
            { x: 0, y: 0 }, { x: roomW, y: 0 },
            { x: roomW, y: roomH }, { x: 0, y: roomH },
          ],
          exclusions: [],
          tile: { widthCm: 50, heightCm: 50 },
          grout: { widthCm: 0 },
          pattern: { type: 'grid', rotationDeg: 0, offsetXcm: 0, offsetYcm: 0, origin: { preset: 'tl' } },
          skirting: { enabled: false },
          objects3d,
        }],
      }],
      selectedFloorId: floorId,
      selectedRoomId: roomId,
      pricing: { pricePerM2: 50, packM2: 1, reserveTiles: 0 },
      waste: { allowRotate: true, optimizeCuts: false, kerfCm: 0 },
      view: {},
    };
  }

  it('includes face tiles in total tile count', () => {
    // Room: 200x200 with 50x50 tiles, 0 grout → 4x4 = 16 floor tiles (all full)
    // Object: front face = 100w × 80h with 20x20 tiles, 0 grout → 5×4 = 20 face tiles
    const state = createStateWithObject();
    const baseline = computePlanMetrics(createStateWithObject({ objects3d: [] }));
    const result = computePlanMetrics(state);

    assertMetricsInvariants(baseline);
    assertMetricsInvariants(result);

    const baseTotal = baseline.data.tiles.fullTiles + baseline.data.tiles.cutTiles;
    const withObjTotal = result.data.tiles.fullTiles + result.data.tiles.cutTiles;

    // Face tiles should add to the count
    expect(withObjTotal).toBeGreaterThan(baseTotal);
    // Front face: 100×80 with 20×20 tiles = 5×4 = 20 tiles
    expect(withObjTotal - baseTotal).toBe(20);
  });

  it('does not count faces with tile=null', () => {
    // All surfaces have tile=null → no extra tiles
    const surfaces = ['front', 'back', 'left', 'right', 'top'].map(face => ({
      id: `s-${face}`, face, tile: null, grout: null, pattern: null,
    }));
    const state = createStateWithObject({ surfaces });
    const baseline = computePlanMetrics(createStateWithObject({ objects3d: [] }));
    const result = computePlanMetrics(state);

    assertMetricsInvariants(result);

    const baseTotal = baseline.data.tiles.fullTiles + baseline.data.tiles.cutTiles;
    const withObjTotal = result.data.tiles.fullTiles + result.data.tiles.cutTiles;
    expect(withObjTotal).toBe(baseTotal);
  });

  it('counts tiles on multiple faces', () => {
    const faceTile = { widthCm: 20, heightCm: 20 };
    const faceSettings = { tile: faceTile, grout: { widthCm: 0, colorHex: '#fff' }, pattern: { type: 'grid', bondFraction: 0.5, rotationDeg: 0, offsetXcm: 0, offsetYcm: 0 } };
    const surfaces = [
      { id: 's-front', face: 'front', ...faceSettings },
      { id: 's-back', face: 'back', ...faceSettings },
      { id: 's-left', face: 'left', tile: null, grout: null, pattern: null },
      { id: 's-right', face: 'right', tile: null, grout: null, pattern: null },
      { id: 's-top', face: 'top', ...faceSettings },
    ];
    // obj: w=100, h=60, heightCm=80
    // front: 100×80 → 5×4 = 20 tiles
    // back: 100×80 → 5×4 = 20 tiles
    // top: 100×60 → 5×3 = 15 tiles
    const state = createStateWithObject({ surfaces });
    const baseline = computePlanMetrics(createStateWithObject({ objects3d: [] }));
    const result = computePlanMetrics(state);

    assertMetricsInvariants(result);

    const baseTotal = baseline.data.tiles.fullTiles + baseline.data.tiles.cutTiles;
    const withObjTotal = result.data.tiles.fullTiles + result.data.tiles.cutTiles;
    expect(withObjTotal - baseTotal).toBe(20 + 20 + 15);
  });

  it('uses correct face dimensions for side vs top faces', () => {
    // left/right faces use obj.h (depth) × heightCm
    const faceTile = { widthCm: 10, heightCm: 10 };
    const faceSettings = { tile: faceTile, grout: { widthCm: 0, colorHex: '#fff' }, pattern: { type: 'grid', bondFraction: 0.5, rotationDeg: 0, offsetXcm: 0, offsetYcm: 0 } };
    // Only left face tiled: obj.h=60 × heightCm=80 → 6×8 = 48 tiles
    const surfaces = [
      { id: 's-front', face: 'front', tile: null, grout: null, pattern: null },
      { id: 's-back', face: 'back', tile: null, grout: null, pattern: null },
      { id: 's-left', face: 'left', ...faceSettings },
      { id: 's-right', face: 'right', tile: null, grout: null, pattern: null },
      { id: 's-top', face: 'top', tile: null, grout: null, pattern: null },
    ];
    const state = createStateWithObject({ surfaces, objW: 100, objH: 60, objHeight: 80 });
    const baseline = computePlanMetrics(createStateWithObject({ objects3d: [] }));
    const result = computePlanMetrics(state);

    assertMetricsInvariants(result);

    const baseTotal = baseline.data.tiles.fullTiles + baseline.data.tiles.cutTiles;
    const withObjTotal = result.data.tiles.fullTiles + result.data.tiles.cutTiles;
    // left face: obj.h(60) × heightCm(80) with 10×10 tiles = 6×8 = 48
    expect(withObjTotal - baseTotal).toBe(48);
  });

  it('includes face tile area in installed area', () => {
    const state = createStateWithObject();
    const baseline = computePlanMetrics(createStateWithObject({ objects3d: [] }));
    const result = computePlanMetrics(state);

    assertMetricsInvariants(result);

    // The object's footprint (100×60) is subtracted from floor area by getAllFloorExclusions,
    // but the front face area (100×80) is added back as face tile installed area.
    // Net change: -100×60 + 100×80 = -6000 + 8000 = +2000 cm² = +0.2 m²
    const footprintM2 = (100 * 60) / 10000;
    const faceAreaM2 = (100 * 80) / 10000;
    const expectedDelta = faceAreaM2 - footprintM2;
    expect(result.data.material.installedAreaM2).toBeCloseTo(
      baseline.data.material.installedAreaM2 + expectedDelta, 2
    );
  });

  it('handles room with no objects3d property', () => {
    const state = createStateWithObject({ objects3d: [] });
    // Remove objects3d entirely
    delete state.floors[0].rooms[0].objects3d;

    const result = computePlanMetrics(state);
    assertMetricsInvariants(result);
    // Should work fine — no extra tiles
    expect(result.data.tiles.fullTiles).toBeGreaterThan(0);
  });
});
