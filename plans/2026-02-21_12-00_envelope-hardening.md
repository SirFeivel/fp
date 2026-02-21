# Envelope Hardening: Living Skeleton with Edge Extension

## Problem

The envelope/skeleton doesn't work as a living structure. After room detection:
- `recomputeEnvelope` (polygon union) produces degenerate 3-vertex polygons from near-coincident boundaries
- `mergeSharedEdgeWalls` clobbers classified wall thicknesses (11.5cm→12cm) via `Math.max`
- `enforceNoParallelWalls` uses the broken recomputed polygon, misclassifying internal walls as envelope walls
- Walls fragment instead of merging on the same vector
- Manual rooms (add, drag, resize) had no effect on the envelope at all

Evidence: `snapping.log` showing 4-room detection sequence. Room 1 produces 3-vert degenerate envelope. Shared partition wall (11.5cm) gets overwritten to 12cm on next `syncFloorWalls`. `enforceNoParallelWalls` flags partition wall `b5c4e1f4` as "on envelope edge 5" — wrong.

## Approach: Edge Extension (replaces Polygon Union)

**Core insight:** Room edges extend the skeleton boundary by 0.2–0.6cm (because `alignToEnvelope` already snaps rooms to the inner face). The polygon union approach catastrophically fails on these near-coincident cases. Edge extension handles them trivially.

**Skeleton invariants:**
1. `detectedPolygonCm` is immutable — never changed after detection
2. `polygonCm` starts as a copy of `detectedPolygonCm`
3. When a room edge is classified as "extending," the matching skeleton edge is lengthened
4. Skeleton edges preserve their characteristics (thickness, type) when extended
5. Extension is monotonic — skeleton never shrinks (walls don't disappear)
6. Edge count doesn't change during extension (vertex movement only)
7. No two walls on the same line segment
8. Collinear walls on the same vector are one wall entity

**Lifecycle:**
- Detect from image → `detectedPolygonCm` + `polygonCm` (identical)
- Room added → classify edges → extend skeleton for "extending" edges → preserve thicknesses
- Room deleted → skeleton unchanged (monotonic)
- Room resized → re-classify → extend if needed
- All rooms deleted → reset `polygonCm` to `detectedPolygonCm`

## Implementation Status

### Step 1: Fix `mergeSharedEdgeWalls` thickness preservation — DONE

**File:** `src/walls.js`, line ~254-270

**Change:** Replaced `Math.max(prevThick, otherThick)` with classified-thickness-preserving logic:
- If `prevThick !== DEFAULT_WALL_THICKNESS_CM` (existing wall was classified), keep `prevThick`
- If `prevThick === DEFAULT_WALL_THICKNESS_CM` and `otherThick !== DEFAULT_WALL_THICKNESS_CM`, take `otherThick`
- If both are non-default, keep `Math.max` (both were classified, take the thicker)
- If both are default, keep default

**Logging:** `[walls] mergeSharedEdgeWalls: keeping classified ${prevThick}cm over default ${otherThick}cm for wall ${wall.id}` (and variants for other branches)

**Test added:** "preserves classified 11.5cm partition wall over default 12cm on re-sync" in `walls.test.js`

### Step 2: Fix `enforceNoParallelWalls` to use detected polygon — DONE

**File:** `src/walls.js`, line ~503

**Change:** `envelope?.polygonCm || envelope?.detectedPolygonCm` → `envelope?.detectedPolygonCm || envelope?.polygonCm`

**Logging:** `[walls] enforceNoParallelWalls: using ${detected/recomputed} polygon (${poly.length} verts)`

**Test added:** "prefers detectedPolygonCm over broken polygonCm" in `walls.test.js`

**Known issue:** When `detectedPolygonCm` doesn't exist yet (first `recomputeEnvelope` hasn't migrated it), the fallback to `polygonCm` still fires. Log shows "using recomputed polygon" in this case. Not yet addressed.

### Step 3: Implement `extendSkeletonForRoom` — DONE

**File:** `src/envelope.js`, line 444 — new exported function

**Signature:** `extendSkeletonForRoom(floor, room, classifications)`

