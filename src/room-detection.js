// src/room-detection.js
// Image-processing functions for semi-automatic room detection.
// Depends on floor-plan-rules.js for wall thickness bounds.

import { FLOOR_PLAN_RULES } from './floor-plan-rules.js';

/**
 * Converts RGBA imageData to a binary mask.
 * Grayscale = 0.299r + 0.587g + 0.114b. Pixel is wall (1) if grayscale < threshold.
 *
 * @param {ImageData} imageData - Browser ImageData or compatible object with {data, width, height}
 * @param {number} threshold - Grayscale threshold [0..255]; below → wall (1)
 * @returns {Uint8Array} 1D mask, length = width*height; 1=wall, 0=open
 */
export function imageToBinaryMask(imageData, threshold) {
  const { data, width, height } = imageData;
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    mask[i] = gray < threshold ? 1 : 0;
  }
  return mask;
}

// ---------------------------------------------------------------------------
// Internal: 1D sliding-window max (any=1 wins)
// ---------------------------------------------------------------------------
function boxFilterMax1D(input, n, radius) {
  const out = new Uint8Array(n);
  // Initialize window for x=0: pixels [0..min(radius,n-1)]
  let sum = 0;
  const initEnd = Math.min(radius, n - 1);
  for (let k = 0; k <= initEnd; k++) sum += input[k];

  for (let x = 0; x < n; x++) {
    out[x] = sum > 0 ? 1 : 0;
    // Slide: remove pixel leaving left edge, add pixel entering right edge
    const removeIdx = x - radius;
    if (removeIdx >= 0) sum -= input[removeIdx];
    const addIdx = x + radius + 1;
    if (addIdx < n) sum += input[addIdx];
  }
  return out;
}

// 2D separable dilation (max filter): horizontal then vertical pass.
function dilate2D(mask, w, h, radius) {
  const temp = new Uint8Array(w * h);
  // Horizontal pass
  const rowBuf = new Uint8Array(w);
  for (let y = 0; y < h; y++) {
    const off = y * w;
    for (let x = 0; x < w; x++) rowBuf[x] = mask[off + x];
    const result = boxFilterMax1D(rowBuf, w, radius);
    temp.set(result, off);
  }
  // Vertical pass
  const out = new Uint8Array(w * h);
  const colBuf = new Uint8Array(h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) colBuf[y] = temp[y * w + x];
    const result = boxFilterMax1D(colBuf, h, radius);
    for (let y = 0; y < h; y++) out[y * w + x] = result[y];
  }
  return out;
}

// 2D separable dilation with separate horizontal and vertical radii.
function dilate2DRect(mask, w, h, radiusH, radiusV) {
  const temp = new Uint8Array(w * h);
  const rowBuf = new Uint8Array(w);
  for (let y = 0; y < h; y++) {
    const off = y * w;
    for (let x = 0; x < w; x++) rowBuf[x] = mask[off + x];
    temp.set(boxFilterMax1D(rowBuf, w, radiusH), off);
  }
  const out = new Uint8Array(w * h);
  const colBuf = new Uint8Array(h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) colBuf[y] = temp[y * w + x];
    const result = boxFilterMax1D(colBuf, h, radiusV);
    for (let y = 0; y < h; y++) out[y * w + x] = result[y];
  }
  return out;
}

// Morphological open with a rectangular kernel (separate H/V radii).
function morphologicalOpenRect(mask, w, h, radiusH, radiusV) {
  const eroded = negateMask(dilate2DRect(negateMask(mask), w, h, radiusH, radiusV));
  return dilate2DRect(eroded, w, h, radiusH, radiusV);
}

// Negate binary mask (0↔1).
function negateMask(mask) {
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) out[i] = 1 - mask[i];
  return out;
}

/**
 * Morphological open (erode then dilate) using a separable 1D box filter.
 * Removes small isolated wall features (noise) while preserving thick walls.
 * Used before close to prevent anti-aliasing pixels inside the room from
 * expanding into the room interior during the close step.
 *
 * @param {Uint8Array} mask - Binary mask (1=wall, 0=open)
 * @param {number} w - Image width
 * @param {number} h - Image height
 * @param {number} radius - Half-width of box kernel in pixels
 * @returns {Uint8Array} Opened mask
 */
function morphologicalOpen(mask, w, h, radius) {
  // Erosion = NOT(dilate(NOT(input)))
  const eroded = negateMask(dilate2D(negateMask(mask), w, h, radius));
  return dilate2D(eroded, w, h, radius);
}

/**
 * Morphological close (dilate then erode) using a separable 1D box filter.
 * O(w×h) per pass, 4 passes total (2 for dilation, 2 for erosion).
 * Seals narrow gaps in wall regions (1s) so flood fill stays inside the room.
 *
 * @param {Uint8Array} mask - Binary mask (1=wall, 0=open)
 * @param {number} w - Image width
 * @param {number} h - Image height
 * @param {number} radius - Half-width of box kernel in pixels
 * @returns {Uint8Array} Closed mask
 */
export function morphologicalClose(mask, w, h, radius) {
  const dilated = dilate2D(mask, w, h, radius);
  // Erosion = NOT(dilate(NOT(input)))
  const eroded = negateMask(dilate2D(negateMask(dilated), w, h, radius));
  return eroded;
}

/**
 * Connected-component labeling to remove small wall features (text, arrows,
 * dimension numbers) while preserving actual walls.
 *
 * @param {Uint8Array} mask - Binary mask (1=wall, 0=open)
 * @param {number} w - Image width
 * @param {number} h - Image height
 * @param {number} minArea - Minimum area (px²) to keep a component
 * @returns {Uint8Array} Filtered mask with small components zeroed out
 */
export function filterSmallComponents(mask, w, h, minArea) {
  const labels = new Int32Array(w * h); // 0 = unlabeled
  const areas = [0]; // areas[label] = pixel count; label 0 unused
  let nextLabel = 1;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (mask[i] !== 1 || labels[i] !== 0) continue;

      // BFS flood this component (4-connected)
      const label = nextLabel++;
      areas.push(0);
      const queue = [x, y];
      let head = 0;
      labels[i] = label;
      let area = 0;

      while (head < queue.length) {
        const cx = queue[head++];
        const cy = queue[head++];
        area++;

        const neighbors = [cx - 1, cy, cx + 1, cy, cx, cy - 1, cx, cy + 1];
        for (let k = 0; k < 8; k += 2) {
          const nx = neighbors[k], ny = neighbors[k + 1];
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          const ni = ny * w + nx;
          if (mask[ni] !== 1 || labels[ni] !== 0) continue;
          labels[ni] = label;
          queue.push(nx, ny);
        }
      }
      areas[label] = area;
    }
  }

  // Zero out small components
  const out = new Uint8Array(mask);
  for (let i = 0; i < w * h; i++) {
    if (labels[i] > 0 && areas[labels[i]] < minArea) {
      out[i] = 0;
    }
  }
  return out;
}

/**
 * BFS flood fill from seed, filling only open (0) pixels in the mask.
 * Aborts early if pixelCount exceeds maxPixels.
 *
 * @param {Uint8Array} mask - Binary mask (1=wall, 0=open); not modified
 * @param {number} w - Image width
 * @param {number} h - Image height
 * @param {number} seedX - Seed X coordinate
 * @param {number} seedY - Seed Y coordinate
 * @param {number} maxPixels - Abort threshold to detect leaking fills
 * @returns {{ filledMask: Uint8Array, pixelCount: number }}
 */
export function floodFill(mask, w, h, seedX, seedY, maxPixels) {
  const filledMask = new Uint8Array(w * h);
  const seedIdx = seedY * w + seedX;

  if (seedX < 0 || seedX >= w || seedY < 0 || seedY >= h) {
    return { filledMask, pixelCount: 0 };
  }
  if (mask[seedIdx] !== 0) {
    return { filledMask, pixelCount: 0 };
  }

  // Use a flat typed array as an efficient FIFO queue (interleaved x,y)
  const queueSize = (w * h + 1) * 2;
  const queue = new Int32Array(Math.min(queueSize, 2 * maxPixels + 4));
  let head = 0, tail = 0;

  function enqueue(x, y) {
    queue[tail++] = x;
    queue[tail++] = y;
  }

  filledMask[seedIdx] = 1;
  enqueue(seedX, seedY);
  let pixelCount = 1;

  while (head < tail) {
    const x = queue[head++];
    const y = queue[head++];

    // 4-connected neighbors
    const neighbors = [x - 1, y, x + 1, y, x, y - 1, x, y + 1];
    for (let k = 0; k < neighbors.length; k += 2) {
      const nx = neighbors[k];
      const ny = neighbors[k + 1];
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const ni = ny * w + nx;
      if (mask[ni] !== 0 || filledMask[ni] !== 0) continue;
      filledMask[ni] = 1;
      pixelCount++;
      if (pixelCount > maxPixels) return { filledMask, pixelCount };
      if (tail + 2 <= queue.length) {
        enqueue(nx, ny);
      }
    }
  }

  return { filledMask, pixelCount };
}

/**
 * Fill interior holes in a flood-filled room mask.
 * Any unfilled (0) pixel that is NOT reachable from the image border is an
 * interior hole (e.g. text label inside the room) → set to 1.
 *
 * @param {Uint8Array} filledMask - Binary mask (1=room, 0=background); modified in place
 * @param {number} w - Image width
 * @param {number} h - Image height
 */
export function fillInteriorHoles(filledMask, w, h) {
  // BFS from all border pixels that are 0 (background reachable from border)
  const borderReachable = new Uint8Array(w * h);
  const queue = [];
  let head = 0;

  function seed(x, y) {
    const i = y * w + x;
    if (filledMask[i] === 0 && borderReachable[i] === 0) {
      borderReachable[i] = 1;
      queue.push(x, y);
    }
  }

  // Seed all 4 border rows/columns
  for (let x = 0; x < w; x++) { seed(x, 0); seed(x, h - 1); }
  for (let y = 1; y < h - 1; y++) { seed(0, y); seed(w - 1, y); }

  while (head < queue.length) {
    const cx = queue[head++];
    const cy = queue[head++];
    const neighbors = [cx - 1, cy, cx + 1, cy, cx, cy - 1, cx, cy + 1];
    for (let k = 0; k < 8; k += 2) {
      const nx = neighbors[k], ny = neighbors[k + 1];
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const ni = ny * w + nx;
      if (filledMask[ni] === 0 && borderReachable[ni] === 0) {
        borderReachable[ni] = 1;
        queue.push(nx, ny);
      }
    }
  }

  // Any 0-pixel NOT reached from border is an interior hole → fill it
  for (let i = 0; i < w * h; i++) {
    if (filledMask[i] === 0 && borderReachable[i] === 0) {
      filledMask[i] = 1;
    }
  }
}

