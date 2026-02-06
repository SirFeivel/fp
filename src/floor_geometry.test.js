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
  findNearestConnectedPosition,
  getSharedEdgeLength,
  getRoomEdgesOnFloor,
  getAllFreeEdges,
  findPositionOnFreeEdge,
  subtractOverlappingAreas,
  findConnectedRoomGroups,
  findPatternLinkedGroups,
  validateFloorConnectivity
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
        polygonVertices: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }, { x: 0, y: 300 }]
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
        polygonVertices: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 150 }, { x: 0, y: 150 }]
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
          polygonVertices: [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 200 }, { x: 0, y: 200 }]
        },
        {
          id: 'r2',
          floorPosition: { x: 350, y: 0 },
          polygonVertices: [{ x: 0, y: 0 }, { x: 250, y: 0 }, { x: 250, y: 300 }, { x: 0, y: 300 }]
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
        polygonVertices: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 0, y: 100 }]
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
      polygonVertices: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 150 }, { x: 0, y: 150 }]
    };
    const roomB = {
      floorPosition: { x: 200, y: 0 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 150, y: 0 }, { x: 150, y: 150 }, { x: 0, y: 150 }]
    };
    expect(areRoomsAdjacent(roomA, roomB)).toBe(true);
  });

  it('detects adjacent rooms sharing horizontal edge', () => {
    const roomA = {
      floorPosition: { x: 0, y: 0 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 0, y: 100 }]
    };
    const roomB = {
      floorPosition: { x: 0, y: 100 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 150 }, { x: 0, y: 150 }]
    };
    expect(areRoomsAdjacent(roomA, roomB)).toBe(true);
  });

  it('detects rooms with small gap as adjacent with tolerance', () => {
    const roomA = {
      floorPosition: { x: 0, y: 0 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 0, y: 100 }]
    };
    const roomB = {
      floorPosition: { x: 200.5, y: 0 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 150, y: 0 }, { x: 150, y: 100 }, { x: 0, y: 100 }]
    };
    expect(areRoomsAdjacent(roomA, roomB, 1)).toBe(true);
  });

  it('detects non-adjacent rooms with large gap', () => {
    const roomA = {
      floorPosition: { x: 0, y: 0 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 0, y: 100 }]
    };
    const roomB = {
      floorPosition: { x: 250, y: 0 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 150, y: 0 }, { x: 150, y: 100 }, { x: 0, y: 100 }]
    };
    expect(areRoomsAdjacent(roomA, roomB)).toBe(false);
  });

  it('handles rooms with missing floorPosition', () => {
    const roomA = {
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
    };
    const roomB = {
      floorPosition: { x: 100, y: 0 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
    };
    expect(areRoomsAdjacent(roomA, roomB)).toBe(true);
  });

  it('rejects corner-only contact (single point touch)', () => {
    // Room A: 100x100 at origin
    // Room B: 100x100 at (100, 100) - only touches at corner (100, 100)
    const roomA = {
      floorPosition: { x: 0, y: 0 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
    };
    const roomB = {
      floorPosition: { x: 100, y: 100 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
    };
    // Should be false - only corner touch, no shared edge
    expect(areRoomsAdjacent(roomA, roomB)).toBe(false);
  });

  it('rejects rooms with shared edge less than minimum', () => {
    // Room A: 100x100 at origin
    // Room B: 100x100 at (100, 95) - shares only 5cm of edge
    const roomA = {
      floorPosition: { x: 0, y: 0 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
    };
    const roomB = {
      floorPosition: { x: 100, y: 95 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
    };
    // Default minimum is 10cm, they share only 5cm
    expect(areRoomsAdjacent(roomA, roomB)).toBe(false);
  });

  it('accepts rooms with shared edge at minimum length', () => {
    // Room A: 100x100 at origin
    // Room B: 100x100 at (100, 90) - shares exactly 10cm of edge
    const roomA = {
      floorPosition: { x: 0, y: 0 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
    };
    const roomB = {
      floorPosition: { x: 100, y: 90 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
    };
    // Should be true - shares exactly 10cm (from y=90 to y=100)
    expect(areRoomsAdjacent(roomA, roomB)).toBe(true);
  });

  it('allows custom minimum shared length', () => {
    const roomA = {
      floorPosition: { x: 0, y: 0 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
    };
    const roomB = {
      floorPosition: { x: 100, y: 95 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
    };
    // With minSharedLength=5, should be adjacent (shares 5cm)
    expect(areRoomsAdjacent(roomA, roomB, 1, 5)).toBe(true);
    // With minSharedLength=6, should not be adjacent
    expect(areRoomsAdjacent(roomA, roomB, 1, 6)).toBe(false);
  });

  it('detects adjacency for freeform rooms', () => {
    const roomA = {
      floorPosition: { x: 0, y: 0 },
      polygonVertices: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 }
      ]
    };
    const roomB = {
      floorPosition: { x: 100, y: 0 },
      polygonVertices: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 }
      ]
    };
    expect(areRoomsAdjacent(roomA, roomB)).toBe(true);
  });

  it('rejects freeform rooms with corner-only contact', () => {
    const roomA = {
      floorPosition: { x: 0, y: 0 },
      polygonVertices: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 }
      ]
    };
    const roomB = {
      floorPosition: { x: 100, y: 100 },
      polygonVertices: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 }
      ]
    };
    // Only touch at corner (100, 100)
    expect(areRoomsAdjacent(roomA, roomB)).toBe(false);
  });
});

