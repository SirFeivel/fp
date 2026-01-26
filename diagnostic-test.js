import { computePlanMetrics } from './src/calc.js';
import { getCurrentRoom } from './src/core.js';
import { computeAvailableArea, tilesForPreview } from './src/geometry.js';

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

const currentRoom = getCurrentRoom(state);
const avail = computeAvailableArea(currentRoom, currentRoom.exclusions);
const t = tilesForPreview(state, avail.mp);

console.log('\n=== DIAGNOSTIC: Analyzing Tile Layout ===\n');
console.log(`Room: ${currentRoom.widthCm} × ${currentRoom.heightCm} cm`);
console.log(`Tile: ${currentRoom.tile.widthCm} × ${currentRoom.tile.heightCm} cm @ 45°`);
console.log(`Total tiles in preview: ${t.tiles.length}\n`);

let fullCount = 0;
let cutCount = 0;
const cutDetails = [];

for (let i = 0; i < t.tiles.length; i++) {
  const tile = t.tiles[i];
  const bb = tile.bb || { x: 0, y: 0, w: 50, h: 50 };

  if (!tile.d || tile.d === tile.origD) {
    fullCount++;
  } else {
    cutCount++;
    cutDetails.push({
      index: i,
      bboxW: bb.w,
      bboxH: bb.h,
      bboxArea: bb.w * bb.h,
      position: { x: bb.x, y: bb.y }
    });
  }
}

console.log(`Full tiles: ${fullCount}`);
console.log(`Cut tiles: ${cutCount}\n`);

// Group by dimensions (rounded to handle floating point)
const groups = {};
cutDetails.forEach(d => {
  const key = `${d.bboxW.toFixed(1)}×${d.bboxH.toFixed(1)}`;
  if (!groups[key]) groups[key] = [];
  groups[key].push(d);
});

console.log('Cut tiles grouped by bounding box size:');
Object.entries(groups).sort((a, b) => b[1].length - a[1].length).forEach(([size, tiles]) => {
  console.log(`\n  ${size} cm: ${tiles.length} tiles`);
  if (tiles.length <= 6) {
    tiles.forEach(t => {
      console.log(`    - Tile ${t.index} at (${t.position.x.toFixed(1)}, ${t.position.y.toFixed(1)})`);
    });
  }
});

console.log('\n\n=== CALCULATION RESULTS ===\n');
const result = computePlanMetrics(state);
console.log(`  Full tiles: ${result.data.tiles.fullTiles}`);
console.log(`  Cut tiles: ${result.data.tiles.cutTiles}`);
console.log(`  Reused cuts: ${result.data.tiles.reusedCuts}`);
console.log(`  New tiles for cuts: ${result.data.tiles.cutTiles - result.data.tiles.reusedCuts}`);
console.log(`  Purchased tiles: ${result.data.tiles.purchasedTiles}`);
console.log(`  Waste: ${result.data.material.wastePct.toFixed(1)}%\n`);

console.log('\n=== WHY IS THERE WASTE? ===\n');
console.log('For a square room with tiles at 45°, the geometry is:');
console.log('  - Interior tiles are full diamonds');
console.log('  - Edge tiles are triangular cuts');
console.log('  - Each edge has triangular pieces that SHOULD pair up\n');

console.log('Potential issues:');
console.log('  1. Order matters: If a large triangle is processed before its');
console.log('     complementary piece exists in the pool, it uses a new tile');
console.log('  2. Size variation: Triangular pieces along edges have slightly');
console.log('     different sizes due to the diagonal cut geometry');
console.log('  3. Pool matching: The algorithm needs the EXACT right piece size\n');
