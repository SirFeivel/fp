import { describe, it, expect } from 'vitest';
import { escapeHTML, safeParseJSON, defaultState, getCurrentRoom, getWallSvgRotation, svgToLocalPoint, localToSvgPoint, svgToLocalDelta } from './core.js';

describe('escapeHTML', () => {
  it('should escape ampersands', () => {
    expect(escapeHTML('Tom & Jerry')).toBe('Tom &amp; Jerry');
  });

  it('should escape less-than signs', () => {
    expect(escapeHTML('5 < 10')).toBe('5 &lt; 10');
  });

  it('should escape greater-than signs', () => {
    expect(escapeHTML('10 > 5')).toBe('10 &gt; 5');
  });

  it('should escape double quotes', () => {
    expect(escapeHTML('Say "hello"')).toBe('Say &quot;hello&quot;');
  });

  it('should escape single quotes', () => {
    expect(escapeHTML("It's nice")).toBe('It&#39;s nice');
  });

  it('should escape multiple special characters', () => {
    expect(escapeHTML('<script>alert("XSS")</script>'))
      .toBe('&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;');
  });

  it('should handle empty string', () => {
    expect(escapeHTML('')).toBe('');
  });

  it('should handle strings without special characters', () => {
    expect(escapeHTML('hello world')).toBe('hello world');
  });

  it('should convert non-strings to strings', () => {
    expect(escapeHTML(123)).toBe('123');
    expect(escapeHTML(null)).toBe('null');
    expect(escapeHTML(undefined)).toBe('undefined');
  });
});

describe('safeParseJSON', () => {
  it('should parse valid JSON', () => {
    const result = safeParseJSON('{"name":"test","value":42}');
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({ name: 'test', value: 42 });
  });

  it('should parse JSON arrays', () => {
    const result = safeParseJSON('[1,2,3]');
    expect(result.ok).toBe(true);
    expect(result.value).toEqual([1, 2, 3]);
  });

  it('should parse JSON primitives', () => {
    expect(safeParseJSON('true')).toEqual({ ok: true, value: true });
    expect(safeParseJSON('false')).toEqual({ ok: true, value: false });
    expect(safeParseJSON('null')).toEqual({ ok: true, value: null });
    expect(safeParseJSON('42')).toEqual({ ok: true, value: 42 });
    expect(safeParseJSON('"hello"')).toEqual({ ok: true, value: 'hello' });
  });

  it('should return error for invalid JSON', () => {
    const result = safeParseJSON('not valid json');
    expect(result.ok).toBe(false);
    expect(result.error).toBeInstanceOf(SyntaxError);
  });

  it('should return error for unclosed braces', () => {
    const result = safeParseJSON('{"name":"test"');
    expect(result.ok).toBe(false);
    expect(result.error).toBeInstanceOf(SyntaxError);
  });

  it('should return error for trailing commas', () => {
    const result = safeParseJSON('{"a":1,}');
    expect(result.ok).toBe(false);
    expect(result.error).toBeInstanceOf(SyntaxError);
  });

  it('should return error for empty string', () => {
    const result = safeParseJSON('');
    expect(result.ok).toBe(false);
    expect(result.error).toBeInstanceOf(SyntaxError);
  });
});

describe('defaultState', () => {
  it('should create state with valid structure', () => {
    const state = defaultState();
    expect(state.meta.version).toBe(11);
    expect(state.floors).toHaveLength(1);
    expect(state.floors[0].rooms).toHaveLength(0); // No rooms by default
    expect(state.view.planningMode).toBe('floor'); // Starts in floor view
  });

  it('should include tile presets', () => {
    const state = defaultState();
    expect(state.tilePresets).toHaveLength(1);
    expect(state.tilePresets[0].name).toBe('Standard');
    expect(state.tilePresets[0].shape).toBe('rect');
  });

  it('should include skirting presets', () => {
    const state = defaultState();
    expect(state.skirtingPresets).toHaveLength(1);
    expect(state.skirtingPresets[0].heightCm).toBe(6);
  });

  it('should have selected floor but no room', () => {
    const state = defaultState();
    expect(state.selectedFloorId).toBe(state.floors[0].id);
    expect(state.selectedRoomId).toBeNull();
  });
});

