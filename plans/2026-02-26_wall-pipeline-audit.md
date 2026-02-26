# Wall Pipeline Deep Audit — 2026-02-26

Comprehensive read-only audit of the entire 2D→3D wall pipeline. No code changes.

---

## CRITICAL Issues (must fix before anything else)

### C1. ~~startCornerFill never passed to 3D~~ ✅ FIXED (2026-02-26)
**Where**: `main.js:prepareFloorWallData` (line ~554)
**Problem**: `prepareFloorWallData` builds `endCornerFill: wallDesc.endCornerFill ?? null` but completely omits `startCornerFill`. The 3D renderer (`addWallToScene` lines 799-802) explicitly checks `wallDesc.startCornerFill` and renders it — but it's always undefined.
**Impact**: Cross-room corner gaps at wall **start** points are never filled in 3D. End fills work.
**Fix**: Added `startCornerFill: wallDesc.startCornerFill ?? null`. See `plans/2026-02-26_13-15_wall-fixes-c1-c3-c5.md`.

### C2. Edge index instability after polygon modification
**Where**: Entire pipeline (walls reference `roomEdge.edgeIndex` and `surface.edgeIndex`)
**Problem**: When a room polygon is edited (vertex added/removed/reordered), edge indices shift, but all wall references hold stale indices. `pruneOrphanSurfaces` catches out-of-bounds indices, but does NOT detect wrong-but-in-bounds indices (pointing to a different edge than intended).
**Impact**: After polygon editing, surface tiling coordinates become wrong, `enforceAdjacentPositions` shifts wrong rooms, doorway positions become nonsensical.
**Root cause**: Edge index is used as a stable identifier but is actually positional.

### C3. ~~wallByEdgeKey stale references after wall deletion in merge~~ ✅ FIXED (2026-02-26)
**Where**: `mergeSharedEdgeWalls` (line ~621-623)
**Problem**: When `otherWall` is absorbed and spliced out of `floor.walls`, only ONE key is deleted from `wallByEdgeKey` (`otherKey` = the matching room:edge). But `otherWall` may be indexed under multiple keys (its owner roomEdge AND all its guest surfaces). Those stale entries point to a wall that no longer exists in `floor.walls`.
**Impact**: Later `ensureWallsForEdges` lookups find the dangling wall, mutate it (adding surfaces, extending geometry), but the mutations go nowhere since the wall isn't in `floor.walls`.
**Fix**: Replaced `wallByEdgeKey.delete(otherKey)` with loop that repoints all entries referencing absorbed wall to surviving wall. See `plans/2026-02-26_13-15_wall-fixes-c1-c3-c5.md`.

### C4. Surface coordinate overwrite bug during merge + shift
**Where**: `mergeSharedEdgeWalls` (lines ~560-580)
**Problem**: When a wall is shifted/extended during merge, ALL existing surface `fromCm/toCm` values are shifted (line ~562-564). Then the just-added shared surface's `fromCm/toCm` is **unconditionally overwritten** (line ~577-578) with values computed from projection. These two operations can conflict — the shift applies correctly to old surfaces, but the overwrite ignores the shift that was already applied to the shared surface if it was added before the shift.
**Impact**: Surfaces can end up with incorrect coordinate ranges after merge.

### C5. ~~Quad corner fill parallelogram assumption~~ ✅ FIXED (2026-02-26)
**Where**: `computeFloorWallGeometry` cross-room corner fill (line ~1706-1711)
**Problem**: Inner corner `p3` is computed as `p1 + p2 - p4` (parallelogram law). This assumes the quad is a perfect parallelogram. For walls with different thicknesses, the "inner" corners don't form a parallelogram. This can produce degenerate, inverted, or self-intersecting quads.
**Impact**: 3D mesh rendering shows inverted faces, holes, or visual artifacts at cross-room corners with mismatched wall thickness.
**Fix**: Added `lineLineIntersect` helper for unbounded inner face intersection. See `plans/2026-02-26_13-15_wall-fixes-c1-c3-c5.md`.

---

## HIGH Issues (likely causing visible bugs)

### H1. Antiparallel edge direction ignored
**Where**: `findSharedEdgeMatches` returns `antiParallel` flag; `mergeSharedEdgeWalls` ignores it
**Problem**: When room R1's edge points RIGHT and room R2's edge points LEFT on the same wall, both surfaces get `fromCm < toCm` (the swap at line ~444 forces this). But semantically they should be flagged as reversed — tiling origin, skirting side, and doorway offsets should be inverted.
**Impact**: Antiparallel rooms render identically even though they face opposite directions.

### H2. Surface fromCm/toCm depends on room processing order
**Where**: `ensureWallsForEdges` main loop
**Problem**: Wall geometry is extended incrementally as rooms are processed. If room A is processed first, the wall direction is set by A. When room B is processed later, the wall may have been extended/shifted, so B's surface projection uses a different wall geometry than A's did. Processing rooms in a different order can produce different surface ranges.
**Impact**: Non-deterministic results depending on `floor.rooms` array order.

