import { tilesForPreview, computeAvailableArea } from './src/geometry.js';

const tw = 40;
const th = 20;
const grout = 0.5;

const baseState = {
  project: { name: "Visual Test" },
  floors: [{
    id: "floor-1",
    name: "Test Floor",
    rooms: [{
      id: "room-1",
      name: "Pattern Test",
      widthCm: 200,
      heightCm: 100,
      exclusions: [],
      tile: { widthCm: tw, heightCm: th, shape: "rect" },
      grout: { widthCm: grout },
      pattern: {
        type: "grid",
        rotationDeg: 0,
        offsetXcm: 0,
        offsetYcm: 0,
        origin: { preset: "tl", xCm: 0, yCm: 0 }
      },
      sections: [{
        id: "main",
        label: "Main Area",
        x: 0,
        y: 0,
        widthCm: 200,
        heightCm: 100
      }]
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
  const room = state.floors[0].rooms[0];
  room.pattern.type = patternType;

  console.log(`\n=== ${patternType.toUpperCase()} ===`);

  const avail = computeAvailableArea(room, room.exclusions);
  if (!avail.mp) {
    console.log('Error: No available area');
    return;
  }

  const result = tilesForPreview(state, avail.mp);

  if (result.error) {
    console.log(`Error: ${result.error}`);
    return;
  }

  console.log(`✓ Generated ${result.tiles.length} tiles`);
  console.log(`  Full tiles: ${result.tiles.filter(t => t.isFull).length}`);
  console.log(`  Cut tiles: ${result.tiles.filter(t => !t.isFull).length}`);
}

console.log('Testing pattern generation...');
testPattern('herringbone');
testPattern('basketweave');
console.log('\n✓ All patterns generated successfully');
