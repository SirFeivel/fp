// src/main.js
import "./style.css";
import { computePlanMetrics, getRoomPricing } from "./calc.js";
import { isInlineEditing } from "./ui_state.js";
import { validateState } from "./validation.js";
import { LS_SESSION, defaultState, deepClone, getCurrentRoom, getCurrentFloor, uuid, getDefaultPricing, getDefaultTilePresetTemplate, DEFAULT_SKIRTING_PRESET } from "./core.js";
import { createStateStore } from "./state.js";
import { createExclusionDragController, createRoomDragController, createRoomResizeController, createPolygonVertexDragController, createDoorwayDragController } from "./drag.js";
import { createExclusionsController } from "./exclusions.js";
import { bindUI } from "./ui.js";
import { t, setLanguage, getLanguage } from "./i18n.js";
import { initMainTabs } from "./tabs.js";
import { initFullscreen } from "./fullscreen.js";
import polygonClipping from "polygon-clipping";
import { getRoomBounds, roomPolygon, computeAvailableArea, tilesForPreview } from "./geometry.js";
import { getRoomAbsoluteBounds, findPositionOnFreeEdge, validateFloorConnectivity, subtractOverlappingAreas } from "./floor_geometry.js";
import { getWallForEdge, getWallsForRoom, findWallByDoorwayId, syncFloorWalls, getWallNormal, wallSurfaceToTileableRegion, computeWallExtensions } from "./walls.js";
import { wireQuickViewToggleHandlers, syncQuickViewToggleStates } from "./quick_view_toggles.js";
import { createZoomPanController } from "./zoom-pan.js";
import { getViewport } from "./viewport.js";
import { exportRoomsPdf, exportCommercialPdf, exportCommercialXlsx } from "./export.js";
import { createBackgroundController } from "./background.js";
import { createPolygonDrawController } from "./polygon-draw.js";
import { EPSILON, DEFAULT_WALL_THICKNESS_CM, DEFAULT_WALL_HEIGHT_CM } from "./constants.js";
import { createSurface } from "./surface.js";
import { createThreeViewController } from "./three-view.js";

import {
  renderWarnings,
  renderMetrics,
  renderStateView,
  renderCounts,
  renderRoomForm,
  renderTilePatternForm,
  renderExclList,
  renderExclProps,
  renderSkirtingRoomList,
  renderPlanSvg,
  renderFloorCanvas,
  renderPatternGroupsCanvas,
  renderTilePresets,
  renderSkirtingPresets,
  renderCommercialTab,
  renderExportTab
} from "./render.js";
import { createStructureController } from "./structure.js";
import { createRemovalController } from "./removal.js";
import { enforceCutoutForPresetRooms } from "./skirting_rules.js";
import {
  getRoomPatternGroup,
  createPatternGroup,
  addRoomToPatternGroup,
  removeRoomFromPatternGroup,
  dissolvePatternGroup,
  changePatternGroupOrigin,
  canJoinPatternGroup,
  getDisconnectedRoomsOnRemoval,
  isPatternGroupChild,
  getEffectiveTileSettings,
  computePatternGroupOrigin
} from "./pattern-groups.js";
import { showConfirm, showAlert, showPrompt, showSelect, showDoorwayEditor, showSurfaceEditor } from "./dialog.js";

// Store
const store = createStateStore(defaultState, validateState);
window.__fpStore = store; // keep for console testing

let selectedExclId = null;
let selectedTilePresetId = null;
let selectedSkirtingPresetId = null;
let lastUnionError = null;
let lastTileError = null;
let lastExclDragAt = 0;
let selectedWallEdge = null;
let selectedDoorwayId = null;
const exportSelection = new Set();
let threeViewController = null;

function updateMeta() {
  const last = store.getLastSavedAt();
  document.getElementById("lastSaved").textContent = last ? last : "–";
  document.getElementById("sessionStatus").textContent = localStorage.getItem(LS_SESSION)
    ? t("session.present")
    : "–";
}

function refreshProjectSelect() {
  const sel = document.getElementById("projectSelect");
  const projects = store.loadProjects();
  sel.innerHTML = "";

  if (projects.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = t("project.none");
    sel.appendChild(opt);
    sel.disabled = true;
    return;
  }
  sel.disabled = false;

  for (const p of projects) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = `${p.name} (updated: ${p.updatedAt})`;
    sel.appendChild(opt);
  }
}

function setSelectedExcl(id) {
  const newId = id || null;
  const changed = selectedExclId !== newId;
  selectedExclId = newId;
  if (changed) renderAll();
  updateRoomDeleteButtonState();
}
function setSelectedId(id) {
  selectedExclId = id || null;
}

function setSelectedWallEdge(idx) {
  selectedWallEdge = idx;
  selectedDoorwayId = null;
  updateDoorButtonState();
  updateRoomDeleteButtonState();
  renderAll();
}

function setSelectedDoorway(id) {
  selectedDoorwayId = id || null;
  updateRoomDeleteButtonState();
  renderAll();
}

function updateDoorButtonState() {
  const btn = document.getElementById("quickAddDoorway");
  if (!btn) return;
  const state = store.getState();
  const room = getCurrentRoom(state);
  const planningMode = state.view?.planningMode || "room";
  btn.disabled = !(selectedWallEdge !== null && planningMode === "room" && room && !isCircleRoom(room));
}

function isCircleRoom(room) {
  return room?.circle && room.circle.rx > 0;
}

function addDoorwayToWall(edgeIndex) {
  const state = store.getState();
  const next = structuredClone(state);
  const room = getCurrentRoom(next);
  if (!room) return;
  const nextFloor = getCurrentFloor(next);
  if (!nextFloor) return;

  const wall = getWallForEdge(nextFloor, room.id, edgeIndex);
  if (!wall) return;

  const hStart = wall.heightStartCm ?? DEFAULT_WALL_HEIGHT_CM;
  const hEnd = wall.heightEndCm ?? DEFAULT_WALL_HEIGHT_CM;
  const minWallH = Math.min(hStart, hEnd);

  const verts = room.polygonVertices;
  if (!verts || edgeIndex < 0 || edgeIndex >= verts.length) return;
  const A = verts[edgeIndex];
  const B = verts[(edgeIndex + 1) % verts.length];
  const edgeLength = Math.hypot(B.x - A.x, B.y - A.y);

  const dwElevation = 0;
  const preferredWidth = 101;
  const preferredHeight = Math.min(211, Math.max(0, minWallH - 10));

  const allEdgeDoorways = wall.doorways || [];

  const vOverlapping = allEdgeDoorways.filter(sib => {
    return dwElevation < (sib.elevationCm ?? 0) + sib.heightCm &&
      dwElevation + preferredHeight > (sib.elevationCm ?? 0);
  });
  const sorted = vOverlapping.slice().sort((a, b) => a.offsetCm - b.offsetCm);

  const MIN_DW = 20;
  const gaps = [];
  let cursor = 0;
  for (const sib of sorted) {
    const gap = sib.offsetCm - cursor;
    if (gap >= MIN_DW) gaps.push({ start: cursor, size: gap });
    cursor = Math.max(cursor, sib.offsetCm + sib.widthCm);
  }
  const tailGap = edgeLength - cursor;
  if (tailGap >= MIN_DW) gaps.push({ start: cursor, size: tailGap });

  if (gaps.length === 0 || preferredHeight < MIN_DW) {
    showAlert(t("edge.doorwayNoSpace"));
    return;
  }

  const edgeCenter = edgeLength / 2;
  let bestGap = gaps[0];
  let bestDist = Math.abs(bestGap.start + bestGap.size / 2 - edgeCenter);
  for (let i = 1; i < gaps.length; i++) {
    const dist = Math.abs(gaps[i].start + gaps[i].size / 2 - edgeCenter);
    if (dist < bestDist) { bestDist = dist; bestGap = gaps[i]; }
  }

  const dwWidth = Math.max(MIN_DW, Math.min(preferredWidth, bestGap.size - 10));
  const dwHeight = preferredHeight;
  const offsetCm = bestGap.start + (bestGap.size - dwWidth) / 2;

  const newDw = {
    id: crypto?.randomUUID?.() || String(Date.now()),
    offsetCm,
    widthCm: dwWidth,
    heightCm: Math.max(MIN_DW, dwHeight),
    elevationCm: dwElevation
  };
  wall.doorways.push(newDw);
  selectedDoorwayId = newDw.id;
  store.commit(t("edge.doorwayChanged"), next, { onRender: renderAll, updateMetaCb: updateMeta });
}

function deleteDoorway(doorwayId) {
  const state = store.getState();
  const next = structuredClone(state);
  const nextFloor = getCurrentFloor(next);
  if (!nextFloor) return;

  const result = findWallByDoorwayId(nextFloor, doorwayId);
  if (!result) return;
  result.wall.doorways = result.wall.doorways.filter(d => d.id !== doorwayId);
  selectedDoorwayId = null;
  store.commit(t("edge.removeDoorway"), next, { onRender: renderAll, updateMetaCb: updateMeta });
}

async function showDoorwayEditorDialog(doorwayId, edgeIndex) {
  const state = store.getState();
  const floor = getCurrentFloor(state);
  const room = getCurrentRoom(state);
  if (!floor || !room) return;

  const wallResult = findWallByDoorwayId(floor, doorwayId);
  if (!wallResult) return;
  const { wall, doorway: dw } = wallResult;

  // Compute edge length from wall endpoints
  const edgeLength = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
  const heightStartCm = wall.heightStartCm ?? DEFAULT_WALL_HEIGHT_CM;
  const heightEndCm = wall.heightEndCm ?? DEFAULT_WALL_HEIGHT_CM;

  const siblings = (wall.doorways || []).filter(d => d.id !== doorwayId);

  const result = await showDoorwayEditor({
    title: t("edge.doorway"),
    doorway: dw,
    edgeLength,
    heightStartCm,
    heightEndCm,
    siblings,
    confirmText: t("dialog.confirm") || "Confirm",
    cancelText: t("dialog.cancel") || "Cancel"
  });

  if (!result) return;

  const next = structuredClone(store.getState());
  const nextFloor = getCurrentFloor(next);
  if (!nextFloor) return;
  const nextWallResult = findWallByDoorwayId(nextFloor, doorwayId);
  if (!nextWallResult) return;
  const nextDw = nextWallResult.doorway;

  nextDw.widthCm = result.widthCm;
  nextDw.heightCm = result.heightCm;
  nextDw.elevationCm = result.elevationCm;
  nextDw.offsetCm = result.offsetCm;

  store.commit(t("edge.doorwayChanged"), next, { onRender: renderAll, updateMetaCb: updateMeta });
}

// Track target pattern group for "Add to Group" action
// Set when clicking on a room that belongs to a group
let activeTargetGroupId = null;

// Hook for post-render sync (set by IIFE below)
let afterRenderHook = null;

const RenderScope = {
  SETUP: "setup",
  PLANNING: "planning",
  COMMERCIAL: "commercial",
  EXPORT: "export",
  PLAN_AND_COMMERCIAL: "plan_and_commercial",
  ALL: "all"
};

function resolveRenderScope(label, opts) {
  if (opts?.scope) return opts.scope;
  if (!label) return RenderScope.ALL;
  if (label.startsWith("Undo:") || label.startsWith("Redo:")) return RenderScope.ALL;
  if (label.startsWith("Update Material:")) return RenderScope.COMMERCIAL;

  const planCommercial = new Set([
    t("tile.changed"),
    t("tile.patternChanged"),
    t("tile.offsetChanged"),
    t("tile.presetChanged"),
    t("skirting.changed"),
    t("removal.modeToggled"),
    t("removal.tileToggled"),
    t("removal.skirtToggled"),
    t("exclusions.added"),
    t("exclusions.deleted"),
    t("exclusions.changed"),
    t("exclusions.moved"),
    t("waste.changed"),
    t("waste.optimizeChanged")
  ]);

  const setupAll = new Set([
    t("structure.floorAdded"),
    t("structure.floorDeleted"),
    t("structure.floorChanged"),
    t("structure.roomAdded"),
    t("structure.roomDeleted"),
    t("room.changed"),
    t("session.reset"),
    t("project.loaded")
  ]);

  const planningOnly = new Set([
    t("room.viewChanged")
  ]);

  const exportOnly = new Set([
    t("export.selectionChanged")
  ]);

  if (planCommercial.has(label)) return RenderScope.PLAN_AND_COMMERCIAL;
  if (planningOnly.has(label)) return RenderScope.PLANNING;
  if (exportOnly.has(label)) return RenderScope.EXPORT;
  if (setupAll.has(label)) return RenderScope.ALL;
  return RenderScope.ALL;
}

function renderSetupSection(state) {
  const projectNameEl = document.getElementById("projectName");
  if (projectNameEl) {
    projectNameEl.value = state.project?.name ?? "";
  }
  refreshProjectSelect();
  structure.renderFloorSelect();
  structure.renderFloorName();
  structure.renderRoomSelect();
  structure.renderWallSelect();
}

/**
 * Compute rectangular floor patches for ground-level doorways on walls owned by this room.
 * Returns array of vertex arrays in room-local coordinates, each representing a rectangle
 * extending outward through the doorway opening by the wall thickness.
 */
function computeDoorwayFloorPatches(room, floor) {
  if (!floor?.walls?.length || !room?.polygonVertices?.length) return [];
  const patches = [];
  const verts = room.polygonVertices;
  const n = verts.length;

  for (const wall of floor.walls) {
    if (wall.roomEdge?.roomId !== room.id) continue;
    if (!wall.doorways?.length) continue;

    const edgeIndex = wall.roomEdge.edgeIndex;
    const start = verts[edgeIndex];
    const end = verts[(edgeIndex + 1) % n];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) continue;

    const dirX = dx / len;
    const dirY = dy / len;
    const normal = getWallNormal(wall, floor);
    const thick = wall.thicknessCm ?? DEFAULT_WALL_THICKNESS_CM;

    for (const dw of wall.doorways) {
      if ((dw.elevationCm || 0) > 0.1) continue;
      const off = dw.offsetCm;
      const w = dw.widthCm;
      patches.push([
        { x: start.x + off * dirX,       y: start.y + off * dirY },
        { x: start.x + (off + w) * dirX, y: start.y + (off + w) * dirY },
        { x: start.x + (off + w) * dirX + thick * normal.x, y: start.y + (off + w) * dirY + thick * normal.y },
        { x: start.x + off * dirX + thick * normal.x,       y: start.y + off * dirY + thick * normal.y },
      ]);
    }
  }
  return patches;
}

function prepareRoom3DData(state, room, floor) {
  const avail = computeAvailableArea(room, room.exclusions || []);
  const effectiveSettings = getEffectiveTileSettings(room, floor);
  const isRemovalMode = Boolean(state.view?.removalMode);
  let tileResult = null;
  let groutColor = effectiveSettings.grout?.colorHex || "#ffffff";

  // Compute doorway floor patches (room-local coords)
  const doorwayFloorPatches = computeDoorwayFloorPatches(room, floor);

  if (avail.mp) {
    // Extend available area through doorway openings for continuous floor tiles
    let mp = avail.mp;
    for (const patch of doorwayFloorPatches) {
      const ring = patch.map(p => [p.x, p.y]);
      ring.push([patch[0].x, patch[0].y]); // close ring
      try {
        mp = polygonClipping.union(mp, [[ring]]);
      } catch (_) { /* ignore degenerate patches */ }
    }

    const origin = computePatternGroupOrigin(room, floor);
    tileResult = tilesForPreview(state, mp, room, isRemovalMode, floor, {
      originOverride: origin,
      effectiveSettings
    });
    groutColor = effectiveSettings.grout?.colorHex || "#ffffff";
  }

  return {
    id: room.id,
    polygonVertices: room.polygonVertices,
    floorPosition: room.floorPosition || { x: 0, y: 0 },
    floorTiles: tileResult?.tiles || [],
    floorExclusions: room.exclusions || [],
    groutColor,
    doorwayFloorPatches,
  };
}

