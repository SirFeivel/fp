// Verification test: run detectRoomAtPixel against the real reference floor plan.
// Compares polygon bounding box to the hand-drawn reference polygon.
// Run once with: npx vitest run src/room-detection.verify.test.js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { decode } from 'fast-png';
import { detectRoomAtPixel } from './room-detection.js';

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
