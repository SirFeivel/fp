// src/core.js
import { t } from "./i18n.js";
import { createSurface } from "./surface.js";
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

export function showUserWarning(messageKey, details = "") {
  if (typeof document === "undefined") {
    console.warn(t(messageKey), details);
    return;
  }

  const warningsEl = document.getElementById("warnings");
  if (!warningsEl) {
    console.warn(t(messageKey), details);
    return;
  }

  const div = document.createElement("div");
  div.className = "warnItem";
  div.style.border = "2px solid rgba(255,193,7,0.5)";

  const title = document.createElement("div");
  title.className = "wTitle";
  title.textContent = t(messageKey);

  const text = document.createElement("div");
  text.className = "wText";
  text.textContent = details;

  div.replaceChildren(title, text);
  warningsEl.prepend(div);

  setTimeout(() => div.remove(), 10000);
}

export function uuid() {
  return crypto?.randomUUID
    ? crypto.randomUUID()
    : String(Date.now()) + "-" + Math.random().toString(16).slice(2);
}

export function degToRad(d) {
  return (d * Math.PI) / 180;
}

export const DEFAULT_PRICING = {
  packM2: 1.44,
  pricePerM2: 39.9,
  reserveTiles: 0
};

export const DEFAULT_TILE_PRESET = {
  shape: "rect",
  widthCm: 40,
  heightCm: 20,
  groutWidthCm: 0.2,
  groutColorHex: "#ffffff",
  pricePerM2: 39.9,
  packM2: 1.44,
  useForSkirting: true
};

export const DEFAULT_SKIRTING_PRESET = {
  name: "Standard Sockelleiste",
  heightCm: 6,
  lengthCm: 60,
  pricePerPiece: 5
};

export const DEFAULT_WASTE = {
  allowRotate: true,
  shareOffcuts: false,
  optimizeCuts: false,
  kerfCm: 0.2
};

export const DEFAULT_SKIRTING_CONFIG = {
  enabled: true,
  type: "cutout",
  heightCm: DEFAULT_SKIRTING_PRESET.heightCm,
  boughtWidthCm: DEFAULT_SKIRTING_PRESET.lengthCm,
  boughtPricePerPiece: DEFAULT_SKIRTING_PRESET.pricePerPiece
};

/**
 * Returns a default state with one room (for backwards compatibility in tests).
 */
export function defaultStateWithRoom() {
  const state = defaultState();
  const room = createSurface({ name: "Raum", widthCm: 600, heightCm: 400 });
  state.floors[0].rooms.push(room);
  state.selectedRoomId = room.id;
  state.view.planningMode = "room";
  return state;
}

export function defaultState() {
  const floorId = uuid();

  return {
    meta: { version: 10, updatedAt: nowISO() },

    project: { name: "Projekt" },

    materials: {},
    tilePresets: [
      {
        id: uuid(),
        name: "Standard",
        ...DEFAULT_TILE_PRESET
      }
    ],
    skirtingPresets: [
      {
        id: uuid(),
        ...DEFAULT_SKIRTING_PRESET
      }
    ],

    floors: [
      {
        id: floorId,
        name: "Erdgeschoss",
        // Floor layout properties (v7)
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
      }
    ],

    selectedFloorId: floorId,
    selectedRoomId: null,

    pricing: { ...DEFAULT_PRICING },

    waste: { ...DEFAULT_WASTE },

    view: {
      showGrid: true,
      showNeeds: false,
      showSkirting: true,
      showFloorTiles: false,
      planningMode: "floor"  // Start in floor view to add rooms
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

export function getDefaultPricing(state) {
  const pack = Number(state?.pricing?.packM2);
  const price = Number(state?.pricing?.pricePerM2);
  const reserve = Number(state?.pricing?.reserveTiles);
  return {
    packM2: Number.isFinite(pack) ? pack : DEFAULT_PRICING.packM2,
    pricePerM2: Number.isFinite(price) ? price : DEFAULT_PRICING.pricePerM2,
    reserveTiles: Number.isFinite(reserve) ? reserve : DEFAULT_PRICING.reserveTiles
  };
}

export function getDefaultTilePresetTemplate(state) {
  const preset = state?.tilePresets?.find(p => p?.name) || DEFAULT_TILE_PRESET;
  return {
    shape: preset.shape || DEFAULT_TILE_PRESET.shape,
    widthCm: Number(preset.widthCm) || DEFAULT_TILE_PRESET.widthCm,
    heightCm: Number(preset.heightCm) || DEFAULT_TILE_PRESET.heightCm,
    groutWidthCm: Number(preset.groutWidthCm) || DEFAULT_TILE_PRESET.groutWidthCm,
    groutColorHex: preset.groutColorHex || DEFAULT_TILE_PRESET.groutColorHex,
    useForSkirting: Boolean(preset.useForSkirting)
  };
}