function prepareFloorWallData(state, floor) {
  if (!floor?.walls?.length) {
    return [];
  }
  const isRemovalMode = Boolean(state.view?.removalMode);

  // Compute angle-aware extensions per room (cached)
  const extCache = new Map();
  function getExtensions(roomId) {
    if (!extCache.has(roomId)) extCache.set(roomId, computeWallExtensions(floor, roomId));
    return extCache.get(roomId);
  }

  return floor.walls.map(wall => {
    const normal = getWallNormal(wall, floor);
    const thick = wall.thicknessCm ?? DEFAULT_WALL_THICKNESS_CM;
    const hStart = wall.heightStartCm ?? DEFAULT_WALL_HEIGHT_CM;
    const hEnd = wall.heightEndCm ?? DEFAULT_WALL_HEIGHT_CM;
    const dx = wall.end.x - wall.start.x;
    const dy = wall.end.y - wall.start.y;
    const edgeLength = Math.hypot(dx, dy);
    if (edgeLength < 1) return null;

    // Angle-aware corner extensions
    const dirX = dx / edgeLength;
    const dirY = dy / edgeLength;
    const re = wall.roomEdge;
    const wallExt = re ? (getExtensions(re.roomId).get(re.edgeIndex) ?? { extStart: thick, extEnd: thick })
                       : { extStart: thick, extEnd: thick };
    const extS = wallExt.extStart, extE = wallExt.extEnd;
    const extStart = { x: wall.start.x - dirX * extS, y: wall.start.y - dirY * extS };
    const extEnd = { x: wall.end.x + dirX * extE, y: wall.end.y + dirY * extE };
    const outerStart = { x: extStart.x + normal.x * thick, y: extStart.y + normal.y * thick };
    const outerEnd = { x: extEnd.x + normal.x * thick, y: extEnd.y + normal.y * thick };

    const surfaces = wall.surfaces.map((surface, idx) => {
      const region = wallSurfaceToTileableRegion(wall, idx);
      if (!region) return null;

      let tiles = [];
      // Only compute tiles if surface has tiling configured (not null)
      if (surface.tile) {
        const avail = computeAvailableArea(region, region.exclusions || []);
        if (avail.mp) {
          const result = tilesForPreview(state, avail.mp, region, isRemovalMode, floor, {
            effectiveSettings: { tile: region.tile, grout: region.grout, pattern: region.pattern },
          });
          tiles = result?.tiles || [];
        }
      }

      const surfFromCm = surface.fromCm || 0;
      const surfToCm = surface.toCm || edgeLength;
      const tStart = edgeLength > 0 ? surfFromCm / edgeLength : 0;
      const tEnd = edgeLength > 0 ? surfToCm / edgeLength : 1;
      const surfHStart = hStart + (hEnd - hStart) * tStart;
      const surfHEnd = hStart + (hEnd - hStart) * tEnd;

      // Fraction along the extended wall where this surface sits
      const totalLen = edgeLength + extS + extE;
      const fromFrac = totalLen > 0 ? (surfFromCm + extS) / totalLen : 0;
      const toFrac = totalLen > 0 ? (surfToCm + extS) / totalLen : 1;

      return {
        roomId: surface.roomId,
        edgeIndex: surface.edgeIndex,
        tiles,
        exclusions: region.exclusions || [],
        surfaceVerts: region.polygonVertices,
        hStart: surfHStart,
        hEnd: surfHEnd,
        groutColor: region.grout?.colorHex || "#ffffff",
        fromFrac,
        toFrac,
      };
    }).filter(Boolean);

    return {
      id: wall.id,
      start: extStart,
      end: extEnd,
      outerStart,
      outerEnd,
      edgeLength: edgeLength + extS + extE,
      hStart,
      hEnd,
      thicknessCm: thick,
      doorways: (wall.doorways || []).map(dw => ({ ...dw, offsetCm: dw.offsetCm + extS })),
      roomEdge: wall.roomEdge,
      surfaces,
    };
  }).filter(Boolean);
}

async function showSurfaceEditorDialog(wallId) {
  const state = store.getState();
  const floor = getCurrentFloor(state);
  if (!floor) return;

  const wall = floor.walls?.find(w => w.id === wallId);
  if (!wall || !wall.surfaces || wall.surfaces.length === 0) return;

  // For now, edit the first surface (owner surface)
  const surface = wall.surfaces[0];

  const result = await showSurfaceEditor({
    title: t("surface.editSurface") || "Edit Surface Tiling",
    wall: {
      thicknessCm: wall.thicknessCm,
      heightStartCm: wall.heightStartCm,
      heightEndCm: wall.heightEndCm
    },
    tile: surface.tile,
    grout: surface.grout,
    pattern: surface.pattern
  });

  if (result === null) return; // Cancelled

  const next = deepClone(state);
  const nextFloor = next.floors.find(f => f.id === floor.id);
  const nextWall = nextFloor?.walls?.find(w => w.id === wallId);
  if (!nextWall || !nextWall.surfaces || nextWall.surfaces.length === 0) return;

  // Check if wall properties changed
  const wallChanged =
    result.wall.thicknessCm !== wall.thicknessCm ||
    result.wall.heightStartCm !== wall.heightStartCm ||
    result.wall.heightEndCm !== wall.heightEndCm;

  // Update wall configuration (applies to entire wall)
  nextWall.thicknessCm = result.wall.thicknessCm;
  nextWall.heightStartCm = result.wall.heightStartCm;
  nextWall.heightEndCm = result.wall.heightEndCm;

  // Update surface configuration (applies to this surface only)
  nextWall.surfaces[0].tile = result.tile;
  nextWall.surfaces[0].grout = result.grout;
  nextWall.surfaces[0].pattern = result.pattern;

  // Use appropriate commit message based on what changed
  const commitMsg = wallChanged
    ? t("wall.configChanged") || "Wall configuration changed"
    : t("surface.tilingChanged") || "Surface tiling changed";

  store.commit(commitMsg, next, {
    onRender: renderAll,
    updateMetaCb: updateMeta
  });
}

function handleWallDoubleClick(roomId, edgeIndex) {
  const state = store.getState();
  const floor = getCurrentFloor(state);
  if (!floor) return;

  const wall = getWallForEdge(floor, roomId, edgeIndex);
  if (!wall) return;

  // Open surface editor modal
  showSurfaceEditorDialog(wall.id);
}

function renderPlanningSection(state, opts) {
  const isDrag = opts?.mode === "drag";
  const planningMode = state.view?.planningMode || "room";
  const isFloorView = planningMode === "floor";
  const isPatternGroupsView = planningMode === "patternGroups";

  // Always render room-related UI (forms, lists) even in floor view
  renderRoomForm(state);
  renderTilePatternForm(state);

  renderTilePresets(state, selectedTilePresetId, (id) => { selectedTilePresetId = id; });
  renderSkirtingPresets(state, selectedSkirtingPresetId, (id) => { selectedSkirtingPresetId = id; });
  renderSkirtingRoomList(state, {
    onToggleRoom: setRoomSkirtingEnabledById
  });
  renderExclList(state, selectedExclId);
  renderExclProps({
    state,
    selectedExclId,
    getSelectedExcl: excl.getSelectedExcl,
    commitExclProps: excl.commitExclProps
  });

  renderWarnings(state, validateState);
  if (!isDrag) renderMetrics(state);

  // Derive effective 3D mode from orthogonal toggle
  const use3D = state.view?.use3D || false;
  const is3DEffective = use3D && !isPatternGroupsView;

  // Render either 3D, floor canvas, or room canvas based on view mode
  if (is3DEffective) {
    // 3D view — works for both floor and room level
    if (!threeViewController) {
      threeViewController = createThreeViewController({
        canvas: document.getElementById("threeDCanvas"),
        onWallDoubleClick: ({ edgeIndex, roomId }) => handleWallDoubleClick(roomId, edgeIndex),
        onRoomDoubleClick: ({ roomId }) => {
          const s = store.getState();
          if (s.view?.planningMode === "floor") {
            // Floor 3D: drill down to room level (stay in 3D)
            const next = deepClone(s);
            next.selectedRoomId = roomId;
            next.view.planningMode = "room";
            store.commit("Room selected", next, { onRender: renderAll, updateMetaCb: updateMeta });
          } else {
            // Room 3D: double-click floor → open in 2D
            const next = deepClone(s);
            next.selectedRoomId = roomId;
            next.view = next.view || {};
            next.view.use3D = false;
            store.commit("Floor surface opened", next, { onRender: renderAll, updateMetaCb: updateMeta });
          }
        },
        onHoverChange: (info) => {
          const el = document.getElementById("threeDHoverInfo");
          if (el) el.textContent = info ? info.label : "";
        },
        onSurfaceSelect: ({ roomId, edgeIndex }) => {
          // Single-click on wall/floor in 3D → select that surface
          const current = store.getState();
          const floor = getCurrentFloor(current);
          if (!floor) return;
          if (edgeIndex != null) {
            const wall = getWallForEdge(floor, roomId, edgeIndex);
            if (wall && current.selectedWallId !== wall.id) {
              const next = deepClone(current);
              next.selectedRoomId = roomId;
              next.selectedWallId = wall.id;
              store.commit("Surface selected", next, { onRender: renderAll, updateMetaCb: updateMeta });
            }
          } else {
            // Floor surface — select the room itself
            if (current.selectedRoomId !== roomId) {
              const next = deepClone(current);
              next.selectedRoomId = roomId;
              next.selectedWallId = null;
              store.commit("Surface selected", next, { onRender: renderAll, updateMetaCb: updateMeta });
            }
          }
        },
        onRoomSelect: ({ roomId }) => {
          const current = store.getState();
          if (current.selectedRoomId === roomId) return;
          const next = deepClone(current);
          next.selectedRoomId = roomId;
          store.commit(t("room.selected") || "Room selected", next, { onRender: renderAll, updateMetaCb: updateMeta });
        }
      });
    }
    const floor = getCurrentFloor(state);
    if (floor) {
      threeViewController.start();
      const wallDescs = prepareFloorWallData(state, floor);
      const showWalls = state.view?.showWalls3D !== false;
      if (isFloorView) {
        // Floor 3D: all rooms
        const floorRooms = floor.rooms.filter(r => r.polygonVertices?.length >= 3);
        const descriptors = floorRooms.map(room => prepareRoom3DData(state, room, floor));
        threeViewController.buildScene({ rooms: descriptors, walls: wallDescs, showWalls, selectedRoomId: state.selectedRoomId });
      } else {
        // Room 3D: single selected room
        let room = getCurrentRoom(state);
        let selectedSurfaceEdgeIndex = null;
        // If a wall is selected, find the edge index for highlighting
        if (state.selectedWallId) {
          const selWall = floor.walls?.find(w => w.id === state.selectedWallId);
          if (selWall?.roomEdge?.roomId === room?.id) {
            selectedSurfaceEdgeIndex = selWall.roomEdge.edgeIndex;
          }
        }
        if (room && room.polygonVertices?.length >= 3) {
          const descriptor = prepareRoom3DData(state, room, floor);
          // Only include walls that have a surface for the selected room
          const roomWallDescs = wallDescs.filter(wd =>
            wd.surfaces.some(s => s.roomId === room.id)
          );
          threeViewController.buildScene({
            rooms: [descriptor],
            walls: roomWallDescs,
            showWalls,
            selectedRoomId: room.id,
            selectedSurfaceEdgeIndex,
          });
        }
      }
    }
  } else if (isFloorView) {
    const floor = getCurrentFloor(state);
    renderFloorCanvas({
      state,
      floor,
      selectedRoomId: state.selectedRoomId,
      onRoomClick: (roomId) => {
        // Select room in floor view
        const next = deepClone(store.getState());
        next.selectedRoomId = roomId;
        store.commit(t("room.selected") || "Room selected", next, { onRender: renderAll, updateMetaCb: updateMeta });
      },
      onRoomDoubleClick: (roomId) => {
        // Select the room first, then switch to room view with validation
        const currentState = store.getState();
        if (currentState.selectedRoomId !== roomId) {
          const next = deepClone(currentState);
          next.selectedRoomId = roomId;
          store.commit(t("room.selected") || "Room selected", next, { onRender: renderAll, updateMetaCb: updateMeta });
        }
        // Use switchToRoomView which includes connectivity validation
        switchToRoomView();
      },
      onRoomPointerDown: (e, roomId) => roomDragController.onRoomPointerDown(e, roomId),
      onRoomResizePointerDown: (e, roomId, handleType) => roomResizeController.onRoomResizePointerDown(e, roomId, handleType),
      onRoomInlineEdit: ({ id, key, value }) => {
        const state = store.getState();
        const next = deepClone(state);
        const floor = next.floors?.find(f => f.id === next.selectedFloorId);
        const room = floor?.rooms?.find(r => r.id === id);
        if (!room) return;

        const numVal = parseFloat(value);
        if (!Number.isFinite(numVal) || numVal < 1) return;

        // Update circle/ellipse room
        if (room.circle && room.circle.rx > 0) {
          const rx = key === "widthCm" ? numVal / 2 : room.circle.rx;
          const ry = key === "heightCm" ? numVal / 2 : room.circle.ry;
          room.circle = { cx: rx, cy: ry, rx, ry };
          room.widthCm = 2 * rx;
          room.heightCm = 2 * ry;
        }
        // Update polygonVertices for rectangular room
        else if (room.polygonVertices?.length === 4) {
          const bounds = getRoomBounds(room);
          const newW = key === "widthCm" ? numVal : bounds.width;
          const newH = key === "heightCm" ? numVal : bounds.height;
          room.polygonVertices = [
            { x: 0, y: 0 },
            { x: newW, y: 0 },
            { x: newW, y: newH },
            { x: 0, y: newH }
          ];
        }
        // Also update legacy dimensions for compatibility
        if (key === "widthCm") {
          room.widthCm = numVal;
        } else if (key === "heightCm") {
          room.heightCm = numVal;
        }

        store.commit(t("room.sizeChanged") || "Room size changed", next, { onRender: renderAll, updateMetaCb: updateMeta });
      },
      onVertexPointerDown: (e, roomId, vertexIndex) => polygonVertexDragController.onVertexPointerDown(e, roomId, vertexIndex),
      onRoomNameEdit: ({ id, name }) => {
        const state = store.getState();
        const next = deepClone(state);
        const floor = next.floors?.find(f => f.id === next.selectedFloorId);
        const room = floor?.rooms?.find(r => r.id === id);
        if (!room) return;

        room.name = name;

        // Wall names are derived from room + edge index, no update needed

        store.commit(t("room.nameChanged") || "Room name changed", next, { onRender: renderAll, updateMetaCb: updateMeta });
      },
      onPolygonEdgeEdit: ({ id, edgeIndex, length }) => {
        const state = store.getState();
        const next = deepClone(state);
        const floor = next.floors?.find(f => f.id === next.selectedFloorId);
        const room = floor?.rooms?.find(r => r.id === id);
        if (!room || !room.polygonVertices) return;

        const vertices = room.polygonVertices;
        const v1 = vertices[edgeIndex];
        const v2 = vertices[(edgeIndex + 1) % vertices.length];

        // Calculate current edge vector
        const dx = v2.x - v1.x;
        const dy = v2.y - v1.y;
        const currentLength = Math.hypot(dx, dy);
        if (currentLength < 0.01) return;

        // Scale factor to achieve new length
        const scale = length / currentLength;

        // Move v2 to achieve new length (keep v1 fixed)
        v2.x = v1.x + dx * scale;
        v2.y = v1.y + dy * scale;

        // Normalize vertices (ensure bounding box starts at 0,0)
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;
        for (const v of vertices) {
          minX = Math.min(minX, v.x);
          minY = Math.min(minY, v.y);
          maxX = Math.max(maxX, v.x);
          maxY = Math.max(maxY, v.y);
        }

        if (minX !== 0 || minY !== 0) {
          room.floorPosition = room.floorPosition || { x: 0, y: 0 };
          room.floorPosition.x += minX;
          room.floorPosition.y += minY;
          for (const v of vertices) {
            v.x -= minX;
            v.y -= minY;
          }
          maxX -= minX;
          maxY -= minY;
        }

        room.widthCm = Math.round(maxX);
        room.heightCm = Math.round(maxY);

        // Sync walls after edge length change
        syncFloorWalls(floor);

        store.commit(t("room.edgeChanged") || "Edge length changed", next, { onRender: renderAll, updateMetaCb: updateMeta });
      }
    });
  } else if (isPatternGroupsView) {
    // Pattern Groups view - similar to floor view but with group visualization
    const floor = getCurrentFloor(state);
    renderPatternGroupsCanvas({
      state,
      floor,
      selectedRoomId: state.selectedRoomId,
      activeGroupId: activeTargetGroupId,
      onRoomClick: (roomId) => {
        const next = deepClone(store.getState());
        next.selectedRoomId = roomId;

        // Auto-select the group if the clicked room belongs to one
        const currentFloor = getCurrentFloor(next);
        if (currentFloor?.patternGroups) {
          const groupContainingRoom = currentFloor.patternGroups.find(
            g => g.memberRoomIds.includes(roomId)
          );
          if (groupContainingRoom) {
            activeTargetGroupId = groupContainingRoom.id;
          }
        }

        store.commit(t("room.selected") || "Room selected", next, { onRender: renderAll, updateMetaCb: updateMeta });
        updatePatternGroupsControlsState();
      },
      onRoomDoubleClick: (roomId) => {
        // Double-click opens room in Room View
        const currentState = store.getState();
        if (currentState.selectedRoomId !== roomId) {
          const next = deepClone(currentState);
          next.selectedRoomId = roomId;
          store.commit(t("room.selected") || "Room selected", next, { onRender: renderAll, updateMetaCb: updateMeta });
        }
        switchToRoomView();
      }
    });
    updatePatternGroupsControlsState();
  } else {
    const metrics = isDrag ? null : computePlanMetrics(state);

    renderPlanSvg({
      state,
      selectedExclId,
      setSelectedExcl,
      onExclPointerDown: dragController.onExclPointerDown,
      onInlineEdit: updateExclusionInline,
      onResizeHandlePointerDown: dragController.onResizeHandlePointerDown,
      lastUnionError,
      lastTileError,
      setLastUnionError: (v) => (lastUnionError = v),
      setLastTileError: (v) => (lastTileError = v),
      metrics,
      skipTiles: isDrag,
      selectedWallEdge,
      selectedDoorwayId,
      onWallClick: (edgeIndex) => {
        selectedExclId = null;
        setSelectedWallEdge(edgeIndex);
      },
      onWallDoubleClick: (edgeIndex) => {
        const room = getCurrentRoom(state);
        const floor = getCurrentFloor(state);
        if (!room || !floor) return;
        const wall = getWallForEdge(floor, room.id, edgeIndex);
        if (wall) showSurfaceEditorDialog(wall.id);
      },
      onDoorwayPointerDown: doorwayDragController.onDoorwayPointerDown,
      onDoorwayResizePointerDown: doorwayDragController.onDoorwayResizePointerDown
    });
  }
  updateDoorButtonState();
}

