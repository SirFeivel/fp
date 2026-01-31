// src/pattern-groups.js
// Pattern Groups: Group rooms to share continuous tile patterns

import { uuid } from "./core.js";
import { getRoomBounds } from "./geometry.js";
import { areRoomsAdjacent } from "./floor_geometry.js";

/**
 * Get the pattern group a room belongs to
 * @param {Object} floor - Floor object with patternGroups and rooms
 * @param {string} roomId - Room ID to find
 * @returns {Object|null} The pattern group or null if room is independent
 */
export function getRoomPatternGroup(floor, roomId) {
  if (!floor?.patternGroups || !roomId) return null;
  return floor.patternGroups.find(g => g.memberRoomIds?.includes(roomId)) || null;
}

/**
 * Get the origin room for a given room
 * Returns the origin room if room is in a group, or the room itself if independent
 * @param {Object} floor - Floor object
 * @param {string} roomId - Room ID
 * @returns {Object|null} The origin room object or null
 */
export function getPatternOriginRoom(floor, roomId) {
  if (!floor?.rooms || !roomId) return null;

  const group = getRoomPatternGroup(floor, roomId);
  if (!group) {
    // Room is independent, return itself
    return floor.rooms.find(r => r.id === roomId) || null;
  }

  return floor.rooms.find(r => r.id === group.originRoomId) || null;
}

/**
 * Compute the origin point for a room based on its pattern settings
 * This mirrors the logic in geometry.js computeOriginPoint
 * @param {Object} room - The room
 * @returns {Object} Origin {x, y} in room-local coordinates
 */
function computeRoomLocalOrigin(room) {
  const bounds = getRoomBounds(room);
  const w = bounds.width;
  const h = bounds.height;
  const minX = bounds.minX;
  const minY = bounds.minY;

  const o = room.pattern?.origin || { preset: "tl", xCm: 0, yCm: 0 };
  const preset = o.preset || "tl";

  if (preset === "tl") return { x: minX, y: minY };
  if (preset === "tr") return { x: minX + w, y: minY };
  if (preset === "bl") return { x: minX, y: minY + h };
  if (preset === "br") return { x: minX + w, y: minY + h };
  if (preset === "center") return { x: minX + w / 2, y: minY + h / 2 };

  // "free"
  return { x: Number(o.xCm) || 0, y: Number(o.yCm) || 0 };
}

/**
 * Compute the shared origin point for a room based on its pattern group
 * Returns origin in room-local coordinates, or null if room is independent
 * @param {Object} room - The room to compute origin for
 * @param {Object} floor - Floor object with patternGroups
 * @returns {Object|null} Origin {x, y} in room-local coordinates, or null
 */
export function computePatternGroupOrigin(room, floor) {
  if (!room || !floor) return null;

  const group = getRoomPatternGroup(floor, room.id);
  if (!group || group.memberRoomIds.length < 2) return null;

  const originRoom = floor.rooms?.find(r => r.id === group.originRoomId);
  if (!originRoom) return null;

  // Compute the origin point in origin room's local coordinates (respecting preset)
  const originLocalPoint = computeRoomLocalOrigin(originRoom);

  // Convert to global floor coordinates
  const originPos = originRoom.floorPosition || { x: 0, y: 0 };
  const globalOrigin = {
    x: originPos.x + originLocalPoint.x,
    y: originPos.y + originLocalPoint.y
  };

  // Convert to this room's local coordinates
  const roomPos = room.floorPosition || { x: 0, y: 0 };
  return {
    x: globalOrigin.x - roomPos.x,
    y: globalOrigin.y - roomPos.y
  };
}

/**
 * Check if a room can be added to a pattern group
 * Room must be adjacent to at least one existing member
 * @param {Object} floor - Floor object
 * @param {string} groupId - Pattern group ID
 * @param {string} roomId - Room ID to check
 * @returns {boolean} True if room can join the group
 */
