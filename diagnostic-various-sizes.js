import { computePlanMetrics } from './src/calc.js';

function testScenario(name, roomSize) {
  const state = {
    project: { name: "Test" },
    floors: [{
      id: "floor-1",
      name: "Test Floor",
      rooms: [{
        id: "room-1",
        name: "Test Room",
        widthCm: roomSize,
        heightCm: roomSize,
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

  const result = computePlanMetrics(state);
  const roomArea = roomSize * roomSize;
  const tileArea = 50 * 50;
  const theoretical = roomArea / tileArea;

  console.log(`\n${name}:`);
  console.log(`  Room: ${roomSize}×${roomSize} cm (${(roomArea/10000).toFixed(2)} m²)`);
  console.log(`  Theoretical tiles: ${theoretical.toFixed(2)}`);
  console.log(`  Actual tiles: ${result.data.tiles.purchasedTiles}`);
  console.log(`  Full tiles: ${result.data.tiles.fullTiles}, Cut tiles: ${result.data.tiles.cutTiles}, Reused: ${result.data.tiles.reusedCuts}`);
  console.log(`  Waste: ${result.data.material.wastePct.toFixed(2)}%`);
  console.log(`  Overhead: ${(result.data.tiles.purchasedTiles - theoretical).toFixed(2)} tiles (${((result.data.tiles.purchasedTiles - theoretical) / theoretical * 100).toFixed(1)}%)`);
}

console.log('=== TESTING VARIOUS ROOM SIZES (45° diagonal pattern) ===');

testScenario('Small square (2×2 tiles)', 141.42136);
testScenario('Medium square (4×4 tiles)', 282.84272);
testScenario('Large square (6×6 tiles)', 424.26408);
testScenario('Very large square (8×8 tiles)', 565.68544);

const state1 = {
  project: { name: "Test" },
  floors: [{
    id: "floor-1",
    name: "Test Floor",
    rooms: [{
      id: "room-1",
      name: "Test Room",
      widthCm: 200,
      heightCm: 200,
      exclusions: [],
      tile: { widthCm: 50, heightCm: 50 },
      grout: { widthCm: 0 },
      pattern: {
        type: "grid",
        bondFraction: 0.5,
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
  waste: { allowRotate: true, optimizeCuts: true, kerfCm: 0 },
  view: { showGrid: true, showNeeds: true }
};

const result1 = computePlanMetrics(state1);
console.log(`\n=== CONTROL TEST: 0° rotation (should have minimal waste) ===`);
console.log(`  Room: 200×200 cm`);
console.log(`  Full tiles: ${result1.data.tiles.fullTiles}, Cut tiles: ${result1.data.tiles.cutTiles}`);
console.log(`  Purchased tiles: ${result1.data.tiles.purchasedTiles}`);
console.log(`  Waste: ${result1.data.material.wastePct.toFixed(2)}%`);
