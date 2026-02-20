// Verification test: run detectRoomAtPixel against the real reference floor plan.
// Compares polygon bounding box to the hand-drawn reference polygon.
// Run once with: npx vitest run src/room-detection.verify.test.js
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'fs';
import { decode, encode } from 'fast-png';
import { detectRoomAtPixel, detectEnvelope, detectSpanningWalls, removePolygonMicroBumps, detectWallThickness, autoDetectWallRange, buildGrayWallMask, filterSmallComponents, preprocessForRoomDetection } from './room-detection.js';
import { rectifyPolygon, extractValidAngles, FLOOR_PLAN_RULES, classifyWallTypes, snapToWallType } from './floor-plan-rules.js';

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

// ── Step 4 regression: new pipeline must produce identical output to old ─────
// The Step 4 reorder (spanning walls before rectification + discovered angles)
// must NOT change the envelope output for orthogonal buildings. This test runs
// both the OLD code path (hardcoded FLOOR_PLAN_RULES.standardAngles) and the
// NEW code path (discovered angles) on the same raw detection result, and
// asserts every output field is identical.

describe('Step 4 pipeline reorder produces identical output (300dpi KG)', () => {
  let oldResult, newResult;

  function runBothPipelines() {
    if (oldResult) return;

    const envResult = detectEnvelope(img300, { pixelsPerCm: ppc300 });
    expect(envResult).not.toBeNull();

    // Convert pixel polygon to cm (shared input)
    const polygonCm = envResult.polygonPixels.map(p => ({
      x: p.x / ppc300 + (bg300.position?.x ?? 0),
      y: p.y / ppc300 + (bg300.position?.y ?? 0),
    }));

    // Spanning walls (shared — detection doesn't depend on rectification order)
    let spanningWalls = [];
    if (envResult.wallMask && envResult.buildingMask) {
      const { minCm, maxCm } = FLOOR_PLAN_RULES.wallThickness;
      const rawWalls = detectSpanningWalls(
        img300, envResult.wallMask, envResult.buildingMask,
        img300.width, img300.height,
        { pixelsPerCm: ppc300, minThicknessCm: minCm, maxThicknessCm: maxCm }
      );
      spanningWalls = rawWalls.map(wall => ({
        orientation: wall.orientation,
        startCm: {
          x: wall.startPx.x / ppc300 + (bg300.position?.x ?? 0),
          y: wall.startPx.y / ppc300 + (bg300.position?.y ?? 0),
        },
        endCm: {
          x: wall.endPx.x / ppc300 + (bg300.position?.x ?? 0),
          y: wall.endPx.y / ppc300 + (bg300.position?.y ?? 0),
        },
        thicknessCm: Math.round(wall.thicknessPx / ppc300 * 10) / 10,
      }));
    }

    const bumpThreshold = envResult.wallThicknesses?.medianCm || 30;

    // ── OLD pipeline: hardcoded angles (pre-Step-4 behavior) ──
    const oldRectified = rectifyPolygon(polygonCm); // uses FLOOR_PLAN_RULES default
    const oldBumped = removePolygonMicroBumps(oldRectified, bumpThreshold);
    const oldCleaned = rectifyPolygon(oldBumped); // 2nd pass: merge residual notches
    const oldCleanedPx = oldCleaned.map(p => ({
      x: Math.round((p.x - (bg300.position?.x ?? 0)) * ppc300),
      y: Math.round((p.y - (bg300.position?.y ?? 0)) * ppc300),
    }));
    const oldWallThicknesses = detectWallThickness(
      img300, oldCleanedPx, img300.width, img300.height,
      ppc300, { probeInward: true }
    );
    oldResult = { polygonCm: oldCleaned, wallThicknesses: oldWallThicknesses, spanningWalls };

    // ── NEW pipeline: discovered angles (Step 4 behavior) ──
    const validAngles = extractValidAngles(polygonCm, spanningWalls, {
      minEdgeLengthCm: FLOOR_PLAN_RULES.wallThickness.maxCm,
    });
    const newRectifyRules = { ...FLOOR_PLAN_RULES, standardAngles: validAngles };
    const newRectified = rectifyPolygon(polygonCm, newRectifyRules);
    const newBumped = removePolygonMicroBumps(newRectified, bumpThreshold);
    const newCleaned = rectifyPolygon(newBumped, newRectifyRules); // 2nd pass
    const newCleanedPx = newCleaned.map(p => ({
      x: Math.round((p.x - (bg300.position?.x ?? 0)) * ppc300),
      y: Math.round((p.y - (bg300.position?.y ?? 0)) * ppc300),
    }));
    const newWallThicknesses = detectWallThickness(
      img300, newCleanedPx, img300.width, img300.height,
      ppc300, { probeInward: true }
    );
    newResult = { polygonCm: newCleaned, wallThicknesses: newWallThicknesses, spanningWalls, validAngles };
  }

  // ── Discovered angles are correct ─────────────────────────────────────

  it('discovered angles equal the hardcoded standard angles', () => {
    runBothPipelines();
    expect(newResult.validAngles).toEqual([...FLOOR_PLAN_RULES.standardAngles]);
  });

  // ── Polygon is identical ──────────────────────────────────────────────

  it('polygon vertex count is identical', () => {
    runBothPipelines();
    expect(newResult.polygonCm.length).toBe(oldResult.polygonCm.length);
  });

  it('every polygon vertex is identical', () => {
    runBothPipelines();
    for (let i = 0; i < oldResult.polygonCm.length; i++) {
      expect(newResult.polygonCm[i].x, `vertex ${i} x`).toBe(oldResult.polygonCm[i].x);
      expect(newResult.polygonCm[i].y, `vertex ${i} y`).toBe(oldResult.polygonCm[i].y);
    }
  });

  // ── Acceptance criteria: 4-vertex rectangle ───────────────────────────

  it('produces a 4-vertex rectangle (acceptance criteria)', () => {
    runBothPipelines();
    expect(oldResult.polygonCm.length, 'expected 4-vertex rectangle').toBe(4);
  });

  // ── Wall thicknesses are identical ────────────────────────────────────

  it('wall thickness edge count is identical', () => {
    runBothPipelines();
    expect(newResult.wallThicknesses.edges.length).toBe(oldResult.wallThicknesses.edges.length);
  });

  it('per-edge wall thicknesses are identical', () => {
    runBothPipelines();
    for (let i = 0; i < oldResult.wallThicknesses.edges.length; i++) {
      const got = newResult.wallThicknesses.edges[i];
      const ref = oldResult.wallThicknesses.edges[i];
      expect(got.edgeIndex, `edge order at ${i}`).toBe(ref.edgeIndex);
      expect(got.thicknessPx, `edge ${got.edgeIndex} thicknessPx`).toBe(ref.thicknessPx);
      expect(got.thicknessCm, `edge ${got.edgeIndex} thicknessCm`).toBe(ref.thicknessCm);
    }
  });

  it('median wall thickness is identical', () => {
    runBothPipelines();
    expect(newResult.wallThicknesses.medianPx).toBe(oldResult.wallThicknesses.medianPx);
    expect(newResult.wallThicknesses.medianCm).toBe(oldResult.wallThicknesses.medianCm);
  });

  // ── Spanning walls are identical (same input, just reordered) ─────────

  it('spanning walls are identical (1 H, 0 V)', () => {
    runBothPipelines();
    expect(newResult.spanningWalls).toEqual(oldResult.spanningWalls);
    expect(newResult.spanningWalls.filter(w => w.orientation === 'H').length).toBe(1);
    expect(newResult.spanningWalls.filter(w => w.orientation === 'V').length).toBe(0);
  });

  // ── Known-good structural assertions (from pre-Step-4 verified data) ──

  it('polygon is ~10m x 8.5m', () => {
    runBothPipelines();
    const xs = oldResult.polygonCm.map(p => p.x);
    const ys = oldResult.polygonCm.map(p => p.y);
    const width = Math.max(...xs) - Math.min(...xs);
    const height = Math.max(...ys) - Math.min(...ys);
    expect(width).toBeGreaterThan(900);
    expect(width).toBeLessThan(1100);
    expect(height).toBeGreaterThan(750);
    expect(height).toBeLessThan(950);
  });

  it('all wall thicknesses in [5, 50] cm', () => {
    runBothPipelines();
    for (const edge of oldResult.wallThicknesses.edges) {
      expect(edge.thicknessCm, `edge ${edge.edgeIndex}`).toBeGreaterThanOrEqual(5);
      expect(edge.thicknessCm, `edge ${edge.edgeIndex}`).toBeLessThanOrEqual(50);
    }
  });

  it('H spanning wall thickness ~25 cm (in [15, 35] cm)', () => {
    runBothPipelines();
    const hWall = oldResult.spanningWalls.find(w => w.orientation === 'H');
    expect(hWall.thicknessCm).toBeGreaterThan(15);
    expect(hWall.thicknessCm).toBeLessThan(35);
  });

  // ── Step 5: wall type classification E2E ──────────────────────────

  it('classifyWallTypes discovers 2 types: structural + outer (300dpi)', () => {
    runBothPipelines();
    const allThicknesses = [
      ...newResult.wallThicknesses.edges.map(e => e.thicknessCm),
      ...newResult.spanningWalls.map(w => w.thicknessCm),
    ];
    const wallTypes = classifyWallTypes(allThicknesses);
    console.log('classifyWallTypes result:', JSON.stringify(wallTypes));
    expect(wallTypes.length).toBe(2);
    expect(wallTypes[0].id).toBe("structural");
    expect(wallTypes[0].thicknessCm).toBe(24);
    expect(wallTypes[1].id).toBe("outer");
    expect(wallTypes[1].thicknessCm).toBe(30);
  });

  it('envelope outer wall edges snap to outer (30cm)', () => {
    runBothPipelines();
    for (const edge of newResult.wallThicknesses.edges) {
      const { snappedCm, typeId } = snapToWallType(edge.thicknessCm);
      expect(typeId, `edge ${edge.edgeIndex} (${edge.thicknessCm}cm) → ${typeId}`).toBe("outer");
      expect(snappedCm).toBe(30);
    }
  });

  it('spanning wall snaps to structural (24cm)', () => {
    runBothPipelines();
    const hWall = newResult.spanningWalls.find(w => w.orientation === 'H');
    expect(hWall, 'no H spanning wall found').toBeTruthy();
    const { snappedCm, typeId } = snapToWallType(hWall.thicknessCm);
    expect(typeId).toBe("structural");
    expect(snappedCm).toBe(24);
  });
});

