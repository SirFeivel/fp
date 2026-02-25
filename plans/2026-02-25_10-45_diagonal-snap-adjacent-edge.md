# Plan: Fix diagonal snapping in rectifyPolygon Step 5 — use adjacent edge positions instead of averaging

## Context

The OG floor plan envelope ends up with left wall at x≈540 instead of the correct outer face at x≈531.
The collinear cleanup fix (cross-product → H/V checks) and `enforcePolygonRules` fixpoint loop are
already in place. After iteration 1, `removeStackedWalls` produces this 5-vertex polygon:

```
0: (1525.4, 1197.8) → V len=852.4
1: (1525.4, 2050.2) → H len=994.2
2: (531.2, 2050.2)  → V len=503.6
3: (531.2, 1546.6)  → DIAGONAL (dx=26.6, dy=348.8)
4: (557.8, 1197.8)  → H len=967.6
```

Edge 3 is a diagonal because `removeStackedWalls` snapped vertex 3's x to 531.2 (outer face) but
vertex 4 retained its original x=557.8 (inner face). When `enforcePolygonRules` iteration 2 calls
`rectifyPolygon`, **Step 5** snaps this diagonal to vertical by averaging: `(531.2 + 557.8) / 2 ≈ 544.5`.
After collinear merge this becomes the left wall at x≈540.

**Root cause:** `rectifyPolygon` Step 5 (floor-plan-rules.js:423-470) blindly averages the two
endpoints of a diagonal edge. This is wrong when one endpoint is already established by an adjacent
axis-aligned edge — the average pulls the wall away from its correct position.

## Approach

### Step 1: Add `pickAdjacentAxisValue` helper in `rectifyPolygon` Step 5

**File:** `src/floor-plan-rules.js`, inside `rectifyPolygon`, just before Step 5 (before line 423)

```js
/**
 * For a diagonal edge at index i being snapped to axis `axis` ('x' or 'y'),
 * check if either adjacent edge is already axis-aligned on the same axis.
 * If so, return that edge's established coordinate. If both adjacent edges
 * qualify, return the one from the longer adjacent edge. If neither qualifies,
 * return null (caller falls back to averaging).
 */
function pickAdjacentAxisValue(pts, i, axis, tol) {
  const n = pts.length;
  const a = pts[i];
  const b = pts[(i + 1) % n];
  const cross = axis === 'x' ? 'y' : 'x';   // the other axis

  // Previous edge: pts[i-1] → pts[i]
  const prev = pts[(i - 1 + n) % n];
  const prevAligned = Math.abs(prev[axis] - a[axis]) < tol;  // same axis value
  const prevLen = prevAligned ? Math.abs(prev[cross] - a[cross]) : 0;

  // Next edge: pts[i+1] → pts[i+2]
  const next = pts[(i + 2) % n];
  const nextAligned = Math.abs(b[axis] - next[axis]) < tol;  // same axis value
  const nextLen = nextAligned ? Math.abs(b[cross] - next[cross]) : 0;

  if (prevAligned && nextAligned) return prevLen >= nextLen ? a[axis] : b[axis];
  if (prevAligned) return a[axis];
  if (nextAligned) return b[axis];
  return null;
}
```

### Step 2: Modify Step 5 snap logic to use the helper

**File:** `src/floor-plan-rules.js`, lines 437-446

Replace the averaging logic:

```js
// BEFORE (averages blindly):
if (dx >= dy) {
  const avgY = round1((a.y + b.y) / 2);
  rebuilt[i] = { x: a.x, y: avgY };
  rebuilt[(i + 1) % rebuilt.length] = { x: b.x, y: avgY };
} else {
  const avgX = round1((a.x + b.x) / 2);
  rebuilt[i] = { x: avgX, y: a.y };
  rebuilt[(i + 1) % rebuilt.length] = { x: avgX, y: b.y };
}

// AFTER (uses adjacent edge position when available):
if (dx >= dy) {
  const snapY = pickAdjacentAxisValue(rebuilt, i, 'y', SNAP_TOL)
                ?? round1((a.y + b.y) / 2);
  rebuilt[i] = { x: a.x, y: snapY };
  rebuilt[(i + 1) % rebuilt.length] = { x: b.x, y: snapY };
} else {
  const snapX = pickAdjacentAxisValue(rebuilt, i, 'x', SNAP_TOL)
                ?? round1((a.x + b.x) / 2);
  rebuilt[i] = { x: snapX, y: a.y };
  rebuilt[(i + 1) % rebuilt.length] = { x: snapX, y: b.y };
}
```

