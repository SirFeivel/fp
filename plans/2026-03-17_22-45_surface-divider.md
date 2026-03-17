# Plan: Surface Divider
**Branch:** `surface-devider`
**Date:** 2026-03-17

---

## Scorecard

| Dimension | Score | Evidence |
|---|---|---|
| **Hacky** | 8 | (1) Pure vertex-walk split — no new lib. (2) `dividers`/`zoneSettings` optional fields, exact same pattern as `exclusions`/`excludedTiles` on both rooms and wall surfaces. (3) `computeZoneTiles` mirrors `computeSubSurfaceTiles` exactly. (4) `computeSurfaceTiles` called unchanged. (5) `renderSurface3D` called unchanged. (6) Wall surfaces use `roomOverride` → same `renderPlanSvg` path: no separate render branch. (7) State migration V15 follows established chain. (8) No new abstractions — draw controller is the only new concept. −2: draw controller is genuinely new code |
| **Compliance** | 9 | (1) `isPointInPolygon` moved to geometry.js — one source of truth, polygon-draw.js imports from there. (2) `findNearestEdgePoint` imported from polygon-draw.js — not reimplemented. (3) Geometry in geometry.js ✓. (4) Tile compute in walls.js ✓. (5) Draw controller in divider-draw.js ✓. (6) State mutations behind `store.commit` ✓. (7) Migration V15 in state.js with explicit wall surface backfill ✓. (8) `commitZoneSettings` in dividers.js — correct layer ✓. (9) No circular deps: geometry.js ← polygon-draw.js already established ✓ |
| **Complexity** | 7 | (1) `splitPolygonByLine`: ~30 lines with explicit edge-case guards. (2) `insertPointOnRing`: ~20 lines, guards for `t < ε` and `t > 1−ε` (coincident endpoint prevention). (3) `computeZones`: ~20 lines. (4) `deriveDividerZoneName`: ~20 lines. (5) `computeZoneTiles`: ~25 lines. (6) render.js additions: ~35 lines. (7) `divider-draw.js`: ~90 lines. (8) `dividers.js` controller: ~60 lines. −1: polygon winding order preservation under `insertPointOnRing` not formally verified — covered by unit tests |
| **Problem Understanding** | 8 | (1) `createDefaultSurface` confirmed: `exclusions: []` pattern → exact same for `dividers: []`. (2) `computeSubSurfaceTiles` is the exact template for `computeZoneTiles`. (3) `findNearestEdgePoint` exported from polygon-draw.js at line 204 — confirmed usable. (4) `isPointInPolygon` in polygon-draw.js at line 370, non-exported — move to geometry.js. (5) `renderPlanSvg` uses `roomOverride` → wall surface and floor room share the same render path. (6) State normalization room loop at lines 165–230 — exact insertion point confirmed. (7) Wall surfaces NOT in state.js normalization loop → migration must explicitly backfill `floor.walls[].surfaces[]`. (8) `wallSurfaceToTileableRegion` return object (lines 1565–1579) explicitly selects fields — does NOT forward `dividers`/`zoneSettings` → **must add them to the return**. (9) State V14 is current, V15 is next. −1: zone ID stability under repeated divider moves (centroid can shift) not fully modelled |
| **Confidence** | 5 | (1) Vertex-walk polygon split is standard algorithm. (2) `computeZoneTiles` pattern proven by `computeSubSurfaceTiles` (committed, working). (3) `roomOverride` path confirmed — wall surface region IS the `currentRoom` in `renderPlanSvg`. (4) `wallSurfaceToTileableRegion` gap found and explicitly fixed in Step 3. (5) State migration backfill pattern proven through 14 versions. −2: polygon edge insertion edge cases tested by unit tests but not runtime-verified; −2: multi-divider stacking complex; −1: draw controller new code, no runtime evidence |

---

## Data Model

No structural change to existing types. Both rooms and `wall.surfaces[n]` gain two optional fields:

```js
dividers: [{ id, p1: {x, y}, p2: {x, y} }]
zoneSettings: { [zoneId]: { tile, grout, pattern, label } }
// zoneId = "zone_${Math.round(cx)}_${Math.round(cy)}" — derived from zone centroid
```

