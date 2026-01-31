// src/pattern-groups.test.js
import { describe, it, expect, beforeEach } from "vitest";
import {
  getRoomPatternGroup,
  getPatternOriginRoom,
  computePatternGroupOrigin,
  canJoinPatternGroup,
  createPatternGroup,
  addRoomToPatternGroup,
  removeRoomFromPatternGroup,
  dissolvePatternGroup,
  changePatternGroupOrigin,
  validatePatternGroupConnectivity,
  getEffectiveTileSettings
} from "./pattern-groups.js";

// Helper to create a floor with rooms
function createTestFloor(roomConfigs) {
  return {
    id: "floor-1",
    patternGroups: [],
    rooms: roomConfigs.map((cfg, i) => ({
      id: cfg.id || `room-${i}`,
      name: cfg.name || `Room ${i}`,
      floorPosition: cfg.floorPosition || { x: 0, y: 0 },
      widthCm: cfg.widthCm || 300,
      heightCm: cfg.heightCm || 300,
      sections: cfg.sections || [{ id: `sec-${i}`, x: 0, y: 0, widthCm: cfg.widthCm || 300, heightCm: cfg.heightCm || 300 }],
      tile: cfg.tile || { widthCm: 40, heightCm: 20, shape: "rect" },
      pattern: cfg.pattern || { type: "grid", rotationDeg: 0 },
      grout: cfg.grout || { widthCm: 0.2, colorHex: "#ffffff" }
    }))
  };
}

