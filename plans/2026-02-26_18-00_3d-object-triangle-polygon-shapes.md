# Plan: Add Triangle and Polygon 3D Object Shapes

## Context

3D objects currently only support rectangular shapes (`type: 'rect'`). The user needs triangle and freeform polygon shapes — same as exclusions already support. Round shapes are explicitly out of scope. The approach reuses existing exclusion patterns (data model, UX, drawing tool) and extends each pipeline stage to handle the new types.

## Scope Summary

| Component | What changes |
|---|---|
| **Data model** (objects3d.js) | New `addTri()` and `addFreeform(vertices)` methods; dynamic surface creation |
| **Floor exclusion** (geometry.js) | `getAllFloorExclusions` becomes polymorphic (tri/freeform, not just rect) |
| **2D SVG render** (render.js) | Render polygon shapes + vertex handles (same as exclusion rendering) |
| **3D render** (three-view.js) | Build prism/extrusion geometry; new face mappers for side faces + polygon top |
| **Face tiles** (main.js, calc.js) | Compute face dimensions per edge; polygon top face uses polygon region |
| **Drag/resize** (drag.js) | Add tri vertex drag (p1/p2/p3) and freeform vertex drag (v0..vN) |
| **Properties** (render.js, objects3d.js) | Tri: p1/p2/p3 inputs. Freeform: read-only vertex count. |
| **Bottom bar** (index.html, main.js) | Add Triangle + Freeform items to obj3d dropdown |
| **i18n** (i18n.js) | New keys for triangle, freeform labels |

## Scorecard — Iteration 1 (after exploration)

### Hacky (0 → ? / 10)
- +2: Triangle data model mirrors exclusion tri exactly (p1/p2/p3 pattern from exclusions.js:74-101)
- +2: Freeform data model mirrors exclusion freeform exactly (vertices array from exclusions.js:103-126)
- +2: 2D SVG rendering reuses SVG `<polygon>` element, same as exclusion rendering (render.js:2286-2296)
- +1: Drag/resize reuses exact same patterns from exclusion drag (drag.js:316-328 for move, 627-637 for resize)
- +1: Floor exclusion conversion leverages existing `exclusionToPolygon` which already handles tri and freeform types (geometry.js:606-653)
- **Score: 8**

### Compliance (0 → ? / 10)
- +2: All state changes go through `store.commit()` via the controller (objects3d.js pattern)
- +2: Geometry stays in geometry.js / three-view.js, DOM in render.js, controller in objects3d.js — correct layers
- +2: Reuses existing APIs: `exclusionToPolygon`, `polygonDrawController.startDrawing`, `tilesForPreview`, `computeAvailableArea`
- +1: Follows one-source-of-truth: face dimension logic lives in a helper function, called from both main.js and calc.js
- +1: i18n keys follow existing naming convention
- **Score: 8**

### Complexity (0 → ? / 10)
- +3: Data model + controller: ~60 lines (addTri + addFreeform + dynamic surfaces)
- +2: 2D SVG: ~20 lines (polygon rendering + vertex handles, copying exclusion pattern)
- +1: 3D rendering: ~80 lines (prism geometry builder + edge lines + face mappers) — most complex part
- +1: Face tiles: ~30 lines (edge-based face dimensions for side faces, polygon region for top)
- +1: Drag: ~40 lines (copying exclusion tri/freeform drag patterns)
- -1: 3D rendering is unavoidably complex (vertex math for prism/extrusion)
- **Score: 7**

### Problem Understanding (0 → ? / 10)
- +2: Read all 7 pipeline stages for rect objects end-to-end (objects3d.js, render.js, three-view.js, geometry.js, main.js, calc.js, drag.js)
- +2: Read all exclusion tri/freeform patterns end-to-end (exclusions.js, geometry.js, render.js, drag.js)
- +2: Read `createBoxFaceMapper` (three-view.js:412-438) — understood how 2D surface coords map to 3D world; need new mapper per edge for prisms
- +1: Read `getAllFloorExclusions` (geometry.js:589-604) — currently hardcodes rect; `exclusionToPolygon` already handles tri/freeform so the fix is straightforward
- +1: Read face tile computation in both main.js:477-512 and calc.js:702-741 — face dimensions are hardcoded for rect faces; need edge-length-based computation for prisms
- +1: Read polygon draw controller integration (main.js:3311-3346) — exact pattern for freeform creation via drawing tool
- **Score: 9**

