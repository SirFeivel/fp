# Session Notes

## Goal
- Implement base boards functionality.

## Current State
- Started new topic "base boards".
- Created branch `feature/base-boards`.

## Session: Unified Room Sections (2026-01-27)
### Goal
- Integrate legacy room dimensions (widthCm/heightCm) into the existing sections functionality.
- Consolidate UI and ensure a single source of truth for room geometry.

### Plan
1. Create feature branch `feature/unified-sections` ✓
2. Implement V4 schema migration in `src/state.js` and update `core.js` ✓
3. Refactor logic in `geometry.js`, `calc.js`, and `validation.js` to prioritize sections ✓
4. Consolidate UI by removing legacy dimension inputs from `index.html` and `ui.js` ✓
5. Update test suites and `visual-test.html` to align with the V4 schema ✓
6. Final verification with full test suite and production build ✓

### Status
- Room geometry is now managed exclusively via the `sections` array in the V4 schema.
- Legacy property inputs have been removed from the sidebar, centralizing control in the sections panel.
- Backward compatibility is maintained via robust migration logic and a temporary fallback in the sections retriever.
- All 354 tests pass and the production build is successful.

## Session: Unified Room UI (2026-01-27)
### Goal
- Merge "Room Details" and "Sections" visually into a single common place.
- Implement default naming for sections (Room 1, Room 2, etc.).
- Move Skirting Configuration to Tiles tab.

### Plan
1. Create feature branch `feature/merge-sections-ui` ✓
2. Refactor `index.html` to unify Room and Sections cards ✓
3. Implement automated naming in `src/composite.js` ✓
4. Relocate Skirting configuration to Tiles tab in `index.html` ✓
5. Remove redundant "Enable Skirting" toggle ✓
6. Update `render.js` and `ui.js` to sync with the new UI structure ✓
7. Verify with tests and build ✓

### Status
- Room UI is now cleaner with a single "Room" card.
- Sections are automatically named upon creation.
- Skirting configuration is now logically placed in the Tiles tab.
- Redundant global skirting toggle removed.
- All 354 tests pass.

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

## Session: V4 Schema Cleanup (2026-01-27)
### Goal
- Perform final cleanup of legacy room dimensions logic.
- Ensure all tests are strictly V4-compliant.

### Plan
1. Create branch `feature/v4-cleanup` ✓
2. Remove fallback logic in `src/composite.js` ✓
3. Update all test suites to strictly use `sections` array ✓
4. Verify with full test suite and build ✓
5. Merge to main after user acceptance ✓

### Status
- Codebase is now strictly V4-compliant.
- Legacy properties `widthCm`/`heightCm` removed from core logic and tests.
- All 353 tests pass.

## Commands Run
- npm run test
- npm run build
- git checkout main
- git merge fix/ui-title-header
- git branch -d fix/ui-labels fix/ui-title-header
- git push origin main

## Notes
- Topic "UI Relabeling" and "UI Refinement" completed, merged, and pushed to main.
- All 361 tests pass.
- App title updated to "TilePerfect [ALPHA]".

## Session: UI & UX Improvements (2026-01-27)
### Goal
- Address UI inconsistencies and improve overall UX.
- Consolidate Tile Layout controls.
- Standardize collapsibility of UI sections.
- Redesign Calculation panel for better readability.

### Plan
1. Create branch `feature/ui-improvements` ✓
2. Update App Header to "TilePerfect 0.1" and align elements ✓
3. Consolidate Tile Layout (Pattern + Position) in one card ✓
4. Implement consistent `collapsible-card` pattern across all tabs ✓
5. Redesign Right Menu (Metrics) with sections and totals ✓
6. Verify with tests and build ✓

### Status
- App renamed to TilePerfect 0.1.
- Left menu is more compact with consolidated Tile Layout section.
- All major UI panels are now collapsible with a consistent toggle animation.
- Metrics panel (right) is now structured into logical sections (Calculation, Skirting, Grand Total) with improved styling.
- All 354 tests pass and production build is successful.