/**
 * Flood fill from all image border pixels through open (mask=0) pixels.
 * Returns a Uint8Array where 1 = reachable from the border (exterior),
 * 0 = not reachable (building interior or wall).
 *
 * Used for envelope detection: everything NOT reachable from the border
 * is inside the building.
 *
 * @param {Uint8Array} mask - Binary mask (1=wall, 0=open)
 * @param {number} w - Image width
 * @param {number} h - Image height
 * @returns {Uint8Array} Exterior mask (1=exterior, 0=building/wall)
 */
export function floodFillFromBorder(mask, w, h) {
  const exterior = new Uint8Array(w * h);
  const queue = [];
  let head = 0;

  function seed(x, y) {
    const i = y * w + x;
    if (mask[i] === 0 && exterior[i] === 0) {
      exterior[i] = 1;
      queue.push(x, y);
    }
  }

  // Seed all 4 border rows/columns
  for (let x = 0; x < w; x++) { seed(x, 0); seed(x, h - 1); }
  for (let y = 1; y < h - 1; y++) { seed(0, y); seed(w - 1, y); }

  while (head < queue.length) {
    const cx = queue[head++];
    const cy = queue[head++];
    const neighbors = [cx - 1, cy, cx + 1, cy, cx, cy - 1, cx, cy + 1];
    for (let k = 0; k < 8; k += 2) {
      const nx = neighbors[k], ny = neighbors[k + 1];
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const ni = ny * w + nx;
      if (mask[ni] === 0 && exterior[ni] === 0) {
        exterior[ni] = 1;
        queue.push(nx, ny);
      }
    }
  }

  return exterior;
}

/**
 * Moore neighbor contour tracing with Jacob's stopping criterion.
 * Traces the outer boundary of the filled region in filledMask.
 *
 * @param {Uint8Array} filledMask - Binary mask (1=filled region, 0=background)
 * @param {number} w - Image width
 * @param {number} h - Image height
 * @returns {Array<{x: number, y: number}>} Boundary pixels in order
 */
export function traceContour(filledMask, w, h) {
  // Moore-8 neighborhood: clockwise starting from east
  const MOORE = [[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]];

  // Find first foreground pixel (top-left scan)
  let startX = -1, startY = -1;
  outer: for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (filledMask[y * w + x]) { startX = x; startY = y; break outer; }
    }
  }
  if (startX < 0) return [];

  // Initial backtrack pixel: the background pixel we "came from" to reach start.
  // Since we scan left→right, enter start from the left (or above if at left edge).
  const startBx = startX > 0 ? startX - 1 : startX;
  const startBy = startX > 0 ? startY : startY - 1;

  const contour = [];
  let px = startX, py = startY;
  let bx = startBx, by = startBy;
  let started = false;
  const MAX_ITER = w * h + 4;

  for (let iter = 0; iter < MAX_ITER; iter++) {
    // Jacob's stopping criterion: returned to start with same backtrack configuration
    if (started && px === startX && py === startY && bx === startBx && by === startBy) break;
    started = true;

    contour.push({ x: px, y: py });

    // Direction from p to backtrack b (clamped unit vector)
    const dx = bx - px, dy = by - py;
    const cdx = dx === 0 ? 0 : Math.sign(dx);
    const cdy = dy === 0 ? 0 : Math.sign(dy);

    let startDirIdx = 4; // Default: look left
    for (let i = 0; i < 8; i++) {
      if (MOORE[i][0] === cdx && MOORE[i][1] === cdy) { startDirIdx = i; break; }
    }

    // Search clockwise from b-direction for next filled pixel
    let nextPx = -1, nextPy = -1;
    let newBx = bx, newBy = by;

    for (let k = 0; k < 8; k++) {
      const di = (startDirIdx + k) % 8;
      const nx = px + MOORE[di][0];
      const ny = py + MOORE[di][1];

      if (nx >= 0 && nx < w && ny >= 0 && ny < h && filledMask[ny * w + nx]) {
        nextPx = nx; nextPy = ny;
        break;
      }
      // Track last background pixel seen (for next iteration's backtrack)
      if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
        newBx = nx; newBy = ny;
      }
    }

    if (nextPx < 0) break; // Isolated pixel or error

    bx = newBx; by = newBy;
    px = nextPx; py = nextPy;
  }

  return contour;
}

/**
 * Ramer–Douglas–Peucker polyline simplification.
 *
 * @param {Array<{x: number, y: number}>} points - Input polyline
 * @param {number} epsilon - Maximum allowed perpendicular distance
 * @returns {Array<{x: number, y: number}>} Simplified polyline
 */
export function douglasPeucker(points, epsilon) {
  if (points.length <= 2) return points.slice();

  const first = points[0];
  const last = points[points.length - 1];
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const lineLen = Math.hypot(dx, dy);

  // Find point with maximum perpendicular distance
  let maxDist = 0;
  let maxIdx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    let dist;
    if (lineLen === 0) {
      dist = Math.hypot(points[i].x - first.x, points[i].y - first.y);
    } else {
      // Perpendicular distance from point to line (first→last)
      dist = Math.abs(dy * points[i].x - dx * points[i].y + last.x * first.y - last.y * first.x) / lineLen;
    }
    if (dist > maxDist) { maxDist = dist; maxIdx = i; }
  }

  if (maxDist > epsilon) {
    const left = douglasPeucker(points.slice(0, maxIdx + 1), epsilon);
    const right = douglasPeucker(points.slice(maxIdx), epsilon);
    // Combine: left's last point == right's first point, avoid duplicating it
    return [...left.slice(0, -1), ...right];
  }

  return [first, last];
}

// Standard edge directions in radians: 0°, 45°, 90°, 135°, 180°, 225°, 270°, 315°
const STANDARD_ANGLES_RAD = Array.from({ length: 8 }, (_, i) => i * Math.PI / 4);

/**
 * Snap polygon edge directions to the nearest standard angle (multiples of 45°),
 * recompute vertex positions as intersections of adjacent snapped edge-lines,
 * and remove collinear vertices (where consecutive edges snap to the same direction).
 *
 * @param {Array<{x: number, y: number}>} vertices - Polygon vertices (closed: last→first is an edge)
 * @param {number} [toleranceDeg=5] - Maximum angular deviation (degrees) to snap
 * @returns {Array<{x: number, y: number}>} Snapped polygon vertices
 */
export function snapPolygonEdges(vertices, toleranceDeg = 5) {
  if (vertices.length < 3) return vertices.slice();

  const tolRad = toleranceDeg * Math.PI / 180;
  const n = vertices.length;

  // 1. Compute edge midpoints and snap directions
  const edges = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = vertices[j].x - vertices[i].x;
    const dy = vertices[j].y - vertices[i].y;
    const angle = Math.atan2(dy, dx); // [-π, π]

    // Find nearest standard angle
    let bestStd = angle;
    let bestDiff = Infinity;
    for (const std of STANDARD_ANGLES_RAD) {
      // Check both std and std - 2π to handle wrap-around
      for (const candidate of [std, std - 2 * Math.PI, std + 2 * Math.PI]) {
        const diff = Math.abs(angle - candidate);
        if (diff < bestDiff) { bestDiff = diff; bestStd = candidate; }
      }
    }

    const snapped = bestDiff <= tolRad ? bestStd : angle;
    const midX = (vertices[i].x + vertices[j].x) / 2;
    const midY = (vertices[i].y + vertices[j].y) / 2;

    edges.push({
      midX, midY,
      dirX: Math.cos(snapped),
      dirY: Math.sin(snapped),
      snappedAngle: snapped,
    });
  }

  // 2. Recompute each vertex as the intersection of adjacent edge-lines.
  // Vertex i = intersection of edge (i-1) and edge (i).
  const newVerts = [];
  for (let i = 0; i < n; i++) {
    const prev = edges[(i - 1 + n) % n];
    const curr = edges[i];
    const pt = lineLineIntersection(
      prev.midX, prev.midY, prev.dirX, prev.dirY,
      curr.midX, curr.midY, curr.dirX, curr.dirY
    );
    newVerts.push(pt || { x: vertices[i].x, y: vertices[i].y });
  }

  // 3. Remove collinear vertices (consecutive edges with same snapped direction).
  const result = [];
  for (let i = 0; i < newVerts.length; i++) {
    const prevEdge = edges[(i - 1 + newVerts.length) % newVerts.length];
    const currEdge = edges[i];
    // Same direction (mod π) → collinear → skip vertex
    const angleDiff = Math.abs(prevEdge.snappedAngle - currEdge.snappedAngle) % Math.PI;
    if (angleDiff > 0.01 && Math.abs(angleDiff - Math.PI) > 0.01) {
      result.push(newVerts[i]);
    }
  }

  return result.length >= 3 ? result : newVerts;
}

/**
 * Intersect two lines defined by (point, direction).
 * Returns null if lines are parallel.
 */
function lineLineIntersection(ax, ay, adx, ady, bx, by, bdx, bdy) {
  const denom = adx * bdy - ady * bdx;
  if (Math.abs(denom) < 1e-10) return null;
  const t = ((bx - ax) * bdy - (by - ay) * bdx) / denom;
  return { x: ax + adx * t, y: ay + ady * t };
}

/**
 * Detect door gaps by comparing original mask to morphologically-closed mask.
 * Door gap pixels: were open (0) in original but sealed (1) in closed mask,
 * and adjacent to the room fill.
 *
 * @param {Uint8Array} originalMask - Raw binary mask (1=wall, 0=open)
 * @param {Uint8Array} closedMask - Morphologically closed mask (1=wall, 0=open)
 * @param {Uint8Array} roomMask - Flood-fill result (1=room interior, 0=outside)
 * @param {number} w - Image width
 * @param {number} h - Image height
 * @returns {Array<{midpointPx: {x: number, y: number}}>}
 */
export function detectDoorGaps(originalMask, closedMask, roomMask, w, h) {
  // Gap pixel: was open (0) in original, sealed (1) in closed mask
  const gapMask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (originalMask[i] === 0 && closedMask[i] === 1) {
      gapMask[i] = 1;
    }
  }

  // BFS to find contiguous groups of gap pixels; return centroid of each group
  const visited = new Uint8Array(w * h);
  const doorGaps = [];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!gapMask[i] || visited[i]) continue;

      // BFS this contiguous gap run (8-connected)
      const run = [];
      const q = [x, y];
      visited[i] = 1;
      let head = 0;

      while (head < q.length) {
        const cx = q[head++];
        const cy = q[head++];
        run.push({ x: cx, y: cy });

        const DX = [-1, 1, 0, 0, -1, -1, 1, 1];
        const DY = [0, 0, -1, 1, -1, 1, -1, 1];
        for (let d = 0; d < 8; d++) {
          const nx = cx + DX[d], ny = cy + DY[d];
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          const ni = ny * w + nx;
          if (!gapMask[ni] || visited[ni]) continue;
          visited[ni] = 1;
          q.push(nx, ny);
        }
      }

      // Midpoint = centroid; spanPx = bounding box extents for gap-width estimation
      let sumX = 0, sumY = 0;
      let minXr = Infinity, maxXr = -Infinity, minYr = Infinity, maxYr = -Infinity;
      for (const p of run) {
        sumX += p.x; sumY += p.y;
        if (p.x < minXr) minXr = p.x;
        if (p.x > maxXr) maxXr = p.x;
        if (p.y < minYr) minYr = p.y;
        if (p.y > maxYr) maxYr = p.y;
      }
      doorGaps.push({
        midpointPx: {
          x: Math.round(sumX / run.length),
          y: Math.round(sumY / run.length)
        },
        spanPx: {
          x: maxXr - minXr + 1,
          y: maxYr - minYr + 1
        }
      });
    }
  }

  return doorGaps;
}

