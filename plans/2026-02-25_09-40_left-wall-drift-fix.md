# Plan: Fix envelope left-wall drift and add spanning wall rejection logging

## Context

After the `enforcePolygonRules` fix, the OG floor plan envelope collapsed to a 4-vertex
rectangle with the left wall at x=540 instead of x≈530.8 (the actual outer wall face).
Additionally, no spanning walls are detected despite visible interior structural walls.

**Issue 5 (left wall drift):** `removeStackedWalls` correctly removes stacked pairs and snaps
neighbors to the kept (outer) edge at x≈531. But its **collinear cleanup** (cross-product based)
then removes intermediate vertices, merging vertices at x≈531 and x≈557 into a single diagonal
edge. When `enforcePolygonRules` iteration 2 runs `rectifyPolygon`, Step 1b length-weighted-averages
consecutive V edges at different x values, producing x≈540.

**Root cause:** The collinear cleanup in `removeStackedWalls` uses a cross-product tolerance that
treats vertices at different x coordinates (531 vs 557) as "nearly collinear" because the edges
are long relative to the perpendicular offset. This is fundamentally wrong for axis-aligned
polygons — two vertical edges at x=531 and x=557 are NOT collinear.

**Issue 4 (no spanning walls):** `detectSpanningWalls` has 6 strict criteria but the controller
doesn't log rejection reasons. Need logging first to identify which criterion blocks the OG walls.

## Approach

### Step 1: Fix `removeStackedWalls` collinear cleanup

**File:** `src/floor-plan-rules.js`, lines 711-728

Replace the cross-product collinear cleanup with strict axis-aligned checks (matching
`rectifyPolygon` Step 4 and `removePolygonMicroBumps` cleanup):

```js
// Current (broken): cross-product tolerance
const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
if (Math.abs(cross) < COLLINEAR_TOL * Math.max(...))

// Fix: strict axis-aligned collinear check
if (Math.abs(a.y - b.y) < COLLINEAR_TOL && Math.abs(b.y - c.y) < COLLINEAR_TOL)  // H collinear
if (Math.abs(a.x - b.x) < COLLINEAR_TOL && Math.abs(b.x - c.x) < COLLINEAR_TOL)  // V collinear
```

This prevents vertices at x=531 from being merged with vertices at x=557.

**Run `npm run test` after this step.**

### Step 2: Add spanning wall rejection logging

**File:** `src/room-detection-controller.js`

Pass a `rejections` array to `detectSpanningWalls` calls and log the results:
```js
const rejections = [];
const walls = detectSpanningWalls(imageData, mask, bldgMask, w, h, { ...opts, rejections });
if (rejections.length) {
  console.log(`[envelope] Spanning wall rejections: ${rejections.length}`);
  for (const r of rejections) console.log(`  [spanning] rejected: ${r.reason} ...`);
}
```

