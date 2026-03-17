# Plan: Surface Source-of-Truth Unification
**Date:** 2026-03-17
**Branch:** render_refactoring (or new branch from dev)

---

## Problem Statement

Three rendering pipelines (2D wall editor, 3D floor view, 3D room view) currently diverge in how they prepare wall surfaces and 3D object faces. The divergences create bugs and violate "one source of truth":

1. **Contact exclusion gap** — `wallSurfaceToTileableRegion` is called bare in the 2D wall editor (main.js:1150); the 3D pipeline wraps it with contact exclusion injection (main.js:620–631). The 2D wall editor shows tiles where 3D objects physically overlap the surface — wrong.

2. **Skirting piece length bug** — render.js:1837 uses only `currentRoom.tile?.widthCm` as the skirting piece length. calc.js and the wall surface view both use `Math.max(widthCm, heightCm)`. Non-square tiles with height > width display incorrect skirting segments in the 2D floor plan.

3. **Object face region inline** — `prepareRoom3DData` (main.js:489–555) computes face region (dimensions, polygon, contact exclusions, tile/grout/pattern assembly) inline. The logic cannot be tested in isolation, duplicates the exclusion injection pattern from the wall pipeline, and blocks reuse in a future 2D object face view.

---

## Scorecard

| Dimension | Score | Evidence |
|---|---|---|
| **Hacky** | 8 | Every change is: create a well-named function, move logic into it, update callers. No workarounds. The contact exclusion injection is a genuine pipeline step that belongs in walls.js next to `wallSurfaceToTileableRegion`. |
| **Compliance** | 8 | `prepareWallSurface` belongs in walls.js (already owns the wall pipeline). `prepareObj3dFaceRegion` belongs in objects3d.js (owns 3D objects). No layer violations. `computeSurfaceContacts` is in geometry.js; walls.js already imports from geometry.js — safe to extend the import list. |
| **Complexity** | 8 | 5 steps, each a straightforward extract-and-update. Zero logic changes — same math, same data, moved into named functions. The optional Step 6 (`_renderPlanWalls` / `rebuildWallForRoom` helper) is explicitly deferred because the two systems use legitimately different normal conventions. |
| **Problem Understanding** | 8 | All call sites of `wallSurfaceToTileableRegion` traced: exactly 2 in production code (main.js:612 and main.js:1150; test files call it directly and are unaffected). Contact injection code read line by line (main.js:615–631): exact field shapes confirmed (`type:'rect'`, `w`/`h`, `_isContact:true`, coordinate math). Face region block read line by line (489–555): full extent confirmed. Skirting piece length compared across render.js:1837, calc.js, render.js:1706 — confirmed mismatch. |
| **Confidence** | 5 | Plan-stage maximum per no-optimism rule. All analysis is code-based, no runtime verification yet. |

---

## Gaps Fixed

### Gap 1 — Contact Exclusions Missing in 2D Wall Editor

**Root cause:** `wallSurfaceToTileableRegion` produces base surface geometry (polygon, doorway exclusions, skirting). Contact exclusions (zones where 3D objects touch the surface) are injected separately in the 3D pipeline (main.js:615–631) but not in the 2D editor.

**Fix:** Create `prepareWallSurface(wall, idx, room, floor)` in walls.js that wraps `wallSurfaceToTileableRegion` and injects contact exclusions. Both call sites use `prepareWallSurface` instead.

### Gap 2 — Skirting Piece Length Uses Width Only

**Root cause:** render.js:1837 uses `currentRoom.tile?.widthCm` as piece length for custom-cut skirting. For tiles where heightCm > widthCm the calculation is wrong.

**Fix:** `Math.max(widthCm, heightCm)` — matching calc.js and render.js:1706 (wall surface view, already correct).

### Gap 3 — Object Face Region Inline in prepareRoom3DData

**Root cause:** main.js:489–555 computes face region inline, tangled in the room loop.

**Fix:** Extract `prepareObj3dFaceRegion(obj, surf, allSurfaceContacts)` to objects3d.js.

---

## Implementation Steps

