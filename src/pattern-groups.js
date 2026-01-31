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
  if (!originRoom || originRoom.id === room.id) return null;

  // Compute origin in floor coordinates from origin room's top-left
  const originPos = originRoom.floorPosition || { x: 0, y: 0 };
  const originBounds = getRoomBounds(originRoom);
  const globalOrigin = {
    x: originPos.x + originBounds.minX,
    y: originPos.y + originBounds.minY
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
    return { success: true, dissolved: true };
  }

  // Remove the room from members
  group.memberRoomIds = group.memberRoomIds.filter(id => id !== roomId);

  // If only one room left, dissolve the group
  if (group.memberRoomIds.length < 2) {
    floor.patternGroups.splice(groupIndex, 1);
    return { success: true, dissolved: true };
  }

  // Validate connectivity - removed room might have been a bridge
  const stillConnected = validatePatternGroupConnectivity(floor, groupId);
  if (!stillConnected) {
    // Group became disconnected, dissolve it
    floor.patternGroups.splice(groupIndex, 1);
    return { success: true, dissolved: true };
  }

  return { success: true, dissolved: false };
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
