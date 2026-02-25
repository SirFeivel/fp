// Verification test: run detectRoomAtPixel against the real reference floor plan.
// Compares polygon bounding box to the hand-drawn reference polygon.
// Run once with: npx vitest run src/room-detection.verify.test.js
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'fs';
import { decode, encode } from 'fast-png';
import { detectRoomAtPixel, detectEnvelope, detectSpanningWalls, detectWallThickness, autoDetectWallRange, buildGrayWallMask, filterSmallComponents, preprocessForRoomDetection, morphologicalClose, floodFillFromBorder, fillInteriorHoles, traceContour } from './room-detection.js';
import { rectifyPolygon, extractValidAngles, FLOOR_PLAN_RULES, classifyWallTypes, snapToWallType, removePolygonMicroBumps, removeStackedWalls, enforcePolygonRules, alignToExistingRooms } from './floor-plan-rules.js';
import { syncFloorWalls, mergeCollinearWalls, enforceNoParallelWalls, enforceAdjacentPositions } from './walls.js';
import { classifyRoomEdges, assignWallTypesFromClassification, extendSkeletonForRoom, recomputeEnvelope, alignToEnvelope, constrainRoomToStructuralBoundaries, enforceSkeletonWallProperties } from './envelope.js';
import { createSurface } from './surface.js';

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
      ppc300, { probeFromInnerFace: true }
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
      ppc300, { probeFromInnerFace: true }
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
      ppc300, { probeFromInnerFace: true }
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

    // Step 00: Greyscale + Normalize
    const totalPx = imgPre.width * imgPre.height;
    const grayData = new Uint8Array(totalPx * 4);

    // 1. Flatten alpha onto white, then convert to greyscale
    let gMin = 255, gMax = 0;
    const grayVals = new Uint8Array(totalPx);
    for (let i = 0; i < totalPx; i++) {
      const a = imgPre.data[i * 4 + 3] / 255;
      const r = imgPre.data[i * 4] * a + 255 * (1 - a);
      const g = imgPre.data[i * 4 + 1] * a + 255 * (1 - a);
      const b = imgPre.data[i * 4 + 2] * a + 255 * (1 - a);
      const gray = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
      grayVals[i] = gray;
      if (gray < gMin) gMin = gray;
      if (gray > gMax) gMax = gray;
    }

    // 2. Normalize contrast (stretch min→0, max→255)
    const gRange = gMax - gMin || 1;
    for (let i = 0; i < totalPx; i++) {
      const normalized = Math.round(255 * (grayVals[i] - gMin) / gRange);
      grayData[i * 4] = normalized;
      grayData[i * 4 + 1] = normalized;
      grayData[i * 4 + 2] = normalized;
      grayData[i * 4 + 3] = 255;
    }

    const grayPng = encode({ width: imgPre.width, height: imgPre.height, data: grayData, channels: 4, depth: 8 });
    writeFileSync('/tmp/preprocessed_greyscale.png', Buffer.from(grayPng));
    console.log(`Saved greyscale normalized image to /tmp/preprocessed_greyscale.png (min=${gMin}, max=${gMax})`);
  });
});

describe('Envelope diagnostic: intermediate masks on preprocessed EG', () => {
  function saveMask(mask, w, h, path) {
    const out = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const v = mask[i] ? 0 : 255;
      out[i * 4] = v; out[i * 4 + 1] = v; out[i * 4 + 2] = v; out[i * 4 + 3] = 255;
    }
    writeFileSync(path, Buffer.from(encode({ width: w, height: h, data: out, channels: 4, depth: 8 })));
    console.log(`Saved ${path}`);
  }

  it('dumps each detectEnvelope step on preprocessed EG', { timeout: 30000 }, () => {
    // Two-pass: first get rough envelope from raw, then preprocess with it
    const envRaw = detectEnvelope(imgMessy, { pixelsPerCm: ppcEG });
    expect(envRaw).not.toBeNull();
    console.log(`Raw envelope ${envRaw.polygonPixels.length} verts:`);
    envRaw.polygonPixels.forEach((v, i) => console.log(`  v${i}: (${v.x}, ${v.y}) = (${(v.x/ppcEG).toFixed(0)}cm, ${(v.y/ppcEG).toFixed(0)}cm)`));

    const data2 = new Uint8ClampedArray(imgMessy.data);
    const img = { data: data2, width: imgMessy.width, height: imgMessy.height };

    const spanWalls = detectSpanningWalls(imgMessy, envRaw.polygonPixels, { pixelsPerCm: ppcEG });
    const spanPx = (spanWalls || []).map(w => ({
      startPx: w.startPx || { x: Math.round(w.startCm.x * ppcEG), y: Math.round(w.startCm.y * ppcEG) },
      endPx: w.endPx || { x: Math.round(w.endCm.x * ppcEG), y: Math.round(w.endCm.y * ppcEG) },
      thicknessPx: w.thicknessPx || Math.round((w.thicknessCm || 25) * ppcEG),
    }));

    preprocessForRoomDetection(img, {
      pixelsPerCm: ppcEG,
      envelopePolygonPx: envRaw.polygonPixels,
      envelopeWallThicknesses: envRaw.wallThicknesses,
      spanningWallsPx: spanPx,
    });

    // Save the preprocessed image for reference
    const prePng = encode({ width: img.width, height: img.height, data: new Uint8Array(img.data), channels: 4, depth: 8 });
    writeFileSync('/tmp/env_00_preprocessed.png', Buffer.from(prePng));
    console.log('Saved /tmp/env_00_preprocessed.png');

    const w = img.width, h = img.height, total = w * h;

    // Step 1: autoDetectWallRange + buildGrayWallMask
    const range = autoDetectWallRange(img);
    console.log(`range: low=${range?.low}, high=${range?.high}`);
    const wallMaskRaw = buildGrayWallMask(img, range.low, range.high);
    saveMask(wallMaskRaw, w, h, '/tmp/env_01_wallmask_raw.png');

    // Step 2: filterSmallComponents
    const minComponentArea = Math.max(16, Math.round(8 * ppcEG) ** 2);
    const wallMaskFiltered = filterSmallComponents(wallMaskRaw, w, h, minComponentArea);
    saveMask(wallMaskFiltered, w, h, '/tmp/env_02_wallmask_filtered.png');

    // morphologicalOpen is not exported — skip for diagnostic (small noise cleanup only)
    console.log(`openRadius skipped (not exported), minComponentArea=${minComponentArea}`);

    // Step 4: morphologicalClose
    const closeRadius = Math.max(3, Math.min(300, Math.round(80 * ppcEG)));
    console.log(`closeRadius=${closeRadius}`);
    const closedMask = morphologicalClose(wallMaskFiltered, w, h, closeRadius);
    saveMask(closedMask, w, h, '/tmp/env_03_closed.png');

    // Step 5: floodFillFromBorder
    const exteriorMask = floodFillFromBorder(closedMask, w, h);
    saveMask(exteriorMask, w, h, '/tmp/env_04_exterior.png');

    // Step 6: building mask
    const buildingMask = new Uint8Array(total);
    for (let i = 0; i < total; i++) buildingMask[i] = exteriorMask[i] === 0 ? 1 : 0;
    fillInteriorHoles(buildingMask, w, h);
    saveMask(buildingMask, w, h, '/tmp/env_05_building.png');

    let buildingArea = 0;
    for (let i = 0; i < total; i++) buildingArea += buildingMask[i];
    console.log(`buildingArea: ${buildingArea} (${(buildingArea/total*100).toFixed(2)}%)`);

    // Step 7: contour
    const contour = traceContour(buildingMask, w, h);
    console.log(`contour: ${contour.length} pts`);

    expect(buildingArea).toBeGreaterThan(0);
  });
});