/**
 * Builds a binary wall mask by treating mid-gray pixels as walls.
 *
 * Standard floor plans draw wall bodies as a solid gray fill (~160 gray) bordered by
 * thin black edge lines. This function captures the wall body (and its anti-aliasing
 * transitions) while leaving black edge lines AND white room interiors as open space.
 * Text labels inside rooms (isolated black pixels, gray < lowThresh) are also left open,
 * so the flood fill passes through them without disruption.
 *
 * @param {ImageData} imageData
 * @param {number} [lowThresh=80]  - Gray values below this are open (edge lines, text)
 * @param {number} [highThresh=210] - Gray values above this are open (room interior)
 * @returns {Uint8Array} Binary mask: 1 = wall, 0 = open
 */
export function buildGrayWallMask(imageData, lowThresh = 80, highThresh = 210) {
  const { data, width, height } = imageData;
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;

    // Primary: luminance in the detected wall range
    if (gray >= lowThresh && gray <= highThresh) {
      mask[i] = 1;
      continue;
    }

    // Secondary: dark colored pixels (gray below lowThresh but not near-black).
    // Colored wall fills (brown, red, blue) may have lower luminance than
    // the detected gray range. Include them if they are not pure black
    // edge lines (which should remain open for flood fill to work).
    if (gray >= 10 && gray < lowThresh) {
      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      const sat = maxC > 0 ? (maxC - minC) / maxC : 0;
      // High saturation + not too dark = colored wall material
      if (sat > 0.3 && maxC > 40) {
        mask[i] = 1;
        continue;
      }
    }

    mask[i] = 0;
  }
  return mask;
}

/**
 * Analyses the image histogram to auto-detect the gray range occupied by wall fill.
 *
 * Typical floor plans have three dominant histogram peaks:
 *   - Near 0   : black edge lines and text
 *   - Mid-range: wall fill (gray ~100-180, typically ~160)
 *   - Near 255 : white room interiors
 *
 * Returns a {low, high} range centred on the detected wall fill peak, or null if
 * no significant mid-gray peak is found (e.g. black-line-only floor plans).
 *
 * @param {ImageData} imageData
 * @returns {{ low: number, high: number } | null}
 */
export function autoDetectWallRange(imageData) {
  const { data, width, height } = imageData;
  const total = width * height;
  const hist = new Int32Array(256);

  for (let i = 0; i < total; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    hist[Math.round(0.299 * r + 0.587 * g + 0.114 * b)]++;
  }

  // Find whiteLevel: the lowest gray value that accounts for the top 20% of pixels
  let cumFromTop = 0;
  let whiteLevel = 255;
  for (let g = 255; g >= 0; g--) {
    cumFromTop += hist[g];
    if (cumFromTop > total * 0.20) { whiteLevel = g + 1; break; }
  }

  // Find the dominant wall fill peak in range [10, whiteLevel - 20].
  // Starts at 10 (not 30) to capture very dark colored walls (blue at gray≈29,
  // dark brown at gray≈20). Pure black edge lines cluster at 0-5 and are thin
  // enough to be excluded by the pixel count threshold.
  let maxCount = 0;
  let wallCenter = -1;
  const midLow = 10;
  const midHigh = Math.max(midLow + 1, whiteLevel - 20);
  for (let g = midLow; g < midHigh; g++) {
    if (hist[g] > maxCount) { maxCount = hist[g]; wallCenter = g; }
  }

  // Require the peak to represent at least 0.3% of all pixels.
  // Lowered from 0.5% to handle thin-walled plans and colored fills that
  // spread across multiple luminance bins.
  if (wallCenter < 0 || maxCount < total * 0.003) return null;

  // Use ±80 range (widened from ±60) to capture multi-toned walls
  // (e.g. colored fills with gradient transitions or aliasing).
  return {
    low:  Math.max(5, wallCenter - 80),
    high: Math.min(whiteLevel - 15, wallCenter + 80)
  };
}

// ---------------------------------------------------------------------------
// Image preprocessing: remove colored annotation noise
// ---------------------------------------------------------------------------

/**
 * Build a binary protection mask covering envelope wall regions.
 * Pixels inside this mask are immune from annotation removal.
 *
 * For each envelope polygon edge, a band of wall thickness + margin is filled
 * inward (toward polygon centroid). For each spanning wall, a band is filled
 * on both sides.
 *
 * @param {number} w - Image width
 * @param {number} h - Image height
 * @param {Array<{x:number,y:number}>} envelopePx - Envelope polygon vertices in pixel coords
 * @param {{ edges: Array<{thicknessPx:number}>, medianPx: number }} wallThicknesses
 * @param {Array<{startPx:{x,y}, endPx:{x,y}, thicknessPx:number}>} spanningWallsPx
 * @param {number} pixelsPerCm
 * @returns {Uint8Array} Binary mask (1=protected, 0=unprotected)
 */
function buildWallProtectionMask(w, h, envelopePx, wallThicknesses, spanningWallsPx, pixelsPerCm) {
  const mask = new Uint8Array(w * h);
  const marginPx = Math.ceil(2 * pixelsPerCm);
  const n = envelopePx.length;
  if (n < 3) return mask;

  // Compute centroid to determine inward direction
  let cx = 0, cy = 0;
  for (const p of envelopePx) { cx += p.x; cy += p.y; }
  cx /= n; cy /= n;

  const medianPx = wallThicknesses?.medianPx || Math.round(30 * pixelsPerCm);

  // Fill band along each envelope edge
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = envelopePx[i].x, ay = envelopePx[i].y;
    const bx = envelopePx[j].x, by = envelopePx[j].y;
    const edgeDx = bx - ax, edgeDy = by - ay;
    const edgeLen = Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy);
    if (edgeLen < 1) continue;

    // Unit edge direction
    const ux = edgeDx / edgeLen, uy = edgeDy / edgeLen;

    // Two candidate perpendiculars: (-uy, ux) and (uy, -ux)
    // Choose the one pointing toward the centroid (inward)
    const midX = (ax + bx) / 2, midY = (ay + by) / 2;
    const toCx = cx - midX, toCy = cy - midY;
    const dot1 = (-uy) * toCx + ux * toCy;
    const dot2 = uy * toCx + (-ux) * toCy;
    const nx = dot1 >= dot2 ? -uy : uy;
    const ny = dot1 >= dot2 ? ux : -ux;

    // Wall thickness for this edge
    const edgeThickness = wallThicknesses?.edges?.[i]?.thicknessPx || medianPx;
    const depth = edgeThickness + marginPx;

    // Walk along edge and fill inward
    const steps = Math.ceil(edgeLen);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const ex = ax + edgeDx * t;
      const ey = ay + edgeDy * t;
      for (let d = 0; d <= depth; d++) {
        const px = Math.round(ex + nx * d);
        const py = Math.round(ey + ny * d);
        if (px >= 0 && px < w && py >= 0 && py < h) {
          mask[py * w + px] = 1;
        }
      }
    }
  }

  // Fill band along each spanning wall
  for (const wall of (spanningWallsPx || [])) {
    const sx = wall.startPx.x, sy = wall.startPx.y;
    const ex = wall.endPx.x, ey = wall.endPx.y;
    const dx = ex - sx, dy = ey - sy;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1) continue;

    const ux = dx / len, uy = dy / len;
    // Perpendiculars on both sides
    const halfDepth = Math.round(wall.thicknessPx / 2) + marginPx;

    const steps = Math.ceil(len);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const px0 = sx + dx * t;
      const py0 = sy + dy * t;
      for (let d = -halfDepth; d <= halfDepth; d++) {
        const px = Math.round(px0 + (-uy) * d);
        const py = Math.round(py0 + ux * d);
        if (px >= 0 && px < w && py >= 0 && py < h) {
          mask[py * w + px] = 1;
        }
      }
    }
  }

  return mask;
}

/**
 * Build a binary mask indicating which pixels are inside the envelope polygon.
 * Uses ray-casting point-in-polygon test. An optional inward margin shrinks
 * the test boundary so envelope edge-line pixels are not accidentally excluded.
 */
function buildInsideEnvelopeMask(w, h, envelopePx, marginPx = 0) {
  const mask = new Uint8Array(w * h);
  const n = envelopePx.length;
  if (n < 3) return mask;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of envelopePx) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const x0 = Math.max(0, Math.floor(minX) - 1);
  const y0 = Math.max(0, Math.floor(minY) - 1);
  const x1 = Math.min(w - 1, Math.ceil(maxX) + 1);
  const y1 = Math.min(h - 1, Math.ceil(maxY) + 1);

  // If margin > 0, shrink polygon toward centroid
  let poly = envelopePx;
  if (marginPx > 0) {
    let cx = 0, cy = 0;
    for (const p of envelopePx) { cx += p.x; cy += p.y; }
    cx /= n; cy /= n;
    poly = envelopePx.map(p => {
      const dx = p.x - cx, dy = p.y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 1) return p;
      const scale = Math.max(0, (dist - marginPx) / dist);
      return { x: cx + dx * scale, y: cy + dy * scale };
    });
  }

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      let inside = false;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = poly[i].x, yi = poly[i].y;
        const xj = poly[j].x, yj = poly[j].y;
        if (((yi > y) !== (yj > y)) &&
            (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
          inside = !inside;
        }
      }
      if (inside) mask[y * w + x] = 1;
    }
  }
  return mask;
}

/**
 * Preprocess image for room detection using structure-aware wall extraction.
 *
 * Three phases using envelope priors:
 * Phase 1 — Bleach exterior (outside envelope polygon → white)
 * Phase 2 — Directional morphological opening (keep thick axis-aligned features)
 * Phase 3 — Bleach interior noise (dark pixels not identified as walls)
 *
 * Without envelope data, falls back to color-only annotation removal.
 *
 * Modifies imageData.data in-place.
 *
 * @param {ImageData} imageData - Source RGBA image (modified in-place)
 * @param {{ pixelsPerCm?: number, envelopePolygonPx?: Array<{x,y}>, envelopeWallThicknesses?: object, spanningWallsPx?: Array }} options
 */
