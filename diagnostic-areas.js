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

console.log('\n=== AREA ANALYSIS ===\n');

const result = computePlanMetrics(state);

const roomArea = 282.84272 * 282.84272;
const tileArea = 50 * 50;
const theoreticalTiles = roomArea / tileArea;

console.log(`Room dimensions: 282.84272 × 282.84272 cm`);
console.log(`Room area: ${roomArea.toFixed(2)} cm² = ${(roomArea / 10000).toFixed(4)} m²`);
console.log(`\nTile dimensions: 50 × 50 cm`);
console.log(`Tile area: ${tileArea} cm²`);
console.log(`\nTheoretical tiles needed: ${theoreticalTiles.toFixed(2)} tiles`);
console.log(`\nActual calculation:`);
console.log(`  Full tiles: ${result.data.tiles.fullTiles}`);
console.log(`  Cut tiles: ${result.data.tiles.cutTiles}`);
console.log(`  Tiles in preview: ${result.data.tiles.fullTiles + result.data.tiles.cutTiles}`);
console.log(`  Reused cuts: ${result.data.tiles.reusedCuts}`);
console.log(`  New tiles needed: ${result.data.tiles.purchasedTiles}`);

console.log(`\nMaterial:`);
console.log(JSON.stringify(result.data.material, null, 2));

const excessTiles = result.data.tiles.purchasedTiles - theoreticalTiles;
console.log(`\nExcess tiles: ${excessTiles.toFixed(2)} tiles (${(excessTiles / theoreticalTiles * 100).toFixed(2)}%)`);

console.log(`\n=== GOAL ===`);
console.log(`For a perfect square at 45°, we should be able to achieve 0% waste.`);
console.log(`Current waste of ${result.data.material.wastePct.toFixed(2)}% means there's still room for optimization.`);
