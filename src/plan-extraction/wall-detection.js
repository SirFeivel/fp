/**
 * Wall Detection
 * Computer vision algorithms for detecting walls and room boundaries
 */

import {
  cannyEdgeDetection,
  houghLineTransform,
  floodFillRegions,
  traceBoundary,
  calculateCentroid,
  lineLength,
  angleBetween
} from './cv-utils.js';
import { uuid } from '../core.js';

/**
 * Detect walls from preprocessed image
 * @param {Uint8ClampedArray} binaryData - Binary image data (0 or 255)
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @param {Object} options - Detection options
 * @returns {Array} Array of detected wall lines
 */
export function detectWalls(binaryData, width, height, options = {}) {
  const {
    lowThreshold = 50,
    highThreshold = 100,
    houghThreshold = 100,
    minLineLength = 50,
    angleThreshold = 5 // degrees from horizontal/vertical
  } = options;

  // Convert to ImageData format for Canny
  const imageData = new ImageData(width, height);
  for (let i = 0; i < binaryData.length; i++) {
    imageData.data[i * 4] = binaryData[i];
    imageData.data[i * 4 + 1] = binaryData[i];
    imageData.data[i * 4 + 2] = binaryData[i];
    imageData.data[i * 4 + 3] = 255;
  }

  // 1. Canny edge detection
  const edges = cannyEdgeDetection(imageData, {
    lowThreshold,
    highThreshold
  });

  // 2. Hough line transform
  const lines = houghLineTransform(edges, width, height, {
    threshold: houghThreshold,
    minLineLength
  });

  // 3. Filter horizontal/vertical lines (most walls are orthogonal)
  const wallLines = lines.filter(line => {
    const angle = Math.atan2(line.y2 - line.y1, line.x2 - line.x1) * 180 / Math.PI;
    const normalizedAngle = ((angle % 180) + 180) % 180;

    // Check if close to horizontal (0°) or vertical (90°)
    return (
      Math.abs(normalizedAngle) < angleThreshold ||
      Math.abs(normalizedAngle - 90) < angleThreshold ||
      Math.abs(normalizedAngle - 180) < angleThreshold
    );
  });

  // 4. Merge parallel lines (double walls)
  const mergedWalls = mergeParallelLines(wallLines, {
    distanceThreshold: 15,
    angleThreshold: 2
  });

  return mergedWalls;
}

/**
 * Merge parallel lines that are close together
 * @param {Array} lines - Array of lines
 * @param {Object} options - Merging options
 * @returns {Array} Merged lines
 */
function mergeParallelLines(lines, options = {}) {
  const {
    distanceThreshold = 10,
    angleThreshold = 2
  } = options;

  const merged = [];
  const used = new Set();

  for (let i = 0; i < lines.length; i++) {
    if (used.has(i)) continue;

    const line1 = lines[i];
    const group = [line1];
    used.add(i);

    // Find parallel lines
    for (let j = i + 1; j < lines.length; j++) {
      if (used.has(j)) continue;

      const line2 = lines[j];
      const angleDiff = angleBetween(line1, line2);

      if (angleDiff < angleThreshold) {
        // Check distance between lines
        const dist = lineToLineDistance(line1, line2);
        if (dist < distanceThreshold) {
          group.push(line2);
          used.add(j);
        }
      }
    }

    // Average the group
    if (group.length === 1) {
      merged.push(line1);
    } else {
      const avgLine = averageLines(group);
      merged.push(avgLine);
    }
  }

  return merged;
}

/**
 * Calculate distance between two parallel lines
 * @param {Object} line1 - First line
 * @param {Object} line2 - Second line
 * @returns {number} Distance
 */
function lineToLineDistance(line1, line2) {
  // Use midpoint distance as approximation
  const mid1X = (line1.x1 + line1.x2) / 2;
  const mid1Y = (line1.y1 + line1.y2) / 2;
  const mid2X = (line2.x1 + line2.x2) / 2;
  const mid2Y = (line2.y1 + line2.y2) / 2;

  const dx = mid2X - mid1X;
  const dy = mid2Y - mid1Y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Average multiple lines into one
 * @param {Array} lines - Lines to average
 * @returns {Object} Averaged line
 */
function averageLines(lines) {
  let sumX1 = 0, sumY1 = 0, sumX2 = 0, sumY2 = 0, sumVotes = 0;

  for (const line of lines) {
    const weight = line.votes || 1;
    sumX1 += line.x1 * weight;
    sumY1 += line.y1 * weight;
    sumX2 += line.x2 * weight;
    sumY2 += line.y2 * weight;
    sumVotes += weight;
  }

  return {
    x1: sumX1 / sumVotes,
    y1: sumY1 / sumVotes,
    x2: sumX2 / sumVotes,
    y2: sumY2 / sumVotes,
    votes: sumVotes
  };
}

/**
 * Detect room boundaries from walls
 * @param {Array} walls - Detected wall lines
 * @param {Uint8ClampedArray} binaryData - Binary image
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @param {Object} options - Detection options
 * @returns {Array} Array of detected rooms
 */
export function detectRooms(walls, binaryData, width, height, options = {}) {
  const {
    minRoomArea = 500 // minimum room area in pixels
  } = options;

  // Use flood fill to find enclosed regions
  const regions = floodFillRegions(binaryData, width, height, minRoomArea);

  // Convert regions to room objects
  const rooms = regions.map(region => {
    const boundaryVertices = traceBoundary(region);
    const centroid = calculateCentroid(region);

    return {
      id: uuid(),
      boundaryPixels: region.pixels,
      polygonVertices: boundaryVertices,
      centroid,
      area: region.area,
      bbox: region.bbox
    };
  });

  return rooms;
}

/**
 * Create wall grid representation
 * @param {Array} walls - Wall lines
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @returns {Uint8Array} Grid with walls marked
 */
export function createWallGrid(walls, width, height) {
  const grid = new Uint8Array(width * height);

  for (const wall of walls) {
    // Bresenham line drawing
    drawLine(grid, width, height,
      Math.round(wall.x1), Math.round(wall.y1),
      Math.round(wall.x2), Math.round(wall.y2)
    );
  }

  return grid;
}

/**
 * Draw line on grid using Bresenham's algorithm
 * @param {Uint8Array} grid - Grid to draw on
 * @param {number} width - Grid width
 * @param {number} height - Grid height
 * @param {number} x1 - Start x
 * @param {number} y1 - Start y
 * @param {number} x2 - End x
 * @param {number} y2 - End y
 */
function drawLine(grid, width, height, x1, y1, x2, y2) {
  const dx = Math.abs(x2 - x1);
  const dy = Math.abs(y2 - y1);
  const sx = x1 < x2 ? 1 : -1;
  const sy = y1 < y2 ? 1 : -1;
  let err = dx - dy;

  let x = x1;
  let y = y1;

  while (true) {
    if (x >= 0 && x < width && y >= 0 && y < height) {
      grid[y * width + x] = 255;
    }

    if (x === x2 && y === y2) break;

    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
}
