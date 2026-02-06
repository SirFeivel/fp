// src/floor_geometry.js
// Floor-level geometry utilities for multi-room floor layouts

import polygonClipping from 'polygon-clipping';
import { getRoomBounds, roomPolygon } from './geometry.js';

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
 * Extract edges from a room polygon in floor coordinates
 * @param {Object} room - Room object
 * @returns {Array} Array of edges, each { p1: {x, y}, p2: {x, y} }
 */
export function getRoomEdgesOnFloor(room) {
  const mp = getRoomPolygonOnFloor(room);
  const edges = [];

  if (!mp || mp.length === 0) return edges;

  for (const polygon of mp) {
    for (const ring of polygon) {
      if (ring.length < 2) continue;
      for (let i = 0; i < ring.length - 1; i++) {
        edges.push({
          p1: { x: ring[i][0], y: ring[i][1] },
          p2: { x: ring[i + 1][0], y: ring[i + 1][1] }
        });
      }
    }
  }

  return edges;
}

/**
 * Calculate overlap length between two collinear edge segments
 * @param {Object} edge1 - { p1, p2 } first edge
 * @param {Object} edge2 - { p1, p2 } second edge
 * @param {number} tolerance - Max perpendicular distance to consider collinear
 * @returns {number} Length of overlap, 0 if not collinear or no overlap
 */
function getEdgeOverlapLength(edge1, edge2, tolerance = 1) {
  // Check if edges are roughly collinear (same line)
  // First, determine if edges are horizontal, vertical, or diagonal

  const dx1 = edge1.p2.x - edge1.p1.x;
  const dy1 = edge1.p2.y - edge1.p1.y;
  const dx2 = edge2.p2.x - edge2.p1.x;
  const dy2 = edge2.p2.y - edge2.p1.y;

  const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
  const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);

  if (len1 < 0.01 || len2 < 0.01) return 0;

  // Normalize direction vectors
  const nx1 = dx1 / len1, ny1 = dy1 / len1;
  const nx2 = dx2 / len2, ny2 = dy2 / len2;

  // Check if edges are parallel (dot product of perpendiculars ≈ 0 or directions aligned)
  // Two edges are parallel if their direction vectors are parallel (or anti-parallel)
  const cross = nx1 * ny2 - ny1 * nx2;
  if (Math.abs(cross) > 0.01) return 0; // Not parallel

  // Check if edges are collinear (on the same line)
  // Vector from edge1.p1 to edge2.p1
  const vx = edge2.p1.x - edge1.p1.x;
  const vy = edge2.p1.y - edge1.p1.y;

  // Perpendicular distance from edge2.p1 to the line of edge1
  const perpDist = Math.abs(vx * ny1 - vy * nx1);
  if (perpDist > tolerance) return 0; // Not collinear (edges are parallel but offset)

  // Project all 4 points onto the shared line direction
  // Use edge1.p1 as origin, project along (nx1, ny1)
  const proj1a = 0; // edge1.p1 projected
  const proj1b = len1; // edge1.p2 projected
  const proj2a = vx * nx1 + vy * ny1; // edge2.p1 projected
  const proj2b = proj2a + (dx2 * nx1 + dy2 * ny1); // edge2.p2 projected

  // Find overlap of intervals [min1, max1] and [min2, max2]
  const min1 = Math.min(proj1a, proj1b);
  const max1 = Math.max(proj1a, proj1b);
  const min2 = Math.min(proj2a, proj2b);
  const max2 = Math.max(proj2a, proj2b);

  const overlapStart = Math.max(min1, min2);
  const overlapEnd = Math.min(max1, max2);

  const overlap = overlapEnd - overlapStart;
  return overlap > 0 ? overlap : 0;
}

/**
 * Calculate total shared edge length between two rooms
 * @param {Object} roomA - First room
 * @param {Object} roomB - Second room
 * @param {number} tolerance - Max gap to consider touching
 * @returns {number} Total shared edge length in cm
 */
export function getSharedEdgeLength(roomA, roomB, tolerance = 1) {
  const edgesA = getRoomEdgesOnFloor(roomA);
  const edgesB = getRoomEdgesOnFloor(roomB);

  let totalShared = 0;

  for (const edgeA of edgesA) {
    for (const edgeB of edgesB) {
      const overlap = getEdgeOverlapLength(edgeA, edgeB, tolerance);
      if (overlap > 0) {
        totalShared += overlap;
      }
    }
  }

  return totalShared;
}

