import { getCurrentRoom } from './src/core.js';
import { computeAvailableArea, tilesForPreview, multiPolyArea } from './src/geometry.js';

// Copy the parsePathDToPolygon function from calc.js
function parsePathDToPolygon(d) {
  const commands = d.trim().split(/(?=[MLZ])/);
  const points = [];

  for (const cmd of commands) {
    const letter = cmd[0];
    if (letter === 'M' || letter === 'L') {
      const coords = cmd.slice(1).trim().split(/[\s,]+/).map(Number);
      if (coords.length >= 2) {
        points.push([coords[0], coords[1]]);
      }
    }
  }

  if (points.length < 3) return null;
  return [[points]];
}

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

console.log('\n=== DETAILED CUT TILE ANALYSIS ===\n');

const cutTiles = [];
for (let i = 0; i < t.tiles.length; i++) {
  const tile = t.tiles[i];
  if (tile.d && tile.d !== tile.origD) {
    const bb = tile.bb || { x: 0, y: 0, w: 50, h: 50 };
    const polygon = parsePathDToPolygon(tile.d);
    const bboxArea = bb.w * bb.h;
    const actualArea = polygon ? multiPolyArea(polygon) : bboxArea;
    const areaRatio = bboxArea > 0 ? actualArea / bboxArea : 1;

    cutTiles.push({
      index: i,
      bb,
      actualArea,
      bboxArea,
      areaRatio,
      isTriangular: areaRatio >= 0.45 && areaRatio <= 0.6
    });
  }
}

console.log(`Total cut tiles: ${cutTiles.length}\n`);

// Analyze area ratios
const areaRatios = cutTiles.map(t => t.areaRatio).sort((a, b) => a - b);
console.log('Area ratios (sorted):');
console.log(`  Min: ${areaRatios[0].toFixed(4)}`);
console.log(`  Max: ${areaRatios[areaRatios.length - 1].toFixed(4)}`);
console.log(`  Median: ${areaRatios[Math.floor(areaRatios.length / 2)].toFixed(4)}`);

const triangularCount = cutTiles.filter(t => t.isTriangular).length;
const nonTriangularCount = cutTiles.length - triangularCount;

console.log(`\nTriangular cuts (ratio 0.45-0.6): ${triangularCount}`);
console.log(`Non-triangular cuts: ${nonTriangularCount}\n`);

// Show distribution
const histogram = {};
cutTiles.forEach(t => {
  const bucket = Math.floor(t.areaRatio * 10) / 10;
  histogram[bucket] = (histogram[bucket] || 0) + 1;
});

console.log('Area ratio histogram:');
Object.keys(histogram).sort().forEach(bucket => {
  const bar = '█'.repeat(histogram[bucket]);
  console.log(`  ${Number(bucket).toFixed(1)}: ${bar} (${histogram[bucket]})`);
});

console.log('\n=== THE PROBLEM ===\n');
console.log('With 26 cut tiles and only 15 reused, we have 11 tiles (42%) creating waste.\n');
console.log('Hypothesis: The tiles are processed in scan order (left-to-right, top-to-bottom).');
console.log('When a left-edge triangle is processed FIRST, there\'s no matching right-edge');
console.log('triangle in the pool yet, so it uses a new tile. When the right-edge triangle');
console.log('is processed LATER, the pool now has a match, so it reuses it.\n');
console.log('This means roughly HALF of complementary pairs will miss each other.\n');

console.log('Solution options:');
console.log('  1. Process tiles in a smarter order (edges first, group by size)');
console.log('  2. Two-pass algorithm: collect all cuts, then pair them optimally');
console.log('  3. Lookahead: check if upcoming tiles would benefit from waiting');