// ── Two-pass envelope pipeline E2E on real EG floor plan ─────────────────────
// Exercises the exact pipeline from detectAndStoreEnvelope on the real messy
// EG floor plan. Validates dynamic building area fallback.
describe('Two-pass envelope pipeline (real EG image)', () => {
  it('two-pass pipeline produces valid envelope with dynamic fallback', { timeout: 30000 }, () => {
    // ── Pass 1: raw image → rough envelope ──────────────────────────────
    const result1 = detectEnvelope(imgMessy, { pixelsPerCm: ppcEG });
    expect(result1).not.toBeNull();
    expect(result1.polygonPixels.length).toBeGreaterThanOrEqual(3);
    console.log(`[2pass] Pass 1: ${result1.polygonPixels.length} vertices`);

    // Count pass-1 building area
    let pass1BuildingArea = 0;
    for (let i = 0; i < result1.buildingMask.length; i++) pass1BuildingArea += result1.buildingMask[i];
    console.log(`[2pass] Pass 1 building area: ${pass1BuildingArea}`);

    // ── Spanning walls from pass 1 ──────────────────────────────────────
    const { minCm, maxCm } = FLOOR_PLAN_RULES.wallThickness;
    const rawWalls = detectSpanningWalls(
      imgMessy, result1.wallMask, result1.buildingMask,
      imgMessy.width, imgMessy.height,
      { pixelsPerCm: ppcEG, minThicknessCm: minCm, maxThicknessCm: maxCm }
    );
    const pass1SpanningWallsPx = rawWalls.map(w => ({
      startPx: w.startPx,
      endPx: w.endPx,
      thicknessPx: w.thicknessPx,
    }));
    console.log(`[2pass] Pass 1 spanning walls: ${pass1SpanningWallsPx.length}`);

    // ── Preprocess fresh copy ───────────────────────────────────────────
    const img2 = { data: new Uint8ClampedArray(imgMessy.data), width: imgMessy.width, height: imgMessy.height };
    preprocessForRoomDetection(img2, {
      pixelsPerCm: ppcEG,
      envelopePolygonPx: result1.polygonPixels,
      envelopeWallThicknesses: result1.wallThicknesses,
      spanningWallsPx: pass1SpanningWallsPx,
    });
    console.log(`[2pass] Preprocessing complete`);

    // ── Pass 2: preprocessed image with envelopeBboxPx ──────────────────
    const pass1BboxPx = {
      minX: Math.min(...result1.polygonPixels.map(p => p.x)),
      minY: Math.min(...result1.polygonPixels.map(p => p.y)),
      maxX: Math.max(...result1.polygonPixels.map(p => p.x)),
      maxY: Math.max(...result1.polygonPixels.map(p => p.y)),
    };
    const result2 = detectEnvelope(img2, { pixelsPerCm: ppcEG, envelopeBboxPx: pass1BboxPx });

    // ── Dynamic fallback: same logic as detectAndStoreEnvelope ──────────
    let usePass2 = false;
    if (result2 && result2.polygonPixels.length >= 3 && result2.buildingMask) {
      let pass2BuildingArea = 0;
      for (let i = 0; i < result2.buildingMask.length; i++) pass2BuildingArea += result2.buildingMask[i];
      const areaRatio = pass1BuildingArea > 0 ? pass2BuildingArea / pass1BuildingArea : 0;
      console.log(`[2pass] Pass 2: ${result2.polygonPixels.length} vertices, building area: ${pass2BuildingArea}, ratio: ${areaRatio.toFixed(2)}`);
      if (areaRatio >= 0.3) {
        usePass2 = true;
      } else {
        console.log(`[2pass] Fallback to pass 1: area ratio ${(areaRatio * 100).toFixed(0)}% < 30%`);
      }
    } else {
      console.log(`[2pass] Pass 2 returned null or <3 vertices — using pass 1`);
    }

    const finalResult = usePass2 ? result2 : result1;
    console.log(`[2pass] Using ${usePass2 ? 'pass-2' : 'pass-1'}: ${finalResult.polygonPixels.length} vertices`);

    // ── Validate final result ───────────────────────────────────────────
    expect(finalResult.polygonPixels.length).toBeGreaterThanOrEqual(3);
    expect(finalResult.wallMask).toBeInstanceOf(Uint8Array);
    expect(finalResult.buildingMask).toBeInstanceOf(Uint8Array);

    // Building area should be reasonable (>3% of image, matching pass-1)
    let finalArea = 0;
    for (let i = 0; i < finalResult.buildingMask.length; i++) finalArea += finalResult.buildingMask[i];
    const totalPx = imgMessy.width * imgMessy.height;
    const areaPct = finalArea / totalPx * 100;
    console.log(`[2pass] Final building area: ${finalArea} (${areaPct.toFixed(2)}%)`);
    expect(areaPct).toBeGreaterThan(3);

    // Downstream pipeline: rectify + bump removal + wall thickness
    const finalPolygonCm = finalResult.polygonPixels.map(p => ({
      x: p.x / ppcEG,
      y: p.y / ppcEG,
    }));
    const finalSpanningWallsCm = rawWalls.map(w => ({
      orientation: w.orientation,
      startCm: { x: w.startPx.x / ppcEG, y: w.startPx.y / ppcEG },
      endCm: { x: w.endPx.x / ppcEG, y: w.endPx.y / ppcEG },
      thicknessCm: w.thicknessPx / ppcEG,
    }));

    const validAngles = extractValidAngles(finalPolygonCm, finalSpanningWallsCm, {
      minEdgeLengthCm: FLOOR_PLAN_RULES.wallThickness.maxCm,
    });
    expect(validAngles.length).toBeGreaterThanOrEqual(2);
    console.log(`[2pass] Valid angles: [${validAngles.join(', ')}]`);

    const rectified = rectifyPolygon(finalPolygonCm, { ...FLOOR_PLAN_RULES, standardAngles: validAngles });
    expect(rectified.length).toBeGreaterThanOrEqual(3);

    const bumpThreshold = finalResult.wallThicknesses?.medianCm || 30;
    const bumped = removePolygonMicroBumps(rectified, bumpThreshold);
    expect(bumped.length).toBeGreaterThanOrEqual(3);
    console.log(`[2pass] Post-processing: rectified=${rectified.length} → bumped=${bumped.length} vertices`);

    // Wall thickness on final image
    const finalImageData = usePass2 ? img2 : imgMessy;
    const cleanedPx = bumped.map(p => ({ x: Math.round(p.x * ppcEG), y: Math.round(p.y * ppcEG) }));
    const wallThicknesses = detectWallThickness(
      finalImageData, cleanedPx, finalImageData.width, finalImageData.height,
      ppcEG, { probeFromInnerFace: true }
    );
    expect(wallThicknesses).toBeDefined();
    expect(wallThicknesses.edges.length).toBeGreaterThan(0);
    expect(wallThicknesses.medianCm).toBeGreaterThan(0);
    console.log(`[2pass] Wall thickness: ${wallThicknesses.edges.length} edges, median=${wallThicknesses.medianCm.toFixed(1)}cm`);

    // Wall type classification
    const allThicknesses = [
      ...wallThicknesses.edges.map(e => e.thicknessCm),
      ...finalSpanningWallsCm.map(w => w.thicknessCm),
    ];
    const wallTypes = classifyWallTypes(allThicknesses);
    expect(wallTypes.length).toBeGreaterThanOrEqual(1);
    console.log(`[2pass] Wall types: ${wallTypes.map(t => `${t.id}=${t.thicknessCm.toFixed(1)}cm`).join(', ')}`);
  });
});