### Confidence (0 → ? / 10)
- +3: Every exclusion pattern (tri/freeform) is already proven and just needs mirroring for objects3d
- +2: `exclusionToPolygon` already handles tri and freeform → floor exclusion integration is a small change
- +1: Face tile computation follows the same virtual-region pattern — just need correct dimensions per edge
- +1: 3D geometry math is well-understood (triangular prism = 3 side quads + triangle top; extrusion = N side quads + polygon top)
- -1: 3D face mapper for prisms is new code with no existing analog — needs careful coordinate math
- **Score: 7** (lowered due to 3D mapper being genuinely new)

## Implementation Steps

### Phase 1: Data Model + Controller

**File**: `src/objects3d.js`

**1a. Dynamic surface creation function**

Replace the hardcoded `createDefaultSurfaces()` with a `createSurfacesForType(type, obj)` function:
- `rect` → 5 faces: front, back, left, right, top (unchanged)
- `tri` → 4 faces: side-0, side-1, side-2, top
- `freeform` → N+1 faces: side-0 ... side-(N-1), top (based on `obj.vertices.length`)

Each surface: `{ id: uuid(), face: "side-0"|"top"|etc, tile: null, grout: null, pattern: null }`

**1b. `addTri()` method**

Mirror exclusion `addTri()` (exclusions.js:74-101):
```javascript
{
  id: uuid(),
  type: 'tri',
  label: `${t('objects3d.object')} ${objCount + 1}`,
  p1: { x: cx, y: cy - size },
  p2: { x: cx - size, y: cy + size },
  p3: { x: cx + size, y: cy + size },
  heightCm: 100,
  skirtingEnabled: true,
  surfaces: createSurfacesForType('tri'),
}
```

**1c. `addFreeform(vertices)` method**

Mirror exclusion `addFreeform()` (exclusions.js:103-126):
```javascript
{
  id: uuid(),
  type: 'freeform',
  label: `${t('objects3d.object')} ${objCount + 1}`,
  vertices: vertices,  // [{x,y}, ...]
  heightCm: 100,
  skirtingEnabled: true,
  surfaces: createSurfacesForType('freeform', { vertices }),
}
```

**1d. `commitObjProps()` updates**

Add type-specific property reading:
- `tri`: Read p1x/p1y/p2x/p2y/p3x/p3y (same as exclusion commitExclProps pattern)
- `freeform`: No vertex editing via form (same as exclusion pattern — vertices edited via drag only)

**1e. Return addTri and addFreeform from controller**

---

### Phase 2: Floor Exclusion Integration

**File**: `src/geometry.js`

Update `getAllFloorExclusions()` (line 589-604) to handle tri/freeform objects:

```javascript
for (const obj of (room.objects3d || [])) {
  if (obj.type === 'rect') {
    excls.push({ type: 'rect', id: obj.id, x: obj.x, y: obj.y, w: obj.w, h: obj.h, ... });
  } else if (obj.type === 'tri') {
    excls.push({ type: 'tri', id: obj.id, p1: obj.p1, p2: obj.p2, p3: obj.p3, ... });
  } else if (obj.type === 'freeform' && obj.vertices?.length >= 3) {
    excls.push({ type: 'freeform', id: obj.id, vertices: obj.vertices, ... });
  }
}
```

`exclusionToPolygon()` (geometry.js:606-653) already handles tri and freeform — no changes needed there.

---

### Phase 3: 2D SVG Rendering

**File**: `src/render.js`

In the object3d rendering section (~line 2476-2534):

**3a. Shape rendering** — replace `svgEl("rect", ...)` with type dispatch (same pattern as exclusion rendering at render.js:2286-2296):
- `rect` → `svgEl("rect", { x, y, width, height, ... })`
- `tri` → `svgEl("polygon", { points: "${p1.x},${p1.y} ${p2.x},${p2.y} ${p3.x},${p3.y}", ... })`
- `freeform` → `svgEl("polygon", { points: vertices.map(v => `${v.x},${v.y}`).join(" "), ... })`

**3b. Resize handles** — replace 8-handle rect pattern with vertex handles:
- `tri` → 3 circle handles at p1, p2, p3 (same as exclusion tri handles at render.js:2398-2437)
- `freeform` → N circle handles at each vertex (same as exclusion freeform handles at render.js:2439-2470)
- `rect` → unchanged (8 handles)

