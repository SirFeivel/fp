import { expect } from 'vitest';

export function assertMetricsInvariants(result) {
  expect(result).toBeDefined();
  if (!result.ok) return;

  const d = result.data;
  expect(d).toBeDefined();
  expect(d.tiles).toBeDefined();
  expect(d.tiles.fullTiles).toBeGreaterThanOrEqual(0);
  expect(d.tiles.cutTiles).toBeGreaterThanOrEqual(0);
  expect(d.tiles.purchasedTiles).toBeGreaterThanOrEqual(0);
  expect(d.material).toBeDefined();
  expect(d.pricing).toBeDefined();
  expect(d.pricing.priceTotal).toBeGreaterThanOrEqual(0);
}