### H3. removeStaleWalls over-aggressive during temporary states
**Where**: `removeStaleWalls` (line ~696)
**Problem**: A wall is removed if `wall.roomEdge && !touchedWallIds.has(wall.id)`. But `touchedWallIds` only includes walls for rooms with ≥3 vertices. If a room temporarily has <3 vertices (during constraint enforcement or polygon editing), its walls are removed even though the room still exists and has a valid `roomId`.
**Impact**: Valid walls deleted during transient polygon states.

### H4. Reflex angle extension formula may produce wrong values
**Where**: `computeWallExtensions` (lines ~1160-1165)
**Problem**: For reflex angles (>90° interior), the corner intersection formula may produce large positive extensions instead of zero or small values. The 3x-thickness clamp limits damage but doesn't fix the root cause. No test coverage for 135°+ angles.
**Impact**: Walls at reflex corners extend outward, creating visual artifacts and overlapping geometry.

---

## MEDIUM Issues (edge cases, fragile assumptions)

### M1. extendWallGeometry can flip wall direction
**Where**: `extendWallGeometry` (lines ~297-315)
**Problem**: When extending, the function decides start/end based on `wall.start.x <= wall.end.x` (for H walls). If extension causes the min/max to swap relative to the original direction, the wall direction flips. This invalidates all surface projections.

### M2. findAlignedWall ignores surface conflicts
**Where**: `findAlignedWall` (line ~242)
**Problem**: Only excludes the CURRENT room being processed. Doesn't check if the wall already has surfaces from this room on different edges. A room could accidentally get multiple surfaces on the same wall for different edges.

### M3. indexWallsByEdge first-match-wins, duplicates silent
**Where**: `indexWallsByEdge` (line ~87)
**Problem**: If two walls have surfaces for the same `roomId:edgeIndex`, only the first is indexed. The second is invisible to the pipeline. No diagnostic warning.

### M4. enforceAdjacentPositions same-side detection fragile
**Where**: `enforceAdjacentPositions` (line ~710)
**Problem**: Uses `|currentDist| < thick/2` to detect same-side rooms. This uses only one vertex, not the full edge. For non-axis-aligned walls or long edges, the single-vertex check can misclassify.

### M5. Position shifts invalidate surface ranges (one-frame latency)
**Where**: `syncFloorWalls` pipeline order
**Problem**: `enforceAdjacentPositions` shifts `room.floorPosition` AFTER `mergeSharedEdgeWalls` computed surface `fromCm/toCm`. The surface ranges are stale until the next `syncFloorWalls` call. Any rendering between calls shows inconsistent data.

### M6. getWallNormal fallback {x:0,y:-1} applied silently
**Where**: `getWallNormal` (lines ~1090-1110)
**Problem**: Three different early returns all produce `{x:0,y:-1}` (up). If `enforceAdjacentPositions` uses a fallback normal, it shifts rooms in the wrong direction. No warning logged.

### M7. Both-classified wall thickness takes max
**Where**: `mergeSharedEdgeWalls` (line ~596)
**Problem**: When merging two walls that both have non-default (classified) thicknesses, the code takes `Math.max()`. This produces a hybrid that may not match any defined wall type (e.g., partition 11.5 + structural 24 → 24cm).

### M8. createWallMapper determinant threshold too tight
**Where**: `three-view.js` `createWallMapper` (line ~72)
**Problem**: Threshold is 0.001 (1mm²). Very narrow surfaces (0.5cm × 250cm) can have a determinant below this, causing the mapper to return null. The entire surface is silently skipped.

### M9. Doorway width not bounds-checked in buildWallGeo
**Where**: `three-view.js` `buildWallGeo` (line ~216)
**Problem**: Doorway height is clamped to wall height, but width is NOT clamped. `offsetCm + widthCm > edgeLen` creates a hole that extends past the wall edge, producing degenerate ShapeGeometry.

### M10. Corner fill height not interpolated for sloped walls
**Where**: `computeFloorWallGeometry` corner fill (line ~1660)
**Problem**: Corner fills use constant `h = wall.heightEndCm`. For walls with `hStart ≠ hEnd` (sloped ceiling), the corner fill height doesn't match the wall height at the corner location.

### M11. Hairpin (180°) corner extension uses fallback instead of 0
**Where**: `computeWallExtensions` (lines ~1196-1200)
**Problem**: For parallel-opposite-direction edges (hairpin turns), extension falls back to `thickPrev` instead of 0. This creates a visible bulge at interior U-shaped corners.

### M12. enforceSkeletonWallProperties stops at first boundary match
**Where**: `skeleton.js:enforceSkeletonWallProperties` (line ~227)
**Problem**: If a wall spans from one structural boundary to another with different thicknesses, only the first match applies. The wall gets the wrong thickness for its second half.

---

## Parked Questions — Answered (2026-02-26)

