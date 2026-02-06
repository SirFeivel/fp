import { uuid, deepClone, getCurrentRoom, getCurrentFloor, getDefaultTilePresetTemplate } from './core.js';
import { t } from './i18n.js';
import { getRoomAbsoluteBounds, findPositionOnFreeEdge } from './floor_geometry.js';
import { showAlert } from './dialog.js';
import { createSurface, ensureRoomWalls } from './surface.js';
import { getRoomPatternGroup, createPatternGroup, addRoomToPatternGroup } from './pattern-groups.js';

export function createStructureController({
  store,
  renderAll,
  updateMeta,
  resetSelectedExcl
}) {
  function renderFloorSelect() {
    const state = store.getState();
    const sel = document.getElementById("floorSelect");
    if (!sel) return;

    sel.innerHTML = "";

    if (!state.floors || state.floors.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = t("project.none");
      sel.appendChild(opt);
      sel.disabled = true;
      return;
    }

    sel.disabled = false;
    for (const floor of state.floors) {
      const opt = document.createElement("option");
      opt.value = floor.id;
      opt.textContent = floor.name;
      if (floor.id === state.selectedFloorId) opt.selected = true;
      sel.appendChild(opt);
    }
  }

  function renderRoomSelect() {
    const state = store.getState();
    const sel = document.getElementById("roomSelect");
    if (!sel) return;

    sel.innerHTML = "";

    const currentFloor = getCurrentFloor(state);
    if (!currentFloor || !currentFloor.rooms || currentFloor.rooms.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = t("project.none");
      sel.appendChild(opt);
      sel.disabled = true;
      return;
    }

    // Filter out walls - only show floor rooms
    const floorRooms = currentFloor.rooms.filter(r => !r.sourceRoomId);

    if (floorRooms.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = t("project.none");
      sel.appendChild(opt);
      sel.disabled = true;
      return;
    }

    sel.disabled = false;
    for (const room of floorRooms) {
      const opt = document.createElement("option");
      opt.value = room.id;
      opt.textContent = room.name;
      if (room.id === state.selectedRoomId) opt.selected = true;
      sel.appendChild(opt);
    }
  }

  function renderWallSelect() {
    const state = store.getState();
    const sel = document.getElementById("wallSelect");
    if (!sel) return;

    sel.innerHTML = "";

    const currentFloor = getCurrentFloor(state);
    const currentRoom = getCurrentRoom(state);

    if (!currentFloor || !currentRoom) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = t("project.none");
      sel.appendChild(opt);
      sel.disabled = true;
      return;
    }

    // Get walls for the current room
    const walls = currentFloor.rooms.filter(r => r.sourceRoomId === currentRoom.id);

    if (walls.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = t("structure.noWalls") || "No walls";
      sel.appendChild(opt);
      sel.disabled = true;
      return;
    }

    sel.disabled = false;
    for (const wall of walls) {
      const opt = document.createElement("option");
      opt.value = wall.id;
      opt.textContent = wall.name;
      if (wall.id === state.selectedRoomId) opt.selected = true;
      sel.appendChild(opt);
    }
  }

  function addFloor() {
    const state = store.getState();
    const next = deepClone(state);

    const newFloor = {
      id: uuid(),
      name: `Etage ${next.floors.length + 1}`,
      layout: {
        enabled: false,
        background: null
      },
      patternLinking: {
        enabled: false,
        globalOrigin: { x: 0, y: 0 }
      },
      offcutSharing: {
        enabled: false
      },
      patternGroups: [],
      rooms: []
    };

    next.floors.push(newFloor);
    next.selectedFloorId = newFloor.id;
    next.selectedRoomId = null;

    resetSelectedExcl();
    store.commit(t("structure.floorAdded"), next, { onRender: renderAll, updateMetaCb: updateMeta });
  }

  async function deleteFloor() {
    const state = store.getState();
    if (!state.floors || state.floors.length <= 1) {
      await showAlert({
        title: t("dialog.warning") || "Warning",
        message: t("dialog.cannotDeleteLastFloor") || "Cannot delete the last floor",
        type: "warning"
      });
      return;
    }

    const next = deepClone(state);
    const beforeLen = next.floors.length;
    next.floors = next.floors.filter(f => f.id !== state.selectedFloorId);

    if (next.floors.length === beforeLen) return;

    const firstFloor = next.floors[0];
    next.selectedFloorId = firstFloor.id;
    next.selectedRoomId = firstFloor.rooms?.[0]?.id || null;

    resetSelectedExcl();
    store.commit(t("structure.floorDeleted"), next, { onRender: renderAll, updateMetaCb: updateMeta });
  }

  /**
   * Find a position for a new room on a free edge of existing rooms
   */
  function findConnectedPositionForNewRoom(newRoom, existingRooms, floor = null) {
    // If no existing rooms, center on background image or use origin
    if (!existingRooms || existingRooms.length === 0) {
      const bg = floor?.layout?.background;
      if (bg?.nativeWidth && bg?.nativeHeight) {
        const nativeW = bg.nativeWidth;
        const pixelsPerCm = bg.scale?.calibrated ? bg.scale.pixelsPerCm : (nativeW / 1000);
        const imgWidth = nativeW / pixelsPerCm;
        const imgHeight = bg.nativeHeight / pixelsPerCm;
        return {
          x: Math.round((imgWidth - newRoom.widthCm) / 2),
          y: Math.round((imgHeight - newRoom.heightCm) / 2)
        };
      }
      return { x: 0, y: 0 };
    }

    // Use free edge detection to find optimal position
    const position = findPositionOnFreeEdge(newRoom, existingRooms, 'right');
    if (position) {
      return { x: position.x, y: position.y };
    }

    // Fallback: find the rightmost edge of all existing rooms
    let maxRight = -Infinity;
    let topAtMaxRight = 0;

    for (const room of existingRooms) {
      const bounds = getRoomAbsoluteBounds(room);
      if (bounds.right > maxRight) {
        maxRight = bounds.right;
        topAtMaxRight = bounds.top;
      }
    }

    // Place new room to the right of the rightmost room
    return { x: maxRight, y: topAtMaxRight };
  }

  function addRoom() {
    const state = store.getState();
    const next = deepClone(state);

    const currentFloor = getCurrentFloor(next);
    if (!currentFloor) return;

    const hasPreset = Boolean(next.tilePresets?.[0]?.name);
    const defaultPreset = getDefaultTilePresetTemplate(next);
    const presetName = hasPreset ? next.tilePresets[0].name : "";
    const newRoom = createSurface({
      name: `Raum ${currentFloor.rooms.length + 1}`,
      widthCm: 600,
      heightCm: 400,
      tile: {
        widthCm: defaultPreset.widthCm,
        heightCm: defaultPreset.heightCm,
        shape: defaultPreset.shape || "rect",
        reference: presetName,
      },
      grout: {
        widthCm: defaultPreset.groutWidthCm,
        colorHex: defaultPreset.groutColorHex,
      },
    });

    // Find a connected position for the new room
    const connectedPos = findConnectedPositionForNewRoom(newRoom, currentFloor.rooms, currentFloor);
    newRoom.floorPosition = connectedPos;

    currentFloor.rooms.push(newRoom);
    next.selectedRoomId = newRoom.id;

    // Auto-generate walls for new room
    const { addedWalls, needsPatternGroup } = ensureRoomWalls(newRoom, currentFloor);

    // Setup pattern group linking floor room to walls
    if (needsPatternGroup && addedWalls.length > 0) {
      const existingGroup = getRoomPatternGroup(currentFloor, newRoom.id);
      let group = existingGroup || createPatternGroup(currentFloor, newRoom.id);
      if (group) {
        for (const wall of addedWalls) {
          addRoomToPatternGroup(currentFloor, group.id, wall.id);
        }
      }
    }

    resetSelectedExcl();
    store.commit(t("structure.roomAdded"), next, { onRender: renderAll, updateMetaCb: updateMeta });
  }

  async function deleteRoom() {
    const state = store.getState();
    const currentFloor = getCurrentFloor(state);
    if (!currentFloor || !state.selectedRoomId) return;

    const next = deepClone(state);
    const nextFloor = getCurrentFloor(next);
    if (!nextFloor) return;

    const beforeLen = nextFloor.rooms.length;
    nextFloor.rooms = nextFloor.rooms.filter(r => r.id !== state.selectedRoomId);

    if (nextFloor.rooms.length === beforeLen) return;

    next.selectedRoomId = nextFloor.rooms[0]?.id || null;

    resetSelectedExcl();
    store.commit(t("structure.roomDeleted"), next, { onRender: renderAll, updateMetaCb: updateMeta });
  }

  function selectFloor(floorId) {
    const state = store.getState();
    const next = deepClone(state);

    next.selectedFloorId = floorId;

    const floor = next.floors.find(f => f.id === floorId);
    next.selectedRoomId = floor?.rooms?.[0]?.id || null;

    resetSelectedExcl();
    store.commit(t("room.changed"), next, { onRender: renderAll, updateMetaCb: updateMeta });
  }

  function selectRoom(roomId) {
    const state = store.getState();
    const next = deepClone(state);

    next.selectedRoomId = roomId;

    resetSelectedExcl();
    store.commit(t("room.changed"), next, { onRender: renderAll, updateMetaCb: updateMeta });
  }

  function renderFloorName() {
    const state = store.getState();
    const input = document.getElementById("floorName");
    if (!input) return;

    const currentFloor = getCurrentFloor(state);
    input.value = currentFloor?.name || "";
    input.disabled = !currentFloor;
  }

  function commitFloorName() {
    const state = store.getState();
    const next = deepClone(state);

    const currentFloor = getCurrentFloor(next);
    if (!currentFloor) return;

    const input = document.getElementById("floorName");
    if (!input) return;

    currentFloor.name = input.value || currentFloor.name;

    store.commit(t("structure.floorChanged"), next, { onRender: renderAll, updateMetaCb: updateMeta });
  }

  return {
    renderFloorSelect,
    renderFloorName,
    renderRoomSelect,
    renderWallSelect,
    addFloor,
    deleteFloor,
    addRoom,
    deleteRoom,
    selectFloor,
    selectRoom,
    commitFloorName
  };
}
