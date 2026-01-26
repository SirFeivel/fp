import { computePlanMetrics } from './src/calc.js';

const hexState = {
  project: { name: "Hexagon Test" },
  floors: [{
    id: "floor-1",
    name: "Test Floor",
    rooms: [{
      id: "room-1",
      name: "Hexagon Pattern Test",
      widthCm: 400,
      heightCm: 400,
      exclusions: [],
      tile: { widthCm: 30, heightCm: 30, shape: "hex" },
      grout: { widthCm: 1 },
      pattern: {
        type: "grid",
        rotationDeg: 0,
        offsetXcm: 0,
        offsetYcm: 0,
        origin: { preset: "tl", xCm: 0, yCm: 0 }
      }
    }]
  }],
  selectedFloorId: "floor-1",
  selectedRoomId: "room-1",
  pricing: { pricePerM2: 50, packM2: 1, reserveTiles: 0 },
  waste: { allowRotate: true, optimizeCuts: false, kerfCm: 0 },
  view: { showGrid: true, showNeeds: true }
};

console.log('\n=== HEXAGONAL TILE TEST ===\n');
const result = computePlanMetrics(hexState);
console.log(`Status: ${result.ok ? 'OK' : 'ERROR'}`);
if (result.error) {
  console.log(`Error: ${result.error}`);
} else {
  console.log(`Full tiles: ${result.data.tiles.fullTiles}`);
  console.log(`Cut tiles: ${result.data.tiles.cutTiles}`);
  console.log(`Purchased tiles: ${result.data.tiles.purchasedTiles}`);
  console.log(`Tile area (cm²): ${result.data.material.tileAreaCm2.toFixed(2)}`);
  console.log(`Installed area (m²): ${result.data.material.installedAreaM2.toFixed(2)}`);
  console.log(`Waste: ${result.data.material.wastePct.toFixed(1)}%`);
}
