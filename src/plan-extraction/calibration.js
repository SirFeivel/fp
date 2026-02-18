/**
 * Automatic Scale Calibration
 * Calculate pixels-per-cm ratio from dimension annotations
 */

import { parseDimension, bboxDistance } from './ocr.js';
import { lineLength } from './cv-utils.js';

/**
 * Auto-calibrate scale from detected dimensions and walls
 * @param {Array} walls - Detected wall lines
 * @param {Array} dimensionWords - OCR words classified as dimensions
 * @param {Object} options - Calibration options
 * @returns {Object} Calibration result
 */
export function autoCalibrate(walls, dimensionWords, options = {}) {
  const {
    maxDistance = 100, // max pixels between dimension and wall
    minMeasurements = 2, // minimum measurements needed
    maxCV = 0.05 // maximum coefficient of variation (5%)
  } = options;

  const measurements = [];

  // Match dimensions to walls
  for (const word of dimensionWords) {
    if (word.confidence < 60) continue; // Skip low confidence

    const lengthCm = parseDimension(word.text);
    if (!lengthCm || lengthCm < 10 || lengthCm > 2000) continue; // Sanity check

    // Find nearest wall
    const nearestWall = findNearestWall(word.bbox, walls, maxDistance);
    if (!nearestWall) continue;

    const wallLengthPx = lineLength(nearestWall.wall);
    const pixelsPerCm = wallLengthPx / lengthCm;

    // Sanity check (typical range: 0.5 to 20 pixels per cm)
    if (pixelsPerCm < 0.5 || pixelsPerCm > 20) continue;

    measurements.push({
      dimensionText: word.text,
      lengthCm,
      lengthPx: wallLengthPx,
      pixelsPerCm,
      confidence: word.confidence,
      wall: nearestWall.wall,
      distance: nearestWall.distance
    });
  }

  // Check if we have enough measurements
  if (measurements.length < minMeasurements) {
    return {
      success: false,
      error: `Insufficient dimension annotations found. Need at least ${minMeasurements}, found ${measurements.length}.`,
      errorType: 'insufficient_data',
      measurements
    };
  }

  // Calculate weighted average (weight by confidence)
  const avgPixelsPerCm = weightedAverage(
    measurements.map(m => m.pixelsPerCm),
    measurements.map(m => m.confidence)
  );

  // Calculate coefficient of variation
  const cv = coefficientOfVariation(measurements.map(m => m.pixelsPerCm));

  // Check consistency
  if (cv > maxCV) {
    return {
      success: false,
      error: `Inconsistent measurements detected (CV: ${(cv * 100).toFixed(1)}%). This may indicate mixed scales or OCR errors. Manual calibration recommended.`,
      errorType: 'inconsistent_scale',
      measurements,
      cv,
      avgPixelsPerCm
    };
  }

  return {
    success: true,
    pixelsPerCm: avgPixelsPerCm,
    measurements,
    cv,
    confidence: weightedAverage(
      measurements.map(m => m.confidence),
      measurements.map(() => 1)
    )
  };
}

/**
 * Find nearest wall to a bounding box
 * @param {Object} bbox - Text bounding box
 * @param {Array} walls - Wall lines
 * @param {number} maxDistance - Maximum distance threshold
 * @returns {Object|null} Nearest wall and distance
 */
function findNearestWall(bbox, walls, maxDistance) {
  let nearest = null;
  let minDist = Infinity;

  const bboxCenter = {
    x: bbox.centerX,
    y: bbox.centerY
  };

  for (const wall of walls) {
    const dist = pointToLineDistance(bboxCenter, wall);

    if (dist < minDist && dist < maxDistance) {
      minDist = dist;
      nearest = wall;
    }
  }

  if (!nearest) return null;

  return {
    wall: nearest,
    distance: minDist
  };
}

/**
 * Calculate distance from point to line segment
 * @param {Object} point - Point {x, y}
 * @param {Object} line - Line {x1, y1, x2, y2}
 * @returns {number} Distance
 */
function pointToLineDistance(point, line) {
  const { x, y } = point;
  const { x1, y1, x2, y2 } = line;

  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    // Line is a point
    const d1 = x - x1;
    const d2 = y - y1;
    return Math.sqrt(d1 * d1 + d2 * d2);
  }

  // Project point onto line
  let t = ((x - x1) * dx + (y - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t)); // Clamp to segment

  const projX = x1 + t * dx;
  const projY = y1 + t * dy;

  const distX = x - projX;
  const distY = y - projY;
  return Math.sqrt(distX * distX + distY * distY);
}

/**
 * Calculate weighted average
 * @param {Array<number>} values - Values to average
 * @param {Array<number>} weights - Weights for each value
 * @returns {number} Weighted average
 */
export function weightedAverage(values, weights) {
  let sum = 0;
  let weightSum = 0;

  for (let i = 0; i < values.length; i++) {
    sum += values[i] * weights[i];
    weightSum += weights[i];
  }

  return sum / weightSum;
}

/**
 * Calculate coefficient of variation (stddev / mean)
 * @param {Array<number>} values - Values
 * @returns {number} CV (0 to 1)
 */
export function coefficientOfVariation(values) {
  if (values.length === 0) return 0;

  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
  const stddev = Math.sqrt(variance);

  return stddev / mean;
}

/**
 * Convert pixel coordinates to centimeters using calibration
 * @param {number} pixels - Pixel value
 * @param {number} pixelsPerCm - Calibration ratio
 * @returns {number} Centimeters
 */
export function pixelsToCm(pixels, pixelsPerCm) {
  return pixels / pixelsPerCm;
}

/**
 * Convert centimeters to pixels using calibration
 * @param {number} cm - Centimeter value
 * @param {number} pixelsPerCm - Calibration ratio
 * @returns {number} Pixels
 */
export function cmToPixels(cm, pixelsPerCm) {
  return cm * pixelsPerCm;
}
