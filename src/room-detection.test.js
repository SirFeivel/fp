// src/room-detection.test.js
import { describe, it, expect } from 'vitest';
import {
  imageToBinaryMask,
  buildGrayWallMask,
  autoDetectWallRange,
  morphologicalClose,
  filterSmallComponents,
  floodFill,
  fillInteriorHoles,
  floodFillFromBorder,
  traceContour,
  douglasPeucker,
  snapPolygonEdges,
  detectWallThickness,
  detectDoorGaps,
  detectRoomAtPixel,
  detectEnvelope
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
// filterSmallComponents
// ---------------------------------------------------------------------------
describe('filterSmallComponents', () => {
  it('removes small wall features (text) while keeping large walls', () => {
    const w = 30, h = 30;
    const mask = new Uint8Array(w * h);

    // Large wall: 20px horizontal wall at y=15 (area = 20 pixels)
    for (let x = 5; x < 25; x++) mask[15 * w + x] = 1;

    // Small text: 3px cluster at (3, 3) (area = 3 pixels)
    mask[3 * w + 3] = 1;
    mask[3 * w + 4] = 1;
    mask[4 * w + 3] = 1;

    const result = filterSmallComponents(mask, w, h, 10);

    // Wall should survive (area=20 ≥ 10)
    expect(result[15 * w + 10]).toBe(1);
    // Text should be removed (area=3 < 10)
    expect(result[3 * w + 3]).toBe(0);
    expect(result[3 * w + 4]).toBe(0);
  });

  it('preserves all components when minArea is 1', () => {
    const w = 10, h = 10;
    const mask = new Uint8Array(w * h);
    mask[0] = 1; // single pixel
    const result = filterSmallComponents(mask, w, h, 1);
    expect(result[0]).toBe(1);
  });

  it('returns mask of same size', () => {
    const w = 8, h = 8;
    const mask = new Uint8Array(w * h);
    const result = filterSmallComponents(mask, w, h, 5);
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
// fillInteriorHoles
// ---------------------------------------------------------------------------
describe('fillInteriorHoles', () => {
  it('fills an interior hole (island of 0s surrounded by 1s)', () => {
    const w = 10, h = 10;
    const mask = new Uint8Array(w * h);
    // Fill a ring of 1s with a hole at center
    for (let y = 2; y <= 7; y++)
      for (let x = 2; x <= 7; x++)
        mask[y * w + x] = 1;
    // Punch a hole at (4,4) and (5,5)
    mask[4 * w + 4] = 0;
    mask[5 * w + 5] = 0;

    fillInteriorHoles(mask, w, h);

    // Holes should be filled
    expect(mask[4 * w + 4]).toBe(1);
    expect(mask[5 * w + 5]).toBe(1);
    // Border pixels should remain 0
    expect(mask[0]).toBe(0);
    expect(mask[w - 1]).toBe(0);
  });

  it('does not fill background pixels reachable from border', () => {
    const w = 10, h = 10;
    const mask = new Uint8Array(w * h);
    // Small filled region in center
    for (let y = 3; y <= 6; y++)
      for (let x = 3; x <= 6; x++)
        mask[y * w + x] = 1;

    fillInteriorHoles(mask, w, h);

    // Background around the region should remain 0
    expect(mask[0]).toBe(0);
    expect(mask[1 * w + 1]).toBe(0);
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
// snapPolygonEdges
// ---------------------------------------------------------------------------
describe('snapPolygonEdges', () => {
  it('snaps a near-axis-aligned rectangle to exact 90° corners', () => {
    // Rectangle with slight angular noise (~1° off)
    const verts = [
      { x: 0, y: 0 },
      { x: 100, y: 1.5 },   // nearly horizontal, ~0.86° off
      { x: 101, y: 80 },    // nearly vertical
      { x: 1, y: 79 },      // nearly horizontal
    ];
    const result = snapPolygonEdges(verts, 5);
    expect(result.length).toBe(4);

    // All edges should now be exactly axis-aligned
    // Edge 0→1: horizontal (same y)
    expect(Math.abs(result[1].y - result[0].y)).toBeLessThan(0.1);
    // Edge 1→2: vertical (same x)
    expect(Math.abs(result[2].x - result[1].x)).toBeLessThan(0.1);
    // Edge 2→3: horizontal
    expect(Math.abs(result[3].y - result[2].y)).toBeLessThan(0.1);
    // Edge 3→0: vertical
    expect(Math.abs(result[0].x - result[3].x)).toBeLessThan(0.1);
  });

  it('removes collinear vertices (180° angles)', () => {
    // Rectangle with an extra point on one edge (all 3 points nearly collinear)
    const verts = [
      { x: 0, y: 0 },
      { x: 50, y: 0.3 },    // on top edge, slightly off
      { x: 100, y: 0.1 },   // end of top edge
      { x: 100, y: 80 },
      { x: 0, y: 80 },
    ];
    const result = snapPolygonEdges(verts, 5);
    // The middle point on the top edge should be removed (collinear)
    expect(result.length).toBe(4);
  });

  it('preserves 45° diagonal edges', () => {
    // Pentagon with a 45° chamfered corner
    const verts = [
      { x: 0, y: 0 },
      { x: 80, y: 0 },
      { x: 100, y: 20 },    // 45° diagonal (dx=20, dy=20)
      { x: 100, y: 80 },
      { x: 0, y: 80 },
    ];
    const result = snapPolygonEdges(verts, 5);
    expect(result.length).toBe(5);

    // Edge from result[1] to result[2] should be at exactly 45°
    const dx = result[2].x - result[1].x;
    const dy = result[2].y - result[1].y;
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
    expect(angle).toBeCloseTo(45, 0);
  });

  it('does not snap edges beyond tolerance', () => {
    // Edge at 10° off horizontal — beyond 5° tolerance
    const verts = [
      { x: 0, y: 0 },
      { x: 100, y: 17.6 },  // ~10° angle
      { x: 100, y: 80 },
      { x: 0, y: 80 },
    ];
    const result = snapPolygonEdges(verts, 5);
    // Top edge should NOT be snapped (10° > 5° tolerance)
    const dy = result[1].y - result[0].y;
    expect(Math.abs(dy)).toBeGreaterThan(5);
  });

  it('returns input for fewer than 3 vertices', () => {
    const result = snapPolygonEdges([{ x: 0, y: 0 }, { x: 1, y: 1 }], 5);
    expect(result.length).toBe(2);
  });

  it('snaps L-shaped room with all 90° corners', () => {
    // L-shape: 6 vertices, all should be 90° after snapping
    const verts = [
      { x: 0, y: 0 },
      { x: 200, y: 1 },      // slight noise
      { x: 201, y: 150 },
      { x: 100, y: 149 },
      { x: 99, y: 300 },
      { x: 1, y: 301 },
    ];
    const result = snapPolygonEdges(verts, 5);
    expect(result.length).toBe(6);

    // Every edge should be exactly horizontal or vertical
    for (let i = 0; i < result.length; i++) {
      const j = (i + 1) % result.length;
      const dx = Math.abs(result[j].x - result[i].x);
      const dy = Math.abs(result[j].y - result[i].y);
      const isHorizontal = dy < 0.1;
      const isVertical = dx < 0.1;
      expect(isHorizontal || isVertical).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// detectWallThickness
// ---------------------------------------------------------------------------
describe('detectWallThickness', () => {
  /** Build RGBA imageData with a wall ring: black edge lines + gray fill.
   *  Walls are drawn as horizontal/vertical bands. Each wall has:
   *    2px outer edge line | (thickness-4)px gray fill | 2px inner edge line
   *  wallDef = { outerMin, innerMin, innerMax, outerMax } for each axis. */
  function makeWallRingImage(w, h, outerMin, innerMin, innerMax, outerMax) {
    const data = new Uint8ClampedArray(w * h * 4);
    // Fill white
    for (let i = 0; i < w * h * 4; i += 4) {
      data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = 255;
    }

    function set(x, y, r, g, b) {
      if (x < 0 || x >= w || y < 0 || y >= h) return;
      const idx = (y * w + x) * 4;
      data[idx] = r; data[idx + 1] = g; data[idx + 2] = b;
    }

    // Top wall: y from outerMin to innerMin-1
    for (let y = outerMin; y < innerMin; y++) {
      for (let x = outerMin; x < outerMax; x++) {
        if (y < outerMin + 2 || y >= innerMin - 2) {
          set(x, y, 30, 30, 30); // edge line
        } else {
          set(x, y, 128, 128, 128); // fill
        }
      }
    }
    // Bottom wall: y from innerMax to outerMax-1
    for (let y = innerMax; y < outerMax; y++) {
      for (let x = outerMin; x < outerMax; x++) {
        if (y < innerMax + 2 || y >= outerMax - 2) {
          set(x, y, 30, 30, 30);
        } else {
          set(x, y, 128, 128, 128);
        }
      }
    }
    // Left wall: x from outerMin to innerMin-1
    for (let y = innerMin; y < innerMax; y++) {
      for (let x = outerMin; x < innerMin; x++) {
        if (x < outerMin + 2 || x >= innerMin - 2) {
          set(x, y, 30, 30, 30);
        } else {
          set(x, y, 128, 128, 128);
        }
      }
    }
    // Right wall: x from innerMax to outerMax-1
    for (let y = innerMin; y < innerMax; y++) {
      for (let x = innerMax; x < outerMax; x++) {
        if (x < innerMax + 2 || x >= outerMax - 2) {
          set(x, y, 30, 30, 30);
        } else {
          set(x, y, 128, 128, 128);
        }
      }
    }

    return { data, width: w, height: h };
  }

  it('detects wall thickness of a rectangular room with known wall width', () => {
    const w = 60, h = 60;
    // Wall ring: outer (5,5)→(55,55), inner (15,15)→(45,45) → 10px wall thickness
    const imageData = makeWallRingImage(w, h, 5, 15, 45, 55);

    // Polygon is the inner face of the wall
    const polygon = [
      { x: 15, y: 15 },
      { x: 45, y: 15 },
      { x: 45, y: 45 },
      { x: 15, y: 45 },
    ];

    const result = detectWallThickness(imageData, polygon, w, h, 1);
    expect(result.edges.length).toBe(4);
    // Center-to-center on a 10px wall: expect ~8 (±1.5 for corner effects)
    expect(result.medianPx).toBeGreaterThanOrEqual(6.5);
    expect(result.medianPx).toBeLessThanOrEqual(12);
  });

  it('returns empty for fewer than 3 vertices', () => {
    const imageData = { data: new Uint8ClampedArray(10 * 10 * 4), width: 10, height: 10 };
    const result = detectWallThickness(imageData, [{ x: 0, y: 0 }], 10, 10, 1);
    expect(result.edges.length).toBe(0);
    expect(result.medianPx).toBe(0);
  });

  it('returns zero when no wall pixels are found outward', () => {
    const w = 30, h = 30;
    // All white — no walls
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      data[i * 4] = 255; data[i * 4 + 1] = 255; data[i * 4 + 2] = 255; data[i * 4 + 3] = 255;
    }
    const imageData = { data, width: w, height: h };
    const polygon = [
      { x: 10, y: 10 },
      { x: 20, y: 10 },
      { x: 20, y: 20 },
      { x: 10, y: 20 },
    ];
    const result = detectWallThickness(imageData, polygon, w, h, 1);
    expect(result.edges.length).toBe(0);
    expect(result.medianPx).toBe(0);
  });

  it('ignores red/pink pixels when measuring wall thickness', () => {
    const w = 60, h = 60;
    // Wall ring: outer (5,5)→(55,55), inner (15,15)→(45,45) → 10px wall
    const imageData = makeWallRingImage(w, h, 5, 15, 45, 55);

    // Get baseline measurement without red pixels
    const polygon = [
      { x: 15, y: 15 },
      { x: 45, y: 15 },
      { x: 45, y: 45 },
      { x: 15, y: 45 },
    ];
    const baseline = detectWallThickness(imageData, polygon, w, h, 1);

    // Now add red pixels (255,0,0) replacing the outer edge line on the top side
    // Overwrite the outer edge at y=5..6 with red
    for (let y = 5; y <= 6; y++) {
      for (let x = 5; x < 55; x++) {
        const idx = (y * w + x) * 4;
        imageData.data[idx] = 255;     // R
        imageData.data[idx + 1] = 0;   // G
        imageData.data[idx + 2] = 0;   // B
      }
    }

    const result = detectWallThickness(imageData, polygon, w, h, 1);
    // Red pixels replacing the outer edge should NOT inflate the measurement.
    // The top edge may measure differently but the median should not exceed baseline.
    expect(result.medianPx).toBeLessThanOrEqual(baseline.medianPx + 1);
    // And the result should still be reasonable (not inflated by treating red as edge)
    expect(result.medianPx).toBeLessThanOrEqual(12);
  });

  it('returns per-edge measurements that can differ', () => {
    const w = 80, h = 80;
    // Build image manually: top/bottom walls 10px thick, left/right walls 20px thick
    const data = new Uint8ClampedArray(w * h * 4);
    // Fill white
    for (let i = 0; i < w * h; i++) {
      data[i * 4] = 255; data[i * 4 + 1] = 255; data[i * 4 + 2] = 255; data[i * 4 + 3] = 255;
    }

    // Room interior: x=[25..55), y=[15..65) (30×50 room)
    // Top wall: y=[5..15), x=[5..75) → 10px thick
    // Bottom wall: y=[65..75), x=[5..75) → 10px thick
    // Left wall: x=[5..25), y=[5..75) → 20px thick
    // Right wall: x=[55..75), y=[5..75) → 20px thick

    function setPixel(x, y, r, g, b) {
      const idx = (y * w + x) * 4;
      data[idx] = r; data[idx + 1] = g; data[idx + 2] = b;
    }

    for (let y = 5; y < 75; y++) {
      for (let x = 5; x < 75; x++) {
        const inRoom = x >= 25 && x < 55 && y >= 15 && y < 65;
        if (inRoom) continue;
        // Check if at edge boundary (2px edge lines)
        const atOuterEdge = x < 7 || x >= 73 || y < 7 || y >= 73;
        const atInnerEdge =
          (Math.abs(x - 25) < 2 || Math.abs(x - 54) < 2) && y >= 5 && y < 75 ||
          (Math.abs(y - 15) < 2 || Math.abs(y - 64) < 2) && x >= 5 && x < 75;
        if (atOuterEdge || atInnerEdge) {
          setPixel(x, y, 30, 30, 30); // edge
        } else {
          setPixel(x, y, 128, 128, 128); // fill
        }
      }
    }

    const imageData = { data, width: w, height: h };
    const polygon = [
      { x: 25, y: 15 },
      { x: 55, y: 15 },
      { x: 55, y: 65 },
      { x: 25, y: 65 },
    ];

    const result = detectWallThickness(imageData, polygon, w, h, 1);
    expect(result.edges.length).toBe(4);

    // Group edges: top (edge 0), right (edge 1), bottom (edge 2), left (edge 3)
    const thicknesses = result.edges.map(e => e.thicknessPx);
    // Top/bottom should be ~10, left/right should be ~20
    // At least verify they are distinguishable (not all the same)
    const minT = Math.min(...thicknesses);
    const maxT = Math.max(...thicknesses);
    expect(maxT).toBeGreaterThan(minT * 1.3); // at least 30% difference
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

  it('returns wallThicknesses with per-edge data', () => {
    const imageData = makeRoomImage();
    const result = detectRoomAtPixel(imageData, 40, 40, OPT);
    expect(result).not.toBeNull();
    expect(result.wallThicknesses).toBeDefined();
    expect(result.wallThicknesses.edges.length).toBeGreaterThanOrEqual(1);
    expect(result.wallThicknesses.medianPx).toBeGreaterThan(0);
    expect(result.wallThicknesses.medianCm).toBeGreaterThan(0);
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

// ---------------------------------------------------------------------------
// Dashed line merging (detectDoorGapsAlongEdges via detectRoomAtPixel)
// ---------------------------------------------------------------------------
describe('dashed line merging', () => {
  /**
   * Build a 150×150 room image with an 8px-thick black wall ring.
   * One wall has a dashed opening: alternating small gaps and short wall dashes.
   *
   * At ppc=0.3:
   *   maxDashPx = max(1, round(10*0.3)) = 3
   *   minGapPx  = max(2, round(45*0.3)) = 14
   *   Individual gaps (6px each) < 14 → filtered without merging
   *   Wall dashes (3px each) ≤ 3 maxDashPx → merged
   *   Merged total span (33px) ≥ 14 minGapPx → reported as 1 gap
   */
  const DASH_OPT = { pixelsPerCm: 0.3, maxAreaCm2: 10_000_000 };

  function makeDashedRoomImage() {
    const w = 150, h = 150;
    const gray = new Uint8Array(w * h).fill(255);

    // 8px-thick black wall ring: (10,10)-(140,140)
    const wT = 10, wB = 140, wL = 10, wR = 140, thick = 8;
    for (let y = wT; y < wB; y++) {
      for (let x = wL; x < wR; x++) {
        const onBorder =
          y < wT + thick || y >= wB - thick ||
          x < wL + thick || x >= wR - thick;
        if (onBorder) gray[y * w + x] = 0;
      }
    }

    // Dashed opening in top wall: x=50..82, y=10..17
    // Pattern: 6gap, 3wall, 6gap, 3wall, 6gap, 3wall, 6gap = 33px
    const dashY0 = wT, dashY1 = wT + thick;
    const segments = [
      // [startX, endX, isGap]
      [50, 56, true],   // 6px gap
      [56, 59, false],  // 3px wall dash
      [59, 65, true],   // 6px gap
      [65, 68, false],  // 3px wall dash
      [68, 74, true],   // 6px gap
      [74, 77, false],  // 3px wall dash
      [77, 83, true],   // 6px gap
    ];
    for (const [sx, ex, isGap] of segments) {
      if (isGap) {
        for (let y = dashY0; y < dashY1; y++)
          for (let x = sx; x < ex; x++)
            gray[y * w + x] = 255; // White = open
      }
      // Wall dashes stay black (already 0)
    }

    return makeImageData(gray, w, h);
  }

  it('merges dashed line gaps into a single door opening', () => {
    const imageData = makeDashedRoomImage();
    const result = detectRoomAtPixel(imageData, 75, 75, DASH_OPT);

    expect(result).not.toBeNull();
    expect(result.polygonPixels.length).toBeGreaterThanOrEqual(3);

    // The 4 individual 6px gaps are each below minGapPx (14).
    // Without dash merging, they'd all be filtered → 0 gaps.
    // With merging, consecutive gaps separated by ≤3px wall dashes
    // combine into a single ~33px opening → exactly 1 gap.
    expect(result.doorGapsPx.length).toBe(1);

    // The merged gap midpoint should be near x=66 (center of span 50..83)
    const gap = result.doorGapsPx[0];
    expect(gap.midpointPx.x).toBeGreaterThanOrEqual(55);
    expect(gap.midpointPx.x).toBeLessThanOrEqual(78);
  });

  it('does not merge gaps separated by wide wall segments', () => {
    // At ppc=0.05: minGapPx=2, maxDashPx=1, closeRadii=[3,4,7]
    // Two solid 5px gaps far apart in the top wall, separated by ~30px of wall.
    // Close radius 3 seals 5px gaps (2*3=6 > 5). Gaps are 5px ≥ 2 minGapPx.
    // Distance between gaps (~30px) >> 1 maxDashPx → NOT merged → 2 gaps.
    const SEP_OPT = { pixelsPerCm: 0.05, maxAreaCm2: 10_000_000 };
    const w = 80, h = 80;
    const gray = new Uint8Array(w * h).fill(255);

    const wallT = 5, wallB = 75, wallL = 5, wallR = 75, wallThick = 3;
    for (let y = wallT; y <= wallB; y++) {
      for (let x = wallL; x <= wallR; x++) {
        const onBorder =
          y < wallT + wallThick ||
          y > wallB - wallThick ||
          x < wallL + wallThick ||
          x > wallR - wallThick;
        if (onBorder) gray[y * w + x] = 0;
      }
    }

    // Gap 1: x=20..24 (5px) in top wall
    for (let x = 20; x <= 24; x++)
      for (let y = wallT; y < wallT + wallThick; y++)
        gray[y * w + x] = 255;

    // Gap 2: x=55..59 (5px) in top wall
    for (let x = 55; x <= 59; x++)
      for (let y = wallT; y < wallT + wallThick; y++)
        gray[y * w + x] = 255;

    const imageData = makeImageData(gray, w, h);
    const result = detectRoomAtPixel(imageData, 40, 40, SEP_OPT);

    expect(result).not.toBeNull();
    // Each gap is 5px ≥ 2 minGapPx, and they're ~30px apart >> 1 maxDashPx
    // → should remain as 2 separate door gaps
    expect(result.doorGapsPx.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// floodFillFromBorder
// ---------------------------------------------------------------------------
describe('floodFillFromBorder', () => {
  it('marks exterior pixels as 1 and interior inside a wall ring as 0', () => {
    // 20×20 image with a wall ring: walls at rows/cols 5–6 and 13–14
    const w = 20, h = 20;
    const mask = new Uint8Array(w * h);
    // Draw wall ring
    for (let x = 5; x <= 14; x++) {
      mask[5 * w + x] = 1; mask[6 * w + x] = 1;   // top wall
      mask[13 * w + x] = 1; mask[14 * w + x] = 1;  // bottom wall
    }
    for (let y = 5; y <= 14; y++) {
      mask[y * w + 5] = 1; mask[y * w + 6] = 1;    // left wall
      mask[y * w + 13] = 1; mask[y * w + 14] = 1;  // right wall
    }

    const exterior = floodFillFromBorder(mask, w, h);

    // Exterior pixel (0,0) should be 1 (reachable from border)
    expect(exterior[0]).toBe(1);
    // Exterior pixel (3,3) should be 1
    expect(exterior[3 * w + 3]).toBe(1);
    // Interior pixel (10,10) should be 0 (not reachable from border)
    expect(exterior[10 * w + 10]).toBe(0);
    // Wall pixel should be 0 (walls are mask=1, not traversed)
    expect(exterior[5 * w + 5]).toBe(0);
  });

  it('marks entire image as exterior when no walls exist', () => {
    const w = 10, h = 10;
    const mask = new Uint8Array(w * h); // all 0 (open)
    const exterior = floodFillFromBorder(mask, w, h);
    for (let i = 0; i < w * h; i++) {
      expect(exterior[i]).toBe(1);
    }
  });

  it('marks nothing as exterior when entire image is wall', () => {
    const w = 10, h = 10;
    const mask = new Uint8Array(w * h).fill(1); // all wall
    const exterior = floodFillFromBorder(mask, w, h);
    for (let i = 0; i < w * h; i++) {
      expect(exterior[i]).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// detectEnvelope
// ---------------------------------------------------------------------------
describe('detectEnvelope', () => {
  /** Build a synthetic building image: white background, gray-fill walls forming a rectangle. */
  function makeBuildingImage(imgW, imgH, bldgRect, wallThick = 8) {
    const data = new Uint8ClampedArray(imgW * imgH * 4);
    // Fill white
    for (let i = 0; i < imgW * imgH; i++) {
      data[i * 4] = 255; data[i * 4 + 1] = 255; data[i * 4 + 2] = 255; data[i * 4 + 3] = 255;
    }

    function setPixel(x, y, gray) {
      if (x < 0 || x >= imgW || y < 0 || y >= imgH) return;
      const idx = (y * imgW + x) * 4;
      data[idx] = gray; data[idx + 1] = gray; data[idx + 2] = gray;
    }

    const { x: bx, y: by, w: bw, h: bh } = bldgRect;
    // Draw wall ring: gray fill with black edge lines
    for (let y = by; y < by + bh; y++) {
      for (let x = bx; x < bx + bw; x++) {
        const inInterior =
          x >= bx + wallThick && x < bx + bw - wallThick &&
          y >= by + wallThick && y < by + bh - wallThick;
        if (inInterior) continue; // room interior stays white

        // Edge lines: 2px at inner and outer boundary
        const atOuterEdge = x < bx + 2 || x >= bx + bw - 2 || y < by + 2 || y >= by + bh - 2;
        const atInnerEdge =
          Math.abs(x - (bx + wallThick)) < 2 || Math.abs(x - (bx + bw - wallThick - 1)) < 2 ||
          Math.abs(y - (by + wallThick)) < 2 || Math.abs(y - (by + bh - wallThick - 1)) < 2;
        if (atOuterEdge || atInnerEdge) {
          setPixel(x, y, 30); // black edge
        } else {
          setPixel(x, y, 140); // gray fill
        }
      }
    }

    return { data, width: imgW, height: imgH };
  }

  it('detects a rectangular building envelope', () => {
    // Realistic size: 400×300 image, building 300×200 px at ppc=0.5 → 6m × 4m building
    const imageData = makeBuildingImage(400, 300, { x: 50, y: 50, w: 300, h: 200 }, 12);
    const result = detectEnvelope(imageData, { pixelsPerCm: 0.5 });

    expect(result).not.toBeNull();
    expect(result.polygonPixels.length).toBeGreaterThanOrEqual(3);

    // Bounding box should roughly match the building rectangle
    const xs = result.polygonPixels.map(p => p.x);
    const ys = result.polygonPixels.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);

    // Building spans x=[50,350), y=[50,250) → bbox should be close
    expect(minX).toBeGreaterThanOrEqual(30);
    expect(minX).toBeLessThanOrEqual(70);
    expect(maxX).toBeGreaterThanOrEqual(330);
    expect(maxX).toBeLessThanOrEqual(370);
    expect(minY).toBeGreaterThanOrEqual(30);
    expect(minY).toBeLessThanOrEqual(70);
    expect(maxY).toBeGreaterThanOrEqual(230);
    expect(maxY).toBeLessThanOrEqual(270);
  });

  it('returns wallThicknesses with edge data', () => {
    const imageData = makeBuildingImage(400, 300, { x: 50, y: 50, w: 300, h: 200 }, 12);
    const result = detectEnvelope(imageData, { pixelsPerCm: 0.5 });

    expect(result).not.toBeNull();
    expect(result.wallThicknesses).toBeDefined();
    expect(result.wallThicknesses.edges.length).toBeGreaterThanOrEqual(1);
  });

  it('returns null for an all-white image', () => {
    const w = 50, h = 50;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      data[i * 4] = 255; data[i * 4 + 1] = 255; data[i * 4 + 2] = 255; data[i * 4 + 3] = 255;
    }
    const result = detectEnvelope({ data, width: w, height: h }, { pixelsPerCm: 0.5 });
    expect(result).toBeNull();
  });

  it('returns null for an all-black image', () => {
    const w = 50, h = 50;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      data[i * 4] = 0; data[i * 4 + 1] = 0; data[i * 4 + 2] = 0; data[i * 4 + 3] = 255;
    }
    const result = detectEnvelope({ data, width: w, height: h }, { pixelsPerCm: 0.5 });
    expect(result).toBeNull();
  });

  it('detects an L-shaped building envelope', () => {
    // Realistic L-shape: 500×500 image at ppc=0.5
    // Rect1: x=[50,450), y=[50,250) → top bar 400×200 px = 8m × 4m
    // Rect2: x=[50,250), y=[250,450) → left leg 200×200 px = 4m × 4m
    const imgW = 500, imgH = 500;
    const data = new Uint8ClampedArray(imgW * imgH * 4);
    for (let i = 0; i < imgW * imgH; i++) {
      data[i * 4] = 255; data[i * 4 + 1] = 255; data[i * 4 + 2] = 255; data[i * 4 + 3] = 255;
    }

    function setPixel(x, y, gray) {
      if (x < 0 || x >= imgW || y < 0 || y >= imgH) return;
      const idx = (y * imgW + x) * 4;
      data[idx] = gray; data[idx + 1] = gray; data[idx + 2] = gray;
    }

    const wallThick = 12;

    function drawFilledRect(rx, ry, rw, rh) {
      for (let y = ry; y < ry + rh; y++) {
        for (let x = rx; x < rx + rw; x++) {
          const inInterior =
            x >= rx + wallThick && x < rx + rw - wallThick &&
            y >= ry + wallThick && y < ry + rh - wallThick;
          if (!inInterior) setPixel(x, y, 140);
        }
      }
    }

    drawFilledRect(50, 50, 400, 200);
    drawFilledRect(50, 250, 200, 200);

    // Clear the interior where the two rects connect
    for (let y = 238; y < 262; y++) {
      for (let x = 62; x < 238; x++) {
        setPixel(x, y, 255);
      }
    }

    const imageData = { data, width: imgW, height: imgH };
    const result = detectEnvelope(imageData, { pixelsPerCm: 0.5 });

    expect(result).not.toBeNull();
    // L-shape should have at least 4 vertices (typically 6 for a clean L)
    expect(result.polygonPixels.length).toBeGreaterThanOrEqual(4);
  });

  it('envelope bounding box contains a detected room inside the building', () => {
    // 400×400 image, building spanning (50,50)-(350,350) with 12px walls
    // Room interior: (62,62)-(338,338)
    const imageData = makeBuildingImage(400, 400, { x: 50, y: 50, w: 300, h: 300 }, 12);

    const envelope = detectEnvelope(imageData, { pixelsPerCm: 0.5 });
    expect(envelope).not.toBeNull();

    // Detect a room inside the building
    const room = detectRoomAtPixel(imageData, 200, 200, { pixelsPerCm: 0.5, maxAreaCm2: 10_000_000 });
    expect(room).not.toBeNull();

    // Envelope bbox should contain the room bbox
    const envXs = envelope.polygonPixels.map(p => p.x);
    const envYs = envelope.polygonPixels.map(p => p.y);
    const envMinX = Math.min(...envXs), envMaxX = Math.max(...envXs);
    const envMinY = Math.min(...envYs), envMaxY = Math.max(...envYs);

    const roomXs = room.polygonPixels.map(p => p.x);
    const roomYs = room.polygonPixels.map(p => p.y);
    const roomMinX = Math.min(...roomXs), roomMaxX = Math.max(...roomXs);
    const roomMinY = Math.min(...roomYs), roomMaxY = Math.max(...roomYs);

    expect(envMinX).toBeLessThanOrEqual(roomMinX);
    expect(envMaxX).toBeGreaterThanOrEqual(roomMaxX);
    expect(envMinY).toBeLessThanOrEqual(roomMinY);
    expect(envMaxY).toBeGreaterThanOrEqual(roomMaxY);
  });
});