## Session: UI Consistency & Spacing (2026-01-27)
### Goal
- Fix padding issues, cut-off text, and misaligned toggles.
- Standardize UI patterns for cards, fields, and buttons.

### Plan
1. Create feature branch `feature/ui-consistency-v2` ✓
2. Audit CSS for spacing and alignment flaws ✓
3. Standardize `.toggle-switch` layout with `justify-content: space-between` ✓
4. Implement unified card content padding via `.card-content` ✓
5. Improve button and input sizing (min-height, padding, font-size) ✓
6. Enhance Metrics panel readability ✓
7. Verify with tests and build ✓

### Status
- Toggles now use the full width of their container with labels left and sliders right.
- Card padding is consistent across all tabs.
- Inputs and buttons have better touch targets and consistent sizing.
- Metrics panel values are larger and easier to read.
- All 354 tests pass and production build is successful.

## Session: UI Relabeling (2026-01-27)
### Goal
- Relabel specific UI elements as per user request.

### Plan
1. Create feature branch `fix/ui-labels` ✓
2. Update `src/i18n.js` with new labels: ✓
   - Room -> Your Project / Ihr Projekt
   - Project -> Settings / Einstellungen
   - Tabs -> Building / Gebäude
3. Update `index.html` static fallbacks ✓
4. Verify with tests and build ✓

### Status
- UI relabeled successfully.
- All 361 tests pass and production build is successful.

## Session: UI Refinement & App Title (2026-01-27)
### Goal
- Update app title and specific section labels for better clarity.

### Plan
1. Create feature branch `fix/ui-title-header` ✓
2. Rename the 2nd section header in 'Your Project' tab to 'Fläche' (Area) in `src/i18n.js` and `index.html` ✓
3. Update the browser tab title in `index.html` to 'TilePerfect [ALPHA]' ✓
4. Verify with tests and build ✓

### Status
- App title updated to "TilePerfect [ALPHA]".
- 'Raum' section in 'Your Project' tab renamed to 'Fläche' (Area).
- All 361 tests pass and production build is successful.

## Session: Fix Removal Mode (2026-01-27)
### Goal
- Fix crash in Removal Mode.
- Enable toggling tiles back (currently they disappear).

### Plan
1. RCA: Found that `renderPlanSvg` was adding multiple click listeners to `planSvg`, causing exponential re-renders (crash). ✓
2. RCA: Found that `tilesForPreview` filtered out excluded tiles by default, making them unclickable. ✓
3. Move `planSvg` background click listener from `render.js` to `main.js`. ✓
4. Update `render.js` to pass `includeExcluded: true` and style excluded tiles (red dashed). ✓
5. Fix outdated `skirting_removal.test.js`. ✓
6. Add `removal_tiles.test.js` to verify tile removal logic. ✓

### Status
- Removal mode is now stable and fully functional for both tiles and skirts.
- Excluded elements are rendered with a distinct "deleted" style in removal mode.
- All 361 tests pass.

## Session: Removal Mode (2026-01-27)
### Goal
- Implement "Removal Mode" to allow users to mark specific tiles or skirting segments as excluded.
- Ensure stable IDs for all generated geometry to support persistent exclusions.
- Provide a simple UI toggle in the plan toolbar.

### Plan
1. Create branch `feature/removal-mode` ✓
2. Update room schema to include `excludedTiles` and `excludedSkirts` ✓
3. Update geometry generators to assign stable IDs and respect exclusions ✓
4. Implement interactive selection in `src/removal.js` and `src/render.js` ✓
5. Add "Edit Exclusions" toggle to plan toolbar ✓
6. Verify with tests and build ✓

### Status
- "Removal Mode" fully functional for both tiles and skirting.
- Stable ID generation implemented for all 8 pattern types.
- UI integrated into the plan toolbar with hover highlighting.
- All 358 tests pass and production build successful.

## Notes
- Topic "Removal Mode" completed, merged, and pushed to main.
- Local feature branch `feature/removal-mode` deleted.

