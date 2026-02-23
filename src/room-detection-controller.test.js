// src/room-detection-controller.test.js
// Tests for SVG resolution upscaling and two-pass envelope pipeline.
import { describe, it, expect } from 'vitest';
import { getDetectionScaleFactor } from './room-detection-controller.js';
import { detectEnvelope, preprocessForRoomDetection, detectWallThickness } from './room-detection.js';

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

// ---------------------------------------------------------------------------
// Two-pass envelope pipeline contract tests
// ---------------------------------------------------------------------------
// These tests verify the pipeline contract that detectAndStoreEnvelope relies on:
// Pass 1 (raw) → preprocessing → Pass 2 (improved envelope) → dynamic fallback.
// Direct E2E of detectAndStoreEnvelope requires DOM Canvas (loadImageData),
// unavailable in Node. Tests exercise real detectEnvelope + preprocessing on
// synthetic images to validate the wiring contract.

/** Build a synthetic building image: white background, gray walls forming a rectangle. */
function makeBuildingImage(imgW, imgH, bldgRect, wallThick = 8) {
  const data = new Uint8ClampedArray(imgW * imgH * 4);
  for (let i = 0; i < imgW * imgH; i++) {
    data[i * 4] = 255; data[i * 4 + 1] = 255; data[i * 4 + 2] = 255; data[i * 4 + 3] = 255;
  }
  function setPixel(x, y, gray) {
    if (x < 0 || x >= imgW || y < 0 || y >= imgH) return;
    const idx = (y * imgW + x) * 4;
    data[idx] = gray; data[idx + 1] = gray; data[idx + 2] = gray;
  }
  const { x: bx, y: by, w: bw, h: bh } = bldgRect;
  for (let y = by; y < by + bh; y++) {
    for (let x = bx; x < bx + bw; x++) {
      const inInterior =
        x >= bx + wallThick && x < bx + bw - wallThick &&
        y >= by + wallThick && y < by + bh - wallThick;
      if (inInterior) continue;
      const atOuterEdge = x < bx + 2 || x >= bx + bw - 2 || y < by + 2 || y >= by + bh - 2;
      const atInnerEdge =
        Math.abs(x - (bx + wallThick)) < 2 || Math.abs(x - (bx + bw - wallThick - 1)) < 2 ||
        Math.abs(y - (by + wallThick)) < 2 || Math.abs(y - (by + bh - wallThick - 1)) < 2;
      if (atOuterEdge || atInnerEdge) {
        setPixel(x, y, 30);
      } else {
        setPixel(x, y, 140);
      }
    }
  }
  return { data, width: imgW, height: imgH };
}

function cloneImageData(img) {
  return { data: new Uint8ClampedArray(img.data), width: img.width, height: img.height };
}

function countBuildingPixels(mask) {
  let count = 0;
  for (let i = 0; i < mask.length; i++) count += mask[i];
  return count;
}