export function preprocessForRoomDetection(imageData, options = {}) {
  const {
    pixelsPerCm = 1,
    envelopePolygonPx,
    envelopeWallThicknesses,
    spanningWallsPx,
  } = options;

  const { data, width: w, height: h } = imageData;
  const total = w * h;
  let hWalls = null, vWalls = null;

  // Without envelope data, fall back to color-only removal
  if (!envelopePolygonPx || envelopePolygonPx.length < 3) {
    // Legacy: remove thin colored annotations using morphological opening
    const coloredMask = new Uint8Array(total);
    for (let i = 0; i < total; i++) {
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      if (gray < 10 || gray >= 200) continue;
      const maxC = Math.max(r, g, b), minC = Math.min(r, g, b);
      const sat = maxC > 0 ? (maxC - minC) / maxC : 0;
      if (sat > 0.3 && maxC > 40) coloredMask[i] = 1;
    }
    let hasColored = false;
    for (let i = 0; i < total; i++) { if (coloredMask[i]) { hasColored = true; break; } }
    if (!hasColored) return;
    const { minCm } = FLOOR_PLAN_RULES.wallThickness;
    const erosionRadiusPx = Math.max(2, Math.round(minCm / 3 * pixelsPerCm));
    const thickMask = morphologicalOpen(coloredMask, w, h, erosionRadiusPx);
    for (let i = 0; i < total; i++) {
      if (coloredMask[i] === 1 && thickMask[i] === 0) {
        data[i * 4] = 255; data[i * 4 + 1] = 255;
        data[i * 4 + 2] = 255; data[i * 4 + 3] = 255;
      }
    }
  } else {

  // ── Phase 1: Bleach exterior ──────────────────────────────────────────────
  // Everything outside the envelope polygon → white. Use an inward margin
  // so envelope wall edge lines aren't accidentally excluded.
  // TODO: Currently skipped — detectEnvelope on messy images produces
  // oversimplified polygons (6 vertices vs 27) that cut off building content.
  // Phase 1 will be re-enabled once envelope detection is improved.

  // ── Phase 2: Directional morphological opening ────────────────────────────
  const range = autoDetectWallRange(imageData);
  const highThresh = range ? range.high : 200;

  // Build dark pixel mask (entire image, since Phase 1 is skipped)
  const darkMask = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    const gray = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    if (gray < highThresh) darkMask[i] = 1;
  }

  // Directional kernels: features must be thick enough AND long enough.
  // thickRadius controls minimum perpendicular extent. At ppc≈1.18:
  //   thickRadius=2 → needs ≥5px thick → text strokes (2-3px) removed,
  //   partition walls (14px) survive easily.
  // longRadius controls minimum parallel extent.
  //   longRadius=4 → needs ≥9px long → isolated blobs removed.
  // No morphological close before opening — close merges text characters
  // into blobs thick enough to survive, defeating text removal.
  const thickRadius = Math.max(1, Math.round(1.5 * pixelsPerCm));
  const longRadius = Math.max(2, Math.round(3 * pixelsPerCm));

  hWalls = morphologicalOpenRect(darkMask, w, h, longRadius, thickRadius);
  vWalls = morphologicalOpenRect(darkMask, w, h, thickRadius, longRadius);

  const wallFeatures = new Uint8Array(total);
  for (let i = 0; i < total; i++) wallFeatures[i] = hWalls[i] | vWalls[i];

  // ── Phase 2b: Recover thin colored walls ──────────────────────────────────
  // Some rooms have colored wall strokes (e.g. red) thinner than standard walls.
  // These fail the main opening but are still wall-like: long, straight,
  // axis-aligned. Detect them with a lower thickness threshold and union.
  const coloredDark = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    if (!darkMask[i]) continue;
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const vmax = Math.max(r, g, b), vmin = Math.min(r, g, b);
    const sat = vmax > 0 ? (vmax - vmin) / vmax : 0;
    if (sat > 0.3) coloredDark[i] = 1;
  }
  // Lower thickness threshold (radius 1 → needs ≥3px), same long requirement
  const hColored = morphologicalOpenRect(coloredDark, w, h, longRadius, 1);
  const vColored = morphologicalOpenRect(coloredDark, w, h, 1, longRadius);
  for (let i = 0; i < total; i++) {
    if (hColored[i] || vColored[i]) wallFeatures[i] = 1;
  }

  // ── Phase 3: Bleach interior noise ────────────────────────────────────────
  const protectionMask = buildWallProtectionMask(
    w, h, envelopePolygonPx, envelopeWallThicknesses,
    spanningWallsPx, pixelsPerCm
  );

  for (let i = 0; i < total; i++) {
    if (darkMask[i] && !wallFeatures[i] && !protectionMask[i]) {
      data[i * 4] = 255; data[i * 4 + 1] = 255;
      data[i * 4 + 2] = 255; data[i * 4 + 3] = 255;
    }
  }

  } // end else (envelope path)

  // ── Final: Greyscale + Normalize ───────────────────────────────────────────
  // Flatten alpha onto white, convert to greyscale (BT.709), normalize contrast.
  let gMin = 255, gMax = 0;
  const grayVals = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    const a = data[i * 4 + 3] / 255;
    const r = data[i * 4] * a + 255 * (1 - a);
    const g = data[i * 4 + 1] * a + 255 * (1 - a);
    const b = data[i * 4 + 2] * a + 255 * (1 - a);
    const gray = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
    grayVals[i] = gray;
    if (gray < gMin) gMin = gray;
    if (gray > gMax) gMax = gray;
  }
  const gRange = gMax - gMin;
  for (let i = 0; i < total; i++) {
    const v = gRange > 0 ? Math.round(255 * (grayVals[i] - gMin) / gRange) : grayVals[i];
    data[i * 4] = v; data[i * 4 + 1] = v;
    data[i * 4 + 2] = v; data[i * 4 + 3] = 255;
  }

  return hWalls && vWalls ? { hWalls, vWalls } : undefined;
}

/**
 * Scan along each polygon edge in the wall mask for runs of missing wall pixels.
 * These "blank" runs along the wall line correspond to real doorways / openings.
 *
 * At each step along the edge we probe ±searchDepthPx perpendicular pixels.
 * If no wall pixel (mask=1) is found in that strip, the edge position is "open".
 * Contiguous open runs within [minGapPx, maxGapPx] are returned as door gaps.
 *
 * @param {Uint8Array} mask - Opened wall mask (1=wall, 0=open)
 * @param {Array<{x,y}>} polygonPixels - Detected polygon vertices in pixel coords
 * @param {number} w - Image width
 * @param {number} h - Image height
 * @param {{ minGapPx: number, maxGapPx: number, searchDepthPx: number }} options
 * @returns {Array<{midpointPx: {x,y}, spanPx: {x,y}}>}
 */
function detectDoorGapsAlongEdges(mask, polygonPixels, w, h, options = {}) {
  const { minGapPx = 40, maxGapPx = 300, searchDepthPx = 10, maxDashPx = 0 } = options;
  const n = polygonPixels.length;
  const gaps = [];

  for (let edgeIdx = 0; edgeIdx < n; edgeIdx++) {
    const A = polygonPixels[edgeIdx];
    const B = polygonPixels[(edgeIdx + 1) % n];

    const dxE = B.x - A.x;
    const dyE = B.y - A.y;
    const edgeLen = Math.hypot(dxE, dyE);
    if (edgeLen < 2) continue;

    // Unit tangent along edge; perpendicular (search direction)
    const tx = dxE / edgeLen;
    const ty = dyE / edgeLen;
    // Perpendicular: both sides searched (wall gray fill is always outward)
    const pxN = -ty;
    const pyN =  tx;

    const steps = Math.ceil(edgeLen);
    let inGap = false;
    let gapStart = 0;

    // Collect ALL gaps along this edge (even tiny ones for dash merging)
    const rawGaps = [];

    for (let s = 0; s <= steps; s++) {
      // Force-close any open gap at the end of the edge
      let hasWall = (s === steps);

      if (!hasWall) {
        const cx = A.x + tx * s;
        const cy = A.y + ty * s;

        // Probe both perpendicular directions for a wall pixel
        for (let d = -searchDepthPx; d <= searchDepthPx && !hasWall; d++) {
          const sx = Math.round(cx + pxN * d);
          const sy = Math.round(cy + pyN * d);
          if (sx >= 0 && sx < w && sy >= 0 && sy < h && mask[sy * w + sx]) {
            hasWall = true;
          }
        }
      }

      if (!hasWall && !inGap) {
        inGap = true;
        gapStart = s;
      } else if (hasWall && inGap) {
        inGap = false;
        rawGaps.push({ start: gapStart, end: s });
      }
    }

    // Merge consecutive gaps separated by short wall segments (dashed lines).
    // A dashed line indicates an opening; the short wall dashes between gaps
    // are part of the dash pattern, not real walls.
    const merged = [];
    for (const g of rawGaps) {
      const last = merged.length > 0 ? merged[merged.length - 1] : null;
      if (last && maxDashPx > 0 && (g.start - last.end) <= maxDashPx) {
        // Wall segment between gaps is short enough to be a dash → merge
        last.end = g.end;
      } else {
        merged.push({ start: g.start, end: g.end });
      }
    }

    // Filter to valid size range and emit
    for (const g of merged) {
      const gapLen = g.end - g.start;
      if (gapLen >= minGapPx && gapLen <= maxGapPx) {
        const midS = (g.start + g.end - 1) / 2;
        gaps.push({
          midpointPx: {
            x: Math.round(A.x + tx * midS),
            y: Math.round(A.y + ty * midS)
          },
          spanPx: { x: gapLen, y: gapLen }
        });
      }
    }
  }

  return gaps;
}

/**
 * Orchestrator: detects a room at the given seed pixel.
 *
 * Primary path (for floor plans with gray-fill walls, i.e. most CAD/scanned plans):
 *   1. Auto-detect the wall gray range from the image histogram.
 *   2. Build a gray-range wall mask and run morphological close + flood fill.
 *
 * Fallback (for black-line-only floor plans where no mid-gray peak exists):
 *   Try thresholds [180, 200, 220, 240] — 180 correctly marks gray=160 as wall,
 *   and all four values capture solid-black walls (0 < any threshold).
 *
 * @param {ImageData} imageData - Source image data
 * @param {number} seedX - X coordinate of seed pixel (inside room)
 * @param {number} seedY - Y coordinate of seed pixel (inside room)
 * @param {{pixelsPerCm?: number, maxAreaCm2?: number}} options
 * @returns {{ polygonPixels: Array<{x,y}>, doorGapsPx: Array, pixelsPerCm: number, wallThicknesses: {edges: Array, medianPx: number, medianCm: number} } | null}
 */

