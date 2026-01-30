## Session: Tile Collection Setup (2026-01-29)
### Goal
- Let users define a reusable tile collection in Setup
- Enable preset selection in Planning to avoid re-entering tile properties

### Branch
`feature/tile-collection-setup`

### Plan
1. Add a Tile Collection section in Setup for create/edit/delete presets
2. Persist presets at project level in state and include in save/load
3. Surface presets in Planning with “apply preset” behavior
4. Ensure existing per-room tile settings still work when no preset is chosen
5. Update i18n strings and add tests where appropriate

### Notes
- Merged `ux-overhaul-backbone` into `main` on 2026-01-29

## Session: UX Overhaul - Step 1 (2026-01-28)
### Goal
- Analyze current UX and record flaws
- Design a new UX architecture with calm, flow-based guided approach
- Implement the backbone of the new app structure

### Branch
`ux-overhaul-backbone`

### Step 1: UX Analysis

#### Current Architecture
The app uses a 3-column layout:
- **Left Panel (420px)**: Navigation tabs (Room, Tiles, Exclusions, Project, Debug) + form content
- **Center (flex)**: Main SVG preview + Commercial tab with horizontal tabs
- **Right Panel (420px)**: Metrics/calculations display

#### Identified UX Flaws

1. **Overwhelming Three-Panel Layout**
   - Too much information visible simultaneously
   - User doesn't know where to focus
   - No clear visual hierarchy

2. **Dual Tab Systems Create Confusion**
   - Left sidebar has vertical tabs (Room/Tiles/Exclusions/Project/Debug)
   - Center viewer has horizontal tabs (Plan/Commercial)
   - User must understand two navigation paradigms

3. **No Clear Workflow/Flow**
   - User can jump anywhere - no guided progression
   - Setup → Planning → Commercial flow not enforced
   - Missing stepper or progress indication

4. **Collapsible Cards Add Complexity**
   - Multiple nesting levels (tab > card > content)
   - Hidden-by-default content requires manual expansion
   - Features hard to discover

5. **Debug Tab Exposed to End Users**
   - Developer tool visible in main navigation
   - Creates confusion for non-technical users

6. **Metrics Sidebar Always Visible**
   - Shows calculations even during setup phase
   - Distracting when not relevant
   - Takes up precious horizontal space

7. **Dense Input Forms**
   - Too many inputs per card
   - Small labels, compact spacing
   - Cognitive overload

8. **Poor Mobile/Responsive Handling**
   - Below 980px everything stacks vertically
   - Loses structure entirely
   - No mobile-optimized flow

9. **No Visual Hierarchy for Workflow Stages**
   - All tabs appear equal
   - No indication of completion or progress

10. **Project Management Buried**
    - Save/load hidden in "Project" tab
    - Important functions not easily accessible

### Step 2: UX Plan (Approved)

#### Core Principles
- **Calm, flow-based guided approach**: Setup → Planning → Commercial
- **Clean main screen**: No side boxes, no distraction
- **Top navigation**: Tab-based for each core topic
- **Preserve aesthetics**: Keep existing color scheme and visual identity

#### Approved Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│ HEADER: Logo | Project Name | [Save] [Undo/Redo] | Lang | Autosave     │
├─────────────────────────────────────────────────────────────────────────┤
│ MAIN TABS: [Setup] [Planning] [Commercial]                 (top nav)   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│                    CLEAN FULL-WIDTH CONTENT AREA                        │
│                                                                         │
│   Setup:     Building structure (floors, rooms, sections)              │
│   Planning:  Per-room tile + layout + SVG preview (the main work)      │
│   Commercial: Summary tables, pricing, export                          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Tab Structure

1. **Setup Tab** (Building Structure)
   - Floors management
   - Rooms management
   - Sections (room geometry)
   - Focus: "What spaces do I have?"

2. **Planning Tab** (Per-Room Design Work)
   - Room selector (which room am I working on?)
   - Tile configuration (dimensions, shape, reference - per room)
   - Pattern/Layout (grid, herringbone, offsets, rotation)
   - Grout settings (width, color)
   - Full SVG preview with toolbar (grid, skirting, removal mode)
   - Exclusions management (contextual to the room)
   - Focus: "How do I tile each room?"

