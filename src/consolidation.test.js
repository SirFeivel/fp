import { describe, it, expect, beforeEach } from 'vitest';
import { computeProjectTotals, clearMetricsCache } from './calc.js';
import { uuid } from './core.js';

beforeEach(() => clearMetricsCache());

describe('Commercial Consolidation', () => {
  it('groups multiple rooms with the same tile reference', () => {
    const floorId = uuid();
    const state = {
      meta: { version: 5 },
      project: { name: 'Test' },
      floors: [
        {
          id: floorId,
          name: 'Floor 1',
          rooms: [
            {
              id: uuid(),
              name: 'Room A',
              polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
              tile: { widthCm: 10, heightCm: 10, reference: 'Marble' },
              grout: { widthCm: 0 },
              pattern: { type: 'grid' },
              skirting: { enabled: false }
            },
            {
              id: uuid(),
              name: 'Room B',
              polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
              tile: { widthCm: 10, heightCm: 10, reference: 'Marble' },
              grout: { widthCm: 0 },
              pattern: { type: 'grid' },
              skirting: { enabled: false }
            }
          ]
        }
      ],
      selectedFloorId: floorId,
      pricing: { pricePerM2: 100, packM2: 1, reserveTiles: 0 },
      materials: {}
    };

    const totals = computeProjectTotals(state);
    
    // Each room is 1m2, so total should be 2m2
    expect(totals.totalNetAreaM2).toBe(2);
    
    // Marble should be consolidated
    const marble = totals.materials.find(m => m.reference === 'Marble');
    expect(marble).toBeDefined();
    expect(marble.netAreaM2).toBe(2);
    // 1m2 = 100 tiles (10x10cm) -> 2m2 = 200 tiles
    expect(marble.totalTiles).toBe(200);
  });

  it('includes skirting cutout tiles in consolidation', () => {
    const floorId = uuid();
    const state = {
      meta: { version: 5 },
      project: { name: 'Test' },
      floors: [
        {
          id: floorId,
          name: 'Floor 1',
          rooms: [
            {
              id: uuid(),
              name: 'Room A',
              polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
              tile: { widthCm: 50, heightCm: 50, reference: 'Oak' },
              grout: { widthCm: 0 },
              pattern: { type: 'grid' },
              skirting: { enabled: true, type: 'cutout', heightCm: 10 }
            }
          ]
        }
      ],
      selectedFloorId: floorId,
      pricing: { pricePerM2: 100, packM2: 1, reserveTiles: 0 },
      materials: {}
    };

    const totals = computeProjectTotals(state);
    const oak = totals.materials.find(m => m.reference === 'Oak');
    
    // Room is 1m2. Tile is 50x50cm (0.25m2). 4 tiles for floor.
    // Perimeter is 400cm. Skirting height 10cm. 
    // Tile height is 50cm, skirting height 10cm -> 2 strips per tile (practical max is 2).
    // Total strips needed: 400cm / 50cm = 8 strips.
    // 8 strips / 2 strips per tile = 4 additional tiles.
    // Total = 4 (floor) + 4 (skirting) = 8 tiles.
    
    expect(oak.totalTiles).toBe(8);
  });

  it('consolidates tiles and skirting from multiple rooms with same reference', () => {
    const floorId = uuid();
    const state = {
      meta: { version: 5 },
      project: { name: 'Test' },
      floors: [
        {
          id: floorId,
          name: 'Floor 1',
          rooms: [
            {
              id: uuid(),
              name: 'Room A',
              polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
              tile: { widthCm: 50, heightCm: 50, reference: 'Oak' },
              grout: { widthCm: 0 },
              pattern: { type: 'grid' },
              skirting: { enabled: true, type: 'cutout', heightCm: 10 }
            },
            {
              id: uuid(),
              name: 'Room B',
              polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
              tile: { widthCm: 50, heightCm: 50, reference: 'Oak' },
              grout: { widthCm: 0 },
              pattern: { type: 'grid' },
              skirting: { enabled: true, type: 'cutout', heightCm: 10 }
            }
          ]
        }
      ],
      selectedFloorId: floorId,
      pricing: { pricePerM2: 100, packM2: 1, reserveTiles: 0 },
      materials: {}
    };

    const totals = computeProjectTotals(state);
    const oak = totals.materials.find(m => m.reference === 'Oak');

    // Each room needs 8 tiles (4 floor + 4 skirting)
    // Total should be 16 tiles.
    expect(oak.totalTiles).toBe(16);
    expect(oak.netAreaM2).toBe(2);
  });

  it('multi-floor same-reference material consolidation', () => {
    const state = {
      meta: { version: 5 },
      project: { name: 'Test' },
      floors: [
        {
          id: uuid(),
          name: 'Floor 1',
          rooms: [{
            id: uuid(),
            name: 'Room A',
            polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
            tile: { widthCm: 10, heightCm: 10, reference: 'Granite' },
            grout: { widthCm: 0 },
            pattern: { type: 'grid' },
            skirting: { enabled: false }
          }]
        },
        {
          id: uuid(),
          name: 'Floor 2',
          rooms: [{
            id: uuid(),
            name: 'Room B',
            polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
            tile: { widthCm: 10, heightCm: 10, reference: 'Granite' },
            grout: { widthCm: 0 },
            pattern: { type: 'grid' },
            skirting: { enabled: false }
          }]
        }
      ],
      pricing: { pricePerM2: 100, packM2: 1, reserveTiles: 0 },
      materials: {}
    };

    const totals = computeProjectTotals(state);
    // Both rooms use "Granite", should consolidate to a single material entry
    const granite = totals.materials.find(m => m.reference === 'Granite');
    expect(granite).toBeDefined();
    expect(granite.netAreaM2).toBe(2);
    expect(granite.totalTiles).toBe(200); // 100 tiles per 1m2 room (10x10cm = 0.01m2)
    expect(totals.materials.length).toBe(1);
  });

  it('single room consolidation counts correctly', () => {
    const floorId = uuid();
    const state = {
      meta: { version: 5 },
      project: { name: 'Test' },
      floors: [{
        id: floorId,
        name: 'Floor 1',
        rooms: [
          {
            id: 'r1',
            name: 'Room A',
            polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
            tile: { widthCm: 50, heightCm: 50, reference: 'Oak' },
            grout: { widthCm: 0 },
            pattern: { type: 'grid' },
            skirting: { enabled: false }
          }
        ]
      }],
      selectedFloorId: floorId,
      pricing: { pricePerM2: 100, packM2: 1, reserveTiles: 0 },
      materials: {}
    };

    const totals = computeProjectTotals(state);
    const oak = totals.materials.find(m => m.reference === 'Oak');
    expect(oak).toBeDefined();
    expect(oak.netAreaM2).toBeCloseTo(1, 2);
    expect(totals.roomCount).toBe(1);
  });

  it('extraPacks added to adjusted cost', () => {
    const floorId = uuid();
    const state = {
      meta: { version: 5 },
      project: { name: 'Test' },
      floors: [{
        id: floorId,
        name: 'Floor 1',
        rooms: [{
          id: uuid(),
          name: 'Room A',
          polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
          tile: { widthCm: 50, heightCm: 50, reference: 'Oak' },
          grout: { widthCm: 0 },
          pattern: { type: 'grid' },
          skirting: { enabled: false }
        }]
      }],
      selectedFloorId: floorId,
      pricing: { pricePerM2: 100, packM2: 1, reserveTiles: 0 },
      materials: { 'Oak': { pricePerM2: 100, packM2: 1, extraPacks: 3 } }
    };

    const totals = computeProjectTotals(state);
    const oak = totals.materials.find(m => m.reference === 'Oak');
    expect(oak).toBeDefined();
    // extraPacks = 3, each pack = 1m2 * 100€/m2 = 100€ extra
    // basePacks = ceil(1m2 / 1m2) = 1
    // totalPacks = 1 + 3 = 4
    expect(oak.totalPacks).toBe(4);
    expect(oak.extraPacks).toBe(3);
    // adjustedCost = baseCost + 3 * 1 * 100 = baseCost + 300
    expect(oak.adjustedCost).toBeGreaterThan(oak.totalCost);
  });
});