Zones are **computed** from `polygonVertices + dividers` at render time. `zoneSettings` keys persist across re-renders as long as the divider doesn't move significantly (centroid-stable).

---

## Steps

### Step 1 — Move `isPointInPolygon` to `geometry.js`; add polygon split functions

**Move `isPointInPolygon`**: Cut from `polygon-draw.js` (line 370, currently non-exported). Add `export function isPointInPolygon` to `geometry.js`. Update `polygon-draw.js` to import from `./geometry.js`. Resolves one-source-of-truth violation.

**`insertPointOnRing(vertices, pt)`** — inserts `pt` into the polygon vertex ring at the nearest edge:

```js
function insertPointOnRing(vertices, pt) {
  let bestIdx = -1, bestT = -1, bestDist = Infinity;
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const a = vertices[i], b = vertices[(i + 1) % n];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < 0.0001) continue;
    const t = Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / len2));
    const px = a.x + t * dx, py = a.y + t * dy;
    const dist = Math.hypot(pt.x - px, pt.y - py);
    if (dist < bestDist) { bestDist = dist; bestIdx = i; bestT = t; }
  }
  if (bestIdx < 0) {
    console.warn(`[geometry:insertPointOnRing] no edge found for pt=(${pt.x.toFixed(1)},${pt.y.toFixed(1)})`);
    return vertices;
  }
  // Guard: don't insert if coincident with existing endpoint (t ≈ 0 or t ≈ 1)
  if (bestT < 0.001 || bestT > 0.999) {
    console.log(`[geometry:insertPointOnRing] pt=(${pt.x.toFixed(1)},${pt.y.toFixed(1)}) t=${bestT.toFixed(3)} — coincident with vertex, skipping insert`);
    return vertices;
  }
  const result = [...vertices];
  result.splice(bestIdx + 1, 0, { x: pt.x, y: pt.y });
  console.log(`[geometry:insertPointOnRing] inserted at edge ${bestIdx} t=${bestT.toFixed(3)} dist=${bestDist.toFixed(2)}`);
  return result;
}
```

**`splitPolygonByLine(vertices, p1, p2)`**:

```js
export function splitPolygonByLine(vertices, p1, p2) {
  const verts = insertPointOnRing(insertPointOnRing([...vertices], p1), p2);
  const i1 = verts.findIndex(v => Math.abs(v.x - p1.x) < 0.01 && Math.abs(v.y - p1.y) < 0.01);
  const i2 = verts.findIndex((v, i) => i !== i1 && Math.abs(v.x - p2.x) < 0.01 && Math.abs(v.y - p2.y) < 0.01);
  if (i1 < 0 || i2 < 0 || i1 === i2) {
    console.warn(`[geometry:splitPolygonByLine] degenerate: i1=${i1} i2=${i2} verts=${verts.length}`);
    return null;
  }
  const n = verts.length;
  const a = [], b = [];
  for (let i = i1; ; i = (i + 1) % n) { a.push(verts[i]); if (i === i2) break; }
  for (let i = i2; ; i = (i + 1) % n) { b.push(verts[i]); if (i === i1) break; }
  if (a.length < 3 || b.length < 3) {
    console.warn(`[geometry:splitPolygonByLine] sub-polygon too small: a=${a.length} b=${b.length}`);
    return null;
  }
  console.log(`[geometry:splitPolygonByLine] p1=(${p1.x.toFixed(1)},${p1.y.toFixed(1)}) p2=(${p2.x.toFixed(1)},${p2.y.toFixed(1)}) → a=${a.length} b=${b.length} verts`);
  return [a, b];
}
```

**`computeZones(polygonVertices, dividers)`**:

