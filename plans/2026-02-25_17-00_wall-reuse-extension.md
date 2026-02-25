# Plan: Wall reuse/extension on room creation

## Context

When rooms are added inside an envelope, each room gets its own walls created from scratch (`ensureWallsForEdges`). The system tries to merge them afterward (`mergeCollinearWalls`), which fails in common cases — e.g., the left outer wall ends up as 2 segments because the gap at the spanning wall exceeds merge tolerance.

The root cause: `ensureWallsForEdges` looks up walls by exact `"roomId:edgeIndex"` key. A new room's edges never match existing keys → new walls always created. The fix: replace the simple key lookup with a proper decision tree that reuses/extends existing walls and inherits properties from the envelope.

## Decision tree

Given an envelope exists, for each proposed wall edge of a new room (after polygon constraint check):

```
(a) Does the proposed edge align with an already existing wall?
    YES → extend that wall (union of ranges), keep its properties
    NO  ↓
(b) Does the proposed edge align with an envelope boundary?
    YES → create new wall with envelope properties (thickness from envelope/spanning wall,
          snapped to wall type) and proposed dimensions (partial coverage is fine)
    NO  ↓
(c) Does the proposed wall violate any rules?
    YES → remove or adjust (geometric: too short, non-axis-aligned; conflict: overlaps/crosses
          existing wall, extends outside envelope, creates impossible geometry)
    NO  ↓
(d) Create a new wall with general defaults (default thickness, height, axis-alignment)
```

## How it works now

**`src/walls.js` → `ensureWallsForEdges()`** (line 95):

```
for each room edge:
  key = "roomId:edgeIndex"
  wall = wallByEdgeKey.get(key)    // exact match only
  if found → SET geometry to this edge
  else     → CREATE new wall with defaults
```

**`src/skeleton.js` → `computeStructuralBoundaries()`**: Already computes envelope inner-face positions and spanning wall face positions with thickness, type, and range. Currently only used by `constrainRoomToStructuralBoundaries` (pre-wall snap) and `enforceSkeletonWallProperties` (post-wall thickness patch).

**`src/skeleton.js` → `enforceSkeletonWallProperties()`**: Runs AFTER wall creation in `syncFloorWalls`, patches thickness from skeleton. With this plan, step (b) handles this at creation time; enforceSkeletonWallProperties becomes a safety net.

## Changes

### File: `src/walls.js`

#### 1. `indexWallsByEdge()` — also index by surfaces

Currently only indexes by `wall.roomEdge`. Also index by each surface's `{roomId, edgeIndex}` so that on subsequent syncs, shared walls are found for all rooms that share them.

#### 2. `findAlignedWall(walls, startPt, endPt, tolerance)` — new helper (step a)

Search existing walls for a geometric match:
- Same orientation (both H or both V)
- Same perpendicular coordinate within `FLOOR_PLAN_RULES.alignmentToleranceCm` (6cm)
  - V walls: same X ± tol
  - H walls: same Y ± tol
