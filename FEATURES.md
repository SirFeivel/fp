# TilePerfect Features List

Comprehensive list of all functionalities offered by the TilePerfect floor planning application.

### 1. Project & Session Management
- **Multi-Floor & Multi-Room Support**: Organize layouts across multiple floors and rooms within a single project.
- **Persistent State**: Automated session saving to `localStorage` ensures progress is not lost on reload.
- **Undo/Redo System**: Robust action history allowing users to revert and re-apply changes (Ctrl+Z / Ctrl+Y).
- **Project Persistence**: 
  - Save named projects to local browser storage.
  - Load previously saved projects.
  - Delete projects from local storage.
- **Data Portability**: 
  - **JSON Export**: Export the entire project state to a file.
  - **JSON Import**: Load a project state from an exported file.
- **Session Reset**: Clear all current data to start a fresh project.
- **Autosave Indicator**: Visual feedback on the current save status.

### 2. Room Geometry & Building
- **Unified Building UI**: Centralized management of floors and rooms.
- **Section-Based Geometry**: Build complex room shapes (L-shape, T-shape, U-shape, etc.) by combining multiple rectangular sections.
- **Coordinate System**: Precise positioning of sections using X/Y coordinates in centimeters (CM).
- **Auto-Naming**: Intelligent default naming for new floors and rooms.
- **Dynamic Polygon Composition**: Real-time merging of sections into a single room polygon using `polygon-clipping`.

### 3. Layout Planning (Tiles & Patterns)
- **Multi-Shape Tile Support**:
  - Rectangular tiles.
  - Hexagonal tiles.
- **Flexible Pattern Generators**:
  - **Grid**: Standard alignment.
  - **Bond/Running Bond**: Staggered tiles with adjustable offset fraction (e.g., 1/2, 1/3).
  - **Herringbone**: Single herringbone pattern (requires specific tile length/width ratio).
  - **Double Herringbone**: Enhanced herringbone pattern.
  - **Basketweave**: Classic basketweave pattern.
- **Pattern Customization**:
  - **Rotation**: Rotate the entire tile layout by any degree.
  - **Offset/Origin**: Fine-tune the starting position of the tile pattern (X/Y offset).
  - **Preset Origins**: Quickly snap the pattern start to Top-Left, Center, etc.
- **Grout Management**:
  - Adjustable grout width.
  - Custom grout color selection (hex).
- **Manual Tile Exclusion**: Click-to-remove individual tiles from the plan (e.g., for visual customization or avoiding specific areas).

### 4. Obstacles & Exclusions
- **Exclusion Zones**: Add rectangular or circular (approximated) cutouts for obstacles like columns, pipes, or fixed furniture.
- **Skirting Toggles**: Independently enable or disable skirting for each exclusion zone and room section.
- **Visual Feedback**: Exclusions are rendered as holes in the floor plan.

### 5. Skirting Boards
- **Skirting Types**:
  - **Self-Made**: Calculated as strips cut from the chosen tiles (outer edges).
  - **Bought**: Ready-made skirting boards purchased per piece.
- **Smart Corner Handling**: Skirting segments correctly break at corners and vertices for accurate visualization and calculation.
- **Visual Toggle**: Option to show or hide skirting in the preview.
- **Exclusion Integration**: Manually remove specific skirting segments.

### 6. Calculations & Commercials
- **Material Requirements**:
  - Total area (m²) and net area (minus holes/exclusions).
  - Precise tile count (full tiles + cut pieces).
  - Number of packs required (based on m²/pack or pieces/pack).
- **Waste Calculation**:
  - Smart waste estimation via **Offcut Pool** (simulates reusing cut tile pieces).
  - Adjustable "Allow Rotation" for offcut reuse logic.
  - Display of waste percentage.
- **Pricing & Budgeting**:
  - Price per m² or per piece for tiles.
  - Grout cost calculation based on bag weight, price, and coverage.
  - Skirting cost (piece-based or tile-sacrifice-based).
- **Project Summary**: Consolidated totals (area, cost, materials) across all floors and rooms.
- **Metric Panels**: Real-time updates of area, tiles, packs, cost, and waste.

### 7. UI & UX Features
- **Three-Stage Stepper**: Guided workflow through **Setup**, **Planning**, and **Commercial** phases.
- **Interactive SVG Preview**:
  - Real-time rendering of the floor plan.
  - Zoom and pan capabilities (via mouse/touch).
  - Visual grid toggle.
- **Internationalization (i18n)**: Fully localized UI in German (DE) and English (EN).
- **Validation Engine**: 
  - Real-time error and warning detection.
  - Specific validation for pattern-tile ratio requirements (e.g., for Herringbone).
- **Responsive Sidebar**: Collapsible cards and sections for better workspace management.
- **Collapsible Layout**: Panels can be collapsed to maximize the preview area.

### 8. Internal & Technical Features
- **V2-V5 Schema Migration**: Automatic state migration to ensure backward compatibility with older saved projects.
- **Polygon Clipping Pipeline**: Advanced geometry handling for room union and exclusion subtraction.
- **Offcut Optimization Logic**: Algorithmic approach to minimize material waste by tracking usable tile scraps.
- **Functional Geometry Core**: Side-effect-free geometry and calculation logic for high reliability and testability.
- **Event-Driven UI**: Syncing of state changes with the DOM via a centralized `store.commit` pattern.
- **SVG Utility Library**: Custom helpers for generating SVG elements and path data.
- **Sanitization**: Robust input sanitization to prevent invalid numeric states.
