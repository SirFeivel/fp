# Plan: Wall Detection Improvements

## Status

Steps 0–4 from the previous plan are complete and working:
- `FLOOR_PLAN_RULES` config exists in `src/floor-plan-rules.js`
- `rectifyPolygon()` snaps edges to standard angles, removes noise — working
- `alignToExistingRooms()` adjusts floorPosition to match existing rooms — working
- White canvas fill in `loadImageData` fixes SVG transparency — working
- `mergeCollinearWalls()` exists in `src/walls.js` — called from controller but gap tolerances are too small for actual inter-room gaps

---

## Step 1: SVG resolution upscaling ✅

**Status:** Implemented — branch `svg-resolution-upscaling`, commit `00a1d6f`

**File:** `src/room-detection-controller.js` — `loadImageData` + `handleSvgClick`

**Problem:** SVGs are vector-based with infinitely crisp edges, but the pipeline rasterizes them at their native document dimensions (e.g., 794×1123 for an A4 SVG at 96 DPI). This gives ppc ≈ 0.38, where each pixel represents ~2.6 cm — too coarse for reliable wall thickness measurement. At 4× resolution (ppc ≈ 1.51), measurements stabilize within ±2 cm.

**Reference data:**

| Scale | ppc | Wall thickness accuracy |
|-------|-----|------------------------|
| 1× | 0.38 | ±2.6 cm per pixel, unreliable |
| 2× | 0.76 | measurements stabilize |
| 4× | 1.51 | inner wall: 25.5 cm (real: 24), outer: 35.1 cm (real: 30) |

### Implementation details

**Constant:** `SVG_DETECTION_SCALE = 4` at module top level.

**`getDetectionScaleFactor(dataUrl)`** — new exported pure function. Returns `4` for SVG data URLs (`data:image/svg+xml`), `1` for raster images. Exported for testability.

**`loadImageData(dataUrl, nativeWidth, nativeHeight)`** — modified to:
- Detect SVG via `getDetectionScaleFactor(dataUrl)`
- If SVG: canvas dimensions = `nativeWidth × 4` by `nativeHeight × 4`
- If raster: canvas dimensions = `nativeWidth × nativeHeight` (unchanged)
- Returns `{ imageData, scaleFactor }` instead of bare `ImageData`

**`handleSvgClick(e)`** — modified to:
1. Destructure `{ imageData, scaleFactor }` from `loadImageData`
2. Compute `effectivePpc = pixelsPerCm * scaleFactor`
3. Build `effectiveBg` — shallow copy of `bg` with `scale.pixelsPerCm` set to `effectivePpc` (identity when `scaleFactor === 1`)
4. Move `cmToImagePx` call after `loadImageData` so it uses `effectiveBg`
5. Pass `effectivePpc` to `detectRoomAtPixel` and door gap width conversion
6. Use `effectiveBg` for all `imagePxToCm` conversions back to cm

**Key invariant:** `imagePxToCm(px × 4, py × 4, { ppc: ppc × 4 })` gives the same cm result as `imagePxToCm(px, py, { ppc })`. The upscaling is transparent to all downstream code — `polygonCm`, `doorGapsCm`, and everything in `confirmDetection` sees identical cm coordinates regardless of scale.

**What does NOT change:**
- `bg.scale.pixelsPerCm` in stored state — untouched
- `bg.nativeWidth` / `bg.nativeHeight` — untouched
- `confirmDetection` — receives cm coordinates, unaffected
- `detectRoomAtPixel` — already parameterized by `pixelsPerCm`
- `detectWallThickness` — measures in pixels, scales with the image automatically

**Memory:** 4× scale: 794×1123 → 3176×4492 = ~14.3M pixels × 4 bytes = ~57 MB. Allocated during detection, GC'd after `handleSvgClick` returns.

### Tests

**`src/room-detection-controller.test.js`** — new file, 7 tests:
- `getDetectionScaleFactor`: returns 4 for SVG (plain + charset variant), 1 for PNG/JPEG/null/undefined
- Coordinate invariant: `imagePxToCm(px*4, py*4, ppc*4) === imagePxToCm(px, py, ppc)` (verified to 6 decimal places)
- Roundtrip `cmToImagePx → imagePxToCm` is identity at any scale; 4× has ≤¼ the rounding error of 1×

All 1110 tests pass (1103 existing + 7 new).

---

## Step 2a: Improve `detectWallThickness` — RGBA color-aware, per-edge ✅

**Status:** Implemented — branch `wall-optimisation`, commit `3b4c296`

**Files:** `src/room-detection.js`, `src/room-detection-controller.js`, `src/room-detection.test.js`

**Problem:** The original `detectWallThickness` used a binary mask — every dark pixel counted as "wall". This lost color information: red annotations, pink markers, and anti-aliasing fringes inflated measurements. It also returned a single median for the entire room, making it impossible to distinguish outer walls (30 cm) from inner walls (24 cm).

### Implementation details

**`classifyWallPixel(r, g, b)`** — private helper. Three-way RGBA pixel classification using luminance + saturation instead of the original neutral-hue gate:

```
gray = 0.299r + 0.587g + 0.114b
sat  = (max(r,g,b) - min(r,g,b)) / max(r,g,b)    // HSV saturation, 0=neutral, 1=pure hue

gray < 80                → 'edge'   (any color — dark is dark)
gray ∈ [80, 120), sat<0.3 → 'edge'  (dark neutral wall line)
gray ∈ [80, 120), sat≥0.3 → 'fill'  (dark colored wall body, e.g. brown 139,69,19 → gray≈84, sat≈0.86)
gray ∈ [120, 200)         → 'fill' if sat ≤ sliding threshold, else 'background'
                            threshold: 0.65 at gray=120, linearly down to 0.35 at gray=200
gray ∈ [200, 220), sat<0.2 → 'fill' (light beige/cream fills, e.g. 220,210,190 → gray≈212, sat≈0.14)
gray ≥ 220 or high sat     → 'background'
```

**Why saturation replaced neutral-hue gating:** The original `(R-G) < 40 && (R-B) < 40` rejected all colored walls. Brown walls (139,69,19) have R-G=70 → failed the gate → classified as background. Blue walls (0,0,255) have R-B=−255 → failed the gate. The saturation approach recognizes that wall materials can be any color — what matters is luminance (dark = wall structure) and saturation (high saturation + mid-luminance = colored wall fill, not annotation).

**`probeWallThickness(data, startX, startY, perpX, perpY, w, h, maxProbe)`** — private helper. Walks outward from a polygon edge point, classifying each pixel. Tracks the full contiguous wall band (edge + fill pixels), with a 2px background gap tolerance for anti-aliasing. If ≥2 distinct edge runs found within the band, returns center-to-center distance. Otherwise returns full band width.

**Critical fix during implementation:** The original plan's state machine (`seekInner → seekOuter`) required edge pixels first. Real floor plans (gray-fill walls) often start with fill pixels directly at the polygon boundary, not edge pixels. The probe was rewritten to track the entire wall band regardless of whether it starts with edge or fill.

