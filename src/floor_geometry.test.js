// src/floor_geometry.test.js
import { describe, it, expect } from 'vitest';
import {
  getFloorBounds,
  roomToFloor,
  floorToRoom,
  translateMultiPolygon,
  areRoomsAdjacent,
  findAdjacentRooms,
  getRoomAbsoluteBounds,
  doRoomsOverlap,
  wouldRoomOverlap,
  findRoomSnapPositions,
  findNearestNonOverlappingPosition,
  isRoomConnected,
  findNearestConnectedPosition
} from './floor_geometry.js';

describe('getFloorBounds', () => {
  it('returns zero bounds for empty floor', () => {
    const bounds = getFloorBounds({ rooms: [] });
    expect(bounds).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 });
  });

  it('returns zero bounds for null floor', () => {
    const bounds = getFloorBounds(null);
    expect(bounds).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 });
  });

  it('computes bounds for single room at origin', () => {
    const floor = {
      rooms: [{
        id: 'r1',
        floorPosition: { x: 0, y: 0 },
        sections: [{ id: 's1', x: 0, y: 0, widthCm: 400, heightCm: 300 }]
      }]
    };
    const bounds = getFloorBounds(floor);
    expect(bounds.minX).toBe(0);
    expect(bounds.minY).toBe(0);
    expect(bounds.maxX).toBe(400);
    expect(bounds.maxY).toBe(300);
    expect(bounds.width).toBe(400);
    expect(bounds.height).toBe(300);
  });

  it('computes bounds for room with floor position offset', () => {
    const floor = {
      rooms: [{
        id: 'r1',
        floorPosition: { x: 100, y: 50 },
        sections: [{ id: 's1', x: 0, y: 0, widthCm: 200, heightCm: 150 }]
      }]
    };
    const bounds = getFloorBounds(floor);
    expect(bounds.minX).toBe(100);
    expect(bounds.minY).toBe(50);
    expect(bounds.maxX).toBe(300);
    expect(bounds.maxY).toBe(200);
  });

  it('computes bounds for multiple rooms', () => {
    const floor = {
      rooms: [
        {
          id: 'r1',
          floorPosition: { x: 0, y: 0 },
          sections: [{ id: 's1', x: 0, y: 0, widthCm: 300, heightCm: 200 }]
        },
        {
          id: 'r2',
          floorPosition: { x: 350, y: 0 },
          sections: [{ id: 's2', x: 0, y: 0, widthCm: 250, heightCm: 300 }]
        }
      ]
    };
    const bounds = getFloorBounds(floor);
    expect(bounds.minX).toBe(0);
    expect(bounds.minY).toBe(0);
    expect(bounds.maxX).toBe(600); // 350 + 250
    expect(bounds.maxY).toBe(300);
    expect(bounds.width).toBe(600);
    expect(bounds.height).toBe(300);
  });

  it('handles rooms with missing floorPosition', () => {
    const floor = {
      rooms: [{
        id: 'r1',
        sections: [{ id: 's1', x: 0, y: 0, widthCm: 200, heightCm: 100 }]
      }]
    };
    const bounds = getFloorBounds(floor);
    expect(bounds.minX).toBe(0);
    expect(bounds.minY).toBe(0);
    expect(bounds.maxX).toBe(200);
    expect(bounds.maxY).toBe(100);
  });
});

describe('roomToFloor', () => {
  it('transforms point with zero offset', () => {
    const room = { floorPosition: { x: 0, y: 0 } };
    const result = roomToFloor({ x: 100, y: 50 }, room);
    expect(result).toEqual({ x: 100, y: 50 });
  });

  it('transforms point with positive offset', () => {
    const room = { floorPosition: { x: 200, y: 100 } };
    const result = roomToFloor({ x: 50, y: 30 }, room);
    expect(result).toEqual({ x: 250, y: 130 });
  });

  it('handles missing floorPosition', () => {
    const room = {};
    const result = roomToFloor({ x: 75, y: 25 }, room);
    expect(result).toEqual({ x: 75, y: 25 });
  });

  it('handles null room', () => {
    const result = roomToFloor({ x: 50, y: 50 }, null);
    expect(result).toEqual({ x: 50, y: 50 });
  });
});