```js
export function computeZones(polygonVertices, dividers) {
  if (!dividers?.length) {
    const id = zoneId(polygonVertices);
    console.log(`[geometry:computeZones] 0 dividers → 1 zone id=${id}`);
    return [{ id, polygonVertices }];
  }
  let zones = [{ id: zoneId(polygonVertices), polygonVertices }];
  for (const div of dividers) {
    const mid = { x: (div.p1.x + div.p2.x) / 2, y: (div.p1.y + div.p2.y) / 2 };
    const target = zones.find(z => isPointInPolygon(mid, z.polygonVertices));
    if (!target) {
      console.warn(`[geometry:computeZones] div=${div.id} midpoint (${mid.x.toFixed(1)},${mid.y.toFixed(1)}) not in any zone — skipped`);
      continue;
    }
    const halves = splitPolygonByLine(target.polygonVertices, div.p1, div.p2);
    if (!halves) continue;
    zones = zones.filter(z => z !== target);
    zones.push({ id: zoneId(halves[0]), polygonVertices: halves[0] }, { id: zoneId(halves[1]), polygonVertices: halves[1] });
    console.log(`[geometry:computeZones] div=${div.id} → zones now ${zones.length} (ids: ${zones.map(z => z.id).join(', ')})`);
  }
  return zones;
}
function zoneId(verts) {
  const cx = verts.reduce((s, v) => s + v.x, 0) / verts.length;
  const cy = verts.reduce((s, v) => s + v.y, 0) / verts.length;
  return `zone_${Math.round(cx)}_${Math.round(cy)}`;
}
```

**`deriveDividerZoneName(parentVertices, zoneVertices, existingLabels)`**:

```js
export function deriveDividerZoneName(parentVertices, zoneVertices, existingLabels = []) {
  const shoelace = verts => Math.abs(verts.reduce((s, v, i) => {
    const next = verts[(i + 1) % verts.length];
    return s + (v.x * next.y - next.x * v.y);
  }, 0)) / 2;
  const parentArea = shoelace(parentVertices);
  const zoneArea = shoelace(zoneVertices);
  const fraction = parentArea > 0 ? zoneArea / parentArea : 0.5;
  const pCx = parentVertices.reduce((s, v) => s + v.x, 0) / parentVertices.length;
  const pCy = parentVertices.reduce((s, v) => s + v.y, 0) / parentVertices.length;
  const zCx = zoneVertices.reduce((s, v) => s + v.x, 0) / zoneVertices.length;
  const zCy = zoneVertices.reduce((s, v) => s + v.y, 0) / zoneVertices.length;
  // Use larger deviation axis to pick position label
  const dxRel = Math.abs(zCx - pCx), dyRel = Math.abs(zCy - pCy);
  const position = dyRel >= dxRel
    ? (zCy < pCy ? 'top' : 'bottom')
    : (zCx < pCx ? 'left' : 'right');
  const fractionLabels = [[0.25,'quarter'],[0.33,'third'],[0.5,'half'],[0.67,'two-thirds'],[0.75,'three-quarters']];
  const fractionLabel = fractionLabels.reduce((best, [f, l]) =>
    Math.abs(fraction - f) < Math.abs(fraction - best[0]) ? [f, l] : best, fractionLabels[0])[1];
  const base = `${position}-${fractionLabel}`;
  const count = existingLabels.filter(l => l && l.startsWith(base)).length;
  const label = `${base}-${count + 1}`;
  console.log(`[geometry:deriveDividerZoneName] fraction=${fraction.toFixed(2)} position=${position} → label=${label}`);
  return label;
}
```

`npm run test` after.

---

### Step 2 — State normalization + migration V15

**`state.js` room normalization loop** (after line 212 `if (!Array.isArray(room.objects3d)) room.objects3d = [];`):
```js
if (!Array.isArray(room.dividers)) room.dividers = [];
if (!room.zoneSettings || typeof room.zoneSettings !== 'object') room.zoneSettings = {};
```

**Migration V14→V15** — explicitly backfills wall surfaces (NOT covered by room loop):
```js
if (s.meta?.version === 14) s = migrateV14ToV15(s);

function migrateV14ToV15(s) {
  s.meta.version = 15;
  for (const floor of (s.floors || [])) {
    for (const wall of (floor.walls || [])) {
      for (const surf of (wall.surfaces || [])) {
        if (!Array.isArray(surf.dividers)) surf.dividers = [];
        if (!surf.zoneSettings || typeof surf.zoneSettings !== 'object') surf.zoneSettings = {};
      }
    }
  }
  return s;
}
```