function getExportOptionsFromUi() {
  return {
    roomIds: Array.from(exportSelection),
    pageSize: document.getElementById("exportPageSize")?.value || "A4",
    orientation: document.getElementById("exportOrientation")?.value || "portrait",
    scale: document.getElementById("exportScale")?.value || "fit",
    includeGrid: Boolean(document.getElementById("exportIncludeGrid")?.checked),
    includeSkirting: Boolean(document.getElementById("exportIncludeSkirting")?.checked),
    includeExclusions: Boolean(document.getElementById("exportIncludeExclusions")?.checked),
    includeLegend: Boolean(document.getElementById("exportIncludeLegend")?.checked),
    includeMetrics: Boolean(document.getElementById("exportIncludeMetrics")?.checked),
    notes: document.getElementById("exportNotes")?.value || ""
  };
}

function setExportStatus(message, isError = false) {
  const status = document.getElementById("exportStatus");
  if (!status) return;
  status.textContent = message || "–";
  status.style.color = isError ? "#ff6b6b" : "";
}

function setExportProgress(current, total) {
  const fill = document.getElementById("exportProgressFill");
  if (!fill || !total) return;
  const pct = Math.min(100, Math.round((current / total) * 100));
  fill.style.width = `${pct}%`;
}

function toggleExportProgress(show) {
  const wrap = document.getElementById("exportProgress");
  if (!wrap) return;
  wrap.classList.toggle("hidden", !show);
  if (!show) setExportProgress(0, 1);
}

function renderExportSection(state) {
  if (!renderExportSection.hasInitialized) {
    if (exportSelection.size === 0) {
      for (const floor of state.floors || []) {
        for (const room of floor.rooms || []) {
          exportSelection.add(room.id);
        }
      }
    }
    renderExportSection.hasInitialized = true;
  }
  renderExportTab(state, exportSelection);
}

function renderCommercialSection(state) {
  renderCommercialTab(state);
}

function renderCommon(state, label) {
  renderStateView(state);
  renderCounts(store.getUndoStack(), store.getRedoStack(), label);
  refreshProjectSelect();
  updateMeta();
  if (afterRenderHook) afterRenderHook();
}

function renderByScope(state, scope, label, opts) {
  switch (scope) {
    case RenderScope.SETUP:
      renderSetupSection(state);
      break;
    case RenderScope.PLANNING:
      renderPlanningSection(state, opts);
      break;
    case RenderScope.COMMERCIAL:
      renderCommercialSection(state);
      break;
    case RenderScope.EXPORT:
      renderExportSection(state);
      break;
    case RenderScope.PLAN_AND_COMMERCIAL:
      renderPlanningSection(state, opts);
      renderCommercialSection(state);
      break;
    case RenderScope.ALL:
    default:
      renderSetupSection(state);
      renderPlanningSection(state, opts);
      renderCommercialSection(state);
      renderExportSection(state);
      break;
  }
  renderCommon(state, label);
}

function renderAll(lastLabel, options) {
  let opts = options || {};
  let label = lastLabel;
  if (lastLabel && typeof lastLabel === "object") {
    opts = lastLabel;
    label = undefined;
  }
  const scope = resolveRenderScope(label, opts);

  try {
    const state = store.getState();
    renderByScope(state, scope, label, opts);
  } catch (error) {
    console.error("Render failed:", error);
    const errorDiv = document.getElementById("warnings");
    if (errorDiv) {
      const div = document.createElement("div");
      div.className = "warnItem";
      div.style.border = "2px solid rgba(255,107,107,0.5)";
      const title = document.createElement("div");
      title.className = "wTitle";
      title.textContent = t("errors.renderFailed");
      const text = document.createElement("div");
      text.className = "wText";
      text.textContent = `${t("errors.reloadPage")} ${error.message}`;
      div.replaceChildren(title, text);
      errorDiv.prepend(div);
    }
  }
}

function updateExportSelectionFromList() {
  exportSelection.clear();
  const inputs = document.querySelectorAll("#exportRoomsList input[type=\"checkbox\"][data-room-id]");
  inputs.forEach((input) => {
    if (input.checked) exportSelection.add(input.dataset.roomId);
  });
}

// View toggle functions for Floor/Room/PatternGroups planning modes
function switchToFloorView() {
  const state = store.getState();
  if (state.view?.planningMode === "floor") return; // Already in floor view

  cancelFreeformDrawing(); // Cancel any active freeform drawing
  cancelCalibrationMode(); // Cancel any active calibration
  selectedWallEdge = null;
  selectedDoorwayId = null;
  const next = deepClone(state);
  next.view = next.view || {};
  next.view.planningMode = "floor";
  store.commit(t("view.switchedToFloor"), next, { onRender: renderAll, updateMetaCb: updateMeta });
}

function switchToPatternGroupsView() {
  const state = store.getState();
  if (state.view?.planningMode === "patternGroups") return; // Already in pattern groups view

  cancelFreeformDrawing(); // Cancel any active freeform drawing
  cancelCalibrationMode(); // Cancel any active calibration
  selectedWallEdge = null;
  selectedDoorwayId = null;
  const next = deepClone(state);
  next.view = next.view || {};
  next.view.planningMode = "patternGroups";
  store.commit(t("view.switchedToPatternGroups") || "Switched to Pattern Groups", next, { onRender: renderAll, updateMetaCb: updateMeta });
}

function is3DAvailable(state) {
  const mode = state.view?.planningMode || "room";
  if (mode === "patternGroups") return false;
  return true;
}

function toggle3D() {
  cancelFreeformDrawing();
  cancelCalibrationMode();
  const state = store.getState();
  const next = deepClone(state);
  next.view = next.view || {};
  next.view.use3D = !next.view.use3D;
  store.commit("Toggled 3D view", next, { onRender: renderAll, updateMetaCb: updateMeta });
}

async function switchToRoomView(skipValidation = false) {
  cancelFreeformDrawing(); // Cancel any active freeform drawing
  cancelCalibrationMode(); // Cancel any active calibration
  const state = store.getState();
  if (state.view?.planningMode === "room") {
    return;
  }

  // Validate floor connectivity before leaving floor planner
  if (!skipValidation) {
    const currentFloor = getCurrentFloor(state);
    if (currentFloor && currentFloor.rooms.length > 1) {
      const validation = validateFloorConnectivity(currentFloor);
      if (!validation.valid) {
        // Show warning dialog
        const groupInfo = validation.groupDetails
          .map((g, i) => `  Group ${i + 1}: ${g.roomNames.join(", ")}`)
          .join("\n");

        const message = t("floor.disconnectedRoomsWarning") ||
          `Warning: Some rooms are not connected!\n\n${groupInfo}\n\nRooms must share at least 10cm of wall to be considered connected.\n\nDo you want to continue anyway?`;

        const confirmed = await showConfirm({
          title: t("dialog.disconnectedRoomsTitle") || "Disconnected Rooms",
          message,
          confirmText: t("dialog.continue") || "Continue",
          cancelText: t("dialog.cancel") || "Cancel",
          danger: false
        });

        if (!confirmed) {
          return; // User cancelled, stay in floor view
        }
      }
    }
  }

  const next = deepClone(state);
  next.view = next.view || {};
  next.view.planningMode = "room";
  store.commit(t("view.switchedToRoom"), next, { onRender: renderAll, updateMetaCb: updateMeta });
}

function updateViewToggleUI(state) {
  const planningMode = state.view?.planningMode || "room";
  const use3D = state.view?.use3D || false;
  const threeAvail = is3DAvailable(state);
  const is3D = use3D && threeAvail;

  const floorBtn = document.getElementById("floorViewBtn");
  const patternGroupsBtn = document.getElementById("patternGroupsViewBtn");
  const roomBtn = document.getElementById("roomViewBtn");
  const view2DBtn = document.getElementById("view2DBtn");
  const view3DBtn = document.getElementById("view3DBtn");
  const renderModeToggle = document.getElementById("renderModeToggle");
  const floorControls = document.getElementById("floorQuickControls");
  const patternGroupsControls = document.getElementById("patternGroupsQuickControls");
  const roomControls = document.getElementById("roomQuickControls");
  const threeDControls = document.getElementById("threeDQuickControls");
  const threeDCanvas = document.getElementById("threeDCanvas");
  const planSvg = document.getElementById("planSvg");
  const roomSelectLabel = document.getElementById("roomSelectLabel");
  const wallSelectLabel = document.getElementById("wallSelectLabel");
  const groupSelectLabel = document.getElementById("groupSelectLabel");

  const isFloorView = planningMode === "floor";
  const isPatternGroupsView = planningMode === "patternGroups";
  const isRoomView = !isFloorView && !isPatternGroupsView;

  // Level buttons — active state
  if (floorBtn) floorBtn.classList.toggle("active", isFloorView);
  if (patternGroupsBtn) patternGroupsBtn.classList.toggle("active", isPatternGroupsView);
  if (roomBtn) roomBtn.classList.toggle("active", isRoomView);

  // 2D/3D toggle — active state + availability
  if (view2DBtn) view2DBtn.classList.toggle("active", !is3D);
  if (view3DBtn) view3DBtn.classList.toggle("active", is3D);
  if (view3DBtn) view3DBtn.disabled = !threeAvail;
  if (renderModeToggle) renderModeToggle.style.display = isPatternGroupsView ? "none" : "";

  // SVG vs Canvas visibility
  if (planSvg) planSvg.style.display = is3D ? "none" : "";
  if (threeDCanvas) threeDCanvas.style.display = is3D ? "block" : "none";

  // Quick controls — level-aware
  if (floorControls) floorControls.style.display = isFloorView && !is3D ? "" : "none";
  if (roomControls) roomControls.style.display = isRoomView && !is3D ? "" : "none";
  if (patternGroupsControls) patternGroupsControls.style.display = isPatternGroupsView ? "" : "none";
  if (threeDControls) threeDControls.style.display = is3D ? "" : "none";

  // Wall select only in room mode
  if (wallSelectLabel) wallSelectLabel.style.display = isRoomView ? "" : "none";
  // Room select hidden in pattern groups
  if (roomSelectLabel) roomSelectLabel.style.display = isPatternGroupsView ? "none" : "";
  if (groupSelectLabel) groupSelectLabel.style.display = isPatternGroupsView ? "" : "none";

  if (!is3D && threeViewController?.isActive()) threeViewController.stop();
}

function updateFloorControlsState(state) {
  const deleteBtn = document.getElementById("floorDeleteRoom");

  if (deleteBtn) {
    // Enable delete if a room is selected
    const hasSelection = !!state.selectedRoomId;
    deleteBtn.disabled = !hasSelection;
  }
}

function updateRoomDeleteButtonState() {
  const btn = document.getElementById("roomDeleteObject");
  if (!btn) return;

  // Enable for exclusions or doorways
  btn.disabled = !selectedExclId && !selectedDoorwayId;
}

function initViewToggle() {
  const floorBtn = document.getElementById("floorViewBtn");
  const patternGroupsBtn = document.getElementById("patternGroupsViewBtn");
  const roomBtn = document.getElementById("roomViewBtn");
  const view2DBtn = document.getElementById("view2DBtn");
  const view3DBtn = document.getElementById("view3DBtn");

  floorBtn?.addEventListener("click", () => switchToFloorView());
  patternGroupsBtn?.addEventListener("click", () => switchToPatternGroupsView());
  roomBtn?.addEventListener("click", () => switchToRoomView());
  view2DBtn?.addEventListener("click", () => {
    const s = store.getState();
    if (s.view?.use3D) toggle3D();
  });
  view3DBtn?.addEventListener("click", () => {
    const s = store.getState();
    if (!s.view?.use3D) toggle3D();
  });

  // Initialize UI state from current state
  const state = store.getState();
  updateViewToggleUI(state);
}

// Pattern Groups view controls
function updatePatternGroupsControlsState() {
  const state = store.getState();
  const floor = getCurrentFloor(state);
  const roomId = state.selectedRoomId;
  const room = floor?.rooms?.find(r => r.id === roomId);
  const group = room ? getRoomPatternGroup(floor, roomId) : null;

  const createBtn = document.getElementById("pgCreateGroup");
  const addBtn = document.getElementById("pgAddToGroup");
  const removeBtn = document.getElementById("pgRemoveFromGroup");
  const setOriginBtn = document.getElementById("pgSetOrigin");
  const dissolveBtn = document.getElementById("pgDissolveGroup");
  const statusLabel = document.getElementById("pgStatusLabel");

  // Update button states based on selection and group membership
  const hasRoom = !!room;
  const isInGroup = !!group;
  const isOrigin = isInGroup && group.originRoomId === roomId;

  // Create: enabled if room selected and NOT in any group
  if (createBtn) createBtn.disabled = !hasRoom || isInGroup;

  // Add to group: enabled if room selected, NOT in any group, and can join active target group
  let canAdd = false;
  if (hasRoom && !isInGroup && activeTargetGroupId) {
    canAdd = canJoinPatternGroup(floor, activeTargetGroupId, roomId);
  }
  if (addBtn) addBtn.disabled = !canAdd;

  // Remove: enabled if room is in a group but not the origin (removing origin dissolves group)
  if (removeBtn) removeBtn.disabled = !isInGroup || isOrigin;

  // Set origin: enabled if room is in a group but not already the origin
  if (setOriginBtn) setOriginBtn.disabled = !isInGroup || isOrigin;

  // Dissolve: enabled if room is in a group
  if (dissolveBtn) dissolveBtn.disabled = !isInGroup;

  // Update status label
  if (statusLabel) {
    if (!hasRoom) {
      statusLabel.textContent = t("patternGroups.selectRoom") || "Select a room";
    } else if (!isInGroup) {
      statusLabel.textContent = t("patternGroups.roomIndependent") || "Room is independent";
    } else if (isOrigin) {
      statusLabel.textContent = t("patternGroups.roomIsOrigin") || `Origin room (Group: ${group.memberRoomIds.length} rooms)`;
    } else {
      const originRoom = floor.rooms.find(r => r.id === group.originRoomId);
      statusLabel.textContent = t("patternGroups.roomInGroup") || `In group with ${originRoom?.name || "origin"}`;
    }
  }
}

function initPatternGroupsControls() {
  // Zoom controls for pattern groups view
  document.getElementById("pgZoomIn")?.addEventListener("click", () => {
    zoomPanController.zoomIn();
  });
  document.getElementById("pgZoomOut")?.addEventListener("click", () => {
    zoomPanController.zoomOut();
  });
  document.getElementById("pgZoomReset")?.addEventListener("click", () => {
    zoomPanController.reset();
  });
}

