/**
 * Floor Plan Extraction
 * Main orchestrator for automatic floor plan extraction
 */

import { preprocessImage } from './preprocessing.js';
import { extractText } from './ocr.js';
import { detectWalls, detectRooms } from './wall-detection.js';
import { autoCalibrate, pixelsToCm } from './calibration.js';
import { assignRoomNames } from './room-naming.js';
import { showValidationUI } from './validation-ui.js';

/**
 * Extract floor plan from uploaded image
 * @param {string} imageDataUrl - Image data URL
 * @param {Object} options - Extraction options
 * @returns {Promise<Object>} Extraction result
 */
export async function extractFloorPlan(imageDataUrl, options = {}) {
  const {
    onProgress = null,
    onError = null
  } = options;

  try {
    // Phase 1: Preprocessing
    updateProgress(onProgress, 'preprocessing', 0.1);
    const preprocessed = await preprocessImage(imageDataUrl, {
      maxDimension: 2000,
      enableDenoising: true,
      enableContrast: true
    });

    // Phase 2: OCR
    updateProgress(onProgress, 'ocr', 0.2);
    const ocrResult = await extractText(preprocessed.processed, {
      languages: 'deu+eng',
      onProgress: (p) => updateProgress(onProgress, 'ocr', 0.2 + p * 0.3)
    });

    // Phase 3: Wall Detection
    updateProgress(onProgress, 'walls', 0.5);
    const walls = detectWalls(
      preprocessed.binaryData,
      preprocessed.width,
      preprocessed.height,
      {
        houghThreshold: 80,
        minLineLength: 40,
        angleThreshold: 5
      }
    );

    if (walls.length === 0) {
      throw new ExtractionError(
        'No walls detected in image. Please ensure the floor plan has clear wall lines.',
        'no_walls_detected'
      );
    }

    // Phase 4: Auto-Calibration
    updateProgress(onProgress, 'calibration', 0.6);
    const calibration = autoCalibrate(walls, ocrResult.dimensions, {
      maxDistance: 100,
      minMeasurements: 2,
      maxCV: 0.05
    });

    if (!calibration.success) {
      // Calibration failed - can still continue with manual calibration later
      console.warn('Auto-calibration failed:', calibration.error);
    }

    // Phase 5: Room Detection
    updateProgress(onProgress, 'rooms', 0.7);
    const rooms = detectRooms(
      walls,
      preprocessed.binaryData,
      preprocessed.width,
      preprocessed.height,
      {
        minRoomArea: 500
      }
    );

    if (rooms.length === 0) {
      throw new ExtractionError(
        'No rooms detected. The image may not contain enclosed spaces or the walls may not be clear enough.',
        'no_rooms_detected'
      );
    }

    // Phase 6: Room Naming
    updateProgress(onProgress, 'naming', 0.8);
    const namedRooms = assignRoomNames(rooms, ocrResult.roomNames, {
      maxDistance: 200,
      minConfidence: 60,
      defaultName: 'Raum'
    });

    // Phase 7: Convert to app format
    updateProgress(onProgress, 'converting', 0.9);
    const convertedRooms = convertRoomsToAppFormat(
      namedRooms,
      calibration.success ? calibration.pixelsPerCm : null
    );

    updateProgress(onProgress, 'complete', 1.0);

    return {
      success: true,
      rooms: convertedRooms,
      calibration,
      walls,
      ocrResult,
      originalImage: imageDataUrl,
      processedImage: preprocessed.processed,
      binaryImage: preprocessed.binary,
      width: preprocessed.width,
      height: preprocessed.height
    };
  } catch (error) {
    if (onError) {
      onError(error);
    }
    throw error;
  }
}

/**
 * Convert detected rooms to app data format
 * @param {Array} rooms - Detected rooms with names
 * @param {number|null} pixelsPerCm - Calibration ratio (null if failed)
 * @returns {Array} Rooms in app format
 */
function convertRoomsToAppFormat(rooms, pixelsPerCm) {
  return rooms.map(room => {
    // Calculate dimensions from bounding box
    const width = room.bbox.maxX - room.bbox.minX;
    const height = room.bbox.maxY - room.bbox.minY;

    // Convert to cm if calibrated
    const widthCm = pixelsPerCm ? pixelsToCm(width, pixelsPerCm) : width;
    const heightCm = pixelsPerCm ? pixelsToCm(height, pixelsPerCm) : height;

    // Calculate position (top-left of bbox)
    const x = room.bbox.minX;
    const y = room.bbox.minY;
    const xCm = pixelsPerCm ? pixelsToCm(x, pixelsPerCm) : x;
    const yCm = pixelsPerCm ? pixelsToCm(y, pixelsPerCm) : y;

    return {
      id: room.id,
      name: room.name,
      nameConfidence: room.nameConfidence,
      widthCm,
      heightCm,
      positionX: xCm,
      positionY: yCm,
      polygonVertices: room.polygonVertices,
      centroid: room.centroid,
      area: room.area,
      bbox: room.bbox
    };
  });
}

/**
 * Update progress callback
 * @param {Function|null} onProgress - Progress callback
 * @param {string} phase - Current phase
 * @param {number} progress - Progress (0-1)
 */
function updateProgress(onProgress, phase, progress) {
  if (onProgress) {
    onProgress({ phase, progress });
  }
}

/**
 * Show extraction validation UI
 * @param {Object} extractionResult - Result from extractFloorPlan
 * @returns {Promise<Object>} Validated extraction result
 */
export function showExtractionValidation(extractionResult) {
  return new Promise((resolve, reject) => {
    showValidationUI(
      extractionResult,
      (validatedResult) => resolve(validatedResult),
      () => reject(new Error('Extraction cancelled by user'))
    );
  });
}

/**
 * Custom error class for extraction errors
 */
export class ExtractionError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ExtractionError';
    this.code = code;
  }
}

/**
 * Check if browser supports extraction features
 * @returns {Object} Support status
 */
export function checkBrowserSupport() {
  const hasCanvas = typeof document !== 'undefined' &&
    typeof document.createElement('canvas').getContext === 'function';

  const hasWorker = typeof Worker !== 'undefined';

  const hasWasm = typeof WebAssembly !== 'undefined';

  return {
    supported: hasCanvas && hasWorker && hasWasm,
    canvas: hasCanvas,
    worker: hasWorker,
    wasm: hasWasm
  };
}
