/**
 * Computer Vision Utilities
 * Core CV algorithms for floor plan analysis
 */

/**
 * Apply Gaussian blur to image data for noise reduction
 * @param {ImageData} imageData - Canvas ImageData object
 * @param {number} radius - Blur radius (typically 1-3)
 */
export function gaussianBlur(imageData, radius) {
  const { data, width, height } = imageData;
  const kernel = generateGaussianKernel(radius);
  const kernelSize = kernel.length;
  const half = Math.floor(kernelSize / 2);

  const output = new Uint8ClampedArray(data.length);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0;

      for (let ky = 0; ky < kernelSize; ky++) {
        for (let kx = 0; kx < kernelSize; kx++) {
          const px = Math.min(width - 1, Math.max(0, x + kx - half));
          const py = Math.min(height - 1, Math.max(0, y + ky - half));
          const idx = (py * width + px) * 4;
          const weight = kernel[ky][kx];

          r += data[idx] * weight;
          g += data[idx + 1] * weight;
          b += data[idx + 2] * weight;
          a += data[idx + 3] * weight;
        }
      }

      const idx = (y * width + x) * 4;
      output[idx] = r;
      output[idx + 1] = g;
      output[idx + 2] = b;
      output[idx + 3] = a;
    }
  }

  data.set(output);
}

/**
 * Generate Gaussian kernel for convolution
 * @param {number} radius - Kernel radius
 * @returns {number[][]} 2D kernel matrix
 */
function generateGaussianKernel(radius) {
  const size = radius * 2 + 1;
  const sigma = radius / 2;
  const kernel = [];
  let sum = 0;

  for (let y = 0; y < size; y++) {
    kernel[y] = [];
    for (let x = 0; x < size; x++) {
      const dx = x - radius;
      const dy = y - radius;
      const value = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
      kernel[y][x] = value;
      sum += value;
    }
  }

  // Normalize
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      kernel[y][x] /= sum;
    }
  }

  return kernel;
}

/**
 * Sobel edge detection (gradient magnitude)
 * @param {ImageData} imageData - Grayscale image
 * @returns {Uint8ClampedArray} Edge magnitude map
 */
export function sobelEdgeDetection(imageData) {
  const { data, width, height } = imageData;
  const edges = new Uint8ClampedArray(width * height);

  const sobelX = [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]];
  const sobelY = [[-1, -2, -1], [0, 0, 0], [1, 2, 1]];

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let gx = 0, gy = 0;

      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const idx = ((y + ky) * width + (x + kx)) * 4;
          const pixel = data[idx]; // Grayscale value
          gx += pixel * sobelX[ky + 1][kx + 1];
          gy += pixel * sobelY[ky + 1][kx + 1];
        }
      }

      const magnitude = Math.sqrt(gx * gx + gy * gy);
      edges[y * width + x] = Math.min(255, magnitude);
    }
  }

  return edges;
}

/**
 * Canny edge detection
 * @param {ImageData} imageData - Grayscale image
 * @param {Object} options - Detection parameters
 * @returns {Uint8ClampedArray} Binary edge map
 */
export function cannyEdgeDetection(imageData, options = {}) {
  const {
    lowThreshold = 50,
    highThreshold = 100
  } = options;

  const { width, height } = imageData;

  // 1. Apply Gaussian blur
  const blurred = new ImageData(
    new Uint8ClampedArray(imageData.data),
    width,
    height
  );
  gaussianBlur(blurred, 1);

  // 2. Calculate gradients
  const gradients = sobelEdgeDetection(blurred);

  // 3. Non-maximum suppression (simplified)
  const suppressed = new Uint8ClampedArray(width * height);
  for (let i = 0; i < gradients.length; i++) {
    if (gradients[i] > lowThreshold) {
      suppressed[i] = gradients[i];
    }
  }

  // 4. Double threshold and edge tracking (simplified)
  const edges = new Uint8ClampedArray(width * height);
  for (let i = 0; i < suppressed.length; i++) {
    if (suppressed[i] > highThreshold) {
      edges[i] = 255;
    } else if (suppressed[i] > lowThreshold) {
      // Check if connected to strong edge (8-connected)
      const y = Math.floor(i / width);
      const x = i % width;
      let hasStrongNeighbor = false;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            const ni = ny * width + nx;
            if (suppressed[ni] > highThreshold) {
              hasStrongNeighbor = true;
              break;
            }
          }
        }
        if (hasStrongNeighbor) break;
      }

      if (hasStrongNeighbor) {
        edges[i] = 255;
      }
    }
  }

  return edges;
}