function initBackgroundControls() {
  const bgUpload = document.getElementById("bgUpload");
  const bgUploadBtn = document.getElementById("bgUploadBtn");
  const bgCalibrateBtn = document.getElementById("bgCalibrateBtn");
  const bgOpacitySlider = document.getElementById("bgOpacitySlider");

  // Upload button triggers hidden file input
  bgUploadBtn?.addEventListener("click", () => {
    bgUpload?.click();
  });

  // Handle file selection
  bgUpload?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const success = await backgroundController.handleFileUpload(file);
    if (success) {
      // Enable calibration and opacity controls
      if (bgCalibrateBtn) bgCalibrateBtn.disabled = false;
      if (bgOpacitySlider) bgOpacitySlider.disabled = false;
    }

    // Clear input so same file can be selected again
    e.target.value = "";
  });

  // Calibration panel elements
  const calibrationPanel = document.getElementById("calibrationPanel");
  const calibrationStep = document.getElementById("calibrationStep");
  const calibrationInstruction = document.getElementById("calibrationInstruction");
  const calibrationInputSection = document.getElementById("calibrationInputSection");
  const calibrationLengthInput = document.getElementById("calibrationLengthInput");
  const calibrationMeasurements = document.getElementById("calibrationMeasurements");
  const calibrationSuccess = document.getElementById("calibrationSuccess");
  const calibrationScaleResult = document.getElementById("calibrationScaleResult");
  const btnConfirmCalibrationLength = document.getElementById("btnConfirmCalibrationLength");
  const btnCancelCalibration = document.getElementById("btnCancelCalibration");
  const btnCloseCalibration = document.getElementById("btnCloseCalibration");

  function showCalibrationPanel() {
    calibrationPanel?.classList.remove("hidden");
    calibrationSuccess?.classList.add("hidden");
    calibrationInputSection?.classList.add("hidden");
    if (calibrationMeasurements) calibrationMeasurements.innerHTML = "";
  }

  function hideCalibrationPanel() {
    calibrationPanel?.classList.add("hidden");
  }

  function updateCalibrationStep(step, total) {
    if (calibrationStep) {
      calibrationStep.textContent = t("floor.calibrateStep")
        .replace("{n}", step)
        .replace("{total}", total);
    }
    if (calibrationInstruction) {
      calibrationInstruction.textContent = t("floor.calibrateDrawLine");
    }
    calibrationInputSection?.classList.add("hidden");
  }

  function showCalibrationInput() {
    calibrationInputSection?.classList.remove("hidden");
    if (calibrationLengthInput) {
      calibrationLengthInput.value = "";
      calibrationLengthInput.focus();
    }
  }

  function addMeasurementDisplay(measurements) {
    if (!calibrationMeasurements) return;
    calibrationMeasurements.innerHTML = measurements.map((m, i) => `
      <div class="calibration-measurement">
        <span class="calibration-measurement-icon">✓</span>
        <span class="calibration-measurement-text">${t("floor.calibrateMeasurement")
          .replace("{n}", i + 1)
          .replace("{cm}", m.lengthCm.toFixed(1))}</span>
      </div>
    `).join("");
  }

  function showCalibrationSuccess(avgPixelsPerCm) {
    calibrationInputSection?.classList.add("hidden");
    calibrationSuccess?.classList.remove("hidden");
    const calibrationFailed = document.getElementById("calibrationFailed");
    calibrationFailed?.classList.add("hidden");
    // No technical scale info - just confirm success
  }

  function showCalibrationFailed(variationPct) {
    calibrationInputSection?.classList.add("hidden");
    calibrationSuccess?.classList.add("hidden");
    const calibrationFailed = document.getElementById("calibrationFailed");
    const calibrationFailedReason = document.getElementById("calibrationFailedReason");
    if (calibrationFailed) {
      calibrationFailed.classList.remove("hidden");
    }
    if (calibrationFailedReason) {
      calibrationFailedReason.textContent = t("floor.calibrateFailed")
        .replace("{pct}", variationPct.toFixed(1));
    }
  }

  // Calibration button
  bgCalibrateBtn?.addEventListener("click", () => {
    const svg = document.getElementById("planSvg");
    if (!svg) return;

    showCalibrationPanel();

    backgroundController.startCalibration(svg, {
      onStepStart: (step, total) => {
        updateCalibrationStep(step, total);
      },
      onLineDrawn: (pixelDistance, stepNumber) => {
        showCalibrationInput();
      },
      onMeasurementAdded: (measurements) => {
        addMeasurementDisplay(measurements);
      },
      onComplete: (success, avgPixelsPerCm) => {
        if (success) {
          showCalibrationSuccess(avgPixelsPerCm);
        } else {
          hideCalibrationPanel();
        }
      },
      onFailed: (variationPct) => {
        // Show failure state - measurements too inconsistent
        showCalibrationFailed(variationPct);
      },
      onCancel: () => {
        hideCalibrationPanel();
      }
    });
  });

  // Confirm measurement button
  btnConfirmCalibrationLength?.addEventListener("click", () => {
    const value = calibrationLengthInput?.value;
    if (value && backgroundController.confirmMeasurement(parseFloat(value))) {
      // Measurement confirmed, UI will be updated via callbacks
    }
  });

  // Handle Enter key in input
  calibrationLengthInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      btnConfirmCalibrationLength?.click();
    }
  });

  // Cancel calibration button
  btnCancelCalibration?.addEventListener("click", () => {
    backgroundController.cancelCalibration();
    hideCalibrationPanel();
  });

  // Close calibration success
  btnCloseCalibration?.addEventListener("click", () => {
    hideCalibrationPanel();
  });

  // Retry calibration after failure
  const btnRetryCalibration = document.getElementById("btnRetryCalibration");
  btnRetryCalibration?.addEventListener("click", () => {
    // Hide failed state and restart
    const calibrationFailed = document.getElementById("calibrationFailed");
    calibrationFailed?.classList.add("hidden");
    if (calibrationMeasurements) calibrationMeasurements.innerHTML = "";

    const svg = document.getElementById("planSvg");
    if (!svg) return;

    backgroundController.startCalibration(svg, {
      onStepStart: (step, total) => {
        updateCalibrationStep(step, total);
      },
      onLineDrawn: (pixelDistance, stepNumber) => {
        showCalibrationInput();
      },
      onMeasurementAdded: (measurements) => {
        addMeasurementDisplay(measurements);
      },
      onComplete: (success, avgPixelsPerCm) => {
        if (success) {
          showCalibrationSuccess(avgPixelsPerCm);
        } else {
          hideCalibrationPanel();
        }
      },
      onFailed: (variationPct) => {
        showCalibrationFailed(variationPct);
      },
      onCancel: () => {
        hideCalibrationPanel();
      }
    });
  });

  // Opacity slider
  bgOpacitySlider?.addEventListener("input", (e) => {
    const opacity = parseInt(e.target.value, 10) / 100;
    backgroundController.updateOpacity(opacity);
  });

  // Floor tiles toggle - shows/hides tile rendering for whole floor
  const floorShowTiles = document.getElementById("floorShowTiles");
  floorShowTiles?.addEventListener("change", (e) => {
    const state = store.getState();
    const next = deepClone(state);

    next.view = next.view || {};
    next.view.showFloorTiles = e.target.checked;

    store.commit(t("floor.tilesToggled") || "Floor tiles toggled", next, {
      onRender: renderAll,
      updateMetaCb: updateMeta
    });
  });

  // Wall visibility toggles
  const debugShowWalls = document.getElementById("debugShowWalls");
  const threeDShowWalls = document.getElementById("threeDShowWalls");

  debugShowWalls?.addEventListener("change", (e) => {
    const state = store.getState();
    const next = deepClone(state);
    next.view = next.view || {};
    next.view.showWalls = e.target.checked;
    store.commit("2D walls visibility toggled", next, {
      onRender: renderAll,
      updateMetaCb: updateMeta
    });
  });

  threeDShowWalls?.addEventListener("change", (e) => {
    const state = store.getState();
    const next = deepClone(state);
    next.view = next.view || {};
    next.view.showWalls3D = e.target.checked;
    store.commit("3D walls visibility toggled", next, {
      onRender: renderAll,
      updateMetaCb: updateMeta
    });
  });

}

// commit helper
const commitViaStore = (label, next) =>
  store.commit(label, next, { onRender: renderAll, updateMetaCb: updateMeta });

const excl = createExclusionsController({
  getState: () => store.getState(),
  commit: commitViaStore,
  getSelectedId: () => selectedExclId,
  setSelectedId
});

const structure = createStructureController({
  store,
  renderAll,
  updateMeta,
  resetSelectedExcl: () => setSelectedExcl(null)
});

const removal = createRemovalController(store, renderAll);

const backgroundController = createBackgroundController({
  store,
  renderAll,
  updateMeta
});

const dragController = createExclusionDragController({
  getSvg: () => document.getElementById("planSvgFullscreen") || document.getElementById("planSvg"),
  getState: () => store.getState(),
  commit: (label, next) => commitViaStore(label, next),
  render: (label) => renderAll(label),
  getSelectedExcl: () => excl.getSelectedExcl(),
  setSelectedExcl,
  setSelectedIdOnly: setSelectedId, // Set ID without triggering render (for drag start)
  getSelectedId: () => selectedExclId,
  getMoveLabel: () => t("exclusions.moved"),
  getResizeLabel: () => t("exclusions.resized"),
  onDragStart: () => {
    lastExclDragAt = Date.now();
  },
  onDragEnd: () => {
    lastExclDragAt = Date.now();
  }
});

const doorwayDragController = createDoorwayDragController({
  getSvg: () => document.getElementById("planSvgFullscreen") || document.getElementById("planSvg"),
  getState: () => store.getState(),
  commit: (label, next) => commitViaStore(label, next),
  render: () => renderAll(),
  getSelectedDoorwayId: () => selectedDoorwayId,
  setSelectedDoorway: (id) => {
    selectedDoorwayId = id;
    updateRoomDeleteButtonState();
  },
  getMoveLabel: () => t("edge.doorwayChanged"),
  onDblClick: (doorwayId, edgeIndex) => {
    showDoorwayEditorDialog(doorwayId, edgeIndex);
  }
});

const roomDragController = createRoomDragController({
  getSvg: () => document.getElementById("planSvgFullscreen") || document.getElementById("planSvg"),
  getState: () => store.getState(),
  commit: (label, next) => commitViaStore(label, next),
  render: (label) => renderAll(label),
  getCurrentFloor: (state) => {
    const s = state || store.getState();
    const floor = s.floors?.find(f => f.id === s.selectedFloorId);
    return floor || null;
  },
  getMoveLabel: () => t("room.positionChanged") || "Room position changed"
});

const polygonDrawController = createPolygonDrawController({
  getSvg: () => document.getElementById("planSvgFullscreen") || document.getElementById("planSvg"),
  getState: () => store.getState(),
  commit: (label, next) => commitViaStore(label, next),
  render: (label) => renderAll(label),
  getCurrentFloor: (state) => {
    const s = state || store.getState();
    const floor = s.floors?.find(f => f.id === s.selectedFloorId);
    return floor || null;
  }
});

// Helper to cancel freeform drawing mode and reset button state
function cancelFreeformDrawing() {
  if (polygonDrawController.isDrawing()) {
    polygonDrawController.stopDrawing(true);
  }
  // Also ensure button is reset (in case stopDrawing was already called)
  const drawRoomBtn = document.getElementById("floorDrawRoom");
  if (drawRoomBtn) drawRoomBtn.classList.remove("active");
}

// Helper to cancel calibration mode and hide panel
function cancelCalibrationMode() {
  if (backgroundController.isCalibrating()) {
    backgroundController.cancelCalibration();
  }
  // Also ensure panel is hidden
  const calibrationPanel = document.getElementById("calibrationPanel");
  if (calibrationPanel) calibrationPanel.classList.add("hidden");
}

const roomResizeController = createRoomResizeController({
  getSvg: () => document.getElementById("planSvgFullscreen") || document.getElementById("planSvg"),
  getState: () => store.getState(),
  commit: (label, next) => commitViaStore(label, next),
  render: (label) => renderAll(label),
  getCurrentFloor: (state) => {
    const s = state || store.getState();
    const floor = s.floors?.find(f => f.id === s.selectedFloorId);
    return floor || null;
  },
  getResizeLabel: () => t("room.sizeChanged") || "Room resized"
});

const polygonVertexDragController = createPolygonVertexDragController({
  getSvg: () => document.getElementById("planSvgFullscreen") || document.getElementById("planSvg"),
  getState: () => store.getState(),
  commit: (label, next) => commitViaStore(label, next),
  render: (label) => renderAll(label),
  getCurrentFloor: (state) => {
    const s = state || store.getState();
    const floor = s.floors?.find(f => f.id === s.selectedFloorId);
    return floor || null;
  },
  getVertexMoveLabel: () => t("room.vertexMoved") || "Vertex moved"
});

const zoomPanController = createZoomPanController({
  getSvg: () => document.getElementById("planSvgFullscreen") || document.getElementById("planSvg"),
  getCurrentRoomId: () => {
    const state = store.getState();
    // In floor or pattern groups view, use floor ID as the viewport key with a prefix
    if (state.view?.planningMode === "floor" || state.view?.planningMode === "patternGroups") {
      return `floor:${state.selectedFloorId}`;
    }
    return state.selectedRoomId;
  },
  onViewportChange: () => renderAll({ mode: "zoom" }),
  getSelectedExclId: () => selectedExclId
});

function setRoomSkirtingEnabled(enabled) {
  const next = deepClone(store.getState());
  const room = getCurrentRoom(next);
  if (!room) return;
  room.skirting = room.skirting || {};
  room.skirting.enabled = enabled;
  commitViaStore(t("skirting.changed"), next);
}

function setRoomSkirtingEnabledById(roomId, enabled) {
  const next = deepClone(store.getState());
  let targetRoom = null;
  for (const floor of next.floors || []) {
    const match = floor.rooms?.find(r => r.id === roomId);
    if (match) {
      targetRoom = match;
      break;
    }
  }
  if (!targetRoom) return;
  targetRoom.skirting = targetRoom.skirting || {};
  targetRoom.skirting.enabled = enabled;
  commitViaStore(t("skirting.changed"), next);
}

function setExclusionSkirtingEnabled(id, enabled) {
  if (!id) return;
  const next = deepClone(store.getState());
  const room = getCurrentRoom(next);
  if (!room || !room.exclusions) return;
  const ex = room.exclusions.find(e => e.id === id);
  if (!ex) return;
  ex.skirtingEnabled = enabled;
  commitViaStore(t("exclusions.changed"), next);
}

function updateExclusionInline({ id, key, value }) {
  if (key !== "__delete__" && !Number.isFinite(value)) return;

  const next = deepClone(store.getState());
  const room = getCurrentRoom(next);
  if (!room) return;
  const ex = room.exclusions?.find(x => x.id === id);
  if (!ex) return;
  if (key === "__delete__") {
    room.exclusions = room.exclusions.filter(x => x.id !== id);
    const remaining = room.exclusions;
    if (remaining.length > 0) {
      setSelectedExcl(remaining.at(-1)?.id ?? null);
    } else {
      setSelectedExcl(null);
    }
    commitViaStore(t("exclusions.deleted"), next);
    return;
  }
  const bounds = getRoomBounds(room);

  const clampPos = (v) => Math.max(0.1, v);

  const getBox = (shape) => {
    if (shape.type === "rect") {
      return {
        minX: shape.x,
        minY: shape.y,
        maxX: shape.x + shape.w,
        maxY: shape.y + shape.h
      };
    }
    if (shape.type === "circle") {
      return {
        minX: shape.cx - shape.r,
        minY: shape.cy - shape.r,
        maxX: shape.cx + shape.r,
        maxY: shape.cy + shape.r
      };
    }
    const xs = [shape.p1.x, shape.p2.x, shape.p3.x];
    const ys = [shape.p1.y, shape.p2.y, shape.p3.y];
    return {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys)
    };
  };

  const moveAll = (dx, dy) => {
    if (ex.type === "rect") {
      ex.x += dx;
      ex.y += dy;
    } else if (ex.type === "circle") {
      ex.cx += dx;
      ex.cy += dy;
    } else if (ex.type === "tri") {
      ex.p1.x += dx; ex.p1.y += dy;
      ex.p2.x += dx; ex.p2.y += dy;
      ex.p3.x += dx; ex.p3.y += dy;
    }
  };

  const setSideLength = (p1, p2, nextLen) => {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.001) return p2;
    const scale = nextLen / len;
    return { x: p1.x + dx * scale, y: p1.y + dy * scale };
  };

  if (key === "x" || key === "y") {
    const box = getBox(ex);
    if (key === "x") {
      const targetLeft = bounds.minX + value;
      const dx = targetLeft - box.minX;
      moveAll(dx, 0);
    } else {
      const targetTop = bounds.minY + value;
      const dy = targetTop - box.minY;
      moveAll(0, dy);
    }
  } else if (ex.type === "rect") {
    if (key === "w") ex.w = clampPos(value);
    if (key === "h") ex.h = clampPos(value);
  } else if (ex.type === "circle") {
    if (key === "diameter") ex.r = clampPos(value) / 2;
  } else if (ex.type === "tri") {
    const nextLen = clampPos(value);
    if (key === "side-a") ex.p2 = setSideLength(ex.p1, ex.p2, nextLen);
    if (key === "side-b") ex.p3 = setSideLength(ex.p2, ex.p3, nextLen);
    if (key === "side-c") ex.p1 = setSideLength(ex.p3, ex.p1, nextLen);
  }

  commitViaStore(t("exclusions.changed"), next);
}