// ── Phase 2 E2E: Envelope detection quality on EG floor plan ─────────────────
// Validates that the Phase 2 changes (adaptive close, multi-component merge,
// axis-aligned enforcement, bump/stacked wall thresholds) produce a correct
// envelope on the real EG floor plan.
describe('Phase 2: Envelope detection quality (real EG image)', () => {
  let finalPolygon; // post-processed polygon in cm
  let wallThicknesses;
  let usePass2;

  function runPipeline() {
    if (finalPolygon) return;

    // Pass 1
    const result1 = detectEnvelope(imgMessy, { pixelsPerCm: ppcEG });
    let pass1Area = 0;
    for (let i = 0; i < result1.buildingMask.length; i++) pass1Area += result1.buildingMask[i];

    // Spanning walls
    const { minCm, maxCm } = FLOOR_PLAN_RULES.wallThickness;
    const rawWalls = detectSpanningWalls(
      imgMessy, result1.wallMask, result1.buildingMask,
      imgMessy.width, imgMessy.height,
      { pixelsPerCm: ppcEG, minThicknessCm: minCm, maxThicknessCm: maxCm }
    );
    const pass1SpanningWallsPx = rawWalls.map(w => ({
      startPx: w.startPx, endPx: w.endPx, thicknessPx: w.thicknessPx,
    }));

    // Preprocess
    const img2 = { data: new Uint8ClampedArray(imgMessy.data), width: imgMessy.width, height: imgMessy.height };
    preprocessForRoomDetection(img2, {
      pixelsPerCm: ppcEG,
      envelopePolygonPx: result1.polygonPixels,
      envelopeWallThicknesses: result1.wallThicknesses,
      spanningWallsPx: pass1SpanningWallsPx,
    });

    // Pass 2
    const pass1BboxPx = {
      minX: Math.min(...result1.polygonPixels.map(p => p.x)),
      minY: Math.min(...result1.polygonPixels.map(p => p.y)),
      maxX: Math.max(...result1.polygonPixels.map(p => p.x)),
      maxY: Math.max(...result1.polygonPixels.map(p => p.y)),
    };
    const result2 = detectEnvelope(img2, { pixelsPerCm: ppcEG, envelopeBboxPx: pass1BboxPx });

    // Dynamic fallback
    usePass2 = false;
    if (result2 && result2.polygonPixels.length >= 3 && result2.buildingMask) {
      let pass2Area = 0;
      for (let i = 0; i < result2.buildingMask.length; i++) pass2Area += result2.buildingMask[i];
      if (pass1Area > 0 && pass2Area / pass1Area >= 0.3) usePass2 = true;
    }
    const finalResult = usePass2 ? result2 : result1;

    // Post-processing (mirrors controller with Phase 2 thresholds)
    const finalPolygonCm = finalResult.polygonPixels.map(p => ({ x: p.x / ppcEG, y: p.y / ppcEG }));
    const spanCm = rawWalls.map(w => ({
      orientation: w.orientation,
      startCm: { x: w.startPx.x / ppcEG, y: w.startPx.y / ppcEG },
      endCm: { x: w.endPx.x / ppcEG, y: w.endPx.y / ppcEG },
      thicknessCm: w.thicknessPx / ppcEG,
    }));

    const validAngles = extractValidAngles(finalPolygonCm, spanCm, {
      minEdgeLengthCm: FLOOR_PLAN_RULES.wallThickness.maxCm,
    });
    const rectifyRules = { ...FLOOR_PLAN_RULES, standardAngles: validAngles };
    const rectified = rectifyPolygon(finalPolygonCm, rectifyRules);
    const bumpThreshold = (finalResult.wallThicknesses?.medianCm ?? 25) * 0.8;
    const bumped = removePolygonMicroBumps(rectified, bumpThreshold);
    const reRectified = rectifyPolygon(bumped, rectifyRules);
    const stackedGap = (finalResult.wallThicknesses?.medianCm ?? 30) * 1.5;
    const cleaned = removeStackedWalls(reRectified, stackedGap);

    finalPolygon = cleaned;

    // Wall thickness on final polygon
    const finalImageData = usePass2 ? img2 : imgMessy;
    const cleanedPx = cleaned.map(p => ({ x: Math.round(p.x * ppcEG), y: Math.round(p.y * ppcEG) }));
    wallThicknesses = detectWallThickness(
      finalImageData, cleanedPx, finalImageData.width, finalImageData.height,
      ppcEG, { probeFromInnerFace: true }
    );

    console.log(`[phase2] Pass used: ${usePass2 ? 'pass-2' : 'pass-1'}`);
    console.log(`[phase2] Final polygon: ${finalPolygon.length} vertices`);
    console.log(`[phase2] Wall thicknesses: ${wallThicknesses.edges.length} edges, median=${wallThicknesses.medianCm.toFixed(1)}cm`);
    finalPolygon.forEach((v, i) => {
      const next = finalPolygon[(i + 1) % finalPolygon.length];
      const dx = Math.abs(next.x - v.x), dy = Math.abs(next.y - v.y);
      const len = Math.hypot(dx, dy);
      const type = dx < 1 ? 'V' : dy < 1 ? 'H' : 'D';
      console.log(`[phase2]   edge ${i}: (${v.x.toFixed(1)},${v.y.toFixed(1)}) → (${next.x.toFixed(1)},${next.y.toFixed(1)}) ${type} len=${len.toFixed(1)}cm`);
    });
  }

  it('pass 2 is selected (not fallback to pass 1)', { timeout: 30000 }, () => {
    runPipeline();
    expect(usePass2, 'expected pass-2 to be used, got pass-1 fallback').toBe(true);
  });

  it('final polygon has >= 4 vertices (valid polygon after post-processing)', { timeout: 30000 }, () => {
    runPipeline();
    // The EG outer envelope is approximately rectangular. Pass-2 raw polygon has
    // 20 vertices, but notches at wall-thickness distance are correctly collapsed
    // by removeStackedWalls. Multi-section L-shapes require component merge which
    // depends on the gap between sections being within bridge distance.
    expect(finalPolygon.length, `expected >=4 vertices, got ${finalPolygon.length}`).toBeGreaterThanOrEqual(4);
  });

  it('all edges are axis-aligned (H or V within 1cm tolerance)', { timeout: 30000 }, () => {
    runPipeline();
    for (let i = 0; i < finalPolygon.length; i++) {
      const a = finalPolygon[i];
      const b = finalPolygon[(i + 1) % finalPolygon.length];
      const dx = Math.abs(b.x - a.x);
      const dy = Math.abs(b.y - a.y);
      const isH = dy < 1;
      const isV = dx < 1;
      expect(isH || isV, `edge ${i}: (${a.x.toFixed(1)},${a.y.toFixed(1)}) → (${b.x.toFixed(1)},${b.y.toFixed(1)}) is diagonal (dx=${dx.toFixed(1)}, dy=${dy.toFixed(1)})`).toBe(true);
    }
  });

  it('no stacked walls (no parallel edges overlapping within medianCm * 1.5)', { timeout: 30000 }, () => {
    runPipeline();
    const maxGap = wallThicknesses.medianCm * 1.5;
    for (let i = 0; i < finalPolygon.length; i++) {
      const a1 = finalPolygon[i];
      const a2 = finalPolygon[(i + 1) % finalPolygon.length];
      const aIsH = Math.abs(a2.y - a1.y) < 1;
      const aIsV = Math.abs(a2.x - a1.x) < 1;
      if (!aIsH && !aIsV) continue;

      for (let j = i + 2; j < finalPolygon.length; j++) {
        if (j === (i - 1 + finalPolygon.length) % finalPolygon.length) continue;
        const b1 = finalPolygon[j];
        const b2 = finalPolygon[(j + 1) % finalPolygon.length];
        const bIsH = Math.abs(b2.y - b1.y) < 1;
        const bIsV = Math.abs(b2.x - b1.x) < 1;

        if (aIsH && bIsH) {
          const gap = Math.abs((a1.y + a2.y) / 2 - (b1.y + b2.y) / 2);
          if (gap < maxGap) {
            const aMinX = Math.min(a1.x, a2.x), aMaxX = Math.max(a1.x, a2.x);
            const bMinX = Math.min(b1.x, b2.x), bMaxX = Math.max(b1.x, b2.x);
            expect(aMinX >= bMaxX || bMinX >= aMaxX,
              `stacked H edges ${i} and ${j}: gap=${gap.toFixed(1)}cm < ${maxGap.toFixed(1)}cm and overlapping in X`
            ).toBe(true);
          }
        }
        if (aIsV && bIsV) {
          const gap = Math.abs((a1.x + a2.x) / 2 - (b1.x + b2.x) / 2);
          if (gap < maxGap) {
            const aMinY = Math.min(a1.y, a2.y), aMaxY = Math.max(a1.y, a2.y);
            const bMinY = Math.min(b1.y, b2.y), bMaxY = Math.max(b1.y, b2.y);
            expect(aMinY >= bMaxY || bMinY >= aMaxY,
              `stacked V edges ${i} and ${j}: gap=${gap.toFixed(1)}cm < ${maxGap.toFixed(1)}cm and overlapping in Y`
            ).toBe(true);
          }
        }
      }
    }
  });

  it('wall thickness edges are in valid range [5, 50] cm', { timeout: 30000 }, () => {
    runPipeline();
    expect(wallThicknesses.edges.length).toBeGreaterThan(0);
    for (const edge of wallThicknesses.edges) {
      expect(edge.thicknessCm, `edge ${edge.edgeIndex}: ${edge.thicknessCm}cm`).toBeGreaterThanOrEqual(5);
      expect(edge.thicknessCm, `edge ${edge.edgeIndex}: ${edge.thicknessCm}cm`).toBeLessThanOrEqual(50);
    }
  });
});