**`detectWallThickness(imageData, polygonPixels, w, h, pixelsPerCm, opts)`** — rewritten export:
- Signature: accepts `imageData` (RGBA) instead of binary `mask`, plus `pixelsPerCm` for px→cm conversion. `opts` can be `{ probeInward, maxProbe }` or a bare number for backward compat.
- Returns: `{ edges: [{edgeIndex, thicknessPx, thicknessCm}], medianPx, medianCm }` instead of single scalar
- Per-edge: 7 samples evenly spaced along each edge, median of samples (increased from 3 in initial implementation)
- Uses `FLOOR_PLAN_RULES.wallThickness` as the single source of truth for bounds:
  - Probe cap: `ruleMaxCm + 10` cm (small margin for anti-aliasing)
  - Filter: samples outside `[ruleMinCm, ruleMaxCm]` in cm are rejected (junction crossings, polygon misalignment)
- Overall median from all per-edge medians

**Controller wiring (`room-detection-controller.js`):**
- `_detectedWallThicknesses` state variable stored alongside polygon and door gaps
- In `confirmDetection`: matches raw polygon edge midpoints to rectified edges using `closestPointOnSegment` (from `polygon-draw.js`), applies per-edge thickness to walls within `FLOOR_PLAN_RULES.wallThickness` bounds [5, 50] cm

### Verified results (Projekt 67 floor plan)

| Edge | Thickness (cm) | Result |
|------|---------------|--------|
| 0 | 31 | SET ✓ |
| 1 | 26 | SET ✓ |
| 2 | 52 | SKIPPED (> 50 cm max) |
| 3 | 52 | SKIPPED (> 50 cm max) |
| 4 | 26 | SET ✓ |
| 5 | 32 | SET ✓ |

Edges 2–3 measure through complex geometry (corner/double wall), correctly filtered by bounds check.

### Tests

All 1113 tests pass (1110 original + 3 new). Adaptability hardening added 2 more (brown + blue wall tests, counted in Step 3 totals):
- Rectangular room with edge+fill wall ring: median ∈ [6.5, 12], 4 edges
- Red pixels don't inflate measurement
- Per-edge measurements distinguishable (different wall thicknesses)
- `detectRoomAtPixel` returns `wallThicknesses` with edges/medianPx/medianCm
- Fewer than 3 vertices → empty result
- No wall pixels → empty result
- Brown-colored wall ring (139,69,19): valid thickness detected (adaptability hardening)
- Blue-colored wall ring (0,0,180): valid thickness detected (adaptability hardening)

---

## Step 2b: Detect floor envelope — outer boundary ✅

**Status:** Implemented — branch `envelope-detection`

**Files:** `src/room-detection.js`, `src/room-detection-controller.js`, `src/main.js`, `src/background.js`, `src/room-detection.test.js`

**Concept:** Before any room is detected, analyze the background image once to find the building's outer boundary. This is a floor-level property (`floor.layout.envelope`), computed from the calibrated background, that constrains all subsequent room detections.

**Why it matters:**
- Outer walls are continuous across multiple rooms (e.g., Trockenraum's top wall continues as Keller's top wall). Detecting rooms independently loses this — each room gets its own polygon edge at a slightly different position, creating gaps instead of shared walls.
- With the envelope known upfront, any room edge that coincides with the envelope boundary is automatically identified as an outer wall with a known, consistent thickness.

**Trigger:** Automatically after calibration completes — no user interaction needed. Fire-and-forget from both calibration `onComplete` callbacks in `main.js`.

### Algorithm

1. Build wall mask: `autoDetectWallRange` → `buildGrayWallMask` (with saturation fallback for colored walls) → `filterSmallComponents` → `morphologicalOpen`; fallback to `imageToBinaryMask` with threshold sweep.
2. `morphologicalClose` with radius `round(80 × ppc)` — seals gaps up to 160 cm, covering all standard doorways and double doors. Room detection uses [20, 40, 66] cm and picks the smallest that works (to preserve doors); envelope uses the largest because it must seal ALL openings.
3. `floodFillFromBorder(closedMask, w, h)` — BFS from all image border pixels through open (0) pixels → `exteriorMask`
4. Invert to building mask: `buildingMask[i] = (exteriorMask[i] === 0) ? 1 : 0`
5. `fillInteriorHoles(buildingMask)` — fill text/annotation gaps within the building
6. Sanity check: building must be 1–99% of image area (rejects all-white, all-black, and degenerate images)
7. `traceContour` → `douglasPeucker(epsilon)` → `snapPolygonEdges` → envelope polygon
8. `detectWallThickness(imageData, polygonPixels, w, h, ppc, { probeInward: true })` — probes inward (toward building center) because the envelope polygon traces the outer boundary

### Implementation details

**`autoDetectWallRange(imageData)`** — histogram-based wall fill detection. Three parameter changes for colored wall support:

| Parameter | Original | Updated | Reason |
|-----------|----------|---------|--------|
| Search floor | gray=30 | gray=10 | Captures very dark colored walls (blue at gray≈29, dark brown at gray≈20). Pure black edge lines cluster at 0–5 and are thin enough to stay below the pixel count threshold. |
| Peak threshold | 0.5% | 0.3% | Colored fills spread across multiple luminance bins; thin-walled plans have fewer wall pixels total. |
| Band width | ±60 | ±80 | Multi-toned walls (gradient transitions, aliasing) span a wider luminance range. |
| Low clamp | 20 | 5 | Allows the returned `low` to reach into very dark wall fills. |

**`buildGrayWallMask(imageData, lowThresh, highThresh)`** — binary mask from luminance thresholds. Added a saturation fallback after the primary luminance check:

```
For each pixel with gray ∈ [10, lowThresh):
  If sat > 0.3 AND max(r,g,b) > 40 → classify as wall (mask=1)
```

This catches colored wall fills (brown, red, blue) whose luminance falls below the detected gray range. The `maxC > 40` guard excludes near-black edge pixels (which must remain open for flood fill). The `sat > 0.3` guard excludes neutral dark pixels that belong to wall edges, not fills.

**`floodFillFromBorder(mask, w, h)`** — new export in `room-detection.js`. BFS from all 4 image borders through open (mask=0) pixels. Returns `Uint8Array` exterior mask (1=reachable from border, 0=building/wall). Structurally similar to the BFS in `fillInteriorHoles` but semantically different: `fillInteriorHoles` identifies holes in a room fill, `floodFillFromBorder` identifies the exterior around a building.

**`detectEnvelope(imageData, options)`** — new export in `room-detection.js`. Pure orchestrator that calls the pipeline functions above. Returns `{ polygonPixels, wallThicknesses, wallMask, buildingMask }` or `null`.

**`detectWallThickness` probe direction fix:** Added `probeInward` option (default `false`). When `true`, the perpendicular probe direction points toward the polygon centroid instead of away from it. Room polygons (inner boundary) probe outward into walls — correct. Envelope polygons (outer boundary) must probe inward to cross the wall body. Without this fix, the probe went into empty exterior space and measured only the thin edge line (~3 cm instead of ~30 cm). Backward-compatible: existing callers passing a bare `maxProbe` number still work via `typeof opts === "number"` guard.