describe('getWallSvgRotation', () => {
  it('returns null for non-wall rooms (no sourceRoomId)', () => {
    const room = { widthCm: 100, heightCm: 50, polygonVertices: [
      { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }
    ]};
    expect(getWallSvgRotation(room)).toBeNull();
  });

  it('returns null for non-wall rooms (no wallEdgeIndex)', () => {
    const room = { sourceRoomId: 'r1', polygonVertices: [
      { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }
    ]};
    expect(getWallSvgRotation(room)).toBeNull();
  });

  it('returns 180° for bottom-edge horizontal wall (flips floor edge to bottom)', () => {
    // Horizontal edge along x-axis: initial rotation 0°, but floorY < ceilY
    // so 180° is added to ensure floor-adjacent edge renders at bottom
    const room = {
      sourceRoomId: 'r1', wallEdgeIndex: 0,
      polygonVertices: [
        { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 30 }, { x: 0, y: 30 }
      ]
    };
    const rot = getWallSvgRotation(room);
    expect(rot).not.toBeNull();
    expect(rot.angleDeg).toBeCloseTo(180, 1);
  });

  it('returns rotation for a vertical wall', () => {
    // Vertical edge: v0→v1 goes along y-axis
    const room = {
      sourceRoomId: 'r1', wallEdgeIndex: 1,
      polygonVertices: [
        { x: 0, y: 0 }, { x: 0, y: 100 }, { x: 30, y: 100 }, { x: 30, y: 0 }
      ]
    };
    const rot = getWallSvgRotation(room);
    expect(rot).not.toBeNull();
    expect(rot.angleDeg).toBeCloseTo(-90, 1);
    expect(rot.cx).toBeCloseTo(15);
    expect(rot.cy).toBeCloseTo(50);
  });

  it('returns rotation for a 45° diagonal wall', () => {
    const room = {
      sourceRoomId: 'r1', wallEdgeIndex: 0,
      polygonVertices: [
        { x: 0, y: 0 }, { x: 100, y: 100 }, { x: 80, y: 120 }, { x: -20, y: 20 }
      ]
    };
    const rot = getWallSvgRotation(room);
    expect(rot).not.toBeNull();
    expect(typeof rot.angleDeg).toBe('number');
    expect(typeof rot.cx).toBe('number');
    expect(typeof rot.cy).toBe('number');
  });

  it('returns null when polygonVertices has fewer than 4 points', () => {
    const room = {
      sourceRoomId: 'r1', wallEdgeIndex: 0,
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }]
    };
    expect(getWallSvgRotation(room)).toBeNull();
  });
});

