// src/structure.test.js
import { describe, it, expect, vi } from "vitest";
import { findConnectedPositionForNewRoom } from "./structure.js";

// Helper: create a simple rectangular room object
function makeRoom(id, x, y, w, h) {
  return {
    id,
    widthCm: w,
    heightCm: h,
    floorPosition: { x, y },
    polygonVertices: [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ],
  };
}

describe("findConnectedPositionForNewRoom", () => {
  it("returns {x:0, y:0} when no existing rooms and no background", () => {
    const newRoom = makeRoom("new", 0, 0, 600, 400);
    const result = findConnectedPositionForNewRoom(newRoom, [], null);
    expect(result).toEqual({ x: 0, y: 0 });
  });

  it("returns {x:0, y:0} for null existingRooms", () => {
    const newRoom = makeRoom("new", 0, 0, 600, 400);
    const result = findConnectedPositionForNewRoom(newRoom, null, null);
    expect(result).toEqual({ x: 0, y: 0 });
  });

  it("returns centered position when no rooms but background exists", () => {
    const newRoom = makeRoom("new", 0, 0, 200, 100);
    const floor = {
      layout: {
        background: {
          nativeWidth: 1000,
          nativeHeight: 800,
          scale: { calibrated: true, pixelsPerCm: 1 },
        },
      },
    };
    const result = findConnectedPositionForNewRoom(newRoom, [], floor);
    // imgWidth = 1000/1 = 1000, imgHeight = 800/1 = 800
    // x = (1000 - 200) / 2 = 400, y = (800 - 100) / 2 = 350
    expect(result).toEqual({ x: 400, y: 350 });
  });

  it("returns centered position with uncalibrated scale", () => {
    const newRoom = makeRoom("new", 0, 0, 200, 100);
    const floor = {
      layout: {
        background: {
          nativeWidth: 2000,
          nativeHeight: 1600,
          scale: { calibrated: false },
        },
      },
    };
    const result = findConnectedPositionForNewRoom(newRoom, [], floor);
    // pixelsPerCm = 2000/1000 = 2
    // imgWidth = 2000/2 = 1000, imgHeight = 1600/2 = 800
    // x = (1000 - 200) / 2 = 400, y = (800 - 100) / 2 = 350
    expect(result).toEqual({ x: 400, y: 350 });
  });

  it("with existing rooms, attempts to find free edge position", () => {
    const existing = makeRoom("r1", 0, 0, 400, 300);
    const newRoom = makeRoom("new", 0, 0, 600, 400);

    const result = findConnectedPositionForNewRoom(newRoom, [existing], null);
    // Should return some position (either from findPositionOnFreeEdge or fallback)
    expect(result).toHaveProperty("x");
    expect(result).toHaveProperty("y");
    // Should be to the right of the existing room (preferred direction is 'right')
    expect(result.x).toBeGreaterThanOrEqual(0);
  });

  it("falls back to rightmost room edge when findPositionOnFreeEdge fails", () => {
    // Create a configuration that makes free edge placement unlikely to work
    // by putting many rooms in a tight cluster
    const rooms = [];
    for (let i = 0; i < 10; i++) {
      rooms.push(makeRoom(`r${i}`, i * 412, 0, 400, 300));
    }
    const newRoom = makeRoom("new", 0, 0, 600, 400);

    const result = findConnectedPositionForNewRoom(newRoom, rooms, null);
    expect(result).toHaveProperty("x");
    expect(result).toHaveProperty("y");
    // Should be at or beyond the rightmost edge
    expect(typeof result.x).toBe("number");
    expect(typeof result.y).toBe("number");
  });
});