3. **Commercial Tab** (Results)
   - Room overview table
   - Consolidated materials table
   - Pricing inputs
   - Export options
   - Focus: "What does it cost?"

#### Implementation Phases

**Phase 1 (This Session): Backbone**
- New HTML structure with top-level main tabs
- CSS for clean, full-width content areas
- Tab switching logic
- Migrate existing content into new structure
- Ensure backward compatibility - nothing breaks
- Make it expandable for future phases

**Phase 2 (Future): Setup Tab Polish**
- Redesign forms with better layout
- Progressive disclosure

**Phase 3 (Future): Planning Tab Polish**
- Full-width SVG optimization
- Floating/slide-out controls
- Contextual metrics

**Phase 4 (Future): Commercial Tab Polish**
- Enhanced tables
- Better export options

### Step 3: Implementation (Complete)

#### Changes Made
1. **index.html**: Complete restructure
   - Removed 3-panel layout (left sidebar, viewer, right metrics)
   - Added main navigation bar with Setup/Planning/Commercial tabs
   - Setup tab: Building structure + Project management
   - Planning tab: Sidebar (tiles/layout/exclusions) + SVG preview + metrics
   - Commercial tab: Room overview + materials tables
   - Debug panel hidden (accessible via developer tools)

2. **style.css**: New layout styles
   - Main navigation styling (`.main-nav`, `.main-nav-tab`)
   - Setup container (2-column grid)
   - Planning container (sidebar + preview)
   - Commercial container (centered, max-width)
   - Preserved all existing component styles
   - Responsive breakpoints for mobile

3. **tabs.js**: Updated for new navigation
   - Replaced old sidebar tabs with main navigation
   - Added migration from old localStorage tab names
   - `initTabs()` kept as no-op for compatibility

4. **i18n.js**: Added navigation translations
   - `nav.setup`, `nav.planning`, `nav.commercial` (DE/EN)

5. **main.js**: Simplified initialization
   - Removed resize and collapse panel imports
   - Cleaned up initialization

6. **Removed**: `tabs_responsive.test.js` (obsolete)

### Status
- All 373 tests pass
- Build successful
- Ready for user testing

---

## Session: UX Overhaul - Step 2: Setup Section (2026-01-28)

### Goal
Simplify the Setup section with unified UX patterns, reduced complexity, and a settings burger menu.

### Current Problems Identified

| Problem | Impact |
|---------|--------|
| 6 collapsible cards | Fragmented, overwhelming |
| Room dimensions buried in "sections" | User must: select section → find properties → edit x/y/width/height |
| Project management takes 50% of screen | Save/Load/Import/Export/Danger Zone clutter |
| Section-based approach is complex | x/y coordinates confusing for simple rectangular rooms |
| No clear flow | User doesn't know what to do next |

### Proposed Plan

#### Part A: Settings Burger Menu (Top Right)

Move all project/settings controls out of Setup into a dropdown menu:

```
┌─────────────────────────────────────────────────────────────┐
│ [Logo] TilePerfect    [Setup][Planning][Commercial]   [☰]  │
│                                                        ↓    │
│                                              ┌─────────────┐│
│                                              │ 💾 Save     ││
│                                              │ 📂 Load     ││
│                                              │ ─────────── ││
│                                              │ ↗ Export    ││
│                                              │ ↙ Import    ││
│                                              │ ─────────── ││
│                                              │ 🔄 Reset    ││
│                                              │ 🐛 Debug    ││
│                                              └─────────────┘│
└─────────────────────────────────────────────────────────────┘
```

Contents:
- Save Project (opens save dialog)
- Load Project (opens load dialog)
- Export JSON
- Import JSON
- Reset All (with confirm)
- Debug Mode (toggle)

#### Part B: Simplified Setup Flow

**New single-column centered layout:**

