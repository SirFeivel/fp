/**
 * Image Preprocessing Pipeline
 * Prepares uploaded images for OCR and wall detection
 */

import { gaussianBlur } from './cv-utils.js';

/**
 * Load image from data URL
 * @param {string} dataUrl - Image data URL
 * @returns {Promise<HTMLImageElement>}
 */
function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

/**
 * Convert image to grayscale
 * @param {ImageData} imageData - Canvas ImageData
 */
export function grayscale(imageData) {
  const { data } = imageData;
  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    data[i] = gray;
    data[i + 1] = gray;
    data[i + 2] = gray;
    // Alpha unchanged
  }
}

/**
 * Enhance contrast using histogram equalization
 * @param {ImageData} imageData - Canvas ImageData
 */
export function contrastEnhancement(imageData) {
  const { data } = imageData;
  const histogram = new Array(256).fill(0);

  // Build histogram
  for (let i = 0; i < data.length; i += 4) {
    histogram[data[i]]++;
  }

  // Calculate cumulative distribution
  const cdf = new Array(256);
  cdf[0] = histogram[0];
  for (let i = 1; i < 256; i++) {
    cdf[i] = cdf[i - 1] + histogram[i];
  }

  // Normalize CDF
  const totalPixels = data.length / 4;
  const cdfMin = cdf.find(v => v > 0) || 0;
  const equalization = new Array(256);

  for (let i = 0; i < 256; i++) {
    equalization[i] = Math.round(((cdf[i] - cdfMin) / (totalPixels - cdfMin)) * 255);
  }

  // Apply equalization
  for (let i = 0; i < data.length; i += 4) {
    const eq = equalization[data[i]];
    data[i] = eq;
    data[i + 1] = eq;
    data[i + 2] = eq;
  }
}

/**
 * Apply adaptive thresholding (Otsu's method)
 * @param {ImageData} imageData - Canvas ImageData
 * @returns {number} Calculated threshold value
 */
export function adaptiveThreshold(imageData) {
  const { data } = imageData;
  const histogram = new Array(256).fill(0);

  // Build histogram
  for (let i = 0; i < data.length; i += 4) {
    histogram[data[i]]++;
  }

  const totalPixels = data.length / 4;

  // Otsu's method - find optimal threshold
  let sum = 0;
  for (let i = 0; i < 256; i++) {
    sum += i * histogram[i];
  }

  let sumB = 0;
  let weightB = 0;
  let maxVariance = 0;
  let threshold = 0;

  for (let t = 0; t < 256; t++) {
    weightB += histogram[t];
    if (weightB === 0) continue;

    const weightF = totalPixels - weightB;
    if (weightF === 0) break;

    sumB += t * histogram[t];
    const meanB = sumB / weightB;
    const meanF = (sum - sumB) / weightF;

    const variance = weightB * weightF * (meanB - meanF) * (meanB - meanF);

    if (variance > maxVariance) {
      maxVariance = variance;
      threshold = t;
    }
  }

  // Apply threshold
  for (let i = 0; i < data.length; i += 4) {
    const value = data[i] > threshold ? 255 : 0;
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
  }

  return threshold;
}

/**
 * Preprocess image for OCR and wall detection
 * @param {string} dataUrl - Image data URL
 * @param {Object} options - Processing options
 * @returns {Promise<Object>} Preprocessed image data
 */
export async function preprocessImage(dataUrl, options = {}) {
  const {
    maxDimension = 2000,
    enableDenoising = true,
    enableContrast = true
  } = options;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  // Load image
  const img = await loadImage(dataUrl);

  // Downscale if needed
  let width = img.width;
  let height = img.height;

  if (Math.max(width, height) > maxDimension) {
    const scale = maxDimension / Math.max(width, height);
    width = Math.floor(width * scale);
    height = Math.floor(height * scale);
  }

  canvas.width = width;
  canvas.height = height;
  ctx.drawImage(img, 0, 0, width, height);

  // Get pixel data
  const imageData = ctx.getImageData(0, 0, width, height);

  // Apply preprocessing pipeline
  grayscale(imageData);

  if (enableContrast) {
    contrastEnhancement(imageData);
  }

  if (enableDenoising) {
    gaussianBlur(imageData, 1);
  }

  // Put processed data back
  ctx.putImageData(imageData, 0, 0);
  const processedUrl = canvas.toDataURL();

  // Also create binary version for wall detection
  const binaryData = ctx.getImageData(0, 0, width, height);
  const threshold = adaptiveThreshold(binaryData);
  ctx.putImageData(binaryData, 0, 0);
  const binaryUrl = canvas.toDataURL();

  return {
    original: dataUrl,
    processed: processedUrl,
    binary: binaryUrl,
    binaryData: new Uint8ClampedArray(binaryData.data.filter((_, i) => i % 4 === 0)),
    width,
    height,
    threshold
  };
}