/**
 * Check if two rooms are adjacent (share a wall segment of minimum length)
 * @param {Object} roomA - First room
 * @param {Object} roomB - Second room
 * @param {number} tolerance - Max gap to consider adjacent (cm), default 1
 * @param {number} minSharedLength - Minimum shared edge length required (cm), default 10
 * @returns {boolean}
 */
export function areRoomsAdjacent(roomA, roomB, tolerance = 1, minSharedLength = 10) {
  // Skip if either room is a wall (walls don't participate in adjacency)
  if (roomA.sourceRoomId || roomB.sourceRoomId) return false;

  // Quick bounding box check first (optimization)
  const boundsA = getRoomAbsoluteBounds(roomA);
  const boundsB = getRoomAbsoluteBounds(roomB);

  // If bounding boxes don't touch (with tolerance), rooms can't be adjacent
  const horizontalGap = Math.max(boundsA.left - boundsB.right, boundsB.left - boundsA.right);
  const verticalGap = Math.max(boundsA.top - boundsB.bottom, boundsB.top - boundsA.bottom);

  if (horizontalGap > tolerance || verticalGap > tolerance) {
    return false;
  }

  // Check actual shared edge length
  const sharedLength = getSharedEdgeLength(roomA, roomB, tolerance);
  return sharedLength >= minSharedLength;
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
  if (!targetRoom || targetRoom.sourceRoomId) return []; // Walls have no adjacent rooms

  return floor.rooms.filter(room =>
    room.id !== roomId && !room.sourceRoomId && areRoomsAdjacent(targetRoom, room, tolerance)
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
  // Walls don't participate in overlap detection (they're vertical surfaces, not floor area)
  if (roomA.sourceRoomId || roomB.sourceRoomId) return false;

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
  // Walls don't participate in overlap detection
  if (room.sourceRoomId) return false;

  const testRoom = {
    ...room,
    floorPosition: { x: newX, y: newY }
  };
  // Filter out walls from collision check
  return otherRooms.filter(r => !r.sourceRoomId).some(other => doRoomsOverlap(testRoom, other));
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

/**
 * Calculate how much of an edge is "free" (not adjacent to other rooms)
 * @param {Object} edge - { p1: {x,y}, p2: {x,y} }
 * @param {Array} otherRooms - Other rooms to check against
 * @param {number} tolerance - Distance tolerance for considering edges as touching
 * @returns {Array} Array of free segments { p1, p2, length }
 */
function getEdgeFreeSegments(edge, otherRooms, tolerance = 1) {
  const dx = edge.p2.x - edge.p1.x;
  const dy = edge.p2.y - edge.p1.y;
  const edgeLen = Math.sqrt(dx * dx + dy * dy);

  if (edgeLen < 0.01) return [];

  // Normalize direction
  const nx = dx / edgeLen;
  const ny = dy / edgeLen;

  // Track which portions of the edge are occupied
  // Using parametric representation: point = p1 + t * (p2 - p1), t in [0, 1]
  const occupied = []; // Array of { start, end } in parametric form

  for (const other of otherRooms) {
    const otherEdges = getRoomEdgesOnFloor(other);

    for (const otherEdge of otherEdges) {
      // Check if edges are collinear and overlapping
      const odx = otherEdge.p2.x - otherEdge.p1.x;
      const ody = otherEdge.p2.y - otherEdge.p1.y;
      const otherLen = Math.sqrt(odx * odx + ody * ody);

      if (otherLen < 0.01) continue;

      const onx = odx / otherLen;
      const ony = ody / otherLen;

      // Check parallel
      const cross = nx * ony - ny * onx;
      if (Math.abs(cross) > 0.01) continue;

      // Check collinear - distance from otherEdge.p1 to the line of edge
      const vx = otherEdge.p1.x - edge.p1.x;
      const vy = otherEdge.p1.y - edge.p1.y;
      const perpDist = Math.abs(vx * ny - vy * nx);
      if (perpDist > tolerance) continue;

      // Project other edge endpoints onto our edge
      const t1 = (vx * nx + vy * ny) / edgeLen;
      const vx2 = otherEdge.p2.x - edge.p1.x;
      const vy2 = otherEdge.p2.y - edge.p1.y;
      const t2 = (vx2 * nx + vy2 * ny) / edgeLen;

      const tMin = Math.max(0, Math.min(t1, t2));
      const tMax = Math.min(1, Math.max(t1, t2));

      if (tMax > tMin) {
        occupied.push({ start: tMin, end: tMax });
      }
    }
  }

  // Merge overlapping occupied segments
  occupied.sort((a, b) => a.start - b.start);
  const merged = [];
  for (const seg of occupied) {
    if (merged.length === 0 || seg.start > merged[merged.length - 1].end) {
      merged.push({ ...seg });
    } else {
      merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, seg.end);
    }
  }

  // Find free segments (inverse of occupied)
  const free = [];
  let lastEnd = 0;

  for (const seg of merged) {
    if (seg.start > lastEnd) {
      const startPt = {
        x: edge.p1.x + lastEnd * dx,
        y: edge.p1.y + lastEnd * dy
      };
      const endPt = {
        x: edge.p1.x + seg.start * dx,
        y: edge.p1.y + seg.start * dy
      };
      const len = (seg.start - lastEnd) * edgeLen;
      if (len >= 1) { // At least 1cm free
        free.push({ p1: startPt, p2: endPt, length: len });
      }
    }
    lastEnd = seg.end;
  }

  // Final free segment after last occupied
  if (lastEnd < 1) {
    const startPt = {
      x: edge.p1.x + lastEnd * dx,
      y: edge.p1.y + lastEnd * dy
    };
    const len = (1 - lastEnd) * edgeLen;
    if (len >= 1) {
      free.push({ p1: startPt, p2: edge.p2, length: len });
    }
  }

  return free;
}

/**
 * Get all free edge segments for all rooms on a floor
 * @param {Array} rooms - Array of room objects
 * @param {number} minLength - Minimum free segment length to include
 * @returns {Array} Array of { roomId, edge: {p1, p2}, freeLength, direction }
 */
export function getAllFreeEdges(rooms, minLength = 10) {
  const freeEdges = [];

  for (let i = 0; i < rooms.length; i++) {
    const room = rooms[i];
    const otherRooms = rooms.filter((_, j) => j !== i);
    const edges = getRoomEdgesOnFloor(room);

    for (const edge of edges) {
      const freeSegments = getEdgeFreeSegments(edge, otherRooms);

      for (const seg of freeSegments) {
        if (seg.length >= minLength) {
          // Determine edge direction (which side is "outside")
          const dx = seg.p2.x - seg.p1.x;
          const dy = seg.p2.y - seg.p1.y;
          const len = Math.sqrt(dx * dx + dy * dy);

          // Normal pointing outward (perpendicular to edge)
          // For a CCW polygon, the outward normal is to the right of the edge direction
          const normalX = dy / len;
          const normalY = -dx / len;

          freeEdges.push({
            roomId: room.id,
            edge: { p1: seg.p1, p2: seg.p2 },
            freeLength: seg.length,
            normal: { x: normalX, y: normalY }
          });
        }
      }
    }
  }

  return freeEdges;
}

/**
 * Find the best position for a new room on a free edge
 * @param {Object} newRoom - Room to place (needs polygonVertices)
 * @param {Array} existingRooms - Existing rooms on the floor
 * @param {string} preference - Placement preference: 'right', 'bottom', 'left', 'top', or 'any'
 * @returns {Object|null} { x, y, edge } or null if no valid position
 */
export function findPositionOnFreeEdge(newRoom, existingRooms, preference = 'right') {
  if (!existingRooms || existingRooms.length === 0) {
    return { x: 0, y: 0, edge: null };
  }

  const newBounds = getRoomBounds(newRoom);
  const newWidth = newBounds.width;
  const newHeight = newBounds.height;

  const freeEdges = getAllFreeEdges(existingRooms, 10);

  if (freeEdges.length === 0) {
    return null;
  }

  // Score each free edge based on preference
  const scoredEdges = freeEdges.map(fe => {
    const midX = (fe.edge.p1.x + fe.edge.p2.x) / 2;
    const midY = (fe.edge.p1.y + fe.edge.p2.y) / 2;

    let score = fe.freeLength; // Base score is free length

    // Determine edge orientation
    const dx = fe.edge.p2.x - fe.edge.p1.x;
    const dy = fe.edge.p2.y - fe.edge.p1.y;
    const isVertical = Math.abs(dx) < Math.abs(dy);
    const isHorizontal = !isVertical;

    // Boost score based on preference
    if (preference === 'right' && isVertical && fe.normal.x > 0) {
      score += 10000 + midX; // Prefer rightmost
    } else if (preference === 'left' && isVertical && fe.normal.x < 0) {
      score += 10000 - midX;
    } else if (preference === 'bottom' && isHorizontal && fe.normal.y > 0) {
      score += 10000 + midY;
    } else if (preference === 'top' && isHorizontal && fe.normal.y < 0) {
      score += 10000 - midY;
    }

    return { ...fe, score, isVertical, midX, midY };
  });

  // Sort by score descending
  scoredEdges.sort((a, b) => b.score - a.score);

  // Try each edge to find a valid position
  for (const fe of scoredEdges) {
    // Calculate position to place new room adjacent to this edge
    let x, y;

    if (fe.isVertical) {
      // Vertical edge - place room to the side
      if (fe.normal.x > 0) {
        // Edge faces right - place room to the right
        x = Math.max(fe.edge.p1.x, fe.edge.p2.x);
      } else {
        // Edge faces left - place room to the left
        x = Math.min(fe.edge.p1.x, fe.edge.p2.x) - newWidth;
      }
      // Align top of new room with top of edge
      y = Math.min(fe.edge.p1.y, fe.edge.p2.y);
    } else {
      // Horizontal edge - place room above or below
      if (fe.normal.y > 0) {
        // Edge faces down - place room below
        y = Math.max(fe.edge.p1.y, fe.edge.p2.y);
      } else {
        // Edge faces up - place room above
        y = Math.min(fe.edge.p1.y, fe.edge.p2.y) - newHeight;
      }
      // Align left of new room with left of edge
      x = Math.min(fe.edge.p1.x, fe.edge.p2.x);
    }

    // Check if this position is valid (no overlap)
    if (!wouldRoomOverlap(newRoom, existingRooms, x, y)) {
      // Verify the room would actually be connected at this position
      const testRoom = { ...newRoom, floorPosition: { x, y } };
      if (existingRooms.some(other => areRoomsAdjacent(testRoom, other))) {
        return { x, y, edge: fe };
      }
    }

    // Try alternative alignment (center or end of edge)
    const edgeLen = fe.freeLength;
    const alignments = [0, 0.5, 1]; // Start, middle, end

    for (const align of alignments) {
      if (fe.isVertical) {
        const edgeTop = Math.min(fe.edge.p1.y, fe.edge.p2.y);
        const edgeHeight = Math.abs(fe.edge.p2.y - fe.edge.p1.y);
        y = edgeTop + align * Math.max(0, edgeHeight - newHeight);
      } else {
        const edgeLeft = Math.min(fe.edge.p1.x, fe.edge.p2.x);
        const edgeWidth = Math.abs(fe.edge.p2.x - fe.edge.p1.x);
        x = edgeLeft + align * Math.max(0, edgeWidth - newWidth);
      }

      if (!wouldRoomOverlap(newRoom, existingRooms, x, y)) {
        const testRoom = { ...newRoom, floorPosition: { x, y } };
        if (existingRooms.some(other => areRoomsAdjacent(testRoom, other))) {
          return { x, y, edge: fe };
        }
      }
    }
  }

  return null;
}

/**
 * Subtract a new room's area from overlapping existing rooms
 * When a new freeform room overlaps existing rooms, this removes the overlapping
 * portion from the existing rooms (like how exclusions work)
 * @param {Object} newRoom - The new room being added
 * @param {Array} existingRooms - Array of existing room objects (will be modified in place)
 * @returns {Object} { modifiedRoomIds: string[], errors: string[] }
 */
export function subtractOverlappingAreas(newRoom, existingRooms) {
  const modifiedRoomIds = [];
  const errors = [];

  if (!newRoom || !existingRooms || existingRooms.length === 0) {
    return { modifiedRoomIds, errors };
  }

  // Walls don't participate in area subtraction
  if (newRoom.sourceRoomId) {
    return { modifiedRoomIds, errors };
  }

  // Get the new room's polygon in floor coordinates
  const newRoomPolygon = getRoomPolygonOnFloor(newRoom);
  if (!newRoomPolygon || newRoomPolygon.length === 0) {
    return { modifiedRoomIds, errors };
  }

  for (const existingRoom of existingRooms) {
    // Skip walls - they don't occupy floor space
    if (existingRoom.sourceRoomId) continue;
    // Skip rooms that clearly don't overlap (bounding box check)
    const newBounds = getRoomAbsoluteBounds(newRoom);
    const existingBounds = getRoomAbsoluteBounds(existingRoom);

    const noOverlapX = newBounds.right <= existingBounds.left || newBounds.left >= existingBounds.right;
    const noOverlapY = newBounds.bottom <= existingBounds.top || newBounds.top >= existingBounds.bottom;

    if (noOverlapX || noOverlapY) {
      continue; // No overlap possible
    }

    // Get existing room polygon in floor coordinates
    const existingPolygon = getRoomPolygonOnFloor(existingRoom);
    if (!existingPolygon || existingPolygon.length === 0) {
      continue;
    }

    try {
      // Check if there's actual polygon overlap
      const intersection = polygonClipping.intersection(existingPolygon, newRoomPolygon);
      if (!intersection || intersection.length === 0) {
        continue; // No actual overlap
      }

      // Subtract the new room from the existing room
      const difference = polygonClipping.difference(existingPolygon, newRoomPolygon);

      if (!difference || difference.length === 0) {
        // The existing room is completely covered - this shouldn't happen in normal use
        errors.push(`Room "${existingRoom.name}" would be completely covered`);
        continue;
      }

      // Convert the result back to room-local coordinates and update the room
      const pos = existingRoom.floorPosition || { x: 0, y: 0 };

      // Take the first polygon from the multipolygon result
      // (in case of complex shapes, this simplifies to the main body)
      const resultRing = difference[0]?.[0];
      if (!resultRing || resultRing.length < 4) {
        errors.push(`Room "${existingRoom.name}" resulted in invalid geometry`);
        continue;
      }

      // Convert to local coordinates (relative to floorPosition)
      const newVertices = resultRing.slice(0, -1).map(point => ({
        x: Math.round(point[0] - pos.x),
        y: Math.round(point[1] - pos.y)
      }));

      // Recalculate bounds for the new shape
      let minX = Infinity, minY = Infinity;
      let maxX = -Infinity, maxY = -Infinity;
      for (const v of newVertices) {
        minX = Math.min(minX, v.x);
        minY = Math.min(minY, v.y);
        maxX = Math.max(maxX, v.x);
        maxY = Math.max(maxY, v.y);
      }

      // Normalize vertices to start at (0,0) and adjust floorPosition
      const normalizedVertices = newVertices.map(v => ({
        x: v.x - minX,
        y: v.y - minY
      }));

      // Update the existing room
      existingRoom.polygonVertices = normalizedVertices;
      existingRoom.floorPosition = {
        x: pos.x + minX,
        y: pos.y + minY
      };
      existingRoom.widthCm = maxX - minX;
      existingRoom.heightCm = maxY - minY;

      modifiedRoomIds.push(existingRoom.id);
    } catch (e) {
      errors.push(`Error processing room "${existingRoom.name}": ${e.message}`);
    }
  }

  return { modifiedRoomIds, errors };
}

/**
 * Find connected room groups using flood-fill algorithm
 * @param {Array} rooms - Array of room objects
 * @param {number} minSharedLength - Minimum shared edge length to consider connected
 * @returns {Array} Array of groups, each group is array of room IDs
 */
export function findConnectedRoomGroups(rooms, minSharedLength = 10) {
  if (!rooms || rooms.length === 0) return [];
  if (rooms.length === 1) return [[rooms[0].id]];

  const visited = new Set();
  const groups = [];

  // Build adjacency map
  const adjacencyMap = new Map();
  for (const room of rooms) {
    adjacencyMap.set(room.id, []);
  }

  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      if (areRoomsAdjacent(rooms[i], rooms[j], 1, minSharedLength)) {
        adjacencyMap.get(rooms[i].id).push(rooms[j].id);
        adjacencyMap.get(rooms[j].id).push(rooms[i].id);
      }
    }
  }

  // Flood-fill to find connected groups
  for (const room of rooms) {
    if (visited.has(room.id)) continue;

    const group = [];
    const queue = [room.id];

    while (queue.length > 0) {
      const currentId = queue.shift();
      if (visited.has(currentId)) continue;

      visited.add(currentId);
      group.push(currentId);

      const neighbors = adjacencyMap.get(currentId) || [];
      for (const neighborId of neighbors) {
        if (!visited.has(neighborId)) {
          queue.push(neighborId);
        }
      }
    }

    groups.push(group);
  }

  return groups;
}