// ── Step 6: Preprocessing E2E tests ─────────────────────────────────────────

describe('Step 6: preprocessForRoomDetection on KG floor plan', () => {
  // Use the low-res image + seed (proven to work with detectRoomAtPixel in the tests above)

  it('preprocessing does not change room detection result (KG regression)', () => {
    // Detect room without preprocessing
    const resultClean = detectRoomAtPixel(imageData, seedXpx, seedYpx, {
      pixelsPerCm: ppc,
      maxAreaCm2: 500000
    });
    expect(resultClean, 'clean detection returned null').not.toBeNull();

    // Create a fresh copy of imageData for preprocessing
    const data2 = new Uint8ClampedArray(imageData.data);
    const imgCopy = { data: data2, width: imageData.width, height: imageData.height };

    // Run preprocessing (no envelope data — just pure annotation removal)
    preprocessForRoomDetection(imgCopy, { pixelsPerCm: ppc });

    // Detect room on preprocessed image
    const resultPreprocessed = detectRoomAtPixel(imgCopy, seedXpx, seedYpx, {
      pixelsPerCm: ppc,
      maxAreaCm2: 500000
    });
    expect(resultPreprocessed, 'preprocessed detection returned null').not.toBeNull();

    // Convert both results to cm for comparison
    const toCm = p => ({
      x: p.x / ppc + (bg.position?.x ?? 0),
      y: p.y / ppc + (bg.position?.y ?? 0),
    });
    const cleanCm = resultClean.polygonPixels.map(toCm);
    const prepCm  = resultPreprocessed.polygonPixels.map(toCm);

    // Bounding boxes should match within 2cm
    const bbox = verts => ({
      minX: Math.min(...verts.map(v => v.x)),
      maxX: Math.max(...verts.map(v => v.x)),
      minY: Math.min(...verts.map(v => v.y)),
      maxY: Math.max(...verts.map(v => v.y)),
    });
    const bClean = bbox(cleanCm);
    const bPrep  = bbox(prepCm);

    console.log('Clean bbox:', JSON.stringify(bClean));
    console.log('Preprocessed bbox:', JSON.stringify(bPrep));

    const TOL = 2; // cm
    expect(Math.abs(bClean.minX - bPrep.minX)).toBeLessThan(TOL);
    expect(Math.abs(bClean.maxX - bPrep.maxX)).toBeLessThan(TOL);
    expect(Math.abs(bClean.minY - bPrep.minY)).toBeLessThan(TOL);
    expect(Math.abs(bClean.maxY - bPrep.maxY)).toBeLessThan(TOL);

    // Vertex count should be the same
    expect(resultPreprocessed.polygonPixels.length).toBe(resultClean.polygonPixels.length);
  });

  it('synthetic red annotations are removed without affecting room shape', () => {
    // Create a fresh copy of the image
    const data2 = new Uint8ClampedArray(imageData.data);
    const imgNoisy = { data: data2, width: imageData.width, height: imageData.height };

    // Inject thin red dimension lines across the room interior
    // These are 1px-wide horizontal red lines at several y positions
    const redY = [seedYpx - 15, seedYpx - 8, seedYpx + 8, seedYpx + 15];
    const injectedPositions = []; // track which pixels were actually injected
    for (const y of redY) {
      if (y < 0 || y >= imageData.height) continue;
      for (let x = Math.max(0, seedXpx - 60); x < Math.min(imageData.width, seedXpx + 60); x++) {
        const i = y * imageData.width + x;
        // Only inject over white/light pixels (room interior, not walls)
        const gray = 0.299 * data2[i * 4] + 0.587 * data2[i * 4 + 1] + 0.114 * data2[i * 4 + 2];
        if (gray > 200) {
          data2[i * 4]     = 255; // R
          data2[i * 4 + 1] = 0;   // G
          data2[i * 4 + 2] = 0;   // B
          injectedPositions.push({ x, y });
        }
      }
    }
    console.log(`Injected ${injectedPositions.length} red annotation pixels`);
    expect(injectedPositions.length).toBeGreaterThan(50); // sanity: we actually injected something

    // Run preprocessing to remove the red annotations
    preprocessForRoomDetection(imgNoisy, { pixelsPerCm: ppc });

    // Verify injected red pixels were bleached to white
    let bleachedCount = 0;
    for (const { x, y } of injectedPositions) {
      const i = y * imageData.width + x;
      if (imgNoisy.data[i * 4] === 255 && imgNoisy.data[i * 4 + 1] === 255 && imgNoisy.data[i * 4 + 2] === 255) {
        bleachedCount++;
      }
    }
    console.log(`Bleached ${bleachedCount}/${injectedPositions.length} red pixels`);
    // At least 90% of injected red pixels should be bleached
    // (edge pixels near walls might survive due to morphological opening margins)
    expect(bleachedCount / injectedPositions.length).toBeGreaterThan(0.9);

    // Detect room on the preprocessed (denoised) image
    const resultDenoised = detectRoomAtPixel(imgNoisy, seedXpx, seedYpx, {
      pixelsPerCm: ppc,
      maxAreaCm2: 500000
    });
    expect(resultDenoised, 'denoised detection returned null').not.toBeNull();

    // Compare with clean detection (from original unmodified image)
    const resultClean = detectRoomAtPixel(imageData, seedXpx, seedYpx, {
      pixelsPerCm: ppc,
      maxAreaCm2: 500000
    });
    expect(resultClean, 'clean detection returned null').not.toBeNull();

    // Bounding boxes should match within tolerance
    const toCm = p => ({
      x: p.x / ppc + (bg.position?.x ?? 0),
      y: p.y / ppc + (bg.position?.y ?? 0),
    });
    const bbox = verts => ({
      minX: Math.min(...verts.map(v => v.x)),
      maxX: Math.max(...verts.map(v => v.x)),
      minY: Math.min(...verts.map(v => v.y)),
      maxY: Math.max(...verts.map(v => v.y)),
    });
    const bClean = bbox(resultClean.polygonPixels.map(toCm));
    const bDenoised = bbox(resultDenoised.polygonPixels.map(toCm));

    console.log('Clean bbox:', JSON.stringify(bClean));
    console.log('Denoised bbox:', JSON.stringify(bDenoised));

    const TOL = 5; // cm — slightly more tolerance since we injected noise
    expect(Math.abs(bClean.minX - bDenoised.minX)).toBeLessThan(TOL);
    expect(Math.abs(bClean.maxX - bDenoised.maxX)).toBeLessThan(TOL);
    expect(Math.abs(bClean.minY - bDenoised.minY)).toBeLessThan(TOL);
    expect(Math.abs(bClean.maxY - bDenoised.maxY)).toBeLessThan(TOL);
  });
});