### Step 1 — Fix skirting piece length (render.js:1837)

**File:** `src/render.js`

Change (line 1837):
```js
: (Number(currentRoom.tile?.widthCm) || DEFAULT_TILE_PRESET.widthCm);
```
To:
```js
: (Math.max(Number(currentRoom.tile?.widthCm) || 0, Number(currentRoom.tile?.heightCm) || 0) || DEFAULT_TILE_PRESET.widthCm);
```

Run `npm run test`.

### Step 2 — Extract prepareObj3dFaceRegion (objects3d.js)

**File:** `src/objects3d.js`

Add export (new file has no existing pure-function exports; this establishes the pattern):
```js
/**
 * Build the virtual room-like region for a 3D object face.
 * Returns { widthCm, heightCm, polygonVertices, tile, grout, pattern, exclusions }
 * or null if dimensions cannot be determined.
 */
export function prepareObj3dFaceRegion(obj, surf, allSurfaceContacts) {
  // Compute face dimensions
  let faceW, faceH;
  if (obj.type === "rect") {
    const isTop = surf.face === "top";
    faceW = isTop ? obj.w : (surf.face === "left" || surf.face === "right" ? obj.h : obj.w);
    faceH = isTop ? obj.h : (obj.heightCm || 100);
  } else {
    const verts = obj.type === "tri" ? [obj.p1, obj.p2, obj.p3] : (obj.vertices || []);
    if (surf.face === "top") {
      const xs = verts.map(v => v.x), ys = verts.map(v => v.y);
      faceW = Math.max(...xs) - Math.min(...xs);
      faceH = Math.max(...ys) - Math.min(...ys);
    } else {
      const match = surf.face.match(/^side-(\d+)$/);
      if (match) {
        const idx = parseInt(match[1]);
        const a = verts[idx], b = verts[(idx + 1) % verts.length];
        if (a && b) faceW = Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
      }
      faceH = obj.heightCm || 100;
    }
  }
  if (!faceW || !faceH) return null;

  // Build polygon vertices for this face
  let polyVerts;
  if (surf.face === "top" && obj.type !== "rect") {
    const verts = obj.type === "tri" ? [obj.p1, obj.p2, obj.p3] : (obj.vertices || []);
    const xs = verts.map(v => v.x), ys = verts.map(v => v.y);
    const minX = Math.min(...xs), minY = Math.min(...ys);
    polyVerts = verts.map(v => ({ x: v.x - minX, y: v.y - minY }));
  } else {
    polyVerts = [
      { x: 0, y: 0 }, { x: faceW, y: 0 },
      { x: faceW, y: faceH }, { x: 0, y: faceH },
    ];
  }

  // Contact exclusions: areas where this face touches a wall
  const faceContacts = allSurfaceContacts.filter(c => c.objId === obj.id && c.face === surf.face);
  const exclusions = faceContacts.map(c => ({
    type: 'rect',
    x: c.faceLocalX1,
    y: 0,
    w: c.faceLocalX2 - c.faceLocalX1,
    h: c.contactH,
    _isContact: true,
  }));
  if (exclusions.length) {
    console.log(`[prepareObj3dFaceRegion] obj=${obj.id} face=${surf.face}: ${exclusions.length} contact exclusion(s)`);
  }

  return {
    widthCm: faceW,
    heightCm: faceH,
    polygonVertices: polyVerts,
    tile: surf.tile,
    grout: surf.grout || { widthCm: 0.2, colorHex: "#ffffff" },
    pattern: surf.pattern || { type: "grid", bondFraction: 0.5, rotationDeg: 0, offsetXcm: 0, offsetYcm: 0 },
    exclusions,
  };
}
```

**File:** `src/main.js` — `prepareRoom3DData` (~line 489)

Import `prepareObj3dFaceRegion` from `./objects3d.js`. Replace lines 489–555 with:
```js
const region = prepareObj3dFaceRegion(obj, surf, allSurfaceContacts);
if (!region) continue;
```
Then use `region` directly for the `computeSurfaceTiles` call.

Run `npm run test`.

