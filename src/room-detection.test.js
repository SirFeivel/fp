// src/room-detection.test.js
import { describe, it, expect } from 'vitest';
import {
  imageToBinaryMask,
  buildGrayWallMask,
  autoDetectWallRange,
  morphologicalClose,
  floodFill,
  traceContour,
  douglasPeucker,
  detectDoorGaps,
  detectRoomAtPixel
} from './room-detection.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a synthetic ImageData-like object from a flat grayscale array. */
function makeImageData(grayPixels, width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const v = grayPixels[i];
    data[i * 4]     = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  return { data, width, height };
}

/** Create a solid-color rectangle image. */
function makeRect(w, h, bgValue, rects) {
  const gray = new Uint8Array(w * h).fill(bgValue);
  for (const { x, y, rw, rh, v } of (rects || [])) {
    for (let dy = 0; dy < rh; dy++) {
      for (let dx = 0; dx < rw; dx++) {
        const px = x + dx, py = y + dy;
        if (px >= 0 && px < w && py >= 0 && py < h) {
          gray[py * w + px] = v;
        }
      }
    }
  }
  return makeImageData(gray, w, h);
}

// ---------------------------------------------------------------------------
// imageToBinaryMask
// ---------------------------------------------------------------------------
describe('imageToBinaryMask', () => {
  it('marks dark pixels as wall (1) and light pixels as open (0)', () => {
    const w = 4, h = 1;
    // Pixels: black(0), dark-gray(64), light-gray(200), white(255)
    // Use values well away from the threshold to avoid floating-point boundary issues.
    const gray = [0, 64, 200, 255];
    const imageData = makeImageData(gray, w, h);
    const mask = imageToBinaryMask(imageData, 128);
    // threshold=128: gray < 128 → wall(1)
    expect(mask[0]).toBe(1); // 0 < 128 → wall ✓
    expect(mask[1]).toBe(1); // 64 < 128 → wall ✓
    expect(mask[2]).toBe(0); // 200 ≥ 128 → open ✓
    expect(mask[3]).toBe(0); // 255 ≥ 128 → open ✓
  });

  it('returns a Uint8Array of length width*height', () => {
    const imageData = makeImageData(new Uint8Array(10 * 10), 10, 10);
    const mask = imageToBinaryMask(imageData, 128);
    expect(mask).toBeInstanceOf(Uint8Array);
    expect(mask.length).toBe(100);
  });

  it('correctly applies RGB→grayscale weighting', () => {
    // Pure red pixel: grayscale = 0.299 * 255 ≈ 76.2 → wall if threshold > 76
    const data = new Uint8ClampedArray(4);
    data[0] = 255; data[1] = 0; data[2] = 0; data[3] = 255;
    const imageData = { data, width: 1, height: 1 };
    expect(imageToBinaryMask(imageData, 100)[0]).toBe(1); // 76 < 100 → wall
    expect(imageToBinaryMask(imageData, 50)[0]).toBe(0);  // 76 ≥ 50 → open? No, 76 >= 50 so not < 50 → open
  });
});

// ---------------------------------------------------------------------------
// morphologicalClose
// ---------------------------------------------------------------------------
describe('morphologicalClose', () => {
  it('seals a narrow gap in a wall', () => {
    // 20×20 mask: horizontal wall at y=10 with a 3-pixel gap at x=8,9,10
    const w = 20, h = 20;
    const mask = new Uint8Array(w * h);
    // Draw horizontal wall at y=10
    for (let x = 0; x < w; x++) mask[10 * w + x] = 1;
    // Open the gap (3 pixels)
    mask[10 * w + 8] = 0;
    mask[10 * w + 9] = 0;
    mask[10 * w + 10] = 0;

    // Before close: gap pixels are open
    expect(mask[10 * w + 9]).toBe(0);

    const closed = morphologicalClose(mask, w, h, 4);

    // After close with radius 4: gap should be sealed (1)
    expect(closed[10 * w + 8]).toBe(1);
    expect(closed[10 * w + 9]).toBe(1);
    expect(closed[10 * w + 10]).toBe(1);
  });

  it('preserves solid wall pixels', () => {
    const w = 10, h = 10;
    const mask = new Uint8Array(w * h).fill(0);
    // Solid block of walls in the center
    for (let y = 3; y <= 6; y++)
      for (let x = 3; x <= 6; x++)
        mask[y * w + x] = 1;

    const closed = morphologicalClose(mask, w, h, 1);
    // Center pixels should remain 1
    expect(closed[4 * w + 4]).toBe(1);
    expect(closed[5 * w + 5]).toBe(1);
  });

  it('returns Uint8Array of same size', () => {
    const w = 8, h = 8;
    const mask = new Uint8Array(w * h);
    const result = morphologicalClose(mask, w, h, 2);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(w * h);
  });
});