/**
 * Classify an RGBA pixel as 'edge' (dark wall line), 'fill' (wall interior),
 * or 'background' (light/white or colored annotation).
 *
 * Uses luminance + saturation to handle both neutral (grayscale) walls and
 * colored walls (brown, blue, red, beige fills common in architectural plans).
 *
 * - edge: gray < 80, regardless of hue (dark = wall line)
 * - fill: gray ∈ [80, 200) with low-to-moderate saturation; OR gray ∈ [200, 220)
 *   with very low saturation (light beige/cream fills)
 * - background: bright pixels (gray ≥ 200) with high saturation or very light
 *   neutral pixels (gray ≥ 220)
 *
 * Saturation is measured as max channel spread / max channel value — 0 = gray,
 * 1 = fully saturated. The threshold scales with luminance: darker pixels are
 * more likely wall material even with some color.
 *
 * @param {number} r - Red channel (0-255)
 * @param {number} g - Green channel (0-255)
 * @param {number} b - Blue channel (0-255)
 * @returns {'edge' | 'fill' | 'background'}
 */
function classifyWallPixel(r, g, b) {
  const gray = 0.299 * r + 0.587 * g + 0.114 * b;

  // Measure saturation: spread of channels relative to the brightest channel.
  // 0 = perfectly neutral gray, 1 = fully saturated pure hue.
  const maxC = Math.max(r, g, b);
  const minC = Math.min(r, g, b);
  const sat = maxC > 0 ? (maxC - minC) / maxC : 0;

  // Dark pixels (gray < 80): edge lines for walls of any color.
  // Previous neutral-hue gate rejected colored walls; now all dark pixels qualify.
  if (gray < 80) return "edge";

  // Dark-to-mid pixels (80–120): edge if low saturation (black/dark-gray wall lines),
  // fill otherwise (colored wall body — e.g. brown 139,69,19 has gray≈84, sat≈0.86).
  if (gray < 120) return sat < 0.3 ? "edge" : "fill";

  // Mid-tone pixels (120–200): wall fill if saturation is moderate.
  // At gray=120 allow sat≤0.65, at gray=200 allow sat≤0.35.
  // Darker mid-tones tolerate more color (wall fills); brighter ones need
  // lower saturation to distinguish from colored annotations/text.
  if (gray < 200) {
    const satThreshold = 0.65 - (gray - 120) / 80 * 0.30;
    return sat <= satThreshold ? "fill" : "background";
  }

  // Light pixels (gray ≥ 200): background unless very low saturation AND not too bright.
  // Light beige/cream fills (e.g. 220,210,190 → gray≈212, sat≈0.14) are wall fill.
  // Pure white and near-white (gray ≥ 220) are always background.
  if (gray < 220 && sat < 0.2) return "fill";

  return "background";
}

/**
 * Probe outward from a start point along a perpendicular direction,
 * using RGBA pixel classification to find inner and outer edge lines.
 * Returns center-to-center thickness in pixels.
 *
 * State machine: seekInner → seekOuter → done
 * - seekInner: find first contiguous run of 'edge' pixels
 * - seekOuter: skip 'fill' pixels, find next run of 'edge' pixels
 * - Fallback: if background hit during seekOuter, return inner edge width
 *
 * @param {Uint8ClampedArray} data - RGBA pixel data
 * @param {number} startX - Start X coordinate
 * @param {number} startY - Start Y coordinate
 * @param {number} perpX - Perpendicular direction X (unit vector)
 * @param {number} perpY - Perpendicular direction Y (unit vector)
 * @param {number} w - Image width
 * @param {number} h - Image height
 * @param {number} maxProbe - Maximum probe depth in pixels
 * @returns {number} Wall thickness in pixels (0 if no edge found)
 */
function probeWallThickness(data, startX, startY, perpX, perpY, w, h, maxProbe) {
  // Phase 1: scan outward, classify every pixel, find the wall band.
  // The wall band is the contiguous region of edge+fill pixels.
  // We allow a small gap of background pixels (≤2) within the band to handle
  // anti-aliasing at edge line boundaries.
  let wallStart = -1, wallEnd = -1;
  const edgeRuns = []; // [{start, end}] — contiguous runs of 'edge' pixels within the wall
  let currentEdgeStart = -1;
  let bgGap = 0; // consecutive background pixels inside wall band

  for (let d = 1; d <= maxProbe; d++) {
    const px = Math.round(startX + perpX * d);
    const py = Math.round(startY + perpY * d);
    if (px < 0 || px >= w || py < 0 || py >= h) break;

    const idx = (py * w + px) * 4;
    const cls = classifyWallPixel(data[idx], data[idx + 1], data[idx + 2]);

    if (cls === "edge" || cls === "fill") {
      if (wallStart < 0) wallStart = d;
      wallEnd = d;
      bgGap = 0;

      if (cls === "edge") {
        if (currentEdgeStart < 0) currentEdgeStart = d;
      } else {
        // fill pixel — end any current edge run
        if (currentEdgeStart >= 0) {
          edgeRuns.push({ start: currentEdgeStart, end: d - 1 });
          currentEdgeStart = -1;
        }
      }
    } else {
      // background pixel
      if (currentEdgeStart >= 0) {
        edgeRuns.push({ start: currentEdgeStart, end: d - 1 });
        currentEdgeStart = -1;
      }
      if (wallStart >= 0) {
        bgGap++;
        if (bgGap > 2) break; // end of wall band
      }
      // else: still in gap between room interior and wall, keep scanning
    }
  }

  // Close any open edge run
  if (currentEdgeStart >= 0) {
    edgeRuns.push({ start: currentEdgeStart, end: wallEnd });
  }

  if (wallStart < 0) return 0;

  // Phase 2: compute thickness.
  // If we found ≥2 edge runs, use center-to-center of first and last.
  // Otherwise, use the full wall band width.
  if (edgeRuns.length >= 2) {
    const first = edgeRuns[0];
    const last = edgeRuns[edgeRuns.length - 1];
    const innerCenter = (first.start + first.end) / 2;
    const outerCenter = (last.start + last.end) / 2;
    return outerCenter - innerCenter;
  }

  // Single edge run or no edge runs: use full wall band
  return wallEnd - wallStart + 1;
}

/**
 * Detect wall thickness by probing from polygon edges using RGBA
 * pixel classification. Returns per-edge measurements and overall median.
 *
 * By default probes outward (away from centroid) — correct for room polygons
 * where the centroid is inside the room and walls are outside.
 * Set probeInward=true for envelope polygons where walls are inside the boundary.
 *
 * @param {ImageData} imageData - Raw RGBA image data
 * @param {Array<{x: number, y: number}>} polygonPixels - Detected polygon vertices
 * @param {number} w - Image width
 * @param {number} h - Image height
 * @param {number} pixelsPerCm - Scale factor for px→cm conversion
 * @param {{ maxProbe?: number, probeInward?: boolean }} [opts]
 * @returns {{ edges: Array<{edgeIndex: number, thicknessPx: number, thicknessCm: number}>, medianPx: number, medianCm: number }}
 */
export function detectWallThickness(imageData, polygonPixels, w, h, pixelsPerCm = 1, opts = {}) {
  const { maxProbe = 200, probeInward = false } = typeof opts === "number" ? { maxProbe: opts } : opts;
  const empty = { edges: [], medianPx: 0, medianCm: 0 };
  const n = polygonPixels.length;
  if (n < 3) return empty;

  const data = imageData.data;

  // Compute polygon centroid to determine "outward" direction
  let cx = 0, cy = 0;
  for (const p of polygonPixels) { cx += p.x; cy += p.y; }
  cx /= n; cy /= n;

  const edges = [];

  for (let i = 0; i < n; i++) {
    const A = polygonPixels[i];
    const B = polygonPixels[(i + 1) % n];
    const dx = B.x - A.x, dy = B.y - A.y;
    const edgeLen = Math.hypot(dx, dy);
    if (edgeLen < 2) continue;

    // Edge tangent and perpendicular
    const tx = dx / edgeLen, ty = dy / edgeLen;
    let perpX = -ty, perpY = tx; // one perpendicular direction

    // Ensure perpendicular points away from centroid (outward) by default,
    // or toward centroid (inward) when probeInward is true (for envelope polygons).
    const edgeMidX = (A.x + B.x) / 2;
    const edgeMidY = (A.y + B.y) / 2;
    const toCentroidX = cx - edgeMidX;
    const toCentroidY = cy - edgeMidY;
    const dotProduct = perpX * toCentroidX + perpY * toCentroidY;
    const shouldFlip = probeInward ? (dotProduct < 0) : (dotProduct > 0);
    if (shouldFlip) {
      perpX = -perpX;
      perpY = -perpY;
    }

    // Sample at 7 points along the edge, evenly spaced.
    // Cap probe distance using FLOOR_PLAN_RULES.wallThickness.maxCm (+ margin)
    // to avoid crossing interior walls at junctions.
    const { minCm: ruleMinCm, maxCm: ruleMaxCm } = FLOOR_PLAN_RULES.wallThickness;
    const probeLimitCm = ruleMaxCm + 10; // small margin beyond max for anti-aliasing
    const maxWallProbe = Math.min(maxProbe, Math.round(probeLimitCm * pixelsPerCm));
    const raw = [];
    for (let si = 1; si <= 7; si++) {
      const frac = si / 8;
      const startX = A.x + tx * edgeLen * frac;
      const startY = A.y + ty * edgeLen * frac;
      const thickness = probeWallThickness(data, startX, startY, perpX, perpY, w, h, maxWallProbe);
      if (thickness >= 2) {
        raw.push(thickness);
      }
    }

    if (raw.length < 2) continue;

    // Filter: reject samples outside FLOOR_PLAN_RULES.wallThickness bounds.
    // Samples outside this range come from junction crossings (too large)
    // or polygon misalignment (too small).
    const minWallPx = Math.max(2, Math.round(ruleMinCm * pixelsPerCm));
    const maxWallPx = Math.round(ruleMaxCm * pixelsPerCm);
    const filtered = raw.filter(v => v >= minWallPx && v <= maxWallPx);

    if (filtered.length < 2) continue;

    filtered.sort((a, b) => a - b);
    const medIdx = Math.floor(filtered.length / 2);
    const thicknessPx = filtered.length % 2 === 1
      ? filtered[medIdx]
      : (filtered[medIdx - 1] + filtered[medIdx]) / 2;
    edges.push({
      edgeIndex: i,
      thicknessPx,
      thicknessCm: thicknessPx / pixelsPerCm
    });
  }

  if (edges.length === 0) return empty;

  // Overall median from per-edge medians
  const allPx = edges.map(e => e.thicknessPx).sort((a, b) => a - b);
  const mid = Math.floor(allPx.length / 2);
  const medianPx = allPx.length % 2 === 1
    ? allPx[mid]
    : (allPx[mid - 1] + allPx[mid]) / 2;

  return {
    edges,
    medianPx,
    medianCm: medianPx / pixelsPerCm
  };
}