export function canJoinPatternGroup(floor, groupId, roomId) {
  if (!floor?.patternGroups || !floor?.rooms || !groupId || !roomId) return false;

  const group = floor.patternGroups.find(g => g.id === groupId);
  if (!group) return false;

  // Room already in group
  if (group.memberRoomIds.includes(roomId)) return false;

  // Room already in another group
  const existingGroup = getRoomPatternGroup(floor, roomId);
  if (existingGroup) return false;

  const room = floor.rooms.find(r => r.id === roomId);
  if (!room) return false;

  // Check adjacency to at least one group member
  for (const memberId of group.memberRoomIds) {
    const member = floor.rooms.find(r => r.id === memberId);
    if (member && areRoomsAdjacent(room, member)) {
      return true;
    }
  }

  return false;
}

/**
 * Create a new pattern group with one room as origin
 * @param {Object} floor - Floor object (will be mutated)
 * @param {string} originRoomId - Room ID to be the origin
 * @returns {Object|null} The created group or null if failed
 */
export function createPatternGroup(floor, originRoomId) {
  if (!floor || !originRoomId) return null;

  const room = floor.rooms?.find(r => r.id === originRoomId);
  if (!room) return null;

  // Check if room is already in a group
  const existingGroup = getRoomPatternGroup(floor, originRoomId);
  if (existingGroup) return null;

  // Initialize patternGroups array if needed
  if (!floor.patternGroups) {
    floor.patternGroups = [];
  }

  const group = {
    id: uuid(),
    originRoomId: originRoomId,
    memberRoomIds: [originRoomId]
  };

  floor.patternGroups.push(group);
  return group;
}

/**
 * Add a room to an existing pattern group
 * @param {Object} floor - Floor object (will be mutated)
 * @param {string} groupId - Pattern group ID
 * @param {string} roomId - Room ID to add
 * @returns {boolean} True if successful
 */
export function addRoomToPatternGroup(floor, groupId, roomId) {
  if (!canJoinPatternGroup(floor, groupId, roomId)) return false;

  const group = floor.patternGroups.find(g => g.id === groupId);
  group.memberRoomIds.push(roomId);
  return true;
}

/**
 * Remove a room from a pattern group
 * If origin room is removed, the group is dissolved
 * @param {Object} floor - Floor object (will be mutated)
 * @param {string} groupId - Pattern group ID
 * @param {string} roomId - Room ID to remove
 * @returns {Object} { success: boolean, dissolved: boolean }
 */
export function removeRoomFromPatternGroup(floor, groupId, roomId) {
  if (!floor?.patternGroups || !groupId || !roomId) {
    return { success: false, dissolved: false };
  }

  const groupIndex = floor.patternGroups.findIndex(g => g.id === groupId);
  if (groupIndex === -1) return { success: false, dissolved: false };

  const group = floor.patternGroups[groupIndex];
  if (!group.memberRoomIds.includes(roomId)) {
    return { success: false, dissolved: false };
  }

  // If removing origin room, dissolve the entire group
  if (group.originRoomId === roomId) {
    floor.patternGroups.splice(groupIndex, 1);
    return { success: true, dissolved: true, removedRoomIds: group.memberRoomIds };
  }

  // Get disconnected rooms before removal
  const disconnectedRooms = getDisconnectedRoomsOnRemoval(floor, groupId, roomId);

  // Remove the room and all disconnected rooms from members
  const roomsToRemove = new Set([roomId, ...disconnectedRooms]);
  group.memberRoomIds = group.memberRoomIds.filter(id => !roomsToRemove.has(id));

  // Group persists even with just the origin
  return { success: true, dissolved: false, removedRoomIds: Array.from(roomsToRemove) };
}

/**
 * Dissolve a pattern group entirely
 * All rooms become independent
 * @param {Object} floor - Floor object (will be mutated)
 * @param {string} groupId - Pattern group ID
 * @returns {boolean} True if successful
 */
export function dissolvePatternGroup(floor, groupId) {
  if (!floor?.patternGroups || !groupId) return false;

  const groupIndex = floor.patternGroups.findIndex(g => g.id === groupId);
  if (groupIndex === -1) return false;

  floor.patternGroups.splice(groupIndex, 1);
  return true;
}

/**
 * Change the origin room of a pattern group
 * @param {Object} floor - Floor object (will be mutated)
 * @param {string} groupId - Pattern group ID
 * @param {string} newOriginRoomId - New origin room ID (must be a member)
 * @returns {boolean} True if successful
 */
