# Phase 2: Fix Envelope Detection Quality

## Implementation

**What was done (execution order: 3 → 4 → 5 → 1 → 2 → E2E tests):**

### Step 3: Enforce axis-aligned edges in rectifyPolygon
**File:** `src/floor-plan-rules.js`, `rectifyPolygon` function

Added Step 5 (final enforcement pass) after the existing collinear merge. For each edge in the rebuilt polygon, checks if it's axis-aligned (dx < 1cm or dy < 1cm). Diagonal edges are snapped to the nearest axis (H if |dx| >= |dy|, V otherwise) by averaging the coordinate on the perpendicular axis. After each snap, collinear vertices are re-merged to clean up.

### Step 4: Fix bump removal threshold
**File:** `src/room-detection-controller.js`, `detectAndStoreEnvelope`

Changed `bumpThreshold` from `medianCm || 30` to `(medianCm ?? 25) * 0.8`. Bumps (stairs, retaining walls) are thinner than actual walls, so threshold should be below wall thickness to preserve legitimate building geometry.

### Step 5: Fix stacked wall detection threshold
**File:** `src/room-detection-controller.js`, `detectAndStoreEnvelope`

Changed `removeStackedWalls(reRectified)` (default maxGap=50cm) to `removeStackedWalls(reRectified, medianCm * 1.5)`. Uses measured wall thickness instead of theoretical maximum, giving a tighter threshold (~44cm vs 50cm) that better distinguishes stacked walls from legitimate parallel geometry.

### Step 1: Adaptive close radius in detectEnvelope
**File:** `src/room-detection.js`, `detectEnvelope`

Replaced single `closeRadius = 80*ppc` with adaptive approach:
- Tries radii [80, 120, 160, 200] cm sequentially
- Picks the smallest radius where building area is valid (1-99%)
- Stops escalating when area stabilizes (<10% increase from previous radius) or over-expands (>30% jump, indicating close is leaking into exterior)
- Fallback: uses smallest radius result if all fail

The adaptive approach correctly handles:
- Standard buildings: picks r=80cm (first valid radius)
- Small synthetic images: stops at r=80cm when r=120cm over-expands (>30% jump)
- Multi-section buildings: tries larger radii to bridge gaps

### Step 2: Multi-component merge for building mask
**File:** `src/room-detection.js`, `detectEnvelope`

Added between building mask generation and contour tracing:
1. Labels connected components in building mask via flood fill
2. Filters out tiny components (<1% of image)
3. For significant components, checks if bounding boxes overlap or are within 2× max close radius
4. Merges nearby components by filling rectangular bridges (vertical if X overlaps, horizontal if Y overlaps)
5. Re-fills interior holes after merge

### Step 6: E2E test scenarios
**File:** `src/room-detection.verify.test.js`

Added "Phase 2: Envelope detection quality" test suite with 5 tests:
1. Pass 2 is selected (not fallback to pass 1)
2. Final polygon has >= 4 vertices (valid polygon after post-processing)
3. All edges are axis-aligned (H or V within 1cm tolerance)
4. No stacked walls (no parallel edges overlapping within medianCm * 1.5)
5. Wall thickness edges in valid range [5, 50] cm

## Core findings

1. **The EG outer envelope IS approximately rectangular.** Pass-2 raw polygon has 20 vertices with L-shape notches, but all notches are within one wall thickness (26.3cm) of the main walls. `removeStackedWalls` correctly collapses these to a clean rectangle. The "L-shape" from the plan refers to building sections separated by large gaps, not the outer envelope of a single section.

2. **Adaptive close over-expansion is a real risk on small images.** The L-shape unit test (500×500 px, ppc=0.5) showed r=60px(120cm) jumping building area from 48% to 75%. The >30% jump detection catches this correctly.

3. **The rectifyPolygon enforcement pass works silently on the EG floor plan** — no diagonal edges survive to the output. This is because the existing logic (axis-value merging + rebuild at intersections) already handles most cases. The enforcement is a safety net.

4. **Bump threshold 0.8× median vs 1.0× median makes no difference for the EG floor plan.** The smallest notch (26.3cm) is still above both thresholds (23.7cm vs 29.6cm). The change is conservative and forward-looking for floor plans with thinner features.

## Test results

1282 tests pass (60 files, 0 failures). 5 new E2E tests added.