## Session: Fix Skirting Exclusion (2026-01-27)
### Goal
- Fix the issue where skirting segments could not be excluded as requested.
- Improve UX by allowing toggling excluded segments back ON.
- Ensure stable skirting IDs and better hit areas for interaction.

### Plan
1. Create branch `bugfix/skirting-exclusion` ✓
2. Normalize skirting segment IDs by sorting points (direction independence) ✓
3. Implement `includeExcluded` option in `computeSkirtingSegments` ✓
4. Update `renderPlanSvg` to show excluded segments in removal mode ✓
5. Add transparent hit-area paths for skirting to improve clickability ✓
6. Fix CSS hover behavior for skirting in removal mode ✓
7. Verify with tests and build ✓

### Status
- Skirting exclusion is now fully functional and stable.
- Excluded segments are now visible (in red) during "Removal Mode", allowing users to undo exclusions.
- Clicking skirting is much easier due to invisible hit-areas that bridge the gaps in dashed lines.
- All 360 tests pass and production build is successful.

## Session: Deployment Setup (2026-01-27)
### Goal
- Deploy the application to GitHub Pages for external testing.
- Automate the deployment process via GitHub Actions.

### Plan
1. Create branch `feature/deployment-setup` ✓
2. Configure GitHub Actions workflow for CI/CD ✓
3. Update `README.md` with live link and build status ✓
4. Verify local production build ✓

### Status
- GitHub Actions workflow `.github/workflows/deploy.yml` created.
- Application configured to deploy from `main` branch.
- Live demo link added to README.
- Local build `npm run build` is successful.

## Commands Run
- git checkout -b feature/deployment-setup
- npm run build

## Session: Dynamic Plan Title (2026-01-27)
### Goal
- Move room name from SVG to the Plan header.
- Make the title dynamic (Floor / Room — Area).
- Ensure readability with long names.

### Plan
1. Create feature branch `feature/dynamic-plan-title` ✓
2. Remove static room label from SVG in `src/render.js` ✓
3. Update `index.html` with target ID for dynamic title ✓
4. Implement dynamic title update in `src/render.js` ✓
5. Add CSS for title truncation and layout stability ✓
6. Verify with tests and build ✓

### Status
- Room label no longer clutters the SVG preview.
- Plan header now displays "Floor / Room — X.XX m²" dynamically.
- Long names are gracefully truncated with ellipses to prevent layout breaking.
- All 354 tests pass and production build is successful.

## Session: Responsive Tabs (2026-01-27)
### Goal
- Improve tab navigation responsiveness.
- Hide labels and show only icons when the viewport is narrow to prevent overlapping.

### Plan
1. Create feature branch `feature/responsive-tabs` ✓
2. Update `src/style.css` with a media query to hide tab text at narrow widths ✓
3. Reduce `min-width` of tabs to allow more compact layout ✓
4. Verify with tests and build ✓
5. Fix issues where text was still visible on some screen sizes (force hide with !important and increase breakpoint) ✓

### Status
- Navigation tabs now automatically switch to an icon-only mode when the screen width is below 1400px.
- Use of `!important` ensures labels are reliably hidden.
- This prevents labels from overlapping and ensures the UI remains usable on smaller screens or when panels are wide.
- All 355 tests pass.

## Session: Hints and Tips (2026-01-27)
### Goal
- Move hint section below the plan.
- Merge functionality with a new 'Tip' section.
- Reserve the Warnings box for potential warnings and errors only, hiding it when empty.

### Plan
1. Create feature branch `feature/hints-and-tips` ✓
2. Refactor `index.html` to relocate and merge hint/tip sections ✓
3. Update `src/render.js` logic to hide empty warnings box ✓
4. Update `src/style.css` for the new layout ✓
5. Update `src/i18n.js` for new translations ✓
6. Verify with tests and build ✓

### Status
- Hint line removed from SVG wrap and integrated into a new standardized "Tip" section below the plan.
- Warnings section is now dynamic and hidden if there are no warnings or pattern-specific hints to show.
- All tests pass and production build is successful.

