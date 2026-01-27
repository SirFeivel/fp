// src/core.js
export const LS_SESSION = "fp.session.v1";
export const LS_PROJECTS = "fp.projects.v1";

export function nowISO() {
  return new Date().toISOString();
}

export function deepClone(obj) {
  if (typeof structuredClone === "function") return structuredClone(obj);
  return JSON.parse(JSON.stringify(obj));
}

export function downloadText(filename, text) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function safeParseJSON(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: e };
  }
}

export function escapeHTML(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[c])
  );
}

export function uuid() {
  return crypto?.randomUUID
    ? crypto.randomUUID()
    : String(Date.now()) + "-" + Math.random().toString(16).slice(2);
}

export function degToRad(d) {
  return (d * Math.PI) / 180;
}

export function defaultState() {
  const floorId = uuid();
  const roomId = uuid();

  return {
    meta: { version: 3, updatedAt: nowISO() },

    project: { name: "Projekt" },

    floors: [
      {
        id: floorId,
        name: "Erdgeschoss",
        rooms: [
          {
            id: roomId,
            name: "Raum",
            widthCm: 600,
            heightCm: 400,
            exclusions: [],
            tile: { widthCm: 40, heightCm: 20, shape: "rect" },
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
              type: "cutout", // "cutout" | "bought"
              heightCm: 6,
              boughtWidthCm: 60,
              boughtPricePerPiece: 5.0
            }
          }
        ]
      }
    ],

    selectedFloorId: floorId,
    selectedRoomId: roomId,

    pricing: { packM2: 1.44, pricePerM2: 39.9, reserveTiles: 0 },

    waste: {
      allowRotate: true
    },

    view: {
      showGrid: true,
      showNeeds: false,
      showSkirting: true
    }
  };
}

export function getCurrentRoom(state) {
  if (!state.floors || !state.selectedFloorId || !state.selectedRoomId) {
    return null;
  }

  const floor = state.floors.find(f => f.id === state.selectedFloorId);
  if (!floor || !floor.rooms) return null;

  const room = floor.rooms.find(r => r.id === state.selectedRoomId);
  return room || null;
}

export function getCurrentFloor(state) {
  if (!state.floors || !state.selectedFloorId) {
    return null;
  }

  return state.floors.find(f => f.id === state.selectedFloorId) || null;
}