describe('floorToRoom', () => {
  it('transforms point with zero offset', () => {
    const room = { floorPosition: { x: 0, y: 0 } };
    const result = floorToRoom({ x: 100, y: 50 }, room);
    expect(result).toEqual({ x: 100, y: 50 });
  });

  it('transforms point with positive offset', () => {
    const room = { floorPosition: { x: 200, y: 100 } };
    const result = floorToRoom({ x: 250, y: 130 }, room);
    expect(result).toEqual({ x: 50, y: 30 });
  });

  it('handles missing floorPosition', () => {
    const room = {};
    const result = floorToRoom({ x: 75, y: 25 }, room);
    expect(result).toEqual({ x: 75, y: 25 });
  });

  it('is inverse of roomToFloor', () => {
    const room = { floorPosition: { x: 150, y: 75 } };
    const original = { x: 30, y: 20 };
    const floor = roomToFloor(original, room);
    const back = floorToRoom(floor, room);
    expect(back).toEqual(original);
  });
});

describe('translateMultiPolygon', () => {
  it('translates simple rectangle', () => {
    const polygon = [[[
      [0, 0], [100, 0], [100, 50], [0, 50], [0, 0]
    ]]];
    const result = translateMultiPolygon(polygon, 10, 20);
    expect(result[0][0][0]).toEqual([10, 20]);
    expect(result[0][0][1]).toEqual([110, 20]);
    expect(result[0][0][2]).toEqual([110, 70]);
  });

  it('handles empty array', () => {
    const result = translateMultiPolygon([], 10, 20);
    expect(result).toEqual([]);
  });

  it('handles null input', () => {
    const result = translateMultiPolygon(null, 10, 20);
    expect(result).toEqual([]);
  });
});

describe('areRoomsAdjacent', () => {
  it('detects adjacent rooms sharing vertical edge', () => {
    const roomA = {
      floorPosition: { x: 0, y: 0 },
      sections: [{ x: 0, y: 0, widthCm: 200, heightCm: 150 }]
    };
    const roomB = {
      floorPosition: { x: 200, y: 0 },
      sections: [{ x: 0, y: 0, widthCm: 150, heightCm: 150 }]
    };
    expect(areRoomsAdjacent(roomA, roomB)).toBe(true);
  });

  it('detects adjacent rooms sharing horizontal edge', () => {
    const roomA = {
      floorPosition: { x: 0, y: 0 },
      sections: [{ x: 0, y: 0, widthCm: 200, heightCm: 100 }]
    };
    const roomB = {
      floorPosition: { x: 0, y: 100 },
      sections: [{ x: 0, y: 0, widthCm: 200, heightCm: 150 }]
    };
    expect(areRoomsAdjacent(roomA, roomB)).toBe(true);
  });

  it('detects rooms with small gap as adjacent with tolerance', () => {
    const roomA = {
      floorPosition: { x: 0, y: 0 },
      sections: [{ x: 0, y: 0, widthCm: 200, heightCm: 100 }]
    };
    const roomB = {
      floorPosition: { x: 200.5, y: 0 },
      sections: [{ x: 0, y: 0, widthCm: 150, heightCm: 100 }]
    };
    expect(areRoomsAdjacent(roomA, roomB, 1)).toBe(true);
  });

  it('detects non-adjacent rooms with large gap', () => {
    const roomA = {
      floorPosition: { x: 0, y: 0 },
      sections: [{ x: 0, y: 0, widthCm: 200, heightCm: 100 }]
    };
    const roomB = {
      floorPosition: { x: 250, y: 0 },
      sections: [{ x: 0, y: 0, widthCm: 150, heightCm: 100 }]
    };
    expect(areRoomsAdjacent(roomA, roomB)).toBe(false);
  });

  it('handles rooms with missing floorPosition', () => {
    const roomA = {
      sections: [{ x: 0, y: 0, widthCm: 100, heightCm: 100 }]
    };
    const roomB = {
      floorPosition: { x: 100, y: 0 },
      sections: [{ x: 0, y: 0, widthCm: 100, heightCm: 100 }]
    };
    expect(areRoomsAdjacent(roomA, roomB)).toBe(true);
  });
});

describe('findAdjacentRooms', () => {
  it('finds adjacent rooms', () => {
    const floor = {
      rooms: [
        {
          id: 'r1',
          floorPosition: { x: 0, y: 0 },
          sections: [{ x: 0, y: 0, widthCm: 200, heightCm: 150 }]
        },
        {
          id: 'r2',
          floorPosition: { x: 200, y: 0 },
          sections: [{ x: 0, y: 0, widthCm: 150, heightCm: 150 }]
        },
        {
          id: 'r3',
          floorPosition: { x: 500, y: 0 },
          sections: [{ x: 0, y: 0, widthCm: 100, heightCm: 100 }]
        }
      ]
    };
    const adjacent = findAdjacentRooms(floor, 'r1');
    expect(adjacent).toHaveLength(1);
    expect(adjacent[0].id).toBe('r2');
  });

  it('returns empty array for non-existent room', () => {
    const floor = {
      rooms: [{
        id: 'r1',
        floorPosition: { x: 0, y: 0 },
        sections: [{ x: 0, y: 0, widthCm: 100, heightCm: 100 }]
      }]
    };
    const adjacent = findAdjacentRooms(floor, 'nonexistent');
    expect(adjacent).toEqual([]);
  });

  it('returns empty array for floor with single room', () => {
    const floor = {
      rooms: [{
        id: 'r1',
        floorPosition: { x: 0, y: 0 },
        sections: [{ x: 0, y: 0, widthCm: 100, heightCm: 100 }]
      }]
    };
    const adjacent = findAdjacentRooms(floor, 'r1');
    expect(adjacent).toEqual([]);
  });
});