/**
 * Find pattern-linked room groups.
 * Rooms are in the same linked group if:
 * 1. They are physically adjacent (share >= minSharedLength of wall)
 * 2. BOTH rooms have patternLinking.enabled !== false (defaults to true)
 *
 * This is used for continuous tile pattern across rooms.
 * If a room has linking disabled, it breaks the chain - rooms on either side
 * become separate groups even if they would otherwise be connected through it.
 *
 * @param {Array} rooms - Array of room objects
 * @param {number} minSharedLength - Minimum shared edge length to consider adjacent
 * @returns {Array} Array of groups, each group is array of room IDs
 */
export function findPatternLinkedGroups(rooms, minSharedLength = 10) {
  if (!rooms || rooms.length === 0) return [];

  // Filter to only rooms with linking enabled (defaults to true if not set)
  const linkableRooms = rooms.filter(r => r.patternLinking?.enabled !== false);

  if (linkableRooms.length === 0) {
    // All rooms have linking disabled - each is its own group
    return rooms.map(r => [r.id]);
  }

  if (linkableRooms.length === 1) {
    // Only one linkable room
    const groups = [[linkableRooms[0].id]];
    // Add non-linkable rooms as individual groups
    for (const room of rooms) {
      if (room.patternLinking?.enabled === false) {
        groups.push([room.id]);
      }
    }
    return groups;
  }

  const visited = new Set();
  const groups = [];

  // Build adjacency map only between linkable rooms
  const adjacencyMap = new Map();
  for (const room of linkableRooms) {
    adjacencyMap.set(room.id, []);
  }

  for (let i = 0; i < linkableRooms.length; i++) {
    for (let j = i + 1; j < linkableRooms.length; j++) {
      if (areRoomsAdjacent(linkableRooms[i], linkableRooms[j], 1, minSharedLength)) {
        adjacencyMap.get(linkableRooms[i].id).push(linkableRooms[j].id);
        adjacencyMap.get(linkableRooms[j].id).push(linkableRooms[i].id);
      }
    }
  }

  // Flood-fill to find connected groups among linkable rooms
  for (const room of linkableRooms) {
    if (visited.has(room.id)) continue;

    const group = [];
    const queue = [room.id];

    while (queue.length > 0) {
      const currentId = queue.shift();
      if (visited.has(currentId)) continue;

      visited.add(currentId);
      group.push(currentId);

      const neighbors = adjacencyMap.get(currentId) || [];
      for (const neighborId of neighbors) {
        if (!visited.has(neighborId)) {
          queue.push(neighborId);
        }
      }
    }

    groups.push(group);
  }

  // Add non-linkable rooms as individual groups
  for (const room of rooms) {
    if (room.patternLinking?.enabled === false) {
      groups.push([room.id]);
    }
  }

  return groups;
}

