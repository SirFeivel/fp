/**
 * Floor Plan Extraction Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { parseDimension, parseArea, bboxDistance } from './plan-extraction/ocr.js';
import { weightedAverage, coefficientOfVariation } from './plan-extraction/calibration.js';
import { grayscale, contrastEnhancement } from './plan-extraction/preprocessing.js';

describe('OCR Pattern Matching', () => {
  describe('parseDimension', () => {
    it('parses standard metric dimensions', () => {
      expect(parseDimension('3.80')).toBe(380);
      expect(parseDimension('2.96')).toBe(296);
      expect(parseDimension('12.50')).toBe(1250);
    });

    it('parses German decimal format', () => {
      expect(parseDimension('3,80')).toBe(380);
      expect(parseDimension('2,96')).toBe(296);
    });

    it('parses dimensions with superscripts', () => {
      expect(parseDimension('2.96⁵')).toBe(296);
      expect(parseDimension('3.80²')).toBe(380);
    });

    it('parses wall thickness format', () => {
      expect(parseDimension('12/30')).toBe(12); // Returns first value
      expect(parseDimension('10/25')).toBe(10);
    });

    it('returns null for invalid input', () => {
      expect(parseDimension('KELLER')).toBeNull();
      expect(parseDimension('')).toBeNull();
      expect(parseDimension('abc')).toBeNull();
    });

    it('rejects unrealistic values', () => {
      expect(parseDimension('1')).toBeNull(); // Too small (<10cm)
      expect(parseDimension('5000')).toBeNull(); // Too large (>2000cm)
    });
  });

  describe('parseArea', () => {
    it('parses area measurements', () => {
      expect(parseArea('19.26 m²')).toBe(19.26);
      expect(parseArea('16.11 m²')).toBe(16.11);
      expect(parseArea('5.50 m2')).toBe(5.50);
    });

    it('returns null for invalid input', () => {
      expect(parseArea('KELLER')).toBeNull();
      expect(parseArea('3.80')).toBeNull();
    });
  });

  describe('bboxDistance', () => {
    it('calculates distance between bounding boxes', () => {
      const bbox1 = { centerX: 0, centerY: 0 };
      const bbox2 = { centerX: 3, centerY: 4 };
      expect(bboxDistance(bbox1, bbox2)).toBe(5); // 3-4-5 triangle
    });

    it('handles point-to-bbox distance', () => {
      const bbox = { centerX: 10, centerY: 10 };
      const point = { x: 10, y: 13 };
      expect(bboxDistance(bbox, point)).toBe(3);
    });
  });
});

describe('Calibration Math', () => {
  describe('weightedAverage', () => {
    it('calculates weighted average correctly', () => {
      const values = [10, 20, 30];
      const weights = [1, 2, 1];
      // (10*1 + 20*2 + 30*1) / (1+2+1) = 80/4 = 20
      expect(weightedAverage(values, weights)).toBe(20);
    });

    it('handles equal weights', () => {
      const values = [10, 20, 30];
      const weights = [1, 1, 1];
      expect(weightedAverage(values, weights)).toBe(20);
    });
  });

  describe('coefficientOfVariation', () => {
    it('returns 0 for identical values', () => {
      expect(coefficientOfVariation([10, 10, 10])).toBe(0);
    });

    it('calculates CV for varying values', () => {
      const values = [10, 12, 14];
      const mean = 12;
      const variance = ((10-12)**2 + (12-12)**2 + (14-12)**2) / 3; // 8/3
      const stddev = Math.sqrt(variance); // ~1.633
      const cv = stddev / mean; // ~0.136
      expect(coefficientOfVariation(values)).toBeCloseTo(0.136, 2);
    });

    it('returns 0 for empty array', () => {
      expect(coefficientOfVariation([])).toBe(0);
    });
  });
});

describe('Image Preprocessing', () => {
  describe('grayscale', () => {
    it('converts RGB to grayscale using luminance formula', () => {
      // Create minimal ImageData-like object
      const imageData = {
        data: new Uint8ClampedArray([
          255, 0, 0, 255,    // Red pixel
          0, 255, 0, 255,    // Green pixel
          0, 0, 255, 255     // Blue pixel
        ])
      };

      grayscale(imageData);

      // Red: 0.299*255 = 76.245 ≈ 76
      expect(imageData.data[0]).toBeCloseTo(76, 0);
      expect(imageData.data[1]).toBe(imageData.data[0]);
      expect(imageData.data[2]).toBe(imageData.data[0]);

      // Green: 0.587*255 = 149.685 ≈ 150
      expect(imageData.data[4]).toBeCloseTo(150, 0);
      expect(imageData.data[5]).toBe(imageData.data[4]);
      expect(imageData.data[6]).toBe(imageData.data[4]);

      // Blue: 0.114*255 = 29.07 ≈ 29
      expect(imageData.data[8]).toBeCloseTo(29, 0);
      expect(imageData.data[9]).toBe(imageData.data[8]);
      expect(imageData.data[10]).toBe(imageData.data[8]);

      // Alpha channels unchanged
      expect(imageData.data[3]).toBe(255);
      expect(imageData.data[7]).toBe(255);
      expect(imageData.data[11]).toBe(255);
    });
  });

  describe('contrastEnhancement', () => {
    it('applies histogram equalization', () => {
      const imageData = {
        data: new Uint8ClampedArray([
          50, 50, 50, 255,
          100, 100, 100, 255,
          150, 150, 150, 255,
          200, 200, 200, 255
        ])
      };

      contrastEnhancement(imageData);

      // After equalization, values should be more spread out
      // The exact values depend on the histogram, but they should differ more
      const values = [
        imageData.data[0],
        imageData.data[4],
        imageData.data[8],
        imageData.data[12]
      ];

      // Check that values are still in order
      expect(values[0]).toBeLessThan(values[1]);
      expect(values[1]).toBeLessThan(values[2]);
      expect(values[2]).toBeLessThan(values[3]);

      // Check RGB channels match (grayscale)
      expect(imageData.data[0]).toBe(imageData.data[1]);
      expect(imageData.data[1]).toBe(imageData.data[2]);
    });
  });
});

describe('Integration Tests', () => {
  describe('Extraction Pipeline', () => {
    it.todo('extracts rooms from clean CAD drawing', async () => {
      // TODO: Load test image, run extraction, verify results
      // const result = await extractFloorPlan(testImageDataUrl);
      // expect(result.success).toBe(true);
      // expect(result.rooms.length).toBeGreaterThan(0);
    });

    it.todo('handles scanned blueprint with noise', async () => {
      // TODO: Test preprocessing improves OCR on noisy image
    });

    it.todo('auto-calibrates scale from dimension annotations', async () => {
      // TODO: Test calibration accuracy
    });

    it.todo('matches room names spatially', async () => {
      // TODO: Test room naming accuracy
    });

    it.todo('handles missing dimension annotations gracefully', async () => {
      // TODO: Test fallback when auto-calibration fails
    });
  });
});