**`createDefaultSurface` in `walls.js`** (after `excludedTiles: []`):
```js
dividers: [],
zoneSettings: {},
```

`npm run test` after.

---

### Step 3 — Fix `wallSurfaceToTileableRegion` + add `computeZoneTiles` in `walls.js`

**Critical fix**: `wallSurfaceToTileableRegion` return object (lines 1565–1579) must forward `dividers` and `zoneSettings` from `surface`, otherwise wall surface zone rendering is silently broken:

```js
// In wallSurfaceToTileableRegion return object, add:
dividers: surface.dividers || [],
zoneSettings: surface.zoneSettings || {},
```

Extend existing geometry.js import to add `computeZones, deriveDividerZoneName`.

**`computeZoneTiles(state, region, floor, opts = {})`**:

```js
export function computeZoneTiles(state, region, floor, opts = {}) {
  const { isRemovalMode = false } = opts;
  const dividers = region.dividers || [];
  const zoneSettings = region.zoneSettings || {};
  console.log(`[walls:computeZoneTiles] region=${region.id || 'anon'} dividers=${dividers.length}`);
  if (!dividers.length) return [];
  const zones = computeZones(region.polygonVertices, dividers);
  return zones.map(zone => {
    const settings = zoneSettings[zone.id] || {};
    const xs = zone.polygonVertices.map(v => v.x), ys = zone.polygonVertices.map(v => v.y);
    const zoneRegion = {
      id: zone.id,
      widthCm: Math.max(...xs) - Math.min(...xs),
      heightCm: Math.max(...ys) - Math.min(...ys),
      polygonVertices: zone.polygonVertices,
      tile: settings.tile || null,
      grout: settings.grout || region.grout || { widthCm: 0.2, colorHex: '#ffffff' },
      pattern: settings.pattern || region.pattern || { type: 'grid', bondFraction: 0.5, rotationDeg: 0, offsetXcm: 0, offsetYcm: 0 },
      exclusions: [],
    };
    if (!zoneRegion.tile) {
      console.log(`[walls:computeZoneTiles] zone=${zone.id} untiled — skipping tile compute`);
      return { zoneId: zone.id, polygonVertices: zone.polygonVertices, tiles: [], groutColor: '#ffffff', error: null, label: settings.label || '' };
    }
    const r = computeSurfaceTiles(state, zoneRegion, floor, {
      exclusions: [], includeDoorwayPatches: false,
      effectiveSettings: { tile: zoneRegion.tile, grout: zoneRegion.grout, pattern: zoneRegion.pattern },
      isRemovalMode,
    });
    console.log(`[walls:computeZoneTiles] zone=${zone.id} tiles=${r.tiles.length} error=${r.error || 'none'}`);
    return { zoneId: zone.id, polygonVertices: zone.polygonVertices, tiles: r.tiles, groutColor: r.groutColor, error: r.error, label: settings.label || '' };
  });
}
```

`npm run test` after.

---

### Step 4 — `src/dividers.js` controller

New file. Import `computeZones`, `deriveDividerZoneName` from `./geometry.js`. Import `deepClone`, `uuid` from `./core.js`.

