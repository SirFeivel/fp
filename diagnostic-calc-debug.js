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

const result = computePlanMetrics(state);

console.log('\n=== CALCULATION DEBUG ===\n');
console.log(`Full tiles: ${result.data.tiles.fullTiles}`);
console.log(`Cut tiles: ${result.data.tiles.cutTiles}`);
console.log(`Reused cuts: ${result.data.tiles.reusedCuts}`);
console.log(`Purchased tiles: ${result.data.tiles.purchasedTiles}`);

const tileUsage = result.data.debug.tileUsage;

console.log(`\n=== TILE USAGE BREAKDOWN ===`);
const pairedReuses = tileUsage.filter(t => t.source === 'paired_offcut');
const poolReuses = tileUsage.filter(t => t.source === 'offcut');
const newTiles = tileUsage.filter(t => t.source === 'new' && !t.isFull);
const degenerateTiles = tileUsage.filter(t => t.source === 'degenerate');

console.log(`Paired offcut reuses: ${pairedReuses.length}`);
console.log(`Pool offcut reuses: ${poolReuses.length}`);
console.log(`New cut tiles: ${newTiles.length}`);
console.log(`Degenerate tiles (zero area): ${degenerateTiles.length}`);

console.log(`\n=== PAIRED OFFCUT DETAILS ===`);
pairedReuses.forEach((t, idx) => {
  console.log(`  ${idx}: ${t.usedOffcut?.id || 'no-id'}`);
});

console.log(`\n=== TILES WITH PAIRED OFFCUTS CREATED ===`);
const tilesWithPairedOffcuts = tileUsage.filter(
  t => t.createdOffcuts && t.createdOffcuts.some(o => o.id && o.id.startsWith('pair-'))
);
console.log(`Count: ${tilesWithPairedOffcuts.length}`);
tilesWithPairedOffcuts.slice(0, 10).forEach((t, idx) => {
  const pairOffcut = t.createdOffcuts.find(o => o.id && o.id.startsWith('pair-'));
  console.log(`  ${idx}: offcut ${pairOffcut?.id}, reused=${t.reused}`);
});