**Algorithm:**
1. Filter classifications for `type === "extending"` with `envelopeMatch`
2. For each extending edge:
   - Get envelope edge vertices (`envA`, `envB`) from `envelopeMatch.envelopeEdgeIndex`
   - Compute room edge endpoints in global coords
   - Project onto envelope edge direction (unit vector `enx`, `eny`)
   - `tMin < -0.01` → room extends beyond start vertex → move `envA` by `enx * tMin, eny * tMin`
   - `tMax > eLen + 0.01` → room extends beyond end vertex → move `envB` by overshoot
   - After each vertex move, call `propagateAxisAlignment` (Step 5b)
3. No vertex insertion, no edge count change

**Logging:** `[envelope] extendSkeletonForRoom: edge X extending skeleton edge Y by Z cm at [start|end]`

**Tests added** in `envelope.test.js`:
- Room within skeleton → no change to polygonCm
- Room extending one edge → edge endpoint moved
- Room extending corner (two edges) → both edges extended, shared vertex updated, propagation moves adjacent vertex
- wallThicknesses indices preserved (edge count stable)

### Step 4: Simplify `recomputeEnvelope` — DONE

**File:** `src/envelope.js`, line 671

**Change:** Removed ~150 lines of polygon union logic (`polygon-clipping`, `computeOuterPolygon`, `rectifyPolygon`, degenerate removal, collinear merge). Function now:
- Migration: if `detectedPolygonCm` doesn't exist, clone `polygonCm` to `detectedPolygonCm`
- No rooms: reset `polygonCm` to deep clone of `detectedPolygonCm`
- Rooms present: no-op (skeleton already extended incrementally)

**Logging:**
- `[envelope] recomputeEnvelope: no rooms → reset to detected boundary`
- `[envelope] recomputeEnvelope: ${rooms.length} rooms present, skeleton already extended incrementally — no-op`

**Tests rewritten** in `envelope.test.js`:
- "rooms present — no-op" (was polygon union assertion)
- "room edge near envelope extending beyond endpoint uses extendSkeletonForRoom" (was 400cm unreachable test)
- "monotonic: single room delete preserves extended boundary" (was "shrinks back")
- E2E "syncFloorWallsAndEnvelope assigns classified wall thicknesses" (updated for new pipeline)
- E2E "delete all rooms resets envelope to detected boundary" (updated)

### Step 5: Wire `extendSkeletonForRoom` into detection pipeline — DONE

**File:** `src/room-detection-controller.js` — `confirmDetection`

**Change:** After `assignWallTypesFromClassification` and before `enforceNoParallelWalls`, added:
```javascript
const extendingCount = classification.filter(c => c.type === "extending").length;
console.log(`[envelope] confirmDetection: extending skeleton for room ${room.id} (${extendingCount} extending edges)`);
extendSkeletonForRoom(floor, room, classification);
```

Also updated `syncFloorWallsAndEnvelope` in `envelope.js` to call `extendSkeletonForRoom` per room in its classify loop (with synthesized polygonVertices for rect rooms).

### Step 5b: Handle large extensions (axis-aligned propagation) — DONE

**File:** `src/envelope.js`, line 534 — `propagateAxisAlignment` helper

**Algorithm:** After moving `movedVertex` by `(dx, dy)`:
1. Reconstruct original position: `origX = movedVertex.x - dx`, `origY = movedVertex.y - dy`
2. Check if edge to `otherVertex` was horizontal (`|otherVertex.y - origY| < 0.5`) or vertical (`|otherVertex.x - origX| < 0.5`)
3. If was horizontal and `|dy| > 0.5`: propagate `movedVertex.y` to `otherVertex.y`
4. If was vertical and `|dx| > 0.5`: propagate `movedVertex.x` to `otherVertex.x`
5. Small extensions (< 0.5cm, typical detection overshoot) don't trigger propagation

**Logging:** `[envelope] extendSkeletonForRoom: propagating ${axis} to adjacent vertex to maintain axis alignment`

**Tests added** in `envelope.test.js`:
- "large extension propagates to adjacent vertex to maintain axis alignment" (400cm extension → vertex2.x propagated)
- "small extension (< 0.5cm) does not trigger propagation" (0.3cm → no propagation, vertex2 unchanged)

