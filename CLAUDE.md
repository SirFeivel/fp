# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

FloorPlanner (fp) is a browser-based tile layout planning tool built with Vite. It visualizes rooms with tile patterns, calculates material requirements, and supports complex room shapes through composite sections. The UI is bilingual (German/English).

## Commands

- `npm run dev` - Start development server
- `npm run build` - Production build to `dist/`
- `npm run test` - Run all tests once
- `npm run test:watch` - Run tests in watch mode
- `npm run test:ui` - Run tests with Vitest UI

## Architecture

### State Management
- **state.js** - Central state store with undo/redo, session persistence (localStorage), and project save/load. State is normalized on load, including migration from v1 to v2 schema.
- **core.js** - Default state factory, utility functions (`uuid`, `deepClone`, `getCurrentRoom`, `getCurrentFloor`), and localStorage keys.

### Geometry Pipeline
- **geometry.js** - Core geometry operations using `polygon-clipping` library:
  - `roomPolygon()` - Builds room shape from sections
  - `computeAvailableArea()` - Subtracts exclusions from room
  - `tilesForPreview()` - Generates clipped tile polygons for rendering
  - Pattern-specific tile generators: `tilesForPreviewHerringbone`, `tilesForPreviewHex`, `tilesForPreviewBasketweave`, etc.
- **composite.js** - Handles composite room shapes (L/T/U) via multiple rectangular sections. `getRoomSections()` returns section list from room.

### Calculation
- **calc.js** - `computePlanMetrics()` calculates tile counts, waste, pricing. Contains `OffcutPool` class for tracking reusable tile remnants with guillotine cutting.

### Rendering
- **render.js** - All DOM rendering functions (`renderPlanSvg`, `renderMetrics`, `renderWarnings`, etc.). SVG rendering uses helper `svgEl()` from geometry.js.

### Controllers
- **exclusions.js** - CRUD for exclusion shapes (rect, circle, triangle)
- **sections.js** - CRUD for room sections
- **structure.js** - Floor/room hierarchy management
- **drag.js** - SVG drag controller for moving exclusions

### UI
- **main.js** - Application entry point, wires controllers, event handlers
- **ui.js** - Binds form inputs to state
- **i18n.js** - Translation system with `t(key)` function

## Data Model

State contains:
- `floors[]` - Array of floors, each with `rooms[]`
- `selectedFloorId`, `selectedRoomId` - Current selection
- Each room has: `widthCm`, `heightCm`, `exclusions[]`, `tile`, `grout`, `pattern`, optional `sections[]`
- `pattern.type`: "grid", "runningBond", "herringbone", "doubleHerringbone", "basketweave", "verticalStackAlternating"
- `tile.shape`: "rect" or "hex"

## Key Patterns

- All state changes go through `store.commit(label, nextState)` for undo support
- Validation runs via `validateState()` before rendering
- Tile placement uses polygon clipping to handle complex room shapes and exclusions
- Dimensions are in centimeters throughout

## Rulebook

These rules are mandatory. When in doubt, question yourself before presenting code.

### Architecture Rules

1. **Use existing APIs.** Before writing conversion logic, coordinate math, or helper code inline, check if a centralized function already exists. If it does, use it. If it almost does, extend it — don't duplicate it with a "local version."
2. **One source of truth.** Every concept (coordinate conversion, geometry computation, state derivation) must live in exactly one place. Other code calls that place. No copies, no "slightly different" variants.
3. **No niche fixes.** If a bug surfaces in one call site, check whether the root cause is in a shared function. Fix the root, not the symptom. A fix that patches one consumer while leaving the broken function intact is wrong.
4. **Correct layer, correct file.** Coordinate math belongs in geometry/walls modules. DOM manipulation belongs in render.js. State mutation belongs in controllers/ui.js behind `store.commit()`. Don't mix layers.
5. **Explicit coordinate spaces.** When working with coordinates, always be clear about which space you're in (room-local, floor-global, wall-space, SVG/screen). Conversions between spaces must go through named functions, never ad-hoc inline math.
6. **Tests reflect real scenarios.** Tests must use realistic data (actual room sizes, actual wall configurations). Don't test only the happy path with trivially simple geometry.

### Anti-Patterns (reject these on sight)

- **Inline reimplementation.** Computing something that a utility function already computes, but "just for this one spot." Always call the function.
- **Guard-clause band-aids.** Adding `if (x < 0) continue` or `Math.max(x, 0)` to hide a value that shouldn't be negative in the first place. Find why it's negative and fix the source.
- **Scope creep in fixes.** A bug fix should fix the bug. Don't refactor surrounding code, add features, or "improve" unrelated things in the same change.
- **Untested assumptions.** "The owner room's direction always matches the wall direction" — prove it or handle both cases. No comments that say "this should always be true."
- **Silent fallbacks.** `|| 0`, `?? {}`, `|| []` that mask broken data instead of surfacing the problem.

### Review Workflow

Before presenting any non-trivial code change, spawn a review subagent (Task tool, Explore type) to verify:
1. Does an existing API already handle this? Am I duplicating logic?
2. Is the fix at the right layer, or am I patching a symptom?
3. Are coordinate spaces explicitly handled through named functions?
4. Would this change surprise someone reading the code for the first time?

If the review finds violations, fix them before presenting. Do not present code with known rulebook violations and a disclaimer — fix it first.
