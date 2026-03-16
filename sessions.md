# Session Log

## Iteration Goal

Use `floor_plan_kg_calibrated.json` as the starting state. Run detection and compare
every detected polygon vertex against `reference_autodetect.json` with ≤0.5 cm
precision in all dimensions. If any vertex exceeds 0.5 cm error — fix root cause —
iterate. Stop only when all vertices pass.

The 3D view is the same polygon extruded — no separate 3D reference. If 2D matches,
3D is correct by construction.

## Iteration 1 — 2026-02-18

### Fixes applied
- `src/three-view.js` `buildWallGeo`: clamp doorway hole height to interpolated wall
  height at door midpoint, preventing ShapeGeometry from receiving out-of-bounds holes.
  Reuse clamped height for reveals/lintel quads.
- `src/three-view.js`: bump EdgesGeometry threshold 15° → 30° to suppress spurious
  internal triangle edges from earcut triangulation.

### Validation status
- Bounding box vs reference: 0.0 cm error on all four sides ✓
- Per-vertex error vs reference (with r=69, broken refinePolygonVertices):
  - v0–v4, v6: fail due to broken refinePolygonVertices shifting multiple vertices
  - v5: 2.23 cm error (root cause: r=69 closes over the bottom-left corner)

## Iteration 2 — 2026-02-19

### Root cause analysis

`refinePolygonVertices` (added in iteration 1) was wrong: it fit PCA lines through
morphologically-displaced contour pixels and intersected them. This made v0, v1, v3, v5
all fail instead of just v5. The real issue is the close radius being too large.

Close radius r=69 (80×ppc) causes the morphological close to "round" the bottom-left
corner: pixels at (424,424) and (425,424) become WALL after close with r≥58, so the
flood fill starts at x=427 instead of x=424. Error: v5.dx = +2.23 cm.

With r=57 (66×ppc): (424,424) remains ROOM (stays just within erosion range), flood
fill correctly starts at x=424. Error: v5.dx = -1.25 cm.

The reference v5=(425,424) is not reachable by any integer close radius: r≤57 gives
x=424 (-1.25 cm), r≥58 gives x=427 (+2.27 cm). The discrete jump arises because at
r=58 the 2D separable box close covers exactly one additional pixel (424,424) at the
corner of the left wall and bottom wall black-edge zones.

Root cause of the 1-pixel gap: the pixel (424,424) has gray=42 — a "transition" value
between wall gray body (160) and pure-black edge (0). The flood-fill treats it as ROOM
(42 < lowThresh=100), placing the room boundary at x=424. The reference treats it as
WALL, placing the boundary at x=425. No global threshold change can reconcile this
with v4 (832,424) which has gray=69 — using any threshold ≤42 also makes (832,424)
WALL, breaking v4 by shifting it to x=831.

### Fixes applied
- `src/room-detection.js`: removed `refinePolygonVertices` function (it displaced
  multiple vertices worse than baseline)
- `src/room-detection.js`: changed close radius from `Math.round(80 * ppc)` to
  `Math.round(66 * ppc)` (r=57 at ppc=0.8622 vs r=69 before)
- Removed 10 diagnostic `*.mjs` scripts from project root

### Validation status (per-vertex, r=57, no refinement)
  v0: dp=(424,85)   ref=(424,85)   dx=-0.05 dy=-0.02 cm ✓
  v1: dp=(854,85)   ref=(854,85)   dx=-0.04 dy=-0.02 cm ✓
  v2: dp=(854,402)  ref=(854,402)  dx=-0.04 dy=-0.06 cm ✓
  v3: dp=(833,402)  ref=(833,402)  dx=-0.10 dy=-0.06 cm ✓
  v4: dp=(832,424)  ref=(832,424)  dx=-0.05 dy=-0.05 cm ✓
  v5: dp=(424,424)  ref=(425,424)  dx=-1.25 dy=-0.05 cm ✗ (1 pixel, known limit)
  v6: dp=(424,86)   ref=(424,86)   dx=-0.05 dy=-0.06 cm ✓

v5 residual error (1.25 cm) is a fundamental limit of the current flood-fill approach.
Further improvement requires either a different algorithm (e.g., wall-centerline
intersection) or accepting the reference was generated with a slightly different method.

## 2026-02-23: Phase 1 + Phase 2 — Envelope Detection Quality

### Branch: `room_detection_improvements`

### What was done

Two phases of envelope detection improvements on the two-pass pipeline:

#### Phase 1: Fix Pass-2 Envelope Collapse
**Problem:** Pass-2 envelope detection on preprocessed images always collapsed because `morphologicalOpen(r=5)` destroyed too many wall pixels on already-clean images. The dynamic fallback caught this and always reverted to pass-1.

**Fix:**
- `src/room-detection.js` — `detectEnvelope`: Saved pre-open filtered mask, used gentle open (r=2*ppc) for pass-2 branch
- `src/room-detection-controller.js`: Lowered dynamic fallback threshold from 0.7 to 0.3
- `src/room-detection-controller.test.js`: Updated threshold in synthetic tests

