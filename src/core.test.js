import { describe, it, expect } from 'vitest';
import { escapeHTML, safeParseJSON, defaultState, getCurrentRoom } from './core.js';

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
    expect(state.meta.version).toBe(13);
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

