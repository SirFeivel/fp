import { describe, it, expect } from 'vitest';
import { computePlanMetrics } from './calc.js';

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
    expect(result.ok).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data.tiles).toBeDefined();
    expect(result.data.material).toBeDefined();
    expect(result.data.labor).toBeDefined();
    expect(result.data.area).toBeDefined();
    expect(result.data.pricing).toBeDefined();
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
    expect(result.ok).toBe(true);
    expect(result.data.tiles.fullTiles).toBeGreaterThan(0);
    expect(result.data.labor.totalPlacedTiles).toBe(
      result.data.tiles.fullTiles + result.data.tiles.cutTiles
    );
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
    expect(result.ok).toBe(true);

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
    expect(result.ok).toBe(true);

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
    expect(result.ok).toBe(true);
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
    expect(result.ok).toBe(true);
    expect(result.data.material.wastePct).toBeGreaterThanOrEqual(0);
    expect(result.data.material.wastePct).toBeLessThan(100);
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
    expect(result.ok).toBe(true);

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
    expect(result.ok).toBe(true);
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
    expect(resultWithRotate.ok).toBe(true);
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
    expect(resultNoRotate.ok).toBe(true);
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
    expect(result.data.labor.cutTilesPct).toBeGreaterThanOrEqual(0);
    expect(result.data.labor.cutTilesPct).toBeLessThanOrEqual(100);
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
    expect(result.ok).toBe(true);
    expect(result.data.tiles.reusedCuts).toBeGreaterThanOrEqual(0);
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
    expect(result.ok).toBe(true);
    expect(result.data.debug).toBeDefined();
    expect(result.data.debug.tileUsage).toBeDefined();
    expect(result.data.debug.cutNeeds).toBeDefined();
    expect(result.data.debug.offcutPoolFinal).toBeDefined();
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
    expect(result.ok).toBe(true);
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
    expect(result.ok).toBe(true);

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

    console.log('User bug report test - WITHOUT optimization:', {
      fullTiles: resultWithout.data.tiles.fullTiles,
      cutTiles: resultWithout.data.tiles.cutTiles,
      reusedCuts: resultWithout.data.tiles.reusedCuts,
      purchasedTiles: resultWithout.data.tiles.purchasedTiles,
      wastePct: resultWithout.data.material.wastePct.toFixed(1) + '%'
    });

    console.log('User bug report test - WITH optimization:', {
      fullTiles: resultWith.data.tiles.fullTiles,
      cutTiles: resultWith.data.tiles.cutTiles,
      reusedCuts: resultWith.data.tiles.reusedCuts,
      purchasedTiles: resultWith.data.tiles.purchasedTiles,
      wastePct: resultWith.data.material.wastePct.toFixed(1) + '%'
    });

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

    console.log('Larger diagonal room (4x original):', {
      fullTiles: result.data.tiles.fullTiles,
      cutTiles: result.data.tiles.cutTiles,
      reusedCuts: result.data.tiles.reusedCuts,
      purchasedTiles: result.data.tiles.purchasedTiles,
      wastePct: result.data.material.wastePct.toFixed(1) + '%'
    });

    // With proper diagonal optimization and pairing, all complementary border triangles are paired
    // For a perfect square at 45°, we achieve 0% waste through optimal pairing
    expect(result.data.tiles.reusedCuts).toBeGreaterThan(0);
    expect(result.data.material.wastePct).toBeLessThan(1);
  });
});