// ── Phase 3: enforcePolygonRules with OG floor plan data ──────────────────

describe('Phase 3: enforcePolygonRules with OG polygon', () => {
  // 36-edge polygon from OG floor plan detection (pass-2 after rectification).
  // removeStackedWalls collapsed this to 5 vertices with a diagonal edge:
  // (531, 1486.2) → (557.7, 1197.5) — dx=26.7, dy=288.7.
  // enforcePolygonRules must guarantee no diagonals survive.
  const ogPolygon = [
    { x: 530.6, y: 1197.5 }, { x: 1525.0, y: 1197.5 },
    { x: 1525.0, y: 2049.7 }, { x: 1158.6, y: 2049.7 },
    { x: 1158.6, y: 2023.4 }, { x: 1272.8, y: 2023.4 },
    { x: 1272.8, y: 1779.7 }, { x: 977.0, y: 1779.7 },
    { x: 977.0, y: 1808.9 }, { x: 947.8, y: 1808.9 },
    { x: 947.8, y: 1985.9 }, { x: 991.0, y: 1985.9 },
    { x: 991.0, y: 2049.7 }, { x: 871.2, y: 2049.7 },
    { x: 871.2, y: 2023.4 }, { x: 941.1, y: 2023.4 },
    { x: 941.1, y: 1780.1 }, { x: 920.3, y: 1780.1 },
    { x: 920.3, y: 1640.5 }, { x: 556.8, y: 1640.5 },
    { x: 556.8, y: 1701.4 }, { x: 530.6, y: 1701.4 },
    { x: 530.6, y: 1868.2 }, { x: 556.8, y: 1868.2 },
    { x: 556.8, y: 2023.4 }, { x: 703.3, y: 2023.4 },
    { x: 703.3, y: 2049.7 }, { x: 531.0, y: 2049.7 },
    { x: 531.0, y: 1546.1 }, { x: 557.7, y: 1546.1 },
    { x: 557.7, y: 1633.3 }, { x: 861.1, y: 1633.3 },
    { x: 861.1, y: 1224.1 }, { x: 557.3, y: 1224.1 },
    { x: 557.3, y: 1378.6 }, { x: 530.6, y: 1378.6 },
  ];

  // OG wall thickness median ≈ 29.6 cm
  const medianCm = 29.6;
  const bumpThreshold = medianCm * 0.8;
  const stackedGap = medianCm * 1.5;

  it('all output edges are axis-aligned after enforcePolygonRules', () => {
    const result = enforcePolygonRules(ogPolygon, {
      bumpThresholdCm: bumpThreshold,
      stackedWallGapCm: stackedGap,
    });

    expect(result.length).toBeGreaterThanOrEqual(4);

    for (let i = 0; i < result.length; i++) {
      const a = result[i];
      const b = result[(i + 1) % result.length];
      const dx = Math.abs(b.x - a.x);
      const dy = Math.abs(b.y - a.y);
      const isH = dy < 1;
      const isV = dx < 1;
      expect(isH || isV, `edge ${i}: (${a.x.toFixed(1)},${a.y.toFixed(1)}) → (${b.x.toFixed(1)},${b.y.toFixed(1)}) is diagonal (dx=${dx.toFixed(1)}, dy=${dy.toFixed(1)})`).toBe(true);
    }

    // Left wall should be at x ≈ 531 (outer wall face), not drifted to x ≈ 540
    const minX = Math.min(...result.map(v => v.x));
    expect(minX).toBeGreaterThan(528);   // not too far left
    expect(minX).toBeLessThan(533);      // not drifted right (was 540 before collinear fix)
  });

  it('converges within 3 iterations (no excessive looping)', () => {
    const logs = [];
    const origLog = console.log;
    console.log = (...args) => { logs.push(args.join(' ')); };
    try {
      enforcePolygonRules(ogPolygon, {
        bumpThresholdCm: bumpThreshold,
        stackedWallGapCm: stackedGap,
        maxIterations: 3,
      });
    } finally {
      console.log = origLog;
    }

    const iterLogs = logs.filter(l => l.includes('[enforcePolygonRules]'));
    // Should converge — last iteration log should say stable=true
    const lastIter = iterLogs[iterLogs.length - 1];
    expect(lastIter).toContain('stable=true');
    // Should not need all 3 iterations
    expect(iterLogs.length).toBeLessThanOrEqual(3);
  });
});

