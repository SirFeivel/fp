import { describe, it, expect } from 'vitest';
import {
  sanitizeNumber,
  sanitizePositiveNumber,
  sanitizeString,
  sanitizeRotation,
  sanitizeRect,
  sanitizeCircle,
  sanitizePoint,
} from './sanitize.js';

describe('sanitizeNumber', () => {
  it('returns valid number unchanged', () => {
    expect(sanitizeNumber(42)).toBe(42);
    expect(sanitizeNumber(3.14)).toBe(3.14);
  });

  it('converts string numbers', () => {
    expect(sanitizeNumber('42')).toBe(42);
    expect(sanitizeNumber('3.14')).toBe(3.14);
  });

  it('clamps to minimum', () => {
    expect(sanitizeNumber(5, 10, 100, 0)).toBe(10);
  });

  it('clamps to maximum', () => {
    expect(sanitizeNumber(150, 0, 100, 0)).toBe(100);
  });

  it('returns default for NaN', () => {
    expect(sanitizeNumber(NaN, 0, 100, 42)).toBe(42);
  });

  it('returns default for undefined', () => {
    expect(sanitizeNumber(undefined, 0, 100, 42)).toBe(42);
  });

  it('converts null to 0', () => {
    expect(sanitizeNumber(null, 0, 100, 42)).toBe(0);
  });

  it('returns default for invalid strings', () => {
    expect(sanitizeNumber('abc', 0, 100, 42)).toBe(42);
  });

  it('returns default for Infinity', () => {
    expect(sanitizeNumber(Infinity, 0, 100, 42)).toBe(42);
  });

  it('returns default for -Infinity', () => {
    expect(sanitizeNumber(-Infinity, 0, 100, 42)).toBe(42);
  });

  it('handles negative numbers', () => {
    expect(sanitizeNumber(-10, -100, 100, 0)).toBe(-10);
  });

  it('uses default of 0 when not specified', () => {
    expect(sanitizeNumber(NaN)).toBe(0);
  });
});

describe('sanitizePositiveNumber', () => {
  it('returns valid positive number unchanged', () => {
    expect(sanitizePositiveNumber(42)).toBe(42);
  });

  it('returns default for negative number', () => {
    expect(sanitizePositiveNumber(-10, 0, 5)).toBe(5);
  });

  it('returns default for number below minimum', () => {
    expect(sanitizePositiveNumber(5, 10, 20)).toBe(20);
  });

  it('returns default for NaN', () => {
    expect(sanitizePositiveNumber(NaN, 0, 42)).toBe(42);
  });

  it('allows zero when min is 0', () => {
    expect(sanitizePositiveNumber(0, 0, 5)).toBe(0);
  });

  it('uses default of 0 when not specified', () => {
    expect(sanitizePositiveNumber(NaN)).toBe(0);
  });

  it('accepts custom minimum', () => {
    expect(sanitizePositiveNumber(15, 10, 5)).toBe(15);
  });
});

describe('sanitizeString', () => {
  it('returns valid string unchanged', () => {
    expect(sanitizeString('hello')).toBe('hello');
  });

  it('converts numbers to strings', () => {
    expect(sanitizeString(42)).toBe('42');
  });

  it('converts null to empty string', () => {
    expect(sanitizeString(null)).toBe('');
  });

  it('converts undefined to empty string', () => {
    expect(sanitizeString(undefined)).toBe('');
  });

  it('truncates long strings', () => {
    const longString = 'a'.repeat(2000);
    expect(sanitizeString(longString, 100)).toHaveLength(100);
  });

  it('respects custom max length', () => {
    expect(sanitizeString('hello world', 5)).toBe('hello');
  });

  it('preserves strings shorter than max length', () => {
    expect(sanitizeString('hi', 100)).toBe('hi');
  });

  it('handles empty string', () => {
    expect(sanitizeString('')).toBe('');
  });

  it('uses default max length of 1000', () => {
    const str = 'a'.repeat(1500);
    expect(sanitizeString(str)).toHaveLength(1000);
  });
});

describe('sanitizeRotation', () => {
  it('returns valid rotation unchanged', () => {
    expect(sanitizeRotation(0)).toBe(0);
    expect(sanitizeRotation(45)).toBe(45);
    expect(sanitizeRotation(90)).toBe(90);
  });

  it('rounds to nearest step', () => {
    expect(sanitizeRotation(42, 45)).toBe(45);
    expect(sanitizeRotation(47, 45)).toBe(45);
    expect(sanitizeRotation(70, 45)).toBe(90);
  });

  it('wraps 360 to 0', () => {
    expect(sanitizeRotation(360, 45, 0, 360)).toBe(0);
  });

  it('clamps to min', () => {
    expect(sanitizeRotation(-10, 45, 0, 360)).toBe(0);
  });

  it('clamps to max before rounding', () => {
    expect(sanitizeRotation(400, 45, 0, 360)).toBe(0);
  });

  it('handles different step sizes', () => {
    expect(sanitizeRotation(92, 90)).toBe(90);
    expect(sanitizeRotation(92, 30)).toBe(90);
  });

  it('uses default step of 45', () => {
    expect(sanitizeRotation(50)).toBe(45);
  });

  it('uses default min of 0', () => {
    expect(sanitizeRotation(-50)).toBe(0);
  });

  it('uses default max of 360', () => {
    expect(sanitizeRotation(400)).toBe(0);
  });
});