describe('svgToLocalPoint / localToSvgPoint', () => {
  it('passes through when wallRot is null', () => {
    expect(svgToLocalPoint(10, 20, null)).toEqual({ x: 10, y: 20 });
    expect(localToSvgPoint(10, 20, null)).toEqual({ x: 10, y: 20 });
  });

  it('are inverse operations (round-trip)', () => {
    const wallRot = { angleDeg: 90, cx: 50, cy: 50 };
    const original = { x: 30, y: 70 };
    const svgSpace = localToSvgPoint(original.x, original.y, wallRot);
    const backToLocal = svgToLocalPoint(svgSpace.x, svgSpace.y, wallRot);
    expect(backToLocal.x).toBeCloseTo(original.x, 10);
    expect(backToLocal.y).toBeCloseTo(original.y, 10);
  });

  it('round-trip works for arbitrary angle', () => {
    const wallRot = { angleDeg: 37, cx: 120, cy: 80 };
    const original = { x: 55, y: 99 };
    const svgSpace = localToSvgPoint(original.x, original.y, wallRot);
    const backToLocal = svgToLocalPoint(svgSpace.x, svgSpace.y, wallRot);
    expect(backToLocal.x).toBeCloseTo(original.x, 10);
    expect(backToLocal.y).toBeCloseTo(original.y, 10);
  });

  it('round-trip works in reverse direction', () => {
    const wallRot = { angleDeg: -45, cx: 0, cy: 0 };
    const svgPt = { x: 100, y: 200 };
    const local = svgToLocalPoint(svgPt.x, svgPt.y, wallRot);
    const backToSvg = localToSvgPoint(local.x, local.y, wallRot);
    expect(backToSvg.x).toBeCloseTo(svgPt.x, 10);
    expect(backToSvg.y).toBeCloseTo(svgPt.y, 10);
  });

  it('90° rotation rotates correctly around center', () => {
    const wallRot = { angleDeg: 90, cx: 50, cy: 50 };
    // Point at (100, 50) — 50 units right of center
    // After 90° rotation around (50,50): should be at (50, 100) — 50 units below center
    const result = localToSvgPoint(100, 50, wallRot);
    expect(result.x).toBeCloseTo(50, 10);
    expect(result.y).toBeCloseTo(100, 10);
  });

  it('180° rotation flips point through center', () => {
    const wallRot = { angleDeg: 180, cx: 50, cy: 50 };
    // Point at (70, 60): offset (20, 10) from center
    // After 180°: offset (-20, -10) → (30, 40)
    const result = localToSvgPoint(70, 60, wallRot);
    expect(result.x).toBeCloseTo(30, 10);
    expect(result.y).toBeCloseTo(40, 10);
  });

  it('center point is unchanged by any rotation', () => {
    const wallRot = { angleDeg: 137, cx: 75, cy: 25 };
    const result = localToSvgPoint(75, 25, wallRot);
    expect(result.x).toBeCloseTo(75, 10);
    expect(result.y).toBeCloseTo(25, 10);
  });
});

describe('svgToLocalDelta', () => {
  it('passes through when wallRot is null', () => {
    expect(svgToLocalDelta(10, 20, null)).toEqual({ dx: 10, dy: 20 });
  });

  it('un-rotates a 90° rotation', () => {
    const wallRot = { angleDeg: 90, cx: 0, cy: 0 };
    // SVG content was rotated 90° CW for display.
    // Un-rotating: SVG-space (10, 0) → room-local (0, -10)
    const result = svgToLocalDelta(10, 0, wallRot);
    expect(result.dx).toBeCloseTo(0, 10);
    expect(result.dy).toBeCloseTo(-10, 10);
  });

  it('un-rotates a -90° rotation', () => {
    const wallRot = { angleDeg: -90, cx: 0, cy: 0 };
    // SVG content was rotated 90° CCW for display.
    // Un-rotating: SVG-space (10, 0) → room-local (0, 10)
    const result = svgToLocalDelta(10, 0, wallRot);
    expect(result.dx).toBeCloseTo(0, 10);
    expect(result.dy).toBeCloseTo(10, 10);
  });

  it('preserves magnitude (length) of the delta vector', () => {
    const wallRot = { angleDeg: 42, cx: 100, cy: 200 };
    const dx = 30, dy = 40;
    const originalLen = Math.sqrt(dx * dx + dy * dy);
    const result = svgToLocalDelta(dx, dy, wallRot);
    const resultLen = Math.sqrt(result.dx * result.dx + result.dy * result.dy);
    expect(resultLen).toBeCloseTo(originalLen, 10);
  });

  it('delta is independent of center point', () => {
    const rot1 = { angleDeg: 60, cx: 0, cy: 0 };
    const rot2 = { angleDeg: 60, cx: 999, cy: 999 };
    const r1 = svgToLocalDelta(10, 20, rot1);
    const r2 = svgToLocalDelta(10, 20, rot2);
    expect(r1.dx).toBeCloseTo(r2.dx, 10);
    expect(r1.dy).toBeCloseTo(r2.dy, 10);
  });

  it('180° rotation inverts both components', () => {
    const wallRot = { angleDeg: 180, cx: 0, cy: 0 };
    const result = svgToLocalDelta(10, 20, wallRot);
    expect(result.dx).toBeCloseTo(-10, 10);
    expect(result.dy).toBeCloseTo(-20, 10);
  });
});