```js
export function createDividerController({ getState, commit, getTarget, t }) {
  function addDivider(p1, p2) {
    const state = getState();
    const target = getTarget(state);
    if (!target?.polygonVertices) return;
    const id = uuid();
    const newDividers = [...(target.dividers || []), { id, p1, p2 }];
    const zones = computeZones(target.polygonVertices, newDividers);
    const existingLabels = Object.values(target.zoneSettings || {}).map(z => z.label).filter(Boolean);
    const next = deepClone(state);
    const nextTarget = getTarget(next);
    nextTarget.dividers.push({ id, p1, p2 });
    for (const zone of zones) {
      if (!nextTarget.zoneSettings[zone.id]) {
        const label = deriveDividerZoneName(target.polygonVertices, zone.polygonVertices, existingLabels);
        nextTarget.zoneSettings[zone.id] = { tile: null, grout: null, pattern: null, label };
        existingLabels.push(label);
      }
    }
    console.log(`[dividers:addDivider] id=${id} p1=(${p1.x.toFixed(1)},${p1.y.toFixed(1)}) p2=(${p2.x.toFixed(1)},${p2.y.toFixed(1)}) zones=${zones.length}`);
    commit(t('dividers.added'), next);
    return id;
  }

  function deleteDivider(dividerId) {
    const state = getState();
    const target = getTarget(state);
    if (!target) return;
    const next = deepClone(state);
    const nextTarget = getTarget(next);
    nextTarget.dividers = nextTarget.dividers.filter(d => d.id !== dividerId);
    // Recompute zones from remaining dividers to find valid zone IDs
    const remainingZones = computeZones(nextTarget.polygonVertices, nextTarget.dividers);
    const validIds = new Set(remainingZones.map(z => z.id));
    // Remove orphaned zoneSettings keys (those not in remaining zones)
    const orphaned = Object.keys(nextTarget.zoneSettings).filter(k => !validIds.has(k));
    orphaned.forEach(k => delete nextTarget.zoneSettings[k]);
    console.log(`[dividers:deleteDivider] id=${dividerId} remainingDividers=${nextTarget.dividers.length} orphanedSettings=${orphaned.length}`);
    commit(t('dividers.deleted'), next);
  }

  function commitZoneSettings(zoneId, label) {
    const state = getState();
    const target = getTarget(state);
    if (!target) return;
    // Read from quick-bar (qz*) OR sidebar (divZone*) — same dual-ID fallback pattern
    const el = (qId, sId) => document.getElementById(qId) || document.getElementById(sId);
    const enabledInp = el('qzEnabled', 'divZoneEnabled');
    if (!enabledInp) return;
    const next = deepClone(state);
    const nextTarget = getTarget(next);
    if (!nextTarget.zoneSettings[zoneId]) nextTarget.zoneSettings[zoneId] = {};
    const z = nextTarget.zoneSettings[zoneId];
    z.label = label || z.label;
    if (!enabledInp.checked) {
      z.tile = null; z.grout = null; z.pattern = null;
    } else {
      const presetSel = el('qzPreset', 'divZonePreset');
      const presets = state.tilePresets || [];
      const preset = presetSel ? presets.find(p => p.id === presetSel.value) : null;
      z.tile = preset
        ? { widthCm: preset.widthCm, heightCm: preset.heightCm, shape: preset.shape || 'rect', reference: preset.name }
        : (z.tile || { widthCm: 20, heightCm: 20, shape: 'rect', reference: null });
      const groutW = el('qzGroutWidth', 'divZoneGroutWidth');
      const groutC = el('qzGroutColor', 'divZoneGroutColor');
      z.grout = {
        widthCm: groutW ? Math.max(0, Number(groutW.value) || 0.2) : (z.grout?.widthCm ?? 0.2),
        colorHex: groutC ? groutC.value : (z.grout?.colorHex ?? '#ffffff'),
      };
      const patternSel = el('qzPattern', 'divZonePattern');
      z.pattern = {
        type: patternSel ? patternSel.value : (z.pattern?.type || 'grid'),
        bondFraction: z.pattern?.bondFraction ?? 0.5,
        rotationDeg: z.pattern?.rotationDeg ?? 0,
        offsetXcm: z.pattern?.offsetXcm ?? 0,
        offsetYcm: z.pattern?.offsetYcm ?? 0,
        origin: z.pattern?.origin ?? { preset: 'tl', xCm: 0, yCm: 0 },
      };
    }
    console.log(`[dividers:commitZoneSettings] zone=${zoneId} enabled=${enabledInp.checked} tile=${z.tile?.widthCm ?? 'null'}×${z.tile?.heightCm ?? 'null'}`);
    commit(t('dividers.zoneChanged'), next);
  }

  return { addDivider, deleteDivider, commitZoneSettings };
}
```

`npm run test` after.

---

### Step 5 — `src/divider-draw.js`

Imports `findNearestEdgePoint` from `./polygon-draw.js` (exported at line 204).

