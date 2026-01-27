# Session Notes

## Goal
- Implement base boards functionality.

## Current State
- Started new topic "base boards".
- Created branch `feature/base-boards`.

## Next Steps
- Wait for briefing.

## Session: Skirting Corner Handling (2026-01-27)
### Goal
- Prevent skirting pieces from wrapping around corners visually and in calculations.

### Plan
1. Create branch `feature/skirting-corners` ✓
2. Implement `computeSkirtingSegments` in `src/geometry.js` ✓
3. Update `computeSkirtingNeeds` in `src/calc.js` to use per-segment calculation ✓
4. Update `renderPlanSvg` in `src/render.js` to render individual wall segments ✓
5. Verify with tests and build ✓

### Status
- Skirting pieces now correctly break at corners.
- Material calculation accounts for per-wall segment cutting.
- Visualization resets dash pattern at every vertex.

## Commands Run
- npm run test
- npm run build
- git checkout -b feature/skirting-corners

## Session: Skirting Inner Borders (2026-01-27)
### Goal
- Fix skirting appearing on shared borders between room sections.

### Plan
1. Create branch `feature/skirting-inner-borders` ✓
2. Create reproduction test `src/skirting_inner_borders.test.js` ✓
3. Implement `isSegmentOnBoundary` in `src/geometry.js` ✓
4. Refactor `computeSkirtingSegments` to filter segments against physical boundaries ✓
5. Update `render.js` and `calc.js` to use the new segment data structure ✓
6. Verify with tests and build ✓

### Status
- Skirting now correctly ignores inner borders between sections.
- Visualization and calculations are synced via `computeSkirtingSegments`.
- All tests pass, including new boundary-aware test cases.

## Commands Run
- npm run test
- npm run build
- git checkout -b feature/skirting-inner-borders
- git checkout main
- git merge feature/skirting-inner-borders
- git branch -d feature/skirting-inner-borders

## Notes
- Topic "Skirting Inner Borders" completed and merged.