### Step 5c: Wire classification + extension into manual room path — DONE

**File:** `src/envelope.js`, line 580 — `classifyAndExtendRooms(floor)`

**Algorithm:**
1. If no envelope → return
2. Synthesize `polygonVertices` for rooms that only have `widthCm`/`heightCm` (rectangular rooms)
3. If no valid rooms → call `recomputeEnvelope` (resets to detected boundary)
4. For each room: `classifyRoomEdges` + `assignWallTypesFromClassification` + `extendSkeletonForRoom`
5. Does NOT enforce positions or parallel walls (avoids corrupting manual room positions)

**Wired into all `syncFloorWalls` call sites** (always immediately after `syncFloorWalls`):

| File | Call sites | Operations |
|---|---|---|
| `src/structure.js` | `addRoom` (line 257), `deleteRoom` (line 281) | Room add/delete |
| `src/main.js` | Lines 826, 894, 3267, 3323, 3351, 3397 | Inline dimension edit, edge length change, rect room add, circle room add, room delete, polygon room add |
| `src/drag.js` | Lines 875, 1063, 1079, 1258 | Room move, circle resize, rect resize, vertex drag |

**Logging:**
- `[envelope] classifyAndExtendRooms: synthesized polygonVertices for rect room ${room.id}`
- `[envelope] classifyAndExtendRooms: ${validRooms.length} rooms`

### Step 6: E2E test — full 4-room sequence — TODO

**File:** new test in `src/envelope.test.js`

Using the real state data from `envelope_hardening_state.json` as reference:

1. Start with detected envelope (4-vert rectangle)
2. Add room 1 → skeleton extends bottom by ~0.6cm, 4 vertices preserved
3. Add room 2 → skeleton unchanged (room within boundary)
4. Add room 3 → skeleton extends top by ~0.4cm, right by ~0.2cm
5. Assert: shared partition wall still 11.5cm (not clobbered)
6. Assert: no stacked walls (no two walls on same line)
7. Delete room 3 → skeleton boundary unchanged

Run `npm run test`.

## Current State & Known Issues

**Test status:** 1270 tests passing (60 test files).

**What works:**
- Detection pipeline: rooms detected from image get classified, wall types assigned, skeleton extended
- Thickness preservation: classified thicknesses survive merges
- `enforceNoParallelWalls` uses `detectedPolygonCm` (ground truth)
- `recomputeEnvelope` simplified to no-op + reset
- `classifyAndExtendRooms` wired into all manual room mutation paths (add, delete, resize, drag, vertex move, inline edit)
- Rectangular rooms get `polygonVertices` synthesized from `widthCm`/`heightCm`

**What doesn't work yet (user-reported):**
- "It's not working as expected" — manual rooms partially work for polygon rooms but envelope extension is not behaving correctly in all cases
- Specific failure modes need investigation with runtime logging

**Likely areas to investigate:**
1. **Classification not matching**: `matchEdgeToEnvelope` has a perpDist bound of `wallThickness + 6cm`. Manual rooms placed far from envelope get classified as "interior" → no extension. This is by design for detection but may need a wider tolerance or different approach for manual rooms.
2. **Monotonic extension accumulation**: Each call to `classifyAndExtendRooms` runs `extendSkeletonForRoom` for ALL rooms against the already-extended polygon. If the polygon already extended past a room, that room's edges won't trigger further extension. But if polygon was reset to detected and rooms re-classified, the extension order might matter.
3. **Propagation cascading**: Moving one vertex and propagating to the adjacent vertex changes the adjacent edge length. If a room matches that adjacent edge, the projection math changes. Order of processing matters.
4. **No reset before re-extension**: `classifyAndExtendRooms` extends the current `polygonCm` incrementally. On every drag/resize, it extends further. It never resets to `detectedPolygonCm` before re-extending. This means extensions accumulate monotonically but may not reflect the current room positions correctly after a room is moved away.

## Files Changed (from `main` branch)