describe('getRoomAbsoluteBounds', () => {
  it('returns absolute bounds for room at origin', () => {
    const room = {
      floorPosition: { x: 0, y: 0 },
      sections: [{ x: 0, y: 0, widthCm: 200, heightCm: 150 }]
    };
    const bounds = getRoomAbsoluteBounds(room);
    expect(bounds.left).toBe(0);
    expect(bounds.right).toBe(200);
    expect(bounds.top).toBe(0);
    expect(bounds.bottom).toBe(150);
  });

  it('returns absolute bounds for room with offset', () => {
    const room = {
      floorPosition: { x: 100, y: 50 },
      sections: [{ x: 0, y: 0, widthCm: 200, heightCm: 150 }]
    };
    const bounds = getRoomAbsoluteBounds(room);
    expect(bounds.left).toBe(100);
    expect(bounds.right).toBe(300);
    expect(bounds.top).toBe(50);
    expect(bounds.bottom).toBe(200);
  });

  it('returns correct bounds for freeform room with polygonVertices', () => {
    const room = {
      floorPosition: { x: 600, y: 0 },
      polygonVertices: [
        { x: 0, y: 0 },
        { x: 361, y: 0 },
        { x: 361, y: 151 },
        { x: 0, y: 151 }
      ]
    };
    const bounds = getRoomAbsoluteBounds(room);
    expect(bounds.left).toBe(600);
    expect(bounds.right).toBe(961);
    expect(bounds.top).toBe(0);
    expect(bounds.bottom).toBe(151);
  });

  it('returns correct bounds for freeform room with negative Y floorPosition', () => {
    // This simulates a freeform room drawn at negative Y coordinates
    const room = {
      floorPosition: { x: 600, y: -48 },
      polygonVertices: [
        { x: 0, y: 0 },
        { x: 361, y: 0 },
        { x: 361, y: 151 },
        { x: 0, y: 151 }
      ]
    };
    const bounds = getRoomAbsoluteBounds(room);
    expect(bounds.left).toBe(600);
    expect(bounds.right).toBe(961);
    expect(bounds.top).toBe(-48);  // Should be floorPosition.y + minY = -48 + 0 = -48
    expect(bounds.bottom).toBe(103);  // Should be -48 + 151 = 103
    expect(bounds.width).toBe(361);
    expect(bounds.height).toBe(151);
  });
});

describe('doRoomsOverlap', () => {
  it('detects overlapping rooms', () => {
    const roomA = {
      floorPosition: { x: 0, y: 0 },
      sections: [{ x: 0, y: 0, widthCm: 200, heightCm: 150 }]
    };
    const roomB = {
      floorPosition: { x: 100, y: 50 },
      sections: [{ x: 0, y: 0, widthCm: 200, heightCm: 150 }]
    };
    expect(doRoomsOverlap(roomA, roomB)).toBe(true);
  });

  it('returns false for adjacent rooms (touching but not overlapping)', () => {
    const roomA = {
      floorPosition: { x: 0, y: 0 },
      sections: [{ x: 0, y: 0, widthCm: 200, heightCm: 150 }]
    };
    const roomB = {
      floorPosition: { x: 200, y: 0 },
      sections: [{ x: 0, y: 0, widthCm: 200, heightCm: 150 }]
    };
    expect(doRoomsOverlap(roomA, roomB)).toBe(false);
  });

  it('returns false for separated rooms', () => {
    const roomA = {
      floorPosition: { x: 0, y: 0 },
      sections: [{ x: 0, y: 0, widthCm: 100, heightCm: 100 }]
    };
    const roomB = {
      floorPosition: { x: 300, y: 300 },
      sections: [{ x: 0, y: 0, widthCm: 100, heightCm: 100 }]
    };
    expect(doRoomsOverlap(roomA, roomB)).toBe(false);
  });
});

