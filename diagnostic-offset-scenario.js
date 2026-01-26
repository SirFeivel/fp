import { computePlanMetrics } from './src/calc.js';

const state = {
  "meta": {
    "version": 2,
    "updatedAt": "2026-01-26T13:00:06.902Z"
  },
  "project": {
    "name": "Diagonal Test 1"
  },
  "floors": [
    {
      "id": "floor-1",
      "name": "Test Floor",
      "rooms": [
        {
          "id": "room-1",
          "name": "45° Pattern Test",
          "widthCm": 200,
          "heightCm": 200,
          "exclusions": [],
          "tile": {
            "widthCm": 50,
            "heightCm": 50
          },
          "grout": {
            "widthCm": 0
          },
          "pattern": {
            "type": "grid",
            "bondFraction": 0.5,
            "rotationDeg": 0,
            "offsetXcm": 20,
            "offsetYcm": 10,
            "origin": {
              "preset": "tl",
              "xCm": 0,
              "yCm": 0
            }
          }
        }
      ]
    }
  ],
  "selectedFloorId": "floor-1",
  "selectedRoomId": "room-1",
  "pricing": {
    "pricePerM2": 50,
    "packM2": 1,
    "reserveTiles": 0
  },
  "waste": {
    "allowRotate": true,
    "optimizeCuts": true,
    "kerfCm": 0
  },
  "view": {
    "showGrid": true,
    "showNeeds": true
  }
};

console.log('=== OFFSET PATTERN ANALYSIS ===\n');
console.log('Room: 200×200 cm');
console.log('Tiles: 50×50 cm');
console.log('Rotation: 0°');
console.log('Offset: 20cm right, 10cm down\n');

const result = computePlanMetrics(state);

if (!result.ok) {
  console.log('Error:', result.error);
  process.exit(1);
}

console.log('=== Results ===');
console.log(`Full tiles: ${result.data.tiles.fullTiles}`);
console.log(`Cut tiles: ${result.data.tiles.cutTiles}`);
console.log(`Reused cuts: ${result.data.tiles.reusedCuts}`);
console.log(`Purchased tiles: ${result.data.tiles.purchasedTiles}`);
console.log(`Waste: ${result.data.material.wastePct.toFixed(2)}%`);
console.log(`Waste tiles estimate: ${result.data.material.wasteTiles_est}`);

console.log('\n=== Why Waste Occurs ===');
console.log('With offsets, the tile grid is shifted relative to room boundaries:');
console.log('- Left edge: 20cm gap needs partial tiles');
console.log('- Top edge: 10cm gap needs partial tiles');
console.log('- Right edge: (200 - 20) % 50 = 180 % 50 = 30cm → needs partial tile');
console.log('- Bottom edge: (200 - 10) % 50 = 190 % 50 = 40cm → needs partial tile');

console.log('\nEdge cuts created:');
console.log('- Left column: tiles cut to 20cm width (40% of tile)');
console.log('- Top row: tiles cut to 10cm height (20% of tile)');
console.log('- Right column: tiles cut to 30cm width (60% of tile)');
console.log('- Bottom row: tiles cut to 40cm height (80% of tile)');
console.log('- Corner pieces: even smaller fragments');

const tileUsage = result.data.debug.tileUsage;
const cutTileDetails = tileUsage
  .filter(t => !t.isFull && t.source !== 'degenerate')
  .map((t, idx) => ({
    idx: tileUsage.indexOf(t),
    source: t.source,
    reused: t.reused,
    needW: t.need?.w?.toFixed(1) || 'N/A',
    needH: t.need?.h?.toFixed(1) || 'N/A',
    usedOffcut: t.usedOffcut ? `${t.usedOffcut.w.toFixed(1)}×${t.usedOffcut.h.toFixed(1)}` : null
  }));

console.log(`\n=== Cut Tile Details (showing first 15) ===`);
cutTileDetails.slice(0, 15).forEach(t => {
  console.log(`  Tile ${t.idx}: ${t.needW}×${t.needH}cm, source=${t.source}, reused=${t.reused}${t.usedOffcut ? `, from offcut ${t.usedOffcut}` : ''}`);
});

console.log('\n=== Comparison: No Offset vs With Offset ===');

const stateNoOffset = JSON.parse(JSON.stringify(state));
stateNoOffset.floors[0].rooms[0].pattern.offsetXcm = 0;
stateNoOffset.floors[0].rooms[0].pattern.offsetYcm = 0;

const resultNoOffset = computePlanMetrics(stateNoOffset);
console.log('Without offsets:');
console.log(`  Full tiles: ${resultNoOffset.data.tiles.fullTiles}, Cut tiles: ${resultNoOffset.data.tiles.cutTiles}`);
console.log(`  Purchased: ${resultNoOffset.data.tiles.purchasedTiles}, Waste: ${resultNoOffset.data.material.wastePct.toFixed(2)}%`);

console.log('\nWith offsets (20cm, 10cm):');
console.log(`  Full tiles: ${result.data.tiles.fullTiles}, Cut tiles: ${result.data.tiles.cutTiles}`);
console.log(`  Purchased: ${result.data.tiles.purchasedTiles}, Waste: ${result.data.material.wastePct.toFixed(2)}%`);

console.log('\n=== Summary ===');
console.log('Offsets create edge cuts that cannot be perfectly paired because:');
console.log('1. Edge pieces have irregular dimensions (20cm, 10cm, 30cm, 40cm)');
console.log('2. These dimensions do not combine to form full 50×50cm tiles');
console.log('3. Some offcuts are too small to be useful for other cuts');
console.log('4. The pairing algorithm works best with complementary pieces (like 45° diagonals)');
console.log('   where two identical cuts = one full tile');
