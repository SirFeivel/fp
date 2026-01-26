import { describe, it, expect } from 'vitest';
import { computePlanMetrics } from './calc.js';

describe('computePlanMetrics', () => {
  it('returns error for invalid tile dimensions', () => {
    const state = {
      room: { widthCm: 400, heightCm: 500 },
      tile: { widthCm: 0, heightCm: 60 },
      grout: { widthCm: 1 },
      exclusions: [],
      pattern: { type: 'grid', rotationDeg: 0 },
      pricing: {},
      waste: {},
    };

    const result = computePlanMetrics(state);
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('returns error for negative grout width', () => {
    const state = {
      room: { widthCm: 400, heightCm: 500 },
      tile: { widthCm: 30, heightCm: 60 },
      grout: { widthCm: -1 },
      exclusions: [],
      pattern: { type: 'grid', rotationDeg: 0 },
      pricing: {},
      waste: {},
    };

    const result = computePlanMetrics(state);
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('calculates metrics for simple room with no exclusions', () => {
    const state = {
      room: { widthCm: 400, heightCm: 500 },
      tile: { widthCm: 30, heightCm: 60 },
      grout: { widthCm: 1 },
      exclusions: [],
      pattern: { type: 'grid', rotationDeg: 0 },
      pricing: { pricePerM2: 50, packM2: 1, reserveTiles: 5 },
      waste: { allowRotate: true, optimizeCuts: false, kerfCm: 0 },
    };

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
    const state = {
      room: { widthCm: 100, heightCm: 100 },
      tile: { widthCm: 30, heightCm: 30 },
      grout: { widthCm: 1 },
      exclusions: [],
      pattern: { type: 'grid', rotationDeg: 0 },
      pricing: { reserveTiles: 0 },
      waste: { allowRotate: false, optimizeCuts: false, kerfCm: 0 },
    };

    const result = computePlanMetrics(state);
    expect(result.ok).toBe(true);
    expect(result.data.tiles.fullTiles).toBeGreaterThan(0);
    expect(result.data.labor.totalPlacedTiles).toBe(
      result.data.tiles.fullTiles + result.data.tiles.cutTiles
    );
  });

  it('calculates installed area correctly', () => {
    const state = {
      room: { widthCm: 200, heightCm: 200 },
      tile: { widthCm: 50, heightCm: 50 },
      grout: { widthCm: 0 },
      exclusions: [],
      pattern: { type: 'grid', rotationDeg: 0 },
      pricing: { reserveTiles: 0 },
      waste: {},
    };

    const result = computePlanMetrics(state);
    expect(result.ok).toBe(true);

    const expectedAreaM2 = (200 * 200) / 10000;
    expect(result.data.material.installedAreaM2).toBeCloseTo(expectedAreaM2, 2);
  });

  it('handles room with exclusions', () => {
    const state = {
      room: { widthCm: 200, heightCm: 200 },
      tile: { widthCm: 50, heightCm: 50 },
      grout: { widthCm: 0 },
      exclusions: [{ type: 'rect', x: 0, y: 0, w: 50, h: 50 }],
      pattern: { type: 'grid', rotationDeg: 0 },
      pricing: { reserveTiles: 0 },
      waste: {},
    };

    const result = computePlanMetrics(state);
    expect(result.ok).toBe(true);

    const expectedAreaM2 = ((200 * 200) - (50 * 50)) / 10000;
    expect(result.data.material.installedAreaM2).toBeCloseTo(expectedAreaM2, 2);
  });

  it('includes reserve tiles in purchase calculation', () => {
    const state = {
      room: { widthCm: 100, heightCm: 100 },
      tile: { widthCm: 50, heightCm: 50 },
      grout: { widthCm: 0 },
      exclusions: [],
      pattern: { type: 'grid', rotationDeg: 0 },
      pricing: { reserveTiles: 10 },
      waste: {},
    };

    const result = computePlanMetrics(state);
    expect(result.ok).toBe(true);
    expect(result.data.tiles.reserveTiles).toBe(10);
    expect(result.data.tiles.purchasedTilesWithReserve).toBe(
      result.data.tiles.purchasedTiles + 10
    );
  });

  it('calculates waste percentage correctly', () => {
    const state = {
      room: { widthCm: 100, heightCm: 100 },
      tile: { widthCm: 50, heightCm: 50 },
      grout: { widthCm: 0 },
      exclusions: [],
      pattern: { type: 'grid', rotationDeg: 0 },
      pricing: { reserveTiles: 2 },
      waste: {},
    };

    const result = computePlanMetrics(state);
    expect(result.ok).toBe(true);
    expect(result.data.material.wastePct).toBeGreaterThanOrEqual(0);
    expect(result.data.material.wastePct).toBeLessThan(100);
  });

  it('calculates pricing correctly', () => {
    const state = {
      room: { widthCm: 200, heightCm: 200 },
      tile: { widthCm: 50, heightCm: 50 },
      grout: { widthCm: 0 },
      exclusions: [],
      pattern: { type: 'grid', rotationDeg: 0 },
      pricing: { pricePerM2: 100, packM2: 2, reserveTiles: 0 },
      waste: {},
    };

    const result = computePlanMetrics(state);
    expect(result.ok).toBe(true);

    const areaM2 = (200 * 200) / 10000;
    const expectedPrice = areaM2 * 100;
    expect(result.data.pricing.priceTotal).toBeCloseTo(expectedPrice, 2);

    const expectedPacks = Math.ceil(areaM2 / 2);
    expect(result.data.pricing.packs).toBe(expectedPacks);
  });

  it('handles optimizeCuts option', () => {
    const state = {
      room: { widthCm: 150, heightCm: 150 },
      tile: { widthCm: 60, heightCm: 60 },
      grout: { widthCm: 1 },
      exclusions: [],
      pattern: { type: 'grid', rotationDeg: 0 },
      pricing: { reserveTiles: 0 },
      waste: { allowRotate: true, optimizeCuts: true, kerfCm: 0.3 },
    };

    const result = computePlanMetrics(state);
    expect(result.ok).toBe(true);
    expect(result.data.waste.optimizeCuts).toBe(true);
    expect(result.data.waste.kerfCm).toBe(0.3);
  });

  it('handles allowRotate option', () => {
    const stateWithRotate = {
      room: { widthCm: 150, heightCm: 150 },
      tile: { widthCm: 40, heightCm: 60 },
      grout: { widthCm: 1 },
      exclusions: [],
      pattern: { type: 'grid', rotationDeg: 0 },
      pricing: { reserveTiles: 0 },
      waste: { allowRotate: true, optimizeCuts: false, kerfCm: 0 },
    };

    const resultWithRotate = computePlanMetrics(stateWithRotate);
    expect(resultWithRotate.ok).toBe(true);
    expect(resultWithRotate.data.waste.allowRotate).toBe(true);

    const stateNoRotate = {
      ...stateWithRotate,
      waste: { allowRotate: false, optimizeCuts: false, kerfCm: 0 },
    };

    const resultNoRotate = computePlanMetrics(stateNoRotate);
    expect(resultNoRotate.ok).toBe(true);
    expect(resultNoRotate.data.waste.allowRotate).toBe(false);
  });

  it('calculates cut tiles percentage', () => {
    const state = {
      room: { widthCm: 100, heightCm: 100 },
      tile: { widthCm: 40, heightCm: 40 },
      grout: { widthCm: 0 },
      exclusions: [],
      pattern: { type: 'grid', rotationDeg: 0 },
      pricing: { reserveTiles: 0 },
      waste: {},
    };

    const result = computePlanMetrics(state);
    expect(result.ok).toBe(true);
    expect(result.data.labor.cutTilesPct).toBeGreaterThanOrEqual(0);
    expect(result.data.labor.cutTilesPct).toBeLessThanOrEqual(100);
  });

  it('tracks reused cuts when optimizing', () => {
    const state = {
      room: { widthCm: 150, heightCm: 150 },
      tile: { widthCm: 60, heightCm: 60 },
      grout: { widthCm: 1 },
      exclusions: [],
      pattern: { type: 'grid', rotationDeg: 0 },
      pricing: { reserveTiles: 0 },
      waste: { allowRotate: true, optimizeCuts: true, kerfCm: 0.3 },
    };

    const result = computePlanMetrics(state);
    expect(result.ok).toBe(true);
    expect(result.data.tiles.reusedCuts).toBeGreaterThanOrEqual(0);
    expect(result.data.tiles.reusedCuts).toBeLessThanOrEqual(result.data.tiles.cutTiles);
  });

  it('provides debug information', () => {
    const state = {
      room: { widthCm: 100, heightCm: 100 },
      tile: { widthCm: 50, heightCm: 50 },
      grout: { widthCm: 0 },
      exclusions: [],
      pattern: { type: 'grid', rotationDeg: 0 },
      pricing: { reserveTiles: 0 },
      waste: {},
    };

    const result = computePlanMetrics(state);
    expect(result.ok).toBe(true);
    expect(result.data.debug).toBeDefined();
    expect(result.data.debug.tileUsage).toBeDefined();
    expect(result.data.debug.cutNeeds).toBeDefined();
    expect(result.data.debug.offcutPoolFinal).toBeDefined();
  });

  it('handles running bond pattern', () => {
    const state = {
      room: { widthCm: 200, heightCm: 200 },
      tile: { widthCm: 60, heightCm: 30 },
      grout: { widthCm: 1 },
      exclusions: [],
      pattern: { type: 'runningBond', bondFraction: 0.5, rotationDeg: 0 },
      pricing: { reserveTiles: 0 },
      waste: {},
    };

    const result = computePlanMetrics(state);
    expect(result.ok).toBe(true);
  });

  it('calculates gross room area', () => {
    const state = {
      room: { widthCm: 300, heightCm: 400 },
      tile: { widthCm: 50, heightCm: 50 },
      grout: { widthCm: 1 },
      exclusions: [],
      pattern: { type: 'grid', rotationDeg: 0 },
      pricing: { reserveTiles: 0 },
      waste: {},
    };

    const result = computePlanMetrics(state);
    expect(result.ok).toBe(true);

    const expectedGrossM2 = (300 * 400) / 10000;
    expect(result.data.area.grossRoomAreaM2).toBeCloseTo(expectedGrossM2, 2);
  });
});
