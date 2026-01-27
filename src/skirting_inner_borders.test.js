import { describe, it, expect } from 'vitest';
import { computeSkirtingSegments } from './geometry.js';

describe('Skirting Inner Borders', () => {
  it('does NOT apply skirting to the shared border between two sections', () => {
    // Two adjacent 100x100 sections. Total 200x100.
    // Section 1: x=0, y=0, w=100, h=100 (Skirting ON)
    // Section 2: x=100, y=0, w=100, h=100 (Skirting OFF)
    const room = {
      sections: [
        { id: 's1', x: 0, y: 0, widthCm: 100, heightCm: 100, skirtingEnabled: true },
        { id: 's2', x: 100, y: 0, widthCm: 100, heightCm: 100, skirtingEnabled: false }
      ],
      exclusions: []
    };

    const segments = computeSkirtingSegments(room);
    
    // Perimeter of S1 is 400.
    // Top: 0,0 to 100,0 (100) -> Room boundary. KEEP.
    // Right: 100,0 to 100,100 (100) -> SHARED BORDER. REMOVE.
    // Bottom: 100,100 to 0,100 (100) -> Room boundary. KEEP.
    // Left: 0,100 to 0,0 (100) -> Room boundary. KEEP.
    // Total should be 300.
    
    const totalLength = segments.reduce((sum, s) => sum + (typeof s === 'number' ? s : s.length), 0);
    
    // Currently this will likely be 400 because S1 is unioned alone and its perimeter is used.
    expect(totalLength).toBeCloseTo(300);
  });

  it('applies skirting to all outer boundaries when all sections are enabled', () => {
    const room = {
      sections: [
        { id: 's1', x: 0, y: 0, widthCm: 100, heightCm: 100, skirtingEnabled: true },
        { id: 's2', x: 100, y: 0, widthCm: 100, heightCm: 100, skirtingEnabled: true }
      ],
      exclusions: []
    };
    // Merged: 200x100. Perimeter = (200+100)*2 = 600.
    const segments = computeSkirtingSegments(room);
    const totalLength = segments.reduce((sum, s) => sum + (typeof s === 'number' ? s : s.length), 0);
    expect(totalLength).toBeCloseTo(600);
  });
});