### 1. Edge index stability (C2)
**Q**: Is there a mechanism to update wall/surface edge indices when a room polygon is edited? Or is this entirely missing?
**User**: Too technical — investigate.
**Investigation findings**: **No explicit mechanism exists.** However, risk is low in practice:
- All polygon modifications that change vertex count (room detection, polygon drawing) create **fresh rooms** — no pre-existing surfaces to become misaligned.
- Vertex drag, rectangle resize, and dimension edits don't change vertex count or order.
- `pruneOrphanSurfaces` catches out-of-bounds indices (edgeIndex >= vertexCount) and removes them.
- **Gap**: `pruneOrphanSurfaces` does NOT detect wrong-but-in-bounds indices (pointing to a different edge than intended after reordering). This scenario doesn't currently occur because no code path reorders vertices on an existing room.
- **Conclusion**: C2 is a theoretical risk, not a current bug. Would become real if polygon vertex editing (add/remove vertices on existing rooms) is added.

### 2. Antiparallel edges (H1)
**Q**: Do we need to support antiparallel room edges on the same wall?
**User**: No need for antiparallel edges at this point.
**Impact on H1**: H1 is **deferred** — no fix needed. If antiparallel support becomes needed later, surface orientation handling must be added.

### 3. Room processing order (H2)
**Q**: Should we sort rooms by ID for determinism?
**User**: Indifferent — it should be reliable. Propose a solution.
**Proposed fix**: Sort rooms by ID at the start of `ensureWallsForEdges` and `mergeSharedEdgeWalls`. This makes surface `fromCm/toCm` deterministic regardless of `floor.rooms` array order. Simple one-line change: `const sortedRooms = [...rooms].sort((a, b) => a.id.localeCompare(b.id));`

### 4. Polygon editing workflow (C2, H3)
**Q**: Is there a transient state where walls reference stale indices?
**User**: Too technical — investigate.
**Investigation findings**: **No transient states exist.** Every polygon modification path calls `syncFloorWalls` immediately before `store.commit`:
- Vertex drag (drag.js:1257) → `syncFloorWalls` → commit
- Room resize (drag.js:1078) → `syncFloorWalls` → commit
- Room detection (room-detection-controller.js:465) → `syncFloorWalls` → commit
- Dimension editing (main.js:839) → `syncFloorWalls` → commit
- Room addition (structure.js:256) → `syncFloorWalls` → commit
- Room deletion (structure.js:280) → `syncFloorWalls` → commit
- Polygon drawing (main.js:3428) → `syncFloorWalls` → commit
- Room drag (drag.js:874) → `syncFloorWalls` → commit

No code accesses wall data between polygon modification and `syncFloorWalls`. Rendering happens only via `onRender: renderAll` callback after commit.
**Impact on H3**: H3 risk is lower than assessed — `removeStaleWalls` runs inside `syncFloorWalls`, which is always called with a consistent polygon state. The <3 vertices scenario would only occur if a room is mid-construction, which doesn't happen (rooms are created complete).

### 5. Non-axis-aligned walls (M4, M1)
**Q**: Should diagonal walls ever exist?
**User**: Yes, diagonal walls can exist in: (a) free mode, (b) constraint mode (automatic room detection and tracing) if the angle allows it and doesn't break other constraints.
**Impact**: M1 and M4 remain relevant — `extendWallGeometry`'s H/V assumption (M1) and `enforceAdjacentPositions`' single-vertex check (M4) need to handle diagonal walls correctly. Cannot add H/V-only assertions.

### 6. Corner fill priority (C5)
**Q**: Fix now or defer?
**User**: Obsolete.
**Status**: **RESOLVED** — C5 fixed in `plans/2026-02-26_13-15_wall-fixes-c1-c3-c5.md`.

### 7. startCornerFill (C1)
**Q**: Fix immediately or wait?
**User**: Obsolete.
**Status**: **RESOLVED** — C1 fixed in `plans/2026-02-26_13-15_wall-fixes-c1-c3-c5.md`.

---

## Architecture Observations

### Positive patterns
- The pipeline is well-structured: create → merge → prune → enforce
- Most guard conditions are present (null checks, bounds checks, length thresholds)
- Logging is now comprehensive (after this session's additions)
- Thickness inference logic is sound (classified > default > gap-based)

### Structural weaknesses
1. **Edge index as identity**: The entire system uses positional array index as a stable identifier for room edges. This is the single biggest architectural weakness — every polygon modification can corrupt the wall graph.

2. **In-place mutation during iteration**: `mergeSharedEdgeWalls` splices walls while iterating, leading to stale references and order-dependent results.

3. **Two-phase inconsistency**: `enforceAdjacentPositions` mutates room positions after surfaces are computed, creating a one-frame latency. The pipeline should either re-project surfaces after position enforcement, or split into separate passes.

4. **Extension vs. merge separation**: The code mixes wall extension (geometry change) and surface assignment (data flow) in the same loop. This makes it hard to reason about what state a wall is in at any given point.

5. **Corner fill as afterthought**: Corner fills are computed in `computeFloorWallGeometry` (a geometry derivation function) but need to be threaded through `prepareFloorWallData` (data assembly) to reach 3D. The `startCornerFill` omission (C1) is symptomatic of this indirect path.