describe("pattern-groups", () => {
  describe("getRoomPatternGroup", () => {
    it("returns null for room not in any group", () => {
      const floor = createTestFloor([{ id: "room-a" }]);
      expect(getRoomPatternGroup(floor, "room-a")).toBeNull();
    });

    it("returns the group containing the room", () => {
      const floor = createTestFloor([{ id: "room-a" }, { id: "room-b" }]);
      floor.patternGroups = [
        { id: "pg-1", originRoomId: "room-a", memberRoomIds: ["room-a", "room-b"] }
      ];
      const group = getRoomPatternGroup(floor, "room-b");
      expect(group).not.toBeNull();
      expect(group.id).toBe("pg-1");
    });

    it("returns null for invalid inputs", () => {
      expect(getRoomPatternGroup(null, "room-a")).toBeNull();
      expect(getRoomPatternGroup({}, null)).toBeNull();
    });
  });

  describe("getPatternOriginRoom", () => {
    it("returns the room itself if not in a group", () => {
      const floor = createTestFloor([{ id: "room-a" }]);
      const origin = getPatternOriginRoom(floor, "room-a");
      expect(origin).not.toBeNull();
      expect(origin.id).toBe("room-a");
    });

    it("returns the origin room when room is in a group", () => {
      const floor = createTestFloor([
        { id: "room-a", tile: { widthCm: 60, heightCm: 30, shape: "rect" } },
        { id: "room-b", tile: { widthCm: 40, heightCm: 20, shape: "rect" } }
      ]);
      floor.patternGroups = [
        { id: "pg-1", originRoomId: "room-a", memberRoomIds: ["room-a", "room-b"] }
      ];
      const origin = getPatternOriginRoom(floor, "room-b");
      expect(origin).not.toBeNull();
      expect(origin.id).toBe("room-a");
      expect(origin.tile.widthCm).toBe(60);
    });
  });

  describe("computePatternGroupOrigin", () => {
    it("returns null for independent room", () => {
      const floor = createTestFloor([{ id: "room-a" }]);
      const room = floor.rooms[0];
      expect(computePatternGroupOrigin(room, floor)).toBeNull();
    });

    it("returns null for origin room itself", () => {
      const floor = createTestFloor([
        { id: "room-a", floorPosition: { x: 0, y: 0 } },
        { id: "room-b", floorPosition: { x: 300, y: 0 } }
      ]);
      floor.patternGroups = [
        { id: "pg-1", originRoomId: "room-a", memberRoomIds: ["room-a", "room-b"] }
      ];
      const originRoom = floor.rooms[0];
      expect(computePatternGroupOrigin(originRoom, floor)).toBeNull();
    });

    it("computes correct origin for child room", () => {
      const floor = createTestFloor([
        { id: "room-a", floorPosition: { x: 0, y: 0 }, widthCm: 300, heightCm: 300 },
        { id: "room-b", floorPosition: { x: 300, y: 0 }, widthCm: 300, heightCm: 300 }
      ]);
      floor.patternGroups = [
        { id: "pg-1", originRoomId: "room-a", memberRoomIds: ["room-a", "room-b"] }
      ];
      const childRoom = floor.rooms[1];
      const origin = computePatternGroupOrigin(childRoom, floor);
      expect(origin).not.toBeNull();
      // Origin room is at (0,0), child is at (300,0)
      // So origin in child's local coords should be (-300, 0)
      expect(origin.x).toBe(-300);
      expect(origin.y).toBe(0);
    });
  });

  describe("canJoinPatternGroup", () => {
    it("returns false for non-adjacent room", () => {
      const floor = createTestFloor([
        { id: "room-a", floorPosition: { x: 0, y: 0 } },
        { id: "room-b", floorPosition: { x: 1000, y: 0 } } // Far away
      ]);
      const group = createPatternGroup(floor, "room-a");
      expect(canJoinPatternGroup(floor, group.id, "room-b")).toBe(false);
    });

    it("returns true for adjacent room", () => {
      const floor = createTestFloor([
        { id: "room-a", floorPosition: { x: 0, y: 0 }, widthCm: 300, heightCm: 300 },
        { id: "room-b", floorPosition: { x: 300, y: 0 }, widthCm: 300, heightCm: 300 }
      ]);
      const group = createPatternGroup(floor, "room-a");
      expect(canJoinPatternGroup(floor, group.id, "room-b")).toBe(true);
    });

    it("returns false for room already in the group", () => {
      const floor = createTestFloor([
        { id: "room-a", floorPosition: { x: 0, y: 0 } },
        { id: "room-b", floorPosition: { x: 300, y: 0 } }
      ]);
      const group = createPatternGroup(floor, "room-a");
      addRoomToPatternGroup(floor, group.id, "room-b");
      expect(canJoinPatternGroup(floor, group.id, "room-b")).toBe(false);
    });

    it("returns false for room in another group", () => {
      const floor = createTestFloor([
        { id: "room-a", floorPosition: { x: 0, y: 0 } },
        { id: "room-b", floorPosition: { x: 300, y: 0 } },
        { id: "room-c", floorPosition: { x: 600, y: 0 } }
      ]);
      const group1 = createPatternGroup(floor, "room-a");
      const group2 = createPatternGroup(floor, "room-c");
      addRoomToPatternGroup(floor, group1.id, "room-b");
      // room-b is adjacent to room-c but already in group1
      expect(canJoinPatternGroup(floor, group2.id, "room-b")).toBe(false);
    });
  });

  describe("createPatternGroup", () => {
    it("creates a new pattern group", () => {
      const floor = createTestFloor([{ id: "room-a" }]);
      const group = createPatternGroup(floor, "room-a");
      expect(group).not.toBeNull();
      expect(group.originRoomId).toBe("room-a");
      expect(group.memberRoomIds).toContain("room-a");
      expect(floor.patternGroups).toHaveLength(1);
    });

    it("returns null if room already in a group", () => {
      const floor = createTestFloor([{ id: "room-a" }]);
      createPatternGroup(floor, "room-a");
      const second = createPatternGroup(floor, "room-a");
      expect(second).toBeNull();
      expect(floor.patternGroups).toHaveLength(1);
    });

    it("returns null for non-existent room", () => {
      const floor = createTestFloor([{ id: "room-a" }]);
      const group = createPatternGroup(floor, "room-xyz");
      expect(group).toBeNull();
    });
  });

  describe("addRoomToPatternGroup", () => {
    it("adds an adjacent room to the group", () => {
      const floor = createTestFloor([
        { id: "room-a", floorPosition: { x: 0, y: 0 }, widthCm: 300 },
        { id: "room-b", floorPosition: { x: 300, y: 0 }, widthCm: 300 }
      ]);
      const group = createPatternGroup(floor, "room-a");
      const result = addRoomToPatternGroup(floor, group.id, "room-b");
      expect(result).toBe(true);
      expect(group.memberRoomIds).toContain("room-b");
    });

    it("returns false for non-adjacent room", () => {
      const floor = createTestFloor([
        { id: "room-a", floorPosition: { x: 0, y: 0 } },
        { id: "room-b", floorPosition: { x: 1000, y: 0 } }
      ]);
      const group = createPatternGroup(floor, "room-a");
      const result = addRoomToPatternGroup(floor, group.id, "room-b");
      expect(result).toBe(false);
    });
  });

  describe("removeRoomFromPatternGroup", () => {
    it("removes a child room from the group", () => {
      const floor = createTestFloor([
        { id: "room-a", floorPosition: { x: 0, y: 0 }, widthCm: 300 },
        { id: "room-b", floorPosition: { x: 300, y: 0 }, widthCm: 300 },
        { id: "room-c", floorPosition: { x: 600, y: 0 }, widthCm: 300 }
      ]);
      const group = createPatternGroup(floor, "room-a");
      addRoomToPatternGroup(floor, group.id, "room-b");
      addRoomToPatternGroup(floor, group.id, "room-c");

      const result = removeRoomFromPatternGroup(floor, group.id, "room-c");
      expect(result.success).toBe(true);
      expect(result.dissolved).toBe(false);
      expect(floor.patternGroups[0].memberRoomIds).not.toContain("room-c");
    });

    it("dissolves group when origin room is removed", () => {
      const floor = createTestFloor([
        { id: "room-a", floorPosition: { x: 0, y: 0 }, widthCm: 300 },
        { id: "room-b", floorPosition: { x: 300, y: 0 }, widthCm: 300 }
      ]);
      const group = createPatternGroup(floor, "room-a");
      addRoomToPatternGroup(floor, group.id, "room-b");

      const result = removeRoomFromPatternGroup(floor, group.id, "room-a");
      expect(result.success).toBe(true);
      expect(result.dissolved).toBe(true);
      expect(floor.patternGroups).toHaveLength(0);
    });

    it("dissolves group when only one room would remain", () => {
      const floor = createTestFloor([
        { id: "room-a", floorPosition: { x: 0, y: 0 }, widthCm: 300 },
        { id: "room-b", floorPosition: { x: 300, y: 0 }, widthCm: 300 }
      ]);
      const group = createPatternGroup(floor, "room-a");
      addRoomToPatternGroup(floor, group.id, "room-b");

      const result = removeRoomFromPatternGroup(floor, group.id, "room-b");
      expect(result.success).toBe(true);
      expect(result.dissolved).toBe(true);
      expect(floor.patternGroups).toHaveLength(0);
    });
  });

  describe("dissolvePatternGroup", () => {
    it("removes the pattern group entirely", () => {
      const floor = createTestFloor([
        { id: "room-a", floorPosition: { x: 0, y: 0 }, widthCm: 300 },
        { id: "room-b", floorPosition: { x: 300, y: 0 }, widthCm: 300 }
      ]);
      const group = createPatternGroup(floor, "room-a");
      addRoomToPatternGroup(floor, group.id, "room-b");
      expect(floor.patternGroups).toHaveLength(1);

      const result = dissolvePatternGroup(floor, group.id);
      expect(result).toBe(true);
      expect(floor.patternGroups).toHaveLength(0);
    });

    it("returns false for non-existent group", () => {
      const floor = createTestFloor([{ id: "room-a" }]);
      const result = dissolvePatternGroup(floor, "non-existent");
      expect(result).toBe(false);
    });
  });

  describe("changePatternGroupOrigin", () => {
    it("changes the origin room", () => {
      const floor = createTestFloor([
        { id: "room-a", floorPosition: { x: 0, y: 0 }, widthCm: 300 },
        { id: "room-b", floorPosition: { x: 300, y: 0 }, widthCm: 300 }
      ]);
      const group = createPatternGroup(floor, "room-a");
      addRoomToPatternGroup(floor, group.id, "room-b");

      const result = changePatternGroupOrigin(floor, group.id, "room-b");
      expect(result).toBe(true);
      expect(floor.patternGroups[0].originRoomId).toBe("room-b");
    });

    it("returns false for non-member room", () => {
      const floor = createTestFloor([
        { id: "room-a" },
        { id: "room-b" },
        { id: "room-c" }
      ]);
      const group = createPatternGroup(floor, "room-a");
      const result = changePatternGroupOrigin(floor, group.id, "room-c");
      expect(result).toBe(false);
    });
  });

  describe("validatePatternGroupConnectivity", () => {
    it("returns true for connected group", () => {
      const floor = createTestFloor([
        { id: "room-a", floorPosition: { x: 0, y: 0 }, widthCm: 300 },
        { id: "room-b", floorPosition: { x: 300, y: 0 }, widthCm: 300 },
        { id: "room-c", floorPosition: { x: 600, y: 0 }, widthCm: 300 }
      ]);
      const group = createPatternGroup(floor, "room-a");
      addRoomToPatternGroup(floor, group.id, "room-b");
      addRoomToPatternGroup(floor, group.id, "room-c");

      expect(validatePatternGroupConnectivity(floor, group.id)).toBe(true);
    });

    it("returns true for single room group", () => {
      const floor = createTestFloor([{ id: "room-a" }]);
      const group = createPatternGroup(floor, "room-a");
      expect(validatePatternGroupConnectivity(floor, group.id)).toBe(true);
    });
  });

  describe("getEffectiveTileSettings", () => {
    it("returns room's own settings if independent", () => {
      const floor = createTestFloor([
        { id: "room-a", tile: { widthCm: 50, heightCm: 25, shape: "rect" } }
      ]);
      const settings = getEffectiveTileSettings(floor.rooms[0], floor);
      expect(settings.tile.widthCm).toBe(50);
    });

    it("returns origin room's settings if in a group", () => {
      const floor = createTestFloor([
        { id: "room-a", floorPosition: { x: 0, y: 0 }, tile: { widthCm: 60, heightCm: 30, shape: "rect" }, widthCm: 300 },
        { id: "room-b", floorPosition: { x: 300, y: 0 }, tile: { widthCm: 40, heightCm: 20, shape: "rect" }, widthCm: 300 }
      ]);
      const group = createPatternGroup(floor, "room-a");
      addRoomToPatternGroup(floor, group.id, "room-b");

      const settings = getEffectiveTileSettings(floor.rooms[1], floor);
      expect(settings.tile.widthCm).toBe(60);
      expect(settings.tile.heightCm).toBe(30);
    });
  });
});