```js
import { findNearestEdgePoint } from './polygon-draw.js';

export function createDividerDrawController({ getSvg, getPolygonEdges, onComplete, onCancel }) {
  // getPolygonEdges() → [{p1:{x,y}, p2:{x,y}}] of current surface polygon
  const ANGLE_SNAP_DEG = [0, 45, 90, 135, 180, 225, 270, 315];
  const SNAP_THRESHOLD = 2;
  let active = false, startPt = null, previewLine = null;

  function snapToSurfaceEdge(pt) {
    const edges = getPolygonEdges().map(e => ({ roomId: 'surface', edge: e }));
    const result = findNearestEdgePoint(pt, edges);
    const snapped = result && result.distance <= SNAP_THRESHOLD ? result.point : null;
    console.log(`[divider-draw:snapToEdge] pt=(${pt.x.toFixed(1)},${pt.y.toFixed(1)}) dist=${result?.distance?.toFixed(2) ?? 'none'} snapped=${!!snapped}`);
    return snapped;
  }

  function angleSnap(from, to) {
    const dx = to.x - from.x, dy = to.y - from.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.1) return to;
    const angleDeg = ((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360;
    const best = ANGLE_SNAP_DEG.reduce((b, a) => {
      const d = Math.min(Math.abs(angleDeg - a), 360 - Math.abs(angleDeg - a));
      return d < b.d ? { a, d } : b;
    }, { a: ANGLE_SNAP_DEG[0], d: Infinity });
    const rad = best.a * Math.PI / 180;
    return { x: from.x + Math.cos(rad) * dist, y: from.y + Math.sin(rad) * dist };
  }

  function svgPoint(e) {
    const svg = getSvg();
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    return pt.matrixTransform(svg.getScreenCTM().inverse());
  }

  function onPointerDown(e) {
    const pt = svgPoint(e);
    const snapped = snapToSurfaceEdge(pt);
    if (!snapped) return;
    startPt = snapped;
    const svg = getSvg();
    previewLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    previewLine.setAttribute('stroke', 'rgba(99,102,241,0.8)');
    previewLine.setAttribute('stroke-width', '1.5');
    previewLine.setAttribute('stroke-dasharray', '4 3');
    previewLine.setAttribute('pointer-events', 'none');
    svg.appendChild(previewLine);
    console.log(`[divider-draw:pointerDown] startPt=(${snapped.x.toFixed(1)},${snapped.y.toFixed(1)})`);
  }

  function onPointerMove(e) {
    if (!startPt || !previewLine) return;
    const raw = svgPoint(e);
    const snapped = angleSnap(startPt, raw);
    previewLine.setAttribute('x1', startPt.x); previewLine.setAttribute('y1', startPt.y);
    previewLine.setAttribute('x2', snapped.x);  previewLine.setAttribute('y2', snapped.y);
  }

  function onPointerUp(e) {
    if (!startPt) return;
    const raw = svgPoint(e);
    const angleSnapped = angleSnap(startPt, raw);
    const endPt = snapToSurfaceEdge(angleSnapped);
    previewLine?.remove(); previewLine = null;
    const p1 = startPt; startPt = null;
    console.log(`[divider-draw:pointerUp] endPt=${endPt ? `(${endPt.x.toFixed(1)},${endPt.y.toFixed(1)})` : 'none'}`);
    if (endPt && (Math.abs(endPt.x - p1.x) > 0.1 || Math.abs(endPt.y - p1.y) > 0.1)) {
      onComplete({ p1, p2: endPt });
    } else {
      onCancel?.();
    }
  }

  function start() {
    active = true;
    const svg = getSvg();
    svg.addEventListener('pointerdown', onPointerDown);
    svg.addEventListener('pointermove', onPointerMove);
    svg.addEventListener('pointerup', onPointerUp);
    console.log('[divider-draw:start] draw mode active');
  }

  function stop() {
    active = false;
    previewLine?.remove(); previewLine = null; startPt = null;
    const svg = getSvg();
    svg.removeEventListener('pointerdown', onPointerDown);
    svg.removeEventListener('pointermove', onPointerMove);
    svg.removeEventListener('pointerup', onPointerUp);
    console.log('[divider-draw:stop] draw mode inactive');
  }

  return { start, stop, isActive: () => active };
}
```

