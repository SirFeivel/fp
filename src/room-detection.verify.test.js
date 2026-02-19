// Verification test: run detectRoomAtPixel against the real reference floor plan.
// Compares polygon bounding box to the hand-drawn reference polygon.
// Run once with: npx vitest run src/room-detection.verify.test.js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { decode } from 'fast-png';
import { detectRoomAtPixel, detectEnvelope, detectSpanningWalls, removePolygonMicroBumps, detectWallThickness, autoDetectWallRange, buildGrayWallMask, filterSmallComponents } from './room-detection.js';
import { rectifyPolygon, FLOOR_PLAN_RULES } from './floor-plan-rules.js';

// ── Load reference data ────────────────────────────────────────────────────
const calibrated = JSON.parse(
  readFileSync('/Users/feivel/Downloads/floor_plan_kg_calibrated.json', 'utf8')
);
const reference = JSON.parse(
  readFileSync('/Users/feivel/Downloads/reference_autodetect.json', 'utf8')
);

const bg  = calibrated.floors[0].layout.background;
const ppc = bg.scale.pixelsPerCm; // 0.8622…

// Decode the PNG embedded in the dataUrl
const b64 = bg.dataUrl.replace(/^data:image\/[^;]+;base64,/, '');
const raw  = decode(Buffer.from(b64, 'base64'));
const imageData = { data: raw.data, width: raw.width, height: raw.height };

// Reference room bounding box (floor-global cm)
const refRoom = reference.floors[0].rooms[0];
const { x: fpX, y: fpY } = refRoom.floorPosition;
const globalVerts = refRoom.polygonVertices.map(v => ({
  x: v.x + fpX,
  y: v.y + fpY
}));
const refMinX = Math.min(...globalVerts.map(v => v.x));
const refMaxX = Math.max(...globalVerts.map(v => v.x));
const refMinY = Math.min(...globalVerts.map(v => v.y));
const refMaxY = Math.max(...globalVerts.map(v => v.y));

// Seed: centroid of the reference polygon in pixel space
const seedXpx = Math.round(((refMinX + refMaxX) / 2) * ppc);
const seedYpx = Math.round(((refMinY + refMaxY) / 2) * ppc);

// ── Verification test ─────────────────────────────────────────────────────
describe('detectRoomAtPixel vs reference floor plan', () => {
  it('detects a valid polygon from the reference image centroid', () => {
    const result = detectRoomAtPixel(imageData, seedXpx, seedYpx, {
      pixelsPerCm: ppc,
      maxAreaCm2: 500000
    });

    expect(result, 'detection returned null — seed may be on a wall').not.toBeNull();
    expect(result.polygonPixels.length).toBeGreaterThanOrEqual(3);
  });

  it('polygon bounding box matches reference within 5 cm', () => {
    const result = detectRoomAtPixel(imageData, seedXpx, seedYpx, {
      pixelsPerCm: ppc,
      maxAreaCm2: 500000
    });
    if (!result) return; // previous test already fails

    // Convert pixel polygon back to cm
    const cmVerts = result.polygonPixels.map(p => ({
      x: p.x / ppc + (bg.position?.x ?? 0),
      y: p.y / ppc + (bg.position?.y ?? 0)
    }));

    const detMinX = Math.min(...cmVerts.map(v => v.x));
    const detMaxX = Math.max(...cmVerts.map(v => v.x));
    const detMinY = Math.min(...cmVerts.map(v => v.y));
    const detMaxY = Math.max(...cmVerts.map(v => v.y));

    console.log(`Reference bbox cm: x=${refMinX}–${refMaxX}, y=${refMinY}–${refMaxY}`);
    console.log(`Detected bbox cm:  x=${detMinX.toFixed(1)}–${detMaxX.toFixed(1)}, y=${detMinY.toFixed(1)}–${detMaxY.toFixed(1)}`);
    console.log(`Error (cm):  left=${Math.abs(detMinX-refMinX).toFixed(1)}, right=${Math.abs(detMaxX-refMaxX).toFixed(1)}, top=${Math.abs(detMinY-refMinY).toFixed(1)}, bottom=${Math.abs(detMaxY-refMaxY).toFixed(1)}`);

    const TOLERANCE_CM = 5;
    expect(Math.abs(detMinX - refMinX)).toBeLessThan(TOLERANCE_CM);
    expect(Math.abs(detMaxX - refMaxX)).toBeLessThan(TOLERANCE_CM);
    expect(Math.abs(detMinY - refMinY)).toBeLessThan(TOLERANCE_CM);
    expect(Math.abs(detMaxY - refMaxY)).toBeLessThan(TOLERANCE_CM);
  });
});

// ── Envelope post-processing E2E verification ──────────────────────────────
// Acceptance criteria (per user):
//   - Rectangular outer wall, roughly 10m x 8.5m, ~30cm wall thickness
//   - 1 inner horizontal spanning wall, same length, ~24cm thickness
//   - No phantom V spanning wall
//   - No protrusion, no thickness anomalies

const envelopeV5 = JSON.parse(
  readFileSync('/Users/feivel/Downloads/envelope_v5.JSON', 'utf8')
);

