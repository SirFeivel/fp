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

/**
 * Get absolute bounds of a room on the floor
 * @param {Object} room - Room object
 * @returns {Object} { left, right, top, bottom, width, height }
 */
export function getRoomAbsoluteBounds(room) {
  const pos = room?.floorPosition || { x: 0, y: 0 };
  const bounds = getRoomBounds(room);
  return {
    left: pos.x + bounds.minX,
    right: pos.x + bounds.maxX,
    top: pos.y + bounds.minY,
    bottom: pos.y + bounds.maxY,
    width: bounds.width,
    height: bounds.height
  };
}

/**
 * Check if two rooms overlap (interiors intersect, not just touching)
 * @param {Object} roomA - First room
 * @param {Object} roomB - Second room
 * @param {number} tolerance - Small gap to allow (cm), default 0.1
 * @returns {boolean}
 */
export function doRoomsOverlap(roomA, roomB, tolerance = 0.1) {
  const a = getRoomAbsoluteBounds(roomA);
  const b = getRoomAbsoluteBounds(roomB);

  // Check if rectangles overlap (with tolerance to allow touching)
  const overlapX = a.left < b.right - tolerance && a.right > b.left + tolerance;
  const overlapY = a.top < b.bottom - tolerance && a.bottom > b.top + tolerance;

  return overlapX && overlapY;
}

/**
 * Check if a room at a given position would overlap with any other rooms
 * @param {Object} room - Room to check
 * @param {Array} otherRooms - Other rooms on the floor
 * @param {number} newX - Proposed X position
 * @param {number} newY - Proposed Y position
 * @returns {boolean}
 */
export function wouldRoomOverlap(room, otherRooms, newX, newY) {
  const testRoom = {
    ...room,
    floorPosition: { x: newX, y: newY }
  };
  return otherRooms.some(other => doRoomsOverlap(testRoom, other));
}

/**
 * Find snap positions where the room would be adjacent to other rooms
 * @param {Object} room - Room being moved
 * @param {Array} otherRooms - Other rooms on the floor
 * @returns {Array} Array of { x, y } snap positions
 */
export function findRoomSnapPositions(room, otherRooms) {
  const snapPositions = [];
  const roomBounds = getRoomBounds(room);
  const roomWidth = roomBounds.width;
  const roomHeight = roomBounds.height;

  for (const other of otherRooms) {
    const ob = getRoomAbsoluteBounds(other);

    // Snap to right edge of other (room's left touches other's right)
    snapPositions.push({ x: ob.right, y: ob.top });
    snapPositions.push({ x: ob.right, y: ob.bottom - roomHeight });

    // Snap to left edge of other (room's right touches other's left)
    snapPositions.push({ x: ob.left - roomWidth, y: ob.top });
    snapPositions.push({ x: ob.left - roomWidth, y: ob.bottom - roomHeight });

    // Snap to bottom edge of other (room's top touches other's bottom)
    snapPositions.push({ x: ob.left, y: ob.bottom });
    snapPositions.push({ x: ob.right - roomWidth, y: ob.bottom });

    // Snap to top edge of other (room's bottom touches other's top)
    snapPositions.push({ x: ob.left, y: ob.top - roomHeight });
    snapPositions.push({ x: ob.right - roomWidth, y: ob.top - roomHeight });
  }

  return snapPositions;
}

/**
 * Find the nearest non-overlapping position for a room
 * @param {Object} room - Room being moved
 * @param {Array} otherRooms - Other rooms on the floor
 * @param {number} desiredX - Desired X position
 * @param {number} desiredY - Desired Y position
 * @param {number} snapThreshold - Max distance to snap (cm), default 50
 * @returns {Object} { x, y } - Best position (may be desired if no overlap)
 */
