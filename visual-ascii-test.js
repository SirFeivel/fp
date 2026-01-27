import polygonClipping from 'polygon-clipping';
import { tilesForPreview, multiPolyArea } from './src/geometry.js';

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
  const overlapArea = totalOverlapArea(herringboneResult.tiles);
  console.log(`Overlap area: ${overlapArea.toFixed(6)} cm²`);
}

console.log('\n=== DOUBLE HERRINGBONE PATTERN ===');
const doubleHerringboneResult = tilesForPreview(createState('doubleHerringbone'), availableMP);
if (doubleHerringboneResult.error) {
  console.error('Error:', doubleHerringboneResult.error);
} else {
  console.log(renderAscii(doubleHerringboneResult.tiles, 200, 200));
  console.log(`\nTiles: ${doubleHerringboneResult.tiles.length} (Full: ${doubleHerringboneResult.tiles.filter(t => t.isFull).length}, Cut: ${doubleHerringboneResult.tiles.filter(t => !t.isFull).length})`);
  const overlapArea = totalOverlapArea(doubleHerringboneResult.tiles);
  console.log(`Overlap area: ${overlapArea.toFixed(6)} cm²`);
}

console.log('\n=== HERRINGBONE REPORTED STATE (100x200, 10x20, grout 0.2) ===');
const reportedState = {
  floors: [{
    id: 'floor-1',
    rooms: [{
      id: 'room-1',
      widthCm: 100,
      heightCm: 200,
      exclusions: [],
      tile: { widthCm: 10, heightCm: 20, shape: 'rect' },
      grout: { widthCm: 0.2 },
      pattern: {
        type: 'herringbone',
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
const reportedMP = [[
  [[0, 0], [100, 0], [100, 200], [0, 200], [0, 0]]
]];
const reportedResult = tilesForPreview(reportedState, reportedMP);
if (reportedResult.error) {
  console.error('Reported state error:', reportedResult.error);
} else {
  console.log(renderAscii(reportedResult.tiles, 100, 200));
  console.log(`\nTiles: ${reportedResult.tiles.length} (Full: ${reportedResult.tiles.filter(t => t.isFull).length}, Cut: ${reportedResult.tiles.filter(t => !t.isFull).length})`);
  const overlapArea = totalOverlapArea(reportedResult.tiles);
  console.log(`Overlap area: ${overlapArea.toFixed(6)} cm²`);
}

console.log('\n=== BASKETWEAVE PATTERN ===');
const basketweaveResult = tilesForPreview(createState('basketweave'), availableMP);
if (basketweaveResult.error) {
  console.error('Error:', basketweaveResult.error);
} else {
  console.log(renderAscii(basketweaveResult.tiles, 200, 200));
  console.log(`\nTiles: ${basketweaveResult.tiles.length} (Full: ${basketweaveResult.tiles.filter(t => t.isFull).length}, Cut: ${basketweaveResult.tiles.filter(t => !t.isFull).length})`);
}

console.log('\n=== VERTICAL STACK ALTERNATING PATTERN ===');
const verticalStackAltResult = tilesForPreview(createState('verticalStackAlternating'), availableMP);
if (verticalStackAltResult.error) {
  console.error('Error:', verticalStackAltResult.error);
} else {
  console.log(renderAscii(verticalStackAltResult.tiles, 200, 200));
  console.log(`\nTiles: ${verticalStackAltResult.tiles.length} (Full: ${verticalStackAltResult.tiles.filter(t => t.isFull).length}, Cut: ${verticalStackAltResult.tiles.filter(t => !t.isFull).length})`);
}

function pathDToPolygon(d) {
  const commands = d.match(/[MLZ][^MLZ]*/g) || [];
  const points = [];

  commands.forEach(cmd => {
    const letter = cmd[0];
    const coords = cmd.slice(1).trim().split(/[\s,]+/).map(Number);

    if (letter === 'M' || letter === 'L') {
      for (let i = 0; i < coords.length; i += 2) {
        if (!isNaN(coords[i]) && !isNaN(coords[i + 1])) {
          points.push([coords[i], coords[i + 1]]);
        }
      }
    }
  });

  if (points.length < 3) return null;
  const first = points[0];
  const last = points[points.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    points.push([first[0], first[1]]);
  }
  return [[points]];
}

function totalOverlapArea(tiles) {
  const polys = tiles.map((t) => pathDToPolygon(t.d)).filter(Boolean);

  let overlap = 0;
  for (let i = 0; i < polys.length; i++) {
    for (let j = i + 1; j < polys.length; j++) {
      const inter = polygonClipping.intersection(polys[i], polys[j]);
      if (inter && inter.length) {
        overlap += multiPolyArea(inter);
      }
    }
  }
  return overlap;
}
