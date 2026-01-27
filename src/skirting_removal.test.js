import { describe, it, expect } from 'vitest';
import { computeSkirtingSegments } from './geometry.js';

describe('Skirting Exclusions', () => {
  it('respects manual skirting exclusions in excludedSkirts', () => {
    const room = {
      sections: [{ id: 's1', x: 0, y: 0, widthCm: 100, heightCm: 100, skirtingEnabled: true }],
      exclusions: [],
      excludedSkirts: []
    };
    
    const allSegments = computeSkirtingSegments(room);
    expect(allSegments.length).toBeGreaterThan(0);
    
    // Pick first segment ID to exclude
    const targetId = allSegments[0].id;
    room.excludedSkirts = [targetId];
    
    // Normal calculation should skip it
    const filteredSegments = computeSkirtingSegments(room);
    expect(filteredSegments.length).toBe(allSegments.length - 1);
    expect(filteredSegments.find(s => s.id === targetId)).toBeUndefined();

    // Removal mode (includeExcluded = true) should show it but marked as excluded
    const removalSegments = computeSkirtingSegments(room, true);
    expect(removalSegments.length).toBe(allSegments.length);
    const excludedSeg = removalSegments.find(s => s.id === targetId);
    expect(excludedSeg).toBeDefined();
    expect(excludedSeg.excluded).toBe(true);
  });

  it('normalizes skirting IDs regardless of direction', () => {
    const room = {
      sections: [{ id: 's1', x: 0, y: 0, widthCm: 100, heightCm: 100, skirtingEnabled: true }],
      exclusions: [],
      excludedSkirts: []
    };
    
    const segments = computeSkirtingSegments(room);
    // Find a segment starting at (0,0) - likely the first piece of the top wall
    const seg = segments.find(s => s.p1[0] === 0 && s.p1[1] === 0);
    
    expect(seg).toBeDefined();
    // ID should be w0.00,0.00-100.00,0.00-p0 regardless of direction
    expect(seg.id).toBe('w0.00,0.00-100.00,0.00-p0');
  });
});
