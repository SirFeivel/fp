// src/floor_geometry.js
// Floor-level geometry utilities for multi-room floor layouts

import { getRoomBounds, roomPolygon } from './geometry.js';
import { getRoomSections } from './composite.js';

/**
 * Compute floor bounds encompassing all rooms
 * @param {Object} floor - Floor object with rooms array
 * @returns {Object} { minX, minY, maxX, maxY, width, height }
 */
export function getFloorBounds(floor) {
  if (!floor?.rooms?.length) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const room of floor.rooms) {
    const pos = room.floorPosition || { x: 0, y: 0 };
    const roomBounds = getRoomBounds(room);

    minX = Math.min(minX, pos.x + roomBounds.minX);
    minY = Math.min(minY, pos.y + roomBounds.minY);
    maxX = Math.max(maxX, pos.x + roomBounds.maxX);
    maxY = Math.max(maxY, pos.y + roomBounds.maxY);
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY
  };
}

/**
 * Transform room-local point to floor coordinates
 * @param {Object} point - { x, y } in room-local coordinates
 * @param {Object} room - Room object with floorPosition
 * @returns {Object} { x, y } in floor coordinates
 */
export function roomToFloor(point, room) {
  const pos = room?.floorPosition || { x: 0, y: 0 };
  return {
    x: point.x + pos.x,
    y: point.y + pos.y
  };
}

/**
 * Transform floor point to room-local coordinates
 * @param {Object} point - { x, y } in floor coordinates
 * @param {Object} room - Room object with floorPosition
 * @returns {Object} { x, y } in room-local coordinates
 */
export function floorToRoom(point, room) {
  const pos = room?.floorPosition || { x: 0, y: 0 };
  return {
    x: point.x - pos.x,
    y: point.y - pos.y
  };
}

/**
 * Get room polygon in floor coordinate space
 * @param {Object} room - Room object
 * @returns {Array} MultiPolygon in floor coordinates
 */
export function getRoomPolygonOnFloor(room) {
  const localPolygon = roomPolygon(room);
  const pos = room?.floorPosition || { x: 0, y: 0 };

  // Transform all points in the multipolygon
  return translateMultiPolygon(localPolygon, pos.x, pos.y);
}

/**
 * Translate a multipolygon by (dx, dy)
 * @param {Array} multiPolygon - polygon-clipping format multipolygon
 * @param {number} dx - X offset
 * @param {number} dy - Y offset
 * @returns {Array} Translated multipolygon
 */
export function translateMultiPolygon(multiPolygon, dx, dy) {
  if (!multiPolygon || !Array.isArray(multiPolygon)) return [];

  return multiPolygon.map(polygon =>
    polygon.map(ring =>
      ring.map(point => [point[0] + dx, point[1] + dy])
    )
  );
}

/**
 * Check if two rooms are adjacent (share a wall segment)
 * This is a simplified check based on bounding box proximity
 * @param {Object} roomA - First room
 * @param {Object} roomB - Second room
 * @param {number} tolerance - Max gap to consider adjacent (cm), default 1
 * @returns {boolean}
 */
export function areRoomsAdjacent(roomA, roomB, tolerance = 1) {
  const posA = roomA?.floorPosition || { x: 0, y: 0 };
  const posB = roomB?.floorPosition || { x: 0, y: 0 };

  const boundsA = getRoomBounds(roomA);
  const boundsB = getRoomBounds(roomB);

  // Calculate absolute bounds on floor
  const aLeft = posA.x + boundsA.minX;
  const aRight = posA.x + boundsA.maxX;
  const aTop = posA.y + boundsA.minY;
  const aBottom = posA.y + boundsA.maxY;

  const bLeft = posB.x + boundsB.minX;
  const bRight = posB.x + boundsB.maxX;
  const bTop = posB.y + boundsB.minY;
  const bBottom = posB.y + boundsB.maxY;

  // Check if rooms overlap or are within tolerance
  const horizontalOverlap = aLeft < bRight + tolerance && aRight > bLeft - tolerance;
  const verticalOverlap = aTop < bBottom + tolerance && aBottom > bTop - tolerance;

  if (!horizontalOverlap || !verticalOverlap) {
    return false;
  }

  // Check if they share an edge (not overlapping interiors)
  const sharesVerticalEdge =
    (Math.abs(aRight - bLeft) <= tolerance || Math.abs(aLeft - bRight) <= tolerance);
  const sharesHorizontalEdge =
    (Math.abs(aBottom - bTop) <= tolerance || Math.abs(aTop - bBottom) <= tolerance);

  // Adjacent if they share an edge and have overlap on the other axis
  if (sharesVerticalEdge && verticalOverlap) return true;
  if (sharesHorizontalEdge && horizontalOverlap) return true;

  return false;
}

/**
 * Find all rooms adjacent to a given room
 * @param {Object} floor - Floor object with rooms array
 * @param {string} roomId - ID of the room to find neighbors for
 * @param {number} tolerance - Max gap to consider adjacent (cm)
 * @returns {Array} Array of adjacent room objects
 */
export function findAdjacentRooms(floor, roomId, tolerance = 1) {
  const targetRoom = floor?.rooms?.find(r => r.id === roomId);
  if (!targetRoom) return [];

  return floor.rooms.filter(room =>
    room.id !== roomId && areRoomsAdjacent(targetRoom, room, tolerance)
  );
}

/**
 * Get the combined polygon of all rooms on a floor
 * @param {Object} floor - Floor object with rooms array
 * @returns {Array} Combined multipolygon of all rooms
 */
export function getFloorPolygon(floor) {
  if (!floor?.rooms?.length) return [];

  // For now, just return array of room polygons
  // In the future, could use polygon union for overlapping detection
  return floor.rooms.map(room => getRoomPolygonOnFloor(room));
}
