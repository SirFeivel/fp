import { computePlanMetrics } from './src/calc.js';

const state = {
  project: { name: "Diagonal Test" },
  floors: [{
    id: "floor-1",
    name: "Test Floor",
    rooms: [{
      id: "room-1",
      name: "45° Pattern Test",
      widthCm: 282.84272,
      heightCm: 282.84272,
      exclusions: [],
      tile: { widthCm: 50, heightCm: 50 },
      grout: { widthCm: 0 },
      pattern: {
        type: "grid",
        bondFraction: 0.5,
        rotationDeg: 45,
        offsetXcm: 0,
        offsetYcm: 0,
        origin: { preset: "tl", xCm: 0, yCm: 0 }
      }
    }]
  }],
  selectedFloorId: "floor-1",
  selectedRoomId: "room-1",
  pricing: { pricePerM2: 50, packM2: 1, reserveTiles: 0 },
  waste: { allowRotate: true, optimizeCuts: true, kerfCm: 0 },
  view: { showGrid: true, showNeeds: true }
};

console.log('\n=== TESTING PAIRING EFFECTIVENESS ===\n');

const result = computePlanMetrics(state);

console.log('Results:');
console.log(`  Full tiles: ${result.data.tiles.fullTiles}`);
console.log(`  Cut tiles: ${result.data.tiles.cutTiles}`);
console.log(`  Reused cuts: ${result.data.tiles.reusedCuts}`);
console.log(`  Purchased tiles: ${result.data.tiles.purchasedTiles}`);
console.log(`  Waste: ${result.data.material.wastePct.toFixed(2)}%\n`);

console.log('Analysis:');
console.log(`  We found 13 perfect pairs (26 triangular tiles total)`);
console.log(`  But only ${result.data.tiles.reusedCuts} tiles reused offcuts`);
console.log(`  Expected: 13 reused (second tile of each pair)`);
console.log(`  Actual: ${result.data.tiles.reusedCuts} reused`);
console.log(`  Gap: ${13 - result.data.tiles.reusedCuts} pairs failed to match\n`);

const expectedTiles = result.data.tiles.fullTiles + 13;
const actualTiles = result.data.tiles.purchasedTiles;
console.log(`Expected tiles needed: ${expectedTiles} (24 full + 13 new for first-of-pair)`);
console.log(`Actual tiles needed: ${actualTiles}`);
console.log(`Overhead: ${actualTiles - expectedTiles} extra tiles = ${((actualTiles - expectedTiles) / expectedTiles * 100).toFixed(1)}% waste\n`);