export function changePatternGroupOrigin(floor, groupId, newOriginRoomId) {
  if (!floor?.patternGroups || !groupId || !newOriginRoomId) return false;

  const group = floor.patternGroups.find(g => g.id === groupId);
  if (!group) return false;

  if (!group.memberRoomIds.includes(newOriginRoomId)) return false;

  group.originRoomId = newOriginRoomId;
  return true;
}

/**
 * Get rooms that would become disconnected from origin if a room is removed
 * @param {Object} floor - Floor object
 * @param {string} groupId - Pattern group ID
 * @param {string} roomIdToRemove - Room ID to simulate removal
 * @returns {string[]} Array of room IDs that would become disconnected (excludes the removed room)
 */
export function getDisconnectedRoomsOnRemoval(floor, groupId, roomIdToRemove) {
  if (!floor?.patternGroups || !floor?.rooms || !groupId || !roomIdToRemove) return [];

  const group = floor.patternGroups.find(g => g.id === groupId);
  if (!group) return [];

  // Simulate removal - get remaining members
  const remainingMembers = group.memberRoomIds.filter(id => id !== roomIdToRemove);
  if (remainingMembers.length <= 1) return []; // Only origin left, nothing disconnected

  // Flood-fill from origin to find connected rooms
  const visited = new Set();
  const queue = [group.originRoomId];

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (visited.has(currentId) || currentId === roomIdToRemove) continue;
    visited.add(currentId);

    const currentRoom = floor.rooms.find(r => r.id === currentId);
    if (!currentRoom) continue;

    for (const memberId of remainingMembers) {
      if (visited.has(memberId) || memberId === roomIdToRemove) continue;

      const memberRoom = floor.rooms.find(r => r.id === memberId);
      if (memberRoom && areRoomsAdjacent(currentRoom, memberRoom)) {
        queue.push(memberId);
      }
    }
  }

  // Disconnected rooms are those not visited (excluding the removed room)
  return remainingMembers.filter(id => !visited.has(id) && id !== group.originRoomId);
}

/**
 * Validate that all rooms in a pattern group are still connected
 * Uses flood-fill from origin room
 * @param {Object} floor - Floor object
 * @param {string} groupId - Pattern group ID
 * @returns {boolean} True if all members are connected
 */
export function validatePatternGroupConnectivity(floor, groupId) {
  if (!floor?.patternGroups || !floor?.rooms || !groupId) return false;

  const group = floor.patternGroups.find(g => g.id === groupId);
  if (!group || group.memberRoomIds.length < 2) return true; // Single room is always "connected"

  const memberSet = new Set(group.memberRoomIds);
  const visited = new Set();
  const queue = [group.originRoomId];

  // Flood-fill from origin
  while (queue.length > 0) {
    const currentId = queue.shift();
    if (visited.has(currentId)) continue;
    visited.add(currentId);

    const currentRoom = floor.rooms.find(r => r.id === currentId);
    if (!currentRoom) continue;

    // Find adjacent members
    for (const memberId of group.memberRoomIds) {
      if (visited.has(memberId)) continue;

      const memberRoom = floor.rooms.find(r => r.id === memberId);
      if (memberRoom && areRoomsAdjacent(currentRoom, memberRoom)) {
        queue.push(memberId);
      }
    }
  }

  // All members should have been visited
  return visited.size === memberSet.size;
}

/**
 * Get tile settings for a room, considering pattern group inheritance
 * Returns origin room's settings if in a group, otherwise room's own settings
 * @param {Object} room - The room
 * @param {Object} floor - Floor object
 * @returns {Object} { tile, pattern, grout } settings
 */
export function getEffectiveTileSettings(room, floor) {
  const originRoom = getPatternOriginRoom(floor, room?.id);
  const sourceRoom = originRoom || room;

  return {
    tile: sourceRoom?.tile || null,
    pattern: sourceRoom?.pattern || null,
    grout: sourceRoom?.grout || null
  };
}

/**
 * Check if a room is a child in a pattern group (member but not origin)
 * @param {Object} room - The room to check
 * @param {Object} floor - Floor object with patternGroups
 * @returns {boolean} True if room is a child (in group but not the origin)
 */
export function isPatternGroupChild(room, floor) {
  if (!room || !floor) return false;

  const group = getRoomPatternGroup(floor, room.id);
  if (!group) return false;

  // Room is in a group - check if it's the origin
  return group.originRoomId !== room.id;
}