- Overlapping or adjacent along the axis (no gap limit — if on the same structural line, it's one wall)

Returns closest matching wall or null.

#### 3. `findAlignedBoundary(hTargets, vTargets, startPt, endPt, tolerance)` — new helper (step b)

Check if the proposed edge aligns with an envelope/spanning wall boundary from `computeStructuralBoundaries()`:
- Same orientation
- Perpendicular coordinate within tolerance (use `Math.max(baseTolerance, target.thickness)` — same logic as `constrainRoomToStructuralBoundaries`)
- Overlapping range

Returns the matching boundary target (with thickness, type) or null.

#### 4. `validateProposedWall(startPt, endPt, existingWalls, envelope)` — new helper (step c)

Rule checks for proposed walls that didn't match (a) or (b):
- **Geometric validity**: edge length < minimum (already 1cm), non-axis-aligned angle check
- **Conflict detection**: crosses or closely parallels an existing wall on a different line, extends outside envelope polygon
- Returns `{ valid: true }` or `{ valid: false, action: 'remove' | 'adjust', adjusted?: {start, end} }`

#### 5. `extendWallGeometry(wall, startPt, endPt)` — new helper

Extends wall start/end to cover a new edge (union, never shrinks):
- H walls: extend X range, keep Y
- V walls: extend Y range, keep X

#### 6. Modify `ensureWallsForEdges()` decision logic

```
for each room edge:
  key = "roomId:edgeIndex"
  wall = wallByEdgeKey.get(key)

  if wall found AND wall.roomEdge matches this room:
    → SET geometry (owner, existing behavior)
  else if wall found (via surface key):
    → EXTEND geometry (guest room, don't shrink)
  else:
    → (a) findAlignedWall(floor.walls, startPt, endPt, tolerance)
      → if found: EXTEND wall + add surface with correct offset
    → (b) findAlignedBoundary(hTargets, vTargets, startPt, endPt, tolerance)
      → if found: CREATE wall with boundary thickness (snapped via snapToWallType)
    → (c) validateProposedWall(startPt, endPt, floor.walls, envelope)
      → if invalid: skip or adjust
    → (d) CREATE wall with defaults
```

**Why SET for owner, EXTEND for guests:** The owner room is the source of truth for the wall's baseline geometry. Guest rooms only extend. If a guest room is deleted, the wall shrinks back to the owner's edge naturally.

**Surface offset for extended walls:** When adding a surface to an extended wall, compute `fromCm`/`toCm` by projecting the room edge onto the wall axis, so the surface covers the correct portion of the wall.

#### 7. Pass envelope to `ensureWallsForEdges`

Currently `ensureWallsForEdges(rooms, floor, wallByEdgeKey)`. Add envelope parameter (from `floor.layout?.envelope`) so steps (b) and (c) can access structural boundaries. Compute `hTargets`/`vTargets` once at the top via `computeStructuralBoundaries(envelope)`.

### Logging

Every decision branch logs its reasoning:
```
[walls] edge ${roomId}:e${i} → (a) extended wall ${id} (y=1124.3, range 1475→1880)
[walls] edge ${roomId}:e${i} → (b) new wall from envelope (thick=30cm, y=1124.3)
[walls] edge ${roomId}:e${i} → (c) removed: crosses existing wall ${id}
[walls] edge ${roomId}:e${i} → (d) new wall with defaults (thick=11.5cm)
```

## What this replaces

`mergeCollinearWalls` becomes largely unnecessary for walls on the same structural line. It can remain as a safety net but won't be needed for the common case of wall extension. `enforceSkeletonWallProperties` remains as a safety net for thickness — step (b) handles the primary assignment.

## Existing code reused

| Function | File | Used for |
|----------|------|----------|
| `computeStructuralBoundaries()` | `src/skeleton.js` | Step (b): get envelope/spanning wall targets with thickness |
| `snapToWallType()` | `src/floor-plan-rules.js` | Step (b): snap envelope thickness to nearest wall type |
| `FLOOR_PLAN_RULES.alignmentToleranceCm` | `src/floor-plan-rules.js` | Steps (a), (b): perpendicular tolerance |
| `createDefaultWall()` | `src/walls.js` | Steps (b), (d): wall creation with appropriate defaults |
| `createDefaultSurface()` | `src/walls.js` | All steps: surface creation for room edges |

## Files modified

| File | Change |
|------|--------|
| `src/walls.js` | `indexWallsByEdge`: +surface indexing. `ensureWallsForEdges`: +envelope param, decision tree (a→b→c→d). New helpers: `findAlignedWall`, `findAlignedBoundary`, `validateProposedWall`, `extendWallGeometry`. ~80 lines total. |

## Scorecard

| Dimension | Score | Justification |
|-----------|-------|---------------|
| **Hacky** | 8 | Fixes at the source (wall creation decision tree) not downstream (merge). Reuses existing `computeStructuralBoundaries` and `snapToWallType`. Step (c) validation is new but follows the pattern of existing rule enforcement. |
| **Compliance** | 8 | All changes in walls.js. Reuses skeleton.js API (no duplication). Logging for every branch. Follows existing import patterns (walls.js already imports from skeleton.js and floor-plan-rules.js). |
| **Complexity** | 7 | Four helpers + modified decision logic. Each helper is simple (~10-15 lines), but the interaction between steps (a)-(d) needs careful testing. Surface offset computation adds complexity. |
| **Problem Understanding** | 8 | Traced wall creation funnel to `ensureWallsForEdges`. Verified with real log data that walls are created too late for merge. Understood SET vs EXTEND for owner/guest. One uncertainty: step (c) rule set — starting with geometric + conflict checks, may need iteration. |
| **Confidence** | 7 | Steps (a), (b), (d) are straightforward. Step (c) is the least defined — starting with basic checks, will need real-data validation. Surface offset for extended walls needs careful testing. |

## Verification

1. `npm run test` — all existing tests pass
2. Load EG floor plan, detect 2 rooms (top-left + bottom-left):
   - Left outer wall = ONE wall from top to bottom (step a: extension)
   - Console shows `[walls] edge ... → (a) extended wall ...`
   - Wall thickness = 30cm (inherited from first wall, which got it from envelope)
3. Delete room 2 → left wall shrinks back to room 1's edge
4. Add a room with a novel interior wall (not on envelope) → step (d) creates default wall
5. Wall count is minimal (no duplicates on same structural line)

## E2E test scenarios

1. **Two rooms sharing outer wall**: Create envelope, add room 1 (top-left), add room 2 (bottom-left). Assert: shared left wall is ONE wall entity covering both rooms. Thickness = envelope thickness.
2. **Room on spanning wall**: Two rooms separated by a spanning wall. Assert: spanning wall face = ONE wall, not two overlapping walls.
3. **Interior partition**: Room with an edge not on any envelope boundary. Assert: wall created with defaults (step d).
4. **Room deletion**: After extending a wall for room 2, delete room 2. Assert: wall shrinks to room 1's edge only.

## Implementation

### What was done
All changes in `src/walls.js` (+ test updates in `src/walls.test.js`):

1. **`indexWallsByEdge()`**: Added surface-based indexing. Surfaces with unique `roomId:edgeIndex` keys are indexed if not already present.
2. **`findAlignedWall()`**: New helper (~25 lines). Geometric search with perpendicular coord tolerance AND range overlap/adjacency check (`gap <= tolerance`). Excludes walls owned by the same room (`excludeRoomId` param) to keep same-room collinear edges as separate walls.
3. **`findAlignedBoundary()`**: New helper (~30 lines). Checks against `computeStructuralBoundaries()` targets. Uses `Math.max(baseTolerance, target.thickness)` for tolerance.
4. **`validateProposedWall()`**: New helper (~40 lines). Detects too-short walls and parallel conflicts within tolerance.
5. **`extendWallGeometry()`**: New helper (~15 lines). Union extension preserving wall direction.
6. **`ensureWallsForEdges()`**: Decision tree (a→b→c→d) with logging. Owner SET / guest EXTEND distinction. Surface `fromCm`/`toCm` computed by projecting room edge onto wall axis.
7. **`mergeSharedEdgeWalls()`**: Added early continue when `matchWall.id === wall.id` — skip merge for walls already shared via wall reuse.
8. **`syncFloorWalls()`**: Passes `floor.layout?.envelope` to `ensureWallsForEdges`.

### Key findings
- **Range overlap is critical**: Without the gap check in `findAlignedWall`, rooms at the same Y level but different X positions would incorrectly merge their top/bottom walls. Gap must be ≤ tolerance.
- **Same-room exclusion needed**: `findAlignedWall` must skip walls owned by the current room, otherwise collinear edges within a single polygon (split vertex) get merged into one wall, breaking `computeFloorWallGeometry` extension calculations.
- **Surface projection matters**: When extending a wall, the guest room's surface `fromCm`/`toCm` must be computed by projecting the room edge start/end onto the wall direction vector, not assumed to be 0→edgeLen.
- **mergeSharedEdgeWalls interference**: Without the `matchWall.id === wall.id` guard, `mergeSharedEdgeWalls` would overwrite correctly-projected surface ranges with overlap-based ranges (e.g., 121cm instead of 300cm).

### Test results
- 1304 passed, 7 skipped (E2E skeleton test, previously skipped)
- 6 new E2E tests added for wall reuse/extension
- 5 existing tests updated to reflect new wall-count expectations (fewer walls = correct behavior)
