import { getCurrentRoom } from './src/core.js';
import { computeAvailableArea, tilesForPreview, multiPolyArea } from './src/geometry.js';

function parsePathDToPolygon(d) {
  const commands = d.trim().split(/(?=[MLZ])/);
  const points = [];

  for (const cmd of commands) {
    if (!cmd.trim()) continue;
    const type = cmd[0];
    const nums = cmd
      .slice(1)
      .trim()
      .split(/[\s,]+/)
      .map((x) => Number(x))
      .filter((x) => Number.isFinite(x));

    if ((type === 'M' || type === 'L') && nums.length >= 2) {
      points.push([nums[0], nums[1]]);
    }
  }

  if (points.length < 3) return null;

  const first = points[0];
  const last = points[points.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    points.push([first[0], first[1]]);
  }

  return [[points]];
}

function bboxFromPathD(d) {
  const nums = d
    .trim()
    .split(/[\s,]+/)
    .map((x) => Number(x))
    .filter((x) => Number.isFinite(x));

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  for (let i = 0; i + 1 < nums.length; i += 2) {
    const x = nums[i];
    const y = nums[i + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function analyzeCutTile(tile, tileAreaCm2) {
  const bb = bboxFromPathD(tile.d);
  if (!bb || !(bb.w > 0 && bb.h > 0)) {
    return null;
  }

  const polygon = parsePathDToPolygon(tile.d);
  const bboxArea = bb.w * bb.h;
  const actualArea = polygon ? multiPolyArea(polygon) : bboxArea;
  const areaRatio = bboxArea > 0 ? actualArea / bboxArea : 1;
  const isTriangularCut = areaRatio >= 0.45 && areaRatio <= 0.6;

  return {
    bb,
    bboxArea,
    actualArea,
    areaRatio,
    isTriangularCut,
    polygon,
  };
}

function findComplementaryPairs(tiles, analyses, tw, th) {
  const pairs = new Map();
  const tileAreaCm2 = tw * th;
  const dimensionTol = 0.1;

  const unpairedIndices = [];
  for (let i = 0; i < tiles.length; i++) {
    if (!tiles[i].isFull && analyses[i]) {
      unpairedIndices.push(i);
    }
  }

  for (let i = 0; i < unpairedIndices.length; i++) {
    const idx1 = unpairedIndices[i];
    if (pairs.has(idx1)) continue;

    const a1 = analyses[idx1];
    if (!a1) continue;

    for (let j = i + 1; j < unpairedIndices.length; j++) {
      const idx2 = unpairedIndices[j];
      if (pairs.has(idx2)) continue;

      const a2 = analyses[idx2];
      if (!a2) continue;

      const dimMatch =
        Math.abs(a1.bb.w - a2.bb.w) < dimensionTol &&
        Math.abs(a1.bb.h - a2.bb.h) < dimensionTol;

      if (!dimMatch) continue;

      const combinedArea = a1.actualArea + a2.actualArea;
      const fitsInOneTile = combinedArea >= tileAreaCm2 * 0.95 && combinedArea <= tileAreaCm2 * 1.05;

      if (fitsInOneTile) {
        pairs.set(idx1, idx2);
        pairs.set(idx2, idx1);
        console.log(`  Pair: tile ${idx1} ↔ tile ${idx2} (combined: ${combinedArea.toFixed(1)} / ${tileAreaCm2} cm²)`);
        break;
      }
    }
  }

  return pairs;
}

function optimizeTileProcessingOrder(tiles, analyses, pairs) {
  const indices = [];
  const processed = new Set();

  for (let i = 0; i < tiles.length; i++) {
    if (processed.has(i)) continue;

    const pairedWith = pairs.get(i);
    if (pairedWith !== undefined && !processed.has(pairedWith)) {
      indices.push(i);
      indices.push(pairedWith);
      processed.add(i);
      processed.add(pairedWith);
    } else {
      indices.push(i);
      processed.add(i);
    }
  }

  return indices;
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

console.log('\n=== DETAILED PAIRING ANALYSIS ===\n');

const tileAreaCm2 = 50 * 50;
const analyses = new Array(t.tiles.length).fill(null);
for (let i = 0; i < t.tiles.length; i++) {
  const tile = t.tiles[i];
  if (!tile.isFull) {
    analyses[i] = analyzeCutTile(tile, tileAreaCm2);
  }
}

console.log('Finding pairs...');
const pairs = findComplementaryPairs(t.tiles, analyses, 50, 50);

console.log(`\nOptimizing processing order...`);
const processOrder = optimizeTileProcessingOrder(t.tiles, analyses, pairs);

console.log(`\nProcessing order (first 20):`, processOrder.slice(0, 20));
console.log(`\nChecking which pairs are processed consecutively:`);

for (let idx = 0; idx < Math.min(20, processOrder.length); idx++) {
  const i = processOrder[idx];
  const pairedWith = pairs.get(i);
  if (pairedWith !== undefined) {
    const nextIdx = processOrder[idx + 1];
    const consecutive = nextIdx === pairedWith;
    console.log(`  [${idx}] Tile ${i} paired with ${pairedWith} - consecutive: ${consecutive}`);
  }
}
