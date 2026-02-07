/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createZoomPanController } from "./zoom-pan.js";
import { getViewport, setBaseViewBox, setViewport } from "./viewport.js";

let roomCounter = 0;
function freshRoomId() {
  return `zp-test-room-${++roomCounter}-${Date.now()}`;
}

describe("zoom-pan extended", () => {
  let getSvg;
  let roomId;
  let onViewportChange;
  let getSelectedExclId;
  let svg;
  let controller;

  beforeEach(() => {
    roomId = freshRoomId();
    svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    document.body.appendChild(svg);

    getSvg = vi.fn(() => svg);
    onViewportChange = vi.fn();
    getSelectedExclId = vi.fn(() => null);

    setBaseViewBox(roomId, { minX: 0, minY: 0, width: 1000, height: 800 });

    controller = createZoomPanController({
      getSvg,
      getCurrentRoomId: () => roomId,
      onViewportChange,
      getSelectedExclId
    });
  });

  afterEach(() => {
    if (controller) controller.detach();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  describe("zoomIn/zoomOut", () => {
    it("zoomIn increases zoom", () => {
      const before = getViewport(roomId).zoom;
      controller.zoomIn();
      expect(getViewport(roomId).zoom).toBeGreaterThan(before);
    });

    it("zoomOut decreases zoom", () => {
      const before = getViewport(roomId).zoom;
      controller.zoomOut();
      expect(getViewport(roomId).zoom).toBeLessThan(before);
    });

    it("zoomIn calls onViewportChange", () => {
      controller.zoomIn();
      expect(onViewportChange).toHaveBeenCalled();
    });

    it("zoomOut calls onViewportChange", () => {
      controller.zoomOut();
      expect(onViewportChange).toHaveBeenCalled();
    });
  });

  describe("zoomTo/reset", () => {
    it("zoomTo sets exact level", () => {
      controller.zoomTo(3);
      expect(getViewport(roomId).zoom).toBe(3);
    });

    it("reset restores default zoom/pan", () => {
      controller.zoomTo(5);
      controller.panBy(100, 100);
      controller.reset();
      const vp = getViewport(roomId);
      expect(vp.zoom).toBe(1);
      expect(vp.panX).toBe(0);
      expect(vp.panY).toBe(0);
    });

    it("reset calls onViewportChange", () => {
      controller.reset();
      expect(onViewportChange).toHaveBeenCalled();
    });
  });

  describe("panBy", () => {
    it("adjusts pan values", () => {
      controller.panBy(50, 30);
      const vp = getViewport(roomId);
      // panBy divides by zoom, at zoom=1 it should match
      expect(vp.panX).toBeCloseTo(50);
      expect(vp.panY).toBeCloseTo(30);
    });

    it("accounts for zoom in delta", () => {
      controller.zoomTo(2);
      onViewportChange.mockClear();
      controller.panBy(100, 100);
      const vp = getViewport(roomId);
      // At zoom 2, pan delta is divided by 2
      expect(vp.panX).toBeCloseTo(50);
      expect(vp.panY).toBeCloseTo(50);
    });
  });

  describe("Keyboard shortcuts", () => {
    it("'+' zooms in", () => {
      controller.attach();
      const before = getViewport(roomId).zoom;
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "+" }));
      expect(getViewport(roomId).zoom).toBeGreaterThan(before);
    });

    it("'-' zooms out", () => {
      controller.attach();
      const before = getViewport(roomId).zoom;
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "-" }));
      expect(getViewport(roomId).zoom).toBeLessThan(before);
    });

    it("'0' resets", () => {
      controller.attach();
      controller.zoomTo(5);
      onViewportChange.mockClear();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "0" }));
      expect(getViewport(roomId).zoom).toBe(1);
    });

    it("arrow keys pan", () => {
      controller.attach();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
      expect(onViewportChange).toHaveBeenCalled();
      const vp = getViewport(roomId);
      // ArrowRight pans by -step
      expect(vp.panX).toBeLessThan(0);
    });

    it("Shift+arrow keys pan faster", () => {
      controller.attach();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
      const normalPan = getViewport(roomId).panY;

      // Reset pan
      setViewport(roomId, { panY: 0 });
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", shiftKey: true }));
      const shiftPan = getViewport(roomId).panY;

      expect(Math.abs(shiftPan)).toBeGreaterThan(Math.abs(normalPan));
    });

    it("ignores keydown when target is INPUT", () => {
      controller.attach();
      const input = document.createElement("input");
      document.body.appendChild(input);
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "+", bubbles: true }));
      expect(onViewportChange).not.toHaveBeenCalled();
    });

    it("'=' also zooms in", () => {
      controller.attach();
      const before = getViewport(roomId).zoom;
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "=" }));
      expect(getViewport(roomId).zoom).toBeGreaterThan(before);
    });

    it("Home key resets", () => {
      controller.attach();
      controller.zoomTo(3);
      onViewportChange.mockClear();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Home" }));
      expect(getViewport(roomId).zoom).toBe(1);
    });

    it("Space key press sets pan-ready class", () => {
      controller.attach();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space" }));
      expect(svg.classList.contains("pan-ready")).toBe(true);
      document.dispatchEvent(new KeyboardEvent("keyup", { key: " ", code: "Space" }));
      expect(svg.classList.contains("pan-ready")).toBe(false);
    });

    it("ArrowLeft pans", () => {
      controller.attach();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
      expect(getViewport(roomId).panX).toBeGreaterThan(0);
    });

    it("ArrowUp pans", () => {
      controller.attach();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" }));
      expect(getViewport(roomId).panY).toBeGreaterThan(0);
    });
  });

  describe("attach/detach", () => {
    it("detach removes event listeners", () => {
      controller.attach();
      controller.detach();
      // After detach, keyboard events should not trigger zoom
      const before = getViewport(roomId).zoom;
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "+" }));
      expect(getViewport(roomId).zoom).toBe(before);
    });
  });
});