**`removePolygonMicroBumps(vertices, maxBumpDepthCm)`** — post-processing step for envelope polygons. Removes axis-aligned protrusions shallower than `maxBumpDepthCm`. Default changed from hardcoded `30` to `FLOOR_PLAN_RULES.wallThickness.maxCm` (currently 50 cm) — part of the single-source-of-truth consolidation. All existing callers pass explicit values, so the default only affects direct calls without arguments.

**`detectAndStoreEnvelope({ getState, commit, getCurrentFloor })`** — new standalone async export in `room-detection-controller.js`. Loads image via `loadImageData` (SVGs upscaled 4×), runs `detectEnvelope`, converts pixels to cm via `imagePxToCm`, rectifies polygon via `rectifyPolygon`, stores result in `floor.layout.envelope`, commits to state.

**`loadImageData`** — changed from file-internal to exported (needed by `detectAndStoreEnvelope`).

**Trigger wiring (`main.js`):** Both calibration `onComplete` callbacks call `detectAndStoreEnvelope(...).catch(...)` after `showCalibrationSuccess()`. Fire-and-forget — commits to state on its own.

**Envelope clearing (`background.js`):** `delete floor.layout.envelope` in both `setBackground()` and `removeBackground()`. When background changes or is removed, the detected envelope is invalidated.

### Critical fix during implementation

**Close radius too small:** The initial plan specified `round(20 × ppc)` = 30 px at the reference floor plan's effective ppc (1.512). This only seals gaps up to 40 cm, but real doorways are 60–100 cm wide. The exterior flood fill leaked through unsealed doorways, producing a 38-vertex jagged polygon that traced around internal wall features. Fixed to `round(80 × ppc)` = 121 px, sealing gaps up to 160 cm.

**Probe direction inverted:** `detectWallThickness` always probed away from the polygon centroid (outward). For rooms this is correct (walls are outside). For the envelope, walls are inside the outer boundary, so outward means probing into empty space. The probe measured only the thin 2px edge line at the boundary (~3.3 cm), not the full wall body. Fixed by adding `probeInward: true` option.

### Storage

```js
floor.layout.envelope = {
  polygonCm: [{x, y}, ...],     // Building outer boundary in floor-global cm (rectified)
  wallThicknesses: {             // Same structure as detectWallThickness return
    edges: [{ edgeIndex, thicknessPx, thicknessCm }],
    medianPx, medianCm
  }
}
```

Optional. Missing `envelope` means detection hasn't run. Cleared when background/calibration changes. No state migration needed.

### Verified results (Projekt 68 floor plan)

| Metric | Value |
|--------|-------|
| Polygon vertices | 8 |
| Median wall thickness | 29.8 cm |
| Edges measured | 8 |

8 vertices for an L-shaped building outline. 29.8 cm median outer wall thickness — consistent with real-world measurements (typical outer walls: 24–36 cm).

### Tests

All 1122 tests pass (1113 existing + 9 new):

| # | Test | Assertion |
|---|------|-----------|
| 1 | `floodFillFromBorder`: wall ring | exterior=1 outside, interior=0 inside, wall=0 |
| 2 | `floodFillFromBorder`: no walls | entire image is exterior |
| 3 | `floodFillFromBorder`: all walls | nothing is exterior |
| 4 | `detectEnvelope`: rectangular building (400×300 image) | polygon ≥ 3 vertices, bbox in range |
| 5 | `detectEnvelope`: returns wallThicknesses | edges.length ≥ 1 |
| 6 | `detectEnvelope`: all-white | returns null |
| 7 | `detectEnvelope`: all-black | returns null |
| 8 | `detectEnvelope`: L-shaped building (500×500 image) | polygon ≥ 4 vertices |
| 9 | E2E: envelope bbox contains detected room | env min ≤ room min, env max ≥ room max |

Test images use realistic sizes (400×300 to 500×500 at ppc=0.5) to survive the 80cm close radius without shape obliteration.

---

## Step 3: Detect full-span structural walls inside the envelope ✅

**Status:** Implemented — branch `structural-walls`

**Files:** `src/room-detection.js`, `src/room-detection-controller.js`, `src/room-detection.test.js`, `index.html`, `src/main.js`

**Concept:** Beyond the outer boundary, floor plans contain continuous interior walls that run the full span of the building — from one outer wall to the opposite outer wall. These are structural dividing walls, not room partitions.

**Example (floorplan_KG.svg):** One horizontal 24 cm wall runs from the left outer wall to the right outer wall, separating Trockenraum/Keller (above) from Heizraum/Flur/Waschküche/TRH (below). Vertical room partitions within each zone do NOT span the full building height — they stop at the H spanning wall.

### Algorithm

**Phase 1 — Density profiling:**

For each row (horizontal scan) or column (vertical scan), compute:
- `bldgFirst`/`bldgLast`: first/last building mask pixel in the cross direction
- `density = wallCount / bldgWidth` (wall pixels within building extent)
- `spanFraction = wallSpan / bldgWidth` (coverage from first to last wall pixel)

Qualifying rows/columns: `density ≥ 0.4 AND spanFraction ≥ 0.7`. Skip rows/columns with building width < 50 px (thin protrusions).

**Phase 2 — Band detection:**

Group consecutive qualifying rows (or columns) into bands. Merge bands separated by ≤ `GAP_MERGE` rows/columns to handle anti-aliasing. `GAP_MERGE = max(1, ceil(2 × ppc))` — scales with resolution so the merge distance is always ~2 cm regardless of image DPI (previously hardcoded to 3 px, which was 3.5 cm at ppc=0.86 but only 0.86 cm at ppc=3.5). Annotate each band with average building extent (`avgBldgFirst`, `avgBldgLast`, `avgBldgWidth`).

**Phase 3 — Band validation (five criteria):**

1. **Thickness bounds:** band height in cm must be in `[minThicknessCm, maxThicknessCm]` (defaults from `FLOOR_PLAN_RULES.wallThickness`).

2. **Building width:** average building width at band ≥ `MIN_BUILDING_WIDTH_CM` (100 cm) — rejects wall-like features in degenerate thin sections.

3. **Boundary proximity:** band must be at least one band-height away from the building boundary. Measured via `distanceToBuildingBoundary()` — samples 5 cross positions, at each scans the building mask in the scan direction to find building extent, takes median of min(distToStart, distToEnd). Rejects outer wall inner edges even in non-rectangular buildings (L-shapes, notches). **Critical:** uses per-band local sampling, not global bbox, because a building notch can push the global bbox edge far from the main body, making outer wall edges appear far from the global boundary.

4. **Thickness consistency (`measureBandThickness`):** probes perpendicular to the wall at `NUM_SAMPLES = 5` evenly-spaced positions along its cross extent. Counts `validCount` = positions where `probeWallThickness > 0`. Requires `validCount ≥ ceil(5 × 0.8) = 4`. A real spanning wall is present at every sampled position; a phantom band created by coincidental density from unrelated crossing walls (outer walls, the H spanning wall itself) has many cross-positions in open room space where the probe finds nothing.