**3c. Filter removal** — remove `if (obj.type !== "rect") continue;` guard (line 2481)

---

### Phase 4: Drag/Resize

**File**: `src/drag.js`

In `createObject3DDragController()`:

**4a. Move handler** — add tri and freeform move (mirror exclusion drag.js:316-328):
- `tri` → translate p1, p2, p3 by (dx, dy)
- `freeform` → translate all vertices by (dx, dy)

**4b. Resize handler** — add vertex-drag for tri and freeform (mirror exclusion drag.js:627-637):
- `tri` → handle types "p1", "p2", "p3" move individual vertices
- `freeform` → handle types "v0", "v1", ... move individual vertices

**4c. Bounds computation** — add bounds for tri/freeform shapes (mirror exclusion getExclusionBounds, drag.js:81-122)

---

### Phase 5: Properties Panel

**File**: `src/render.js` (renderObj3dProps function)

Add type-specific property fields:
- `tri` → p1x, p1y, p2x, p2y, p3x, p3y inputs + heightCm (mirror exclusion tri props, render.js:1276-1283)
- `freeform` → read-only vertex count + heightCm (mirror exclusion freeform props, render.js:1286-1291)
- `rect` → unchanged (x, y, w, h, heightCm)

---

### Phase 6: 3D Rendering

**File**: `src/three-view.js`

This is the most complex phase. Currently `addObject3DToScene()` is rect-only (line 821). Needs expansion.

**6a. Triangular prism geometry**

For `type === 'tri'`: 3 rectangular side faces + 1 triangular top face + edge lines.

Vertices of triangle in 2D: p1, p2, p3 (room-local). In 3D world space:
- Each vertex `p` → world `(roomPos.x + p.x, 0, roomPos.y + p.y)` at floor, `(roomPos.x + p.x, h, roomPos.y + p.y)` at top.

Side faces (quads): For each edge (p_i → p_j):
- 4 vertices: p_i at floor, p_j at floor, p_j at top, p_i at top
- Index: [0,1,2, 0,2,3]

Top face (triangle):
- 3 vertices at y=h
- Index: [0,1,2]

Edge lines: 3 bottom edges + 3 top edges + 3 vertical edges = 9 line segments.

**6b. Extruded polygon geometry**

For `type === 'freeform'`: N rectangular side faces + 1 polygon top face + edge lines.

Same pattern as triangular prism but with N vertices instead of 3.

Top face: Use `THREE.ShapeGeometry` with a `THREE.Shape` built from vertices (same as `exclusionToShape` pattern at three-view.js:362-387), transformed to y=h plane.

**6c. Face mappers for side faces**

New function `createEdgeFaceMapper(obj, roomPos, edgeIndex)`:
- Gets the two endpoints of edge `edgeIndex`
- Maps `(sx, sy)` where sx is along the edge (0..edgeLength) and sy is up (0..heightCm)
- Returns 3D world coords by interpolating along the edge at floor level + sy for height

New function `createPolygonTopMapper(obj, roomPos)`:
- For tri: maps (sx, sy) in 2D polygon-local space to 3D at y=heightCm
- For freeform: same approach

**6d. Face tile rendering**

Update the face tile loop (three-view.js:922-935) to use the new mappers:
- For `face === "top"` on tri/freeform → use polygon top mapper
- For `face.startsWith("side-")` → extract edge index, use edge face mapper

---

### Phase 7: Face Tile Computation

**Files**: `src/main.js` (~line 477-512) and `src/calc.js` (~line 702-741)