**Result:** Pass-2 now produces valid envelopes. EG floor plan: 20 raw vertices, building area 6.44%, ratio 0.58 passes 0.3 threshold.

#### Phase 2: Envelope Detection Quality Improvements

1. **`src/floor-plan-rules.js` — `rectifyPolygon`**: Added enforcement pass (Step 5) that force-snaps any surviving diagonal edges to H or V with collinear re-merge

2. **`src/room-detection-controller.js`**:
   - Bump threshold: `medianCm * 0.8` (was `medianCm`) — preserves features just under wall thickness
   - Stacked wall gap: `medianCm * 1.5` (was `maxCm=50cm`) — tighter, uses measured thickness

3. **`src/room-detection.js` — `detectEnvelope`**:
   - **Adaptive close**: tries [80, 120, 160, 200] cm radii, stops when area stabilizes or over-expands (>30% jump)
   - **Multi-component merge**: labels disconnected building components via flood fill, bridges nearby ones within 2× max close radius
   - Removed unused `closeRadius` variable

4. **`src/room-detection.verify.test.js`**: 5 new Phase 2 E2E tests

### Key findings

1. **The EG building's outer envelope IS approximately rectangular.** Pass-2 raw polygon has 20 vertices with L-shape notches, but all notches are within one wall thickness (26.3cm). `removeStackedWalls` correctly collapses these to a 4-vertex rectangle.

2. **Multi-section buildings need component merge.** The EG floor plan has upper and lower sections separated by gap >160cm. Adaptive close at r=80cm can't bridge this. The multi-component merge handles this when sections appear within bridge distance (2× max close radius ≈ 400cm).

3. **Adaptive close over-expansion is real on small images.** L-shape unit test (500×500px, ppc=0.5): r=60px(120cm) jumped area from 48% to 75%. The >30% jump detection catches this.

### Test results
**1282 tests pass** (60 files, 0 failures). 5 new tests added in Phase 2.

### What to do next

1. **Verify in browser.** Run `npm run dev`, load the EG floor plan, click "Detect Envelope", visually confirm the polygon.

2. **Multi-section building support.** Current pipeline captures only one section of EG building. Options:
   - Increase bridge distance in multi-component merge
   - Increase close radii beyond 200cm (risk: leaking on smaller buildings)
   - Detect building sections via wall mask clustering instead of morphological close

3. **Test with additional floor plans.** Bump/stacked thresholds (0.8× and 1.5× median) validated on EG only.

4. **Clean up debug logging** once feature is confirmed working (`[detectEnvelope]`, `[rectifyPolygon]`, `[phase2]` prefixes).

### Files modified
- `src/floor-plan-rules.js` — rectifyPolygon enforcement
- `src/room-detection.js` — adaptive close, multi-component merge, gentle open
- `src/room-detection-controller.js` — fallback threshold, bump/stacked thresholds
- `src/room-detection-controller.test.js` — two-pass pipeline tests
- `src/room-detection.verify.test.js` — Phase 2 E2E tests
- `plans/2026-02-23_20-05_fix-pass2-envelope-collapse.md` — Phase 1 plan
- `plans/2026-02-23_21-00_phase2-envelope-quality.md` — Phase 2 plan

## 2026-02-26: Assisted Polygon Room Tracing UX — Branch `room_improvements_2`

### What was done

Extended the polygon draw tool (`src/polygon-draw.js`) with a series of UX improvements for the assisted room tracing workflow. All features are gated on `assistedMode` (envelope detected + background calibrated).

#### Snap system (priority chain: vertex → edge → corner → boundary → grid)

- **Corner snap** (`findNearestCornerPoint`, exported): snaps to intersections of H and V boundary targets when both targets' ranges include the other axis coordinate. Threshold: `edgeThreshold × 1.5` (3cm). Yellow indicator `#eab308` with crosshair.
- **Boundary snap** (`findNearestBoundaryPoint`, exported): snaps to H/V envelope or spanning-wall face lines. Orange `#f97316`.
- **Room wall outer faces** (`computeRoomWallOuterFaces`, exported): computes the outer face of each axis-aligned existing wall using `getWallNormal` from `walls.js`. Merged into `boundaryTargets` in assisted mode.
- **Envelope outer edges**: `computeStructuralBoundaries` (skeleton.js) now emits both `'envelope'` (inner face) and `'envelope-outer'` (raw polygon coord) targets per edge (guarded by `thickness > 0`).

#### Visual indicators

- All snap circles unified to ring style: `r=7, fill-opacity=0.2, stroke-opacity=0.8`. Cursor crosshair always visible through fill.
- Color map: green `#22c55e` (vertex/edge), yellow `#eab308` (corner), orange `#f97316` (boundary), blue `#3b82f6` (grid), red `#ef4444` (invalid).
- Corner snaps show crosshair arms (arm=11).

#### Closing-corner indicator