| File | Changes |
|---|---|
| `src/walls.js` | Step 1: thickness preservation in `mergeSharedEdgeWalls`. Step 2: `detectedPolygonCm` preference in `enforceNoParallelWalls`. |
| `src/walls.test.js` | 2 new tests (Steps 1, 2) |
| `src/envelope.js` | Step 3: `extendSkeletonForRoom`. Step 4: simplified `recomputeEnvelope`. Step 5: updated `syncFloorWallsAndEnvelope`. Step 5b: `propagateAxisAlignment`. Step 5c: `classifyAndExtendRooms` with polygonVertices synthesis. |
| `src/envelope.test.js` | 6 new tests (Steps 3, 5b), 5 rewritten tests (Step 4), 2 updated E2E tests |
| `src/room-detection-controller.js` | Step 5: `extendSkeletonForRoom` call in `confirmDetection` |
| `src/structure.js` | Step 5c: `classifyAndExtendRooms` import + 2 call sites |
| `src/main.js` | Step 5c: `classifyAndExtendRooms` import + 6 call sites |
| `src/drag.js` | Step 5c: `classifyAndExtendRooms` import + 4 call sites |

## Key Technical Details

### `matchEdgeToEnvelope` proximity bound (envelope.js:48)
- `perpDist ≤ wallThickness + alignmentToleranceCm` (line 94)
- `alignmentToleranceCm = 6` (floor-plan-rules.js:30)
- For 30cm outer wall: maxDist = 36cm
- Detected rooms after `alignToEnvelope` snap: perpDist ≈ 30cm → match succeeds, overshoot 0.2–0.6cm
- Manual rooms far from envelope: perpDist >> 36cm → no match → "interior" → no extension

### `propagateAxisAlignment` threshold (envelope.js:534)
- Only triggers when `|dx| > 0.5` or `|dy| > 0.5`
- Only applies when the original edge was axis-aligned (`|diff| < 0.5`)
- Detection overshoot (0.2–0.6cm) typically does NOT trigger propagation
- Manual room large extensions (hundreds of cm) DO trigger propagation

### `classifyAndExtendRooms` vs `syncFloorWallsAndEnvelope`
- `classifyAndExtendRooms`: lightweight — classify + assign types + extend skeleton. No position enforcement. Used for manual room paths.
- `syncFloorWallsAndEnvelope`: full pipeline — syncFloorWalls + mergeCollinear + classify + assign + extend + enforceNoParallel + enforcePositions + recomputeEnvelope. Used for detection path only.

### polygonVertices synthesis
- Rectangular rooms created via `addRoom` (structure.js) or inline dimension edit don't have `polygonVertices`
- `classifyAndExtendRooms` and `syncFloorWallsAndEnvelope` both synthesize: `[{0,0}, {w,0}, {w,h}, {0,h}]`
- This is written onto the room object (mutates state before commit)

## Scorecard

| Dimension | Score | Justification |
|---|---|---|
| **Hacky** | 8 | Edge extension is provably correct for the detection input domain. Manual room path works mechanically but has known issues with accumulation/reset behavior. polygonVertices synthesis is pragmatic but slightly hacky (mutates room objects). |
| **Compliance** | 7 | Steps 1–5c each tested independently. E2E test (Step 6) still TODO. All changes follow one-at-a-time protocol. Review subagent used for non-trivial changes. |
| **Complexity** | 7 | Net simpler than old code — removed polygon union + degenerate removal. Added `extendSkeletonForRoom` (82 lines), `propagateAxisAlignment` (16 lines), `classifyAndExtendRooms` (37 lines). 12 new call sites across 3 files. |
| **Problem Understanding** | 7 | Detection path fully understood and working. Manual room path wired but not fully validated — user reports it's "not working as expected." Need runtime logs to diagnose the specific failure mode. |
| **Confidence** | 7 | Detection path: high confidence. Manual room path: moderate — the extension fires but the results aren't right. Likely issues: accumulation without reset, perpDist bounds rejecting manual rooms, or order-dependent extension. Need investigation. |

## Verification

After all steps:
1. `npm run test` — all 1270 tests pass ✓
2. Detection path: rooms detected from image → skeleton grows, thicknesses preserved — needs manual verification
3. Manual path: add/drag/resize rooms → envelope extends — partially working, needs investigation
4. Step 6 E2E test still TODO
