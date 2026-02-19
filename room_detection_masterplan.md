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

**`classifyWallPixel(r, g, b)`** — private helper. Three-way RGBA pixel classification:
- `'edge'`: gray < 80 AND neutral hue (r-g < 40, r-b < 40) — black/dark wall-edge lines
- `'fill'`: gray ∈ [80, 200) AND neutral; also dark pixels with red/pink tint
- `'background'`: gray ≥ 200; also mid-gray with red/pink tint
- Key insight: red markers (r-g=255) and pink markers (r-g≈88) have r-g ≥ 40 → excluded from edge classification

**`probeWallThickness(data, startX, startY, perpX, perpY, w, h, maxProbe)`** — private helper. Walks outward from a polygon edge point, classifying each pixel. Tracks the full contiguous wall band (edge + fill pixels), with a 2px background gap tolerance for anti-aliasing. If ≥2 distinct edge runs found within the band, returns center-to-center distance. Otherwise returns full band width.

**Critical fix during implementation:** The original plan's state machine (`seekInner → seekOuter`) required edge pixels first. Real floor plans (gray-fill walls) often start with fill pixels directly at the polygon boundary, not edge pixels. The probe was rewritten to track the entire wall band regardless of whether it starts with edge or fill.

**`detectWallThickness(imageData, polygonPixels, w, h, pixelsPerCm, maxProbe=200)`** — rewritten export:
- New signature: accepts `imageData` (RGBA) instead of binary `mask`, plus `pixelsPerCm` for px→cm conversion
- New return: `{ edges: [{edgeIndex, thicknessPx, thicknessCm}], medianPx, medianCm }` instead of single scalar
- Per-edge: 3 samples at 25%/50%/75% along each edge, median of samples
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

All 1113 tests pass (1110 original + 3 new):
- Rectangular room with edge+fill wall ring: median ∈ [6.5, 12], 4 edges
- Red pixels don't inflate measurement
- Per-edge measurements distinguishable (different wall thicknesses)
- `detectRoomAtPixel` returns `wallThicknesses` with edges/medianPx/medianCm
- Fewer than 3 vertices → empty result
- No wall pixels → empty result

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

1. Build wall mask (same pipeline as room detection: auto-detect gray range → `buildGrayWallMask` → `filterSmallComponents` → `morphologicalOpen`; fallback to `imageToBinaryMask` with threshold sweep)
2. `morphologicalClose` with radius `round(80 × ppc)` — seals gaps up to 160 cm, covering all standard doorways and double doors. Room detection uses [20, 40, 66] cm and picks the smallest that works (to preserve doors); envelope uses the largest because it must seal ALL openings.
3. `floodFillFromBorder(closedMask, w, h)` — BFS from all image border pixels through open (0) pixels → `exteriorMask`
4. Invert to building mask: `buildingMask[i] = (exteriorMask[i] === 0) ? 1 : 0`
5. `fillInteriorHoles(buildingMask)` — fill text/annotation gaps within the building
6. Sanity check: building must be 1–99% of image area (rejects all-white, all-black, and degenerate images)
7. `traceContour` → `douglasPeucker(epsilon)` → `snapPolygonEdges` → envelope polygon
8. `detectWallThickness(imageData, polygonPixels, w, h, ppc, { probeInward: true })` — probes inward (toward building center) because the envelope polygon traces the outer boundary

### Implementation details

**`floodFillFromBorder(mask, w, h)`** — new export in `room-detection.js`. BFS from all 4 image borders through open (mask=0) pixels. Returns `Uint8Array` exterior mask (1=reachable from border, 0=building/wall). Structurally similar to the BFS in `fillInteriorHoles` but semantically different: `fillInteriorHoles` identifies holes in a room fill, `floodFillFromBorder` identifies the exterior around a building.

**`detectEnvelope(imageData, options)`** — new export in `room-detection.js`. Pure orchestrator that calls the pipeline functions above. Returns `{ polygonPixels, wallThicknesses }` or `null`.