5. **Continuity and minimum span length:** The wall pixel run at the band's center scan line is checked for continuity. `maxAllowedGap = max(bandHeight × 2, avgBldgWidth × 0.25)` — proportional to building width (previously hardcoded 200 cm). A 10 m building allows 250 cm of total gaps (3 standard doors), a 5 m building allows 125 cm (1–2 doors). Additionally, the wall must span ≥ `MIN_SPAN_LENGTH_CM` (200 cm) of absolute length — this rejects short partitions in narrow arms of L/U-shaped buildings that pass the density threshold (40%) simply because the arm is narrow, not because the wall is structurally significant.

**Phase 4 — Measurement and endpoints:**

Surviving bands: `measureBandThickness` returns median of valid probe measurements as `thicknessPx`. Endpoints: `startPx = (avgBldgFirst, bandMid)`, `endPx = (avgBldgLast, bandMid)` for H; transposed for V.

### Implementation details

**`detectEnvelope` modified return (room-detection.js):** Now returns `wallMask` and `buildingMask` alongside `polygonPixels` and `wallThicknesses`. Backward-compatible — existing callers ignore extra fields.

**`detectSpanningWalls(imageData, wallMask, buildingMask, w, h, options)` — new export (room-detection.js):**
- Options: `{ pixelsPerCm, minThicknessCm, maxThicknessCm, rejections }`
  - `minThicknessCm` / `maxThicknessCm` default to `FLOOR_PLAN_RULES.wallThickness.minCm` / `.maxCm`
  - `rejections`: pass `[]` to collect rejection reasons (see below)
- Returns: `[{ orientation: 'H'|'V', startPx: {x,y}, endPx: {x,y}, thicknessPx }]`
- Runs `profileAndDetectBands` twice — once for H bands (scanning rows), once for V bands (scanning columns)
- All inner functions are closures within `detectSpanningWalls` (no pollution of module scope)

**Constants (all within `detectSpanningWalls` scope):**

| Constant | Value | Scales? | Purpose |
|----------|-------|---------|---------|
| `DENSITY_THRESHOLD` | 0.4 | Fixed | Min fraction of wall pixels per row/column |
| `SPAN_THRESHOLD` | 0.7 | Fixed | Min fraction of building width covered by wall span |
| `MIN_BUILDING_WIDTH_PX` | 50 | Fixed | Skip thin protrusions in Phase 1 |
| `MIN_BUILDING_WIDTH_CM` | 100 | Fixed | Reject bands in narrow building sections (Phase 3) |
| `MIN_SPAN_LENGTH_CM` | 200 | Fixed | Reject short partitions in L-shaped narrow arms |
| `GAP_MERGE` | `max(1, ceil(2 × ppc))` | ✓ ppc | Band merge distance ≈ 2 cm |
| `NUM_SAMPLES` | 5 | Fixed | Thickness probe positions per band |

**Rejection reasons (`rejections` option):** When `rejections` is an array, `validateAndMeasureBand` populates it with entries for each rejected band:

```js
{
  orientation: 'H' | 'V',           // scan direction
  band: { start, end },             // band row/column range
  reason: 'thickness_bounds' | 'building_width' | 'boundary_proximity'
        | 'thickness_consistency' | 'continuity' | 'span_length',
  details: { ... }                  // context-specific values (e.g. thicknessCm, spanLengthCm)
}
```

This makes debugging much easier — previously `validateAndMeasureBand` returned `null` silently with no way to know why a band was rejected.

**Controller wiring (`room-detection-controller.js`):** After `detectEnvelope` call in `detectAndStoreEnvelope`, calls `detectSpanningWalls` with `effectivePpc` and thickness bounds from `FLOOR_PLAN_RULES.wallThickness`. Converts px→cm via `imagePxToCm`. Stores as `spanningWalls` array in `floor.layout.envelope`.

**Debug buttons (`index.html`, `main.js`):** Three buttons in debug panel: **Clear Envelope** (deletes `floor.layout.envelope` and commits), **Create Envelope** (calls `detectAndStoreEnvelope` manually; useful after background changes without recalibration), **Export Envelope** (copies `floor.layout.envelope` JSON to clipboard for inspection and test fixture extraction).

### Approaches that were tried and discarded

**Interior check (`hasBuildingAtScanLine`):** Originally checked that building exists on both sides of the band (above/below for H, left/right for V). Replaced by boundary proximity check which handles this more robustly.

**Continuity check (`checkBandContinuity`):** At the band's middle scan line, required max gap in wall pixels < 30% of building extent. Intended to reject phantom bands from disjoint partitions in separate zones. **Failed** in the KG floor plan because: (a) outer walls contribute wall pixels at ALL cross positions including the phantom band's column, (b) the H spanning wall (a horizontal wall) crosses every vertical column, creating wall pixels at mid-height — together these pixels form a chain with no single gap > 30%, so the continuity check passed for the phantom while being too strict for real walls with wide doorways. Removed entirely.

**Global bbox boundary proximity:** First attempt used global building bounding box to find min/max extent. Failed because the KG building has a notch (left protrusion at x=531, main body from x=647) — the global bboxMinX=531 made the outer wall inner edge at x=661 appear 130 cm from the boundary, passing the check. Fixed by per-band local sampling.

### Key insight on phantom band formation