/**
 * Remove rectangular micro-bumps from an axis-aligned polygon.
 *
 * After rectifyPolygon, the polygon may contain small rectangular notches
 * caused by external structures (retaining walls, stairs) that are
 * morphologically connected to the building. These bumps are shorter than
 * the median wall thickness and are not real architectural features.
 *
 * A bump is 3 consecutive edges forming a U-shape:
 *   leg1 → short outer wall → leg2
 * where the outer wall length (bump depth) is < maxBumpDepthCm and the
 * two legs are parallel (both H or both V) and go in opposite directions.
 * Collapsing removes the two interior vertices and re-merges collinear vertices.
 *
 * @param {Array<{x: number, y: number}>} vertices - Rectified polygon vertices
 * @param {number} maxBumpDepthCm - Maximum bump depth to remove (default 30)
 * @returns {Array<{x: number, y: number}>} Cleaned polygon
 */
export function removePolygonMicroBumps(vertices, maxBumpDepthCm = FLOOR_PLAN_RULES.wallThickness.maxCm) {
  if (!vertices || vertices.length < 5) return vertices; // need at least 5 vertices for a bump

  let pts = vertices.map(p => ({ x: p.x, y: p.y }));

  let changed = true;
  while (changed) {
    changed = false;
    const n = pts.length;
    if (n < 5) break;

    for (let i = 0; i < n; i++) {
      // Three consecutive edges: leg1 (prev→i), outer (i→next), leg2 (next→next2)
      const iPrev = (i - 1 + n) % n;
      const iNext = (i + 1) % n;
      const iNext2 = (i + 2) % n;

      const A = pts[iPrev]; // before bump
      const B = pts[i];     // bump vertex 1 (start of outer wall)
      const C = pts[iNext]; // bump vertex 2 (end of outer wall)
      const D = pts[iNext2]; // after bump

      // Edge B→C is the outer wall (should be short = bump depth)
      const outerLen = Math.hypot(C.x - B.x, C.y - B.y);
      if (outerLen >= maxBumpDepthCm || outerLen < 0.1) continue;

      // Classify legs: A→B (leg1) and C→D (leg2)
      const leg1IsH = Math.abs(A.y - B.y) < 0.5;
      const leg1IsV = Math.abs(A.x - B.x) < 0.5;
      const leg2IsH = Math.abs(C.y - D.y) < 0.5;
      const leg2IsV = Math.abs(C.x - D.x) < 0.5;

      // Both legs must be parallel (both H or both V)
      if (leg1IsH && leg2IsH) {
        // Legs are H, outer wall (B→C) should be V (perpendicular)
        if (Math.abs(B.x - C.x) >= 0.5) continue;
        // U-shape: legs go in opposite directions
        const dir1 = B.x - A.x;
        const dir2 = D.x - C.x;
        if (dir1 * dir2 >= 0) continue;
      } else if (leg1IsV && leg2IsV) {
        // Legs are V, outer wall (B→C) should be H (perpendicular)
        if (Math.abs(B.y - C.y) >= 0.5) continue;
        // U-shape: legs go in opposite directions
        const dir1 = B.y - A.y;
        const dir2 = D.y - C.y;
        if (dir1 * dir2 >= 0) continue;
      } else {
        continue;
      }

      // Collapse: remove B and C, snap D to align with A on the main wall axis.
      if (leg1IsH) {
        // Legs are H → main wall is V. Snap D's x to A's x (or vice versa).
        // Pick the side with the longer adjacent main-wall edge.
        // A's x comes from the main wall before the bump.
        pts[iNext2] = { x: A.x, y: D.y };
      } else {
        // Legs are V → main wall is H. Snap D's y to A's y.
        pts[iNext2] = { x: D.x, y: A.y };
      }

      // Remove B and C (higher index first)
      if (iNext > i) {
        pts.splice(iNext, 1);
        pts.splice(i, 1);
      } else {
        pts.splice(i, 1);
        pts.splice(iNext, 1);
      }
      changed = true;
      break;
    }
  }

  // Re-merge collinear vertices.
  // Use a slightly larger tolerance than rectifyPolygon (1.0 cm vs 0.2 cm)
  // because bump removal may combine vertices from slightly misaligned sides.
  const COLLINEAR_TOL = 1.0;
  changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < pts.length && pts.length > 3; i++) {
      const a = pts[(i - 1 + pts.length) % pts.length];
      const b = pts[i];
      const c = pts[(i + 1) % pts.length];

      if (Math.abs(a.y - b.y) < COLLINEAR_TOL && Math.abs(b.y - c.y) < COLLINEAR_TOL) {
        pts.splice(i, 1);
        changed = true;
        break;
      }
      if (Math.abs(a.x - b.x) < COLLINEAR_TOL && Math.abs(b.x - c.x) < COLLINEAR_TOL) {
        pts.splice(i, 1);
        changed = true;
        break;
      }
    }
  }

  return pts;
}

export function detectRoomAtPixel(imageData, seedX, seedY, options = {}) {
  const { pixelsPerCm = 1, maxAreaCm2 = 100000 } = options;
  const w = imageData.width;
  const h = imageData.height;
  const maxPixels = Math.round(maxAreaCm2 * pixelsPerCm * pixelsPerCm);

  // Adaptive close radii: try small first (preserves narrow rooms like hallways),
  // fall back to larger radii for rooms with wider door gaps.
  // 20 cm seals gaps ≤ 40 cm, 40 cm seals ≤ 80 cm, 66 cm seals ≤ 132 cm.
  const closeRadii = [20, 40, 66].map(
    cm => Math.max(3, Math.min(300, Math.round(cm * pixelsPerCm)))
  );

  // Open radius for noise removal: ~4 cm worth of pixels, clamped to [0, 5].
  const openRadius = Math.max(0, Math.min(5, Math.round(4 * pixelsPerCm)));

  // Minimum area for wall components: smaller features are text/arrows.
  // ~(8cm)² ensures wall segments survive but text characters are removed.
  const minComponentArea = Math.max(16, Math.round(8 * pixelsPerCm) ** 2);

  // epsilon for Douglas-Peucker: ~4 cm worth of pixels, minimum 1
  const epsilon = Math.max(1, Math.round(4 * pixelsPerCm));

  let bestProcessedMask = null;
  let bestFilledMask = null;
  let bestPixelCount = 0;

  function tryMask(wallMask, applyOpen = false, label = "") {
    // Filter small components (text, arrows, dimension numbers) before morphology
    let processedMask = filterSmallComponents(wallMask, w, h, minComponentArea);

    if (applyOpen && openRadius > 0) {
      processedMask = morphologicalOpen(processedMask, w, h, openRadius);
    }

    // Try each close radius from smallest to largest.
    // Smaller radii preserve narrow rooms; larger radii seal wider door gaps.
    const seedIdx = seedY * w + seedX;
    for (const radius of closeRadii) {
      const closedMask = morphologicalClose(processedMask, w, h, radius);
      const { filledMask, pixelCount } = floodFill(closedMask, w, h, seedX, seedY, maxPixels);
      if (pixelCount > 0 && pixelCount <= maxPixels && pixelCount > bestPixelCount) {
        bestPixelCount = pixelCount;
        bestProcessedMask = processedMask;
        bestFilledMask = filledMask;
        break; // Smallest working radius wins — preserves room geometry best
      }
    }
  }

  // Primary path: gray-range mask using auto-detected wall fill colour.
  // Apply open first to remove interior anti-aliasing noise before the close.
  const range = autoDetectWallRange(imageData);
  if (range) {
    tryMask(buildGrayWallMask(imageData, range.low, range.high), true, "gray");
  }

  // Fallback: dark-threshold masks (handles black-line-only floor plans,
  // and also catches gray-fill walls when autoDetect misses them).
  // No open needed: black-line plans don't have interior gray noise.
  if (bestPixelCount === 0) {
    for (const threshold of [180, 200, 220, 240]) {
      tryMask(imageToBinaryMask(imageData, threshold), false, "dark-" + threshold);
      if (bestPixelCount > 0) break;
    }
  }

  if (!bestFilledMask) return null;

  // Fill interior holes (text/symbols inside the room that created unfilled islands)
  fillInteriorHoles(bestFilledMask, w, h);

  const contour = traceContour(bestFilledMask, w, h);
  if (contour.length < 3) return null;

  const rawPolygon = douglasPeucker(contour, epsilon);
  if (rawPolygon.length < 3) return null;

  const polygonPixels = snapPolygonEdges(rawPolygon);
  if (polygonPixels.length < 3) return null;

  // Detect wall thickness from RGBA image by probing outward from polygon edges
  const wallThicknesses = detectWallThickness(imageData, polygonPixels, w, h, pixelsPerCm);

  // Scan along each polygon edge in the opened wall mask for runs of missing
  // gray fill — these are the real door/opening gaps.
  const minGapPx = Math.max(2, Math.round(45 * pixelsPerCm));
  const maxGapPx = Math.round(250 * pixelsPerCm);
  const searchDepthPx = Math.max(3, Math.round(15 * pixelsPerCm));
  // maxDashPx: short wall segments between gaps that form a dashed line pattern.
  // ~10 cm of wall between dashes is considered part of the opening.
  const maxDashPx = Math.max(1, Math.round(10 * pixelsPerCm));
  const doorGapsPx = detectDoorGapsAlongEdges(
    bestProcessedMask, polygonPixels, w, h,
    { minGapPx, maxGapPx, searchDepthPx, maxDashPx }
  );

  return { polygonPixels, doorGapsPx, pixelsPerCm, wallThicknesses };
}

/**
 * Detect the building's outer envelope from a floor plan image.
 *
 * Algorithm:
 *   1. Build wall mask (auto-detect gray range → buildGrayWallMask → filterSmallComponents
 *      → morphologicalOpen; fallback to imageToBinaryMask with threshold sweep)
 *   2. morphologicalClose to seal small gaps in envelope walls
 *   3. floodFillFromBorder → exterior mask
 *   4. Invert to building mask, fillInteriorHoles
 *   5. Sanity: building must be 1–99% of image area
 *   6. traceContour → douglasPeucker → snapPolygonEdges → envelope polygon
 *   7. detectWallThickness on envelope edges
 *
 * @param {ImageData} imageData - Source image data
 * @param {{ pixelsPerCm?: number }} options
 * @returns {{ polygonPixels: Array<{x,y}>, wallThicknesses: object } | null}
 */

