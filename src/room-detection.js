// src/room-detection.js
// Pure image-processing functions for semi-automatic room detection.
// No DOM, state, or geometry dependencies.

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
    mask[i] = (gray >= lowThresh && gray <= highThresh) ? 1 : 0;
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

  // Find the dominant mid-gray peak (wall fill) in range [30, whiteLevel - 20]
  let maxCount = 0;
  let wallCenter = -1;
  const midLow = 30;
  const midHigh = Math.max(midLow + 1, whiteLevel - 20);
  for (let g = midLow; g < midHigh; g++) {
    if (hist[g] > maxCount) { maxCount = hist[g]; wallCenter = g; }
  }

  // Require the peak to represent at least 0.5% of all pixels
  if (wallCenter < 0 || maxCount < total * 0.005) return null;

  return {
    low:  Math.max(20, wallCenter - 60),
    high: Math.min(whiteLevel - 15, wallCenter + 60)
  };
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
 * - edge: gray < 80, neutral hue (r-g < 40 AND r-b < 40)
 * - fill: gray ∈ [80, 200), neutral hue; also dark pixels with red/pink tint
 * - background: gray >= 200; also mid-gray with red/pink tint
 *
 * @param {number} r - Red channel (0-255)
 * @param {number} g - Green channel (0-255)
 * @param {number} b - Blue channel (0-255)
 * @returns {'edge' | 'fill' | 'background'}
 */
function classifyWallPixel(r, g, b) {
  const gray = 0.299 * r + 0.587 * g + 0.114 * b;
  const isNeutral = (r - g) < 40 && (r - b) < 40;

  if (gray < 80) {
    return isNeutral ? "edge" : "fill";
  }
  if (gray < 200) {
    return isNeutral ? "fill" : "background";
  }
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
 * Detect wall thickness by probing outward from polygon edges using RGBA
 * pixel classification. Returns per-edge measurements and overall median.
 *
 * @param {ImageData} imageData - Raw RGBA image data
 * @param {Array<{x: number, y: number}>} polygonPixels - Detected polygon vertices
 * @param {number} w - Image width
 * @param {number} h - Image height
 * @param {number} pixelsPerCm - Scale factor for px→cm conversion
 * @param {number} [maxProbe=200] - Maximum probe depth in pixels
 * @returns {{ edges: Array<{edgeIndex: number, thicknessPx: number, thicknessCm: number}>, medianPx: number, medianCm: number }}
 */
export function detectWallThickness(imageData, polygonPixels, w, h, pixelsPerCm = 1, maxProbe = 200) {
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

    // Ensure perpendicular points away from centroid (outward)
    const edgeMidX = (A.x + B.x) / 2;
    const edgeMidY = (A.y + B.y) / 2;
    const toCentroidX = cx - edgeMidX;
    const toCentroidY = cy - edgeMidY;
    if (perpX * toCentroidX + perpY * toCentroidY > 0) {
      perpX = -perpX;
      perpY = -perpY;
    }

    // Sample at 3 points along the edge (25%, 50%, 75%)
    const samples = [];
    for (const frac of [0.25, 0.5, 0.75]) {
      const startX = A.x + tx * edgeLen * frac;
      const startY = A.y + ty * edgeLen * frac;
      const thickness = probeWallThickness(data, startX, startY, perpX, perpY, w, h, maxProbe);
      if (thickness >= 2) {
        samples.push(thickness);
      }
    }

    if (samples.length > 0) {
      samples.sort((a, b) => a - b);
      const medIdx = Math.floor(samples.length / 2);
      const thicknessPx = samples.length % 2 === 1
        ? samples[medIdx]
        : (samples[medIdx - 1] + samples[medIdx]) / 2;
      edges.push({
        edgeIndex: i,
        thicknessPx,
        thicknessCm: thicknessPx / pixelsPerCm
      });
    }
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