The phantom V band at x≈1187 cm (KG floor plan) was caused by the inwards corner structure of Trockenraum creating vertically-oriented wall pixels at that column, plus contributions from the outer walls and H spanning wall, pushing column density above 40%. The thickness consistency check rejected it because probing horizontally at 5 y positions within the building height found mostly open room space (only the H spanning wall rows and one zone's partition would return non-zero) — fewer than 4 of 5 probes succeeded.

### Storage

```js
floor.layout.envelope = {
  polygonCm: [{x, y}, ...],          // Building outer boundary (from Step 2b)
  wallThicknesses: { ... },           // Per-edge thickness (from Step 2b)
  spanningWalls: [                    // NEW (Step 3)
    {
      orientation: 'H' | 'V',
      startCm: { x, y },             // Wall centerline left/top endpoint (floor-global cm)
      endCm: { x, y },               // Wall centerline right/bottom endpoint (floor-global cm)
      thicknessCm: number,            // Measured wall thickness (rounded to 0.1 cm)
    }
  ]
}
```

`spanningWalls` is always an array (empty if no interior walls found). Cleared with the rest of the envelope when background changes.

### Verified results (floorplan_KG.svg, Kellergeschoss)

| Wall | Orientation | Position | Thickness | Assessment |
|------|-------------|----------|-----------|------------|
| H at y=1425.7 cm | H | y=1425.7 cm | 25.1 cm | ✓ Real spanning wall (reference: 24 cm inner) |

KG reference: outer walls 30 cm, inner/structural walls 24 cm. One horizontal spanning wall correctly detected; all phantom vertical walls rejected.

### Tests

All 1149 tests pass (1132 after Step 3 initial + 5 from adaptability hardening + 12 existing test changes):

**Initial Step 3 tests (10):**

| # | Test | Assertion |
|---|------|-----------|
| 1 | Single H spanning wall | 1 wall, orientation='H', center y correct |
| 2 | Single V spanning wall | 1 wall, orientation='V', center x correct |
| 3 | No interior walls | 0 walls |
| 4 | Short room partition rejected | 0 walls (span < 0.7) |
| 5 | Outer boundary walls not detected | Only interior wall detected (not outer H/V walls) |
| 6 | Boundary proximity: edge-flush band rejected | Outer wall inner edge excluded, interior wall kept |
| 7 | Discontinuous segments rejected | Two segments at same x with 60px gap → validCount=3 < 4 → 0 walls |
| 8 | Cross shape: both H+V detected | 2 walls (1 H, 1 V) |
| 9 | Thickness bounds enforced | 1px wall at ppc=0.5 → 2 cm < minThicknessCm → 0 walls |
| 10 | E2E: `detectEnvelope` + `detectSpanningWalls` pipeline | Returns masks; spanning wall inside envelope bbox |

**Adaptability hardening tests (5 new, added in `structural-walls` branch):**

| # | Test | Assertion |
|---|------|-----------|
| 11 | Brown-colored wall thickness | detectWallThickness with brown ring (139,69,19) → valid thickness |
| 12 | Blue-colored wall thickness | detectWallThickness with blue ring (0,0,180) → valid thickness |
| 13 | Saturation fallback in buildGrayWallMask | Brown pixel (gray≈84) below lowThresh=120 captured via sat>0.3 |
| 14 | Short partition in L-shaped narrow arm | 50px-wide narrow arm partition rejected by MIN_SPAN_LENGTH_CM |
| 15 | Rejections array populated | detectSpanningWalls with `rejections: []` → entries with reason/details |

---

## Adaptability Hardening (Steps 2a/2b/3) ✅

**Status:** Implemented — branch `structural-walls`, commit `56c46bf`

**Purpose:** The envelope detection pipeline (Steps 2a–3) was built and tuned against a single reference floor plan (KG — Kellergeschoss): rectangular building, black/gray walls on white background, 30 cm outer walls, one 24 cm H spanning wall. This hardening pass systematically identified and fixed assumptions that would break on different floor plans.

**Scope:** 7 changes across `room-detection.js`, touching `classifyWallPixel`, `autoDetectWallRange`, `buildGrayWallMask`, `detectWallThickness`, `detectSpanningWalls`, and `removePolygonMicroBumps`. No new exports; all changes are internal behavioral improvements. 5 new tests added.

### What was hardened

| Category | Change | Before → After |
|----------|--------|----------------|
| **Colored wall support** | `classifyWallPixel` | Neutral-hue gate `(R-G)<40 && (R-B)<40` → saturation-based classification. All dark pixels are edges; colored fills classified by luminance + saturation. |
| **Colored wall support** | `autoDetectWallRange` | Search floor 30, peak 0.5%, band ±60 → floor 10, peak 0.3%, band ±80. Captures dark colored fills and multi-toned walls. |
| **Colored wall support** | `buildGrayWallMask` | Luminance-only → saturation fallback for pixels below `lowThresh` with `sat > 0.3 && maxC > 40`. |
| **Single source of truth** | `detectWallThickness` | Hardcoded 60 cm probe cap, ad-hoc bounds → `FLOOR_PLAN_RULES.wallThickness` for probe limit and filter range. |
| **Single source of truth** | `detectSpanningWalls` defaults | Hardcoded min/max thickness → `FLOOR_PLAN_RULES.wallThickness.minCm/.maxCm`. |
| **Single source of truth** | `removePolygonMicroBumps` default | Hardcoded 30 → `FLOOR_PLAN_RULES.wallThickness.maxCm`. |
| **Resolution-adaptive** | `GAP_MERGE` | Fixed 3 px → `max(1, ceil(2 × ppc))` — always ≈2 cm regardless of DPI. |
| **Proportional thresholds** | `maxAllowedGap` | Fixed 200 cm → `max(bandHeight × 2, avgBldgWidth × 0.25)` — proportional to building width. |
| **L-shape robustness** | `MIN_SPAN_LENGTH_CM` | Not checked → walls must span ≥ 200 cm absolute. Rejects partitions in narrow L-shaped arms. |
| **Debuggability** | `rejections` option | Silent null returns → optional array of `{ orientation, band, reason, details }` entries. |

### What was NOT changed (deferred)

- **`rectifyPolygon` non-90° angles:** Supporting 45° or arbitrary angles was assessed as "nice to have" and deferred. Would require changes to `FLOOR_PLAN_RULES.standardAngles` and the snapping logic in `floor-plan-rules.js`. Risk: rotated or diagonal buildings still produce garbage geometry.

### E2E verification (300 DPI KG floor plan)

All 8 E2E tests in `room-detection.verify.test.js` pass after hardening:
- Room bbox: 0.0 cm error on all 4 sides
- Envelope: 4-vertex rectangle ~10 m × 8.5 m, no protrusion
- Wall thickness: all edges in [5, 50] cm (no anomalies)
- Spanning walls: exactly 1 H wall (~25.8 cm), 0 V walls (no phantom)

### Risk assessment for future floor plans

| Risk Level | Category | Notes |
|-----------|----------|-------|
| 🟡 Medium | Rotated/diagonal buildings | Angle discovery works (Step 4), but `rectifyPolygon` H/V classification needs fixing for non-90° angles |
| 🟡 Medium | L/U-shaped buildings | Better than before (MIN_SPAN_LENGTH_CM helps) but density thresholds may still false-positive in narrow arms |
| 🟡 Medium | Very thin walls (<5 cm) | Bounded by `FLOOR_PLAN_RULES.wallThickness.minCm` — configurable but not auto-detected |
| 🟢 Low | Colored walls | Saturation-based classification handles brown, blue, red, beige fills |
| 🟢 Low | Different resolutions | All morphological parameters scale with ppc |
| 🟢 Low | Non-white backgrounds | `autoDetectWallRange` adapts via histogram top-20% white detection |

---

## Step 4: Discover valid wall angles from the envelope ✅

**Status:** Implemented — branch `valid-wall-angles`

**Files:** `src/floor-plan-rules.js`, `src/room-detection-controller.js`, `src/floor-plan-rules.test.js`, `src/room-detection.verify.test.js`

**Concept:** The envelope's structural segments define which wall angles exist on this floor. This is a discovered property, not a hardcoded assumption — different floor plans have different angle sets. `FLOOR_PLAN_RULES.standardAngles` becomes the default/fallback when no envelope is available.

### Algorithm

**`extractValidAngles(polygonCm, spanningWalls = [], options = {})`** — new exported pure function in `floor-plan-rules.js` (placed after `round1()`, before `rectifyPolygon()`):

1. For each polygon edge and spanning wall segment: compute angle via `Math.atan2(dy, dx)`, round to nearest integer degree in [0, 360), accumulate total edge length per angle
2. Filter: keep angles whose total edge length ≥ `options.minEdgeLengthCm` (default from `FLOOR_PLAN_RULES.minEdgeLengthCm`)
3. Add complements: for each surviving angle `a`, ensure `(a + 180) % 360` is in the set (walls are bidirectional)
4. Fallback: if empty after filtering, return `[...FLOOR_PLAN_RULES.standardAngles]`
5. Return sorted array

### Implementation details

**`rectifyPolygon` step 1b — run-based axis merging:** New step added between edge classification (step 1) and noise removal (step 2). Detects consecutive same-type edge runs (e.g., multiple V edges separated by short diagonals) and merges their axis values when the spread is within `alignmentToleranceCm` (6 cm).

Algorithm:
1. Find an anchor edge that breaks any potential run (different type or long diagonal)
2. Walk the polygon from anchor+1, collecting runs of `{edgeType edges + short diagonals (len < mergeTol × 3)}`
3. For each run with ≥2 typed edges whose axis values spread ≤ `mergeTol`: compute length-weighted average, assign to all typed edges, reclassify sandwiched short diagonals as the same type

**Why run-based, not global:** Global merging (merging ALL V edges at similar x values) would collapse real L-shaped steps. Example: Room 2's L-shape has V edges at y=0 and y=4 (a 4cm step that is a real feature). Run-based merging only groups consecutive edges — edges separated by long edges of a different type (like the L-shape's H edge) are preserved.