```
┌─────────────────────────────────────────────────────────────┐
│                         SETUP                               │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐ │
│  │  FLOOR                                                 │ │
│  │  [Ground Floor        ▼]  [+ Add]  [Delete]           │ │
│  │  Name: [Ground Floor_____]                            │ │
│  └───────────────────────────────────────────────────────┘ │
│                          ↓                                  │
│  ┌───────────────────────────────────────────────────────┐ │
│  │  ROOM                                                  │ │
│  │  [Bathroom            ▼]  [+ Add]  [Delete]           │ │
│  │  Name: [Bathroom_________]                            │ │
│  │                                                        │ │
│  │  DIMENSIONS                                            │ │
│  │  Width: [300___] cm      Length: [400___] cm          │ │
│  │                                                        │ │
│  │  ┌──────────────────────────────────────────────────┐ │ │
│  │  │ 💡 Need an L-shape or complex room?              │ │ │
│  │  │    [+ Add Section]                               │ │ │
│  │  └──────────────────────────────────────────────────┘ │ │
│  │                                                        │ │
│  │  (Visible only if >1 section exists:)                 │ │
│  │  SECTIONS                                              │ │
│  │  [Main Area     ▼]  [Delete Section]                  │ │
│  │  X: [0__]  Y: [0__]  W: [300]  H: [400]               │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
│              [→ Continue to Planning]                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### Key UX Improvements

1. **No collapsible cards** - Everything visible, no hunting
2. **Inline actions** - Add/Delete buttons next to dropdowns
3. **Direct dimension input** - Width × Length visible immediately
4. **Progressive disclosure** - Section list only when needed (>1 section)
5. **Visual flow** - Arrow indicates progression Floor → Room
6. **Clear next step** - "Continue to Planning" button
7. **Helpful hints** - Inline tips for advanced features

#### Implementation Tasks

1. Add settings burger menu to header
2. Create settings dropdown with Save/Load/Import/Export/Reset/Debug
3. Restructure Setup HTML to single-column flow
4. Implement inline add/delete controls
5. Show room dimensions directly (synced with first section)
6. Progressive disclosure for multi-section management
7. Add "Continue to Planning" navigation button
8. Update CSS for new layout
9. Update i18n for new strings

### Implementation Complete

#### Changes Made

1. **Header Settings Menu (☰)**
   - Added hamburger button in topbar right
   - Dropdown with Save, Load, Export, Import, Reset options
   - Click-outside to close behavior
   - Proper animations and styling

2. **Simplified Setup Flow**
   - Single-column centered layout (max-width 560px)
   - Two numbered blocks: Floor (1) and Room (2)
   - Inline add/delete buttons next to dropdowns
   - Direct Width × Length inputs for room dimensions
   - Syncs with first section automatically
   - "Continue to Planning" button at bottom

3. **Progressive Disclosure for Sections**
   - Hint box shown by default: "Need an L-shape?"
   - Sections panel only appears when >1 section exists
   - Clean section property grid (X, Y, W, H)

4. **Removed from Setup**
   - All collapsible cards
   - Save/Load/Import/Export cards (moved to menu)
   - Danger Zone card (moved to menu)

5. **New CSS Classes**
   - `.setup-flow`, `.setup-block`, `.setup-block-header`
   - `.inline-select-row`, `.btn-inline`
   - `.dimensions-row`, `.dimensions-x`
   - `.sections-hint`, `.sections-panel`, `.btn-text`
   - `.settings-dropdown`, `.settings-item`

6. **New i18n Keys**
   - `setup.*` (floorTitle, roomTitle, width, length, complexRoomHint, continuePlanning)
   - `settings.*` (save, load, export, import, reset)

### Status
- All 373 tests pass
- Build successful
- Ready for user testing

---

## Session: UX Overhaul - Step 3: Planning Tab (2026-01-29)

### Goal
Improve the Planning tab with easy controls, clear flow, and maximized preview space.

### Current Problems Identified

| Problem | Impact |
|---------|--------|
| 5 collapsible cards in sidebar | Fragmented, same issue as old Setup |
| Fixed 340px sidebar | Takes space from preview, not responsive |
| Most controls hidden by default | User must expand cards to find options |
| No room context | User doesn't know which room they're planning |
| Metrics buried at bottom | Easy to miss important calculations |
| Advanced options prominent | Origin, offset, kerf mixed with basics |
| Exclusions workflow complex | Add → Select → Edit properties = many steps |

### Current Structure
```
┌──────────────────────────────────────────────────────────────────┐
│ SIDEBAR (340px fixed)          │  PREVIEW                       │
│ ┌────────────────────────────┐ │  ┌─────────────────────────────┐│
│ │ ▼ Tiles & Grout           │ │  │ [Warnings]                  ││
│ │   Reference, Shape, Size  │ │  │                             ││
│ │   Grout, Kerf             │ │  │ Plan Title        [⛶]      ││
│ └────────────────────────────┘ │  │ ┌─────────────────────────┐││
│ ┌────────────────────────────┐ │  │ │      SVG Preview        │││
│ │ ▶ Tile Layout (hidden)    │ │  │ │                         │││
│ └────────────────────────────┘ │  │ │  [Grid][Skirting][Remove]│││
│ ┌────────────────────────────┐ │  │ └─────────────────────────┘││
│ │ ▶ Skirting (hidden)       │ │  │                             ││
│ └────────────────────────────┘ │  │ [Tip section]              ││
│ ┌────────────────────────────┐ │  │                             ││
│ │ ▶ Exclusions (hidden)     │ │  │ ┌─────────────────────────┐││
│ └────────────────────────────┘ │  │ │ METRICS (at bottom)     │││
│ ┌────────────────────────────┐ │  │ │ Area, Tiles, Packs...   │││
│ │ ▶ Price & Waste (hidden)  │ │  └─────────────────────────────┘│
│ └────────────────────────────┘ │                                │
└──────────────────────────────────────────────────────────────────┘
```

### Proposed Plan

#### New Layout: Preview-First with Slide-Out Panel

```
┌──────────────────────────────────────────────────────────────────┐
│  PLANNING                                                        │
│  Room: [Bathroom ▼]                      [Area: 12.5m²] [⚙️] [⛶]│
├──────────────────────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────────────────────────┐ │
│ │                                                              │ │
│ │                     SVG PREVIEW (FULL WIDTH)                 │ │
│ │                                                              │ │
│ │  ┌─────────────────────────────────────────────────────────┐ │ │
│ │  │ QUICK CONTROLS (floating bottom)                        │ │ │
│ │  │ Tile: [30×60cm] Pattern: [Grid ▼] Grout: [0.3cm]       │ │ │
│ │  │ [Grid] [Skirting] [Removal] [+ Exclusion]              │ │ │
│ │  └─────────────────────────────────────────────────────────┘ │ │
│ └──────────────────────────────────────────────────────────────┘ │
│                                                                  │
│ ┌──────────────────────────────────────────────────────────────┐ │
│ │ METRICS BAR                                                  │ │
│ │ Tiles: 125 (98 full, 27 cut) │ Packs: 8 │ Cost: €245.00    │ │
│ └──────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘

   [⚙️ Settings] opens slide-out panel from right:
   ┌─────────────────────────────┐
   │ TILE SETTINGS              │
   │ Reference: [___________]   │
   │ Shape: [Rectangular ▼]     │
   │ Width: [30] × Height: [60] │
   │ Grout: [0.3] Color: [■]    │
   │                            │
   │ PATTERN                    │
   │ Type: [Grid ▼]             │
   │ Rotation: [0° ▼]           │
   │ ▶ Advanced (Origin/Offset) │
   │                            │
   │ SKIRTING                   │
   │ Height: [8] cm             │
   │ Type: [Self-cut ▼]         │
   │                            │
   │ EXCLUSIONS                 │
   │ [Toilet] [Drain] [+]       │
   │                            │
   │ CALCULATION                │
   │ Reserve: [2] tiles         │
   │ ☑ Allow rotation           │
   └─────────────────────────────┘
