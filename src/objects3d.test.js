// src/objects3d.test.js
import { describe, it, expect } from 'vitest';
import { prepareObj3dFaceRegion } from './objects3d.js';

// ── prepareObj3dFaceRegion ────────────────────────────────────────────

describe('prepareObj3dFaceRegion', () => {
  it('computes side face dimensions for a rect object', () => {
    const obj = { id: 'o1', type: 'rect', w: 50, h: 80, heightCm: 200 };
    const surf = { face: 'front', tile: { widthCm: 30, heightCm: 30, shape: 'rect' } };

    const region = prepareObj3dFaceRegion(obj, surf, []);

    expect(region).not.toBeNull();
    expect(region.widthCm).toBe(50);   // front face uses obj.w
    expect(region.heightCm).toBe(200);
    expect(region.exclusions).toHaveLength(0);
    expect(region.tile).toBe(surf.tile);
  });

  it('computes left/right face dimensions for a rect object', () => {
    const obj = { id: 'o1', type: 'rect', w: 50, h: 80, heightCm: 200 };
    const surf = { face: 'left', tile: { widthCm: 30, heightCm: 30, shape: 'rect' } };

    const region = prepareObj3dFaceRegion(obj, surf, []);

    expect(region.widthCm).toBe(80);   // left face uses obj.h
    expect(region.heightCm).toBe(200);
  });

  it('computes top face dimensions for a rect object', () => {
    const obj = { id: 'o1', type: 'rect', w: 50, h: 80, heightCm: 200 };
    const surf = { face: 'top', tile: { widthCm: 30, heightCm: 30, shape: 'rect' } };

    const region = prepareObj3dFaceRegion(obj, surf, []);

    expect(region.widthCm).toBe(50);   // top face: w
    expect(region.heightCm).toBe(80);  // top face: h
    expect(region.polygonVertices).toHaveLength(4);
  });

  it('injects contact exclusion for a matching face', () => {
    const obj = { id: 'o1', type: 'rect', w: 100, h: 60, heightCm: 200 };
    const surf = { face: 'front', tile: { widthCm: 30, heightCm: 30, shape: 'rect' } };
    const contacts = [
      { objId: 'o1', face: 'front', faceLocalX1: 10, faceLocalX2: 40, contactH: 50 },
    ];

    const region = prepareObj3dFaceRegion(obj, surf, contacts);

    expect(region.exclusions).toHaveLength(1);
    const excl = region.exclusions[0];
    expect(excl.type).toBe('rect');
    expect(excl.x).toBe(10);
    expect(excl.y).toBe(0);
    expect(excl.w).toBe(30);   // 40 - 10
    expect(excl.h).toBe(50);
    expect(excl._isContact).toBe(true);
  });

  it('does not inject contact exclusion for a different face', () => {
    const obj = { id: 'o1', type: 'rect', w: 100, h: 60, heightCm: 200 };
    const surf = { face: 'back', tile: { widthCm: 30, heightCm: 30, shape: 'rect' } };
    const contacts = [
      { objId: 'o1', face: 'front', faceLocalX1: 10, faceLocalX2: 40, contactH: 50 },
    ];

    const region = prepareObj3dFaceRegion(obj, surf, contacts);

    expect(region.exclusions).toHaveLength(0);
  });

  it('returns null for a freeform side face with no vertices', () => {
    const obj = { id: 'o1', type: 'freeform', vertices: [], heightCm: 200 };
    const surf = { face: 'side-0', tile: { widthCm: 30, heightCm: 30, shape: 'rect' } };

    const region = prepareObj3dFaceRegion(obj, surf, []);

    expect(region).toBeNull();
  });

  it('computes tri top face as bounding box of triangle', () => {
    const obj = {
      id: 'o1', type: 'tri',
      p1: { x: 0, y: 0 }, p2: { x: 100, y: 0 }, p3: { x: 50, y: 80 },
      heightCm: 150,
    };
    const surf = { face: 'top', tile: { widthCm: 30, heightCm: 30, shape: 'rect' } };

    const region = prepareObj3dFaceRegion(obj, surf, []);

    expect(region).not.toBeNull();
    expect(region.widthCm).toBeCloseTo(100, 0);
    expect(region.heightCm).toBeCloseTo(80, 0);
    // Polygon vertices should be origin-shifted triangle, not a rectangle
    expect(region.polygonVertices).toHaveLength(3);
  });
});