**Second `rectifyPolygon` pass after bump removal:** `removePolygonMicroBumps` can remove a protrusion but leave a residual notch where the original wall edges were at slightly different positions (e.g., V edges at x=648 and x=643 on the left wall, separated by the now-removed bump). After bump removal, these V edges are consecutive (only a short diagonal connects them), so a second `rectifyPolygon` pass merges them via step 1b.

Example from the 300dpi KG floor plan:
- Raw detection: left wall has V edges at x=648, V at x=531 (protrusion), V at x=644
- After 1st rectify + bump removal: protrusion at x=531 removed → 7 vertices with V edges at x=648 and x=643, connected by 8.5cm diagonal
- After 2nd rectify: step 1b merges V edges (spread=5cm ≤ 6cm tolerance) → collinear merge → 4-vertex rectangle at x≈645

### Pipeline integration

**`detectAndStoreEnvelope`** pipeline reordered:

```
polygonCm → spanningWalls (moved up) → extractValidAngles
          → rectifyPolygon(discovered) → removePolygonMicroBumps → rectifyPolygon (2nd pass)
          → wallThickness → store(+validAngles)
```

Spanning wall detection was moved before rectification because `detectSpanningWalls` uses `wallMask`/`buildingMask` (pixel-level), not the rectified polygon. This lets `extractValidAngles` include spanning wall angles in the discovery.

**Critical finding during implementation:** The raw polygon from `detectEnvelope` has noise diagonal edges that can accumulate >5cm total. Using the default `minEdgeLengthCm` (5cm) caused noise angles (e.g., 53°/233°) to survive filtering. Fixed by passing `minEdgeLengthCm: FLOOR_PLAN_RULES.wallThickness.maxCm` (50cm) from the pipeline — "a real building direction needs at least 50cm of total edge length."

**`confirmDetection`** reads `validAngles` from the stored envelope:

```js
const envelope = floor?.layout?.envelope;
const rules = envelope?.validAngles
  ? { ...FLOOR_PLAN_RULES, standardAngles: envelope.validAngles }
  : FLOOR_PLAN_RULES;
const rectifiedGlobal = rectifyPolygon(_detectedPolygonCm, rules);
```

Falls back to `FLOOR_PLAN_RULES` when no envelope exists (backward-compatible).

### Storage

```js
floor.layout.envelope = {
  polygonCm,        // existing
  wallThicknesses,  // existing
  spanningWalls,    // existing
  validAngles,      // NEW: e.g. [0, 90, 180, 270]
};
```

No migration needed — missing `validAngles` triggers fallback.

### Verified results (KG floor plan, 300dpi)

| Metric | Value |
|--------|-------|
| Discovered angles | `[0, 90, 180, 270]` (matches hardcoded default) |
| Polygon vertices | 4 (clean rectangle) |
| Polygon dimensions | ~997cm × 855cm (~10m × 8.5m) |
| Polygon bbox | `(645, 990.6)–(1642.3, 1845.6)` |
| Old vs new pipeline | Identical output (vertex positions, wall thicknesses, spanning walls) |
| Wall thicknesses | All edges in [5, 50] cm (no anomalies) |
| Spanning walls | 1 H (~25cm), 0 V (no phantom) |

### Tests

All 1167 tests pass (1149 existing + 18 new):

**Unit tests (7 new in `floor-plan-rules.test.js`):**

| # | Test | Assertion |
|---|------|-----------|
| 1 | Axis-aligned rectangle | `[0, 90, 180, 270]` |
| 2 | 45°-rotated square | `[45, 135, 225, 315]` |
| 3 | L-shaped polygon | `[0, 90, 180, 270]` |
| 4 | Short diagonal noise edge | Filtered out, only orthogonal survive |
| 5 | Empty/degenerate polygon | Fallback to `FLOOR_PLAN_RULES.standardAngles` |
| 6 | Spanning walls contribute angles | H wall adds 0°/180° to set |
| 7 | Complements always present | Every angle has its +180° pair |

**E2E regression tests (11 new in `room-detection.verify.test.js`):**

Runs both OLD (hardcoded `FLOOR_PLAN_RULES.standardAngles`) and NEW (discovered angles) pipelines on the same 300dpi raw detection result. Asserts every output field is identical — proving the reorder is output-preserving for orthogonal buildings.

| # | Test | Assertion |
|---|------|-----------|
| 8 | Discovered angles match standard | `[0, 90, 180, 270]` |
| 9 | Polygon vertex count identical | old.length === new.length |
| 10 | Every polygon vertex identical | Per-vertex x,y exact match |
| 11 | **4-vertex rectangle (acceptance)** | length === 4 |
| 12 | Wall thickness edge count identical | old === new |
| 13 | Per-edge wall thicknesses identical | edgeIndex, thicknessPx, thicknessCm match |
| 14 | Median wall thickness identical | medianPx, medianCm match |
| 15 | Spanning walls identical (1 H, 0 V) | Deep equality + count assertions |
| 16 | Polygon ~10m × 8.5m | width ∈ [900, 1100], height ∈ [750, 950] |
| 17 | All wall thicknesses in [5, 50] cm | Per-edge bounds check |
| 18 | H spanning wall ~25cm | thicknessCm ∈ [15, 35] |

### Known limitation (NOT fixed here)

`rectifyPolygon` classifies edges as "H" (`std===0||std===180`) or "V" (else). For non-orthogonal angles (e.g., 45°), this gives wrong geometry. Step 4 puts the discovery infrastructure in place; fixing `rectifyPolygon` for arbitrary angles is separate work. For all current floor plans (axis-aligned), discovered angles are `[0, 90, 180, 270]` and classification works correctly.

---

## Step 5: Classify wall types from the envelope + auto-correct to defaults ✅

**Status:** Implemented — branch `wall-type-classification`

**Files:** `src/floor-plan-rules.js`, `src/room-detection-controller.js`, `src/state.js`, `src/floor-plan-rules.test.js`, `src/room-detection.verify.test.js`

**Concept:** Two parts that compose naturally:

1. **Data-driven clustering:** cluster the envelope's thickness measurements into distinct wall types. The number and values of types come from the image, not from assumptions.
2. **Auto-correction to defaults:** predefined wall type defaults (outer=30cm, structural=24cm, partition=11.5cm) and a default floor height (240cm). Measured thicknesses snap to the nearest default within a data-derived tolerance. Hardcoded for now; user-configurable later.