describe('wouldRoomOverlap', () => {
  it('detects overlap at proposed position', () => {
    const room = {
      floorPosition: { x: 0, y: 0 },
      sections: [{ x: 0, y: 0, widthCm: 100, heightCm: 100 }]
    };
    const otherRooms = [{
      floorPosition: { x: 150, y: 0 },
      sections: [{ x: 0, y: 0, widthCm: 100, heightCm: 100 }]
    }];
    // Moving room to x=100 would overlap with other room at x=150
    expect(wouldRoomOverlap(room, otherRooms, 100, 0)).toBe(true);
  });

  it('returns false when no overlap at proposed position', () => {
    const room = {
      floorPosition: { x: 0, y: 0 },
      sections: [{ x: 0, y: 0, widthCm: 100, heightCm: 100 }]
    };
    const otherRooms = [{
      floorPosition: { x: 200, y: 0 },
      sections: [{ x: 0, y: 0, widthCm: 100, heightCm: 100 }]
    }];
    expect(wouldRoomOverlap(room, otherRooms, 50, 0)).toBe(false);
  });
});

describe('findRoomSnapPositions', () => {
  it('generates snap positions at edges of other rooms', () => {
    const room = {
      sections: [{ x: 0, y: 0, widthCm: 100, heightCm: 100 }]
    };
    const otherRooms = [{
      floorPosition: { x: 200, y: 0 },
      sections: [{ x: 0, y: 0, widthCm: 150, heightCm: 150 }]
    }];
    const positions = findRoomSnapPositions(room, otherRooms);
    // Should have positions for all 4 edges × 2 alignment options = 8 positions
    expect(positions.length).toBe(8);
    // Check that snap to left edge of other room exists (room's right touches other's left)
    const leftSnap = positions.find(p => p.x === 100); // 200 - 100 (room width)
    expect(leftSnap).toBeDefined();
  });
});

describe('findNearestNonOverlappingPosition', () => {
  it('returns desired position when no overlap', () => {
    const room = {
      floorPosition: { x: 0, y: 0 },
      sections: [{ x: 0, y: 0, widthCm: 100, heightCm: 100 }]
    };
    const otherRooms = [{
      floorPosition: { x: 300, y: 0 },
      sections: [{ x: 0, y: 0, widthCm: 100, heightCm: 100 }]
    }];
    const result = findNearestNonOverlappingPosition(room, otherRooms, 50, 50);
    expect(result).toEqual({ x: 50, y: 50 });
  });

  it('snaps to adjacent position when overlap detected', () => {
    const room = {
      floorPosition: { x: 0, y: 0 },
      sections: [{ x: 0, y: 0, widthCm: 100, heightCm: 100 }]
    };
    const otherRooms = [{
      floorPosition: { x: 150, y: 0 },
      sections: [{ x: 0, y: 0, widthCm: 100, heightCm: 100 }]
    }];
    // Trying to move to x=100 would overlap - should snap to x=50 (adjacent left) or x=150 (adjacent right)
    const result = findNearestNonOverlappingPosition(room, otherRooms, 100, 0);
    // Should not overlap at the resulting position
    expect(wouldRoomOverlap(room, otherRooms, result.x, result.y)).toBe(false);
  });

  it('pushes room out of overlap when no snap within threshold', () => {
    const room = {
      floorPosition: { x: 0, y: 0 },
      sections: [{ x: 0, y: 0, widthCm: 100, heightCm: 100 }]
    };
    const otherRooms = [{
      floorPosition: { x: 50, y: 50 },
      sections: [{ x: 0, y: 0, widthCm: 100, heightCm: 100 }]
    }];
    // Trying to move to exact same position as other room
    const result = findNearestNonOverlappingPosition(room, otherRooms, 50, 50, 10);
    // Should not overlap at the resulting position
    expect(wouldRoomOverlap(room, otherRooms, result.x, result.y)).toBe(false);
  });
});