/**
 * Hough line transform - detect straight lines
 * @param {Uint8ClampedArray} edges - Binary edge map
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @param {Object} options - Detection parameters
 * @returns {Array} Array of detected lines {x1, y1, x2, y2, votes}
 */
export function houghLineTransform(edges, width, height, options = {}) {
  const {
    threshold = 100,
    minLineLength = 50,
    maxLineGap = 10
  } = options;

  const diagonal = Math.sqrt(width * width + height * height);
  const angleStep = Math.PI / 180; // 1 degree
  const distStep = 1;

  const numAngles = 180;
  const numDists = Math.ceil(diagonal * 2 / distStep);

  // Accumulator array
  const accumulator = Array(numAngles).fill(0).map(() => Array(numDists).fill(0));

  // Vote for lines
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (edges[y * width + x] === 0) continue;

      for (let angleIdx = 0; angleIdx < numAngles; angleIdx++) {
        const angle = angleIdx * angleStep;
        const dist = x * Math.cos(angle) + y * Math.sin(angle);
        const distIdx = Math.floor((dist + diagonal) / distStep);

        if (distIdx >= 0 && distIdx < numDists) {
          accumulator[angleIdx][distIdx]++;
        }
      }
    }
  }

  // Find peaks in accumulator
  const lines = [];
  for (let angleIdx = 0; angleIdx < numAngles; angleIdx++) {
    for (let distIdx = 0; distIdx < numDists; distIdx++) {
      if (accumulator[angleIdx][distIdx] < threshold) continue;

      // Check if local maximum
      let isMax = true;
      for (let da = -1; da <= 1; da++) {
        for (let dd = -1; dd <= 1; dd++) {
          if (da === 0 && dd === 0) continue;
          const na = angleIdx + da;
          const nd = distIdx + dd;
          if (na >= 0 && na < numAngles && nd >= 0 && nd < numDists) {
            if (accumulator[na][nd] > accumulator[angleIdx][distIdx]) {
              isMax = false;
              break;
            }
          }
        }
        if (!isMax) break;
      }

      if (isMax) {
        const angle = angleIdx * angleStep;
        const dist = (distIdx * distStep) - diagonal;

        // Convert polar to Cartesian endpoints
        const line = polarToCartesian(angle, dist, width, height);
        if (line) {
          lines.push({
            ...line,
            votes: accumulator[angleIdx][distIdx],
            angle,
            dist
          });
        }
      }
    }
  }

  return lines;
}

/**
 * Convert polar line to Cartesian endpoints
 * @param {number} angle - Line angle in radians
 * @param {number} dist - Distance from origin
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @returns {Object|null} Line endpoints {x1, y1, x2, y2}
 */
function polarToCartesian(angle, dist, width, height) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  // Find intersections with image bounds
  const points = [];

  // Intersection with x=0
  if (Math.abs(sin) > 0.01) {
    const y = dist / sin;
    if (y >= 0 && y <= height) {
      points.push({ x: 0, y });
    }
  }

  // Intersection with x=width
  if (Math.abs(sin) > 0.01) {
    const y = (dist - width * cos) / sin;
    if (y >= 0 && y <= height) {
      points.push({ x: width, y });
    }
  }

  // Intersection with y=0
  if (Math.abs(cos) > 0.01) {
    const x = dist / cos;
    if (x >= 0 && x <= width) {
      points.push({ x, y: 0 });
    }
  }

  // Intersection with y=height
  if (Math.abs(cos) > 0.01) {
    const x = (dist - height * sin) / cos;
    if (x >= 0 && x <= width) {
      points.push({ x, y: height });
    }
  }

  // Remove duplicates and pick two endpoints
  const unique = [];
  for (const p of points) {
    if (!unique.some(u => Math.abs(u.x - p.x) < 1 && Math.abs(u.y - p.y) < 1)) {
      unique.push(p);
    }
  }

  if (unique.length < 2) return null;

  return {
    x1: unique[0].x,
    y1: unique[0].y,
    x2: unique[1].x,
    y2: unique[1].y
  };
}