describe('sanitizeRect', () => {
  it('returns valid rect unchanged', () => {
    const rect = { x: 10, y: 20, w: 30, h: 40 };
    expect(sanitizeRect(rect)).toEqual({ x: 10, y: 20, w: 30, h: 40 });
  });

  it('returns null for null input', () => {
    expect(sanitizeRect(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(sanitizeRect(undefined)).toBeNull();
  });

  it('returns null for non-object input', () => {
    expect(sanitizeRect('string')).toBeNull();
    expect(sanitizeRect(42)).toBeNull();
  });

  it('clamps negative x to 0', () => {
    const rect = { x: -10, y: 20, w: 30, h: 40 };
    expect(sanitizeRect(rect).x).toBe(0);
  });

  it('clamps negative y to 0', () => {
    const rect = { x: 10, y: -20, w: 30, h: 40 };
    expect(sanitizeRect(rect).y).toBe(0);
  });

  it('enforces minimum width', () => {
    const rect = { x: 10, y: 20, w: 0, h: 40 };
    expect(sanitizeRect(rect).w).toBe(0.1);
  });

  it('enforces minimum height', () => {
    const rect = { x: 10, y: 20, w: 30, h: 0 };
    expect(sanitizeRect(rect).h).toBe(0.1);
  });

  it('handles NaN values', () => {
    const rect = { x: NaN, y: NaN, w: NaN, h: NaN };
    const result = sanitizeRect(rect);
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
    expect(result.w).toBe(0.1);
    expect(result.h).toBe(0.1);
  });

  it('converts string numbers', () => {
    const rect = { x: '10', y: '20', w: '30', h: '40' };
    expect(sanitizeRect(rect)).toEqual({ x: 10, y: 20, w: 30, h: 40 });
  });
});

describe('sanitizeCircle', () => {
  it('returns valid circle unchanged', () => {
    const circle = { cx: 50, cy: 60, r: 10 };
    expect(sanitizeCircle(circle)).toEqual({ cx: 50, cy: 60, r: 10 });
  });

  it('returns null for null input', () => {
    expect(sanitizeCircle(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(sanitizeCircle(undefined)).toBeNull();
  });

  it('clamps negative cx to 0', () => {
    const circle = { cx: -10, cy: 60, r: 10 };
    expect(sanitizeCircle(circle).cx).toBe(0);
  });

  it('clamps negative cy to 0', () => {
    const circle = { cx: 50, cy: -60, r: 10 };
    expect(sanitizeCircle(circle).cy).toBe(0);
  });

  it('enforces minimum radius', () => {
    const circle = { cx: 50, cy: 60, r: 0 };
    expect(sanitizeCircle(circle).r).toBe(1);
  });

  it('handles NaN values', () => {
    const circle = { cx: NaN, cy: NaN, r: NaN };
    const result = sanitizeCircle(circle);
    expect(result.cx).toBe(0);
    expect(result.cy).toBe(0);
    expect(result.r).toBe(1);
  });

  it('converts string numbers', () => {
    const circle = { cx: '50', cy: '60', r: '10' };
    expect(sanitizeCircle(circle)).toEqual({ cx: 50, cy: 60, r: 10 });
  });
});

describe('sanitizePoint', () => {
  it('returns valid point unchanged', () => {
    const point = { x: 10, y: 20 };
    expect(sanitizePoint(point)).toEqual({ x: 10, y: 20 });
  });

  it('returns origin for null input', () => {
    expect(sanitizePoint(null)).toEqual({ x: 0, y: 0 });
  });

  it('returns origin for undefined input', () => {
    expect(sanitizePoint(undefined)).toEqual({ x: 0, y: 0 });
  });

  it('allows negative coordinates', () => {
    const point = { x: -10, y: -20 };
    expect(sanitizePoint(point)).toEqual({ x: -10, y: -20 });
  });

  it('handles NaN values', () => {
    const point = { x: NaN, y: NaN };
    expect(sanitizePoint(point)).toEqual({ x: 0, y: 0 });
  });

  it('converts string numbers', () => {
    const point = { x: '10', y: '20' };
    expect(sanitizePoint(point)).toEqual({ x: 10, y: 20 });
  });

  it('handles missing x', () => {
    const point = { y: 20 };
    const result = sanitizePoint(point);
    expect(result.x).toBe(0);
    expect(result.y).toBe(20);
  });

  it('handles missing y', () => {
    const point = { x: 10 };
    const result = sanitizePoint(point);
    expect(result.x).toBe(10);
    expect(result.y).toBe(0);
  });
});
