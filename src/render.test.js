import { describe, it, expect } from 'vitest';
import { hexToRgb } from './render.js';

describe('hexToRgb', () => {
  it('converts white (#ffffff) correctly', () => {
    expect(hexToRgb('#ffffff')).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('converts black (#000000) correctly', () => {
    expect(hexToRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('converts red (#ff0000) correctly', () => {
    expect(hexToRgb('#ff0000')).toEqual({ r: 255, g: 0, b: 0 });
  });

  it('converts green (#00ff00) correctly', () => {
    expect(hexToRgb('#00ff00')).toEqual({ r: 0, g: 255, b: 0 });
  });

  it('converts blue (#0000ff) correctly', () => {
    expect(hexToRgb('#0000ff')).toEqual({ r: 0, g: 0, b: 255 });
  });

  it('converts mixed color (#8b4513) correctly', () => {
    // SaddleBrown
    expect(hexToRgb('#8b4513')).toEqual({ r: 139, g: 69, b: 19 });
  });

  it('handles uppercase hex values', () => {
    expect(hexToRgb('#AABBCC')).toEqual({ r: 170, g: 187, b: 204 });
  });

  it('handles hex without # prefix', () => {
    expect(hexToRgb('ff5500')).toEqual({ r: 255, g: 85, b: 0 });
  });

  it('returns white for invalid hex', () => {
    expect(hexToRgb('invalid')).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('returns white for empty string', () => {
    expect(hexToRgb('')).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('returns white for null/undefined', () => {
    expect(hexToRgb(null)).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb(undefined)).toEqual({ r: 255, g: 255, b: 255 });
  });
});
