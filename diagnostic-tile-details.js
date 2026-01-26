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

console.log('\n=== RAW TILE DATA ===\n');
console.log(`Total tiles from tilesForPreview: ${t.tiles.length}`);

const fullCount = t.tiles.filter(tile => tile.isFull).length;
const cutCount = t.tiles.filter(tile => !tile.isFull).length;

console.log(`Full tiles: ${fullCount}`);
console.log(`Cut tiles: ${cutCount}\n`);

console.log('First 10 cut tiles:');
let shown = 0;
for (let i = 0; i < t.tiles.length && shown < 10; i++) {
  const tile = t.tiles[i];
  if (!tile.isFull) {
    console.log(`  Tile ${i}: isFull=${tile.isFull}, d length=${tile.d.length}`);
    shown++;
  }
}