### Step 3 — Create prepareWallSurface (walls.js)

**File:** `src/walls.js`

Extend existing geometry.js import to include `computeSurfaceContacts`.

Add export:
```js
/**
 * Prepare a wall surface region with contact exclusions injected.
 * This is the single entry point for both 3D pipeline and 2D wall editor.
 * Returns the region (mutated with contact exclusions) or null.
 */
export function prepareWallSurface(wall, idx, room, floor) {
  const region = wallSurfaceToTileableRegion(wall, idx, { room, floor });
  if (!region || !room) return region;

  const surface = wall.surfaces[idx];
  const surfFromCm = surface?.fromCm || 0;
  const surfToCm = surface?.toCm ?? (wall.lengthCm || 0);
  const maxH = region.heightCm;

  const contacts = computeSurfaceContacts(room, wall);
  const contactExclusions = contacts
    .filter(c => c.overlapEnd > surfFromCm && c.overlapStart < surfToCm)
    .map(c => {
      const localX1 = Math.max(0, c.overlapStart - surfFromCm);
      const localX2 = Math.min(surfToCm - surfFromCm, c.overlapEnd - surfFromCm);
      return { type: 'rect', x: localX1, y: maxH - c.contactH, w: localX2 - localX1, h: c.contactH, _isContact: true };
    });

  if (contactExclusions.length) {
    console.log(`[prepareWallSurface] wall=${wall.id} surface=${idx}: ${contactExclusions.length} contact exclusion(s)`);
    region.exclusions = [...(region.exclusions || []), ...contactExclusions];
  }

  return region;
}
```

**Note:** `wallSurfaceToTileableRegion` remains exported — it is used directly in test files and should not be removed.

Run `npm run test`.

### Step 4 — Use prepareWallSurface in prepareFloorWallData (main.js:612)

**File:** `src/main.js`

Import `prepareWallSurface` from `./walls.js`.

Replace lines 612–631:
```js
const region = wallSurfaceToTileableRegion(wall, idx, { room, floor });
if (!region) return null;
// ... contact injection block (615–631) ...
```
With:
```js
const region = prepareWallSurface(wall, idx, room, floor);
if (!region) return null;
```

The `computeSurfaceContacts` import in main.js may be retained (still used elsewhere) — verify before removing.

Run `npm run test`.

### Step 5 — Use prepareWallSurface in 2D wall editor (main.js:1150)

**File:** `src/main.js`

Replace:
```js
roomOverride = wallSurfaceToTileableRegion(wall, state.selectedSurfaceIdx ?? 0, { room, floor });
```
With:
```js
roomOverride = prepareWallSurface(wall, state.selectedSurfaceIdx ?? 0, room, floor);
```

The `wallSurfaceToTileableRegion` import in main.js remains (still needed in test utilities / direct test calls — do not remove).

Run `npm run test`.

---

## E2E Test Scenarios

### T1 — Skirting piece length for portrait tile

**File:** new scenarios in `src/render.test.js` or existing skirting test file

Setup: room with 20×40 cm tile (height > width), skirting type = "custom". Call `computeSkirtingNeeds` or exercise the skirting render path.
Assert: piece length uses `Math.max(20, 40) = 40` cm, not 20 cm. Skirting count reflects correct segment division.

### T2 — Contact exclusion present in prepareWallSurface output

**File:** new scenarios in `src/walls.test.js`

Setup: minimal room with a `rect` 3D object that overlaps one wall surface (`computeSurfaceContacts` returns a non-empty array). Call `prepareWallSurface(wall, 0, room, floor)`.
Assert: returned `region.exclusions` contains an entry with `type:'rect'` and `_isContact:true` at the correct position.
Assert: calling `wallSurfaceToTileableRegion` directly on the same inputs returns `exclusions` without the contact entry (confirming the wrapper adds it).

### T3 — prepareObj3dFaceRegion unit test

**File:** `src/objects3d.test.js` (new file — does not currently exist)