export function detectEnvelope(imageData, options = {}) {
  const { pixelsPerCm = 1, preprocessed = false, envelopeBboxPx = null } = options;
  const w = imageData.width;
  const h = imageData.height;
  const totalPixels = w * h;

  // Open radius for noise removal
  const openRadius = Math.max(0, Math.min(5, Math.round(4 * pixelsPerCm)));

  // Minimum area for wall components
  const minComponentArea = Math.max(16, Math.round(8 * pixelsPerCm) ** 2);

  // Close radius: must seal ALL openings (doorways 60–100cm, double doors up to 160cm).
  // Room detection uses [20,40,66] cm and picks the smallest that works.
  // Envelope needs the largest — 80cm seals gaps up to 160cm.
  const closeRadius = Math.max(3, Math.min(300, Math.round(80 * pixelsPerCm)));

  // Epsilon for Douglas-Peucker
  const epsilon = Math.max(1, Math.round(4 * pixelsPerCm));

  // Step 1: Build wall mask
  let wallMask = null;
  const range = autoDetectWallRange(imageData);
  if (range) {
    wallMask = buildGrayWallMask(imageData, range.low, range.high);
    let wallCount1 = 0; for (let i = 0; i < totalPixels; i++) wallCount1 += wallMask[i];
    wallMask = filterSmallComponents(wallMask, w, h, minComponentArea);
    let wallCount2 = 0; for (let i = 0; i < totalPixels; i++) wallCount2 += wallMask[i];
    if (openRadius > 0) {
      wallMask = morphologicalOpen(wallMask, w, h, openRadius);
    }
    let wallCount3 = 0; for (let i = 0; i < totalPixels; i++) wallCount3 += wallMask[i];
    console.log(`[detectEnvelope] range: ${range.low}-${range.high}, openRadius=${openRadius}, closeRadius=${closeRadius}`);
    console.log(`[detectEnvelope] wallMask: raw=${wallCount1}, filtered=${wallCount2}, opened=${wallCount3} (${(wallCount3/totalPixels*100).toFixed(2)}%)`);
  }

  // Fallback: dark-threshold masks
  if (!wallMask) {
    for (const threshold of [180, 200, 220, 240]) {
      const candidate = imageToBinaryMask(imageData, threshold);
      // Check that the mask has a reasonable amount of wall pixels (0.5–50%)
      let count = 0;
      for (let i = 0; i < totalPixels; i++) count += candidate[i];
      if (count > totalPixels * 0.005 && count < totalPixels * 0.5) {
        wallMask = filterSmallComponents(candidate, w, h, minComponentArea);
        break;
      }
    }
  }

  if (!wallMask) return null;

  let buildingMask;

  if (envelopeBboxPx) {
    // ── Second pass: stricter open to remove annotation debris ─────────
    // Use a stricter open to remove annotation remnants that
    // survive the standard open and seal the boundary when closed. The
    // extra ~6000 pixels in preprocessed vs clean are thick-enough
    // annotation debris that bridge wall gaps. A larger open radius
    // (removing features under ~20px) eliminates them while preserving
    // actual walls (~25-30px thick at this scale).
    const strictOpenRadius = Math.max(3, Math.round(6 * pixelsPerCm));
    wallMask = morphologicalOpen(wallMask, w, h, strictOpenRadius);
    let strictCount = 0; for (let i = 0; i < totalPixels; i++) strictCount += wallMask[i];
    console.log(`[detectEnvelope] strict open (r=${strictOpenRadius}): ${strictCount} (${(strictCount/totalPixels*100).toFixed(2)}%)`);

    const closedMask = morphologicalClose(wallMask, w, h, closeRadius);
    let closedCount = 0; for (let i = 0; i < totalPixels; i++) closedCount += closedMask[i];
    console.log(`[detectEnvelope] closedMask: ${closedCount} (${(closedCount/totalPixels*100).toFixed(2)}%)`);

    const exteriorMask = floodFillFromBorder(closedMask, w, h);
    let extCount = 0; for (let i = 0; i < totalPixels; i++) extCount += exteriorMask[i];
    console.log(`[detectEnvelope] exterior: ${extCount} (${(extCount/totalPixels*100).toFixed(2)}%)`);

    buildingMask = new Uint8Array(totalPixels);
    for (let i = 0; i < totalPixels; i++) {
      buildingMask[i] = exteriorMask[i] === 0 ? 1 : 0;
    }
    fillInteriorHoles(buildingMask, w, h);
  } else {
    // ── First pass: outside-in flood fill (original approach) ──────────
    // Step 2: Morphological close to seal small gaps in envelope walls
    const closedMask = morphologicalClose(wallMask, w, h, closeRadius);
    let closedCount = 0; for (let i = 0; i < totalPixels; i++) closedCount += closedMask[i];
    console.log(`[detectEnvelope] closedMask: ${closedCount} (${(closedCount/totalPixels*100).toFixed(2)}%)`);

    // Step 3: Flood fill from border to find exterior
    const exteriorMask = floodFillFromBorder(closedMask, w, h);
    let extCount = 0; for (let i = 0; i < totalPixels; i++) extCount += exteriorMask[i];
    console.log(`[detectEnvelope] exterior: ${extCount} (${(extCount/totalPixels*100).toFixed(2)}%)`);

    // Step 4: Invert to building mask, fill interior holes
    buildingMask = new Uint8Array(totalPixels);
    for (let i = 0; i < totalPixels; i++) {
      buildingMask[i] = exteriorMask[i] === 0 ? 1 : 0;
    }
    fillInteriorHoles(buildingMask, w, h);
  }

  // Step 5: Sanity check — building must be 1–99% of image
  let buildingArea = 0;
  for (let i = 0; i < totalPixels; i++) buildingArea += buildingMask[i];
  console.log(`[detectEnvelope] buildingArea: ${buildingArea} (${(buildingArea/totalPixels*100).toFixed(2)}%)`);
  if (buildingArea < totalPixels * 0.01 || buildingArea > totalPixels * 0.99) {
    return null;
  }

  // Step 6: Trace contour → simplify → snap
  const contour = traceContour(buildingMask, w, h);
  if (contour.length < 3) return null;

  const rawPolygon = douglasPeucker(contour, epsilon);
  if (rawPolygon.length < 3) return null;
  console.log(`[detectEnvelope] contour: ${contour.length} pts, rawPolygon: ${rawPolygon.length} verts`);

  const polygonPixels = snapPolygonEdges(rawPolygon);
  console.log(`[detectEnvelope] snapped: ${polygonPixels.length} verts`);
  if (polygonPixels.length < 3) return null;

  // Step 7: Detect wall thickness — probe inward (toward building interior)
  // because the envelope polygon traces the outer boundary
  const wallThicknesses = detectWallThickness(imageData, polygonPixels, w, h, pixelsPerCm, { probeInward: true });

  return { polygonPixels, wallThicknesses, wallMask, buildingMask };
}

/**
 * Detect full-span structural walls inside the building envelope.
 *
 * Uses row/column density profiling: a structural spanning wall shows up as
 * a band of consecutive rows (or columns) where wall pixels fill most of the
 * building width. Room partitions only cover a fraction and are rejected.
 *
 * @param {ImageData} imageData - Source RGBA image data (for thickness probing)
 * @param {Uint8Array} wallMask - Cleaned wall mask (1=wall, 0=open)
 * @param {Uint8Array} buildingMask - Building interior mask (1=inside, 0=outside)
 * @param {number} w - Image width
 * @param {number} h - Image height
 * @param {{ pixelsPerCm?: number, minThicknessCm?: number, maxThicknessCm?: number, rejections?: Array }} options
 *   Pass `rejections: []` to collect rejection reasons for debugging.
 *   Each entry: { orientation, band: {start,end}, reason: string, details: object }
 * @returns {Array<{ orientation: string, startPx: {x:number,y:number}, endPx: {x:number,y:number}, thicknessPx: number }>}
 */