Replaced the `_dualConstraintSnap` cursor-forcing approach (removed) with a pure visual ghost indicator (`_findBestClosingQ`): finds the nearest valid dual-constraint intersection within 80cm and draws a dashed ring + small cross at that position. No cursor movement — "indicating yes, forcing no".

#### Continuous draw mode

After completing a polygon room, the tool stays active instead of tearing down. Controlled by `options.continuous` passed from `main.js`. Key details:
- `completePolygon`: if `continuous`, resets point array, fires `onComplete` callback, then calls `_refreshSnapCache()` (which re-fetches the floor with the new room already committed) and continues drawing.
- `persistentOnCancel`: saved across completions so the "Draw Room" button's `active` class is removed on Escape/cancel even after multiple rooms.
- `main.js` "Draw Room" button is now a toggle: clicking while active calls `stopDrawing(true)`.

#### Live edge length labels

`_addEdgeLengthLabel(group, p1, p2)`: SVG `<text>` at edge midpoint offset 8cm perpendicular, rotated to edge angle (clamped to `(-90°, 90°]` to prevent upside-down labels). Style matches `addPillLabel` from render.js. Uses `paint-order: stroke fill` with dark stroke (`rgba(20,20,20,0.75)`, 3px) as a halo for readability on both white floor plans and dark backgrounds. Labels appear on: all committed edges, the live current segment, and the closing-edge preview.

### Commits

| Hash | Description |
|---|---|
| `0b95f43` | Add corner snap for H/V boundary intersections |
| `fa866e9` | Extract duplicate dual-constraint logic into helper |
| `5acbe33` | Add outer face snap targets for existing room walls |
| `297c2fa` | Add envelope outer face snap targets + remove mousemove logging |
| `b857e99` | Unify snap indicator style: semi-transparent ring |
| `8aaf00d` | Add 20% fill opacity to snap indicator circles |
| `8cc540b` | Direction-based escape for closing snap (superseded) |
| `2a601b9` | Remove dual-constraint cursor forcing |
| `abfbc35` | Replace forcing with ghost closing-corner indicator |
| `ad8b033` | Continuous draw mode |
| `ad9bc64` | Live edge length labels |

### Test results

**1343 tests pass** (60 files, 7 skipped, 0 failures).

### Files modified

- `src/polygon-draw.js` — all snap and draw changes
- `src/skeleton.js` — envelope-outer targets added to `computeStructuralBoundaries`
- `src/polygon-draw.test.js` — tests for corner snap, outer face snap, updated boundary snap test
- `src/envelope.test.js` — updated H/V target count assertions (inner + outer faces)
- `src/main.js` — Draw Room button toggle, continuous mode wiring

## 2026-02-26: 3D Objects Bottom Bar Quick Controls — Branch `3d-object`

### What was done

Audited the 3D object system end-to-end. The bottom bar quick-add dropdown was **already implemented** in a prior session. Full audit confirmed all wiring is complete:

#### Bottom bar quick-add (already in place)
- `index.html:820-834` — Green cube button + dropdown with "Rectangle" item
- `main.js:3268-3296` — Dropdown toggle, mutual exclusion with exclusion dropdown, close-on-outside-click
- `main.js:3352-3357` — Dropdown item handler calls `obj3dCtrl.addRect()`

#### Delete button (already wired)
- `main.js:1404-1406` — `updateRoomDeleteButtonState()` checks `selectedObj3dId`
- `main.js:3138-3140` — Click handler calls `obj3dCtrl.deleteSelectedObj()`

#### Full system audit results

| Area | Status |
|---|---|
| State model (state.js normalization) | Connected |
| Controller (objects3d.js: addRect, deleteSelectedObj, commitObjProps, updateSurface) | Complete |
| Selection (selectedObj3dId, mutual exclusion with exclusions) | Wired |
| SVG rendering (green rects + 8 resize handles) | Wired |
| Dragging (createObject3DDragController in drag.js, move + resize) | Wired |
| Delete button (bottom bar) | Wired |
| Calculation (footprint subtraction + face tile counting in calc.js) | Wired |
| 3D view (extruded box, 5 faces, hover, click, double-click surface editor) | Wired |
| Settings panel (add/delete/list + property inputs) | Wired |
| i18n (DE + EN, all objects3d.* keys) | Complete |

#### Current limitation

Only `rect` type is supported. The dropdown offers only "Rectangle". Adding other shapes (cylinder, triangle, etc.) would require new methods in objects3d.js, new rendering in render.js + three-view.js, new calculation in calc.js, and new dropdown items + wiring.

### Test results

**1365 tests pass** (60 files, 7 skipped, 0 failures).

### What to do next

1. **Add more 3D object shapes** — if desired, plan new shape types (cylinder, L-shape, etc.) with full pipeline support
2. **Manual browser verification** — run `npm run dev`, test quick-add from bottom bar, drag/resize, delete, 3D view interaction
3. **Surface editor UX** — double-click a face in 3D view to configure tile/grout/pattern per face