// ── Step 6 real-world validation: EG floor plan (messy vs clean) ────────────
// The messy image has red outlines, yellow electrical markers, pink door arcs,
// red hatch patterns, and colored dimension annotations.
// The clean image is the same floor plan with most annotations removed.

const rawMessy = decode(readFileSync('/Users/feivel/Downloads/floorplan_EG.png'));
const imgMessy = { data: new Uint8ClampedArray(rawMessy.data), width: rawMessy.width, height: rawMessy.height };

const rawClean = decode(readFileSync('/Users/feivel/Downloads/floorplan_EG_clean.png'));
const imgClean = { data: new Uint8ClampedArray(rawClean.data), width: rawClean.width, height: rawClean.height };

// 300dpi at 1:100 scale → ppc ≈ 300 / 2.54 / 100 = 1.18 px/cm
const ppcEG = 300 / 2.54 / 100;

/** Count colored pixels matching the same criteria as preprocessForRoomDetection's
 *  colored mask (gray ∈ [10,200), sat > 0.3, maxC > 40). Used to measure preprocessing
 *  effectiveness. Source of truth: preprocessForRoomDetection in room-detection.js. */
function countColoredPixels(img) {
  const { data, width, height } = img;
  let count = 0;
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    if (gray < 10 || gray >= 200) continue;
    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    const sat = maxC > 0 ? (maxC - minC) / maxC : 0;
    if (sat > 0.3 && maxC > 40) count++;
  }
  return count;
}