/**
 * Flood fill to detect connected regions
 * @param {Uint8ClampedArray} binary - Binary image (0 or 255)
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @param {number} minArea - Minimum region area in pixels
 * @returns {Array} Array of regions {id, pixels, bbox, area}
 */
export function floodFillRegions(binary, width, height, minArea = 100) {
  const visited = new Uint8Array(width * height);
  const regions = [];
  let regionId = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (visited[idx] || binary[idx] !== 0) continue; // Only fill background (0)

      // Start flood fill
      const region = {
        id: regionId++,
        pixels: [],
        bbox: { minX: x, minY: y, maxX: x, maxY: y },
        area: 0
      };

      const queue = [{ x, y }];
      visited[idx] = 1;

      while (queue.length > 0) {
        const { x: cx, y: cy } = queue.shift();
        const cidx = cy * width + cx;
        region.pixels.push({ x: cx, y: cy });
        region.area++;

        // Update bounding box
        region.bbox.minX = Math.min(region.bbox.minX, cx);
        region.bbox.minY = Math.min(region.bbox.minY, cy);
        region.bbox.maxX = Math.max(region.bbox.maxX, cx);
        region.bbox.maxY = Math.max(region.bbox.maxY, cy);

        // Check 4-connected neighbors
        const neighbors = [
          { x: cx - 1, y: cy },
          { x: cx + 1, y: cy },
          { x: cx, y: cy - 1 },
          { x: cx, y: cy + 1 }
        ];

        for (const n of neighbors) {
          if (n.x < 0 || n.x >= width || n.y < 0 || n.y >= height) continue;
          const nidx = n.y * width + n.x;
          if (visited[nidx] || binary[nidx] !== 0) continue;

          visited[nidx] = 1;
          queue.push(n);
        }
      }

      if (region.area >= minArea) {
        regions.push(region);
      }
    }
  }

  return regions;
}

/**
 * Trace boundary of a region to get polygon vertices
 * @param {Object} region - Region from floodFillRegions
 * @returns {Array} Array of {x, y} vertices
 */
export function traceBoundary(region) {
  // Simple approach: use convex hull or boundary tracing
  // For now, return bounding box vertices
  const { bbox } = region;
  return [
    { x: bbox.minX, y: bbox.minY },
    { x: bbox.maxX, y: bbox.minY },
    { x: bbox.maxX, y: bbox.maxY },
    { x: bbox.minX, y: bbox.maxY }
  ];
}

/**
 * Calculate centroid of a region
 * @param {Object} region - Region from floodFillRegions
 * @returns {Object} Centroid {x, y}
 */
export function calculateCentroid(region) {
  let sumX = 0, sumY = 0;
  for (const p of region.pixels) {
    sumX += p.x;
    sumY += p.y;
  }
  return {
    x: sumX / region.pixels.length,
    y: sumY / region.pixels.length
  };
}

/**
 * Calculate distance between two points
 * @param {Object} p1 - Point {x, y}
 * @param {Object} p2 - Point {x, y}
 * @returns {number} Euclidean distance
 */
export function distance(p1, p2) {
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Calculate length of a line
 * @param {Object} line - Line {x1, y1, x2, y2}
 * @returns {number} Line length
 */
export function lineLength(line) {
  const dx = line.x2 - line.x1;
  const dy = line.y2 - line.y1;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Calculate angle between two lines
 * @param {Object} line1 - First line
 * @param {Object} line2 - Second line
 * @returns {number} Angle in degrees
 */
export function angleBetween(line1, line2) {
  const angle1 = Math.atan2(line1.y2 - line1.y1, line1.x2 - line1.x1);
  const angle2 = Math.atan2(line2.y2 - line2.y1, line2.x2 - line2.x1);
  let diff = Math.abs(angle1 - angle2) * 180 / Math.PI;
  if (diff > 180) diff = 360 - diff;
  return diff;
}