Setup: mock `rect` obj3d with `w:50, h:80, heightCm:200` + a side face surface + one surface contact (`faceLocalX1:10, faceLocalX2:20, contactH:30`). Call `prepareObj3dFaceRegion(obj, surf, [contact])`.
Assert: `widthCm=80, heightCm=200`. `exclusions` has one entry: `{ type:'rect', x:10, y:0, w:10, h:30, _isContact:true }`.

### T4 — prepareObj3dFaceRegion returns null on missing dimensions

**File:** `src/objects3d.test.js`

Setup: freeform obj with `vertices:[]` and a `side-0` face. Call `prepareObj3dFaceRegion`.
Assert: returns `null`.

### T5 — 3D pipeline region matches after Step 4 refactor

**File:** new scenario in `src/walls.test.js`

For a wall with a contact-bearing surface, call both:
- (direct) `wallSurfaceToTileableRegion` + manual contact injection (as in old main.js:615–631)
- (new) `prepareWallSurface`

Assert outputs are deep-equal.

---

## Out of Scope (explicitly deferred)

**`_renderPlanWalls` / `rebuildWallForRoom` normal direction**: These two functions use legitimately different normals — `_renderPlanWalls` uses the viewing room's polygon winding (correct for 2D SVG rendering); `rebuildWallForRoom` uses `rawDesc.normal` from the owner room (correct for 3D reanchoring). They cannot be unified without a coordinate-space-aware refactor that is out of scope here.

---

## Critical Files

| File | Change |
|---|---|
| `src/render.js` | Step 1: fix skirting piece length at line 1837 |
| `src/objects3d.js` | Step 2: add `prepareObj3dFaceRegion` export |
| `src/main.js` | Steps 2, 4, 5: use new functions, remove inline logic |
| `src/walls.js` | Step 3: add `prepareWallSurface`, extend geometry.js import |
| `src/walls.test.js` | T2, T5: new contact exclusion scenarios |
| `src/objects3d.test.js` | T3, T4: new file — does not yet exist |

---

## Logging

Each new function includes entry logging:
- `[prepareWallSurface]` — wall id, surface idx, contact count injected
- `[prepareObj3dFaceRegion]` — obj id, face, contact count

Remove after user confirms 2D/3D surface tile rendering is consistent visually.

---

## Result

After this plan: every surface (wall, object face) is prepared by exactly one function in the correct module. The 2D wall editor and 3D pipeline see identical tile regions for the same surface. Skirting piece length is correct for all tile aspect ratios.

---

## Implementation

**Executed:** 2026-03-17

### What was done

All 5 steps executed as planned, plus E2E tests.

- **Step 1** (render.js:1837): Changed `Number(currentRoom.tile?.widthCm)` to `Math.max(widthCm, heightCm)` for custom-cut skirting piece length.
- **Step 2** (objects3d.js + main.js): Extracted `prepareObj3dFaceRegion` as an exported function to objects3d.js. Replaced 67-line inline block in `prepareRoom3DData` with a single call.
- **Step 3** (walls.js): Added `prepareWallSurface` export. Extended geometry.js import to include `computeSurfaceContacts`.
- **Step 4** (main.js `prepareFloorWallData`): Replaced `wallSurfaceToTileableRegion` call + 17-line contact injection block with `prepareWallSurface`.
- **Step 5** (main.js 2D wall editor): Replaced `wallSurfaceToTileableRegion` call at line 1067 with `prepareWallSurface`.
- **E2E tests**: 4 new scenarios in `src/walls.test.js` (`prepareWallSurface` suite); 7 new scenarios in new file `src/objects3d.test.js`.

### Core findings

- The inline face region block in `prepareRoom3DData` was 67 lines (489–555), not 25 as initially estimated in the first plan draft — the validation agent catch was accurate.
- `wallSurfaceToTileableRegion` is also called directly in test files (walls.test.js, walls_skirting_offset.test.js) and must remain exported. Only production call sites needed updating.
- The `[surface-contact]` console.log at main.js:636 was left in place — it is a diagnostic log for an existing feature, not debug logging introduced by this refactor.

### Final test count

**65 test files, 1420 passed, 7 skipped** (11 new tests added).