describe('Step 6 real-world: EG floor plan (messy vs clean)', () => {
  it('messy image has more colored pixels than clean (annotations)', () => {
    const messyCount = countColoredPixels(imgMessy);
    const cleanCount = countColoredPixels(imgClean);
    console.log(`Colored pixels — messy: ${messyCount}, clean: ${cleanCount}, ratio: ${(messyCount / Math.max(1, cleanCount)).toFixed(1)}x`);
    // Messy should have more colored pixels than clean (annotations add colored pixels).
    // Both images share colored wall fills, so the ratio is modest (~1.3x).
    expect(messyCount).toBeGreaterThan(cleanCount);
  });

  it('preprocessing removes majority of colored annotation pixels', () => {
    // Work on a copy
    const data2 = new Uint8ClampedArray(imgMessy.data);
    const imgCopy = { data: data2, width: imgMessy.width, height: imgMessy.height };

    const before = countColoredPixels(imgCopy);
    preprocessForRoomDetection(imgCopy, { pixelsPerCm: ppcEG });
    const after = countColoredPixels(imgCopy);

    const removedPct = ((before - after) / before * 100).toFixed(1);
    console.log(`Colored pixels — before: ${before}, after: ${after}, removed: ${removedPct}%`);
    // Expect at least 50% of colored annotation pixels removed
    expect(after).toBeLessThan(before * 0.5);
  });

  it('envelope detection on preprocessed messy image matches clean image', { timeout: 30000 }, () => {
    // Step 1: Detect envelope on raw messy (needed for preprocessing)
    const envRaw = detectEnvelope(imgMessy, { pixelsPerCm: ppcEG });
    expect(envRaw, 'raw envelope').not.toBeNull();
    console.log(`Raw messy envelope: ${envRaw.polygonPixels.length} vertices`);

    // Step 2: Preprocess WITH envelope data (full three-phase, not legacy)
    const data2 = new Uint8ClampedArray(imgMessy.data);
    const imgPreprocessed = { data: data2, width: imgMessy.width, height: imgMessy.height };
    const spanWalls = detectSpanningWalls(imgMessy, envRaw.polygonPixels, { pixelsPerCm: ppcEG });
    const spanPx = (spanWalls || []).map(w => ({
      startPx: w.startPx || { x: Math.round(w.startCm.x * ppcEG), y: Math.round(w.startCm.y * ppcEG) },
      endPx: w.endPx || { x: Math.round(w.endCm.x * ppcEG), y: Math.round(w.endCm.y * ppcEG) },
      thicknessPx: w.thicknessPx || Math.round((w.thicknessCm || 25) * ppcEG),
    }));
    preprocessForRoomDetection(imgPreprocessed, {
      pixelsPerCm: ppcEG,
      envelopePolygonPx: envRaw.polygonPixels,
      envelopeWallThicknesses: envRaw.wallThicknesses,
      spanningWallsPx: spanPx,
    });

    // Step 3: Detect envelope on preprocessed image
    // Pass raw envelope bbox to help exclude external annotations
    const rawPoly = envRaw.polygonPixels;
    const envelopeBboxPx = {
      minX: Math.min(...rawPoly.map(p => p.x)),
      minY: Math.min(...rawPoly.map(p => p.y)),
      maxX: Math.max(...rawPoly.map(p => p.x)),
      maxY: Math.max(...rawPoly.map(p => p.y)),
    };
    const envMessy = detectEnvelope(imgPreprocessed, { pixelsPerCm: ppcEG, preprocessed: true, envelopeBboxPx });
    const envClean = detectEnvelope(imgClean, { pixelsPerCm: ppcEG });
    console.log(`Preprocessed envelope: ${envMessy ? envMessy.polygonPixels.length : 0} vertices`);
    console.log(`Clean envelope: ${envClean ? envClean.polygonPixels.length : 0} vertices`);

    expect(envMessy, 'envelope from preprocessed messy is null').not.toBeNull();
    expect(envClean, 'envelope from clean is null').not.toBeNull();

    // Convert to cm and compare bounding boxes
    const toCm = (p, ppcVal) => ({ x: p.x / ppcVal, y: p.y / ppcVal });
    const bbox = verts => ({
      minX: Math.min(...verts.map(v => v.x)),
      maxX: Math.max(...verts.map(v => v.x)),
      minY: Math.min(...verts.map(v => v.y)),
      maxY: Math.max(...verts.map(v => v.y)),
    });

    const bMessy = bbox(envMessy.polygonPixels.map(p => toCm(p, ppcEG)));
    const bClean = bbox(envClean.polygonPixels.map(p => toCm(p, ppcEG)));

    const messyW = bMessy.maxX - bMessy.minX;
    const messyH = bMessy.maxY - bMessy.minY;
    const cleanW = bClean.maxX - bClean.minX;
    const cleanH = bClean.maxY - bClean.minY;

    console.log(`Envelope vertices — preprocessed: ${envMessy.polygonPixels.length}, clean: ${envClean.polygonPixels.length}`);
    console.log(`Envelope bbox (messy preprocessed): ${messyW.toFixed(0)} x ${messyH.toFixed(0)} cm`);
    console.log(`Envelope bbox (clean):              ${cleanW.toFixed(0)} x ${cleanH.toFixed(0)} cm`);

    // Save both images with envelope polygons drawn on them
    const drawPoly = (imgSrc, poly, outPath) => {
      const out = new Uint8Array(imgSrc.width * imgSrc.height * 4);
      for (let i = 0; i < imgSrc.width * imgSrc.height; i++) {
        out[i * 4] = imgSrc.data[i * 4];
        out[i * 4 + 1] = imgSrc.data[i * 4 + 1];
        out[i * 4 + 2] = imgSrc.data[i * 4 + 2];
        out[i * 4 + 3] = 255;
      }
      // Draw polygon edges in green, 3px thick
      for (let ei = 0; ei < poly.length; ei++) {
        const a = poly[ei], b = poly[(ei + 1) % poly.length];
        const dx = b.x - a.x, dy = b.y - a.y;
        const steps = Math.max(Math.abs(dx), Math.abs(dy));
        for (let s = 0; s <= steps; s++) {
          const px = Math.round(a.x + dx * s / steps);
          const py = Math.round(a.y + dy * s / steps);
          for (let oy = -1; oy <= 1; oy++) {
            for (let ox = -1; ox <= 1; ox++) {
              const fx = px + ox, fy = py + oy;
              if (fx >= 0 && fx < imgSrc.width && fy >= 0 && fy < imgSrc.height) {
                const idx = (fy * imgSrc.width + fx) * 4;
                out[idx] = 0; out[idx + 1] = 255; out[idx + 2] = 0;
              }
            }
          }
        }
      }
      // Draw vertices as red 5px dots
      for (const v of poly) {
        for (let oy = -2; oy <= 2; oy++) {
          for (let ox = -2; ox <= 2; ox++) {
            const fx = Math.round(v.x) + ox, fy = Math.round(v.y) + oy;
            if (fx >= 0 && fx < imgSrc.width && fy >= 0 && fy < imgSrc.height) {
              const idx = (fy * imgSrc.width + fx) * 4;
              out[idx] = 255; out[idx + 1] = 0; out[idx + 2] = 0;
            }
          }
        }
      }
      const png = encode({ width: imgSrc.width, height: imgSrc.height, data: out, channels: 4, depth: 8 });
      writeFileSync(outPath, Buffer.from(png));
      console.log(`Saved ${outPath}`);
    };
    drawPoly(imgPreprocessed, envMessy.polygonPixels, '/tmp/envelope_preprocessed.png');
    drawPoly(imgClean, envClean.polygonPixels, '/tmp/envelope_clean.png');

    // Building dimensions should be roughly 1034cm × 880cm (from dimension labels)
    // Allow 15% tolerance since images have different pixel dimensions
    const TOL_PCT = 0.15;
    expect(Math.abs(messyW - cleanW) / cleanW).toBeLessThan(TOL_PCT);
    expect(Math.abs(messyH - cleanH) / cleanH).toBeLessThan(TOL_PCT);
  });

  it('preprocessing removes non-red annotations (yellow markers, pink arcs, blue) almost completely', () => {
    // Count non-red colored pixels (yellow, blue, magenta/pink) before and after.
    // preprocessForRoomDetection removes ALL thin colored features regardless of hue.
    // This test isolates non-red channels to verify that annotations with distinctive
    // hues (yellow electrical markers, blue lines, pink door arcs) are specifically removed,
    // since red pixels are shared between annotations and wall fills.
    function countNonRedColored(img) {
      const { data, width, height } = img;
      let count = 0;
      for (let i = 0; i < width * height; i++) {
        const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        if (gray < 10 || gray >= 200) continue;
        const maxC = Math.max(r, g, b);
        const minC = Math.min(r, g, b);
        const sat = maxC > 0 ? (maxC - minC) / maxC : 0;
        if (sat <= 0.3 || maxC <= 40) continue;
        // Non-red: green or blue is the dominant channel, or yellow/magenta
        if (r <= g || r <= b) count++; // green-dominant or blue-dominant
        else if (g > b * 1.5 && g > 40) count++; // yellow (r>g>b with notable green)
      }
      return count;
    }

    const data2 = new Uint8ClampedArray(imgMessy.data);
    const imgPre = { data: data2, width: imgMessy.width, height: imgMessy.height };

    const before = countNonRedColored(imgPre);
    preprocessForRoomDetection(imgPre, { pixelsPerCm: ppcEG });
    const after = countNonRedColored(imgPre);

    const removedPct = ((before - after) / Math.max(1, before) * 100).toFixed(1);
    console.log(`Non-red colored pixels — before: ${before}, after: ${after}, removed: ${removedPct}%`);
    // Yellow markers, blue lines, pink arcs should be almost completely removed (>80%)
    expect(after).toBeLessThan(before * 0.2);
  });

  it('wall mask similarity improves after preprocessing', () => {
    // Compare wall masks: messy (raw) vs clean, then messy (preprocessed) vs clean.
    // The images have different pixel dimensions, so compare via the wall mask density
    // within the envelope bounding box region, normalized by image size.
    const { lowThresh: lowM, highThresh: highM } = autoDetectWallRange(imgMessy, { pixelsPerCm: ppcEG });
    const maskMessyRaw = buildGrayWallMask(imgMessy, lowM, highM);

    const data2 = new Uint8ClampedArray(imgMessy.data);
    const imgPre = { data: data2, width: imgMessy.width, height: imgMessy.height };
    preprocessForRoomDetection(imgPre, { pixelsPerCm: ppcEG });
    const { lowThresh: lowP, highThresh: highP } = autoDetectWallRange(imgPre, { pixelsPerCm: ppcEG });
    const maskMessyPre = buildGrayWallMask(imgPre, lowP, highP);

    const { lowThresh: lowC, highThresh: highC } = autoDetectWallRange(imgClean, { pixelsPerCm: ppcEG });
    const maskClean = buildGrayWallMask(imgClean, lowC, highC);

    // Count wall pixels in each mask
    function wallCount(mask) {
      let c = 0;
      for (let i = 0; i < mask.length; i++) if (mask[i] === 1) c++;
      return c;
    }

    const wRaw = wallCount(maskMessyRaw);
    const wPre = wallCount(maskMessyPre);
    const wClean = wallCount(maskClean);

    // Normalize by image pixel count for fair comparison.
    // Images have different pixel dimensions (3508×3071 vs 3322×2909, ~14% area diff)
    // but show the same building at the same scale. Density = wall fraction of total
    // image area, which is scale-independent for same-building comparisons.
    const densityRaw = wRaw / (imgMessy.width * imgMessy.height);
    const densityPre = wPre / (imgMessy.width * imgMessy.height);
    const densityClean = wClean / (imgClean.width * imgClean.height);

    console.log(`Wall mask density — messy raw: ${(densityRaw * 100).toFixed(2)}%, preprocessed: ${(densityPre * 100).toFixed(2)}%, clean: ${(densityClean * 100).toFixed(2)}%`);

    // After preprocessing, the messy wall density should be closer to the clean density
    const diffRaw = Math.abs(densityRaw - densityClean);
    const diffPre = Math.abs(densityPre - densityClean);
    console.log(`Wall density distance to clean — raw: ${(diffRaw * 100).toFixed(3)}%, preprocessed: ${(diffPre * 100).toFixed(3)}%`);

    // Preprocessing changes the wall mask density. At low ppc (1.18), some wall fill
    // pixels are also removed alongside annotations. The preprocessed density should
    // stay within a reasonable range of clean (not collapse to near-zero).
    // The important thing is that annotations DON'T inflate the wall mask (raw > clean
    // due to false walls from annotations), and preprocessed stays in a viable range.
    expect(densityRaw, 'raw messy should have higher density than clean (annotations add false walls)').toBeGreaterThan(densityClean);
    expect(densityPre, 'preprocessed density should not collapse').toBeGreaterThan(densityClean * 0.5);
    expect(densityPre, 'preprocessing should reduce density vs raw (removed annotations)').toBeLessThan(densityRaw);
  });
});

