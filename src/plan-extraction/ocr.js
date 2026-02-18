/**
 * OCR Text Extraction
 * Tesseract.js wrapper for extracting text from floor plans
 */

import { createWorker } from 'tesseract.js';

// Dimension patterns (metric)
const DIM_PATTERNS = [
  /^(\d+)\.(\d+)([²³⁴⁵⁶⁷⁸⁹⁰]*)$/,       // "3.80" or "2.96⁵"
  /^(\d+),(\d+)([²³⁴⁵⁶⁷⁸⁹⁰]*)$/,        // "3,80" (German decimal)
  /^(\d+)\.(\d+)\s*m$/i,                  // "3.8 m"
  /^(\d+),(\d+)\s*m$/i,                   // "3,8 m"
  /^(\d+)\/(\d+)$/,                       // "12/30" (wall thickness)
];

// Room name patterns (German architectural plans)
const ROOM_PATTERNS = [
  /^[A-ZÄÖÜ][A-ZÄÖÜß\s]{2,}$/,           // All caps: "KELLER", "TROCKENRAUM"
  /raum$/i,                               // Ends with "raum"
  /küche$/i,                              // Kitchen
  /keller$/i,                             // Basement
  /bad$/i,                                // Bathroom
  /wc$/i,                                 // WC
  /flur$/i,                               // Hallway
  /zimmer$/i,                             // Room
  /gang$/i,                               // Corridor
];

// Area measurement pattern
const AREA_PATTERN = /^(\d+\.\d+)\s*m[²2]$/;

/**
 * Extract text from preprocessed image
 * @param {string} imageData - Image data URL or canvas
 * @param {Object} options - OCR options
 * @returns {Promise<Object>} Extracted text with bounding boxes
 */
export async function extractText(imageData, options = {}) {
  const {
    languages = 'deu+eng',
    onProgress = null
  } = options;

  let worker;
  try {
    worker = await createWorker(languages, 1, {
      logger: onProgress ? m => {
        if (m.status === 'recognizing text') {
          onProgress(m.progress);
        }
      } : undefined
    });

    await worker.setParameters({
      tessedit_pageseg_mode: '11', // Sparse text detection
      tessedit_char_whitelist: '0123456789.,²³⁴⁵⁶⁷⁸⁹⁰/ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÜßabcdefghijklmnopqrstuvwxyzäöüm ',
    });

    const { data } = await worker.recognize(imageData);
    await worker.terminate();

    // Process words (check if words exist)
    const rawWords = data.words || [];
    const words = rawWords.map(w => {
      const text = w.text.trim();
      const type = classifyText(text);

      return {
        text,
        type,
        confidence: w.confidence,
        bbox: {
          x: w.bbox.x0,
          y: w.bbox.y0,
          width: w.bbox.x1 - w.bbox.x0,
          height: w.bbox.y1 - w.bbox.y0,
          centerX: (w.bbox.x0 + w.bbox.x1) / 2,
          centerY: (w.bbox.y0 + w.bbox.y1) / 2
        }
      };
    });

    return {
      fullText: data.text || '',
      words,
      dimensions: words.filter(w => w.type === 'dimension'),
      roomNames: words.filter(w => w.type === 'roomName'),
      areas: words.filter(w => w.type === 'area')
    };
  } catch (error) {
    // Ensure worker is terminated even on error
    if (worker) {
      try {
        await worker.terminate();
      } catch (e) {
        console.warn('Failed to terminate OCR worker:', e);
      }
    }
    throw new Error(`OCR failed: ${error.message}`);
  }
}

/**
 * Classify extracted text
 * @param {string} text - Text to classify
 * @returns {string} Type: 'dimension', 'roomName', 'area', or 'unknown'
 */
function classifyText(text) {
  if (DIM_PATTERNS.some(p => p.test(text))) {
    return 'dimension';
  }

  if (AREA_PATTERN.test(text)) {
    return 'area';
  }

  if (ROOM_PATTERNS.some(p => p.test(text))) {
    return 'roomName';
  }

  return 'unknown';
}

/**
 * Parse dimension string to centimeters
 * @param {string} text - Dimension text (e.g., "3.80", "2,96⁵")
 * @returns {number|null} Dimension in centimeters
 */
export function parseDimension(text) {
  // Remove superscripts
  text = text.replace(/[²³⁴⁵⁶⁷⁸⁹⁰]/g, '');

  // Try wall thickness format first (12/30)
  const wallMatch = text.match(/^(\d+)\/(\d+)$/);
  if (wallMatch) {
    return parseInt(wallMatch[1], 10); // Return first value (inner wall)
  }

  // Try standard dimension formats
  for (const pattern of DIM_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const whole = parseInt(match[1], 10);
      const decimal = parseInt(match[2], 10);

      // Handle "3.80" → 380 cm
      if (match[2].length <= 2) {
        return whole * 100 + decimal * (match[2].length === 1 ? 10 : 1);
      }

      // Handle "380" → 380 cm
      return whole * 100 + decimal;
    }
  }

  return null;
}

/**
 * Parse area measurement to square meters
 * @param {string} text - Area text (e.g., "19.26 m²")
 * @returns {number|null} Area in square meters
 */
export function parseArea(text) {
  const match = text.match(AREA_PATTERN);
  if (match) {
    return parseFloat(match[1]);
  }
  return null;
}

/**
 * Calculate bounding box distance
 * @param {Object} bbox1 - First bounding box
 * @param {Object} bbox2 - Second bounding box or point
 * @returns {number} Distance between centers
 */
export function bboxDistance(bbox1, bbox2) {
  const x1 = bbox1.centerX ?? bbox1.x;
  const y1 = bbox1.centerY ?? bbox1.y;
  const x2 = bbox2.centerX ?? bbox2.x;
  const y2 = bbox2.centerY ?? bbox2.y;

  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}
