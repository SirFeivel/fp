import { describe, it, expect, beforeEach } from "vitest";
import {
  getViewport,
  setViewport,
  resetViewport,
  setBaseViewBox,
  calculateEffectiveViewBox,
  MIN_ZOOM,
  MAX_ZOOM
} from "./viewport.js";

// viewport.js uses a module-level Map, we use unique roomIds per test to avoid cross-contamination

let roomCounter = 0;
function freshRoomId() {
  return `vp-test-room-${++roomCounter}-${Date.now()}`;
}

describe("viewport.js", () => {
  describe("getViewport", () => {
    it("returns default for null roomId", () => {
      const vp = getViewport(null);
      expect(vp.zoom).toBe(1);
      expect(vp.panX).toBe(0);
      expect(vp.panY).toBe(0);
      expect(vp.baseViewBox).toBeNull();
    });

    it("returns default for new roomId", () => {
      const vp = getViewport(freshRoomId());
      expect(vp.zoom).toBe(1);
      expect(vp.panX).toBe(0);
      expect(vp.panY).toBe(0);
    });

    it("returns same instance on re-access", () => {
      const id = freshRoomId();
      const vp1 = getViewport(id);
      const vp2 = getViewport(id);
      expect(vp1).toBe(vp2);
    });
  });

  describe("setViewport", () => {
    it("merges updates", () => {
      const id = freshRoomId();
      setViewport(id, { zoom: 2 });
      const vp = getViewport(id);
      expect(vp.zoom).toBe(2);
      expect(vp.panX).toBe(0);
    });

    it("clamps zoom to MIN_ZOOM", () => {
      const id = freshRoomId();
      setViewport(id, { zoom: 0.01 });
      const vp = getViewport(id);
      expect(vp.zoom).toBe(MIN_ZOOM);
    });

    it("clamps zoom to MAX_ZOOM", () => {
      const id = freshRoomId();
      setViewport(id, { zoom: 999 });
      const vp = getViewport(id);
      expect(vp.zoom).toBe(MAX_ZOOM);
    });

    it("returns undefined for null roomId", () => {
      expect(setViewport(null, { zoom: 2 })).toBeUndefined();
    });
  });

  describe("resetViewport", () => {
    it("resets zoom/pan but preserves baseViewBox", () => {
      const id = freshRoomId();
      const baseVB = { minX: 10, minY: 20, width: 100, height: 200 };
      setBaseViewBox(id, baseVB);
      setViewport(id, { zoom: 3, panX: 50, panY: 60 });

      resetViewport(id);
      const vp = getViewport(id);
      expect(vp.zoom).toBe(1);
      expect(vp.panX).toBe(0);
      expect(vp.panY).toBe(0);
      expect(vp.baseViewBox).toEqual(baseVB);
    });

    it("returns undefined for null roomId", () => {
      expect(resetViewport(null)).toBeUndefined();
    });
  });

  describe("setBaseViewBox", () => {
    it("sets baseViewBox on viewport", () => {
      const id = freshRoomId();
      const baseVB = { minX: 0, minY: 0, width: 500, height: 400 };
      setBaseViewBox(id, baseVB);
      const vp = getViewport(id);
      expect(vp.baseViewBox).toEqual(baseVB);
    });
  });

  describe("calculateEffectiveViewBox", () => {
    it("returns null when no baseViewBox", () => {
      expect(calculateEffectiveViewBox(freshRoomId())).toBeNull();
    });

    it("identity at zoom=1 pan=0", () => {
      const id = freshRoomId();
      setBaseViewBox(id, { minX: 0, minY: 0, width: 1000, height: 800 });
      const evb = calculateEffectiveViewBox(id);
      expect(evb.minX).toBeCloseTo(0);
      expect(evb.minY).toBeCloseTo(0);
      expect(evb.width).toBeCloseTo(1000);
      expect(evb.height).toBeCloseTo(800);
    });

    it("halves dimensions at zoom=2", () => {
      const id = freshRoomId();
      setBaseViewBox(id, { minX: 0, minY: 0, width: 1000, height: 800 });
      setViewport(id, { zoom: 2 });
      const evb = calculateEffectiveViewBox(id);
      expect(evb.width).toBeCloseTo(500);
      expect(evb.height).toBeCloseTo(400);
    });

    it("pan offset applied correctly", () => {
      const id = freshRoomId();
      setBaseViewBox(id, { minX: 0, minY: 0, width: 1000, height: 800 });
      setViewport(id, { zoom: 1, panX: 100, panY: 50 });
      const evb = calculateEffectiveViewBox(id);
      expect(evb.minX).toBeCloseTo(100);
      expect(evb.minY).toBeCloseTo(50);
    });
  });
});
