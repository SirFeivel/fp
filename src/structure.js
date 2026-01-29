import { uuid, deepClone, getCurrentRoom, getCurrentFloor } from './core.js';
import { t } from './i18n.js';

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

    sel.disabled = false;
    for (const room of currentFloor.rooms) {
      const opt = document.createElement("option");
      opt.value = room.id;
      opt.textContent = room.name;
      if (room.id === state.selectedRoomId) opt.selected = true;
      sel.appendChild(opt);
    }
  }

  function addFloor() {
    const state = store.getState();
    const next = deepClone(state);

    const newFloor = {
      id: uuid(),
      name: `Etage ${next.floors.length + 1}`,
      rooms: [{
        id: uuid(),
        name: "Raum",
        sections: [{ id: uuid(), label: "Hauptbereich", x: 0, y: 0, widthCm: 600, heightCm: 400, skirtingEnabled: true }],
        exclusions: [],
        excludedTiles: [],
        excludedSkirts: [],
        tile: { widthCm: 60, heightCm: 60, shape: "rect" },
        grout: { widthCm: 0.2, colorHex: "#ffffff" },
        pattern: {
          type: "grid",
          bondFraction: 0.5,
          rotationDeg: 0,
          offsetXcm: 0,
          offsetYcm: 0,
          origin: { preset: "tl", xCm: 0, yCm: 0 }
        },
        skirting: {
          enabled: false,
          type: "cutout",
          heightCm: 6,
          boughtWidthCm: 60,
          boughtPricePerPiece: 5.0
        }
      }]
    };

    next.floors.push(newFloor);
    next.selectedFloorId = newFloor.id;
    next.selectedRoomId = newFloor.rooms[0].id;

    resetSelectedExcl();
    store.commit(t("structure.floorAdded"), next, { onRender: renderAll, updateMetaCb: updateMeta });
  }

  function deleteFloor() {
    const state = store.getState();
    if (!state.floors || state.floors.length <= 1) {
      alert("Cannot delete the last floor");
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

  function addRoom() {
    const state = store.getState();
    const next = deepClone(state);

    const currentFloor = getCurrentFloor(next);
    if (!currentFloor) return;

    const newRoom = {
      id: uuid(),
      name: `Raum ${currentFloor.rooms.length + 1}`,
      sections: [{ id: uuid(), label: "Hauptbereich", x: 0, y: 0, widthCm: 600, heightCm: 400, skirtingEnabled: true }],
      exclusions: [],
      excludedTiles: [],
      excludedSkirts: [],
      tile: { widthCm: 60, heightCm: 60, shape: "rect", reference: "" },
      grout: { widthCm: 0.2, colorHex: "#ffffff" },
      pattern: {
        type: "grid",
        bondFraction: 0.5,
        rotationDeg: 0,
        offsetXcm: 0,
        offsetYcm: 0,
        origin: { preset: "tl", xCm: 0, yCm: 0 }
      },
      skirting: {
        enabled: false,
        type: "cutout",
        heightCm: 6,
        boughtWidthCm: 60,
        boughtPricePerPiece: 5.0
      }
    };

    currentFloor.rooms.push(newRoom);
    next.selectedRoomId = newRoom.id;

    resetSelectedExcl();
    store.commit(t("structure.roomAdded"), next, { onRender: renderAll, updateMetaCb: updateMeta });
  }

  function deleteRoom() {
    const state = store.getState();
    const currentFloor = getCurrentFloor(state);
    if (!currentFloor || currentFloor.rooms.length <= 1) {
      alert("Cannot delete the last room");
      return;
    }

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
    addFloor,
    deleteFloor,
    addRoom,
    deleteRoom,
    selectFloor,
    selectRoom,
    commitFloorName
  };
}
