// src/state.js
import {
  LS_SESSION,
  LS_PROJECTS,
  nowISO,
  deepClone,
  safeParseJSON,
  uuid,
  getCurrentRoom,
  DEFAULT_TILE_PRESET,
  DEFAULT_PRICING,
  DEFAULT_WASTE,
  DEFAULT_SKIRTING_CONFIG,
  DEFAULT_SKIRTING_PRESET,
  showUserWarning
} from './core.js';
import { clearMetricsCache } from './calc.js';
import { areRoomsAdjacent } from './floor_geometry.js';
import { computeCompositePolygon } from './composite.js';

export function createStateStore(defaultStateFn, validateStateFn) {
  function normalizeState(s) {
    if (!s || typeof s !== "object") return defaultStateFn();

    const version = s.meta?.version || 1;

    if (version === 1) {
      s = migrateV1ToV2(s);
    }
    if (s.meta?.version === 2) {
      // V2 to V3 was mostly implicit property additions, but let's ensure version is 3
      s.meta.version = 3;
    }
    if (s.meta?.version === 3) {
      s = migrateV3ToV4(s);
    }
    if (s.meta?.version === 4) {
      s = migrateV4ToV5(s);
    }
    if (s.meta?.version === 5) {
      s = migrateV5ToV6(s);
    }
    if (s.meta?.version === 6) {
      s = migrateV6ToV7(s);
    }
    if (s.meta?.version === 7) {
      s = migrateV7ToV8(s);
    }
    if (s.meta?.version === 8) {
      s = migrateV8ToV9(s);
    }
    if (s.meta?.version === 9) {
      s = migrateV9ToV10(s);
    }

    if (s.tile || s.grout || s.pattern) {
      const globalTile = s.tile || {
        widthCm: DEFAULT_TILE_PRESET.widthCm,
        heightCm: DEFAULT_TILE_PRESET.heightCm,
        shape: DEFAULT_TILE_PRESET.shape
      };
      const globalGrout = s.grout || { widthCm: 0.2 };
      const globalPattern = s.pattern || {
        type: "grid",
        bondFraction: 0.5,
        rotationDeg: 0,
        offsetXcm: 0,
        offsetYcm: 0,
        origin: { preset: "tl", xCm: 0, yCm: 0 }
      };

      if (s.floors && Array.isArray(s.floors)) {
        for (const floor of s.floors) {
          if (floor.rooms && Array.isArray(floor.rooms)) {
            for (const room of floor.rooms) {
              if (!room.tile) room.tile = deepClone(globalTile);
              if (!room.tile.shape) room.tile.shape = "rect";
              if (room.tile.reference === undefined) room.tile.reference = "";
              if (!room.grout) room.grout = deepClone(globalGrout);
              if (!room.grout.colorHex) room.grout.colorHex = "#ffffff";
              if (!room.pattern) room.pattern = deepClone(globalPattern);
              if (!room.skirting) {
                room.skirting = { ...DEFAULT_SKIRTING_CONFIG };
              }
              if (!room.excludedTiles) room.excludedTiles = [];
              if (!room.excludedSkirts) room.excludedSkirts = [];
              if (room.exclusions && Array.isArray(room.exclusions)) {
                for (const ex of room.exclusions) {
                  if (ex.skirtingEnabled === undefined) {
                    ex.skirtingEnabled = true;
                  }
                }
              }
            }
          }
        }
      }

      delete s.tile;
      delete s.grout;
      delete s.pattern;
    }

    if (!s.view) s.view = { showGrid: true, showNeeds: false, showSkirting: true, showFloorTiles: false, showWalls: true, planningMode: "room" };
    if (s.view.showGrid === undefined) s.view.showGrid = true;
    if (s.view.showNeeds === undefined) s.view.showNeeds = false;
    if (s.view.showSkirting === undefined) s.view.showSkirting = true;
    if (s.view.showFloorTiles === undefined) s.view.showFloorTiles = false;
    if (s.view.showWalls === undefined) s.view.showWalls = false;
    if (s.view.showWalls3D === undefined) s.view.showWalls3D = false;
    if (s.view.planningMode === undefined) s.view.planningMode = "room";
    if (s.view.showBaseBoards !== undefined) {
      s.view.showSkirting = s.view.showBaseBoards;
      delete s.view.showBaseBoards;
    }

    if (!s.waste || typeof s.waste !== "object") s.waste = { ...DEFAULT_WASTE };
    if (typeof s.waste.allowRotate !== "boolean") s.waste.allowRotate = DEFAULT_WASTE.allowRotate;
    if (typeof s.waste.shareOffcuts !== "boolean") s.waste.shareOffcuts = DEFAULT_WASTE.shareOffcuts;
    if (typeof s.waste.optimizeCuts !== "boolean") s.waste.optimizeCuts = DEFAULT_WASTE.optimizeCuts;
    if (!Number.isFinite(s.waste.kerfCm)) s.waste.kerfCm = DEFAULT_WASTE.kerfCm;

    if (!s.materials) s.materials = {};
    if (!Array.isArray(s.tilePresets)) s.tilePresets = [];
    if (!Array.isArray(s.skirtingPresets)) s.skirtingPresets = [];

    if (s.floors && Array.isArray(s.floors)) {
      for (const floor of s.floors) {
        // Normalize floor-level v7 properties
        if (!floor.layout) floor.layout = { enabled: false, background: null };
        if (!floor.patternLinking) floor.patternLinking = { enabled: false, globalOrigin: { x: 0, y: 0 } };
        if (!floor.offcutSharing) floor.offcutSharing = { enabled: false };
        if (!floor.patternGroups) floor.patternGroups = [];

        if (floor.rooms && Array.isArray(floor.rooms)) {
          for (const room of floor.rooms) {
            // Normalize room-level v7 properties
            if (!room.floorPosition) room.floorPosition = { x: 0, y: 0 };
            if (!room.patternLink) room.patternLink = { mode: "independent", linkedRoomId: null };

            room.tile = room.tile || {
              widthCm: DEFAULT_TILE_PRESET.widthCm,
              heightCm: DEFAULT_TILE_PRESET.heightCm,
              shape: DEFAULT_TILE_PRESET.shape,
              reference: ""
            };
            if (room.tile.widthCm == null) room.tile.widthCm = DEFAULT_TILE_PRESET.widthCm;
            if (room.tile.heightCm == null) room.tile.heightCm = DEFAULT_TILE_PRESET.heightCm;
            if (!room.tile.shape) room.tile.shape = DEFAULT_TILE_PRESET.shape;
            if (room.tile.reference === undefined) room.tile.reference = "";

            room.grout = room.grout || { widthCm: DEFAULT_TILE_PRESET.groutWidthCm, colorHex: DEFAULT_TILE_PRESET.groutColorHex };
            if (room.grout.widthCm == null) room.grout.widthCm = DEFAULT_TILE_PRESET.groutWidthCm;
            if (!room.grout.colorHex) room.grout.colorHex = DEFAULT_TILE_PRESET.groutColorHex;

            room.pattern = room.pattern || {
              type: "grid",
              bondFraction: 0.5,
              rotationDeg: 0,
              offsetXcm: 0,
              offsetYcm: 0,
              origin: { preset: "tl", xCm: 0, yCm: 0 }
            };
            if (!room.pattern.type) room.pattern.type = "grid";
            if (room.pattern.bondFraction == null) room.pattern.bondFraction = 0.5;
            if (room.pattern.rotationDeg == null) room.pattern.rotationDeg = 0;
            if (room.pattern.offsetXcm == null) room.pattern.offsetXcm = 0;
            if (room.pattern.offsetYcm == null) room.pattern.offsetYcm = 0;
            if (!room.pattern.origin) room.pattern.origin = { preset: "tl", xCm: 0, yCm: 0 };
            if (!room.pattern.origin.preset) room.pattern.origin.preset = "tl";
            if (room.pattern.origin.xCm == null) room.pattern.origin.xCm = 0;
            if (room.pattern.origin.yCm == null) room.pattern.origin.yCm = 0;

            if (!room.skirting) {
              room.skirting = { ...DEFAULT_SKIRTING_CONFIG };
            } else if (room.skirting.type !== "cutout" && room.skirting.type !== "bought") {
              room.skirting.type = "cutout";
            }

            if (!room.excludedTiles) room.excludedTiles = [];
            if (!room.excludedSkirts) room.excludedSkirts = [];

            if (room.exclusions && Array.isArray(room.exclusions)) {
              for (const ex of room.exclusions) {
                if (ex.skirtingEnabled === undefined) ex.skirtingEnabled = true;
              }
            }

            // Ensure room has polygonVertices (v8+ requirement)
            if (!room.polygonVertices || room.polygonVertices.length < 3) {
              room.polygonVertices = [
                { x: 0, y: 0 },
                { x: 300, y: 0 },
                { x: 300, y: 300 },
                { x: 0, y: 300 }
              ];
            }
          }
        }

        // Validate pattern groups
        if (floor.patternGroups && Array.isArray(floor.patternGroups)) {
          const roomIds = new Set(floor.rooms?.map(r => r.id) || []);
          const roomsById = new Map(floor.rooms?.map(r => [r.id, r]) || []);

          floor.patternGroups = floor.patternGroups.filter(group => {
            if (!group || !group.id || !group.originRoomId || !Array.isArray(group.memberRoomIds)) {
              return false;
            }
            // Filter out invalid room IDs
            group.memberRoomIds = group.memberRoomIds.filter(id => roomIds.has(id));
            // Origin must be in members
            if (!group.memberRoomIds.includes(group.originRoomId)) {
              return false;
            }

            // Check connectivity: only keep rooms connected to origin through adjacent rooms
            const originRoom = roomsById.get(group.originRoomId);
            if (!originRoom) return false;

            // BFS to find all rooms connected to origin
            const connected = new Set([group.originRoomId]);
            const queue = [group.originRoomId];

            while (queue.length > 0) {
              const currentId = queue.shift();
              const currentRoom = roomsById.get(currentId);
              if (!currentRoom) continue;

              // Check adjacency with other members
              for (const memberId of group.memberRoomIds) {
                if (connected.has(memberId)) continue;
                const memberRoom = roomsById.get(memberId);
                if (memberRoom && areRoomsAdjacent(currentRoom, memberRoom)) {
                  connected.add(memberId);
                  queue.push(memberId);
                }
              }
            }

            // Only keep connected members
            group.memberRoomIds = group.memberRoomIds.filter(id => connected.has(id));

            // Need at least 1 member (origin room) for a valid group
            return group.memberRoomIds.length >= 1;
          });
        }
      }
    }

    if (s.floors && Array.isArray(s.floors) && Array.isArray(s.tilePresets)) {
      const presetsByName = new Map(
        s.tilePresets.filter(p => p?.name).map(p => [p.name, p])
      );
      s.floors.forEach(floor => {
        floor.rooms?.forEach(room => {
          const ref = room.tile?.reference;
          const preset = ref ? presetsByName.get(ref) : null;
          const cutoutAllowed = ref ? Boolean(preset?.useForSkirting) : true;
          if (!cutoutAllowed && room.skirting?.type === "cutout") {
            room.skirting.type = "bought";
          }
        });
      });
    }

    return s;
  }

  function migrateV1ToV2(oldState) {
    const floorId = uuid();
    const roomId = uuid();

    const newState = {
      meta: { version: 2, updatedAt: nowISO() },
      project: { name: oldState.room?.name || "Projekt" },
      floors: [
        {
          id: floorId,
          name: "Erdgeschoss",
          rooms: [
            {
              id: roomId,
              name: oldState.room?.name || "Raum",
              widthCm: oldState.room?.widthCm || 600,
              heightCm: oldState.room?.heightCm || 400,
              exclusions: oldState.exclusions || [],
              tile: oldState.tile || {
                widthCm: DEFAULT_TILE_PRESET.widthCm,
                heightCm: DEFAULT_TILE_PRESET.heightCm,
                shape: DEFAULT_TILE_PRESET.shape
              },
              grout: oldState.grout || { widthCm: 0.2, colorHex: "#ffffff" },
              pattern: oldState.pattern || {
                type: "grid",
                bondFraction: 0.5,
                rotationDeg: 0,
                offsetXcm: 0,
                offsetYcm: 0,
                origin: { preset: "tl", xCm: 0, yCm: 0 }
              }
            }
          ]
        }
      ],
      selectedFloorId: floorId,
      selectedRoomId: roomId,
      pricing: oldState.pricing || { ...DEFAULT_PRICING },
      waste: oldState.waste || { ...DEFAULT_WASTE },
      view: oldState.view || { showGrid: true, showNeeds: false }
    };

    return newState;
  }

  function migrateV3ToV4(s) {
    if (s.floors && Array.isArray(s.floors)) {
      for (const floor of s.floors) {
        if (floor.rooms && Array.isArray(floor.rooms)) {
          for (const room of floor.rooms) {
            if (!room.sections || room.sections.length === 0) {
              const w = Number(room.widthCm);
              const h = Number(room.heightCm);
              if (w > 0 && h > 0) {
                room.sections = [
                  {
                    id: uuid(),
                    label: "Hauptbereich",
                    x: 0,
                    y: 0,
                    widthCm: w,
                    heightCm: h,
                    skirtingEnabled: room.skirting ? !!room.skirting.enabled : true
                  }
                ];
              }
            }
            delete room.widthCm;
            delete room.heightCm;
          }
        }
      }
    }
    s.meta.version = 4;
    return s;
  }

  function migrateV4ToV5(s) {
    if (!s.materials) s.materials = {};
    if (s.floors && Array.isArray(s.floors)) {
      for (const floor of s.floors) {
        if (floor.rooms && Array.isArray(floor.rooms)) {
          for (const room of floor.rooms) {
            if (room.tile && room.tile.reference === undefined) {
              room.tile.reference = "";
            }
          }
        }
      }
    }
    s.meta.version = 5;
    return s;
  }

  function migrateV5ToV6(s) {
    if (!Array.isArray(s.tilePresets)) s.tilePresets = [];
    if (!Array.isArray(s.skirtingPresets)) s.skirtingPresets = [];
    s.meta.version = 6;
    return s;
  }

  function migrateV6ToV7(s) {
    // Add floor-level layout properties
    for (const floor of s.floors || []) {
      if (!floor.layout) {
        floor.layout = { enabled: false, background: null };
      }
      if (!floor.patternLinking) {
        floor.patternLinking = { enabled: false, globalOrigin: { x: 0, y: 0 } };
      }
      if (!floor.offcutSharing) {
        floor.offcutSharing = { enabled: false };
      }
      if (!floor.patternGroups) {
        floor.patternGroups = [];
      }
      // Add room-level position and pattern link properties
      for (const room of floor.rooms || []) {
        if (!room.floorPosition) {
          room.floorPosition = { x: 0, y: 0 };
        }
        if (!room.patternLink) {
          room.patternLink = { mode: "independent", linkedRoomId: null };
        }
      }
    }

    // Add planningMode to view
    if (s.view && s.view.planningMode === undefined) {
      s.view.planningMode = "room";
    }

    s.meta.version = 7;
    return s;
  }

  function migrateV7ToV8(s) {
    // Convert room.sections to room.polygonVertices
    for (const floor of s.floors || []) {
      for (const room of floor.rooms || []) {
        // Skip if room already has polygonVertices
        if (room.polygonVertices && room.polygonVertices.length >= 3) {
          delete room.sections;
          continue;
        }

        // Convert sections to polygonVertices
        if (room.sections && Array.isArray(room.sections) && room.sections.length > 0) {
          const validSections = room.sections.filter(s => s.widthCm > 0 && s.heightCm > 0);

          if (validSections.length === 0) {
            // No valid sections, create default rectangle
            room.polygonVertices = [
              { x: 0, y: 0 },
              { x: 300, y: 0 },
              { x: 300, y: 300 },
              { x: 0, y: 300 }
            ];
          } else if (validSections.length === 1) {
            // Single section - convert directly to rectangle
            const sec = validSections[0];
            room.polygonVertices = [
              { x: sec.x, y: sec.y },
              { x: sec.x + sec.widthCm, y: sec.y },
              { x: sec.x + sec.widthCm, y: sec.y + sec.heightCm },
              { x: sec.x, y: sec.y + sec.heightCm }
            ];
          } else {
            // Multiple sections - union them into a single polygon
            const { mp, error } = computeCompositePolygon(validSections);

            if (mp && mp.length > 0 && mp[0] && mp[0][0] && mp[0][0].length > 0) {
              // Take the outer ring of the first polygon
              const outerRing = mp[0][0];
              // Convert to polygonVertices format (remove closing duplicate point)
              room.polygonVertices = [];
              for (let i = 0; i < outerRing.length - 1; i++) {
                room.polygonVertices.push({ x: outerRing[i][0], y: outerRing[i][1] });
              }
            } else {
              // Fallback to bounding box if union fails
              let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
              for (const sec of validSections) {
                minX = Math.min(minX, sec.x);
                minY = Math.min(minY, sec.y);
                maxX = Math.max(maxX, sec.x + sec.widthCm);
                maxY = Math.max(maxY, sec.y + sec.heightCm);
              }
              room.polygonVertices = [
                { x: minX, y: minY },
                { x: maxX, y: minY },
                { x: maxX, y: maxY },
                { x: minX, y: maxY }
              ];
            }
          }

          // Delete sections after conversion
          delete room.sections;
        } else if (!room.polygonVertices) {
          // No sections and no polygonVertices - create default rectangle
          room.polygonVertices = [
            { x: 0, y: 0 },
            { x: 300, y: 0 },
            { x: 300, y: 300 },
            { x: 0, y: 300 }
          ];
        }
      }
    }

    s.meta.version = 8;
    return s;
  }

  function migrateV8ToV9(s) {
    // Convert circle rooms from { cx, cy, r } to { cx, cy, rx, ry } (ellipse model)
    for (const floor of s.floors || []) {
      for (const room of floor.rooms || []) {
        if (room.circle && room.circle.r > 0 && room.circle.rx === undefined) {
          const { cx, cy, r } = room.circle;
          room.circle = { cx, cy, rx: r, ry: r };
        }
        if (room.circle && room.polygonVertices) {
          room.polygonVertices = null;
        }
      }
    }
    s.meta.version = 9;
    return s;
  }

  function migrateV9ToV10(s) {
    // Auto-generate wall surfaces for existing polygon rooms
    s.meta = s.meta || {};
    s.meta.version = 10;

    if (!s.floors || !Array.isArray(s.floors)) return s;

    // Dynamic imports to avoid circular deps - but we'll skip this in migration
    // and let the walls be generated on first user interaction instead
    // This is safer and avoids import issues during state normalization

    console.log('[Migration v9->v10] Skipping wall generation in migration - walls will be created on demand');

    return s;
  }

  let state = normalizeState(defaultStateFn());
  let undoStack = [];
  let redoStack = [];
  let dirty = false;
  let lastSavedAt = null;

  function getState() {
    return state;
  }
  function setStateDirect(next) {
    state = normalizeState(next);
  }

  function getUndoStack() {
    return undoStack;
  }
  function getRedoStack() {
    return redoStack;
  }
  function isDirty() {
    return dirty;
  }
  function markDirty() {
    dirty = true;
  }
  function getLastSavedAt() {
    return lastSavedAt;
  }

  function autosaveSession(updateMetaCb) {
    try {
      localStorage.setItem(LS_SESSION, JSON.stringify(state));
      lastSavedAt = nowISO();
      dirty = false;
      updateMetaCb?.();
    } catch (e) {
      console.warn('Autosave failed:', e);
      showUserWarning("errors.autosaveFailed", e.message);
    }
  }

  function loadSessionIfAny() {
    const raw = localStorage.getItem(LS_SESSION);
    if (!raw) return false;

    const parsed = safeParseJSON(raw);
    if (!parsed.ok) return false;

    // ✅ NEU: Migration anwenden bevor Validierung/Benutzung
    const candidate = normalizeState(parsed.value);

    const { errors } = validateStateFn(candidate);
    if (errors.length > 0) return false;

    state = candidate;
    lastSavedAt = state?.meta?.updatedAt ?? null;
    return true;
  }

  function commit(label, nextState, { onRender, updateMetaCb } = {}) {
    const before = deepClone(state);
    const after = normalizeState(deepClone(nextState));
    after.meta = after.meta || {};
    after.meta.updatedAt = nowISO();

    const same = JSON.stringify(before) === JSON.stringify(after);
    if (same) {
      onRender?.();
      return;
    }

    undoStack.push({ label, before, after, ts: nowISO() });
    redoStack = [];
    state = after;

    autosaveSession(updateMetaCb);
    onRender?.(label);
  }

  function undo({ onRender, updateMetaCb } = {}) {
    if (undoStack.length === 0) return;
    const entry = undoStack.pop();
    redoStack.push(entry);
    state = normalizeState(deepClone(entry.before));
    clearMetricsCache();
    autosaveSession(updateMetaCb);
    onRender?.(`Undo: ${entry.label}`);
  }

  function redo({ onRender, updateMetaCb } = {}) {
    if (redoStack.length === 0) return;
    const entry = redoStack.pop();
    undoStack.push(entry);
    state = normalizeState(deepClone(entry.after));
    clearMetricsCache();
    autosaveSession(updateMetaCb);
    onRender?.(`Redo: ${entry.label}`);
  }

  // Projects
  function loadProjects() {
    const raw = localStorage.getItem(LS_PROJECTS);
    if (!raw) return [];
    const parsed = safeParseJSON(raw);
    if (!parsed.ok || !Array.isArray(parsed.value)) return [];
    return parsed.value;
  }
  function saveProjects(list) {
    localStorage.setItem(LS_PROJECTS, JSON.stringify(list));
  }

  function saveCurrentAsProject(name) {
    const projects = loadProjects();
    const currentRoom = getCurrentRoom(state);
    const entry = {
      id: uuid(),
      name: name || state.project?.name || currentRoom?.name || 'Projekt',
      updatedAt: nowISO(),
      data: deepClone(state),
    };
    projects.unshift(entry);
    saveProjects(projects);
    return entry.id;
  }

  function loadProjectById(id) {
    const projects = loadProjects();
    const entry = projects.find((p) => p.id === id);
    if (!entry) return { ok: false, name: null };

    state = normalizeState(deepClone(entry.data));
    undoStack = [];
    redoStack = [];
    autosaveSession();
    return { ok: true, name: entry.name };
  }

  function deleteProjectById(id) {
    let projects = loadProjects();
    const beforeLen = projects.length;
    projects = projects.filter((p) => p.id !== id);
    saveProjects(projects);
    return projects.length !== beforeLen;
  }

  return {
    // state
    getState,
    setStateDirect,

    // meta
    getUndoStack,
    getRedoStack,
    isDirty,
    markDirty,
    getLastSavedAt,

    // session + history
    autosaveSession,
    loadSessionIfAny,
    commit,
    undo,
    redo,

    // projects
    loadProjects,
    saveCurrentAsProject,
    loadProjectById,
    deleteProjectById,
  };
}
