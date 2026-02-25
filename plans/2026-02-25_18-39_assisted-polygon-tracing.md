# Plan: Assisted polygon room tracing

## Implementation

### What was done

**Step 1: Envelope-aware boundary snapping** (`src/polygon-draw.js`)
- Added `findNearestBoundaryPoint()` — snaps cursor to H/V structural boundaries within threshold
- Extended `snapToRoomGeometry()` with `boundaryTargets` parameter — boundary snap sits between edge snap and grid fallback
- Added assisted mode detection in `startDrawing()`: active when `floor.layout.envelope` + `floor.layout.background.scale.calibrated`
- `handleClick` and `handleMouseMove` pass `boundaryTargets` when in assisted mode
- Orange snap indicator (`#f97316`) for boundary snaps in `updatePreview()`
- Reset assisted state in `stopDrawing()`

**Step 2: Remove shared-edge constraint** (`src/polygon-draw.js`)
- `edgeSnapMode` set to false when `assistedMode` is true
- Room geometry still cached for vertex/edge snapping even without edge snap mode
- Assisted mode hint text shown

**Step 3: Gap-based wall thickness inference** (`src/floor_geometry.js`, `src/walls.js`)
- Added `perpDist` to `findSharedEdgeMatches()` return object
- In `mergeSharedEdgeWalls()`, when both walls have default thickness and `perpDist > 0.5`:
  - Snap gap to nearest wall type via `snapToWallType()`
  - Only apply if delta ≤ 3cm (GAP_SNAP_TOLERANCE_CM)
  - Otherwise keep `Math.round(gap)` as raw thickness

### Core findings
- The merge tolerance in `mergeSharedEdgeWalls` is `wall.thicknessCm + 1` (default: 13cm). Gaps larger than 13cm won't be detected as shared edges — gap-based thickness only applies within this range.
- Vertical walls shared between stacked rooms (via step (a) extension) also show as "shared" — tests must filter by wall orientation to find the correct horizontal gap wall.
- The "discovered angles" test in room-detection.verify.test.js is flaky in full suite runs but passes in isolation — pre-existing issue, not caused by these changes.

### Tests
- `src/polygon-draw.test.js`: +3 describe blocks (findNearestBoundaryPoint, boundary snap in snapToRoomGeometry, assisted mode detection) — ~15 new tests
- `src/walls.test.js`: +1 describe block (gap-based wall thickness inference) — 3 new tests
- All 191 tests pass in targeted run

## Outcome: Complete