describe('envelope post-processing pipeline', () => {
  let cleaned;

  function runPostProcessing() {
    if (cleaned) return;
    const rectified = envelopeV5.polygonCm;
    const bumpThreshold = envelopeV5.wallThicknesses?.medianCm || 30;
    cleaned = removePolygonMicroBumps(rectified, bumpThreshold);
  }

  it('produces a 4-vertex rectangle (~10m x 8.5m)', () => {
    runPostProcessing();
    expect(cleaned.length).toBe(4);

    const xs = cleaned.map(p => p.x);
    const ys = cleaned.map(p => p.y);
    const width = Math.max(...xs) - Math.min(...xs);
    const height = Math.max(...ys) - Math.min(...ys);

    // Roughly 10m x 8.5m (allow ±1m tolerance for detection variance)
    expect(width).toBeGreaterThan(900);
    expect(width).toBeLessThan(1100);
    expect(height).toBeGreaterThan(750);
    expect(height).toBeLessThan(950);
  });

  it('removes the left-side protrusion (no x < 640)', () => {
    runPostProcessing();
    for (const p of cleaned) {
      expect(p.x).toBeGreaterThanOrEqual(640);
    }
  });
});

// ── E2E wall thickness + spanning wall tests (300 DPI image) ────────────────
// Uses higher-res PNG where walls are clearly visible to detection algorithms.

const cal300 = JSON.parse(
  readFileSync('/Users/feivel/Downloads/KG_300dpi_calibrated.json', 'utf8')
);
const bg300 = cal300.floors[0].layout.background;
const ppc300 = bg300.scale.pixelsPerCm; // ~1.18

const b64_300 = bg300.dataUrl.replace(/^data:image\/[^;]+;base64,/, '');
const raw300 = decode(Buffer.from(b64_300, 'base64'));
const img300 = { data: raw300.data, width: raw300.width, height: raw300.height };

describe('wall thickness on 300dpi KG floor plan', () => {
  let cleaned, cleanedPx;

  function setup() {
    if (cleaned) return;
    cleaned = removePolygonMicroBumps(
      envelopeV5.polygonCm,
      envelopeV5.wallThicknesses?.medianCm || 30
    );
    cleanedPx = cleaned.map(p => ({
      x: Math.round((p.x - (bg300.position?.x ?? 0)) * ppc300),
      y: Math.round((p.y - (bg300.position?.y ?? 0)) * ppc300)
    }));
  }

  it('polygon fits within 300dpi image', () => {
    setup();
    for (const p of cleanedPx) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThan(img300.width);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThan(img300.height);
    }
  });

  it('all edge thicknesses are in [5, 50] cm (no anomalies)', () => {
    setup();
    const wt = detectWallThickness(
      img300, cleanedPx, img300.width, img300.height,
      ppc300, { probeInward: true }
    );
    console.log('Wall thicknesses (300dpi):', JSON.stringify(wt, null, 2));
    expect(wt.edges.length).toBeGreaterThanOrEqual(1);
    for (const edge of wt.edges) {
      expect(edge.thicknessCm, `edge ${edge.edgeIndex}: ${edge.thicknessCm}cm`).toBeGreaterThanOrEqual(5);
      expect(edge.thicknessCm, `edge ${edge.edgeIndex}: ${edge.thicknessCm}cm`).toBeLessThanOrEqual(50);
    }
  });
});

describe('spanning wall detection on 300dpi KG floor plan', () => {
  let wallMask, buildingMask;
  const w = img300.width;
  const h = img300.height;

  function buildMasks() {
    if (wallMask) return;

    // Build wallMask from real image
    const range = autoDetectWallRange(img300);
    if (!range) throw new Error('autoDetectWallRange returned null');
    wallMask = buildGrayWallMask(img300, range.low, range.high);
    const minComponentArea = Math.max(16, Math.round(8 * ppc300) ** 2);
    wallMask = filterSmallComponents(wallMask, w, h, minComponentArea);

    // Build buildingMask from cleaned envelope polygon (rasterize rectangle)
    const cleaned = removePolygonMicroBumps(
      envelopeV5.polygonCm,
      envelopeV5.wallThicknesses?.medianCm || 30
    );
    const cleanedPx = cleaned.map(p => ({
      x: Math.round((p.x - (bg300.position?.x ?? 0)) * ppc300),
      y: Math.round((p.y - (bg300.position?.y ?? 0)) * ppc300)
    }));
    const xs = cleanedPx.map(p => p.x);
    const ys = cleanedPx.map(p => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    buildingMask = new Uint8Array(w * h);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (x >= 0 && x < w && y >= 0 && y < h) {
          buildingMask[y * w + x] = 1;
        }
      }
    }
  }

  it('detects exactly 1 H spanning wall and 0 V spanning walls', () => {
    buildMasks();
    const walls = detectSpanningWalls(img300, wallMask, buildingMask, w, h, {
      pixelsPerCm: ppc300,
    });

    const hWalls = walls.filter(w => w.orientation === 'H');
    const vWalls = walls.filter(w => w.orientation === 'V');

    expect(vWalls.length, 'phantom V wall still detected').toBe(0);
    expect(hWalls.length, 'expected exactly 1 H spanning wall').toBe(1);
  });

  it('H spanning wall has thickness ~24cm (in [15, 35] cm)', () => {
    buildMasks();
    const walls = detectSpanningWalls(img300, wallMask, buildingMask, w, h, {
      pixelsPerCm: ppc300,
    });
    const hWalls = walls.filter(w => w.orientation === 'H');
    if (hWalls.length === 0) return; // previous test already fails

    const thicknessCm = hWalls[0].thicknessPx / ppc300;
    console.log(`H spanning wall thickness: ${thicknessCm.toFixed(1)} cm`);
    expect(thicknessCm).toBeGreaterThan(15);
    expect(thicknessCm).toBeLessThan(35);
  });
});
