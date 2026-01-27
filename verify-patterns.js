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
testPattern('doubleHerringbone');
testPattern('basketweave');
testPattern('verticalStackAlternating');

console.log('\n=== HERRINGBONE REPORTED STATE ===');
const reportedState = JSON.parse(JSON.stringify(baseState));
reportedState.floors[0].rooms[0].widthCm = 100;
reportedState.floors[0].rooms[0].heightCm = 200;
reportedState.floors[0].rooms[0].tile.widthCm = 10;
reportedState.floors[0].rooms[0].tile.heightCm = 20;
reportedState.floors[0].rooms[0].grout.widthCm = 0.2;
reportedState.floors[0].rooms[0].pattern.type = 'herringbone';
const reportedAvail = computeAvailableArea(
  reportedState.floors[0].rooms[0],
  reportedState.floors[0].rooms[0].exclusions
);
if (!reportedAvail.mp) {
  console.log('Error: No available area');
} else {
  const reportedResult = tilesForPreview(reportedState, reportedAvail.mp);
  if (reportedResult.error) {
    console.log(`Error: ${reportedResult.error}`);
  } else {
    console.log(`✓ Generated ${reportedResult.tiles.length} tiles (reported state)`);
  }
}
console.log('\n✓ All patterns generated successfully');
