import { tilesForPreview } from './src/geometry.js';

const tw = 40;
const th = 15;
const grout = 1;

const availableMP = [[
  [[0, 0], [200, 0], [200, 200], [0, 200], [0, 0]]
]];

function createState(patternType) {
  return {
    floors: [{
      id: 'floor-1',
      rooms: [{
        id: 'room-1',
        walls: [
          { x1: 0, y1: 0, x2: 200, y2: 0 },
          { x1: 200, y1: 0, x2: 200, y2: 200 },
          { x1: 200, y1: 200, x2: 0, y2: 200 },
          { x1: 0, y1: 200, x2: 0, y2: 0 }
        ],
        exclusions: [],
        tile: {
          widthCm: tw,
          heightCm: th,
          shape: 'rect'
        },
        grout: {
          widthCm: grout
        },
        pattern: {
          type: patternType,
          rotationDeg: 0,
          offsetXcm: 0,
          offsetYcm: 0,
          origin: { preset: 'tl' }
        }
      }]
    }],
    selectedFloorId: 'floor-1',
    selectedRoomId: 'room-1'
  };
}

function parsePath(d) {
  const commands = d.match(/[MLZ][^MLZ]*/g) || [];
  const points = [];

  commands.forEach(cmd => {
    const letter = cmd[0];
    const coords = cmd.slice(1).trim().split(/[\s,]+/).map(Number);

    if (letter === 'M' || letter === 'L') {
      for (let i = 0; i < coords.length; i += 2) {
        if (!isNaN(coords[i]) && !isNaN(coords[i + 1])) {
          points.push({ x: coords[i], y: coords[i + 1] });
        }
      }
    }
  });

  return points;
}

function getBounds(points) {
  if (!points.length) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  let minX = points[0].x, maxX = points[0].x;
  let minY = points[0].y, maxY = points[0].y;

  points.forEach(p => {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  });

  return { minX, minY, maxX, maxY };
}

function renderAscii(tiles, width, height) {
  const scale = 2;
  const gridW = Math.floor(width / scale);
  const gridH = Math.floor(height / scale);

  const grid = Array.from({ length: gridH }, () => Array(gridW).fill(' '));

  tiles.forEach((tile, idx) => {
    const points = parsePath(tile.d);
    if (!points.length) return;

    const bounds = getBounds(points);
    const char = tile.isFull ? '█' : '▒';

    for (let y = Math.floor(bounds.minY / scale); y <= Math.ceil(bounds.maxY / scale); y++) {
      for (let x = Math.floor(bounds.minX / scale); x <= Math.ceil(bounds.maxX / scale); x++) {
        if (y >= 0 && y < gridH && x >= 0 && x < gridW) {
          const px = x * scale;
          const py = y * scale;

          if (px >= bounds.minX - scale && px <= bounds.maxX + scale &&
              py >= bounds.minY - scale && py <= bounds.maxY + scale) {
            grid[y][x] = char;
          }
        }
      }
    }
  });

  return grid.map(row => row.join('')).join('\n');
}

console.log('\n=== GRID PATTERN ===');
const gridResult = tilesForPreview(createState('grid'), availableMP);
if (gridResult.error) {
  console.error('Error:', gridResult.error);
} else {
  console.log(renderAscii(gridResult.tiles, 200, 200));
  console.log(`\nTiles: ${gridResult.tiles.length} (Full: ${gridResult.tiles.filter(t => t.isFull).length}, Cut: ${gridResult.tiles.filter(t => !t.isFull).length})`);
}

console.log('\n=== RUNNING BOND PATTERN ===');
const runningbondResult = tilesForPreview(createState('runningbond'), availableMP);
if (runningbondResult.error) {
  console.error('Error:', runningbondResult.error);
} else {
  console.log(renderAscii(runningbondResult.tiles, 200, 200));
  console.log(`\nTiles: ${runningbondResult.tiles.length} (Full: ${runningbondResult.tiles.filter(t => t.isFull).length}, Cut: ${runningbondResult.tiles.filter(t => !t.isFull).length})`);
}

console.log('\n=== HERRINGBONE PATTERN ===');
const herringboneResult = tilesForPreview(createState('herringbone'), availableMP);
if (herringboneResult.error) {
  console.error('Error:', herringboneResult.error);
} else {
  console.log(renderAscii(herringboneResult.tiles, 200, 200));
  console.log(`\nTiles: ${herringboneResult.tiles.length} (Full: ${herringboneResult.tiles.filter(t => t.isFull).length}, Cut: ${herringboneResult.tiles.filter(t => !t.isFull).length})`);
}

console.log('\n=== BASKETWEAVE PATTERN ===');
const basketweaveResult = tilesForPreview(createState('basketweave'), availableMP);
if (basketweaveResult.error) {
  console.error('Error:', basketweaveResult.error);
} else {
  console.log(renderAscii(basketweaveResult.tiles, 200, 200));
  console.log(`\nTiles: ${basketweaveResult.tiles.length} (Full: ${basketweaveResult.tiles.filter(t => t.isFull).length}, Cut: ${basketweaveResult.tiles.filter(t => !t.isFull).length})`);
}
