// src/room-detection-controller.test.js
// Tests for SVG resolution upscaling in the detection controller.
import { describe, it, expect } from 'vitest';
import { getDetectionScaleFactor } from './room-detection-controller.js';

// ---------------------------------------------------------------------------
// getDetectionScaleFactor — pure function, no Canvas needed
// ---------------------------------------------------------------------------
describe('getDetectionScaleFactor', () => {
  it('returns 4 for SVG data URLs', () => {
    const svgDataUrl = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0';
    expect(getDetectionScaleFactor(svgDataUrl)).toBe(4);
  });

  it('returns 4 for SVG data URLs with charset parameter', () => {
    const svgDataUrl = 'data:image/svg+xml;charset=utf-8;base64,PHN2ZyB4bWxucz0i';
    expect(getDetectionScaleFactor(svgDataUrl)).toBe(4);
  });

  it('returns 1 for PNG data URLs', () => {
    const pngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg';
    expect(getDetectionScaleFactor(pngDataUrl)).toBe(1);
  });

  it('returns 1 for JPEG data URLs', () => {
    const jpegDataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ';
    expect(getDetectionScaleFactor(jpegDataUrl)).toBe(1);
  });

  it('returns 1 for null/undefined', () => {
    expect(getDetectionScaleFactor(null)).toBe(1);
    expect(getDetectionScaleFactor(undefined)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Coordinate invariant: upscaling preserves cm results
// ---------------------------------------------------------------------------
describe('coordinate invariant', () => {
  // Simulate imagePxToCm at 1× and 4× to prove the math is transparent
  function imagePxToCm(px, py, ppc, posX, posY) {
    return {
      x: px / ppc + posX,
      y: py / ppc + posY
    };
  }

  it('imagePxToCm(px*4, py*4, ppc*4) === imagePxToCm(px, py, ppc)', () => {
    const ppc = 0.8622;
    const posX = 10, posY = 20;
    const px = 150, py = 300;

    const cm1x = imagePxToCm(px, py, ppc, posX, posY);
    const cm4x = imagePxToCm(px * 4, py * 4, ppc * 4, posX, posY);

    expect(cm4x.x).toBeCloseTo(cm1x.x, 6);
    expect(cm4x.y).toBeCloseTo(cm1x.y, 6);
  });

  it('cmToImagePx → imagePxToCm roundtrip is identity at any scale', () => {
    function cmToImagePx(cmX, cmY, ppc, posX, posY) {
      return {
        x: Math.round((cmX - posX) * ppc),
        y: Math.round((cmY - posY) * ppc)
      };
    }

    const ppc = 0.8622;
    const posX = 10, posY = 20;
    const cmX = 150, cmY = 250;

    // 1× roundtrip
    const img1 = cmToImagePx(cmX, cmY, ppc, posX, posY);
    const rt1 = imagePxToCm(img1.x, img1.y, ppc, posX, posY);

    // 4× roundtrip
    const scale = 4;
    const effPpc = ppc * scale;
    const img4 = cmToImagePx(cmX, cmY, effPpc, posX, posY);
    const rt4 = imagePxToCm(img4.x, img4.y, effPpc, posX, posY);

    // Both roundtrips should be very close to the original cm values
    // (within rounding error of Math.round in cmToImagePx)
    const tolerance = 1 / ppc; // max rounding error at 1× (~1.16 cm)
    expect(Math.abs(rt1.x - cmX)).toBeLessThan(tolerance);
    expect(Math.abs(rt1.y - cmY)).toBeLessThan(tolerance);

    // 4× has 4× less rounding error
    const tolerance4x = 1 / effPpc;
    expect(Math.abs(rt4.x - cmX)).toBeLessThan(tolerance4x);
    expect(Math.abs(rt4.y - cmY)).toBeLessThan(tolerance4x);

    // 4× roundtrip is at least as accurate as 1×
    expect(Math.abs(rt4.x - cmX)).toBeLessThanOrEqual(Math.abs(rt1.x - cmX) + 1e-9);
    expect(Math.abs(rt4.y - cmY)).toBeLessThanOrEqual(Math.abs(rt1.y - cmY) + 1e-9);
  });
});