```

#### Key Improvements

| Before | After |
|--------|-------|
| Fixed sidebar takes 340px | Full-width preview |
| 5 collapsible cards | Quick controls + slide-out panel |
| No room selector | Room dropdown at top |
| Metrics at bottom | Metrics bar always visible |
| Exclusions buried | Quick add from toolbar |
| Advanced mixed with basic | Progressive disclosure |

#### Quick Controls Bar (Always Visible)

Essential controls floating at bottom of preview:
- **Tile size** display (click to edit)
- **Pattern** dropdown
- **Grout** width
- **Toggle buttons**: Grid, Skirting, Removal Mode
- **Add Exclusion** button

#### Slide-Out Settings Panel

Opened via ⚙️ button, contains all detailed settings:
- Tile configuration (reference, shape, dimensions, grout color)
- Pattern settings (type, rotation, advanced origin/offset)
- Skirting configuration
- Exclusions list with inline edit
- Calculation options (reserve, rotation, optimization)

#### Metrics Bar

Horizontal bar below preview showing key numbers:
- Total tiles (full + cut)
- Packs needed
- Total cost
- Expandable for detailed breakdown

#### Implementation Tasks

1. Remove sidebar, make preview full-width ✓
2. Add room selector to Planning header ✓
3. Create floating quick controls bar ✓
4. Implement slide-out settings panel ✓
5. Create horizontal metrics bar ✓
6. Move exclusion add to toolbar ✓
7. Progressive disclosure for advanced options ✓
8. Update CSS for new layout ✓
9. Update i18n for new strings ✓

### Implementation Complete

#### Changes Made

1. **New Full-Width Preview Layout**
   - Removed fixed 340px sidebar
   - SVG preview now takes full width
   - Cleaner, more focused view

2. **Planning Header**
   - Room selector dropdown (switches room in real-time)
   - Area display (calculated from sections)
   - Settings button (opens slide-out panel)
   - Fullscreen button
   - Mini warnings indicator

3. **Quick Controls Bar (Floating)**
   - Tile size inputs (W × H cm)
   - Pattern dropdown (Grid, Running Bond, Herringbone, etc.)
   - Grout width input
   - Toggle buttons: Grid, Skirting, Removal Mode
   - Quick Add Exclusion button
   - Semi-transparent backdrop, centered at bottom

4. **Metrics Bar (Always Visible)**
   - Horizontal bar below preview
   - Shows: Area, Tiles (with cut count), Packs, Cost, Waste
   - Cost highlighted with accent color

5. **Slide-Out Settings Panel**
   - Opens from right side
   - Organized sections: Tiles & Grout, Pattern & Layout, Skirting, Exclusions, Calculation
   - Advanced options in collapsible details (Origin & Offset)
   - Close on click outside or X button

6. **New CSS Classes**
   - `.planning-fullwidth`, `.planning-header`
   - `.quick-controls`, `.quick-control-group`, `.quick-toggle`
   - `.metrics-bar`, `.metrics-bar-item`
   - `.settings-panel`, `.panel-section`, `.panel-fields`

7. **New i18n Keys**
   - `planning.*` (tile, settings, advanced)

### Status
- All 373 tests pass
- Build successful
- Ready for user testing

---

## Session: Logo & Favicon Integration (2026-01-28)
### Goal
- Integrate the TilePerfect logo and update the application favicon.

### Plan
1. Create branch `feature/logo-integration` ✓
2. Update favicon in `index.html` ✓
3. Add Logo to Topbar in `index.html` ✓
4. Add CSS styling for the logo in `src/style.css` ✓
5. Verify changes with build and test ✓

### Status
- Favicon updated to TilePerfect branding.
- Logo added to the header next to the app title.
- Branding consistently applied across the app.

## Session Notes

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

## Session: Project Summary (2026-01-28)
### Goal
- Implement project-wide calculation summary across all floors and rooms.
- Display total material needs (tiles, area, packs) and costs in the UI.

### Plan
1. Create feature branch `feature/project-summary` ✓
2. Implement `computeProjectTotals(state)` in `src/calc.js` ✓
3. Update `src/calc.js` to support room-specific calculations via `roomOverride` ✓
4. Update `src/geometry.js` to support room-specific tile generation via `roomOverride` ✓
5. Update `index.html` to add a Project Summary section to the metrics panel ✓
6. Update `src/render.js` to populate the Project Summary UI ✓
7. Add translations for project summary fields in `src/i18n.js` ✓
8. Verify with multi-room tests and full build ✓

### Status
- Project-wide totals now available in the right sidebar when more than one room exists.
- Calculations correctly aggregate floor and skirting needs across all floors and rooms.
- `tilesForPreview` and related geometry functions refactored to support non-global state lookups while maintaining backward compatibility.
- All 372 tests pass, and production build is successful.

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

## Session: Removal Mode Broken (2026-01-30)
### Goal
- Restore removal mode toggle and click-to-exclude for tiles and skirting.

### Branch
`feature-fix-removal-mode`

### Plan
1. Wire removal mode toggle to update state directly
2. Bind removal click handling on the SVG in pointerdown
3. Add a small test for the toggle/click flow

### Status
- Complete
- `npm test` and `npm run build` successful
- `npm run dev` started successfully

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

## Session: Main Window Tabs (2026-01-28)
### Goal
- Relocate "Commercial" view from sidebar to main window.
- Introduce top-level tabs in the viewer area to switch between "Plan" and "Commercial".

### Plan
1. Create feature branch `feature/main-window-tabs` ✓
2. Refactor `index.html` to move Commercial content and add main tabs ✓
3. Implement `initMainTabs` in `src/tabs.js` ✓
4. Add styling for Integrated Header Tabs (Variant 1) in `src/style.css` ✓
5. Update `src/main.js` to initialize the new tab controller ✓
6. Verify with tests and build ✓

### Status
- Main window now features a top-level navigation bar for "Plan" and "Commercial".
- "Commercial" view is now in the center area, providing more space for detailed tables.
- Sidebar is simplified by removing the "Commercial" tab.
- All 372 tests pass and production build is successful.

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

## Session: Fix Herringbone Removal Animation (2026-01-27)
### Goal
- Fix missing removal animation (CSS transitions) for herringbone patterns.
- Ensure UI/UX consistency for Removal Mode across all pattern types.

### Plan
1. Create feature branch `fix/herringbone-removal-animation` ✓
2. Audit pattern generators in `src/geometry.js` for `excluded` flag support ✓
3. Fix `herringbone`, `doubleHerringbone`, `basketweave`, and `vsa` generators ✓
4. Verify `renderPlanSvg` correctly applies styling based on `excluded` flag ✓
5. Add automated tests for removal mode consistency across patterns ✓
6. Verify with full test suite and build ✓

### Status
- All pattern generators now properly return `excluded: true` and include `data-tileid` in Removal Mode.
- Fixed a bug where herringbone and other advanced patterns would not show removal styling or transitions.
- Added `src/removal_patterns.test.js` to prevent future regressions.
- All 369 tests pass and build is successful.

## Session: Tile Reference Consolidation (2026-01-28)
### Goal
- Enable picking from existing tile references in room configuration.
- Consolidate material requirements for the same tile across multiple rooms in the Commercial summary.
- Sync tile properties (dimensions, shape) when reusing references to ensure consistency.

### Plan
1. Create feature branch `feature/referenced-tiles-consolidation` ✓
2. Implement "Tile Reference Picker" with `<datalist>` in `index.html` ✓
3. Implement `renderReferencePicker` in `src/render.js` to populate existing references ✓
4. Enhance `src/ui.js` to sync tile properties (dimensions, shape) when a reference is selected or changed ✓
5. Verify consolidation of tiles and skirting material in Commercial view ✓
6. Add automated tests in `src/consolidation.test.js` ✓
7. Verify all tests pass and production build is successful ✓

### Status
- Tile Reference field now supports picking from existing project materials via a dropdown.
- Selecting an existing reference automatically syncs tile width, height, and shape to maintain project-wide consistency.
- Commercial summary correctly aggregates material needs (including floor tiles and skirting cutouts) for consolidated items.
- All 375 tests pass and build is successful.

## Commands Run
- npm run test
- npm run build
- git checkout -b feature/referenced-tiles-consolidation
- npx vitest run src/consolidation.test.js

## Session: Update Development Guidelines (2026-01-28)
### Goal
- Add a new rule to the development guidelines requiring user confirmation of the plan before coding begins.

### Plan
1. Update `.junie/guidelines.md` to include the "Plan Confirmation" rule ✓

### Status
- Added "Planning & Approval" section to `.junie/guidelines.md`.
- New rule: "Do not start coding before the user confirms that the plan is solid and an agreement has been reached."

## Session: Commercial Table Labels Fix (2026-01-28)
### Goal
- Resolve missing labels and raw translation keys in the commercial table.

### Plan
1. Update `src/i18n.js` with missing translation keys ✓
2. Update `src/render.js` to use translated labels in `renderCommercialTab` ✓
3. Add smoke test in `src/render_smoke.test.js` ✓
4. Verify with all tests and build ✓

### Status
- Commercial table now correctly displays translated labels instead of raw keys.
- Added translation keys for "totalTiles", "grandTotal", and "defaultMaterial".
- All 376 tests pass.
## Session: Skirting Cutout Uses Long Side (2026-01-30)
### Goal
- Ensure cutout skirting always uses the tile’s long side for strip length and the short side for strip count.

### Branch
`feature-skirting-cutout-long-side`

### Plan
1. Update cutout skirting length to use max(tile width, height)
2. Update strips-per-tile to use min(tile width, height), capped at 2
3. Keep bought skirting logic unchanged
4. Add tests for 60×30 @ 6cm (2 strips) and 28×11 @ 6cm (1 strip)

### Status
- Complete
- `npm test` and `npm run build` successful
- `npm run dev` started successfully

## Session: Skirting Default Cutout (2026-01-30)
### Goal
- Make self-cut (cutout) skirting the default when type is missing or empty.

### Branch
`feature-skirting-default-cutout`

### Plan
1. Default skirting type to "cutout" in state normalization/migrations
2. Treat empty/unknown skirting type as "cutout" on UI commits
3. Add a test to lock the default behavior

### Status
- Complete
- `npm test` and `npm run build` successful
- `npm run dev` started successfully

## Session: Default Standard Tile Preset (2026-01-30)
### Goal
- Add a built-in "Standard" tile preset and reference it by default to allow cutout skirting in a fresh project.

### Branch
`feature-skirting-default-cutout`

### Plan
1. Add a "Standard" preset to default state
2. Set default room tile reference to "Standard"
3. Add a test for the default preset/reference

### Status
- Complete
- `npm test` and `npm run build` successful
- `npm run dev` started successfully

## Session: Room Skirting Toggle (2026-01-30)
### Goal
- Make the per-room skirting toggle affect room perimeter skirting while keeping exclusion skirting intact.

### Branch
`feature-room-skirting-toggle`

### Plan
1. Skip room sections when room.skirting.enabled is false
2. Keep exclusion skirting independent
3. Add a test for room toggle behavior

### Status
- Complete
- `npm test` and `npm run build` successful
- `npm run dev` started successfully

## Session: Commercial Packs Split (2026-01-30)
### Goal
- Show packs used for flooring vs skirting in the commercial summary.

### Branch
`feature-commercial-skirting-packs`

### Plan
1. Split floor vs skirting tiles/area/packs in totals
2. Aggregate split packs per material
3. Add columns to commercial materials table
4. Add tests for the split

### Status
- Complete
- `npm test` and `npm run build` successful
- `npm run dev` started successfully

## Session: Default Skirting Enabled & Presets (2026-01-30)
### Goal
- On reset, enable room skirting, keep cutout type, and include a default store-bought skirting preset (60×6).

### Branch
`feature-default-skirting-presets`

### Plan
1. Enable skirting by default in initial room state
2. Add a default skirting preset (60 cm length, 6 cm height)
3. Add tests for default skirting enabled and preset presence

### Status
- Complete
- `npm test` and `npm run build` successful
- `npm run dev` started successfully

## Session: Auto Switch Back to Cutout (2026-01-30)
### Goal
- When a tile preset is re-enabled for skirting, rooms using it switch back to cutout.

### Branch
`feature-cutout-switch-back`

### Plan
1. Update tile preset commit to flip skirting.type back to cutout for affected rooms
2. Add a test for the switch-back behavior

### Status
- Complete
- `npm test` and `npm run build` successful
- `npm run dev` started successfully