export function detectSpanningWalls(imageData, wallMask, buildingMask, w, h, options = {}) {
  const {
    pixelsPerCm: ppc = 1,
    minThicknessCm = FLOOR_PLAN_RULES.wallThickness.minCm,
    maxThicknessCm = FLOOR_PLAN_RULES.wallThickness.maxCm,
    rejections = null,
  } = options;

  const data = imageData.data;
  const DENSITY_THRESHOLD = 0.4;
  const SPAN_THRESHOLD = 0.7;
  const MIN_BUILDING_WIDTH_PX = 50;
  const GAP_MERGE = Math.max(1, Math.ceil(2 * ppc)); // merge bands separated by ≤ ~2cm
  const MIN_BUILDING_WIDTH_CM = 100;
  const MIN_SPAN_LENGTH_CM = 200; // wall must span ≥200cm to be structural (not a partition in a narrow arm)
  const NUM_SAMPLES = 5; // thickness probe sample count

  // Quick check: any building pixels at all?
  let hasBldg = false;
  for (let i = 0; i < w * h && !hasBldg; i++) {
    if (buildingMask[i]) hasBldg = true;
  }
  if (!hasBldg) return [];

  const results = [];

  // ---- Horizontal spanning walls (scan rows) ----
  const hBands = profileAndDetectBands(
    /* scanCount */ h,
    /* crossCount */ w,
    /* getWall */ (scan, cross) => wallMask[scan * w + cross],
    /* getBldg */ (scan, cross) => buildingMask[scan * w + cross]
  );
  for (const band of hBands) {
    const wall = validateAndMeasureBand(band, 'H');
    if (wall) results.push(wall);
  }

  // ---- Vertical spanning walls (scan columns) ----
  const vBands = profileAndDetectBands(
    /* scanCount */ w,
    /* crossCount */ h,
    /* getWall */ (scan, cross) => wallMask[cross * w + scan],
    /* getBldg */ (scan, cross) => buildingMask[cross * w + scan]
  );
  for (const band of vBands) {
    const wall = validateAndMeasureBand(band, 'V');
    if (wall) results.push(wall);
  }

  return results;

  // ---- Inner functions ----

  /**
   * Profile rows (or columns) and detect candidate bands.
   * scanCount = number of rows (H) or columns (V)
   * crossCount = number of columns (H) or rows (V)
   * getWall(scanIdx, crossIdx) → 0|1
   * getBldg(scanIdx, crossIdx) → 0|1
   */
  function profileAndDetectBands(scanCount, crossCount, getWall, getBldg) {
    // Step 1: Row profiling
    const profiles = [];
    for (let s = 0; s < scanCount; s++) {
      let bldgFirst = -1, bldgLast = -1;
      for (let c = 0; c < crossCount; c++) {
        if (getBldg(s, c)) {
          if (bldgFirst < 0) bldgFirst = c;
          bldgLast = c;
        }
      }
      const bldgWidth = bldgFirst >= 0 ? bldgLast - bldgFirst + 1 : 0;
      if (bldgWidth < MIN_BUILDING_WIDTH_PX) {
        profiles.push({ density: 0, spanFraction: 0, bldgFirst: 0, bldgLast: 0, bldgWidth: 0 });
        continue;
      }

      let wallCount = 0;
      let wallFirst = -1, wallLast = -1;
      for (let c = bldgFirst; c <= bldgLast; c++) {
        if (getWall(s, c)) {
          wallCount++;
          if (wallFirst < 0) wallFirst = c;
          wallLast = c;
        }
      }
      const density = wallCount / bldgWidth;
      const wallSpan = wallFirst >= 0 ? wallLast - wallFirst + 1 : 0;
      const spanFraction = wallSpan / bldgWidth;

      profiles.push({ density, spanFraction, bldgFirst, bldgLast, bldgWidth });
    }

    // Step 2: Band detection — group consecutive qualifying rows
    const bands = [];
    let bandStart = -1;
    for (let s = 0; s < scanCount; s++) {
      const p = profiles[s];
      if (p.density >= DENSITY_THRESHOLD && p.spanFraction >= SPAN_THRESHOLD) {
        if (bandStart < 0) bandStart = s;
      } else {
        if (bandStart >= 0) {
          bands.push({ start: bandStart, end: s - 1 });
          bandStart = -1;
        }
      }
    }
    if (bandStart >= 0) bands.push({ start: bandStart, end: scanCount - 1 });

    // Merge bands separated by small gaps
    const merged = [];
    for (const band of bands) {
      if (merged.length > 0 && band.start - merged[merged.length - 1].end <= GAP_MERGE + 1) {
        merged[merged.length - 1].end = band.end;
      } else {
        merged.push({ ...band });
      }
    }

    // Annotate each band with average building extent
    for (const band of merged) {
      let sumFirst = 0, sumLast = 0, sumWidth = 0, count = 0;
      for (let s = band.start; s <= band.end; s++) {
        const p = profiles[s];
        if (p.bldgWidth > 0) {
          sumFirst += p.bldgFirst;
          sumLast += p.bldgLast;
          sumWidth += p.bldgWidth;
          count++;
        }
      }
      band.avgBldgFirst = count > 0 ? Math.round(sumFirst / count) : 0;
      band.avgBldgLast = count > 0 ? Math.round(sumLast / count) : 0;
      band.avgBldgWidth = count > 0 ? sumWidth / count : 0;
    }

    return merged;
  }

  /**
   * Validate a candidate band and measure its wall thickness.
   * Returns a wall object or null if rejected.
   *
   * Criteria:
   * (1) Band thickness in [minThicknessCm, maxThicknessCm]
   * (2) Average building width at band >= 100 cm
   * (3) Band is far enough from building edge (rejects outer wall inner edges)
   * (4) Wall is continuous: no gap in the wall mask along the cross direction
   *     larger than 2× the band thickness. Separate partition walls that happen
   *     to align at the same row/column are rejected by this check.
   * (5) Wall touches both outer walls: wall pixels exist within the band near
   *     both building edges (within 2× band thickness margin).
   * (6) Thickness consistent: ≥80% of perpendicular probes detect a real wall
   *     with thickness in [minThicknessCm, maxThicknessCm].
   */
  function validateAndMeasureBand(band, orientation) {
    const bandHeight = band.end - band.start + 1;
    const bandCm = bandHeight / ppc;

    function reject(reason, details = {}) {
      if (rejections) {
        rejections.push({ orientation, band: { start: band.start, end: band.end }, reason, details });
      }
      return null;
    }

    // (1) Thickness check
    if (bandCm < minThicknessCm || bandCm > maxThicknessCm) {
      return reject('thickness', { bandCm, minThicknessCm, maxThicknessCm });
    }

    // (2) Minimum building width at the band
    if (band.avgBldgWidth < MIN_BUILDING_WIDTH_CM * ppc) {
      return reject('building_width', { avgBldgWidthCm: band.avgBldgWidth / ppc, minCm: MIN_BUILDING_WIDTH_CM });
    }

    // (3) Boundary proximity: reject bands within one band-height of building edge.
    // These are outer wall inner edges, not interior spanning walls.
    // Uses per-band local sampling (not global bbox) to handle non-rectangular buildings.
    const distToBoundary = distanceToBuildingBoundary(band, orientation);
    if (distToBoundary < bandHeight) {
      return reject('boundary_proximity', { distToBoundary, bandHeight });
    }

    // (4) Continuity: scan the cross direction within the band and find the
    // largest gap where no wall pixels exist. A real spanning wall is continuous;
    // aligned partition walls have room-sized gaps between them.
    // Allow gaps proportional to building width (25%) to accommodate multiple
    // door openings. Minimum is 2× band thickness for anti-aliasing tolerance.
    const maxAllowedGap = Math.max(bandHeight * 2, Math.round(band.avgBldgWidth * 0.25));
    const { maxGap, wallFirst, wallLast } = measureContinuity(band, orientation);
    if (maxGap > maxAllowedGap) {
      return reject('continuity', { maxGap, maxAllowedGap, maxGapCm: maxGap / ppc });
    }

    // (5) Touches both outer walls: wall pixels must exist near both building edges.
    const margin = bandHeight * 2;
    const touchesStart = wallFirst <= band.avgBldgFirst + margin;
    const touchesEnd = wallLast >= band.avgBldgLast - margin;
    if (!touchesStart || !touchesEnd) {
      return reject('edge_touch', { touchesStart, touchesEnd, wallFirst, wallLast, margin });
    }

    // (5b) Minimum absolute span length: prevents partitions in narrow building arms
    // from being classified as structural spanning walls.
    const spanLengthPx = wallLast - wallFirst;
    if (spanLengthPx < MIN_SPAN_LENGTH_CM * ppc) {
      return reject('span_length', { spanLengthCm: spanLengthPx / ppc, minSpanCm: MIN_SPAN_LENGTH_CM });
    }

    // (6) Thickness consistency: probe perpendicular to the wall at NUM_SAMPLES points.
    const { thicknessPx, validCount } = measureBandThickness(band, orientation);
    if (validCount < Math.ceil(NUM_SAMPLES * 0.8)) {
      return reject('thickness_consistency', { validCount, required: Math.ceil(NUM_SAMPLES * 0.8), NUM_SAMPLES });
    }

    // Build endpoints
    const mid = (band.start + band.end) / 2;
    if (orientation === 'H') {
      return {
        orientation: 'H',
        startPx: { x: band.avgBldgFirst, y: mid },
        endPx: { x: band.avgBldgLast, y: mid },
        thicknessPx
      };
    } else {
      return {
        orientation: 'V',
        startPx: { x: mid, y: band.avgBldgFirst },
        endPx: { x: mid, y: band.avgBldgLast },
        thicknessPx
      };
    }
  }

  /**
   * Measure distance from a band to the nearest building boundary in the scan direction.
   * Samples cross-positions within the band's extent and finds how far the band edges
   * are from the building mask boundary at each sample. Returns the median.
   * This handles non-rectangular buildings (e.g., L-shapes with notches) correctly.
   */
  function distanceToBuildingBoundary(band, orientation) {
    const numSamples = 5;
    const distances = [];

    for (let i = 0; i < numSamples; i++) {
      const t = (i + 0.5) / numSamples;
      const crossPos = Math.round(band.avgBldgFirst + t * (band.avgBldgLast - band.avgBldgFirst));

      // Scan in the scan direction to find building boundaries at this cross position
      const scanLimit = orientation === 'H' ? h : w;
      let scanFirst = -1, scanLast = -1;
      for (let s = 0; s < scanLimit; s++) {
        const val = orientation === 'H'
          ? buildingMask[s * w + crossPos]    // scan rows at column crossPos
          : buildingMask[crossPos * w + s];   // scan columns at row crossPos
        if (val) {
          if (scanFirst < 0) scanFirst = s;
          scanLast = s;
        }
      }

      if (scanFirst >= 0) {
        const distStart = band.start - scanFirst;
        const distEnd = scanLast - band.end;
        distances.push(Math.min(distStart, distEnd));
      }
    }

    if (distances.length === 0) return Infinity;
    distances.sort((a, b) => a - b);
    return distances[Math.floor(distances.length / 2)];
  }

  /**
   * Measure wall continuity along the cross direction of a band.
   * Returns { maxGap, wallFirst, wallLast }:
   *   maxGap:    largest run of cross-positions with no wall pixels in the band
   *   wallFirst: first cross-position where wall pixels exist in the band
   *   wallLast:  last cross-position where wall pixels exist in the band
   */
  function measureContinuity(band, orientation) {
    const crossStart = Math.round(band.avgBldgFirst);
    const crossEnd = Math.round(band.avgBldgLast);
    let maxGap = 0, currentGap = 0;
    let wallFirst = -1, wallLast = -1;

    for (let c = crossStart; c <= crossEnd; c++) {
      // Check if any row within the band has a wall pixel at this cross position
      let hasWall = false;
      for (let s = band.start; s <= band.end; s++) {
        const idx = orientation === 'H'
          ? s * w + c    // H band: s=row, c=column
          : c * w + s;   // V band: s=column, c=row
        if (wallMask[idx]) { hasWall = true; break; }
      }

      if (hasWall) {
        if (wallFirst < 0) wallFirst = c;
        wallLast = c;
        maxGap = Math.max(maxGap, currentGap);
        currentGap = 0;
      } else {
        currentGap++;
      }
    }
    maxGap = Math.max(maxGap, currentGap);

    return { maxGap, wallFirst, wallLast };
  }

  /**
   * Measure wall thickness at NUM_SAMPLES points along the band using RGBA probing.
   * Returns { thicknessPx: median of valid measurements, validCount: number of
   * positions where a real wall was detected }.
   */
  function measureBandThickness(band, orientation) {
    const bandHeight = band.end - band.start + 1;
    const maxProbe = bandHeight + 10;
    const measurements = [];
    let validCount = 0;

    for (let i = 0; i < NUM_SAMPLES; i++) {
      const t = (i + 0.5) / NUM_SAMPLES;
      const crossPos = Math.round(band.avgBldgFirst + t * (band.avgBldgLast - band.avgBldgFirst));

      // Probe start: just above/left of the band
      const probeStart = band.start - 2;
      let startX, startY, perpX, perpY;
      if (orientation === 'H') {
        startX = crossPos;
        startY = probeStart;
        perpX = 0;
        perpY = 1;
      } else {
        startX = probeStart;
        startY = crossPos;
        perpX = 1;
        perpY = 0;
      }

      const thickness = probeWallThickness(data, startX, startY, perpX, perpY, w, h, maxProbe);
      if (thickness > 0) {
        const thicknessCm = thickness / ppc;
        if (thicknessCm >= minThicknessCm && thicknessCm <= maxThicknessCm) {
          measurements.push(thickness);
          validCount++;
        }
      }
    }

    const thicknessPx = measurements.length === 0
      ? bandHeight
      : (measurements.sort((a, b) => a - b), measurements[Math.floor(measurements.length / 2)]);

    return { thicknessPx, validCount };
  }
}
