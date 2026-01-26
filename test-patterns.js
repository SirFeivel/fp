import { computePlanMetrics } from './src/calc.js';

const baseState = {
  project: { name: "Pattern Test" },
  floors: [{
    id: "floor-1",
    name: "Test Floor",
    rooms: [{
      id: "room-1",
      name: "Pattern Test",
      widthCm: 300,
      heightCm: 300,
      exclusions: [],
      tile: { widthCm: 30, heightCm: 60, shape: "rect" },
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

function testPattern(patternType) {
  const state = JSON.parse(JSON.stringify(baseState));
  state.floors[0].rooms[0].pattern.type = patternType;

  console.log(`\n=== ${patternType.toUpperCase()} PATTERN TEST ===`);
  const result = computePlanMetrics(state);

  if (!result.ok) {
    console.log(`Error: ${result.error}`);
    return;
  }

  console.log(`Full tiles: ${result.data.tiles.fullTiles}`);
  console.log(`Cut tiles: ${result.data.tiles.cutTiles}`);
  console.log(`Purchased tiles: ${result.data.tiles.purchasedTiles}`);
  console.log(`Waste: ${result.data.material.wastePct.toFixed(1)}%`);
}

testPattern('grid');
testPattern('runningBond');
testPattern('herringbone');
testPattern('basketweave');