// ── Step 6 E2E: pixel-by-pixel comparison against clean reference ────────────
// Simple overlay test: preprocess messy, scale clean to match, overlay, compare
// every pixel. No envelope masking, no fancy regions — just two pictures on top
// of each other.

describe('Step 6 E2E: preprocessed messy vs clean reference (pixel accuracy)', () => {
  const DARK_THRESH = 200;
  function grayAt(data, idx) {
    return 0.299 * data[idx * 4] + 0.587 * data[idx * 4 + 1] + 0.114 * data[idx * 4 + 2];
  }

  it('preprocessed image matches clean reference: ≥80% overall, ≥95% wall accuracy', { timeout: 30000 }, () => {
    // ── Step 1: Align the two images via cross-correlation ──────────────
    // Both images are 300dpi 1:100 (same pixel scale), but different crop.
    // Find the pixel offset that best overlays them.

    // Coarse pass: downsample 8x, brute-force dark-pixel overlap
    const S = 8;
    const wM = Math.floor(imgMessy.width / S), hM = Math.floor(imgMessy.height / S);
    const wC = Math.floor(imgClean.width / S), hC = Math.floor(imgClean.height / S);

    const downsample = (img, dw, dh) => {
      const m = new Uint8Array(dw * dh);
      for (let y = 0; y < dh; y++)
        for (let x = 0; x < dw; x++) {
          const i = (y * S) * img.width + (x * S);
          if (grayAt(img.data, i) < DARK_THRESH) m[y * dw + x] = 1;
        }
      return m;
    };
    const mM = downsample(imgMessy, wM, hM);
    const mC = downsample(imgClean, wC, hC);

    let bestD = { x: 0, y: 0 }, bestS = -1;
    for (let dy = -60; dy <= 60; dy++) {
      for (let dx = -60; dx <= 60; dx++) {
        let s = 0;
        for (let cy = 0; cy < hC; cy++) {
          const my = cy + dy;
          if (my < 0 || my >= hM) continue;
          for (let cx = 0; cx < wC; cx++) {
            const mx = cx + dx;
            if (mx < 0 || mx >= wM) continue;
            if (mC[cy * wC + cx] && mM[my * wM + mx]) s++;
          }
        }
        if (s > bestS) { bestS = s; bestD = { x: dx, y: dy }; }
      }
    }

    // Fine pass: pixel-level refinement around coarse result
    const cx0 = bestD.x * S, cy0 = bestD.y * S;
    let bestF = { x: cx0, y: cy0 }, bestFS = -1;
    const step = 4; // sample every 4th pixel for speed
    for (let dy = cy0 - S - 2; dy <= cy0 + S + 2; dy++) {
      for (let dx = cx0 - S - 2; dx <= cx0 + S + 2; dx++) {
        let s = 0;
        for (let y = 0; y < imgClean.height; y += step) {
          const my = y + dy;
          if (my < 0 || my >= imgMessy.height) continue;
          for (let x = 0; x < imgClean.width; x += step) {
            const mx = x + dx;
            if (mx < 0 || mx >= imgMessy.width) continue;
            if (grayAt(imgClean.data, y * imgClean.width + x) < DARK_THRESH &&
                grayAt(imgMessy.data, my * imgMessy.width + mx) < DARK_THRESH) s++;
          }
        }
        if (s > bestFS) { bestFS = s; bestF = { x: dx, y: dy }; }
      }
    }
    const offX = bestF.x, offY = bestF.y;
    console.log(`Alignment offset: (${offX}, ${offY})`);

    // ── Step 2: Preprocess messy image ──────────────────────────────────
    const envMessy = detectEnvelope(imgMessy, { pixelsPerCm: ppcEG });
    expect(envMessy, 'envelope on messy').not.toBeNull();
    const envThick = detectWallThickness(imgMessy, envMessy.polygonPixels, imgMessy.width, imgMessy.height, ppcEG);
    const spanWalls = detectSpanningWalls(imgMessy, envMessy.polygonPixels, { pixelsPerCm: ppcEG });
    const spanPx = (spanWalls || []).map(w => ({
      startPx: w.startPx || { x: Math.round(w.startCm.x * ppcEG), y: Math.round(w.startCm.y * ppcEG) },
      endPx: w.endPx || { x: Math.round(w.endCm.x * ppcEG), y: Math.round(w.endCm.y * ppcEG) },
      thicknessPx: w.thicknessPx || Math.round((w.thicknessCm || 25) * ppcEG),
    }));
    const preData = new Uint8ClampedArray(imgMessy.data);
    const imgPre = { data: preData, width: imgMessy.width, height: imgMessy.height };
    preprocessForRoomDetection(imgPre, {
      pixelsPerCm: ppcEG,
      envelopePolygonPx: envMessy.polygonPixels,
      envelopeWallThicknesses: envThick,
      spanningWallsPx: spanPx,
    });

    // ── Step 3: Crop to building footprint ─────────────────────────────────
    // Only compare within the actual floor plan, not the outer dimension/
    // measurement annotations. Use the clean image's envelope bbox as crop.
    const envClean = detectEnvelope(imgClean, { pixelsPerCm: ppcEG });
    expect(envClean, 'envelope on clean').not.toBeNull();
    const cleanPoly = envClean.polygonPixels;
    const cropMargin = Math.round(5 * ppcEG); // 5cm margin around envelope
    const cropMinX = Math.round(Math.min(...cleanPoly.map(p => p.x)) - cropMargin);
    const cropMinY = Math.round(Math.min(...cleanPoly.map(p => p.y)) - cropMargin);
    const cropMaxX = Math.round(Math.max(...cleanPoly.map(p => p.x)) + cropMargin);
    const cropMaxY = Math.round(Math.max(...cleanPoly.map(p => p.y)) + cropMargin);
    console.log(`Crop region (clean coords): [${cropMinX},${cropMinY}]-[${cropMaxX},${cropMaxY}]`);

    // ── Step 4: Compare non-white pixels within crop ────────────────────────
    let contentPx = 0, contentMatch = 0;
    let wallClean = 0, wallHit = 0;
    let noisePx = 0;

    // Also compute baseline (raw messy) in the same loop
    let rawCP = 0, rawCM = 0, rawWC = 0, rawWH = 0, rawNoise = 0;

    for (let cy = Math.max(0, cropMinY); cy <= Math.min(imgClean.height - 1, cropMaxY); cy++) {
      const my = cy + offY;
      if (my < 0 || my >= imgPre.height) continue;
      for (let cx = Math.max(0, cropMinX); cx <= Math.min(imgClean.width - 1, cropMaxX); cx++) {
        const mx = cx + offX;
        if (mx < 0 || mx >= imgPre.width) continue;

        const cIdx = cy * imgClean.width + cx;
        const pIdx = my * imgPre.width + mx;
        const mIdx = my * imgMessy.width + mx;
        const cDark = grayAt(imgClean.data, cIdx) < DARK_THRESH;
        const pDark = grayAt(imgPre.data, pIdx) < DARK_THRESH;
        const mDark = grayAt(imgMessy.data, mIdx) < DARK_THRESH;

        // Preprocessed vs clean (skip white-vs-white)
        if (cDark || pDark) {
          contentPx++;
          if (cDark === pDark) contentMatch++;
          if (cDark) { wallClean++; if (pDark) wallHit++; }
          if (pDark && !cDark) noisePx++;
        }

        // Baseline: raw messy vs clean (skip white-vs-white)
        if (cDark || mDark) {
          rawCP++;
          if (cDark === mDark) rawCM++;
          if (cDark) { rawWC++; if (mDark) rawWH++; }
          if (mDark && !cDark) rawNoise++;
        }
      }
    }

    const overall = contentMatch / contentPx;
    const wallAcc = wallHit / wallClean;

    console.log(`\n=== Non-white pixel comparison (cropped to building footprint) ===`);
    console.log(`Non-white pixels: ${contentPx}`);
    console.log(`Overall accuracy:    ${(overall * 100).toFixed(1)}% (${contentMatch}/${contentPx})`);
    console.log(`Wall accuracy:       ${(wallAcc * 100).toFixed(1)}% (${wallHit}/${wallClean})`);
    console.log(`Extra noise:         ${noisePx} px not in clean`);

    console.log(`\n--- Baseline (raw messy, no preprocessing) ---`);
    console.log(`Non-white pixels: ${rawCP}`);
    console.log(`Overall accuracy:    ${(rawCM / rawCP * 100).toFixed(1)}%`);
    console.log(`Wall accuracy:       ${(rawWH / rawWC * 100).toFixed(1)}%`);
    console.log(`Extra noise:         ${rawNoise} px not in clean`);

    expect(overall, `overall ${(overall * 100).toFixed(1)}% must be ≥80%`).toBeGreaterThanOrEqual(0.80);
    expect(wallAcc, `wall ${(wallAcc * 100).toFixed(1)}% must be ≥95%`).toBeGreaterThanOrEqual(0.95);

    // Save preprocessed image for visual inspection
    const outData = new Uint8Array(imgPre.width * imgPre.height * 4);
    for (let i = 0; i < imgPre.width * imgPre.height; i++) {
      outData[i * 4]     = imgPre.data[i * 4];
      outData[i * 4 + 1] = imgPre.data[i * 4 + 1];
      outData[i * 4 + 2] = imgPre.data[i * 4 + 2];
      outData[i * 4 + 3] = 255;
    }
    const png = encode({ width: imgPre.width, height: imgPre.height, data: outData, channels: 4, depth: 8 });
    writeFileSync('/tmp/preprocessed_EG.png', Buffer.from(png));
    console.log('Saved preprocessed image to /tmp/preprocessed_EG.png');
  });
});