Wire in `main.js`: scissor/divide button `#quickDivider` in `#roomQuickControls` (before `#quickAddDoorway`). `getPolygonEdges` converts current `currentRoom.polygonVertices` to `[{p1,p2}]` pairs. `onComplete` calls `dividerCtrl.addDivider(p1, p2)`.

`npm run test` after.

---

### Step 6 — `render.js` — zone tiles + divider lines

Import `computeZoneTiles` from `./walls.js`. Add `selectedDividerId`, `setSelectedDividerId` to `renderPlanSvg` parameter list.

**Zone tile groups** — after base tile group, before exclusion rendering. `currentFloor` is already in scope:

```js
const zoneResults = computeZoneTiles(state, currentRoom, currentFloor, { isRemovalMode });
for (const zr of zoneResults) {
  if (!zr.tiles.length) continue;
  const zGroutRgb = hexToRgb(zr.groutColor);
  const zG = svgEl("g", { "pointer-events": "none" });
  for (const tile of zr.tiles) {
    if (!tile.d) continue;
    zG.appendChild(svgEl("path", {
      d: tile.d,
      fill: tile.isFull ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.08)",
      stroke: `rgba(${zGroutRgb.r},${zGroutRgb.g},${zGroutRgb.b},0.50)`,
      "stroke-width": tile.isFull ? 0.5 : 1.2,
    }));
  }
  svg.appendChild(zG);
  console.log(`[render:2D-zone] zone=${zr.zoneId} tiles=${zr.tiles.length}`);
}
```

**Zone outlines** — uses `zr.polygonVertices` from same `zoneResults` (no extra `computeZones` call):
```js
for (const zr of zoneResults) {
  const pts = zr.polygonVertices.map(v => `${v.x},${v.y}`).join(' ');
  svg.appendChild(svgEl("polygon", {
    points: pts, fill: "none",
    stroke: "rgba(99,102,241,0.35)", "stroke-width": 1, "stroke-dasharray": "3 2",
    "pointer-events": "none",
  }));
}
```

**Divider lines** — after zone groups:
```js
for (const div of (currentRoom.dividers || [])) {
  const isSel = div.id === selectedDividerId;
  const lineEl = svgEl("line", {
    x1: div.p1.x, y1: div.p1.y, x2: div.p2.x, y2: div.p2.y,
    stroke: isSel ? "rgba(99,102,241,1)" : "rgba(99,102,241,0.7)",
    "stroke-width": isSel ? 2 : 1.5,
    "stroke-dasharray": "4 3",
    "pointer-events": "stroke",
    "data-divid": div.id, cursor: "pointer",
  });
  lineEl.addEventListener("click", e => { e.stopPropagation(); setSelectedDividerId?.(div.id); });
  svg.appendChild(lineEl);
  console.log(`[render:2D-divider] id=${div.id} sel=${isSel}`);
}
```

`npm run test` after.

---

### Step 7 — Zone settings UI (`index.html`, `render.js`, `main.js`, `i18n.js`)

**i18n**: Add `dividers` key block (DE + EN): `title`, `added`, `deleted`, `zoneChanged`, `enable`, `preset`, `pattern`, `groutWidth`, `groutColor`.

**index.html**: `#quickDivider` button (scissor icon) + `#dividerZoneDropdown` menu in `#roomQuickControls`. Quick-bar IDs: `qzEnabled`, `qzPreset`, `qzPattern`, `qzGroutWidth`, `qzGroutColor`. Sidebar `#dividerZoneSection` uses IDs: `divZoneEnabled`, `divZonePreset`, `divZonePattern`, `divZoneGroutWidth`, `divZoneGroutColor`.

**`renderDividerZoneUI`** in `render.js`: populates `#dividerZoneDropdown` with zone list (label + tile enable toggle + preset select + pattern select + grout inputs). Enable triggers `commitZoneSettings`. Selected divider shows delete button.

**`main.js`**: `selectedDividerId` local variable; `setSelectedDividerId` updates it and re-renders.

`npm run test` after.

---

### Step 8 — `three-view.js` + `main.js` 3D wiring