/**
 * Validate floor connectivity - all rooms should be in one connected group
 * @param {Object} floor - Floor object with rooms array
 * @param {number} minSharedLength - Minimum shared edge length
 * @returns {Object} { valid: boolean, groups: Array, message: string }
 */
export function validateFloorConnectivity(floor, minSharedLength = 10) {
  if (!floor?.rooms || floor.rooms.length === 0) {
    return { valid: true, groups: [], message: 'No rooms to validate' };
  }

  // Filter out wall surfaces (child objects) - only check connectivity for actual floor rooms
  const floorRooms = floor.rooms.filter(r => !r.sourceRoomId);

  if (floorRooms.length === 0) {
    return { valid: true, groups: [], message: 'No rooms to validate' };
  }

  if (floorRooms.length === 1) {
    return { valid: true, groups: [[floorRooms[0].id]], message: 'Single room is always valid' };
  }

  const groups = findConnectedRoomGroups(floorRooms, minSharedLength);

  if (groups.length === 1) {
    return {
      valid: true,
      groups,
      message: 'All rooms are connected'
    };
  }

  // Find room names for each group for better error message
  const roomMap = new Map(floorRooms.map(r => [r.id, r]));
  const groupDetails = groups.map(group => ({
    roomIds: group,
    roomNames: group.map(id => roomMap.get(id)?.name || 'Unknown')
  }));

  return {
    valid: false,
    groups,
    groupDetails,
    message: `Found ${groups.length} disconnected room groups. All rooms must be connected.`
  };
}
