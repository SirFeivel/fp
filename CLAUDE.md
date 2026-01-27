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