function nudgeSelectedExclusion(dx, dy) {
  const id = selectedExclId;
  if (!id) return;
  const next = deepClone(store.getState());
  const room = getCurrentRoom(next);
  if (!room) return;
  const ex = room.exclusions?.find(x => x.id === id);
  if (!ex) return;

  const snap = (v) => Math.round(v * 10) / 10;
  const isOnGrid = (v) => Math.abs(v - snap(v)) < EPSILON;
  const snapDir = (v, dir) => {
    if (dir === 0) return v;
    if (isOnGrid(v)) return v + dir;
    return dir > 0 ? Math.ceil(v * 10) / 10 : Math.floor(v * 10) / 10;
  };

  const getBox = (shape) => {
    if (shape.type === "rect") {
      return {
        minX: shape.x,
        minY: shape.y,
        maxX: shape.x + shape.w,
        maxY: shape.y + shape.h
      };
    }
    if (shape.type === "circle") {
      return {
        minX: shape.cx - shape.r,
        minY: shape.cy - shape.r,
        maxX: shape.cx + shape.r,
        maxY: shape.cy + shape.r
      };
    }
    const xs = [shape.p1.x, shape.p2.x, shape.p3.x];
    const ys = [shape.p1.y, shape.p2.y, shape.p3.y];
    return {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys)
    };
  };

  const box = getBox(ex);
  const targetMinX = snapDir(box.minX, dx);
  const targetMinY = snapDir(box.minY, dy);
  const moveDx = dx === 0 ? 0 : targetMinX - box.minX;
  const moveDy = dy === 0 ? 0 : targetMinY - box.minY;

  if (ex.type === "rect") {
    ex.x += moveDx;
    ex.y += moveDy;
  } else if (ex.type === "circle") {
    ex.cx += moveDx;
    ex.cy += moveDy;
  } else if (ex.type === "tri") {
    ex.p1.x += moveDx; ex.p1.y += moveDy;
    ex.p2.x += moveDx; ex.p2.y += moveDy;
    ex.p3.x += moveDx; ex.p3.y += moveDy;
  }

  commitViaStore(t("exclusions.moved"), next);
}

function bindPresetCollection() {
  const tileList = document.getElementById("tilePresetList");
  const tileName = document.getElementById("tilePresetName");
  const tileShape = document.getElementById("tilePresetShape");
  const tileW = document.getElementById("tilePresetW");
  const tileH = document.getElementById("tilePresetH");
  const groutW = document.getElementById("tilePresetGroutW");
  const groutColor = document.getElementById("tilePresetGroutColor");
  const pricePerM2 = document.getElementById("tilePresetPricePerM2");
  const packM2 = document.getElementById("tilePresetPackM2");
  const pricePerPack = document.getElementById("tilePresetPricePerPack");
  const useSkirting = document.getElementById("tilePresetUseSkirting");
  const roomList = document.getElementById("tilePresetRoomList");
  const addTile = document.getElementById("btnAddTilePreset");
  const delTile = document.getElementById("btnDeleteTilePreset");
  const tilePresetDeleteWarning = document.getElementById("tilePresetDeleteWarning");
  const tilePresetDeleteWarningText = document.getElementById("tilePresetDeleteWarningText");
  const tilePresetDeleteConfirm = document.getElementById("btnConfirmDeleteTilePreset");
  const tilePresetDeleteCancel = document.getElementById("btnCancelDeleteTilePreset");

  const skirtList = document.getElementById("skirtingPresetList");
  const skirtName = document.getElementById("skirtingPresetName");
  const skirtHeight = document.getElementById("skirtingPresetHeight");
  const skirtLength = document.getElementById("skirtingPresetLength");
  const skirtPrice = document.getElementById("skirtingPresetPrice");
  const addSkirt = document.getElementById("btnAddSkirtingPreset");
  const delSkirt = document.getElementById("btnDeleteSkirtingPreset");

  let pendingTilePresetDelete = null;
  const hideTilePresetDeleteWarning = () => {
    pendingTilePresetDelete = null;
    tilePresetDeleteWarning?.classList.add("hidden");
    if (tilePresetDeleteWarningText) tilePresetDeleteWarningText.textContent = "";
  };

  const applyTilePresetDelete = (next, presetName, roomsUsingPreset) => {
    if (!roomsUsingPreset?.length) return;
    const roomIdSet = new Set(roomsUsingPreset);
    next.floors?.forEach(floor => {
      floor.rooms?.forEach(room => {
        if (roomIdSet.has(room.id)) {
          room.tile.reference = "";
          room.tile.shape = "rect";
          room.tile.widthCm = 0;
          room.tile.heightCm = 0;
        }
      });
    });
    if (presetName && next.materials?.[presetName]) {
      delete next.materials[presetName];
    }
  };

  if (tileList) {
    tileList.addEventListener("change", (e) => {
      selectedTilePresetId = e.target.value || null;
      hideTilePresetDeleteWarning();
      renderAll();
    });
  }
  if (skirtList) {
    skirtList.addEventListener("change", (e) => {
      selectedSkirtingPresetId = e.target.value || null;
      renderAll();
    });
  }

  addTile?.addEventListener("click", () => {
    const next = deepClone(store.getState());
    const room = getCurrentRoom(next);
    const defaults = getDefaultTilePresetTemplate(next);
    const base = room?.tile && room.tile.widthCm > 0 && room.tile.heightCm > 0
      ? room.tile
      : defaults;
    const grout = room?.grout || { widthCm: defaults.groutWidthCm, colorHex: defaults.groutColorHex };
    const pricing = room ? getRoomPricing(next, room) : getDefaultPricing(next);
    const preset = {
      id: uuid(),
      name: `${t("tile.preset")} ${next.tilePresets.length + 1}`,
      shape: base.shape || defaults.shape || "rect",
      widthCm: Number(base.widthCm) || defaults.widthCm || 0,
      heightCm: Number(base.heightCm) || defaults.heightCm || 0,
      groutWidthCm: Number(grout.widthCm) || defaults.groutWidthCm || 0,
      groutColorHex: grout.colorHex || defaults.groutColorHex || "#ffffff",
      pricePerM2: Number(pricing.pricePerM2) || 0,
      packM2: Number(pricing.packM2) || 0,
      useForSkirting: Boolean(defaults.useForSkirting)
    };
    next.tilePresets.push(preset);
    selectedTilePresetId = preset.id;
    commitViaStore(t("tile.presetAdded"), next);
  });

  delTile?.addEventListener("click", () => {
    if (!selectedTilePresetId) return;
    const next = deepClone(store.getState());
    const preset = next.tilePresets.find(p => p.id === selectedTilePresetId);
    const presetName = preset?.name || "";
    const roomsUsingPreset = [];
    if (presetName) {
      next.floors?.forEach(floor => {
        floor.rooms?.forEach(room => {
          if (room.tile?.reference === presetName) roomsUsingPreset.push(room.id);
        });
      });
    }

    if (roomsUsingPreset.length > 0) {
      pendingTilePresetDelete = { id: selectedTilePresetId, name: presetName, rooms: roomsUsingPreset };
      if (tilePresetDeleteWarningText) {
        tilePresetDeleteWarningText.textContent =
          `${t("tile.presetDeleteWarn")} ${roomsUsingPreset.length} ${t("tile.presetDeleteWarnTail")}`;
      }
      tilePresetDeleteWarning?.classList.remove("hidden");
      return;
    }

    next.tilePresets = next.tilePresets.filter(p => p.id !== selectedTilePresetId);
    selectedTilePresetId = next.tilePresets.at(-1)?.id ?? null;
    commitViaStore(t("tile.presetDeleted"), next);
  });

  tilePresetDeleteConfirm?.addEventListener("click", () => {
    if (!pendingTilePresetDelete?.id) return;
    const next = deepClone(store.getState());
    const { id, name, rooms } = pendingTilePresetDelete;
    applyTilePresetDelete(next, name, rooms);
    next.tilePresets = next.tilePresets.filter(p => p.id !== id);
    selectedTilePresetId = next.tilePresets.at(-1)?.id ?? null;
    hideTilePresetDeleteWarning();
    commitViaStore(t("tile.presetDeleted"), next);
  });

  tilePresetDeleteCancel?.addEventListener("click", () => {
    hideTilePresetDeleteWarning();
  });

  const commitTilePreset = () => {
    if (!selectedTilePresetId) return;
    const next = deepClone(store.getState());
    const p = next.tilePresets.find(x => x.id === selectedTilePresetId);
    if (!p) return;
    const prevName = p.name;
    if (tileName) p.name = tileName.value ?? p.name;
    if (tileShape) p.shape = tileShape.value || p.shape;
    if (tileW) p.widthCm = Number(tileW.value);
    if (tileH) p.heightCm = Number(tileH.value);
    if (groutW) p.groutWidthCm = Number(groutW.value) / 10;
    if (groutColor) p.groutColorHex = groutColor.value || p.groutColorHex;
    if (pricePerM2) p.pricePerM2 = Number(pricePerM2.value);
    if (packM2) p.packM2 = Number(packM2.value);
    const prevUseForSkirting = Boolean(p.useForSkirting);
    if (useSkirting) p.useForSkirting = Boolean(useSkirting.checked);

    if (prevName && p.name && prevName !== p.name) {
      next.floors?.forEach(floor => {
        floor.rooms?.forEach(room => {
          if (room.tile?.reference === prevName) room.tile.reference = p.name;
        });
      });
      if (next.materials?.[prevName] && !next.materials[p.name]) {
        next.materials[p.name] = next.materials[prevName];
        delete next.materials[prevName];
      }
    }

    if (!prevUseForSkirting && p.useForSkirting && p.name) {
      enforceCutoutForPresetRooms(next, p.name);
    }

    commitViaStore(t("tile.presetChanged"), next);
  };

  [tileName, tileW, tileH, groutW, pricePerM2, packM2].forEach(el => {
    el?.addEventListener("blur", commitTilePreset);
  });
  tileShape?.addEventListener("change", commitTilePreset);
  groutColor?.addEventListener("change", commitTilePreset);
  groutColor?.addEventListener("input", commitTilePreset);
  useSkirting?.addEventListener("change", commitTilePreset);
  pricePerPack?.addEventListener("change", () => {
    const pack = Number(packM2?.value);
    const price = Number(pricePerPack.value);
    if (!Number.isFinite(pack) || pack <= 0) return;
    if (!Number.isFinite(price)) return;
    if (pricePerM2) pricePerM2.value = (price / pack).toFixed(2);
    commitTilePreset();
  });


  roomList?.addEventListener("change", (e) => {
    const target = e.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (!target.dataset.roomId) return;
    if (!selectedTilePresetId) return;
    const next = deepClone(store.getState());
    const preset = next.tilePresets.find(x => x.id === selectedTilePresetId);
    if (!preset || !preset.name) return;

    let room = null;
    next.floors?.forEach(floor => {
      floor.rooms?.forEach(r => {
        if (r.id === target.dataset.roomId) room = r;
      });
    });
    if (!room) return;

    if (target.checked) {
      room.tile.shape = preset.shape || room.tile.shape;
      room.tile.widthCm = Number(preset.widthCm) || room.tile.widthCm;
      room.tile.heightCm = Number(preset.heightCm) || room.tile.heightCm;
      room.tile.reference = preset.name || room.tile.reference;
      room.grout.widthCm = Number(preset.groutWidthCm) || 0;
      room.grout.colorHex = preset.groutColorHex || room.grout.colorHex;
      if (preset.useForSkirting) {
        room.skirting.enabled = true;
        room.skirting.type = "cutout";
      }
      if (preset.name) {
        next.materials = next.materials || {};
        next.materials[preset.name] = next.materials[preset.name] || {
          pricePerM2: next.pricing?.pricePerM2 || 0,
          packM2: next.pricing?.packM2 || 0
        };
        if (Number.isFinite(preset.pricePerM2)) next.materials[preset.name].pricePerM2 = Number(preset.pricePerM2);
        if (Number.isFinite(preset.packM2)) next.materials[preset.name].packM2 = Number(preset.packM2);
      }
    } else if (room.tile?.reference === preset.name) {
      room.tile.reference = "";
    }

    commitViaStore(t("tile.presetChanged"), next);
  });

  addSkirt?.addEventListener("click", () => {
    const next = deepClone(store.getState());
    const room = getCurrentRoom(next);
    const base = room?.skirting || {};
    const preset = {
      id: uuid(),
      name: `${t("skirting.preset")} ${next.skirtingPresets.length + 1}`,
      heightCm: Number(base.heightCm) || DEFAULT_SKIRTING_PRESET.heightCm,
      lengthCm: Number(base.boughtWidthCm) || DEFAULT_SKIRTING_PRESET.lengthCm,
      pricePerPiece: Number(base.boughtPricePerPiece) || DEFAULT_SKIRTING_PRESET.pricePerPiece
    };
    next.skirtingPresets.push(preset);
    selectedSkirtingPresetId = preset.id;
    commitViaStore(t("skirting.presetAdded"), next);
  });

  delSkirt?.addEventListener("click", () => {
    if (!selectedSkirtingPresetId) return;
    const next = deepClone(store.getState());
    next.skirtingPresets = next.skirtingPresets.filter(p => p.id !== selectedSkirtingPresetId);
    selectedSkirtingPresetId = next.skirtingPresets.at(-1)?.id ?? null;
    commitViaStore(t("skirting.presetDeleted"), next);
  });

  const commitSkirtingPreset = () => {
    if (!selectedSkirtingPresetId) return;
    const next = deepClone(store.getState());
    const p = next.skirtingPresets.find(x => x.id === selectedSkirtingPresetId);
    if (!p) return;
    if (skirtName) p.name = skirtName.value ?? p.name;
    if (skirtHeight) p.heightCm = Number(skirtHeight.value);
    if (skirtLength) p.lengthCm = Number(skirtLength.value);
    if (skirtPrice) p.pricePerPiece = Number(skirtPrice.value);
    commitViaStore(t("skirting.presetChanged"), next);
  };

  [skirtName, skirtHeight, skirtLength, skirtPrice].forEach(el => {
    el?.addEventListener("blur", commitSkirtingPreset);
  });
}

function updateAllTranslations() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    const text = t(key);
    if (el.tagName === "INPUT" && el.type !== "checkbox" && el.type !== "radio") {
      return;
    }
    el.textContent = text;
  });

  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    el.placeholder = t(key);
  });

  renderAll();
}