export function findNearestNonOverlappingPosition(room, otherRooms, desiredX, desiredY, snapThreshold = 50) {
  // If no overlap at desired position, use it
  if (!wouldRoomOverlap(room, otherRooms, desiredX, desiredY)) {
    return { x: desiredX, y: desiredY };
  }

  // Find snap positions
  const snapPositions = findRoomSnapPositions(room, otherRooms);

  let bestPos = null;
  let bestDist = Infinity;

  for (const pos of snapPositions) {
    // Check this snap position doesn't cause overlap with any room
    if (!wouldRoomOverlap(room, otherRooms, pos.x, pos.y)) {
      const dist = Math.sqrt(Math.pow(pos.x - desiredX, 2) + Math.pow(pos.y - desiredY, 2));
      if (dist < bestDist && dist <= snapThreshold) {
        bestDist = dist;
        bestPos = pos;
      }
    }
  }

  // If found a valid snap position, use it
  if (bestPos) {
    return bestPos;
  }

  // No valid snap found within threshold - push room out of overlap
  // Find the minimum push direction
  const testRoom = { ...room, floorPosition: { x: desiredX, y: desiredY } };
  const roomBounds = getRoomAbsoluteBounds(testRoom);

  let minPush = Infinity;
  let pushResult = { x: desiredX, y: desiredY };

  for (const other of otherRooms) {
    const ob = getRoomAbsoluteBounds(other);

    // Calculate overlap amounts
    const overlapLeft = roomBounds.right - ob.left;
    const overlapRight = ob.right - roomBounds.left;
    const overlapTop = roomBounds.bottom - ob.top;
    const overlapBottom = ob.bottom - roomBounds.top;

    // Only consider if actually overlapping
    if (overlapLeft > 0 && overlapRight > 0 && overlapTop > 0 && overlapBottom > 0) {
      // Find minimum push to resolve this overlap
      const pushes = [
        { dx: -overlapLeft, dy: 0 },   // Push left
        { dx: overlapRight, dy: 0 },   // Push right
        { dx: 0, dy: -overlapTop },    // Push up
        { dx: 0, dy: overlapBottom }   // Push down
      ];

      for (const push of pushes) {
        const dist = Math.abs(push.dx) + Math.abs(push.dy);
        if (dist < minPush) {
          const newX = desiredX + push.dx;
          const newY = desiredY + push.dy;
          if (!wouldRoomOverlap(room, otherRooms, newX, newY)) {
            minPush = dist;
            pushResult = { x: newX, y: newY };
          }
        }
      }
    }
  }

  return pushResult;
}

/**
 * Check if a room at a given position would be connected to at least one other room
 * @param {Object} room - Room to check
 * @param {Array} otherRooms - Other rooms on the floor
 * @param {number} x - X position to check
 * @param {number} y - Y position to check
 * @returns {boolean}
 */
export function isRoomConnected(room, otherRooms, x, y) {
  // Single room is always valid (nothing to connect to)
  if (otherRooms.length === 0) return true;

  const testRoom = {
    ...room,
    floorPosition: { x, y }
  };

  // Check if adjacent to at least one other room
  return otherRooms.some(other => areRoomsAdjacent(testRoom, other));
}

/**
 * Find the nearest valid position for a room that is both non-overlapping AND connected
 * @param {Object} room - Room being moved
 * @param {Array} otherRooms - Other rooms on the floor
 * @param {number} desiredX - Desired X position
 * @param {number} desiredY - Desired Y position
 * @param {number} snapThreshold - Max distance to snap (cm), default 100
 * @returns {Object} { x, y } - Best valid position
 */