**Run `npm run test` after this step.**

### Step 3: Verify OG E2E test passes

The currently-failing assertion in `room-detection.verify.test.js:1507-1509` should now pass:
`minX` should be ≈531.2 (within 528-533 range) instead of ≈540.

**Run `npm run test` after this step (should already pass from Step 2).**

## Walkthrough: OG diagonal edge

Edge 3: `(531.2, 1546.6) → (557.8, 1197.8)` — dx=26.6, dy=348.8 → more vertical → snap to V (axis='x').

- **Previous edge** (2→3): `(531.2, 2050.2) → (531.2, 1546.6)` — vertical at x=531.2. `prev.x=531.2`, `a.x=531.2` → `|diff|<1` → prevAligned=true, prevLen=503.6
- **Next edge** (4→0): `(557.8, 1197.8) → (1525.4, 1197.8)` — horizontal. `b.x=557.8`, `next.x=1525.4` → `|diff|=967.6` → nextAligned=false
- Result: `pickAdjacentAxisValue` returns `a.x = 531.2`
- Snap: vertex 3 stays at x=531.2, vertex 4 moves to x=531.2

After collinear merge: vertices 2, 3, 4 form a single vertical edge at x=531.2. Left wall = 531.2.

## Walkthrough: existing `withDiag` test

```
0: (0, 0)    1: (1000, 0)    2: (1000, 850)
3: (530, 850) 4: (530, 300)  5: (557, 0)
```

Edge 5→0: `(557, 0) → (0, 0)` — horizontal, not a diagonal.
Edge 4→5: `(530, 300) → (557, 0)` — dx=27, dy=300 → more vertical → snap to V (axis='x').

- **Previous edge** (3→4): `(530, 850) → (530, 300)` — vertical at x=530. `prev.x=530`, `a.x=530` → `|diff|<1` → prevAligned=true, prevLen=550
- **Next edge** (5→0): `(557, 0) → (0, 0)` — horizontal. `b.x=557`, `next.x=0` → `|diff|=557` → nextAligned=false
- Result: returns `a.x = 530`
- Snap: both vertices snap to x=530 → `(530, 300)` and `(530, 0)`

After collinear merge: vertices 3, 4, new-5 become a single vertical edge at x=530. Correct.

## Walkthrough: pure diagonal with no adjacent context

If neither adjacent edge is axis-aligned on the target axis (e.g., a polygon where the diagonal is between two perpendicular edges), `pickAdjacentAxisValue` returns `null` and the fallback `round1((a + b) / 2)` kicks in — identical to current behavior.

## Files modified

| File | Change |
|------|--------|
| `src/floor-plan-rules.js` | Add `pickAdjacentAxisValue` helper, modify Step 5 snap logic |
| `src/room-detection.verify.test.js` | No change needed — existing assertion should now pass |

## Plan Scorecard

### Hacky (0 = duct tape, 10 = clean)

0→1: Fixes the root cause (blind averaging ignores context) not a symptom.
1→2: General mechanism — works for any diagonal where one endpoint is established by an adjacent edge.
2→3: Falls back to current averaging when no adjacent context exists — no regressions for other cases.
3→4: Helper function is pure, local, and stateless — no new state or globals.
4→5: Pattern matches how humans would reason: "this vertex is already at x=531 from its other edge, keep it."
5→6: No special-casing for OG or any specific polygon shape.
6→7: Single small helper + 4-line change at the call site.

**Score: 7**

### Compliance (0 = violates everything, 10 = textbook)

0→1: Fix is at the right layer — `rectifyPolygon` Step 5, inside `floor-plan-rules.js`.
1→2: No scope creep — only modifying the diagonal snap logic.
2→3: One change, then test.
3→4: Uses existing `round1` and `SNAP_TOL` — no new constants or imports.
4→5: Helper is defined inside `rectifyPolygon` (closure) — not polluting module scope.
5→6: Logging already exists at the snap site — no additional logging needed.
6→7: E2E test already exists and covers this exact scenario.