describe('two-pass envelope pipeline', () => {
  it('pass 2 with envelopeBboxPx on preprocessed image produces a valid envelope', () => {
    const ppc = 0.5;
    const imageData = makeBuildingImage(400, 300, { x: 50, y: 50, w: 300, h: 200 }, 12);

    // Pass 1
    const result1 = detectEnvelope(imageData, { pixelsPerCm: ppc });
    expect(result1).not.toBeNull();
    expect(result1.polygonPixels.length).toBeGreaterThanOrEqual(3);

    // Preprocess a fresh copy
    const imageData2 = cloneImageData(imageData);
    preprocessForRoomDetection(imageData2, {
      pixelsPerCm: ppc,
      envelopePolygonPx: result1.polygonPixels,
      envelopeWallThicknesses: result1.wallThicknesses,
      spanningWallsPx: [],
    });

    // Pass 2 with envelopeBboxPx
    const bbox = {
      minX: Math.min(...result1.polygonPixels.map(p => p.x)),
      minY: Math.min(...result1.polygonPixels.map(p => p.y)),
      maxX: Math.max(...result1.polygonPixels.map(p => p.x)),
      maxY: Math.max(...result1.polygonPixels.map(p => p.y)),
    };
    const result2 = detectEnvelope(imageData2, { pixelsPerCm: ppc, envelopeBboxPx: bbox });

    expect(result2).not.toBeNull();
    expect(result2.polygonPixels.length).toBeGreaterThanOrEqual(3);
    expect(result2.wallMask).toBeInstanceOf(Uint8Array);
    expect(result2.buildingMask).toBeInstanceOf(Uint8Array);
  });

  it('dynamic fallback: uses pass-1 when pass-2 building area collapses', () => {
    const ppc = 0.5;
    const imageData = makeBuildingImage(400, 300, { x: 50, y: 50, w: 300, h: 200 }, 12);

    const result1 = detectEnvelope(imageData, { pixelsPerCm: ppc });
    expect(result1).not.toBeNull();
    const pass1Area = countBuildingPixels(result1.buildingMask);

    // Simulate a pass-2 result with collapsed building area (<30% of pass-1)
    const fakeResult2 = {
      polygonPixels: result1.polygonPixels.slice(0, 4),
      wallThicknesses: result1.wallThicknesses,
      wallMask: result1.wallMask,
      buildingMask: new Uint8Array(result1.buildingMask.length), // empty = 0 area
    };

    // Apply the same fallback logic as detectAndStoreEnvelope
    let usePass2 = false;
    const pass2Area = countBuildingPixels(fakeResult2.buildingMask);
    const ratio = pass1Area > 0 ? pass2Area / pass1Area : 0;
    if (fakeResult2.polygonPixels.length >= 3 && ratio >= 0.3) {
      usePass2 = true;
    }
    expect(usePass2).toBe(false);
    expect(ratio).toBe(0);
  });

  it('dynamic fallback: uses pass-2 when building area is preserved', () => {
    const ppc = 0.5;
    const imageData = makeBuildingImage(400, 300, { x: 50, y: 50, w: 300, h: 200 }, 12);

    const result1 = detectEnvelope(imageData, { pixelsPerCm: ppc });
    const pass1Area = countBuildingPixels(result1.buildingMask);

    // Simulate pass-2 with identical building area
    const fakeResult2 = {
      polygonPixels: result1.polygonPixels,
      buildingMask: new Uint8Array(result1.buildingMask), // copy = same area
    };

    let usePass2 = false;
    const pass2Area = countBuildingPixels(fakeResult2.buildingMask);
    const ratio = pass1Area > 0 ? pass2Area / pass1Area : 0;
    if (fakeResult2.polygonPixels.length >= 3 && ratio >= 0.3) {
      usePass2 = true;
    }
    expect(usePass2).toBe(true);
    expect(ratio).toBeCloseTo(1.0);
  });

  it('fallback: pass 1 used when pass 2 returns null', () => {
    const ppc = 0.5;
    const imageData = makeBuildingImage(400, 300, { x: 50, y: 50, w: 300, h: 200 }, 12);

    const result1 = detectEnvelope(imageData, { pixelsPerCm: ppc });
    expect(result1).not.toBeNull();

    const result2 = null;
    let usePass2 = false;
    if (result2 && result2.polygonPixels.length >= 3 && result2.buildingMask) {
      usePass2 = true; // would check area ratio here
    }
    const finalResult = usePass2 ? result2 : result1;
    expect(finalResult).toBe(result1);
  });

  it('preprocessing mutates imageData in-place (justifies fresh load)', () => {
    const ppc = 0.5;
    const imageData = makeBuildingImage(400, 300, { x: 50, y: 50, w: 300, h: 200 }, 12);

    const result1 = detectEnvelope(imageData, { pixelsPerCm: ppc });
    const fresh = makeBuildingImage(400, 300, { x: 50, y: 50, w: 300, h: 200 }, 12);
    const before = new Uint8ClampedArray(fresh.data);

    preprocessForRoomDetection(fresh, {
      pixelsPerCm: ppc,
      envelopePolygonPx: result1.polygonPixels,
      envelopeWallThicknesses: result1.wallThicknesses,
      spanningWallsPx: [],
    });

    let changed = 0;
    for (let i = 0; i < fresh.data.length; i++) {
      if (fresh.data[i] !== before[i]) changed++;
    }
    expect(changed).toBeGreaterThan(0);
  });

  it('wall thickness measurement works on preprocessed image', () => {
    const ppc = 0.5;
    const imageData = makeBuildingImage(400, 300, { x: 50, y: 50, w: 300, h: 200 }, 12);

    const result1 = detectEnvelope(imageData, { pixelsPerCm: ppc });
    expect(result1).not.toBeNull();

    const imageData2 = cloneImageData(imageData);
    preprocessForRoomDetection(imageData2, {
      pixelsPerCm: ppc,
      envelopePolygonPx: result1.polygonPixels,
      envelopeWallThicknesses: result1.wallThicknesses,
      spanningWallsPx: [],
    });

    const thicknesses = detectWallThickness(
      imageData2, result1.polygonPixels, imageData2.width, imageData2.height,
      ppc, { probeFromInnerFace: true }
    );
    expect(thicknesses).toBeDefined();
    expect(thicknesses.edges.length).toBeGreaterThan(0);
    expect(thicknesses.medianCm).toBeGreaterThan(0);
  });
});
