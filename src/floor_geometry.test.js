// src/floor_geometry.test.js
import { describe, it, expect } from 'vitest';
import {
  getFloorBounds,
  roomToFloor,
  floorToRoom,
  translateMultiPolygon,
  areRoomsAdjacent,
  findAdjacentRooms
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