**Score: 7**

### Complexity (0 = extremely complex, 10 = minimal)

0→1: Helper is 12 lines of simple coordinate comparisons.
1→2: Call-site change is 4 lines (add `pickAdjacentAxisValue ??` before the average).
2→3: No new data structures, no new loops, no architectural changes.
3→4: `null`-coalescing fallback means zero risk to existing paths.
4→5: Total diff < 20 lines of actual logic.
5→6: No changes needed to any other function in the pipeline.
6→7: No changes to tests needed — existing failing test becomes passing.

**Score: 7**

### Problem Understanding (0 = guessing, 10 = fully mapped)

0→1: Traced the exact 5-vertex intermediate polygon via test instrumentation.
1→2: Identified the exact line (443-446) where averaging produces 544.5 → 540.
2→3: Walked through both endpoints: a.x=531.2 (from stacked-wall snap), b.x=557.8 (original inner face).
3→4: Verified the adjacent edge (2→3) is vertical at x=531.2 — established position.
4→5: Walked through the existing `withDiag` test — confirmed fix produces correct x=530.
5→6: Identified the fallback case (no adjacent context) — averaging is preserved.
6→7: Read all callers of `rectifyPolygon`: `enforcePolygonRules` (2 sites) and `confirmDetection` (1 site, via enforcePolygonRules). No direct callers outside enforcePolygonRules.

**Score: 7**

### Confidence (0 = hope, 10 = certain)

0→1: The averaging math is provably wrong: (531.2 + 557.8)/2 = 544.5 ≠ 531.2.
1→2: The adjacent edge check is provably correct: edge (2→3) at x=531.2 establishes the wall position.
2→3: The `withDiag` test walkthrough confirms correct behavior for the existing test case.
3→4: The fallback to averaging when no adjacent context exists means zero risk to other polygons.
4→5: 1289 existing tests will catch regressions.
5→6: The fix is entirely local to Step 5 — no cascading effects to other steps.
6→7: The OG E2E test (currently failing at x≈540) should pass at x≈531.2 after this fix.

**Score: 7**

## Verification

1. `npm run test` passes after Step 2 (1289+ tests)
2. OG E2E test: `minX` ≈ 531.2 (within 528-533), not ≈ 540
3. Existing `withDiag` test passes (snap to x=530, not x=543.5)
4. Existing EG envelope tests still pass (no regressions)
5. All axis-aligned edges asserted in both E2E tests

## Implementation

**Plan was partially wrong — the fix needed to be in Step 1c, not Step 5.**

### Discovery during implementation

The plan assumed diagonal edges would reach `rectifyPolygon` Step 5 with original endpoint
coordinates (531.0, 557.7). In reality, Step 1a's angle-based classification (maxAngleDeviationDeg=10°)
classified the edge as **V** (angle was 274.4° ≈ 4.4° off vertical) with `axisValue = (531+557.7)/2 = 544.4`.
Step 3's rebuild used this averaged axisValue for V→V and V→H vertex intersections.
Step 5 never saw a diagonal because the edge was already classified as V.

### Actual fix: Step 1c (new step after Step 1b)

Added a post-classification correction step: for any V/H-classified edge with large "spread"
(dx > 1cm for V, dy > 1cm for H), check if an adjacent same-type edge's axisValue matches
one of the endpoints. If so, inherit that axisValue instead of using the blind average.

For the OG case:
- Edge 3 (V, axisValue=544.4, spread=26.7): prev edge 2 is V at axisValue=531.0,
  and |531.0 - a.x(531)| < 1.0 → inherit 531.0.
- Step 3 rebuild then uses x=531.0 for both V→V and V→H vertices.
- Collinear merge removes intermediate vertices → rectangle at x=531.0.

The Step 5 `pickAdjacentAxisValue` helper was also added (as planned) for defense in depth,
but it doesn't trigger for the OG case because Step 1c already fixed the axisValue.

### Test results
1289 tests pass (60 files, 0 failures). No new tests added — the existing OG E2E test
assertion (`minX` between 528 and 533) now passes (was failing at 544.4 before the fix).