Both need the same logic change. Extract a shared helper `getObj3dFaceDimensions(obj, face)` into a utility (or inline in both places since it's small):

For rect objects (unchanged):
- front/back → `{ w: obj.w, h: obj.heightCm, polygonVertices: rect }`
- left/right → `{ w: obj.h, h: obj.heightCm, polygonVertices: rect }`
- top → `{ w: obj.w, h: obj.h, polygonVertices: rect }`

For tri/freeform objects:
- `side-N` → edge length between vertex N and vertex (N+1)%count × heightCm → rectangular region
- `top` → polygon vertices from the object itself (tri: p1/p2/p3; freeform: vertices array)

Helper function `getObj3dVertices(obj)`:
- `rect` → `[{x:obj.x, y:obj.y}, {x:obj.x+obj.w, y:obj.y}, {x:obj.x+obj.w, y:obj.y+obj.h}, {x:obj.x, y:obj.y+obj.h}]`
- `tri` → `[obj.p1, obj.p2, obj.p3]`
- `freeform` → `obj.vertices`

Helper function `getObj3dFaceRegion(obj, face)`:
- Returns `{ widthCm, heightCm, polygonVertices }` for the face
- `side-N`: rect region of `edgeLength × heightCm`
- `top`: polygon region with vertices zeroed to local origin

---

### Phase 8: Bottom Bar + i18n

**File**: `index.html`

Add two more items to `#obj3dDropdown`:
```html
<button class="quick-dropdown-item" data-obj3d-type="tri">
  <span class="quick-dropdown-icon">△</span>
  <span data-i18n="objects3d.triangle">Triangle</span>
</button>
<button class="quick-dropdown-item" data-obj3d-type="freeform">
  <span class="quick-dropdown-icon">⬠</span>
  <span data-i18n="objects3d.freeform">Freeform</span>
</button>
```

**File**: `src/main.js`

Update the dropdown item handler for `data-obj3d-type`:
- `rect` → `obj3dCtrl.addRect()`
- `tri` → `obj3dCtrl.addTri()`
- `freeform` → start `polygonDrawController.startDrawing()` with `onComplete: (pts) => obj3dCtrl.addFreeform(pts)` (same pattern as exclusion freeform, main.js:3311-3346)

**File**: `src/i18n.js`

Add keys: `objects3d.triangle` (DE: "Dreieck", EN: "Triangle"), `objects3d.freeform` (DE: "Freiform", EN: "Freeform")

---

### Phase 9: Settings Panel

**File**: `index.html`

In the settings panel 3D Objects section (~line 1176), add buttons for tri and freeform alongside the existing rect button:
```html
<button id="btnAddObj3dTri" class="btn small" style="border-color:rgba(34,197,94,0.5);color:#22c55e">+ Tri</button>
<button id="btnAddObj3dFreeform" class="btn small" style="border-color:rgba(34,197,94,0.5);color:#22c55e">+ Freeform</button>
```

**File**: `src/main.js`

Wire the new buttons:
- `#btnAddObj3dTri` → `obj3dCtrl.addTri()`
- `#btnAddObj3dFreeform` → start polygon draw → `obj3dCtrl.addFreeform(vertices)`

---

## Execution Order

The phases above are listed in dependency order. Execute them sequentially, testing after each phase:

1. **Phase 1** (data model) → test: unit test addTri/addFreeform create correct structures
2. **Phase 2** (floor exclusion) → test: `npm run test` (existing tests still pass, new objects subtract correctly from floor area)
3. **Phase 3** (2D SVG) → test: manual — tri/freeform objects visible in 2D plan
4. **Phase 4** (drag) → test: manual — can move and resize tri/freeform objects
5. **Phase 5** (properties) → test: manual — properties show correct fields for each type
6. **Phase 6** (3D render) → test: manual — tri/freeform objects visible in 3D view with correct geometry
7. **Phase 7** (face tiles) → test: `npm run test` — face tile metrics include tri/freeform; new E2E test
8. **Phase 8+9** (UI) → test: manual — all dropdown items and settings buttons work

## Files Modified

1. `src/objects3d.js` — addTri, addFreeform, dynamic surfaces, commitObjProps
2. `src/geometry.js` — getAllFloorExclusions polymorphic
3. `src/render.js` — 2D SVG polygon rendering + vertex handles + properties
4. `src/drag.js` — tri/freeform move and vertex resize
5. `src/three-view.js` — prism/extrusion geometry, edge face mappers, polygon top mapper
6. `src/main.js` — face tile computation, dropdown wiring, settings wiring
7. `src/calc.js` — face tile computation (parallel to main.js)
8. `index.html` — dropdown items, settings panel buttons
9. `src/i18n.js` — new translation keys

## Verification

- `npm run test` after every phase — all existing tests pass
- New E2E test: create tri object with tiled front face → metrics include face tiles
- New E2E test: create freeform object → floor exclusion subtracts polygon area correctly
- Manual: add triangle via bottom bar → visible in 2D + 3D, draggable, resizable vertices
- Manual: add freeform via drawing tool → visible in 2D + 3D, draggable vertices
- Manual: double-click face in 3D view → surface editor opens, tile saves correctly
- Manual: metrics bar shows updated tile count when face tiles are configured