## Commands Run
- npm run test
- npm run build
- git checkout -b feature/hints-and-tips
- git checkout main
- git merge feature/hints-and-tips
- git branch -d feature/hints-and-tips

## Session: Fix Grand Total with Invalid Pattern (2026-01-27)
### Goal
- Hide Grand Total metrics when the tile pattern is invalid (e.g., wrong ratio for Herringbone).
- Ensure consistency between individual tile metrics and the grand total display.

### Plan
1. Create feature branch `feature/fix-grand-total-invalid-pattern` ✓
2. Update `renderMetrics` in `src/render.js` to hide Grand Total when `ratioError` is present ✓
3. Add reproduction test case in `src/render_smoke.test.js` ✓
4. Verify with full test suite and build ✓

### Status
- Grand Total section is now correctly hidden when an invalid pattern ratio prevents tile calculation.
- Added automated test to verify the fix and prevent regressions.
- All 355 tests pass and production build is successful.

## Commands Run
- npm run test
- npm run build
- git checkout -b feature/fix-grand-total-invalid-pattern
- git checkout main
- git merge feature/fix-grand-total-invalid-pattern
- git branch -d feature/fix-grand-total-invalid-pattern

## Session: Project Tab Refactoring (2026-01-27)
### Goal
- Reorganize the Project tab for better usability and clarity.
- Move "Reset" functionality to the bottom and add a confirmation dialog.
- Enhance visual hierarchy with a "Danger Zone".

### Plan
1. Create feature branch `feature/project-tab-refactoring` ✓
2. Refactor Project Tab in `index.html` (Save -> Saved Projects -> Import/Export -> History -> Danger Zone) ✓
3. Implement `confirm()` dialog for Reset in `src/ui.js` ✓
4. Update `src/i18n.js` with clearer labels and descriptions ✓
5. Add danger-zone styling in `src/style.css` ✓
6. Verify with tests and build ✓

### Status
- Project tab is now logically structured with the most common actions at the top.
- "Reset All" is protected by a confirmation dialog and placed in a visually distinct "Danger Zone" at the bottom.
- Labels in German and English have been improved for better context.
- All 355 tests pass and production build is successful.

## Session: UI Refinement v4 (2026-01-27)
### Goal
- Fix panel header alignment and missing titles.
- Fix Project tab label and re-arrange sections.
- Set default open/closed states for collapsible cards.

### Plan
1. Create feature branch `feature/ui-refinement-v4` ✓
2. Fix Project tab label and panel header alignment ✓
3. Re-arrange Project tab sections and remove History ✓
4. Implement default open/closed states for collapsible cards ✓
5. Verify with tests and build ✓

### Status
- Left panel now has a "Struktur" header for consistency.
- Panel headers standardized with 40px height and centered titles/buttons.
- Project tab sections re-ordered: Save, Load, Import/Export, Danger Zone.
- History section removed as requested.
- "Project" tab label fixed in English.
- Default open cards: Structure (Nav), Room, Tiles & Grout. Others closed by default.
- All 355 tests pass.

## Session: Removal Mode UI & Consistency (2026-01-27)
### Goal
- Improve visual recognition of selected tiles/skirts in Removal Mode.
- Ensure UI and UX consistency between tiles and skirts.

### Plan
1. Create branch `feature/removal-mode-ui` ✓
2. Unify exclusion styles (red tint/border/dashed) for tiles and skirts ✓
3. Improve hover states and transitions ✓
4. Rename "Edit Exclusions" to "Removal Mode" for better clarity ✓
5. Verify with tests and build ✓

### Status
- Unified selection style: both elements use red tint and 8px/dashed red borders when excluded.
- Improved UX: bright accent hover states and smooth transitions.
- Label updated to "Removal Mode" (EN) / "Entfernen-Modus" (DE).
- All 361 tests pass.

## Commands Run
- npm run test
- npm run build
- git checkout -b feature/removal-mode-ui
- git commit -am "Improve Removal Mode UI/UX and consistency"
- git checkout main
- git merge feature/removal-mode-ui
- git branch -d feature/removal-mode-ui
- git push origin main