describe('getSharedEdgeLength', () => {
  it('returns correct shared length for fully aligned edges', () => {
    const roomA = {
      floorPosition: { x: 0, y: 0 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
    };
    const roomB = {
      floorPosition: { x: 100, y: 0 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
    };
    const sharedLength = getSharedEdgeLength(roomA, roomB);
    expect(sharedLength).toBe(100);
  });

  it('returns correct shared length for partially aligned edges', () => {
    const roomA = {
      floorPosition: { x: 0, y: 0 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
    };
    const roomB = {
      floorPosition: { x: 100, y: 50 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
    };
    const sharedLength = getSharedEdgeLength(roomA, roomB);
    expect(sharedLength).toBe(50); // Overlap from y=50 to y=100
  });

  it('returns zero for non-touching rooms', () => {
    const roomA = {
      floorPosition: { x: 0, y: 0 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
    };
    const roomB = {
      floorPosition: { x: 200, y: 0 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
    };
    const sharedLength = getSharedEdgeLength(roomA, roomB);
    expect(sharedLength).toBe(0);
  });
});

describe('findAdjacentRooms', () => {
  it('finds adjacent rooms', () => {
    const floor = {
      rooms: [
        {
          id: 'r1',
          floorPosition: { x: 0, y: 0 },
          polygonVertices: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 150 }, { x: 0, y: 150 }]
        },
        {
          id: 'r2',
          floorPosition: { x: 200, y: 0 },
          polygonVertices: [{ x: 0, y: 0 }, { x: 150, y: 0 }, { x: 150, y: 150 }, { x: 0, y: 150 }]
        },
        {
          id: 'r3',
          floorPosition: { x: 500, y: 0 },
          polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
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
        polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
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
        polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
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
      polygonVertices: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 150 }, { x: 0, y: 150 }]
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
      polygonVertices: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 150 }, { x: 0, y: 150 }]
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
      polygonVertices: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 150 }, { x: 0, y: 150 }]
    };
    const roomB = {
      floorPosition: { x: 100, y: 50 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 150 }, { x: 0, y: 150 }]
    };
    expect(doRoomsOverlap(roomA, roomB)).toBe(true);
  });

  it('returns false for adjacent rooms (touching but not overlapping)', () => {
    const roomA = {
      floorPosition: { x: 0, y: 0 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 150 }, { x: 0, y: 150 }]
    };
    const roomB = {
      floorPosition: { x: 200, y: 0 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 150 }, { x: 0, y: 150 }]
    };
    expect(doRoomsOverlap(roomA, roomB)).toBe(false);
  });

  it('returns false for separated rooms', () => {
    const roomA = {
      floorPosition: { x: 0, y: 0 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
    };
    const roomB = {
      floorPosition: { x: 300, y: 300 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
    };
    expect(doRoomsOverlap(roomA, roomB)).toBe(false);
  });
});

