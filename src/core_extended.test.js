/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { 
  nowISO, 
  deepClone, 
  downloadText, 
  uuid, 
  degToRad, 
  getCurrentRoom, 
  getCurrentFloor 
} from './core.js';

describe('core.js extended tests', () => {
  it('nowISO returns a valid ISO string', () => {
    const iso = nowISO();
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  describe('deepClone', () => {
    it('clones objects', () => {
      const obj = { a: 1, b: { c: 2 } };
      const cloned = deepClone(obj);
      expect(cloned).toEqual(obj);
      expect(cloned).not.toBe(obj);
      expect(cloned.b).not.toBe(obj.b);
    });

    it('uses fallback when structuredClone is missing', () => {
      const originalStructuredClone = globalThis.structuredClone;
      delete globalThis.structuredClone;
      
      const obj = { a: 1 };
      const cloned = deepClone(obj);
      expect(cloned).toEqual(obj);
      
      globalThis.structuredClone = originalStructuredClone;
    });
  });

  it('downloadText creates a link and clicks it', () => {
    const appendSpy = vi.spyOn(document.body, 'appendChild');
    const removeSpy = vi.spyOn(document.body, 'removeChild');
    // JSDOM might not support URL.createObjectURL/revokeObjectURL fully or at all in some environments
    const createObjectURLSpy = vi.fn(() => 'blob:url');
    const revokeObjectURLSpy = vi.fn();
    globalThis.URL.createObjectURL = createObjectURLSpy;
    globalThis.URL.revokeObjectURL = revokeObjectURLSpy;

    downloadText('test.json', '{"a":1}');

    expect(createObjectURLSpy).toHaveBeenCalled();
    expect(appendSpy).toHaveBeenCalled();
    // In JSDOM, we can check if an anchor was added
    const anchor = appendSpy.mock.calls[0][0];
    expect(anchor.tagName).toBe('A');
    expect(anchor.download).toBe('test.json');
    expect(anchor.href).toBe('blob:url');
    
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:url');
  });

  describe('uuid', () => {
    it('generates unique strings', () => {
      const id1 = uuid();
      const id2 = uuid();
      expect(id1).not.toBe(id2);
      expect(typeof id1).toBe('string');
    });

    it('uses fallback when crypto.randomUUID is missing', () => {
      // Use vi.spyOn if possible, but crypto is often read-only.
      // In JSDOM/Vitest, we might be able to use Object.defineProperty
      const originalCrypto = globalThis.crypto;
      
      Object.defineProperty(globalThis, 'crypto', {
        value: { randomUUID: undefined },
        configurable: true
      });
      
      const id = uuid();
      expect(typeof id).toBe('string');
      expect(id).toContain('-');
      
      Object.defineProperty(globalThis, 'crypto', {
        value: originalCrypto,
        configurable: true
      });
    });
  });

  it('degToRad converts degrees to radians', () => {
    expect(degToRad(180)).toBeCloseTo(Math.PI);
    expect(degToRad(90)).toBeCloseTo(Math.PI / 2);
    expect(degToRad(0)).toBe(0);
  });

  describe('getCurrentRoom', () => {
    it('returns null if state is incomplete', () => {
      expect(getCurrentRoom({})).toBeNull();
      expect(getCurrentRoom({ floors: [] })).toBeNull();
    });

    it('returns null if floor not found', () => {
        const state = {
            floors: [{ id: 'f1', rooms: [{ id: 'r1' }] }],
            selectedFloorId: 'f2',
            selectedRoomId: 'r1'
        };
        expect(getCurrentRoom(state)).toBeNull();
    });

    it('returns null if floor has no rooms', () => {
        const state = {
            floors: [{ id: 'f1' }],
            selectedFloorId: 'f1',
            selectedRoomId: 'r1'
        };
        expect(getCurrentRoom(state)).toBeNull();
    });
  });

  describe('getCurrentFloor', () => {
    it('returns the current floor', () => {
        const state = {
            floors: [{ id: 'f1' }, { id: 'f2' }],
            selectedFloorId: 'f2'
        };
        expect(getCurrentFloor(state)).toEqual({ id: 'f2' });
    });

    it('returns null if not found', () => {
        const state = {
            floors: [{ id: 'f1' }],
            selectedFloorId: 'f2'
        };
        expect(getCurrentFloor(state)).toBeNull();
        expect(getCurrentFloor({})).toBeNull();
    });
  });
});