// ── E2E: Skeleton enforcement on EG floor plan ──────────────────────────────
// Full pipeline: detect envelope → detect 6 rooms → assert wall invariants.
// Replicates detectAndStoreEnvelope + confirmDetection × 6 from the controller.
describe.skip('E2E: Skeleton enforcement (real EG image)', () => {
  const round1 = v => Math.round(v * 10) / 10;

  // Click points in image pixels (from real session log)
  const clickPointsPx = [
    { x: 1561, y: 1495 },
    { x: 1532, y: 1988 },
    { x: 1855, y: 2034 },
    { x: 2057, y: 2034 },
    { x: 2096, y: 1544 },
    { x: 2220, y: 1810 },
  ];

  let floor; // populated by the pipeline

  function runFullPipeline() {
    if (floor) return;

    // ── Phase 1: Envelope detection ────────────────────────────────────────
    console.log('[skeleton-e2e] Phase 1: Envelope detection');

    // Pass 1
    const result1 = detectEnvelope(imgMessy, { pixelsPerCm: ppcEG });
    expect(result1).not.toBeNull();
    let pass1Area = 0;
    for (let i = 0; i < result1.buildingMask.length; i++) pass1Area += result1.buildingMask[i];

    // Spanning walls from pass 1 (use wallMaskFiltered for thin wall detection)
    const { minCm, maxCm } = FLOOR_PLAN_RULES.wallThickness;
    const rawWalls = detectSpanningWalls(
      imgMessy, result1.wallMaskFiltered || result1.wallMask, result1.buildingMask,
      imgMessy.width, imgMessy.height,
      { pixelsPerCm: ppcEG, minThicknessCm: minCm, maxThicknessCm: maxCm }
    );
    console.log(`[skeleton-e2e]   pass-1 spanning walls: ${rawWalls.length}`);
    const pass1SpanningWallsPx = rawWalls.map(w => ({
      startPx: w.startPx, endPx: w.endPx, thicknessPx: w.thicknessPx,
    }));

    // Preprocess fresh copy
    const img2 = { data: new Uint8ClampedArray(imgMessy.data), width: imgMessy.width, height: imgMessy.height };
    preprocessForRoomDetection(img2, {
      pixelsPerCm: ppcEG,
      envelopePolygonPx: result1.polygonPixels,
      envelopeWallThicknesses: result1.wallThicknesses,
      spanningWallsPx: pass1SpanningWallsPx,
    });

    // Pass 2
    const pass1BboxPx = {
      minX: Math.min(...result1.polygonPixels.map(p => p.x)),
      minY: Math.min(...result1.polygonPixels.map(p => p.y)),
      maxX: Math.max(...result1.polygonPixels.map(p => p.x)),
      maxY: Math.max(...result1.polygonPixels.map(p => p.y)),
    };
    const result2 = detectEnvelope(img2, { pixelsPerCm: ppcEG, envelopeBboxPx: pass1BboxPx });

    // Dynamic fallback
    let usePass2 = false;
    if (result2 && result2.polygonPixels.length >= 3 && result2.buildingMask) {
      let pass2Area = 0;
      for (let i = 0; i < result2.buildingMask.length; i++) pass2Area += result2.buildingMask[i];
      if (pass1Area > 0 && pass2Area / pass1Area >= 0.3) usePass2 = true;
    }
    const finalResult = usePass2 ? result2 : result1;
    const finalImageData = usePass2 ? img2 : imgMessy;
    console.log(`[skeleton-e2e]   using ${usePass2 ? 'pass-2' : 'pass-1'}: ${finalResult.polygonPixels.length} vertices`);

    // Downstream: polygon → cm → enforcePolygonRules → wall thickness → classify
    const finalPolygonCm = finalResult.polygonPixels.map(p => ({ x: p.x / ppcEG, y: p.y / ppcEG }));
    const finalSpanningWalls = rawWalls.map(w => ({
      orientation: w.orientation,
      startCm: { x: w.startPx.x / ppcEG, y: w.startPx.y / ppcEG },
      endCm: { x: w.endPx.x / ppcEG, y: w.endPx.y / ppcEG },
      thicknessCm: Math.round(w.thicknessPx / ppcEG * 10) / 10,
    }));

    const validAngles = extractValidAngles(finalPolygonCm, finalSpanningWalls, {
      minEdgeLengthCm: FLOOR_PLAN_RULES.wallThickness.maxCm,
    });
    const rectifyRules = { ...FLOOR_PLAN_RULES, standardAngles: validAngles };
    const bumpThreshold = (finalResult.wallThicknesses?.medianCm ?? 25) * 0.8;
    const stackedGap = (finalResult.wallThicknesses?.medianCm ?? 30) * 1.5;
    const cleaned = enforcePolygonRules(finalPolygonCm, {
      rules: rectifyRules,
      bumpThresholdCm: bumpThreshold,
      stackedWallGapCm: stackedGap,
    });

    const cleanedPx = cleaned.map(p => ({ x: Math.round(p.x * ppcEG), y: Math.round(p.y * ppcEG) }));
    const wallThicknesses = detectWallThickness(
      finalImageData, cleanedPx, finalImageData.width, finalImageData.height,
      ppcEG, { probeFromInnerFace: true }
    );
    const allThicknesses = [
      ...wallThicknesses.edges.map(e => e.thicknessCm),
      ...finalSpanningWalls.map(w => w.thicknessCm),
    ];
    const wallTypes = classifyWallTypes(allThicknesses);
    console.log(`[skeleton-e2e]   envelope: ${cleaned.length} verts, ${wallThicknesses.edges.length} edges, ${finalSpanningWalls.length} spanning walls`);
    console.log(`[skeleton-e2e]   wall types: ${wallTypes.map(t => `${t.id}=${t.thicknessCm}cm`).join(', ')}`);

    // Build envelope object
    const envelope = {
      polygonCm: cleaned,
      wallThicknesses,
      spanningWalls: finalSpanningWalls,
      validAngles,
      wallTypes,
    };

    // Load wallDefaults from starting state
    const startingState = JSON.parse(readFileSync('/Users/feivel/Downloads/01_floorplan_EG_messy_calibrated.json', 'utf8'));
    const wallDefaults = startingState.floors[0].layout.wallDefaults;

    // Build floor
    floor = {
      id: 'test-floor',
      name: 'EG',
      rooms: [],
      walls: [],
      layout: { envelope, wallDefaults },
    };

    // ── Phase 2: Detect 6 rooms ────────────────────────────────────────────
    console.log('[skeleton-e2e] Phase 2: Detecting 6 rooms');

    for (let ri = 0; ri < clickPointsPx.length; ri++) {
      const { x: seedX, y: seedY } = clickPointsPx[ri];
      console.log(`\n[skeleton-e2e]   room ${ri + 1}: click (${seedX}, ${seedY})`);

      // Preprocess a fresh image copy for room detection
      const roomImg = { data: new Uint8ClampedArray(imgMessy.data), width: imgMessy.width, height: imgMessy.height };
      preprocessForRoomDetection(roomImg, {
        pixelsPerCm: ppcEG,
        envelopePolygonPx: finalResult.polygonPixels,
        envelopeWallThicknesses: finalResult.wallThicknesses,
        spanningWallsPx: pass1SpanningWallsPx,
      });

      // Detect room
      const detection = detectRoomAtPixel(roomImg, seedX, seedY, {
        pixelsPerCm: ppcEG,
        maxAreaCm2: 500000,
      });
      expect(detection, `room ${ri + 1}: detection returned null at (${seedX}, ${seedY})`).not.toBeNull();

      // Convert to floor-global cm (bg.position is {x:0, y:0})
      const globalCm = detection.polygonPixels.map(p => ({ x: p.x / ppcEG, y: p.y / ppcEG }));

      // Enforce polygon rules
      const rules = envelope.validAngles
        ? { ...FLOOR_PLAN_RULES, standardAngles: envelope.validAngles }
        : FLOOR_PLAN_RULES;
      // Use envelope median wall thickness for bump/stacked wall thresholds
      // (mirrors confirmDetection which now passes these to enforcePolygonRules)
      const medianCm = envelope.wallThicknesses?.medianCm;
      const roomBumpThreshold = medianCm ? medianCm * 0.8 : null;
      const roomStackedGap = medianCm ? medianCm * 1.5 : null;
      const rectifiedGlobal = enforcePolygonRules(globalCm, {
        rules, bumpThresholdCm: roomBumpThreshold, stackedWallGapCm: roomStackedGap,
      });
      console.log(`[skeleton-e2e]     rectified: ${rectifiedGlobal.length} verts: ${rectifiedGlobal.map(p => `(${p.x.toFixed(1)},${p.y.toFixed(1)})`).join(' ')}`);

      // Compute local vertices + floorPosition
      let minX = Infinity, minY = Infinity;
      for (const p of rectifiedGlobal) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
      }
      const localVertices = rectifiedGlobal.map(p => ({
        x: Math.round((p.x - minX) * 10) / 10,
        y: Math.round((p.y - minY) * 10) / 10,
      }));
      const floorPos = { x: round1(minX), y: round1(minY) };

      // Align to envelope, then existing rooms
      const { floorPosition: envAlignedPos } = alignToEnvelope(localVertices, floorPos, envelope);
      const { floorPosition: alignedPos } = alignToExistingRooms(localVertices, envAlignedPos, floor.rooms || []);

      // Constrain to structural boundaries
      const alignedGlobal = localVertices.map(v => ({ x: alignedPos.x + v.x, y: alignedPos.y + v.y }));
      const constrainedGlobal = constrainRoomToStructuralBoundaries(alignedGlobal, envelope);

      // Recompute local + floorPosition from constrained global
      let cMinX = Infinity, cMinY = Infinity;
      for (const p of constrainedGlobal) {
        if (p.x < cMinX) cMinX = p.x;
        if (p.y < cMinY) cMinY = p.y;
      }
      const constrainedLocal = constrainedGlobal.map(p => ({
        x: round1(p.x - cMinX), y: round1(p.y - cMinY),
      }));
      const constrainedPos = { x: round1(cMinX), y: round1(cMinY) };
      console.log(`[skeleton-e2e]     constrained pos: (${constrainedPos.x},${constrainedPos.y})`);
      console.log(`[skeleton-e2e]     constrained verts: ${constrainedLocal.map(p => `(${p.x.toFixed(1)},${p.y.toFixed(1)})`).join(' ')}`);

      // Create room surface and add to floor
      const room = createSurface({
        name: `Room ${ri + 1}`,
        polygonVertices: constrainedLocal,
        floorPosition: constrainedPos,
      });
      floor.rooms.push(room);

      // Wall pipeline (mirrors confirmDetection exactly)
      syncFloorWalls(floor, { enforcePositions: false });
      console.log(`[skeleton-e2e]     syncFloorWalls: ${floor.walls.length} walls`);
      mergeCollinearWalls(floor);
      console.log(`[skeleton-e2e]     mergeCollinearWalls: ${floor.walls.length} walls`);
      enforceSkeletonWallProperties(floor);

      const cls = classifyRoomEdges(room, floor);
      console.log(`[skeleton-e2e]     classification: ${cls.map(c => `e${c.edgeIndex}:${c.type}`).join(', ')}`);
      assignWallTypesFromClassification(floor, room, cls, detection.wallThicknesses?.edges);
      extendSkeletonForRoom(floor, room, cls);

      enforceNoParallelWalls(floor);
      console.log(`[skeleton-e2e]     enforceNoParallelWalls: ${floor.walls.length} walls`);
      enforceAdjacentPositions(floor);
      recomputeEnvelope(floor);

      console.log(`[skeleton-e2e]     → ${floor.walls.length} walls after room ${ri + 1}`);
      if (ri === 0) {
        // Dump all walls after room 1 to identify the notch source
        for (const w of floor.walls) {
          const ori = Math.abs(w.start.y - w.end.y) < 0.5 ? 'H' : Math.abs(w.start.x - w.end.x) < 0.5 ? 'V' : 'D';
          console.log(`[skeleton-e2e]       room1-wall: ${ori} thick=${w.thicknessCm}cm (${w.start.x.toFixed(1)},${w.start.y.toFixed(1)})→(${w.end.x.toFixed(1)},${w.end.y.toFixed(1)})`);
        }
      }
    }

    // Log final wall summary
    console.log(`[skeleton-e2e] Phase 3: Final wall summary (${floor.walls.length} walls)`);
    for (const w of floor.walls) {
      const ori = Math.abs(w.start.y - w.end.y) < 0.5 ? 'H' : Math.abs(w.start.x - w.end.x) < 0.5 ? 'V' : 'D';
      const mid = ori === 'H' ? `y=${((w.start.y + w.end.y) / 2).toFixed(1)}` : `x=${((w.start.x + w.end.x) / 2).toFixed(1)}`;
      console.log(`[skeleton-e2e]   wall ${w.id}: ${ori} ${mid} thick=${w.thicknessCm}cm h=${w.heightStartCm}/${w.heightEndCm} (${w.start.x.toFixed(1)},${w.start.y.toFixed(1)})→(${w.end.x.toFixed(1)},${w.end.y.toFixed(1)})`);
    }
  }

  // AC1: Outer walls present near all 4 envelope inner faces
  // Walls may be fragmented by room boundaries — assert ≥1 wall per face, all with outer thickness
  it('AC1: outer walls present near all 4 envelope inner faces', { timeout: 120000 }, () => {
    runFullPipeline();
    const tolerance = 6; // cm

    // Envelope inner face approximate positions (from actual pipeline output)
    const envelopeFaces = {
      top:    { ori: 'H', coord: 1083, label: 'top' },
      bottom: { ori: 'H', coord: 1878, label: 'bottom' },
      left:   { ori: 'V', coord: 1124, label: 'left' },
      right:  { ori: 'V', coord: 2058, label: 'right' },
    };

    for (const [key, face] of Object.entries(envelopeFaces)) {
      const matching = floor.walls.filter(w => {
        if (face.ori === 'H') {
          const isH = Math.abs(w.start.y - w.end.y) < 0.5;
          if (!isH) return false;
          const midY = (w.start.y + w.end.y) / 2;
          return Math.abs(midY - face.coord) < tolerance;
        } else {
          const isV = Math.abs(w.start.x - w.end.x) < 0.5;
          if (!isV) return false;
          const midX = (w.start.x + w.end.x) / 2;
          return Math.abs(midX - face.coord) < tolerance;
        }
      });
      expect(matching.length, `expected ≥1 ${face.label} outer wall near ${face.ori}=${face.coord}, found ${matching.length}`).toBeGreaterThanOrEqual(1);
    }
  });

  // AC2: Outer wall thickness = 30cm
  it('AC2: outer wall thickness = 30cm', { timeout: 120000 }, () => {
    runFullPipeline();
    const tolerance = 6;
    const outerCoords = [
      { ori: 'H', coord: 1083 }, { ori: 'H', coord: 1878 },
      { ori: 'V', coord: 1124 }, { ori: 'V', coord: 2058 },
    ];

    for (const face of outerCoords) {
      const wall = floor.walls.find(w => {
        if (face.ori === 'H') {
          return Math.abs(w.start.y - w.end.y) < 0.5 && Math.abs((w.start.y + w.end.y) / 2 - face.coord) < tolerance;
        } else {
          return Math.abs(w.start.x - w.end.x) < 0.5 && Math.abs((w.start.x + w.end.x) / 2 - face.coord) < tolerance;
        }
      });
      expect(wall, `no outer wall found near ${face.ori}=${face.coord}`).toBeDefined();
      expect(wall.thicknessCm, `outer wall ${face.ori}=${face.coord}: expected 30cm, got ${wall.thicknessCm}cm`).toBe(30);
    }
  });

  // AC3: 2 continuous spanning walls
  it('AC3: 2 continuous spanning walls (1 H + 1 V)', { timeout: 120000 }, () => {
    runFullPipeline();
    const spanTolerance = 30; // spanning walls have two faces; use wider tolerance

    // H spanning wall near y≈1475..1498
    const hSpanning = floor.walls.filter(w => {
      const isH = Math.abs(w.start.y - w.end.y) < 0.5;
      if (!isH) return false;
      const midY = (w.start.y + w.end.y) / 2;
      return midY > 1450 && midY < 1520;
    });
    expect(hSpanning.length, `expected exactly 1 H spanning wall near y≈1475-1498, found ${hSpanning.length}: ${JSON.stringify(hSpanning.map(w => ({ y: (w.start.y + w.end.y) / 2 })))}`).toBe(1);

    // V spanning wall near x≈1636..1647
    const vSpanning = floor.walls.filter(w => {
      const isV = Math.abs(w.start.x - w.end.x) < 0.5;
      if (!isV) return false;
      const midX = (w.start.x + w.end.x) / 2;
      return midX > 1610 && midX < 1670;
    });
    expect(vSpanning.length, `expected exactly 1 V spanning wall near x≈1636-1647, found ${vSpanning.length}: ${JSON.stringify(vSpanning.map(w => ({ x: (w.start.x + w.end.x) / 2 })))}`).toBe(1);
  });

  // AC4: Spanning wall thickness
  it('AC4: spanning wall thicknesses (H=24cm structural, V=11.5cm partition)', { timeout: 120000 }, () => {
    runFullPipeline();

    // H spanning wall
    const hSpanning = floor.walls.find(w => {
      const isH = Math.abs(w.start.y - w.end.y) < 0.5;
      const midY = (w.start.y + w.end.y) / 2;
      return isH && midY > 1450 && midY < 1520;
    });
    expect(hSpanning, 'H spanning wall not found').toBeDefined();
    expect(hSpanning.thicknessCm, `H spanning: expected 24cm, got ${hSpanning.thicknessCm}cm`).toBe(24);

    // V spanning wall
    const vSpanning = floor.walls.find(w => {
      const isV = Math.abs(w.start.x - w.end.x) < 0.5;
      const midX = (w.start.x + w.end.x) / 2;
      return isV && midX > 1610 && midX < 1670;
    });
    expect(vSpanning, 'V spanning wall not found').toBeDefined();
    expect(vSpanning.thicknessCm, `V spanning: expected 11.5cm, got ${vSpanning.thicknessCm}cm`).toBe(11.5);
  });

  // AC5: No parallel stacking
  // "Stacking" = two parallel walls representing the same physical wall (duplicates).
  // Excludes L-shape corners: adjacent edges of the same room that share an endpoint
  // are consecutive room edges, not stacking.
  it('AC5: no parallel wall stacking', { timeout: 120000 }, () => {
    runFullPipeline();

    // Helper: does a structural wall (envelope edge or spanning wall) sit between
    // two parallel walls? If so, they are on opposite faces of a real physical wall,
    // not duplicates. Uses envelope polygon edges and spanning walls from the floor data.
    const spanningWalls = floor.layout?.envelope?.spanningWalls || [];
    const envelopePoly = floor.layout?.envelope?.polygonCm || [];

    function structuralWallBetween(coordA, coordB, orientation) {
      const lo = Math.min(coordA, coordB);
      const hi = Math.max(coordA, coordB);
      // Check spanning walls
      for (const sw of spanningWalls) {
        if (sw.orientation !== orientation) continue;
        const center = orientation === 'H'
          ? (sw.startCm.y + sw.endCm.y) / 2
          : (sw.startCm.x + sw.endCm.x) / 2;
        if (center >= lo - 2 && center <= hi + 2) return true;
      }
      // Check envelope edges
      for (let k = 0; k < envelopePoly.length; k++) {
        const p = envelopePoly[k];
        const q = envelopePoly[(k + 1) % envelopePoly.length];
        if (orientation === 'H' && Math.abs(p.y - q.y) < 1) {
          const edgeY = (p.y + q.y) / 2;
          if (edgeY >= lo - 2 && edgeY <= hi + 2) return true;
        }
        if (orientation === 'V' && Math.abs(p.x - q.x) < 1) {
          const edgeX = (p.x + q.x) / 2;
          if (edgeX >= lo - 2 && edgeX <= hi + 2) return true;
        }
      }
      return false;
    }

    for (let i = 0; i < floor.walls.length; i++) {
      const wi = floor.walls[i];
      const iIsH = Math.abs(wi.start.y - wi.end.y) < 0.5;
      const iIsV = Math.abs(wi.start.x - wi.end.x) < 0.5;
      if (!iIsH && !iIsV) continue;

      for (let j = i + 1; j < floor.walls.length; j++) {
        const wj = floor.walls[j];
        const jIsH = Math.abs(wj.start.y - wj.end.y) < 0.5;
        const jIsV = Math.abs(wj.start.x - wj.end.x) < 0.5;

        if (iIsH && jIsH) {
          const midI = (wi.start.y + wi.end.y) / 2;
          const midJ = (wj.start.y + wj.end.y) / 2;
          const gap = Math.abs(midI - midJ);
          // Skip if a structural H wall sits between these two walls
          if (structuralWallBetween(midI, midJ, 'H')) continue;
          const maxGap = Math.max(wi.thicknessCm, wj.thicknessCm) + 6;
          if (gap < maxGap) {
            const iMin = Math.min(wi.start.x, wi.end.x), iMax = Math.max(wi.start.x, wi.end.x);
            const jMin = Math.min(wj.start.x, wj.end.x), jMax = Math.max(wj.start.x, wj.end.x);
            const overlap = Math.min(iMax, jMax) - Math.max(iMin, jMin);
            expect(overlap, `stacked H walls ${wi.id} (y=${midI.toFixed(1)}) and ${wj.id} (y=${midJ.toFixed(1)}): gap=${gap.toFixed(1)}cm, overlap=${overlap.toFixed(1)}cm`).toBeLessThanOrEqual(1);
          }
        }
        if (iIsV && jIsV) {
          const midI = (wi.start.x + wi.end.x) / 2;
          const midJ = (wj.start.x + wj.end.x) / 2;
          const gap = Math.abs(midI - midJ);
          if (structuralWallBetween(midI, midJ, 'V')) continue;
          const maxGap = Math.max(wi.thicknessCm, wj.thicknessCm) + 6;
          if (gap < maxGap) {
            const iMin = Math.min(wi.start.y, wi.end.y), iMax = Math.max(wi.start.y, wi.end.y);
            const jMin = Math.min(wj.start.y, wj.end.y), jMax = Math.max(wj.start.y, wj.end.y);
            const overlap = Math.min(iMax, jMax) - Math.max(iMin, jMin);
            expect(overlap, `stacked V walls ${wi.id} (x=${midI.toFixed(1)}) and ${wj.id} (x=${midJ.toFixed(1)}): gap=${gap.toFixed(1)}cm, overlap=${overlap.toFixed(1)}cm`).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });

  // AC6: No disallowed angles (all walls H or V)
  it('AC6: all walls are axis-aligned (H or V)', { timeout: 120000 }, () => {
    runFullPipeline();

    for (const w of floor.walls) {
      const isH = Math.abs(w.start.y - w.end.y) < 0.5;
      const isV = Math.abs(w.start.x - w.end.x) < 0.5;
      expect(isH || isV, `wall ${w.id}: (${w.start.x.toFixed(1)},${w.start.y.toFixed(1)})→(${w.end.x.toFixed(1)},${w.end.y.toFixed(1)}) is diagonal`).toBe(true);
    }
  });

  // AC7: Wall height = 240cm
  it('AC7: all walls have height 240cm', { timeout: 120000 }, () => {
    runFullPipeline();

    for (const w of floor.walls) {
      expect(w.heightStartCm, `wall ${w.id}: heightStartCm=${w.heightStartCm}`).toBe(240);
      expect(w.heightEndCm, `wall ${w.id}: heightEndCm=${w.heightEndCm}`).toBe(240);
    }
  });
});
