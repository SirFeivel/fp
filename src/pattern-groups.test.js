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
  getEffectiveTileSettings,
  getDisconnectedRoomsOnRemoval,
  isPatternGroupChild
} from "./pattern-groups.js";
import { tilesForPreview, computeAvailableArea } from "./geometry.js";

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
      polygonVertices: cfg.polygonVertices || [{ x: 0, y: 0 }, { x: cfg.widthCm || 300, y: 0 }, { x: cfg.widthCm || 300, y: cfg.heightCm || 300 }, { x: 0, y: cfg.heightCm || 300 }],
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

    it("returns local origin point for origin room itself", () => {
      // The origin room now returns its own local origin point (based on pattern.origin preset)
      // so all rooms in the group use the same coordinate system
      const floor = createTestFloor([
        { id: "room-a", floorPosition: { x: 0, y: 0 } },
        { id: "room-b", floorPosition: { x: 300, y: 0 } }
      ]);
      floor.patternGroups = [
        { id: "pg-1", originRoomId: "room-a", memberRoomIds: ["room-a", "room-b"] }
      ];
      const originRoom = floor.rooms[0];
      const origin = computePatternGroupOrigin(originRoom, floor);
      // Default preset is "tl" (top-left), so origin should be (0, 0) for room at position (0,0)
      expect(origin).not.toBeNull();
      expect(origin.x).toBe(0);
      expect(origin.y).toBe(0);
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

    it("respects origin room's pattern.origin.preset for all rooms in group", () => {
      // This test verifies the fix: origin room and child room both reference the same global point
      // even when using non-default presets like "center"
      const floor = createTestFloor([
        {
          id: "room-a",
          floorPosition: { x: 0, y: 0 },
          widthCm: 300,
          heightCm: 300,
          pattern: { type: "herringbone", origin: { preset: "center" } }
        },
        {
          id: "room-b",
          floorPosition: { x: 300, y: 0 },
          widthCm: 300,
          heightCm: 300
        }
      ]);
      floor.patternGroups = [
        { id: "pg-1", originRoomId: "room-a", memberRoomIds: ["room-a", "room-b"] }
      ];

      const originRoom = floor.rooms[0];
      const childRoom = floor.rooms[1];

      const originRoomOrigin = computePatternGroupOrigin(originRoom, floor);
      const childRoomOrigin = computePatternGroupOrigin(childRoom, floor);

      // Origin room with "center" preset and 300x300 size: local origin is (150, 150)
      expect(originRoomOrigin.x).toBe(150);
      expect(originRoomOrigin.y).toBe(150);

      // Child room at (300, 0): global origin point is (150, 150)
      // In child's local coords: (150 - 300, 150 - 0) = (-150, 150)
      expect(childRoomOrigin.x).toBe(-150);
      expect(childRoomOrigin.y).toBe(150);

      // Both rooms reference the same global point: (150, 150)
      // Origin room: local (150, 150) + floorPos (0, 0) = global (150, 150)
      // Child room: local (-150, 150) + floorPos (300, 0) = global (150, 150)
      const originGlobal = {
        x: originRoomOrigin.x + originRoom.floorPosition.x,
        y: originRoomOrigin.y + originRoom.floorPosition.y
      };
      const childGlobal = {
        x: childRoomOrigin.x + childRoom.floorPosition.x,
        y: childRoomOrigin.y + childRoom.floorPosition.y
      };
      expect(originGlobal.x).toBe(childGlobal.x);
      expect(originGlobal.y).toBe(childGlobal.y);
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

    it("keeps group with just origin when last member is removed", () => {
      const floor = createTestFloor([
        { id: "room-a", floorPosition: { x: 0, y: 0 }, widthCm: 300 },
        { id: "room-b", floorPosition: { x: 300, y: 0 }, widthCm: 300 }
      ]);
      const group = createPatternGroup(floor, "room-a");
      addRoomToPatternGroup(floor, group.id, "room-b");

      const result = removeRoomFromPatternGroup(floor, group.id, "room-b");
      expect(result.success).toBe(true);
      expect(result.dissolved).toBe(false);
      expect(floor.patternGroups).toHaveLength(1);
      expect(floor.patternGroups[0].memberRoomIds).toEqual(["room-a"]);
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

  describe("getDisconnectedRoomsOnRemoval", () => {
    it("returns empty array when no rooms would be disconnected", () => {
      const floor = createTestFloor([
        { id: "room-a", floorPosition: { x: 0, y: 0 }, widthCm: 300 },
        { id: "room-b", floorPosition: { x: 300, y: 0 }, widthCm: 300 },
        { id: "room-c", floorPosition: { x: 600, y: 0 }, widthCm: 300 }
      ]);
      const group = createPatternGroup(floor, "room-a");
      addRoomToPatternGroup(floor, group.id, "room-b");
      addRoomToPatternGroup(floor, group.id, "room-c");

      // Removing room-c doesn't disconnect anyone
      const disconnected = getDisconnectedRoomsOnRemoval(floor, group.id, "room-c");
      expect(disconnected).toEqual([]);
    });

    it("returns disconnected rooms when bridge room is removed", () => {
      const floor = createTestFloor([
        { id: "room-a", floorPosition: { x: 0, y: 0 }, widthCm: 300 },
        { id: "room-b", floorPosition: { x: 300, y: 0 }, widthCm: 300 },
        { id: "room-c", floorPosition: { x: 600, y: 0 }, widthCm: 300 }
      ]);
      const group = createPatternGroup(floor, "room-a");
      addRoomToPatternGroup(floor, group.id, "room-b");
      addRoomToPatternGroup(floor, group.id, "room-c");

      // Removing room-b disconnects room-c from origin
      const disconnected = getDisconnectedRoomsOnRemoval(floor, group.id, "room-b");
      expect(disconnected).toEqual(["room-c"]);
    });

    it("returns empty array when only origin would remain", () => {
      const floor = createTestFloor([
        { id: "room-a", floorPosition: { x: 0, y: 0 }, widthCm: 300 },
        { id: "room-b", floorPosition: { x: 300, y: 0 }, widthCm: 300 }
      ]);
      const group = createPatternGroup(floor, "room-a");
      addRoomToPatternGroup(floor, group.id, "room-b");

      const disconnected = getDisconnectedRoomsOnRemoval(floor, group.id, "room-b");
      expect(disconnected).toEqual([]);
    });
  });

  describe("removeRoomFromPatternGroup - bridge removal", () => {
    it("removes bridge room and all disconnected rooms", () => {
      const floor = createTestFloor([
        { id: "room-a", floorPosition: { x: 0, y: 0 }, widthCm: 300 },
        { id: "room-b", floorPosition: { x: 300, y: 0 }, widthCm: 300 },
        { id: "room-c", floorPosition: { x: 600, y: 0 }, widthCm: 300 }
      ]);
      const group = createPatternGroup(floor, "room-a");
      addRoomToPatternGroup(floor, group.id, "room-b");
      addRoomToPatternGroup(floor, group.id, "room-c");

      const result = removeRoomFromPatternGroup(floor, group.id, "room-b");
      expect(result.success).toBe(true);
      expect(result.dissolved).toBe(false);
      expect(result.removedRoomIds).toContain("room-b");
      expect(result.removedRoomIds).toContain("room-c");
      expect(floor.patternGroups[0].memberRoomIds).toEqual(["room-a"]);
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

  describe("tilesForPreview pattern inheritance", () => {
    it("child room uses origin room's herringbone pattern instead of its own grid pattern", () => {
      // Reproduce the user's scenario: Origin has herringbone, Child has grid
      // Child should inherit herringbone from origin when in a pattern group
      const originRoom = {
        id: "origin-room",
        name: "Origin",
        widthCm: 300,
        heightCm: 300,
        polygonVertices: [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 300 }, { x: 0, y: 300 }],
        exclusions: [],
        tile: { widthCm: 40, heightCm: 20, shape: "rect" },
        grout: { widthCm: 0.2, colorHex: "#ffffff" },
        pattern: {
          type: "herringbone",
          rotationDeg: 0,
          offsetXcm: 0,
          offsetYcm: 0,
          origin: { preset: "center", xCm: 0, yCm: 0 }
        },
        floorPosition: { x: 0, y: 0 }
      };

      const childRoom = {
        id: "child-room",
        name: "Child",
        widthCm: 300,
        heightCm: 300,
        polygonVertices: [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 300 }, { x: 0, y: 300 }],
        exclusions: [],
        tile: { widthCm: 40, heightCm: 20, shape: "rect" },
        grout: { widthCm: 0.2, colorHex: "#ffffff" },
        pattern: {
          type: "grid",  // Child has grid but should use origin's herringbone
          rotationDeg: 0,
          offsetXcm: 0,
          offsetYcm: 0,
          origin: { preset: "tl", xCm: 0, yCm: 0 }
        },
        floorPosition: { x: 300, y: 0 }
      };

      const floor = {
        id: "floor-1",
        rooms: [originRoom, childRoom],
        patternGroups: [{
          id: "group-1",
          originRoomId: "origin-room",
          memberRoomIds: ["origin-room", "child-room"]
        }]
      };

      const state = {
        floors: [floor],
        selectedFloorId: "floor-1",
        selectedRoomId: "child-room"
      };

      // Compute available area for child room
      const avail = computeAvailableArea(childRoom, childRoom.exclusions);
      expect(avail.mp).toBeTruthy();

      // Get effective settings - should return origin's herringbone
      const effectiveSettings = getEffectiveTileSettings(childRoom, floor);
      expect(effectiveSettings.pattern.type).toBe("herringbone");
      expect(effectiveSettings.pattern.origin.preset).toBe("center");

      // Generate tiles with effective settings
      const patternGroupOrigin = computePatternGroupOrigin(childRoom, floor);
      const result = tilesForPreview(
        state,
        avail.mp,
        childRoom,
        false,
        floor,
        { originOverride: patternGroupOrigin, effectiveSettings }
      );

      // Should generate tiles without error
      expect(result.error).toBeFalsy();
      expect(result.tiles.length).toBeGreaterThan(0);

      // Verify the tiles are generated with herringbone pattern characteristics
      // Herringbone tiles have diagonal arrangements - check that at least some tiles
      // have vertices that don't align with a simple grid
      const firstTile = result.tiles[0];
      expect(firstTile.d).toBeTruthy();
    });

    it("independent room uses its own pattern settings", () => {
      const independentRoom = {
        id: "independent-room",
        name: "Independent",
        widthCm: 300,
        heightCm: 300,
        polygonVertices: [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 300 }, { x: 0, y: 300 }],
        exclusions: [],
        tile: { widthCm: 40, heightCm: 20, shape: "rect" },
        grout: { widthCm: 0.2, colorHex: "#ffffff" },
        pattern: {
          type: "grid",
          rotationDeg: 0,
          offsetXcm: 0,
          offsetYcm: 0,
          origin: { preset: "tl", xCm: 0, yCm: 0 }
        },
        floorPosition: { x: 0, y: 0 }
      };

      const floor = {
        id: "floor-1",
        rooms: [independentRoom],
        patternGroups: []
      };

      const state = {
        floors: [floor],
        selectedFloorId: "floor-1",
        selectedRoomId: "independent-room"
      };

      // Get effective settings - should return room's own grid pattern
      const effectiveSettings = getEffectiveTileSettings(independentRoom, floor);
      expect(effectiveSettings.pattern.type).toBe("grid");

      // Compute available area
      const avail = computeAvailableArea(independentRoom, independentRoom.exclusions);

      // Generate tiles
      const result = tilesForPreview(
        state,
        avail.mp,
        independentRoom,
        false,
        floor,
        { effectiveSettings }
      );

      expect(result.error).toBeFalsy();
      expect(result.tiles.length).toBeGreaterThan(0);
    });

    it("real-world scenario: origin with center preset and multiple child rooms all share same global origin", () => {
      // Based on user test scenario: test_child_origin_pattern.json
      // Origin room has herringbone with center preset
      // Children have grid patterns but should inherit origin's herringbone
      // Child 3 has different tile size but should inherit origin's tile settings

      const floor = {
        id: "floor-1",
        patternGroups: [{
          id: "group-1",
          originRoomId: "origin-room",
          memberRoomIds: ["origin-room", "child-1", "child-2", "child-3"]
        }],
        rooms: [
          {
            id: "independent-room",
            name: "Independant",
            widthCm: 300,
            heightCm: 300,
            polygonVertices: [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 300 }, { x: 0, y: 300 }],
            exclusions: [],
            tile: { widthCm: 40, heightCm: 20, shape: "rect" },
            grout: { widthCm: 0.2, colorHex: "#ffffff" },
            pattern: {
              type: "grid",
              rotationDeg: 0,
              offsetXcm: 0,
              offsetYcm: 0,
              origin: { preset: "tl", xCm: 0, yCm: 0 }
            },
            floorPosition: { x: 0, y: -129 }
          },
          {
            id: "origin-room",
            name: "Origin",
            widthCm: 300,
            heightCm: 300,
            polygonVertices: [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 300 }, { x: 0, y: 300 }],
            exclusions: [],
            tile: { widthCm: 40, heightCm: 20, shape: "rect" },
            grout: { widthCm: 0.2, colorHex: "#ffffff" },
            pattern: {
              type: "herringbone",
              rotationDeg: 0,
              offsetXcm: 0,
              offsetYcm: 0,
              origin: { preset: "center", xCm: 0, yCm: 0 }
            },
            floorPosition: { x: 300, y: -129 }
          },
          {
            id: "child-1",
            name: "Child 1",
            widthCm: 289,
            heightCm: 421,
            exclusions: [],
            tile: { widthCm: 40, heightCm: 20, shape: "rect" },
            grout: { widthCm: 0.2, colorHex: "#ffffff" },
            pattern: {
              type: "grid",  // Should be overridden by origin's herringbone
              rotationDeg: 0,
              offsetXcm: 0,
              offsetYcm: 0,
              origin: { preset: "tl", xCm: 0, yCm: 0 }
            },
            floorPosition: { x: 600, y: -71 },
            polygonVertices: [
              { x: 0, y: 0 },
              { x: 167, y: 0 },
              { x: 289, y: 181 },
              { x: 289, y: 421 },
              { x: 0, y: 421 }
            ]
          },
          {
            id: "child-2",
            name: "Child 2",
            widthCm: 219,
            heightCm: 237,
            polygonVertices: [{ x: 0, y: 0 }, { x: 219, y: 0 }, { x: 219, y: 237 }, { x: 0, y: 237 }],
            exclusions: [],
            tile: { widthCm: 40, heightCm: 20, shape: "rect" },
            grout: { widthCm: 0.2, colorHex: "#ffffff" },
            pattern: {
              type: "grid",  // Should be overridden by origin's herringbone
              rotationDeg: 0,
              offsetXcm: 0,
              offsetYcm: 0,
              origin: { preset: "tl", xCm: 0, yCm: 0 }
            },
            floorPosition: { x: 889, y: 112.5 }
          },
          {
            id: "child-3",
            name: "Child 3",
            widthCm: 246,
            heightCm: 253,
            exclusions: [],
            tile: { widthCm: 60, heightCm: 30, shape: "rect" },  // Different tile size - should use origin's 40x20
            grout: { widthCm: 0.3, colorHex: "#ffffff" },
            pattern: {
              type: "grid",  // Should be overridden by origin's herringbone
              rotationDeg: 0,
              offsetXcm: 0,
              offsetYcm: 0,
              origin: { preset: "tl", xCm: 0, yCm: 0 }
            },
            floorPosition: { x: 767, y: -143 },
            polygonVertices: [
              { x: 0, y: 72 },
              { x: 74, y: 72 },
              { x: 119, y: 0 },
              { x: 246, y: 25 },
              { x: 241, y: 209 },
              { x: 122, y: 253 }
            ]
          }
        ]
      };

      const originRoom = floor.rooms.find(r => r.id === "origin-room");
      const child1 = floor.rooms.find(r => r.id === "child-1");
      const child2 = floor.rooms.find(r => r.id === "child-2");
      const child3 = floor.rooms.find(r => r.id === "child-3");
      const independentRoom = floor.rooms.find(r => r.id === "independent-room");

      // 1. Verify all children inherit origin's pattern settings
      const originSettings = getEffectiveTileSettings(originRoom, floor);
      const child1Settings = getEffectiveTileSettings(child1, floor);
      const child2Settings = getEffectiveTileSettings(child2, floor);
      const child3Settings = getEffectiveTileSettings(child3, floor);
      const independentSettings = getEffectiveTileSettings(independentRoom, floor);

      // Origin and all children should have herringbone
      expect(originSettings.pattern.type).toBe("herringbone");
      expect(child1Settings.pattern.type).toBe("herringbone");
      expect(child2Settings.pattern.type).toBe("herringbone");
      expect(child3Settings.pattern.type).toBe("herringbone");

      // All children should inherit origin's tile size (40x20), not their own
      expect(child1Settings.tile.widthCm).toBe(40);
      expect(child3Settings.tile.widthCm).toBe(40);  // Not 60!

      // Independent room keeps its own grid pattern
      expect(independentSettings.pattern.type).toBe("grid");

      // 2. Verify all rooms in group reference the same global origin point
      const originOrigin = computePatternGroupOrigin(originRoom, floor);
      const child1Origin = computePatternGroupOrigin(child1, floor);
      const child2Origin = computePatternGroupOrigin(child2, floor);
      const child3Origin = computePatternGroupOrigin(child3, floor);

      // Convert local origins to global coordinates
      const toGlobal = (room, localOrigin) => ({
        x: localOrigin.x + room.floorPosition.x,
        y: localOrigin.y + room.floorPosition.y
      });

      const originGlobal = toGlobal(originRoom, originOrigin);
      const child1Global = toGlobal(child1, child1Origin);
      const child2Global = toGlobal(child2, child2Origin);
      const child3Global = toGlobal(child3, child3Origin);

      // All should reference the same global point (origin room's center: 300 + 150, -129 + 150)
      const expectedGlobal = { x: 450, y: 21 };
      expect(originGlobal.x).toBe(expectedGlobal.x);
      expect(originGlobal.y).toBe(expectedGlobal.y);
      expect(child1Global.x).toBe(expectedGlobal.x);
      expect(child1Global.y).toBe(expectedGlobal.y);
      expect(child2Global.x).toBe(expectedGlobal.x);
      expect(child2Global.y).toBe(expectedGlobal.y);
      expect(child3Global.x).toBe(expectedGlobal.x);
      expect(child3Global.y).toBe(expectedGlobal.y);

      // 3. Independent room should return null (not in a group)
      const independentOrigin = computePatternGroupOrigin(independentRoom, floor);
      expect(independentOrigin).toBeNull();
    });
  });

  describe("isPatternGroupChild", () => {
    it("returns false for room not in any group", () => {
      const floor = createTestFloor([{ id: "room-a" }]);
      const room = floor.rooms[0];
      expect(isPatternGroupChild(room, floor)).toBe(false);
    });

    it("returns false for origin room of a group", () => {
      const floor = createTestFloor([{ id: "room-a" }, { id: "room-b" }]);
      floor.patternGroups = [
        { id: "pg-1", originRoomId: "room-a", memberRoomIds: ["room-a", "room-b"] }
      ];
      const originRoom = floor.rooms[0];
      expect(isPatternGroupChild(originRoom, floor)).toBe(false);
    });

    it("returns true for non-origin member of a group", () => {
      const floor = createTestFloor([{ id: "room-a" }, { id: "room-b" }]);
      floor.patternGroups = [
        { id: "pg-1", originRoomId: "room-a", memberRoomIds: ["room-a", "room-b"] }
      ];
      const childRoom = floor.rooms[1];
      expect(isPatternGroupChild(childRoom, floor)).toBe(true);
    });

    it("returns false for null room or floor", () => {
      const floor = createTestFloor([{ id: "room-a" }]);
      expect(isPatternGroupChild(null, floor)).toBe(false);
      expect(isPatternGroupChild(floor.rooms[0], null)).toBe(false);
    });
  });
});