describe('isRoomConnected', () => {
  it('returns true for single room (no other rooms)', () => {
    const room = {
      floorPosition: { x: 0, y: 0 },
      sections: [{ x: 0, y: 0, widthCm: 100, heightCm: 100 }]
    };
    expect(isRoomConnected(room, [], 0, 0)).toBe(true);
  });

  it('returns true when room is adjacent to another room', () => {
    const room = {
      floorPosition: { x: 0, y: 0 },
      sections: [{ x: 0, y: 0, widthCm: 100, heightCm: 100 }]
    };
    const otherRooms = [{
      floorPosition: { x: 100, y: 0 },
      sections: [{ x: 0, y: 0, widthCm: 100, heightCm: 100 }]
    }];
    // Room at x=0 is adjacent to room at x=100 (they share an edge at x=100)
    expect(isRoomConnected(room, otherRooms, 0, 0)).toBe(true);
  });

  it('returns false when room is not adjacent to any other room', () => {
    const room = {
      floorPosition: { x: 0, y: 0 },
      sections: [{ x: 0, y: 0, widthCm: 100, heightCm: 100 }]
    };
    const otherRooms = [{
      floorPosition: { x: 300, y: 0 },
      sections: [{ x: 0, y: 0, widthCm: 100, heightCm: 100 }]
    }];
    // Room at x=0 with width 100 ends at x=100, other room starts at x=300
    // They don't share an edge
    expect(isRoomConnected(room, otherRooms, 0, 0)).toBe(false);
  });

  it('detects connection when moving room to adjacent position', () => {
    const room = {
      floorPosition: { x: 0, y: 0 },
      sections: [{ x: 0, y: 0, widthCm: 100, heightCm: 100 }]
    };
    const otherRooms = [{
      floorPosition: { x: 200, y: 0 },
      sections: [{ x: 0, y: 0, widthCm: 100, heightCm: 100 }]
    }];
    // Room moved to x=100 would be adjacent to room at x=200
    expect(isRoomConnected(room, otherRooms, 100, 0)).toBe(true);
  });
});

describe('findNearestConnectedPosition', () => {
  it('returns desired position for single room', () => {
    const room = {
      floorPosition: { x: 0, y: 0 },
      sections: [{ x: 0, y: 0, widthCm: 100, heightCm: 100 }]
    };
    const result = findNearestConnectedPosition(room, [], 50, 50);
    expect(result).toEqual({ x: 50, y: 50 });
  });

  it('returns desired position when already connected and non-overlapping', () => {
    const room = {
      floorPosition: { x: 0, y: 0 },
      sections: [{ x: 0, y: 0, widthCm: 100, heightCm: 100 }]
    };
    const otherRooms = [{
      floorPosition: { x: 100, y: 0 },
      sections: [{ x: 0, y: 0, widthCm: 100, heightCm: 100 }]
    }];
    // Desired position x=0 is adjacent to other room at x=100
    const result = findNearestConnectedPosition(room, otherRooms, 0, 0);
    expect(result).toEqual({ x: 0, y: 0 });
  });

  it('snaps to connected position when desired position would be disconnected', () => {
    const room = {
      floorPosition: { x: 0, y: 0 },
      sections: [{ x: 0, y: 0, widthCm: 100, heightCm: 100 }]
    };
    const otherRooms = [{
      floorPosition: { x: 200, y: 0 },
      sections: [{ x: 0, y: 0, widthCm: 100, heightCm: 100 }]
    }];
    // Trying to move to x=-100 would disconnect from other room
    const result = findNearestConnectedPosition(room, otherRooms, -100, 0);
    // Result should be connected
    expect(isRoomConnected(room, otherRooms, result.x, result.y)).toBe(true);
    // And not overlapping
    expect(wouldRoomOverlap(room, otherRooms, result.x, result.y)).toBe(false);
  });

  it('prevents free-floating rooms', () => {
    const room = {
      floorPosition: { x: 0, y: 0 },
      sections: [{ x: 0, y: 0, widthCm: 100, heightCm: 100 }]
    };
    const otherRooms = [{
      floorPosition: { x: 100, y: 0 },
      sections: [{ x: 0, y: 0, widthCm: 100, heightCm: 100 }]
    }];
    // Trying to move far away (free-floating)
    const result = findNearestConnectedPosition(room, otherRooms, 500, 500);
    // Result must be connected
    expect(isRoomConnected(room, otherRooms, result.x, result.y)).toBe(true);
    // And not overlapping
    expect(wouldRoomOverlap(room, otherRooms, result.x, result.y)).toBe(false);
  });

  it('finds valid position along edges when direct snap not available', () => {
    const room = {
      floorPosition: { x: 0, y: 0 },
      sections: [{ x: 0, y: 0, widthCm: 100, heightCm: 50 }]
    };
    const otherRooms = [{
      floorPosition: { x: 0, y: 50 },
      sections: [{ x: 0, y: 0, widthCm: 200, heightCm: 200 }]
    }];
    // Room is currently connected (shares edge at y=50)
    // Trying to move to an invalid position
    const result = findNearestConnectedPosition(room, otherRooms, 300, 300);
    // Should find a valid connected position
    expect(isRoomConnected(room, otherRooms, result.x, result.y)).toBe(true);
    expect(wouldRoomOverlap(room, otherRooms, result.x, result.y)).toBe(false);
  });
});