**File:** `src/room-detection.js` — verify the `rejections` parameter is already accepted
and populated (the explore agent confirmed it exists but the controller doesn't pass it).

**Run `npm run test` after this step.**

### Step 3: Verify with OG polygon data

Add/update E2E test using the OG 36-edge polygon to verify the left wall ends up at x≈531
(within 2cm of actual outer face) instead of x≈540.

**Run `npm run test` after this step.**

## Files modified

| File | Change |
|------|--------|
| `src/floor-plan-rules.js` | Fix collinear cleanup in `removeStackedWalls` |
| `src/room-detection-controller.js` | Add spanning wall rejection logging |
| `src/room-detection.verify.test.js` | Update E2E test for left wall position |

## Plan Scorecard

### Hacky (0 = duct tape, 10 = clean)

0→1: Fixes root cause (wrong collinear check) not symptom.
1→2: Uses same H/V collinear pattern already used in `removePolygonMicroBumps` and `rectifyPolygon` Step 4.
2→3: No new data structures or concepts.
3→4: Spanning wall logging uses existing `rejections` parameter already in the API.
4→5: Consistent with codebase patterns (all other collinear cleanups use H/V checks).
5→6: Cross-product check was the odd one out — this makes the code more uniform.
6→7: Small, targeted change — 6 lines replaced in the collinear cleanup.

**Score: 7**

### Compliance (0 = violates everything, 10 = textbook)

0→1: Existing API (`rejections` param) already exists — just needs to be passed through.
1→2: Fix is at the right layer (floor-plan-rules.js, polygon-level).
2→3: No scope creep — collinear fix only, spanning wall logging only.
3→4: One change at a time, test after each.
4→5: Logging with `[spanning]` tag per convention.
5→6: E2E test with real data.
6→7: Plan stored as new file.

**Score: 7**

### Complexity (0 = extremely complex, 10 = minimal)

0→1: 6-line replacement (cross-product → H/V checks).
1→2: Logging addition is 5 lines.
2→3: No new functions or abstractions.
3→4: E2E test update is small (add one assertion for x value).
4→5: No architectural changes.
5→6: Total diff < 30 lines.
6→7: Same pattern used in 2 other places in the codebase.

**Score: 7 (would be higher but the spanning wall logging is a diagnostic step, not a complete fix)**

### Problem Understanding (0 = guessing, 10 = fully mapped)

0→1: Read full `removeStackedWalls` (floor-plan-rules.js:614-731).
1→2: Identified the cross-product collinear cleanup as the root cause of vertex merging.
2→3: Traced the OG polygon's left wall: 7 V edges at x≈530.8-531.2 (outer) and x≈556.8-557.8 (inner).
3→4: Confirmed `rectifyPolygon` Step 1b length-weighted-averages mixed populations.
4→5: Read `detectSpanningWalls` full implementation (via explore agent): 6 criteria identified.
5→6: Identified `MIN_SPAN_LENGTH_CM=200cm` and edge-touch as likely blockers.
6→7: Confirmed `rejections` parameter exists in API but controller doesn't pass it.

**Score: 7**

### Confidence (0 = hope, 10 = certain)

0→1: The cross-product check is provably wrong for axis-aligned polygons — two V edges at x=531 and x=557 have a small cross-product relative to edge length, but are 26cm apart.
1→2: The H/V collinear check is proven correct by its use in `removePolygonMicroBumps` and `rectifyPolygon`.
2→3: 1289 existing tests will catch regressions.
3→4: E2E test with OG data directly verifies the fix.
4→5: Spanning wall logging is read-only (no behavior change) — low risk.
5→6: The spanning wall investigation will tell us exactly which criterion blocks OG walls.
6→7: The fix targets a clearly identified 6-line section.

**Score: 7**

## Verification

1. `npm run test` passes after each step
2. OG E2E test: left wall x ≈ 531 (within 2cm of outer face), not x ≈ 540
3. Existing EG tests still pass
4. Spanning wall rejection log output reviewed manually on OG floor plan

## Implementation

**All 3 steps executed successfully.**

### What was done:

1. **Step 1 (collinear fix):** Replaced cross-product tolerance collinear cleanup in `removeStackedWalls` with strict H/V axis-aligned checks. This alone was necessary but not sufficient.

2. **Step 1b (additional fix — keep outermost):** The collinear fix prevented wrong vertex merging, but the left wall still drifted to x≈540 because `removeStackedWalls` used "keep longer edge" to decide which stacked wall to keep. During the cascade of pair removals, neighbor snapping shortened outer edges, causing inner-face coordinates (x≈557.8) to survive as the polygon reduced. Changed the keep/remove decision to "keep the edge furthest from polygon centroid" (= outermost wall face). Centroid is recomputed at each iteration of the while loop for robustness.

3. **Step 2 (spanning wall logging):** Added `rejections` array to both `detectSpanningWalls` call sites in `room-detection-controller.js`. Logs rejection reasons per spanning wall candidate with `[spanning]` tag.

4. **Step 3 (E2E test):** Added left wall position assertion to the existing OG polygon E2E test: `minX` must be between 528 and 533 (actual: 531.2).

### Core findings:
- The collinear fix alone was insufficient. The "keep longer" heuristic in `removeStackedWalls` is fundamentally order-dependent — neighbor snapping during the cascade can shorten outer edges, causing the keep/remove decision to flip for later pairs. Using "keep outermost" (centroid-based) is correct regardless of processing order.
- After both fixes, the OG polygon reduces to a 6-vertex L-shape with left wall at x=531.2 (within 0.4cm of the actual outer face at x=530.8). Previously it was a 4-vertex rectangle with left wall at x=540 (9.2cm drift).
- The polygon converges in iteration 2 of `enforcePolygonRules` (same as before).

### Test results:
1289 tests pass (60 files, 0 failures). No new tests added; existing E2E test updated with assertion.
