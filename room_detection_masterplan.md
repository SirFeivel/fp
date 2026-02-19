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

## Step 2: Improve `detectWallThickness` — center-to-center, per-edge

**File:** `src/room-detection.js` — replace existing `detectWallThickness` (line 777)

**Problem:** Current method counts all consecutive wall pixels in the binary mask. This includes anti-aliasing fringes and non-wall colored elements (red outlines, insulation markers), inflating measurements. It also returns a single median value for the entire room — the envelope needs per-edge thickness to distinguish outer walls (30 cm) from inner walls (24 cm).

**New approach:** Measure from the center of the inner edge line to the center of the first outer edge line, using only black/dark pixels (ignoring red, pink, and other non-wall colors). Return per-edge data, not a single number.

Algorithm:
1. For each polygon edge, probe outward along the perpendicular from the edge midpoint (same as current).
2. At each probe pixel, read the **raw RGBA** values from the imageData (not the binary mask).
3. Classify pixels as **wall-edge** (dark/black only: gray < threshold AND not red/pink), **fill** (gray wall fill), or **background** (white/light).
   - Wall-edge: `gray < 80` and `r - g < 40` and `r - b < 40` (excludes red `#ff0000` and pink `#ffa8a8`)
   - Fill: `gray >= 80 && gray < 200` and not red/pink
   - Background: `gray >= 200`
4. Walking outward from the polygon edge, find:
   - **Inner edge line**: first contiguous run of wall-edge pixels. Record its center position.
   - Skip through any fill pixels.
   - **Outer edge line**: next contiguous run of wall-edge pixels. Record its center position.
5. Wall thickness = distance between inner edge center and outer edge center (in pixels, then ÷ ppc for cm).
6. Sample at 3 points per edge (25%, 50%, 75%), take median for that edge.

**Return shape change:** Instead of returning a single `wallThicknessPx` number, return an array of per-edge measurements: `[{ edgeIndex, thicknessCm, thicknessPx }]`. The overall median is still available for backward compatibility but per-edge data is the primary output.

**Reference data (floorplan_KG.svg, Trockenraum room):**

| Wall | SVG annotation | Expected result |
|------|---------------|-----------------|
| Top (outer wall, 30cm) | 30 cm | ~30 cm |
| Right (inner wall → Keller, 24cm) | 24 cm | ~24 cm |

**Test:** Run against floorplan_KG.svg at 4x resolution. Verify per-edge: outer wall ≤ 2 cm from 30 cm, inner wall ≤ 2 cm from 24 cm. Verify different edges return different values (not one median for all).

---

## Step 2: Detect floor envelope — outer boundary

**Concept:** Before any room is detected, analyze the background image once to find the building's outer boundary. This is a floor-level property (`floor.layout.envelope`), computed from the calibrated background, that constrains all subsequent room detections.

**What it captures:**
- The outermost closed rectangular boundary of the building (the building outline)
- The outer wall thickness, measured on the long straight edges of that boundary (most reliable measurement — long edges, no adjacent rooms, no doorways)

**Why it matters:**
- The outer walls are continuous — they run across multiple rooms (e.g., Trockenraum's top wall continues as Keller's top wall). This is a single wall, not two separate walls.
- Detecting each room independently loses this information. Each room gets its own polygon edge at a slightly different position, creating gaps instead of shared walls.
- With the envelope known upfront, any room edge that coincides with the envelope boundary is automatically identified as an outer wall with a known, consistent thickness.

**Storage:** `floor.layout.envelope` — sibling to `floor.layout.background`.

**To be detailed:** Detection algorithm, integration with room detection pipeline, tests.

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