### Algorithm

**`classifyWallTypes(thicknesses, defaultTypes = DEFAULT_WALL_TYPES)`:**

1. Filter valid measurements: keep those in `[FLOOR_PLAN_RULES.wallThickness.minCm, maxCm]` = [5, 50]
2. Sort ascending
3. Compute gap threshold: `minInterTypeGap / 2` where `minInterTypeGap` is the smallest gap between any two adjacent predefined defaults. For defaults [11.5, 24, 30]: min gap = 6 (24→30), threshold = 3cm. Fallback: `FLOOR_PLAN_RULES.alignmentToleranceCm` (6cm) when no defaults.
4. Split at consecutive gaps > threshold → groups
5. Each group becomes a type with centroid = median of group
6. Snap each centroid to nearest predefined default via `snapToWallType`
7. Deduplicate (two clusters may snap to the same type)
8. Return array of `{ id, thicknessCm }` sorted ascending

**`snapToWallType(measuredCm, types = DEFAULT_WALL_TYPES)`:**

For each type (sorted by thickness), compute snap region bounded by midpoints to adjacent types. Edge types use `FLOOR_PLAN_RULES.wallThickness.minCm`/`maxCm` as outer bounds. Returns `{ snappedCm, typeId }`. When types is empty, returns `{ snappedCm: Math.round(measuredCm), typeId: null }`.

Snap boundaries for defaults [11.5, 24, 30]:

| Type | thicknessCm | Lower bound | Upper bound |
|------|-------------|-------------|-------------|
| partition | 11.5 | 5 (minCm) | 17.75 |
| structural | 24 | 17.75 | 27 |
| outer | 30 | 27 | 51 (maxCm+1) |

### Implementation details

**Constants in `floor-plan-rules.js`** (after `extractValidAngles`, before `rectifyPolygon`):

```js
export const DEFAULT_WALL_TYPES = [
  { id: "partition",  thicknessCm: 11.5 },
  { id: "structural", thicknessCm: 24 },
  { id: "outer",      thicknessCm: 30 },
];
export const DEFAULT_FLOOR_HEIGHT_CM = 240;
```

**`snapToWallType`** — pure function. Sorts types ascending, computes midpoint boundaries between adjacent types, uses `minCm`/`maxCm+1` for outer bounds. The `+1` on `maxCm` ensures the last type captures measurements exactly at `maxCm` (50cm).

**`classifyWallTypes`** — pure function. Gap threshold derived from the minimum distance between adjacent default types (data-driven, not hardcoded). Uses median (not mean) for cluster centroids — robust to outliers. Deduplicates after snapping (two close clusters may snap to the same default type).

**`detectAndStoreEnvelope` integration** — collects all thicknesses from envelope edges and spanning walls, calls `classifyWallTypes`, stores result in `envelope.wallTypes`. Also populates `floor.layout.wallDefaults` (if absent) with predefined defaults. The `if (!nextFloor.layout.wallDefaults)` guard prevents overwriting user-customized defaults on re-detection.

**`confirmDetection` integration** — replaces `wall.thicknessCm = Math.round(edgeMeas.thicknessCm)` with `snapToWallType(edgeMeas.thicknessCm, floor.layout?.wallDefaults?.types)`. Also applies `wallDefaults.heightCm` to all detection-created walls. When `wallDefaults` is absent, `snapToWallType` falls back to `DEFAULT_WALL_TYPES`, and heights stay at 200cm from `createDefaultWall`.

**State normalization** (`state.js`) — validates `wallDefaults` structure: deletes if `types` array is empty/missing, resets `heightCm` to `DEFAULT_WALL_HEIGHT_CM` (200) if invalid. No state version bump — `wallDefaults` is optional.

### Storage

```js
// Discovered from image (inside envelope)
floor.layout.envelope.wallTypes = [
  { id: "structural", thicknessCm: 24 },
  { id: "outer",      thicknessCm: 30 },
];

// Predefined defaults (at floor level, persists through re-detection)
floor.layout.wallDefaults = {
  types: [
    { id: "partition",  thicknessCm: 11.5 },
    { id: "structural", thicknessCm: 24 },
    { id: "outer",      thicknessCm: 30 },
  ],
  heightCm: 240,
};
```

`envelope.wallTypes` = what the image shows (data-driven, may have 1, 2, or 3 types).
`wallDefaults` = what the user expects (predefined, includes partition even if not detected).