Import `computeZoneTiles` in `main.js`. Add `zoneTiles: computeZoneTiles(...)` to `prepareRoom3DData` and the wall surface map in `prepareFloorWallData` (identical to how `subSurfaceTiles` was added).

**`three-view.js`** zone batches in `addRoomToScene` (after sub-surface loop) and `addWallToScene` (after wall sub-surface loop):

```js
for (const zr of (desc.zoneTiles || [])) {
  if (!zr.tiles.length) continue;
  const { meshes, lines } = renderSurface3D({ tiles: zr.tiles, exclusions: [], groutColor: zr.groutColor, mapper });
  for (const m of meshes) { m.position.y = SURFACE_TILE_OFFSET; scene.add(m); }
  for (const l of lines)  { l.position.y = SURFACE_TILE_OFFSET; scene.add(l); }
  console.log(`[three-view:zone] zone=${zr.zoneId} tiles=${zr.tiles.length}`);
}
```

`npm run test` after.

---

### Step 9 — E2E tests `src/divider.test.js`

Tests are `@vitest-environment jsdom` for render layer tests.

**Unit — geometry pipeline:**
- `splitPolygonByLine` on 100×100 rect, H midline → two sub-polygons, area sum ≈ 10000cm²
- `splitPolygonByLine` on 100×100 rect, V midline → two sub-polygons, area sum ≈ 10000cm²
- `splitPolygonByLine` with p1=p2 → returns null
- `splitPolygonByLine` on non-rectangular polygon → both halves ≥ 3 vertices
- `computeZones` with 0 dividers → 1 zone, same vertices
- `computeZones` with 1 H divider → 2 zones, areas sum ≈ parent
- `computeZones` with 2 dividers → 3 zones
- `deriveDividerZoneName` equal H split → "top-half-1" / "bottom-half-2"
- `deriveDividerZoneName` equal V split → "left-half-1" / "right-half-2"
- `deriveDividerZoneName` ~33% H → "top-third-1"

**E2E — computation pipeline:**
- `computeZoneTiles` with 0 dividers → empty array
- `computeZoneTiles` 1 divider, tiled zone → `tiles.length > 0`, all coords within zone bbox
- `computeZoneTiles` 1 divider, untiled zone → `tiles: []`
- Tile bboxes from zone A and zone B do not overlap

**E2E — render layer (jsdom + `renderPlanSvg`):**
- Room with 1 divider: `renderPlanSvg` produces a `<line data-divid="...">` element
- Room with 1 tiled zone: SVG contains a zone `<polygon>` outline element with `stroke` containing `99,102,241`
- Room with 0 dividers: no `[data-divid]` elements in SVG

---

## Critical Files and Exact Changes

| File | Change |
|---|---|
| `src/geometry.js` | Export `isPointInPolygon` (moved); add `splitPolygonByLine`, `insertPointOnRing`, `computeZones`, `zoneId`, `deriveDividerZoneName` |
| `src/polygon-draw.js` | Remove `isPointInPolygon` definition; import from `./geometry.js` |
| `src/walls.js` | `wallSurfaceToTileableRegion` return: add `dividers`, `zoneSettings`; add `computeZoneTiles`; add fields to `createDefaultSurface` |
| `src/state.js` | Room normalization: add `dividers`/`zoneSettings`; add `migrateV14ToV15` with explicit wall surface backfill |
| `src/dividers.js` | New — `createDividerController`: `addDivider`, `deleteDivider`, `commitZoneSettings` |
| `src/divider-draw.js` | New — `createDividerDrawController`: imports `findNearestEdgePoint` from polygon-draw.js |
| `src/render.js` | Zone tile groups + zone outlines + divider lines + `renderDividerZoneUI`; add `selectedDividerId` param |
| `src/main.js` | Wire controllers, `#quickDivider` button, `zoneTiles` in 3D descriptors, `selectedDividerId` local var |
| `src/three-view.js` | Zone tile batches in floor and wall scene loops |
| `src/i18n.js` | Add `dividers` key block |
| `src/index.html` | Add `#quickDivider` button and `#dividerZoneDropdown`; sidebar `#dividerZoneSection` |
| `src/divider.test.js` | New — unit + E2E + render layer tests |