**`detectWallThickness` probe direction fix:** Added `probeInward` option (default `false`). When `true`, the perpendicular probe direction points toward the polygon centroid instead of away from it. Room polygons (inner boundary) probe outward into walls — correct. Envelope polygons (outer boundary) must probe inward to cross the wall body. Without this fix, the probe went into empty exterior space and measured only the thin edge line (~3 cm instead of ~30 cm). Backward-compatible: existing callers passing a bare `maxProbe` number still work via `typeof opts === "number"` guard.

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

## Step 3: Detect full-span structural walls inside the envelope

**Concept:** Beyond the outer boundary, floor plans contain continuous interior walls that run the full span of the building — from one outer wall to the opposite outer wall. These are structural dividing walls, not room partitions.

**Example (floorplan_KG.svg):** One horizontal 24 cm wall runs from the left outer wall to the right outer wall, separating Trockenraum/Keller (above) from Heizraum/Flur/Waschküche/TRH (below).

**Properties shared with outer walls:**
- Continuous — they span the full building width or height without interruption (except doorways)
- Consistent thickness along their length
- Constrain multiple rooms on both sides

**How the envelope expands:** The envelope is no longer just a closed outer polygon. It becomes the outer boundary + full-span dividing walls — a structural grid (connected line segments / simple graph) that forms the skeleton of the building. All rooms fit within cells of this grid.

**Storage:** `floor.layout.envelope` extends to include:
- Outer polygon vertices + thickness (from Step 2)
- Array of spanning walls, each with: start point, end point, thickness (cm), orientation (H/V)

**To be detailed:** Detection algorithm (how to identify full-span walls from the image), integration with room detection, tests.

---

## Step 4: Discover valid wall angles from the envelope

**Concept:** The envelope's structural segments define which wall angles exist on this floor. This is a discovered property, not a hardcoded assumption — different floor plans have different angle sets.

**Example (floorplan_KG.svg):** All envelope segments are at 0°/90°/180°/270° → the valid angle set for this floor is `[0, 90, 180, 270]`.

A different floor plan might have 45° walls, hexagonal rooms, or other non-orthogonal geometry. The angle set is whatever the envelope's actual segments show.

**How it's used:** When a room polygon is detected inside the envelope, `rectifyPolygon` snaps edges to valid angles. Currently it reads from a static config (`FLOOR_PLAN_RULES.standardAngles`). Instead, it should read the angle set discovered from the envelope.

This makes the envelope — not a hardcoded config — the source of truth for what angles are valid on this floor. A detected edge at 5.6° is snapped to 0° because the envelope says 0° is a valid angle, not because a static list says so.

**Storage:** `floor.layout.envelope.validAngles` — array of angles (degrees) derived from the envelope's structural segments.

**To be detailed:** How to extract angles from envelope segments, tolerance for angle clustering, integration with `rectifyPolygon`, tests.

---

## Step 5: Classify wall types from the envelope

Cluster the thickness measurements from all envelope segments (outer boundary edges + spanning walls) into distinct wall types. Different floor plans will produce different numbers of types — this must be data-driven, not hardcoded.

Example (floorplan_KG.svg): measurements cluster into ~30 cm (outer) and ~24 cm (inner) → 2 wall types.

A different floor plan might have 3 types (e.g., 36 cm load-bearing exterior, 24 cm interior structural, 12 cm partition) or just 1 (uniform thickness throughout). The classification derives from what the image shows, not from assumptions about how many types exist.

Short edges below a minimum length threshold (from `FLOOR_PLAN_RULES.minEdgeLengthCm`) are classified as geometric details, not wall types.

**Storage:** `floor.layout.envelope.wallTypes` — array of `{ thicknessCm, label }` derived from clustering.

**To be detailed:** Clustering algorithm, threshold for distinguishing types vs measurement noise, tests.

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