**Lifecycle of `wallDefaults`:** Created during `detectAndStoreEnvelope` (if absent). NOT cleared when background changes (`delete floor.layout.envelope` doesn't touch `wallDefaults`). Eventually user-configurable.

### Runtime behavior changes

| Before | After |
|--------|-------|
| `wall.thicknessCm = Math.round(31.1)` → 31 | `snapToWallType(31.1)` → 30 (outer) |
| `wall.thicknessCm = Math.round(25.5)` → 26 | `snapToWallType(25.5)` → 24 (structural) |
| Wall heights = 200cm | Wall heights = 240cm (from `wallDefaults.heightCm`) |
| No wall types stored | `envelope.wallTypes` + `wallDefaults` stored |

### Consequences trace

**`DEFAULT_WALL_THICKNESS_CM` (12cm) and `DEFAULT_WALL_HEIGHT_CM` (200cm) — NOT changed.** Detection-created walls get snapped thickness from `wallDefaults.types` and height from `wallDefaults.heightCm`. Non-detection walls keep 12cm/200cm from `createDefaultWall`.

### Verified results (KG floor plan, 300dpi)

| Input | Clustering | Snap |
|-------|-----------|------|
| Envelope edges: [29.6, 29.6, 30.5, 30.5] | 1 cluster, centroid ≈ 30 | → outer (30) |
| Spanning wall: [25.8] | 1 cluster, centroid = 25.8 | → structural (24) |
| Combined | 2 types discovered | `[{structural, 24}, {outer, 30}]` |

### Tests

All 1187 tests pass (1167 existing + 20 new):

**Unit tests (17 new in `floor-plan-rules.test.js`):**

| # | Test | Assertion |
|---|------|-----------|
| 1 | `snapToWallType(31)` | `{ snappedCm: 30, typeId: "outer" }` |
| 2 | `snapToWallType(26)` — below midpoint 27 | `{ snappedCm: 24, typeId: "structural" }` |
| 3 | `snapToWallType(28)` — above midpoint 27 | `{ snappedCm: 30, typeId: "outer" }` |
| 4 | `snapToWallType(27)` — at midpoint (≥ boundary) | `{ snappedCm: 30, typeId: "outer" }` |
| 5 | `snapToWallType(12)` | `{ snappedCm: 11.5, typeId: "partition" }` |
| 6 | `snapToWallType(18)` — above midpoint 17.75 | `{ snappedCm: 24, typeId: "structural" }` |
| 7 | `snapToWallType(5)` — at minCm | `{ snappedCm: 11.5, typeId: "partition" }` |
| 8 | `snapToWallType(50)` — at maxCm | `{ snappedCm: 30, typeId: "outer" }` |
| 9 | Empty types → raw rounded | `{ snappedCm: 26, typeId: null }` for 25.7 |
| 10 | Custom types [8, 40] | midpoint 24: 20→8, 25→40 |
| 11 | `classifyWallTypes([25, 30, 30, 30])` — two clusters | `[structural(24), outer(30)]` |
| 12 | `classifyWallTypes([30, 30, 31])` — one cluster | `[outer(30)]` |
| 13 | `classifyWallTypes([12, 12, 25, 30, 30])` — three clusters | `[partition(11.5), structural(24), outer(30)]` |
| 14 | Out-of-bounds filtered `[3, 55, 30]` | `[outer(30)]` |
| 15 | Empty input | `[]` |
| 16 | `DEFAULT_WALL_TYPES` structure | 3 types, ascending, correct ids |
| 17 | `DEFAULT_FLOOR_HEIGHT_CM` | 240 |

**E2E tests (3 new in `room-detection.verify.test.js`):**

| # | Test | Assertion |
|---|------|-----------|
| 18 | `classifyWallTypes` on 300dpi envelope | Discovers 2 types: structural(24) + outer(30) |
| 19 | Envelope outer wall edges snap to outer | All 4 edges → `typeId: "outer"`, `snappedCm: 30` |
| 20 | Spanning wall snaps to structural | H wall → `typeId: "structural"`, `snappedCm: 24` |

---

## Step 6: Image preprocessing — remove annotation noise without breaking the envelope

**Concept:** Floor plan images contain visual elements that are not wall geometry: room labels, dimension text, door swing arcs (quarter circles), dashed lines, furniture symbols, hatch patterns. These must be filtered out before room detection, but the filtering must not corrupt the structural envelope.

**Key constraint: the envelope is the source of truth.** The envelope (Steps 2–3) is detected first, from the full unfiltered image. Filtering happens after, to clean up the image for room-level detection. The filter must never contradict what the envelope has established — it operates within the envelope's constraints, not against them.

**Why ordering matters:** Some wall segments are annotated in non-black colors (e.g., red marks indicating gaps to be filled). A naive color filter that strips red pixels would punch holes in continuous outer walls. But the envelope already knows that wall is continuous — so the filter must preserve envelope-established wall continuity.

**What to filter (conservative — only clearly non-wall elements):**
- **Unfilled colored shapes** (e.g., yellow markers with no fill): thin stroke outlines only, safe to remove — they contribute no wall pixels.
- **Thin strokes** below a minimum width threshold: dimension lines, dashed center lines, door arcs. Wall lines are thicker.
- **Text/labels:** small disconnected components (already handled by `filterSmallComponents`, but can be improved with color awareness).

**What NOT to filter:**
- Colored segments that are part of the wall structure (e.g., red gap markers on outer walls). The envelope says the wall is continuous → the filter preserves it.
- Gray fill (`#a0a0a0`) — this is wall material.
- Black lines — these are wall edges.

**Pipeline order:**
1. Load image at sufficient resolution (≥2x native for SVGs)
2. Detect envelope from full unfiltered image (Steps 2–5)
3. Preprocess image: remove annotation noise, producing a "walls-only" image
4. Room detection operates on the cleaned image, constrained by the envelope

**To be detailed:** Specific filter rules, threshold values, how to enforce envelope continuity during filtering, tests.

---

## Step 7: Room creation — match edges to envelope, no overlap, negative space fallback

### 7a: Match room edges to envelope segments

When a room polygon is detected, each of its edges is compared against the envelope's structural segments:

- **Match:** edge aligns with an envelope segment (within tolerance) → the edge belongs to that segment. Its position and thickness are inherited from the envelope, not measured per-room.
- **No match:** edge doesn't align with any envelope segment → it's a room-specific partition wall. Measure its thickness individually (using Step 1's center-to-center method). Assign it the closest wall type, or create a new type if it doesn't fit existing clusters.
- **Geometric detail:** short edge forming a notch or corner feature → not a wall.

### 7b: Create rooms using envelope constraints

Room creation uses the matched envelope data instead of independent per-room measurements:

- Matched edges get their wall position and thickness from the envelope — no per-room drift, no gaps between adjacent rooms.
- Two rooms sharing the same envelope segment automatically share that wall. No gap tolerance matching or merge step needed for these walls.
- Partition walls (unmatched edges) are created normally with their individually measured thickness.

### 7c: Hard constraint — rooms cannot overlap

Once a room is placed, its area is claimed. Any subsequent room detection must respect existing rooms — a new polygon cannot extend into territory already owned by another room. This is enforced during detection/creation, not after.

### 7d: Soft fallback — derive room from negative space

When pixel-based detection for a space returns results that violate envelope constraints (wrong angles, edges misaligned with the skeleton, implausible shape), instead of trusting the bad detection, fall back to computing the room as the negative space:

- Start from the envelope's interior boundary
- Subtract the spanning walls
- Subtract all already-placed rooms
- The remaining unclaimed area that contains the click point is the room

This is not a fixed rule — it's a confidence-based decision:
- **Detection consistent with envelope?** → trust the detection result
- **Detection violates envelope constraints?** → fall back to negative space derivation

This is especially valuable for irregular spaces like hallways (Flur), which are hard to detect via flood fill (surrounded by doorways, thin features, multiple adjacent rooms) but trivial to derive as "whatever is left."

**To be detailed:** Matching tolerance, overlap check implementation, confidence scoring criteria, negative space polygon computation, integration into `confirmDetection` flow, tests.

---

## Step 8: Doorway detection — pattern recognition on wall segments

**Concept:** Doorways are identified by specific visual patterns in the floor plan. Both the presence and absence of these patterns carry information: presence means "opening here," absence means "solid wall, no opening."

### Positive markers (any one = doorway):

1. **Double parallel dashed lines** — exactly two dashed lines, parallel to each other, spaced apart by the wall thickness. This is the definitive doorway marker. Important: it must be exactly two parallel dashed lines. A single dashed line or any other count is NOT a doorway (e.g., section cuts in TRH).
2. **Door swing arc** — quarter circle connecting a vertical line (door in closed position) to a point on the wall (door fully open).
3. **Gap in the wall** — the wall line stops and restarts, leaving an opening.

### Negative certainty:

If a wall segment has none of these three markers → it is a solid wall with no opening. This is confirmed information, not just absence of detection.

### Distinguishing doorways from internal wall elements:

A doorway is an opening **through** a wall that connects two distinct spaces on either side. A single wall element inside a room (like the partial wall near the staircase in TRH) is not a doorway — it doesn't separate two spaces and doesn't carry the double-dashed-line pattern.

Criteria for a real doorway:
- Located on a wall segment that separates two distinct spaces (two rooms, or a room and a hallway)
- Carries at least one of the three positive markers
- Double dashed lines are spaced by the wall thickness (matches the wall they belong to)

### Integration with envelope:

Doorway detection operates on the envelope's structural segments and room partition walls after rooms are placed. The envelope provides the wall positions and thicknesses; doorway detection identifies which segments of those walls have openings and where.

**To be detailed:** Pattern recognition algorithms (dashed line detection, arc detection, gap detection), how to distinguish single vs double dashed lines, integration with wall creation, tests.
