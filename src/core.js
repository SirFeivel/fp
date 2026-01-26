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
  return {
    meta: { version: 1, updatedAt: nowISO() },
    room: { name: "Raum", widthCm: 600, heightCm: 400 },
    exclusions: [],
    tile: { widthCm: 60, heightCm: 60 },
    grout: { widthCm: 0.2 },
    pattern: {
      type: "grid",
      bondFraction: 0.5,
      rotationDeg: 0,
      offsetXcm: 0,
      offsetYcm: 0,
      origin: { preset: "tl", xCm: 0, yCm: 0 }
    },
    pricing: { packM2: 1.44, pricePerM2: 39.9, reserveTiles: 0 },

    // NEW: waste options (persisted)
    waste: {
      allowRotate: true
    },

    // NEW: view options (persisted)
    view: {
      showGrid: true,
      showNeeds: false // Toggle "Debug: Reststück-Bedarf anzeigen"
    }
  };
}