(function main() {
  const hadSession = store.loadSessionIfAny();
  store.autosaveSession(updateMeta);

  initMainTabs();
  initFullscreen(dragController, renderAll);
  initViewToggle();
  initBackgroundControls();
  initPatternGroupsControls();

  // Initialize zoom/pan controller
  zoomPanController.attach();

  bindUI({
    store,
    excl,
    renderAll,
    refreshProjectSelect,
    updateMeta,
    validateState,
    defaultStateFn: defaultState,
    setSelectedExcl,
    resetErrors: () => {
      lastUnionError = null;
      lastTileError = null;
    }
  });
  bindPresetCollection();

  document.getElementById("floorSelect")?.addEventListener("change", (e) => {
    cancelFreeformDrawing(); // Cancel any active freeform drawing
    cancelCalibrationMode(); // Cancel any active calibration
    structure.selectFloor(e.target.value);
  });

  document.getElementById("roomSelect")?.addEventListener("change", (e) => {
    structure.selectRoom(e.target.value);
  });

  document.getElementById("wallSelect")?.addEventListener("change", (e) => {
    const surfaceId = e.target.value;
    if (!surfaceId) return;
    const s = store.getState();
    const next = deepClone(s);
    next.selectedRoomId = surfaceId;
    store.commit("Surface selected", next, { onRender: renderAll, updateMetaCb: updateMeta });
  });

  // Pattern groups dropdown in quick controls bar
  document.getElementById("pgGroupSelect")?.addEventListener("change", (e) => {
    activeTargetGroupId = e.target.value || null;
    renderAll(t("patternGroups.groupSelected") || "Group selected");
  });

  document.getElementById("floorName")?.addEventListener("change", () => {
    structure.commitFloorName();
  });

  document.getElementById("btnAddFloor")?.addEventListener("click", () => {
    structure.addFloor();
  });

  document.getElementById("btnDeleteFloor")?.addEventListener("click", () => {
    structure.deleteFloor();
  });

  document.getElementById("btnAddRoom")?.addEventListener("click", () => {
    structure.addRoom();
  });

  document.getElementById("btnDeleteRoom")?.addEventListener("click", () => {
    structure.deleteRoom();
  });

  document.addEventListener("click", (e) => {
    if (isInlineEditing()) return;
    if (Date.now() - lastExclDragAt < 250) return;
    const inPlan = e.target.closest("#planSvg, #planSvgFullscreen");
    if (!inPlan) return;
    const inInteractive = e.target.closest("[data-exid], [data-secid], [data-resize-handle], [data-inline-edit], [data-add-btn], [data-wall-edge], [data-doorway-id]");
    if (inInteractive) return;
    setSelectedExcl(null);
    if (selectedWallEdge !== null || selectedDoorwayId !== null) {
      selectedWallEdge = null;
      selectedDoorwayId = null;
      updateDoorButtonState();
      updateRoomDeleteButtonState();
      renderAll();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (isInlineEditing()) return;
    if (!selectedExclId) return;
    const step = e.shiftKey ? 5 : 0.1;
    let dx = 0;
    let dy = 0;
    if (e.key === "ArrowLeft") dx = -step;
    if (e.key === "ArrowRight") dx = step;
    if (e.key === "ArrowUp") dy = -step;
    if (e.key === "ArrowDown") dy = step;
    if (dx === 0 && dy === 0) return;
    e.preventDefault();
    nudgeSelectedExclusion(dx, dy);
  });

  document.addEventListener("keydown", (e) => {
    if (isInlineEditing()) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target;
    if (target?.isContentEditable) return;
    const tag = target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (e.key !== "s" && e.key !== "S") return;
    e.preventDefault();

    const state = store.getState();
    const room = getCurrentRoom(state);
    if (!room) return;

    if (selectedExclId) {
      const ex = room.exclusions?.find(x => x.id === selectedExclId);
      if (!ex) return;
      setExclusionSkirtingEnabled(selectedExclId, ex.skirtingEnabled === false);
      return;
    }

    setRoomSkirtingEnabled(room.skirting?.enabled === false);
  });

  // Delete key - delete selected exclusion or doorway
  document.addEventListener("keydown", (e) => {
    if (isInlineEditing()) return;
    if (e.key !== "Delete" && e.key !== "Backspace") return;
    const target = e.target;
    if (target?.isContentEditable) return;
    const tag = target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

    if (selectedDoorwayId) {
      e.preventDefault();
      deleteDoorway(selectedDoorwayId);
    } else if (selectedExclId) {
      e.preventDefault();
      updateExclusionInline({ id: selectedExclId, key: "__delete__" });
    }
  });

  const langSelect = document.getElementById("langSelect");
  if (langSelect) {
    langSelect.value = getLanguage();
    langSelect.addEventListener("change", () => {
      setLanguage(langSelect.value);
      updateAllTranslations();
    });
  }

  // Settings menu toggle
  const settingsToggle = document.getElementById("btnSettingsToggle");
  const settingsDropdown = document.getElementById("settingsDropdown");
  if (settingsToggle && settingsDropdown) {
    settingsToggle.addEventListener("click", (e) => {
      e.stopPropagation();
      settingsDropdown.classList.toggle("hidden");
    });

    document.addEventListener("click", (e) => {
      if (!settingsDropdown.contains(e.target) && e.target !== settingsToggle) {
        settingsDropdown.classList.add("hidden");
      }
    });

    // Settings menu actions
    document.getElementById("menuSaveProject")?.addEventListener("click", async () => {
      settingsDropdown.classList.add("hidden");
      const state = store.getState();
      const name = await showPrompt({
        title: t("project.title") || "Save Project",
        message: t("dialog.enterProjectName") || "Enter a name for this project",
        placeholder: t("project.namePlaceholder") || "e.g. Bathroom Ground Floor",
        defaultValue: state.project?.name || "",
        confirmText: t("dialog.save") || "Save",
        cancelText: t("dialog.cancel") || "Cancel"
      });
      if (!name) return;
      store.saveCurrentAsProject(name);
      store.autosaveSession(updateMeta);
      renderAll(t("project.saved"));
    });

    document.getElementById("menuLoadProject")?.addEventListener("click", async () => {
      settingsDropdown.classList.add("hidden");
      const projects = store.loadProjects();
      if (projects.length === 0) {
        await showAlert({
          title: t("dialog.noProjectsAvailable") || "No Projects",
          message: t("project.none") || "No saved projects found.",
          type: "info"
        });
        return;
      }
      const items = projects.map(p => ({ value: p.id, label: p.name }));
      const selectedId = await showSelect({
        title: t("project.load") || "Load Project",
        message: t("dialog.selectProject") || "Select a project to load",
        items,
        confirmText: t("project.load") || "Load",
        cancelText: t("dialog.cancel") || "Cancel"
      });
      if (selectedId) {
        const res = store.loadProjectById(selectedId);
        if (!res.ok) {
          await showAlert({
            title: t("dialog.projectNotFoundTitle") || "Not Found",
            message: t("project.notFound") || "Project not found.",
            type: "error"
          });
          return;
        }
        setSelectedExcl(null);
        lastUnionError = null;
        lastTileError = null;
        renderAll(`${t("project.loaded")}: ${res.name}`);
      }
    });

    document.getElementById("menuExport")?.addEventListener("click", () => {
      settingsDropdown.classList.add("hidden");
      document.getElementById("btnExport")?.click();
    });

    document.getElementById("menuImport")?.addEventListener("click", () => {
      settingsDropdown.classList.add("hidden");
      document.getElementById("fileImport")?.click();
    });

    document.getElementById("menuDebug")?.addEventListener("click", () => {
      settingsDropdown.classList.add("hidden");
      const debugPanel = document.getElementById("debugPanel");
      if (!debugPanel) return;
      debugPanel.classList.toggle("hidden");
    });

    document.getElementById("btnCloseDebug")?.addEventListener("click", () => {
      document.getElementById("debugPanel")?.classList.add("hidden");
    });

    document.getElementById("menuReset")?.addEventListener("click", async () => {
      settingsDropdown.classList.add("hidden");
      const confirmed = await showConfirm({
        title: t("dialog.confirmResetTitle") || "Reset Everything?",
        message: t("dialog.confirmResetText") || "All changes to the current project will be lost. This action cannot be undone.",
        confirmText: t("dialog.reset") || "Reset",
        cancelText: t("dialog.cancel") || "Cancel",
        danger: true
      });
      if (confirmed) {
        setSelectedExcl(null);
        lastUnionError = null;
        lastTileError = null;
        store.commit(t("session.reset"), defaultState(), {
          onRender: renderAll,
          updateMetaCb: updateMeta
        });
      }
    });
  }

  const openWarningsPanel = () => {
    document.getElementById("warningsPanel")?.classList.remove("hidden");
  };
  const openTipsPanel = () => {
    document.getElementById("tipsPanel")?.classList.remove("hidden");
  };

  document.getElementById("warningsWrapper")?.addEventListener("click", openWarningsPanel);
  document.getElementById("tipsWrapper")?.addEventListener("click", openTipsPanel);
  document.getElementById("btnCloseWarnings")?.addEventListener("click", () => {
    document.getElementById("warningsPanel")?.classList.add("hidden");
  });
  document.getElementById("btnCloseTips")?.addEventListener("click", () => {
    document.getElementById("tipsPanel")?.classList.add("hidden");
  });

  // Continue to Planning button
  document.getElementById("btnContinuePlanning")?.addEventListener("click", () => {
    const planningTab = document.querySelector('[data-main-tab="planning"]');
    if (planningTab) {
      planningTab.click();
    }
  });

  // Planning Settings Panel Toggle
  const settingsPanel = document.getElementById("settingsPanel");
  const btnCloseSettings = document.getElementById("btnCloseSettings");
  const quickOpenSettings = document.getElementById("quickOpenSettings");
  const quickCreateTilePreset = document.getElementById("quickCreateTilePreset");
  const setSettingsPanelOpen = (open) => {
    if (!settingsPanel) return;
    settingsPanel.classList.toggle("hidden", !open);
    if (quickOpenSettings) quickOpenSettings.classList.toggle("active", open);
  };

  if (settingsPanel && btnCloseSettings) {
    btnCloseSettings.addEventListener("click", () => {
      setSettingsPanelOpen(false);
    });

    // Close on click outside
    document.addEventListener("click", (e) => {
      if (!settingsPanel.classList.contains("hidden") &&
          !settingsPanel.contains(e.target) &&
          e.target !== quickOpenSettings &&
          !(quickOpenSettings && quickOpenSettings.contains(e.target)) &&
          e.target !== quickCreateTilePreset &&
          !(quickCreateTilePreset && quickCreateTilePreset.contains(e.target))) {
        setSettingsPanelOpen(false);
      }
    });
  }

  if (quickOpenSettings) {
    quickOpenSettings.addEventListener("click", () => {
      const isOpen = settingsPanel && !settingsPanel.classList.contains("hidden");
      setSettingsPanelOpen(!isOpen);
    });
  }

  if (quickCreateTilePreset) {
    quickCreateTilePreset.addEventListener("click", () => {
      setSettingsPanelOpen(true);
      document.getElementById("planningTileSection")?.scrollIntoView({ behavior: "smooth", block: "start" });
      const state = store.getState();
      const hasPresets = (state.tilePresets?.length || 0) > 0;
      if (!hasPresets) {
        document.getElementById("btnCreateTilePreset")?.click();
      }
    });
  }

  // Room delete button - deletes selected exclusion or doorway
  document.getElementById("roomDeleteObject")?.addEventListener("click", () => {
    if (selectedDoorwayId) {
      deleteDoorway(selectedDoorwayId);
    } else if (selectedExclId) {
      updateExclusionInline({ id: selectedExclId, key: "__delete__" });
    }
  });

  // Quick add doorway button
  document.getElementById("quickAddDoorway")?.addEventListener("click", () => {
    if (selectedWallEdge !== null) {
      addDoorwayToWall(selectedWallEdge);
    }
  });

  // Export UI
  const exportRoomsList = document.getElementById("exportRoomsList");
  exportRoomsList?.addEventListener("change", () => {
    updateExportSelectionFromList();
    setExportStatus(t("export.selectionChanged"));
  });

  document.getElementById("exportSelectAllRooms")?.addEventListener("click", () => {
    document.querySelectorAll("#exportRoomsList input[type=\"checkbox\"][data-room-id]").forEach((input) => {
      input.checked = true;
    });
    updateExportSelectionFromList();
    setExportStatus(t("export.selectionChanged"));
  });

  document.getElementById("exportClearRooms")?.addEventListener("click", () => {
    exportSelection.clear();
    document.querySelectorAll("#exportRoomsList input[type=\"checkbox\"][data-room-id]").forEach((input) => {
      input.checked = false;
    });
    updateExportSelectionFromList();
    setExportStatus(t("export.selectionChanged"));
  });

  document.getElementById("btnExportRoomsPdf")?.addEventListener("click", async () => {
    updateExportSelectionFromList();
    const options = getExportOptionsFromUi();
    if (!options.roomIds.length) {
      setExportStatus(t("export.noRoomsSelected"), true);
      return;
    }

    toggleExportProgress(true);
    setExportStatus(t("export.exporting"));
    try {
      await exportRoomsPdf(store.getState(), options, ({ current, total }) => {
        setExportProgress(current, total);
        setExportStatus(t("export.exportingRoom").replace("{0}", String(current)).replace("{1}", String(total)));
      });
      setExportStatus(t("export.success"));
    } catch (err) {
      console.error("Export failed:", err);
      setExportStatus(`${t("export.error")}: ${err.message}`, true);
    } finally {
      toggleExportProgress(false);
    }
  });

  document.getElementById("btnExportCommercialPdf")?.addEventListener("click", async () => {
    try {
      await exportCommercialPdf(store.getState(), getExportOptionsFromUi());
      setExportStatus(t("export.success"));
    } catch (err) {
      console.error("Export failed:", err);
      setExportStatus(`${t("export.error")}: ${err.message}`, true);
    }
  });

  document.getElementById("btnExportCommercialXlsx")?.addEventListener("click", async () => {
    try {
      await exportCommercialXlsx(store.getState(), getExportOptionsFromUi());
      setExportStatus(t("export.success"));
    } catch (err) {
      console.error("Export failed:", err);
      setExportStatus(`${t("export.error")}: ${err.message}`, true);
    }
  });

  // Planning Floor Selector
  const planningFloorSelect = document.getElementById("planningFloorSelect");
  if (planningFloorSelect) {
    planningFloorSelect.addEventListener("change", (e) => {
      cancelFreeformDrawing(); // Cancel any active freeform drawing
      cancelCalibrationMode(); // Cancel any active calibration
      structure.selectFloor(e.target.value);
    });
  }

  // Planning Room Selector
  const planningRoomSelect = document.getElementById("planningRoomSelect");
  if (planningRoomSelect) {
    planningRoomSelect.addEventListener("change", (e) => {
      structure.selectRoom(e.target.value);
    });
  }

  // Quick Controls
  const quickTilePreset = document.getElementById("quickTilePreset");
  const quickPattern = document.getElementById("quickPattern");
  const quickGrout = document.getElementById("quickGrout");
  const quickRemovalMode = document.getElementById("quickRemovalMode");

  // Quick toggle event handlers
  wireQuickViewToggleHandlers();

  const syncRemovalCheckboxes = (checked) => {
    const mainRemovalMode = document.getElementById("removalMode");
    if (mainRemovalMode) mainRemovalMode.checked = checked;
    if (quickRemovalMode) quickRemovalMode.checked = checked;
  };

  quickRemovalMode?.addEventListener("change", (e) => {
    const checked = Boolean(e.target.checked);
    syncRemovalCheckboxes(checked);
    removal.setRemovalMode(checked);
  });

  document.getElementById("removalMode")?.addEventListener("change", (e) => {
    const checked = Boolean(e.target.checked);
    syncRemovalCheckboxes(checked);
    removal.setRemovalMode(checked);
  });

  // Exclusion dropdown
  const quickAddExclusion = document.getElementById("quickAddExclusion");
  const exclDropdown = document.getElementById("exclDropdown");

  quickAddExclusion?.addEventListener("click", (e) => {
    e.stopPropagation();
    exclDropdown?.classList.toggle("hidden");
  });

  // Close dropdowns when clicking outside
  document.addEventListener("click", (e) => {
    // Close exclusion dropdown
    if (exclDropdown && !exclDropdown.classList.contains("hidden") &&
        !exclDropdown.contains(e.target) &&
        e.target !== quickAddExclusion) {
      exclDropdown.classList.add("hidden");
    }
  });

  // Exclusion dropdown items
  document.querySelectorAll(".quick-dropdown-item[data-excl-type]").forEach(item => {
    item.addEventListener("click", () => {
      const type = item.dataset.exclType;
      exclDropdown?.classList.add("hidden");

      if (type === "rect") {
        excl.addRect();
      } else if (type === "circle") {
        excl.addCircle();
      } else if (type === "triangle") {
        excl.addTri();
      } else if (type === "freeform") {
        // Start polygon drawing for freeform exclusion
        const freeformBtn = item;
        freeformBtn.classList.add("active");

        // Get room bounds polygon to restrict drawing within room
        const room = getCurrentRoom(store.getState());
        let roomBoundsPolygon = null;
        if (room) {
          try {
            const mp = roomPolygon(room);
            // Extract outer ring of first polygon (room boundary)
            if (mp && mp[0] && mp[0][0]) {
              roomBoundsPolygon = mp[0][0]; // [[x,y], [x,y], ...]
              // Room bounds are in local space, no rotation needed
            }
          } catch (e) {
            console.warn("Could not get room polygon for bounds check:", e);
          }
        }

        polygonDrawController.startDrawing({
          disableEdgeSnap: true, // No edge constraint for exclusions
          roomBoundsPolygon, // Restrict drawing to within room
          onComplete: (polygonPoints) => {
            freeformBtn.classList.remove("active");

            const vertices = polygonPoints.map(p => {
              return { x: Math.round(p.x), y: Math.round(p.y) };
            });

            excl.addFreeform(vertices);
          },
          onCancel: () => {
            freeformBtn.classList.remove("active");
          }
        });
      }
    });
  });

  // Zoom controls (room view)
  document.getElementById("zoomIn")?.addEventListener("click", () => {
    zoomPanController.zoomIn();
  });
  document.getElementById("zoomOut")?.addEventListener("click", () => {
    zoomPanController.zoomOut();
  });
  document.getElementById("zoomReset")?.addEventListener("click", () => {
    zoomPanController.reset();
  });

  // Floor view zoom controls
  document.getElementById("floorZoomIn")?.addEventListener("click", () => {
    zoomPanController.zoomIn();
  });
  document.getElementById("floorZoomOut")?.addEventListener("click", () => {
    zoomPanController.zoomOut();
  });
  document.getElementById("floorZoomReset")?.addEventListener("click", () => {
    zoomPanController.reset();
  });

  // Floor view room management - Add rectangle room
  document.getElementById("floorAddRoom")?.addEventListener("click", () => {
    cancelFreeformDrawing(); // Cancel any active freeform drawing
    cancelCalibrationMode(); // Cancel any active calibration
    const state = store.getState();
    const floor = getCurrentFloor(state);
    if (!floor) return;

    const next = deepClone(state);
    const nextFloor = next.floors.find(f => f.id === floor.id);

    // Create new room with default size using createSurface
    const floorRoomCount = nextFloor.rooms.length;
    const newRoom = createSurface({
      name: `${t("room.newRoom")} ${floorRoomCount + 1}`,
      widthCm: 300,
      heightCm: 300,
    });

    // Position new room on a free edge of existing rooms
    if (nextFloor.rooms.length > 0) {
      const position = findPositionOnFreeEdge(newRoom, nextFloor.rooms, 'right');
      if (position) {
        newRoom.floorPosition.x = position.x;
        newRoom.floorPosition.y = position.y;
      } else {
        let maxRight = -Infinity;
        let topAtMaxRight = 0;
        for (const room of nextFloor.rooms) {
          const bounds = getRoomAbsoluteBounds(room);
          if (bounds.right > maxRight) {
            maxRight = bounds.right;
            topAtMaxRight = bounds.top;
          }
        }
        newRoom.floorPosition.x = maxRight;
        newRoom.floorPosition.y = topAtMaxRight;
      }
    } else {
      const viewportKey = `floor:${floor.id}`;
      const vp = getViewport(viewportKey);
      if (vp?.effectiveViewBox) {
        const vb = vp.effectiveViewBox;
        newRoom.floorPosition.x = Math.round(vb.minX + (vb.width - newRoom.widthCm) / 2);
        newRoom.floorPosition.y = Math.round(vb.minY + (vb.height - newRoom.heightCm) / 2);
      } else {
        const bg = nextFloor.layout?.background;
        if (bg?.nativeWidth && bg?.nativeHeight) {
          const nativeW = bg.nativeWidth;
          let pixelsPerCm = bg.scale?.calibrated ? bg.scale.pixelsPerCm : (nativeW / 1000);
          const imgWidth = nativeW / pixelsPerCm;
          const imgHeight = bg.nativeHeight / pixelsPerCm;
          newRoom.floorPosition.x = Math.round((imgWidth - newRoom.widthCm) / 2);
          newRoom.floorPosition.y = Math.round((imgHeight - newRoom.heightCm) / 2);
        } else {
          newRoom.floorPosition.x = 350;
          newRoom.floorPosition.y = 250;
        }
      }
    }

    nextFloor.rooms.push(newRoom);
    next.selectedRoomId = newRoom.id;
    syncFloorWalls(nextFloor);

    store.commit(t("room.added") || "Room added", next, { onRender: renderAll, updateMetaCb: updateMeta });
  });

  // Floor view - Add circle demo room
  document.getElementById("floorAddCircle")?.addEventListener("click", () => {
    cancelFreeformDrawing();
    cancelCalibrationMode();
    const state = store.getState();
    const floor = getCurrentFloor(state);
    if (!floor) return;

    const next = deepClone(state);
    const nextFloor = next.floors.find(f => f.id === floor.id);

    const floorRoomCount = nextFloor.rooms.length;
    const newRoom = createSurface({ name: `${t("room.newRoom")} ${floorRoomCount + 1}`, circleRadius: 100, surfaceType: "floor" });

    // Position new room
    if (nextFloor.rooms.length > 0) {
      const position = findPositionOnFreeEdge(newRoom, nextFloor.rooms, 'right');
      if (position) {
        newRoom.floorPosition.x = position.x;
        newRoom.floorPosition.y = position.y;
      } else {
        let maxRight = -Infinity;
        let topAtMaxRight = 0;
        for (const room of nextFloor.rooms) {
          const bounds = getRoomAbsoluteBounds(room);
          if (bounds.right > maxRight) {
            maxRight = bounds.right;
            topAtMaxRight = bounds.top;
          }
        }
        newRoom.floorPosition.x = maxRight;
        newRoom.floorPosition.y = topAtMaxRight;
      }
    } else {
      const viewportKey = `floor:${floor.id}`;
      const vp = getViewport(viewportKey);
      if (vp?.effectiveViewBox) {
        const vb = vp.effectiveViewBox;
        newRoom.floorPosition.x = Math.round(vb.minX + (vb.width - newRoom.widthCm) / 2);
        newRoom.floorPosition.y = Math.round(vb.minY + (vb.height - newRoom.heightCm) / 2);
      } else {
        newRoom.floorPosition.x = 350;
        newRoom.floorPosition.y = 250;
      }
    }

    nextFloor.rooms.push(newRoom);
    next.selectedRoomId = newRoom.id;

    syncFloorWalls(nextFloor);

    store.commit("Circle room added", next, { onRender: renderAll, updateMetaCb: updateMeta });
  });

  // 3D view quick controls — Exit 3D toggles off the 3D flag
  document.getElementById("threeDBackToFloor")?.addEventListener("click", () => {
    toggle3D();
  });
  document.getElementById("threeDResetCamera")?.addEventListener("click", () => {
    threeViewController?.resetCamera();
  });

  document.getElementById("floorDeleteRoom")?.addEventListener("click", () => {
    const state = store.getState();
    const floor = getCurrentFloor(state);
    if (!floor || !state.selectedRoomId) return;

    const next = deepClone(state);
    const nextFloor = next.floors.find(f => f.id === floor.id);
    const roomIndex = nextFloor.rooms.findIndex(r => r.id === state.selectedRoomId);

    if (roomIndex !== -1) {
      const deletedRoomId = state.selectedRoomId;

      // Delete the room
      nextFloor.rooms.splice(roomIndex, 1);
      syncFloorWalls(nextFloor);

      // Select another room if available
      next.selectedRoomId = nextFloor.rooms[Math.max(0, Math.min(roomIndex, nextFloor.rooms.length - 1))]?.id || null;
      next.selectedWallId = null;

      store.commit(t("room.deleted") || "Room deleted", next, { onRender: renderAll, updateMetaCb: updateMeta });
    }
  });

  // Draw Room button - start polygon drawing mode
  document.getElementById("floorDrawRoom")?.addEventListener("click", () => {
    const state = store.getState();
    if (state.view?.planningMode !== "floor") return;

    const drawRoomBtn = document.getElementById("floorDrawRoom");
    if (drawRoomBtn) drawRoomBtn.classList.add("active");

    polygonDrawController.startDrawing({
      onComplete: (polygonPoints) => {
        if (drawRoomBtn) drawRoomBtn.classList.remove("active");

      // Create room from polygon
      const newRoom = polygonDrawController.createRoomFromPolygon(polygonPoints);
      if (!newRoom) return;

      const state = store.getState();
      const next = deepClone(state);
      const nextFloor = next.floors.find(f => f.id === state.selectedFloorId);

      // Name with counter based on existing non-wall rooms
      if (nextFloor) {
        const floorRoomCount = nextFloor.rooms.length;
        newRoom.name = `${t("room.newRoom")} ${floorRoomCount + 1}`;
      }

      if (nextFloor) {
        const { modifiedRoomIds, errors } = subtractOverlappingAreas(newRoom, nextFloor.rooms);

        if (errors.length > 0) {
          console.warn("Overlap subtraction errors:", errors);
        }

        nextFloor.rooms.push(newRoom);
        next.selectedRoomId = newRoom.id;
        syncFloorWalls(nextFloor);

        const commitLabel = modifiedRoomIds.length > 0
          ? t("room.addedWithOverlapRemoved") || "Room added (overlap removed from existing rooms)"
          : t("room.added") || "Room added";

        store.commit(commitLabel, next, { onRender: renderAll, updateMetaCb: updateMeta });
      }
      },
      onCancel: () => {
        if (drawRoomBtn) drawRoomBtn.classList.remove("active");
      }
    });
  });

  // Pattern Groups View - Button handlers (same pattern as floor view buttons)
  const pgCreateGroupBtn = document.getElementById("pgCreateGroup");
  pgCreateGroupBtn?.addEventListener("click", () => {
    const state = store.getState();
    const next = deepClone(state);
    const floor = next.floors?.find(f => f.id === next.selectedFloorId);
    const roomId = next.selectedRoomId;

    if (!floor || !roomId) {
      return;
    }

    const group = createPatternGroup(floor, roomId);
    if (group) {
      activeTargetGroupId = group.id;
      store.commit(t("patternGroups.created") || "Pattern group created", next, { onRender: renderAll, updateMetaCb: updateMeta });
    }
  });

  document.getElementById("pgAddToGroup")?.addEventListener("click", () => {
    const state = store.getState();
    const next = deepClone(state);
    const floor = next.floors?.find(f => f.id === next.selectedFloorId);
    const roomId = next.selectedRoomId;

    if (!floor || !roomId || !activeTargetGroupId) return;

    // Add to the active target group (selected in dropdown)
    if (canJoinPatternGroup(floor, activeTargetGroupId, roomId)) {
      if (addRoomToPatternGroup(floor, activeTargetGroupId, roomId)) {
        store.commit(t("patternGroups.roomAdded") || "Room added to group", next, { onRender: renderAll, updateMetaCb: updateMeta });
      }
    }
  });

  document.getElementById("pgRemoveFromGroup")?.addEventListener("click", async () => {
    const state = store.getState();
    const floor = getCurrentFloor(state);
    const roomId = state.selectedRoomId;

    if (!floor || !roomId) return;

    const group = getRoomPatternGroup(floor, roomId);
    if (!group) return;

    // Check for disconnected rooms before removal
    const disconnectedRooms = getDisconnectedRoomsOnRemoval(floor, group.id, roomId);
    if (disconnectedRooms.length > 0) {
      const roomNames = disconnectedRooms.map(id => {
        const room = floor.rooms?.find(r => r.id === id);
        return room?.name || id;
      }).join(", ");
      const message = (t("patternGroups.removeDisconnectWarning") ||
        "Removing this room will also disconnect: {rooms}. Continue?").replace("{rooms}", roomNames);
      const confirmed = await showConfirm({
        title: t("dialog.removeFromGroupTitle") || "Remove Room?",
        message,
        confirmText: t("dialog.continue") || "Continue",
        cancelText: t("dialog.cancel") || "Cancel",
        danger: true
      });
      if (!confirmed) return;
    }

    const next = deepClone(state);
    const nextFloor = next.floors?.find(f => f.id === next.selectedFloorId);
    const result = removeRoomFromPatternGroup(nextFloor, group.id, roomId);

    if (result.success) {
      const msg = t("patternGroups.roomRemoved") || "Room removed from group";
      store.commit(msg, next, { onRender: renderAll, updateMetaCb: updateMeta });
    }
  });

  document.getElementById("pgSetOrigin")?.addEventListener("click", () => {
    const state = store.getState();
    const floor = getCurrentFloor(state);
    const roomId = state.selectedRoomId;

    if (!floor || !roomId) return;

    const group = getRoomPatternGroup(floor, roomId);
    if (!group || group.originRoomId === roomId) return;

    const next = deepClone(state);
    const nextFloor = next.floors?.find(f => f.id === next.selectedFloorId);
    const nextGroup = nextFloor.patternGroups.find(g => g.id === group.id);

    if (changePatternGroupOrigin(nextFloor, nextGroup.id, roomId)) {
      store.commit(t("patternGroups.originChanged") || "Origin room changed", next, { onRender: renderAll, updateMetaCb: updateMeta });
    }
  });

  document.getElementById("pgDissolveGroup")?.addEventListener("click", async () => {
    const state = store.getState();
    const floor = getCurrentFloor(state);
    const roomId = state.selectedRoomId;

    if (!floor || !roomId) return;

    const group = getRoomPatternGroup(floor, roomId);
    if (!group) return;

    const confirmMsg = t("patternGroups.dissolveConfirm") ||
      "This will dissolve the pattern group. All rooms will become independent. Continue?";
    const confirmed = await showConfirm({
      title: t("dialog.dissolveGroupTitle") || "Dissolve Group?",
      message: confirmMsg,
      confirmText: t("dialog.continue") || "Continue",
      cancelText: t("dialog.cancel") || "Cancel",
      danger: true
    });
    if (!confirmed) return;

    const next = deepClone(state);
    const nextFloor = next.floors?.find(f => f.id === next.selectedFloorId);

    if (dissolvePatternGroup(nextFloor, group.id)) {
      store.commit(t("patternGroups.dissolved") || "Pattern group dissolved", next, { onRender: renderAll, updateMetaCb: updateMeta });
    }
  });

  function syncQuickControls() {
    const state = store.getState();
    const floor = state.floors?.find(f => f.id === state.selectedFloorId);
    const room = floor?.rooms?.find(r => r.id === state.selectedRoomId);

    // Check if room is a child in a pattern group (tile settings are inherited)
    const isChild = room ? isPatternGroupChild(room, floor) : false;
    const effectiveSettings = isChild ? getEffectiveTileSettings(room, floor) : null;
    const displayTile = isChild && effectiveSettings ? effectiveSettings.tile : room?.tile;
    const displayPattern = isChild && effectiveSettings ? effectiveSettings.pattern : room?.pattern;
    const displayGrout = isChild && effectiveSettings ? effectiveSettings.grout : room?.grout;

    if (room) {
      if (quickTilePreset) {
        quickTilePreset.innerHTML = "";
        const presets = state.tilePresets || [];
        presets.forEach(p => {
          const opt = document.createElement("option");
          opt.value = p.id;
          opt.textContent = p.name || t("project.none");
          quickTilePreset.appendChild(opt);
        });
        const match = presets.find(p => p.name && p.name === displayTile?.reference);
        quickTilePreset.value = match ? match.id : (presets[0]?.id || "");
        quickTilePreset.disabled = isChild || presets.length === 0;
        const quickGroup = document.getElementById("quickTilePresetGroup");
        if (quickGroup) quickGroup.classList.toggle("no-presets", presets.length === 0);
        const quickCreate = document.getElementById("quickCreateTilePreset");
        if (quickCreate) quickCreate.classList.toggle("hidden", presets.length > 0);
        quickTilePreset.classList.toggle("hidden", presets.length === 0);
      }
      if (quickPattern) {
        quickPattern.value = displayPattern?.type || "grid";
        quickPattern.disabled = isChild;
      }
      // Display grout in mm (state stores cm)
      if (quickGrout) {
        quickGrout.value = Math.round((displayGrout?.widthCm || 0) * 10);
        quickGrout.disabled = isChild;
      }

      // Add locked class to quick control groups for overlay styling
      const quickTileGroup = document.getElementById("quickTilePresetGroup");
      const quickPatternGroup = quickPattern?.closest(".quick-control-group");
      const quickGroutGroup = quickGrout?.closest(".quick-control-group");

      // Get origin room name for the alert message
      const group = isChild ? getRoomPatternGroup(floor, room.id) : null;
      const originRoom = group ? floor.rooms?.find(r => r.id === group.originRoomId) : null;
      const originName = originRoom?.name || "Origin";

      [quickTileGroup, quickPatternGroup, quickGroutGroup].forEach(grp => {
        if (grp) {
          grp.classList.toggle("pattern-group-locked", isChild);
          if (isChild) {
            grp.dataset.originName = originName;
          }
        }
      });
    }

    // Sync quick toggles with main toggles
    const mainRemovalMode = document.getElementById("removalMode");
    syncQuickViewToggleStates();
    if (quickRemovalMode && mainRemovalMode) quickRemovalMode.checked = mainRemovalMode.checked;

    // Sync planning floor selector
    if (planningFloorSelect) {
      planningFloorSelect.innerHTML = "";
      state.floors?.forEach(f => {
        const opt = document.createElement("option");
        opt.value = f.id;
        opt.textContent = f.name || "Untitled";
        if (f.id === state.selectedFloorId) opt.selected = true;
        planningFloorSelect.appendChild(opt);
      });
    }

    // Sync planning room selector
    if (planningRoomSelect) {
      const floor = state.floors?.find(f => f.id === state.selectedFloorId);
      planningRoomSelect.innerHTML = "";
      const floorRooms = floor?.rooms || [];

      floorRooms.forEach(r => {
        const opt = document.createElement("option");
        opt.value = r.id;
        opt.textContent = r.name || "Untitled";
        if (r.id === state.selectedRoomId) opt.selected = true;
        planningRoomSelect.appendChild(opt);
      });
    }

    // Sync surface selector (floor + walls for current room)
    const wallSelect = document.getElementById("wallSelect");
    if (wallSelect) {
      const floor = state.floors?.find(f => f.id === state.selectedFloorId);
      wallSelect.innerHTML = "";

      const walls = room && floor ? getWallsForRoom(floor, room.id) : [];

      if (!room) {
        const opt = document.createElement("option");
        opt.value = "";
        opt.textContent = "—";
        wallSelect.appendChild(opt);
        wallSelect.disabled = true;
      } else {
        wallSelect.disabled = false;

        // Floor surface (the room itself) is the first entry
        const floorOpt = document.createElement("option");
        floorOpt.value = "";
        floorOpt.textContent = t("tabs.floorSurface") || "Floor";
        if (!state.selectedWallId) floorOpt.selected = true;
        wallSelect.appendChild(floorOpt);

        walls.forEach((w, idx) => {
          const edgeIdx = w.roomEdge?.edgeIndex ?? idx;
          const opt = document.createElement("option");
          opt.value = w.id;
          opt.textContent = `${room.name} · Wall ${edgeIdx + 1}`;
          if (w.id === state.selectedWallId) opt.selected = true;
          wallSelect.appendChild(opt);
        });
      }
    }

    // Update area display
    const planningArea = document.getElementById("planningArea");
    if (planningArea && room) {
      const bounds = getRoomBounds(room);
      const totalArea = (bounds.width * bounds.height) / 10000;
      planningArea.textContent = totalArea.toFixed(2) + " m²";
    }

    // Hide tile/grout/pattern settings when wall surface is selected (use modal instead)
    const isSurfaceSelected = Boolean(state.selectedWallId);
    const tileSection = document.getElementById("planningTileSection");
    const groutSection = document.getElementById("groutW")?.closest(".panel-section");
    const patternSection = document.getElementById("patternType")?.closest(".panel-section");

    if (tileSection) tileSection.style.display = isSurfaceSelected ? "none" : "";
    if (groutSection) groutSection.style.display = isSurfaceSelected ? "none" : "";
    if (patternSection) patternSection.style.display = isSurfaceSelected ? "none" : "";

    // Show hint message when surface is selected
    let surfaceHint = document.getElementById("surfaceEditHint");
    if (isSurfaceSelected && !surfaceHint) {
      surfaceHint = document.createElement("div");
      surfaceHint.id = "surfaceEditHint";
      surfaceHint.className = "panel-section";
      surfaceHint.innerHTML = `
        <div class="meta subtle" style="text-align: center; padding: 20px;">
          <p data-i18n="planning.surfaceEditHint">Double-click the wall surface to edit its tiling configuration.</p>
        </div>`;
      const settingsContent = document.querySelector(".settings-panel-content");
      if (settingsContent) settingsContent.appendChild(surfaceHint);
    }
    if (surfaceHint) surfaceHint.style.display = isSurfaceSelected ? "" : "none";
  }

  function enhanceNumberSpinners() {
    document.querySelectorAll('input[type="number"]').forEach(input => {
      if (input.dataset.spinner === "true") return;
      if (input.closest(".quick-spinner")) {
        input.classList.add("spinner-input");
        input.dataset.spinner = "true";
        return;
      }

      const wrapper = document.createElement("div");
      wrapper.className = "quick-spinner";

      const dec = document.createElement("button");
      dec.type = "button";
      dec.className = "quick-spinner-btn";
      dec.textContent = "−";

      const inc = document.createElement("button");
      inc.type = "button";
      inc.className = "quick-spinner-btn";
      inc.textContent = "+";

      const stepValue = () => {
        const step = parseFloat(input.step);
        return Number.isFinite(step) && step > 0 ? step : 1;
      };
      const minValue = () => {
        if (input.min === "") return null;
        const min = parseFloat(input.min);
        return Number.isFinite(min) ? min : null;
      };

      const applyDelta = (dir) => {
        let value = parseFloat(input.value);
        if (!Number.isFinite(value)) value = 0;
        value += dir * stepValue();
        const min = minValue();
        if (min !== null) value = Math.max(min, value);
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      };

      dec.addEventListener("click", () => applyDelta(-1));
      inc.addEventListener("click", () => applyDelta(1));

      input.classList.add("no-spinner", "spinner-input");
      input.dataset.spinner = "true";

      input.replaceWith(wrapper);
      wrapper.appendChild(dec);
      wrapper.appendChild(input);
      wrapper.appendChild(inc);
    });
  }

  // Update zoom indicator
  function updateZoomIndicator() {
    const state = store.getState();
    // Use floor viewport key when in floor view
    const viewportKey = state.view?.planningMode === "floor"
      ? `floor:${state.selectedFloorId}`
      : state.selectedRoomId;
    const vp = getViewport(viewportKey);

    // Update room, floor, and pattern groups zoom indicators
    const zoomLevel = document.getElementById("zoomLevel");
    const floorZoomLevel = document.getElementById("floorZoomLevel");
    const pgZoomLevel = document.getElementById("pgZoomLevel");

    const zoomText = `${Math.round(vp.zoom * 100)}%`;
    if (zoomLevel) zoomLevel.textContent = zoomText;
    if (floorZoomLevel) floorZoomLevel.textContent = zoomText;
    if (pgZoomLevel) pgZoomLevel.textContent = zoomText;
  }

  // Sync floor quick controls (floor selector and name in floor view)
  function syncFloorQuickControls() {
    const state = store.getState();
    const floorSelect = document.getElementById("floorQuickSelect");
    const floorNameInput = document.getElementById("floorQuickName");
    const deleteFloorBtn = document.getElementById("floorQuickDeleteFloor");

    if (floorSelect) {
      floorSelect.innerHTML = "";
      state.floors?.forEach(f => {
        const opt = document.createElement("option");
        opt.value = f.id;
        opt.textContent = f.name || t("project.none");
        if (f.id === state.selectedFloorId) opt.selected = true;
        floorSelect.appendChild(opt);
      });
    }

    const currentFloor = getCurrentFloor(state);
    if (floorNameInput) {
      floorNameInput.value = currentFloor?.name || "";
    }

    // Disable delete if only one floor
    if (deleteFloorBtn) {
      deleteFloorBtn.disabled = (state.floors?.length || 0) <= 1;
    }
  }

  // Sync background controls with floor state
  function syncBackgroundControls() {
    const state = store.getState();
    const floor = getCurrentFloor(state);
    const hasBackground = Boolean(floor?.layout?.background?.dataUrl);
    const showFloorTiles = state.view?.showFloorTiles || false;

    const bgCalibrateBtn = document.getElementById("bgCalibrateBtn");
    const bgOpacitySlider = document.getElementById("bgOpacitySlider");
    const floorShowTilesEl = document.getElementById("floorShowTiles");
    const floorAddRoom = document.getElementById("floorAddRoom");
    const floorDrawRoom = document.getElementById("floorDrawRoom");
    const floorDeleteRoom = document.getElementById("floorDeleteRoom");

    if (bgCalibrateBtn) bgCalibrateBtn.disabled = !hasBackground;
    if (bgOpacitySlider) {
      bgOpacitySlider.disabled = !hasBackground;
      if (hasBackground && floor?.layout?.background?.opacity !== undefined) {
        bgOpacitySlider.value = Math.round(floor.layout.background.opacity * 100);
      }
    }

    // Floor tiles toggle
    if (floorShowTilesEl) {
      floorShowTilesEl.checked = showFloorTiles;
    }

    // Room controls - only disable delete if no selection
    if (floorDeleteRoom) {
      const hasSelection = !!state.selectedRoomId;
      floorDeleteRoom.disabled = !hasSelection;
    }
  }

  // Sync the pattern groups dropdown (in quick controls bar)
  function syncGroupDropdown() {
    const state = store.getState();
    const groupSelect = document.getElementById("pgGroupSelect");

    if (!groupSelect) return;

    const floor = getCurrentFloor(state);
    const groups = floor?.patternGroups || [];

    groupSelect.innerHTML = "";

    if (groups.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = t("patternGroups.noGroups") || "No groups";
      groupSelect.appendChild(opt);
      groupSelect.disabled = true;
      activeTargetGroupId = null;
      return;
    }

    groupSelect.disabled = false;

    for (const group of groups) {
      const originRoom = floor.rooms?.find(r => r.id === group.originRoomId);
      const opt = document.createElement("option");
      opt.value = group.id;
      opt.textContent = `${originRoom?.name || "Group"} (${group.memberRoomIds.length})`;
      if (group.id === activeTargetGroupId) opt.selected = true;
      groupSelect.appendChild(opt);
    }

    // Auto-select first group if none selected
    if (!activeTargetGroupId && groups.length > 0) {
      activeTargetGroupId = groups[0].id;
      groupSelect.value = activeTargetGroupId;
    }

    // Ensure selection is valid
    if (activeTargetGroupId && !groups.find(g => g.id === activeTargetGroupId)) {
      activeTargetGroupId = groups[0]?.id || null;
      if (activeTargetGroupId) groupSelect.value = activeTargetGroupId;
    }
  }

  // Register the sync function as the post-render hook
  afterRenderHook = () => {
    syncDimensionsFromState();
    syncQuickControls();
    enhanceNumberSpinners();
    updateZoomIndicator();
    syncBackgroundControls();
    syncFloorQuickControls();
    // Sync view toggle UI with state
    const state = store.getState();
    updateViewToggleUI(state);
    updateFloorControlsState(state);
    updateRoomDeleteButtonState();
    // Update pattern groups controls if in that view
    if (state.view?.planningMode === "patternGroups") {
      updatePatternGroupsControlsState();
      syncGroupDropdown();
    } else {
      // Reset group dropdown state when not in pattern groups view
      syncGroupDropdown();
    }
  };

  function commitQuickTilePreset() {
    const presetId = quickTilePreset?.value;
    if (!presetId) return;
    const state = store.getState();
    const preset = state.tilePresets?.find(p => p.id === presetId);
    if (!preset) return;
    const floorIdx = state.floors?.findIndex(f => f.id === state.selectedFloorId);
    const roomIdx = state.floors?.[floorIdx]?.rooms?.findIndex(r => r.id === state.selectedRoomId);
    if (floorIdx < 0 || roomIdx < 0) return;

    const next = JSON.parse(JSON.stringify(state));
    const room = next.floors[floorIdx].rooms[roomIdx];
    room.tile.shape = preset.shape || room.tile.shape;
    room.tile.widthCm = Number(preset.widthCm) || room.tile.widthCm;
    room.tile.heightCm = Number(preset.heightCm) || room.tile.heightCm;
    room.tile.reference = preset.name || room.tile.reference;
    room.grout.widthCm = Number(preset.groutWidthCm) || 0;
    room.grout.colorHex = preset.groutColorHex || room.grout.colorHex;
    if (preset.useForSkirting) {
      room.skirting.enabled = true;
      room.skirting.type = "cutout";
    }
    const ref = room.tile.reference;
    if (ref) {
      next.materials = next.materials || {};
      next.materials[ref] = next.materials[ref] || {
        pricePerM2: next.pricing?.pricePerM2 || 0,
        packM2: next.pricing?.packM2 || 0
      };
      if (Number.isFinite(preset.pricePerM2)) next.materials[ref].pricePerM2 = Number(preset.pricePerM2);
      if (Number.isFinite(preset.packM2)) next.materials[ref].packM2 = Number(preset.packM2);
    }
    commitViaStore(t("tile.changed"), next);
  }

  function commitQuickPattern() {
    const state = store.getState();
    const floorIdx = state.floors?.findIndex(f => f.id === state.selectedFloorId);
    const roomIdx = state.floors?.[floorIdx]?.rooms?.findIndex(r => r.id === state.selectedRoomId);
    if (floorIdx < 0 || roomIdx < 0) return;

    const next = JSON.parse(JSON.stringify(state));
    next.floors[floorIdx].rooms[roomIdx].pattern.type = quickPattern?.value || "grid";
    commitViaStore(t("tile.patternChanged"), next);
  }

  function commitQuickGrout() {
    const state = store.getState();
    const floorIdx = state.floors?.findIndex(f => f.id === state.selectedFloorId);
    const roomIdx = state.floors?.[floorIdx]?.rooms?.findIndex(r => r.id === state.selectedRoomId);
    if (floorIdx < 0 || roomIdx < 0) return;

    // Convert mm input to cm for state
    const newGmm = parseFloat(quickGrout?.value) || 0;
    if (newGmm < 0) return;
    const newGcm = newGmm / 10;

    const next = JSON.parse(JSON.stringify(state));
    next.floors[floorIdx].rooms[roomIdx].grout.widthCm = newGcm;
    commitViaStore(t("tile.changed"), next);
  }

  quickTilePreset?.addEventListener("change", commitQuickTilePreset);
  quickPattern?.addEventListener("change", commitQuickPattern);
  quickGrout?.addEventListener("change", commitQuickGrout);

  // Show alert when trying to interact with disabled pattern group child controls
  function showPatternGroupChildAlert() {
    const state = store.getState();
    const floor = getCurrentFloor(state);
    const room = getCurrentRoom(state);
    if (!room || !floor) return;

    const group = getRoomPatternGroup(floor, room.id);
    if (!group) return;

    const originRoom = floor.rooms?.find(r => r.id === group.originRoomId);
    const message = t("patternGroups.childCannotEdit").replace("{origin}", originRoom?.name || "Origin");
    showAlert({ title: t("patternGroups.roomInGroup"), message });
  }

  // Add click handlers for disabled quick controls
  [quickTilePreset, quickPattern, quickGrout].forEach(el => {
    if (el) {
      el.addEventListener("mousedown", (e) => {
        if (el.disabled) {
          e.preventDefault();
          e.stopPropagation();
          showPatternGroupChildAlert();
        }
      }, true);
    }
  });

  // Click handler for all pattern-group-locked elements (settings panel and quick controls)
  document.addEventListener("click", (e) => {
    const lockedElement = e.target.closest(".pattern-group-locked");
    if (lockedElement) {
      e.preventDefault();
      e.stopPropagation();
      // Get origin name from data attribute or fall back to computing it
      const originName = lockedElement.dataset.originName;
      if (originName) {
        const message = t("patternGroups.childCannotEdit").replace("{origin}", originName);
        showAlert({ title: t("patternGroups.roomInGroup"), message });
      } else {
        showPatternGroupChildAlert();
      }
    }
  }, true);

  // Spinner button handlers
  document.querySelectorAll(".quick-spinner-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const targetId = btn.dataset.target;
      const action = btn.dataset.action;
      const input = document.getElementById(targetId);
      if (!input) return;

      const step = parseFloat(input.step) || 1;
      const min = parseFloat(input.min) || 0;
      let value = parseFloat(input.value) || 0;

      if (action === "increment") {
        value += step;
      } else if (action === "decrement") {
        value = Math.max(min, value - step);
      }

      input.value = value;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  });

  // Floor quick controls (in floor view bottom bar)
  document.getElementById("floorQuickSelect")?.addEventListener("change", (e) => {
    cancelFreeformDrawing(); // Cancel any active freeform drawing
    cancelCalibrationMode(); // Cancel any active calibration
    structure.selectFloor(e.target.value);
  });

  document.getElementById("floorQuickName")?.addEventListener("change", (e) => {
    const state = store.getState();
    const next = deepClone(state);
    const floor = getCurrentFloor(next);
    if (!floor) return;

    floor.name = e.target.value || floor.name;
    store.commit(t("structure.floorChanged"), next, { onRender: renderAll, updateMetaCb: updateMeta });
  });

  document.getElementById("floorQuickAddFloor")?.addEventListener("click", () => {
    structure.addFloor();
  });

  document.getElementById("floorQuickDeleteFloor")?.addEventListener("click", async () => {
    const state = store.getState();
    if (!state.floors || state.floors.length <= 1) {
      await showAlert({
        title: t("dialog.warning") || "Warning",
        message: t("dialog.cannotDeleteLastFloor") || "Cannot delete the last floor",
        type: "warning"
      });
      return;
    }

    const currentFloor = getCurrentFloor(state);
    const floorName = currentFloor?.name || t("structure.floor");

    const confirmed = await showConfirm({
      title: t("dialog.confirmDeleteFloorTitle") || "Delete Floor?",
      message: (t("dialog.confirmDeleteFloorText") || "Are you sure you want to delete \"{name}\"? All rooms on this floor will be permanently deleted.").replace("{name}", floorName),
      confirmText: t("dialog.delete") || "Delete",
      cancelText: t("dialog.cancel") || "Cancel",
      danger: true
    });

    if (confirmed) {
      structure.deleteFloor();
    }
  });

  // Room dimensions (uses polygonVertices bounds)
  const roomWidthInput = document.getElementById("roomWidth");
  const roomLengthInput = document.getElementById("roomLength");

  function syncDimensionsFromState() {
    const state = store.getState();
    const room = state.floors
      ?.find(f => f.id === state.selectedFloorId)
      ?.rooms?.find(r => r.id === state.selectedRoomId);

    if (room?.polygonVertices?.length >= 3) {
      const bounds = getRoomBounds(room);
      if (roomWidthInput) roomWidthInput.value = bounds.width || "";
      if (roomLengthInput) roomLengthInput.value = bounds.height || "";
    }
  }

  function commitDimensions() {
    const state = store.getState();
    const floorIdx = state.floors?.findIndex(f => f.id === state.selectedFloorId);
    const roomIdx = state.floors?.[floorIdx]?.rooms?.findIndex(r => r.id === state.selectedRoomId);

    if (floorIdx < 0 || roomIdx < 0) return;

    const room = state.floors[floorIdx].rooms[roomIdx];
    // Only allow dimension editing for simple rectangular rooms (4 vertices)
    if (!room.polygonVertices || room.polygonVertices.length !== 4) return;

    const newW = parseFloat(roomWidthInput?.value) || 0;
    const newH = parseFloat(roomLengthInput?.value) || 0;

    if (newW <= 0 || newH <= 0) return;

    const next = JSON.parse(JSON.stringify(state));
    next.floors[floorIdx].rooms[roomIdx].polygonVertices = [
      { x: 0, y: 0 },
      { x: newW, y: 0 },
      { x: newW, y: newH },
      { x: 0, y: newH }
    ];
    next.floors[floorIdx].rooms[roomIdx].widthCm = newW;
    next.floors[floorIdx].rooms[roomIdx].heightCm = newH;

    commitViaStore(t("room.changed"), next);
  }

  roomWidthInput?.addEventListener("change", commitDimensions);
  roomLengthInput?.addEventListener("change", commitDimensions);

  // Resize observer for 3D canvas
  const svgWrap = document.querySelector(".svgWrap");
  if (svgWrap) {
    new ResizeObserver(() => {
      if (threeViewController?.isActive()) threeViewController.resize();
    }).observe(svgWrap);
  }

  updateAllTranslations();
  renderAll(hadSession ? t("init.withSession") : t("init.default"));
})();