export function findNearestConnectedPosition(room, otherRooms, desiredX, desiredY, snapThreshold = 100) {
  // Single room can go anywhere (no connectivity requirement)
  if (otherRooms.length === 0) {
    return { x: desiredX, y: desiredY };
  }

  // Check if desired position is already valid (non-overlapping AND connected)
  if (!wouldRoomOverlap(room, otherRooms, desiredX, desiredY) &&
      isRoomConnected(room, otherRooms, desiredX, desiredY)) {
    return { x: desiredX, y: desiredY };
  }

  // Find snap positions (edges of other rooms)
  const snapPositions = findRoomSnapPositions(room, otherRooms);

  let bestPos = null;
  let bestDist = Infinity;

  for (const pos of snapPositions) {
    // Check this position is valid: no overlap AND connected
    if (!wouldRoomOverlap(room, otherRooms, pos.x, pos.y) &&
        isRoomConnected(room, otherRooms, pos.x, pos.y)) {
      const dist = Math.sqrt(Math.pow(pos.x - desiredX, 2) + Math.pow(pos.y - desiredY, 2));
      if (dist < bestDist && dist <= snapThreshold) {
        bestDist = dist;
        bestPos = pos;
      }
    }
  }

  // If found a valid snap position, use it
  if (bestPos) {
    return bestPos;
  }

  // No valid position found - try to find closest connected position
  // by iterating through edge-aligned positions more thoroughly
  const roomBounds = getRoomBounds(room);
  const roomWidth = roomBounds.width;
  const roomHeight = roomBounds.height;

  // Generate more snap candidates along each edge of each room
  for (const other of otherRooms) {
    const ob = getRoomAbsoluteBounds(other);

    // Positions along right edge of other room
    for (let y = ob.top - roomHeight + 1; y < ob.bottom; y += 10) {
      const pos = { x: ob.right, y };
      if (!wouldRoomOverlap(room, otherRooms, pos.x, pos.y) &&
          isRoomConnected(room, otherRooms, pos.x, pos.y)) {
        const dist = Math.sqrt(Math.pow(pos.x - desiredX, 2) + Math.pow(pos.y - desiredY, 2));
        if (dist < bestDist) {
          bestDist = dist;
          bestPos = pos;
        }
      }
    }

    // Positions along left edge of other room
    for (let y = ob.top - roomHeight + 1; y < ob.bottom; y += 10) {
      const pos = { x: ob.left - roomWidth, y };
      if (!wouldRoomOverlap(room, otherRooms, pos.x, pos.y) &&
          isRoomConnected(room, otherRooms, pos.x, pos.y)) {
        const dist = Math.sqrt(Math.pow(pos.x - desiredX, 2) + Math.pow(pos.y - desiredY, 2));
        if (dist < bestDist) {
          bestDist = dist;
          bestPos = pos;
        }
      }
    }

    // Positions along bottom edge of other room
    for (let x = ob.left - roomWidth + 1; x < ob.right; x += 10) {
      const pos = { x, y: ob.bottom };
      if (!wouldRoomOverlap(room, otherRooms, pos.x, pos.y) &&
          isRoomConnected(room, otherRooms, pos.x, pos.y)) {
        const dist = Math.sqrt(Math.pow(pos.x - desiredX, 2) + Math.pow(pos.y - desiredY, 2));
        if (dist < bestDist) {
          bestDist = dist;
          bestPos = pos;
        }
      }
    }

    // Positions along top edge of other room
    for (let x = ob.left - roomWidth + 1; x < ob.right; x += 10) {
      const pos = { x, y: ob.top - roomHeight };
      if (!wouldRoomOverlap(room, otherRooms, pos.x, pos.y) &&
          isRoomConnected(room, otherRooms, pos.x, pos.y)) {
        const dist = Math.sqrt(Math.pow(pos.x - desiredX, 2) + Math.pow(pos.y - desiredY, 2));
        if (dist < bestDist) {
          bestDist = dist;
          bestPos = pos;
        }
      }
    }
  }

  // Return best position found, or fall back to current position if nothing valid
  if (bestPos) {
    return bestPos;
  }

  // Last resort: return original position (room stays where it was)
  const originalPos = room.floorPosition || { x: 0, y: 0 };
  return { x: originalPos.x, y: originalPos.y };
}