describe('wouldRoomOverlap', () => {
  it('detects overlap at proposed position', () => {
    const room = {
      floorPosition: { x: 0, y: 0 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
    };
    const otherRooms = [{
      floorPosition: { x: 150, y: 0 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
    }];
    // Moving room to x=100 would overlap with other room at x=150
    expect(wouldRoomOverlap(room, otherRooms, 100, 0)).toBe(true);
  });

  it('returns false when no overlap at proposed position', () => {
    const room = {
      floorPosition: { x: 0, y: 0 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
    };
    const otherRooms = [{
      floorPosition: { x: 200, y: 0 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
    }];
    expect(wouldRoomOverlap(room, otherRooms, 50, 0)).toBe(false);
  });
});

describe('findRoomSnapPositions', () => {
  it('generates snap positions at edges of other rooms', () => {
    const room = {
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
    };
    const otherRooms = [{
      floorPosition: { x: 200, y: 0 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 150, y: 0 }, { x: 150, y: 150 }, { x: 0, y: 150 }]
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
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
    };
    const otherRooms = [{
      floorPosition: { x: 300, y: 0 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
    }];
    const result = findNearestNonOverlappingPosition(room, otherRooms, 50, 50);
    expect(result).toEqual({ x: 50, y: 50 });
  });

  it('snaps to adjacent position when overlap detected', () => {
    const room = {
      floorPosition: { x: 0, y: 0 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
    };
    const otherRooms = [{
      floorPosition: { x: 150, y: 0 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
    }];
    // Trying to move to x=100 would overlap - should snap to x=50 (adjacent left) or x=150 (adjacent right)
    const result = findNearestNonOverlappingPosition(room, otherRooms, 100, 0);
    // Should not overlap at the resulting position
    expect(wouldRoomOverlap(room, otherRooms, result.x, result.y)).toBe(false);
  });

  it('pushes room out of overlap when no snap within threshold', () => {
    const room = {
      floorPosition: { x: 0, y: 0 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
    };
    const otherRooms = [{
      floorPosition: { x: 50, y: 50 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
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
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
    };
    expect(isRoomConnected(room, [], 0, 0)).toBe(true);
  });

  it('returns true when room is adjacent to another room', () => {
    const room = {
      floorPosition: { x: 0, y: 0 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
    };
    const otherRooms = [{
      floorPosition: { x: 100, y: 0 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
    }];
    // Room at x=0 is adjacent to room at x=100 (they share an edge at x=100)
    expect(isRoomConnected(room, otherRooms, 0, 0)).toBe(true);
  });

  it('returns false when room is not adjacent to any other room', () => {
    const room = {
      floorPosition: { x: 0, y: 0 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
    };
    const otherRooms = [{
      floorPosition: { x: 300, y: 0 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
    }];
    // Room at x=0 with width 100 ends at x=100, other room starts at x=300
    // They don't share an edge
    expect(isRoomConnected(room, otherRooms, 0, 0)).toBe(false);
  });

  it('detects connection when moving room to adjacent position', () => {
    const room = {
      floorPosition: { x: 0, y: 0 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
    };
    const otherRooms = [{
      floorPosition: { x: 200, y: 0 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
    }];
    // Room moved to x=100 would be adjacent to room at x=200
    expect(isRoomConnected(room, otherRooms, 100, 0)).toBe(true);
  });
});

describe('findNearestConnectedPosition', () => {
  it('returns desired position for single room', () => {
    const room = {
      floorPosition: { x: 0, y: 0 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
    };
    const result = findNearestConnectedPosition(room, [], 50, 50);
    expect(result).toEqual({ x: 50, y: 50 });
  });

  it('returns desired position when already connected and non-overlapping', () => {
    const room = {
      floorPosition: { x: 0, y: 0 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
    };
    const otherRooms = [{
      floorPosition: { x: 100, y: 0 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
    }];
    // Desired position x=0 is adjacent to other room at x=100
    const result = findNearestConnectedPosition(room, otherRooms, 0, 0);
    expect(result).toEqual({ x: 0, y: 0 });
  });

  it('snaps to connected position when desired position would be disconnected', () => {
    const room = {
      floorPosition: { x: 0, y: 0 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
    };
    const otherRooms = [{
      floorPosition: { x: 200, y: 0 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
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
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
    };
    const otherRooms = [{
      floorPosition: { x: 100, y: 0 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
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
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }]
    };
    const otherRooms = [{
      floorPosition: { x: 0, y: 50 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 }]
    }];
    // Room is currently connected (shares edge at y=50)
    // Trying to move to an invalid position
    const result = findNearestConnectedPosition(room, otherRooms, 300, 300);
    // Should find a valid connected position
    expect(isRoomConnected(room, otherRooms, result.x, result.y)).toBe(true);
    expect(wouldRoomOverlap(room, otherRooms, result.x, result.y)).toBe(false);
  });
});

describe('getAllFreeEdges', () => {
  it('returns all edges for single room', () => {
    const rooms = [{
      id: 'r1',
      floorPosition: { x: 0, y: 0 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
    }];
    const freeEdges = getAllFreeEdges(rooms, 10);
    // Single room has 4 free edges (all sides)
    expect(freeEdges.length).toBe(4);
    // Total free length should be perimeter (400cm)
    const totalFree = freeEdges.reduce((sum, e) => sum + e.freeLength, 0);
    expect(totalFree).toBe(400);
  });

  it('excludes shared edges between adjacent rooms', () => {
    const rooms = [
      {
        id: 'r1',
        floorPosition: { x: 0, y: 0 },
        polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
      },
      {
        id: 'r2',
        floorPosition: { x: 100, y: 0 },
        polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
      }
    ];
    const freeEdges = getAllFreeEdges(rooms, 10);
    // Should have 6 free edges (not the shared edge between r1 and r2)
    // r1: left (100), top (100), bottom (100) = 3 edges
    // r2: right (100), top (100), bottom (100) = 3 edges
    expect(freeEdges.length).toBe(6);
  });

  it('respects minimum length filter', () => {
    const rooms = [{
      id: 'r1',
      floorPosition: { x: 0, y: 0 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 5 }, { x: 0, y: 5 }]
    }];
    // With minLength=10, the 5cm edges should be excluded
    const freeEdges = getAllFreeEdges(rooms, 10);
    expect(freeEdges.length).toBe(2); // Only the 100cm edges
  });
});

describe('findPositionOnFreeEdge', () => {
  it('returns origin for empty floor', () => {
    const newRoom = {
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
    };
    const result = findPositionOnFreeEdge(newRoom, []);
    expect(result).toEqual({ x: 0, y: 0, edge: null });
  });

  it('places new room to the right of single room', () => {
    const newRoom = {
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
    };
    const existingRooms = [{
      id: 'r1',
      floorPosition: { x: 0, y: 0 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 150 }, { x: 0, y: 150 }]
    }];
    const result = findPositionOnFreeEdge(newRoom, existingRooms, 'right');
    expect(result).not.toBeNull();
    expect(result.x).toBe(200); // Right edge of existing room
    expect(result.y).toBe(0); // Aligned to top
  });

  it('places new room below existing room when preferred', () => {
    const newRoom = {
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
    };
    const existingRooms = [{
      id: 'r1',
      floorPosition: { x: 0, y: 0 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 150 }, { x: 0, y: 150 }]
    }];
    const result = findPositionOnFreeEdge(newRoom, existingRooms, 'bottom');
    expect(result).not.toBeNull();
    expect(result.y).toBe(150); // Bottom edge of existing room
  });

  it('finds free edge when some edges are occupied', () => {
    const newRoom = {
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
    };
    // Two rooms side by side - the right edge of r1 is occupied by r2
    const existingRooms = [
      {
        id: 'r1',
        floorPosition: { x: 0, y: 0 },
        polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
      },
      {
        id: 'r2',
        floorPosition: { x: 100, y: 0 },
        polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
      }
    ];
    const result = findPositionOnFreeEdge(newRoom, existingRooms, 'right');
    expect(result).not.toBeNull();
    // Should place to the right of r2 (the rightmost room)
    expect(result.x).toBe(200);
  });

  it('returns connected and non-overlapping position', () => {
    const newRoom = {
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
    };
    const existingRooms = [{
      id: 'r1',
      floorPosition: { x: 0, y: 0 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 150 }, { x: 0, y: 150 }]
    }];
    const result = findPositionOnFreeEdge(newRoom, existingRooms);
    expect(result).not.toBeNull();

    // Verify the position is valid
    const testRoom = { ...newRoom, floorPosition: { x: result.x, y: result.y } };
    expect(wouldRoomOverlap(testRoom, existingRooms, result.x, result.y)).toBe(false);
    expect(existingRooms.some(other => areRoomsAdjacent(testRoom, other))).toBe(true);
  });
});

describe('findConnectedRoomGroups', () => {
  it('returns empty array for no rooms', () => {
    const groups = findConnectedRoomGroups([]);
    expect(groups).toEqual([]);
  });

  it('returns single group for one room', () => {
    const rooms = [{
      id: 'r1',
      floorPosition: { x: 0, y: 0 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
    }];
    const groups = findConnectedRoomGroups(rooms);
    expect(groups).toEqual([['r1']]);
  });

  it('groups connected rooms together', () => {
    const rooms = [
      {
        id: 'r1',
        floorPosition: { x: 0, y: 0 },
        polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
      },
      {
        id: 'r2',
        floorPosition: { x: 100, y: 0 },
        polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
      },
      {
        id: 'r3',
        floorPosition: { x: 200, y: 0 },
        polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
      }
    ];
    const groups = findConnectedRoomGroups(rooms);
    expect(groups.length).toBe(1);
    expect(groups[0].sort()).toEqual(['r1', 'r2', 'r3']);
  });

  it('separates disconnected rooms into different groups', () => {
    const rooms = [
      {
        id: 'r1',
        floorPosition: { x: 0, y: 0 },
        polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
      },
      {
        id: 'r2',
        floorPosition: { x: 100, y: 0 },
        polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
      },
      {
        id: 'r3',
        floorPosition: { x: 500, y: 0 }, // Disconnected - 300cm gap
        polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
      }
    ];
    const groups = findConnectedRoomGroups(rooms);
    expect(groups.length).toBe(2);
    // One group with r1 and r2, another with just r3
    const groupSizes = groups.map(g => g.length).sort();
    expect(groupSizes).toEqual([1, 2]);
  });

  it('detects corner-only contact as disconnected', () => {
    const rooms = [
      {
        id: 'r1',
        floorPosition: { x: 0, y: 0 },
        polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
      },
      {
        id: 'r2',
        floorPosition: { x: 100, y: 100 }, // Only touches at corner (100, 100)
        polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
      }
    ];
    const groups = findConnectedRoomGroups(rooms);
    expect(groups.length).toBe(2); // Not connected - corner only
  });
});

describe('validateFloorConnectivity', () => {
  it('returns valid for empty floor', () => {
    const result = validateFloorConnectivity({ rooms: [] });
    expect(result.valid).toBe(true);
  });

  it('returns valid for single room', () => {
    const floor = {
      rooms: [{
        id: 'r1',
        name: 'Room 1',
        floorPosition: { x: 0, y: 0 },
        polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
      }]
    };
    const result = validateFloorConnectivity(floor);
    expect(result.valid).toBe(true);
  });

  it('returns valid for all connected rooms', () => {
    const floor = {
      rooms: [
        {
          id: 'r1',
          name: 'Room 1',
          floorPosition: { x: 0, y: 0 },
          polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
        },
        {
          id: 'r2',
          name: 'Room 2',
          floorPosition: { x: 100, y: 0 },
          polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
        }
      ]
    };
    const result = validateFloorConnectivity(floor);
    expect(result.valid).toBe(true);
    expect(result.groups.length).toBe(1);
  });

  it('returns invalid for disconnected rooms', () => {
    const floor = {
      rooms: [
        {
          id: 'r1',
          name: 'Room 1',
          floorPosition: { x: 0, y: 0 },
          polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
        },
        {
          id: 'r2',
          name: 'Room 2',
          floorPosition: { x: 500, y: 0 }, // Disconnected
          polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
        }
      ]
    };
    const result = validateFloorConnectivity(floor);
    expect(result.valid).toBe(false);
    expect(result.groups.length).toBe(2);
    expect(result.groupDetails).toBeDefined();
    expect(result.message).toContain('disconnected');
  });

  it('provides room names in group details', () => {
    const floor = {
      rooms: [
        {
          id: 'r1',
          name: 'Kitchen',
          floorPosition: { x: 0, y: 0 },
          polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
        },
        {
          id: 'r2',
          name: 'Bedroom',
          floorPosition: { x: 500, y: 0 },
          polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
        }
      ]
    };
    const result = validateFloorConnectivity(floor);
    expect(result.valid).toBe(false);
    const allNames = result.groupDetails.flatMap(g => g.roomNames);
    expect(allNames).toContain('Kitchen');
    expect(allNames).toContain('Bedroom');
  });
});

describe('subtractOverlappingAreas', () => {
  it('returns empty arrays for no overlap', () => {
    const newRoom = {
      id: 'new',
      floorPosition: { x: 200, y: 0 },
      polygonVertices: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 }
      ]
    };
    const existingRooms = [{
      id: 'r1',
      name: 'Room 1',
      floorPosition: { x: 0, y: 0 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
    }];

    const result = subtractOverlappingAreas(newRoom, existingRooms);
    expect(result.modifiedRoomIds).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('subtracts overlapping area from existing room', () => {
    // New room overlaps right half of existing room
    const newRoom = {
      id: 'new',
      floorPosition: { x: 50, y: 0 },
      polygonVertices: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 }
      ]
    };
    const existingRooms = [{
      id: 'r1',
      name: 'Room 1',
      floorPosition: { x: 0, y: 0 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
    }];

    const result = subtractOverlappingAreas(newRoom, existingRooms);
    expect(result.modifiedRoomIds).toContain('r1');
    expect(result.errors).toHaveLength(0);

    // The existing room should now have polygonVertices
    expect(existingRooms[0].polygonVertices).toBeDefined();
    // The room should be narrower (left half only)
    expect(existingRooms[0].widthCm).toBeLessThan(100);
  });

  it('handles empty existing rooms array', () => {
    const newRoom = {
      id: 'new',
      floorPosition: { x: 0, y: 0 },
      polygonVertices: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 }
      ]
    };

    const result = subtractOverlappingAreas(newRoom, []);
    expect(result.modifiedRoomIds).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('handles null inputs gracefully', () => {
    const result1 = subtractOverlappingAreas(null, []);
    expect(result1.modifiedRoomIds).toHaveLength(0);

    const result2 = subtractOverlappingAreas({}, null);
    expect(result2.modifiedRoomIds).toHaveLength(0);
  });
});

describe('findPatternLinkedGroups', () => {
  it('returns empty array for empty input', () => {
    expect(findPatternLinkedGroups([])).toEqual([]);
    expect(findPatternLinkedGroups(null)).toEqual([]);
  });

  it('links all rooms by default (patternLinking not set)', () => {
    const rooms = [
      {
        id: 'r1',
        floorPosition: { x: 0, y: 0 },
        polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
      },
      {
        id: 'r2',
        floorPosition: { x: 100, y: 0 },
        polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
      }
    ];

    const groups = findPatternLinkedGroups(rooms);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toContain('r1');
    expect(groups[0]).toContain('r2');
  });

  it('links rooms with patternLinking.enabled = true', () => {
    const rooms = [
      {
        id: 'r1',
        floorPosition: { x: 0, y: 0 },
        polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
        patternLinking: { enabled: true }
      },
      {
        id: 'r2',
        floorPosition: { x: 100, y: 0 },
        polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
        patternLinking: { enabled: true }
      }
    ];

    const groups = findPatternLinkedGroups(rooms);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(2);
  });

  it('breaks chain when room has patternLinking.enabled = false', () => {
    // Three rooms in a row: A - B - C
    // B has linking disabled, so A and C should be separate groups
    const rooms = [
      {
        id: 'A',
        floorPosition: { x: 0, y: 0 },
        polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
        patternLinking: { enabled: true }
      },
      {
        id: 'B',
        floorPosition: { x: 100, y: 0 },
        polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
        patternLinking: { enabled: false }
      },
      {
        id: 'C',
        floorPosition: { x: 200, y: 0 },
        polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
        patternLinking: { enabled: true }
      }
    ];

    const groups = findPatternLinkedGroups(rooms);
    // Should be 3 groups: A alone, B alone, C alone (since A and C aren't adjacent)
    expect(groups).toHaveLength(3);

    // Each room should be in its own group
    const groupIds = groups.map(g => g.sort().join(','));
    expect(groupIds).toContain('A');
    expect(groupIds).toContain('B');
    expect(groupIds).toContain('C');
  });

  it('keeps adjacent linked rooms together when middle room breaks chain', () => {
    // Four rooms: A - B - C - D
    // B has linking disabled
    // A is alone, B is alone, C-D should be linked (they are adjacent and both have linking enabled)
    const rooms = [
      {
        id: 'A',
        floorPosition: { x: 0, y: 0 },
        polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
      },
      {
        id: 'B',
        floorPosition: { x: 100, y: 0 },
        polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
        patternLinking: { enabled: false }
      },
      {
        id: 'C',
        floorPosition: { x: 200, y: 0 },
        polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
      },
      {
        id: 'D',
        floorPosition: { x: 300, y: 0 },
        polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
      }
    ];

    const groups = findPatternLinkedGroups(rooms);

    // Find each group
    const findGroupWith = (id) => groups.find(g => g.includes(id));

    // A should be alone (adjacent to B which is disabled)
    expect(findGroupWith('A')).toEqual(['A']);

    // B should be alone (disabled)
    expect(findGroupWith('B')).toEqual(['B']);

    // C and D should be together
    const cdGroup = findGroupWith('C');
    expect(cdGroup).toContain('C');
    expect(cdGroup).toContain('D');
    expect(cdGroup).toHaveLength(2);
  });

  it('handles all rooms with linking disabled', () => {
    const rooms = [
      {
        id: 'r1',
        floorPosition: { x: 0, y: 0 },
        polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
        patternLinking: { enabled: false }
      },
      {
        id: 'r2',
        floorPosition: { x: 100, y: 0 },
        polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
        patternLinking: { enabled: false }
      }
    ];

    const groups = findPatternLinkedGroups(rooms);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toHaveLength(1);
    expect(groups[1]).toHaveLength(1);
  });

  it('does not link non-adjacent rooms even with linking enabled', () => {
    const rooms = [
      {
        id: 'r1',
        floorPosition: { x: 0, y: 0 },
        polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
      },
      {
        id: 'r2',
        floorPosition: { x: 500, y: 500 }, // Far away, not adjacent
        polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
      }
    ];

    const groups = findPatternLinkedGroups(rooms);
    expect(groups).toHaveLength(2);
  });
});

describe('Wall rooms behavior', () => {
  it('walls are excluded from overlap detection', () => {
    const roomA = {
      id: 'room1',
      floorPosition: { x: 0, y: 0 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
    };

    const wall = {
      id: 'wall1',
      sourceRoomId: 'room1', // This marks it as a wall
      wallEdgeIndex: 0,
      floorPosition: { x: 50, y: 50 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }, { x: 0, y: 50 }]
    };

    // Wall should not be considered overlapping with room
    expect(doRoomsOverlap(roomA, wall)).toBe(false);
    expect(doRoomsOverlap(wall, roomA)).toBe(false);
  });

  it('walls are excluded from adjacency detection', () => {
    const roomA = {
      id: 'room1',
      floorPosition: { x: 0, y: 0 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
    };

    const wall = {
      id: 'wall1',
      sourceRoomId: 'room1',
      wallEdgeIndex: 0,
      floorPosition: { x: 100, y: 0 }, // Adjacent position
      polygonVertices: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 100 }, { x: 0, y: 100 }]
    };

    // Wall should not be considered adjacent
    expect(areRoomsAdjacent(roomA, wall)).toBe(false);
    expect(areRoomsAdjacent(wall, roomA)).toBe(false);
  });

  it('findAdjacentRooms filters out walls', () => {
    const floor = {
      id: 'f1',
      rooms: [
        {
          id: 'room1',
          floorPosition: { x: 0, y: 0 },
          polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
        },
        {
          id: 'room2',
          floorPosition: { x: 100, y: 0 },
          polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
        },
        {
          id: 'wall1',
          sourceRoomId: 'room1',
          wallEdgeIndex: 1,
          floorPosition: { x: 100, y: 0 },
          polygonVertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 100 }, { x: 0, y: 100 }]
        }
      ]
    };

    const adjacent = findAdjacentRooms(floor, 'room1');
    
    // Should find room2 but not wall1
    expect(adjacent).toHaveLength(1);
    expect(adjacent[0].id).toBe('room2');
  });

  it('wouldRoomOverlap ignores walls', () => {
    const room = {
      id: 'room1',
      floorPosition: { x: 0, y: 0 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
    };

    const wall = {
      id: 'wall1',
      sourceRoomId: 'room2',
      wallEdgeIndex: 0,
      floorPosition: { x: 50, y: 50 },
      polygonVertices: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }, { x: 0, y: 50 }]
    };

    // Room moving to overlap wall's position should not be blocked
    expect(wouldRoomOverlap(room, [wall], 50, 50)).toBe(false);
  });
});