// ---------------------------------------------------------------------------
// floodFill
// ---------------------------------------------------------------------------
describe('floodFill', () => {
  it('fills the interior of a simple room outline', () => {
    // 10×10 room: wall border = 1, interior = 0
    const w = 10, h = 10;
    const mask = new Uint8Array(w * h);
    // Draw border
    for (let x = 0; x < w; x++) { mask[0 * w + x] = 1; mask[(h-1)*w+x] = 1; }
    for (let y = 0; y < h; y++) { mask[y * w + 0] = 1; mask[y * w + w-1] = 1; }
    // Interior is 8×8 = 64 pixels
    const { filledMask, pixelCount } = floodFill(mask, w, h, 5, 5, 1000);
    expect(pixelCount).toBe(64);
    // Verify border pixels not filled
    expect(filledMask[0]).toBe(0);
    expect(filledMask[w - 1]).toBe(0);
    // Verify interior filled
    expect(filledMask[5 * w + 5]).toBe(1);
  });

  it('returns pixelCount=0 when seed is on a wall', () => {
    const w = 5, h = 5;
    const mask = new Uint8Array(w * h).fill(1); // All walls
    const { pixelCount } = floodFill(mask, w, h, 2, 2, 100);
    expect(pixelCount).toBe(0);
  });

  it('aborts when pixelCount exceeds maxPixels', () => {
    // 20×20 all-open: 400 pixels. Limit to 10.
    const w = 20, h = 20;
    const mask = new Uint8Array(w * h); // All open (0)
    const { pixelCount } = floodFill(mask, w, h, 10, 10, 10);
    expect(pixelCount).toBeGreaterThan(10);
  });

  it('returns empty filledMask for out-of-bounds seed', () => {
    const w = 5, h = 5;
    const mask = new Uint8Array(w * h);
    const { filledMask, pixelCount } = floodFill(mask, w, h, -1, 2, 100);
    expect(pixelCount).toBe(0);
    expect(filledMask.every(v => v === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// douglasPeucker
// ---------------------------------------------------------------------------
describe('douglasPeucker', () => {
  it('simplifies an axis-aligned staircase to its corners', () => {
    // Axis-aligned staircase going right then down then right then down etc.
    // A true RDP should collapse collinear segments.
    // Points on a straight horizontal line → should collapse to 2 points.
    const line = [
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 },
      { x: 3, y: 0 }, { x: 4, y: 0 }
    ];
    const result = douglasPeucker(line, 0.5);
    // All collinear → should reduce to just start and end
    expect(result.length).toBe(2);
    expect(result[0]).toEqual({ x: 0, y: 0 });
    expect(result[result.length - 1]).toEqual({ x: 4, y: 0 });
  });

  it('preserves corners with large perpendicular distances', () => {
    // Right angle: (0,0) → (5,0) → (5,5)
    const corner = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }];
    const result = douglasPeucker(corner, 0.5);
    // Corner point (5,0) has large perpendicular distance → preserved
    expect(result.length).toBe(3);
  });

  it('returns original points when fewer than 3', () => {
    const pts = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    const result = douglasPeucker(pts, 1.0);
    expect(result.length).toBe(2);
  });

  it('collapses a rectangular staircase to its 4 corners', () => {
    // Staircase around a rectangle: many intermediate points, but 4 real corners
    const pts = [
      { x: 0, y: 0 },
      { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }, { x: 4, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 1 }, { x: 5, y: 2 }, { x: 5, y: 3 }, { x: 5, y: 4 },
      { x: 5, y: 5 },
      { x: 4, y: 5 }, { x: 3, y: 5 }, { x: 2, y: 5 }, { x: 1, y: 5 },
      { x: 0, y: 5 }
    ];
    const result = douglasPeucker(pts, 0.1);
    // Should keep the 4 corners: (0,0), (5,0), (5,5), (0,5)
    expect(result.length).toBeLessThanOrEqual(6);
    expect(result[0]).toEqual({ x: 0, y: 0 });
    expect(result[result.length - 1]).toEqual({ x: 0, y: 5 });
  });
});

// ---------------------------------------------------------------------------
// detectDoorGaps
// ---------------------------------------------------------------------------
describe('detectDoorGaps', () => {
  it('returns midpoint of a known gap', () => {
    const w = 20, h = 10;
    // originalMask: horizontal wall at y=5 with a 4-px gap at x=8..11
    const originalMask = new Uint8Array(w * h);
    for (let x = 0; x < w; x++) originalMask[5 * w + x] = 1;
    // Gap: x=8..11 are open (0)
    originalMask[5 * w + 8] = 0;
    originalMask[5 * w + 9] = 0;
    originalMask[5 * w + 10] = 0;
    originalMask[5 * w + 11] = 0;

    // closedMask: same wall but gap is sealed (all 1s at y=5)
    const closedMask = new Uint8Array(originalMask);
    closedMask[5 * w + 8] = 1;
    closedMask[5 * w + 9] = 1;
    closedMask[5 * w + 10] = 1;
    closedMask[5 * w + 11] = 1;

    // roomMask: interior below the wall (y=6..9)
    const roomMask = new Uint8Array(w * h);
    for (let y = 6; y < h; y++)
      for (let x = 0; x < w; x++)
        roomMask[y * w + x] = 1;

    const gaps = detectDoorGaps(originalMask, closedMask, roomMask, w, h);
    expect(gaps.length).toBe(1);
    // Midpoint of gap pixels x=8..11, y=5: x_mid = 9 or 10, y_mid = 5
    expect(gaps[0].midpointPx.y).toBe(5);
    expect(gaps[0].midpointPx.x).toBeGreaterThanOrEqual(8);
    expect(gaps[0].midpointPx.x).toBeLessThanOrEqual(11);
  });

  it('returns empty array when no gaps', () => {
    const w = 5, h = 5;
    const mask = new Uint8Array(w * h).fill(1); // All wall
    const gaps = detectDoorGaps(mask, mask, mask, w, h);
    expect(gaps).toEqual([]);
  });

  it('returns two entries for two separate gaps', () => {
    const w = 30, h = 5;
    // Wall at y=2 with gaps at x=5..6 and x=20..21
    const originalMask = new Uint8Array(w * h);
    for (let x = 0; x < w; x++) originalMask[2 * w + x] = 1;
    originalMask[2 * w + 5] = 0;
    originalMask[2 * w + 6] = 0;
    originalMask[2 * w + 20] = 0;
    originalMask[2 * w + 21] = 0;

    const closedMask = new Uint8Array(originalMask);
    closedMask[2 * w + 5] = 1;
    closedMask[2 * w + 6] = 1;
    closedMask[2 * w + 20] = 1;
    closedMask[2 * w + 21] = 1;

    const roomMask = new Uint8Array(w * h);
    const gaps = detectDoorGaps(originalMask, closedMask, roomMask, w, h);
    expect(gaps.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// detectRoomAtPixel (end-to-end)
// ---------------------------------------------------------------------------
describe('detectRoomAtPixel', () => {
  /**
   * Create a synthetic room image:
   * - 80×80 pixels, all white (255) = open space (0 in binary mask)
   * - Black (0) wall ring: 3px thick at outer boundary of interior rect (5,5)–(75,75)
   * - White room interior: (8,8)–(72,72) ≈ 64×64 pixels
   * - 5-pixel door gap in the top wall at x=37..41 (white instead of black)
   *
   * Use pixelsPerCm=0.05 so radius=4 (small enough to not fill the whole image).
   * maxPixels = 10_000_000 * 0.05² = 25_000 > room area (~4096) → fill stays bounded.
   */
  const OPT = { pixelsPerCm: 0.05, maxAreaCm2: 10_000_000 };

  function makeRoomImage() {
    const w = 80, h = 80;
    const gray = new Uint8Array(w * h).fill(255); // White = open

    // Draw 3px-thick black wall ring between (5,5) and (75,75)
    const wallT = 5, wallB = 75, wallL = 5, wallR = 75, wallThick = 3;
    for (let y = wallT; y <= wallB; y++) {
      for (let x = wallL; x <= wallR; x++) {
        const onBorder =
          y < wallT + wallThick ||
          y > wallB - wallThick ||
          x < wallL + wallThick ||
          x > wallR - wallThick;
        if (onBorder) gray[y * w + x] = 0; // Black wall pixel
      }
    }

    // Cut a 5-pixel door gap in the top wall at x=37..41
    for (let x = 37; x <= 41; x++) {
      for (let y = wallT; y < wallT + wallThick; y++) {
        gray[y * w + x] = 255; // Restore to white (gap)
      }
    }

    return makeImageData(gray, w, h);
  }

  it('returns a result when clicking inside the room', () => {
    const imageData = makeRoomImage();
    // Seed at interior center (40, 40) — inside the room
    const result = detectRoomAtPixel(imageData, 40, 40, OPT);
    expect(result).not.toBeNull();
    expect(result.polygonPixels.length).toBeGreaterThanOrEqual(3);
    expect(result.pixelsPerCm).toBe(OPT.pixelsPerCm);
  });

  it('polygon covers the expected room area', () => {
    const imageData = makeRoomImage();
    const result = detectRoomAtPixel(imageData, 40, 40, OPT);
    expect(result).not.toBeNull();

    // Bounding box of the polygon should be within the room walls (5..75)
    const xs = result.polygonPixels.map(p => p.x);
    const ys = result.polygonPixels.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);

    expect(minX).toBeGreaterThanOrEqual(4);
    expect(maxX).toBeLessThanOrEqual(76);
    expect(minY).toBeGreaterThanOrEqual(4);
    expect(maxY).toBeLessThanOrEqual(76);
  });

  it('detects the door gap', () => {
    const imageData = makeRoomImage();
    const result = detectRoomAtPixel(imageData, 40, 40, OPT);
    expect(result).not.toBeNull();
    // Should detect at least one door gap (the 5-pixel gap at the top wall)
    expect(result.doorGapsPx.length).toBeGreaterThanOrEqual(1);
    // Gap centroid should be near x=39, y=5..7
    const gap = result.doorGapsPx[0];
    expect(gap.midpointPx.x).toBeGreaterThanOrEqual(35);
    expect(gap.midpointPx.x).toBeLessThanOrEqual(45);
  });

  it('returns null when seed is on a wall pixel', () => {
    const imageData = makeRoomImage();
    // Seed on the wall (black pixel at 5,5)
    const result = detectRoomAtPixel(imageData, 5, 5, OPT);
    // Wall pixel → seed is on wall (1) → floodFill returns 0 → no valid result
    expect(result).toBeNull();
  });

  it('returns null when maxAreaCm2 is too small for the room', () => {
    const imageData = makeRoomImage();
    // Room interior ~64×64=4096 px². maxAreaCm2=1 → maxPixels=1*0.05²=0.0025 → rounds to 0, min=1.
    const result = detectRoomAtPixel(imageData, 40, 40, { pixelsPerCm: 0.05, maxAreaCm2: 1 });
    expect(result).toBeNull();
  });

  it('detects a gray-walled room (white interior, gray-160 fill, black edges)', () => {
    // Simulates the reference floor plan colour structure:
    // - Background: white (255)
    // - Wall body fill: gray 160 (5px thick outer ring)
    // - Wall edge lines: black 0 (2px inner border inside the gray fill)
    // - Door gap: 5-pixel opening in the top wall at x=37..41
    const w = 80, h = 80;
    const gray = new Uint8Array(w * h).fill(255); // white = open

    // 5px gray-160 wall fill ring between (5,5) and (75,75)
    for (let y = 5; y <= 75; y++) {
      for (let x = 5; x <= 75; x++) {
        const onGrayWall =
          y < 10 || y > 70 || x < 10 || x > 70;
        if (onGrayWall) gray[y * w + x] = 160;
      }
    }

    // 2px black inner edge at the interior boundary of the gray fill
    for (let y = 8; y <= 72; y++) {
      for (let x = 8; x <= 72; x++) {
        const onBlackEdge =
          (y === 8 || y === 9 || y === 71 || y === 72) ||
          (x === 8 || x === 9 || x === 71 || x === 72);
        if (onBlackEdge) gray[y * w + x] = 0;
      }
    }

    // Open a 5-pixel door gap in the top wall at x=37..41
    for (let x = 37; x <= 41; x++) {
      for (let y = 5; y < 10; y++) gray[y * w + x] = 255;
    }

    const imageData = makeImageData(gray, w, h);
    // pixelsPerCm=0.05 → radius = min(300, round(80*0.05)) = 4; seals the 5px gap (2×4=8 > 5) ✓
    // Interior is ~60px wide → 4px encroachment leaves ~52px open, seed (40,40) stays open ✓
    const result = detectRoomAtPixel(imageData, 40, 40, { pixelsPerCm: 0.05, maxAreaCm2: 10_000_000 });
    expect(result).not.toBeNull();
    expect(result.polygonPixels.length).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// buildGrayWallMask
// ---------------------------------------------------------------------------
describe('buildGrayWallMask', () => {
  it('marks gray pixels as wall and black/white pixels as open with default thresholds', () => {
    // 3-pixel image: black(0), gray-160, white(255)
    const imageData = makeImageData([0, 160, 255], 3, 1);
    const mask = buildGrayWallMask(imageData); // defaults: [80, 210]
    expect(mask[0]).toBe(0); // black → open (0 < 80)
    expect(mask[1]).toBe(1); // gray 160 → wall (80 ≤ 160 ≤ 210)
    expect(mask[2]).toBe(0); // white → open (255 > 210)
  });

  it('respects custom threshold boundaries', () => {
    // gray=80: inside [80,210] → wall; outside [90,210] → open
    const imageData = makeImageData([80], 1, 1);
    expect(buildGrayWallMask(imageData, 80, 210)[0]).toBe(1); // 80 ≥ 80 → wall
    expect(buildGrayWallMask(imageData, 90, 210)[0]).toBe(0); // 80 < 90 → open
  });
});

// ---------------------------------------------------------------------------
// autoDetectWallRange
// ---------------------------------------------------------------------------
describe('autoDetectWallRange', () => {
  it('detects a dominant mid-gray peak as the wall fill', () => {
    // 80×80 = 6400 pixels total
    // 80% white (255) = 5120 pixels → "white level" is well above 160
    // 10% gray-160   = 640 pixels  → dominant mid-gray peak
    // 10% black (0)  = 640 pixels  → below lowThresh, ignored
    const w = 80, h = 80;
    const pixels = new Uint8Array(w * h);
    pixels.fill(255);
    // gray-160 block
    for (let i = 0; i < 640; i++) pixels[i] = 160;
    // black block
    for (let i = 640; i < 1280; i++) pixels[i] = 0;

    const imageData = makeImageData(pixels, w, h);
    const range = autoDetectWallRange(imageData);
    expect(range).not.toBeNull();
    expect(range.low).toBeLessThanOrEqual(160);
    expect(range.high).toBeGreaterThanOrEqual(160);
  });

  it('returns null when no mid-gray peak exists (only black and white)', () => {
    // 90% white (255) + 10% black (0) → no gray pixels at all
    const w = 80, h = 80;
    const pixels = new Uint8Array(w * h);
    pixels.fill(255);
    for (let i = 0; i < 640; i++) pixels[i] = 0;

    const imageData = makeImageData(pixels, w, h);
    const range = autoDetectWallRange(imageData);
    expect(range).toBeNull();
  });
});
