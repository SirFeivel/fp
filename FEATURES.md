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
- **Autosave Indicator**: Visual feedback on the current save status with last-saved timestamp.

### 2. Room Geometry & Building
- **Unified Building UI**: Centralized management of floors and rooms.
- **Flexible Room Creation**:
  - Rectangular rooms (legacy mode).
  - Complex shapes via section composition (L/T/U shapes, etc.).
  - **Freeform Drawing**: Click vertices to draw custom room polygons.
- **Section-Based Geometry**: Build complex room shapes by combining multiple rectangular sections.
- **Freeform Room Drawing**:
  - Click-to-draw custom polygon rooms.
  - Grid snapping (0.5cm increments).
  - Vertex snapping (2cm detection radius).
  - Edge snapping (2cm detection radius).
- **Coordinate System**: Precise positioning of sections using X/Y coordinates in centimeters (CM).
- **Auto-Naming**: Intelligent default naming for new floors and rooms.
- **Dynamic Polygon Composition**: Real-time merging of sections into a single room polygon using `polygon-clipping`.

### 3. Floor View & Layout
- **Visual Floor Editor**: Interactive layout editor for positioning rooms on a floor.
- **Room Positioning**: Drag-and-drop rooms to arrange floor layout with overlap prevention.
- **Background Image Support**:
  - Upload floor plan images for reference.
  - Multi-step calibration UI to set image scale.
- **Dimension Labels**: Editable room dimension overlays.
- **Geometry Validation**: Floor connectivity checking (10cm minimum shared wall).
- **Snapping**: Smart room placement with edge snapping.
- **Free Edge Detection**: Suggests room placement on available edges.
- **Bottom Bar Controls**: Quick access to add rectangular rooms, draw freeform rooms, and delete rooms.

### 4. Tile Pattern Groups
- **Group Adjacent Rooms**: Link rooms to share continuous tile patterns across boundaries.
- **Origin Room Concept**: One room drives the pattern for all group members.
- **Smart Connectivity**: Validates rooms are properly adjacent (10cm+ shared wall).
- **Pattern Inheritance**: Child rooms automatically adopt pattern settings from origin.
- **Group Management**:
  - Create and dissolve groups.
  - Change origin room.
  - Add or remove members.
  - Disconnected room warnings.
- **Restrictions**: Child rooms cannot edit tile settings directly; must edit in origin room.
- **Visual Indication**: Group selector in planning header with member badges.

### 5. Layout Planning (Tiles & Patterns)
- **Multi-Shape Tile Support**:
  - Rectangular tiles.
  - Square tiles.
  - Hexagonal tiles (with auto-height calculation).
  - Rhombus tiles.
- **Flexible Pattern Generators**:
  - **Grid**: Standard alignment.
  - **Bond/Running Bond**: Staggered tiles with adjustable offset fraction (e.g., 1/2, 1/3).
  - **Herringbone**: Single herringbone pattern (requires specific tile length/width ratio).
  - **Double Herringbone**: Enhanced herringbone pattern.
  - **Basketweave**: Classic basketweave pattern.
  - **Vertical Stack Alternating**: Alternating vertical stack pattern.
- **Pattern Customization**:
  - **Rotation**: Rotate the entire tile layout (0-360°, 45° step increments).
  - **Offset/Origin**: Fine-tune the starting position of the tile pattern (X/Y offset).
  - **Preset Origins**: Quickly snap the pattern start to Top-Left, Center, Top-Right, Bottom-Left, or Bottom-Right.
- **Grout Management**:
  - Adjustable grout width (mm).
  - Custom grout color selection (hex picker).
- **Tile Presets**: Save and load tile configurations for reuse across rooms.
- **Manual Tile Exclusion**: Click-to-remove individual tiles from the plan (removal mode).

### 6. Obstacles & Exclusions
- **Exclusion Zones**: Add rectangular, circular, or triangular cutouts for obstacles like columns, pipes, or fixed furniture.
- **Skirting Toggles**: Independently enable or disable skirting for each exclusion zone and room section.
- **Visual Feedback**: Exclusions are rendered as holes in the floor plan.
- **Drag & Resize**: Interactively adjust exclusion positions and sizes.
- **Labels**: Name exclusions for reference.

### 7. Skirting Boards
- **Skirting Types**:
  - **Self-Made**: Calculated as strips cut from the chosen tiles (outer edges).
  - **Bought**: Ready-made skirting boards purchased per piece.
- **Smart Corner Handling**: Skirting segments correctly break at corners and vertices for accurate visualization and calculation.
- **Visual Toggle**: Option to show or hide skirting in the preview.
- **Exclusion Integration**: Manually remove specific skirting segments.
- **Per-Room/Section Control**: Enable or disable skirting independently per room or section.
- **Skirting Presets**: Save and load skirting configurations for reuse.
- **Height Management**: Configurable height for self-made skirting.

### 8. Calculations & Commercials
- **Material Requirements**:
  - Total area (m²) and net area (minus holes/exclusions).
  - Precise tile count (full tiles + cut pieces).
  - Number of packs required (based on m²/pack or pieces/pack).
- **Waste Calculation**:
  - Smart waste estimation via **Offcut Pool** (simulates reusing cut tile pieces).
  - Guillotine cutting algorithm for offcut reuse.
  - Adjustable "Allow Rotation" for offcut reuse logic.
  - Display of waste percentage.
  - Share offcuts toggle to pool offcuts across rooms.
- **Pricing & Budgeting**:
  - Price per m² or per piece for tiles.
  - Grout cost calculation based on bag weight, price, and coverage.
  - Skirting cost (piece-based or tile-sacrifice-based).
- **Kerf Width**: Configurable cutting width for accurate waste calculation.
- **Reserve Tiles**: Add buffer tiles to order quantity.
- **Project Summary**: Consolidated totals (area, cost, materials) across all floors and rooms.
- **Floor Metrics**: Per-floor calculation aggregation.
- **Metric Panels**: Real-time updates of area, tiles, packs, cost, and waste.

### 9. Export Features
- **PDF Exports**:
  - Room plans PDF (per-room with tiles, exclusions, skirting).
  - Commercial summary PDF (tables, costs, materials).
  - Multiple rooms in a single PDF.
  - Configurable page size (A4, Letter, etc.) and orientation.
  - Scale options (fit-to-page, custom).
  - Optional grid, skirting, exclusions, legend, metrics.
  - Notes/annotations per room.
- **Excel Export**:
  - Commercial summary with multiple sheets:
    - Intro (assumptions, methodology).
    - Rooms (per-room calculations).
    - Materials (aggregated).
    - Skirting (per-room breakdown).
    - Summary (totals).
  - Formula-based Excel cells for live recalculation.
- **SVG Export**: Export floor plans as SVG files.
- **Selection UI**: Choose specific rooms to export.
- **Export Progress**: Real-time feedback on multi-room export.

### 10. UI & UX Features
- **Four-Tab Workflow**: Guided workflow through **Setup**, **Planning**, **Commercial**, and **Export** phases.
- **Planning View Modes**:
  - Floor view (room layout).
  - Room view (tile pattern planning).
- **Interactive SVG Preview**:
  - Real-time rendering of the floor plan.
  - Zoom and pan capabilities (via mouse/touch).
  - Visual grid toggle.
  - Fullscreen mode for expanded preview.
- **Quick View Toggles**: Fast access to display options (grid, skirting, tiles).
- **Custom Modal Dialogs**: Non-native confirm/alert/prompt/select dialogs with consistent styling.
- **Internationalization (i18n)**: Fully localized UI in German (DE) and English (EN) with 1200+ translation keys.
- **Validation Engine**:
  - Real-time error and warning detection.
  - Specific validation for pattern-tile ratio requirements (e.g., for Herringbone).
- **Responsive Sidebar**: Collapsible cards and sections for better workspace management.
- **Collapsible Layout**: Panels can be collapsed to maximize the preview area.
- **Undo Counter**: Visual display of undo/redo stack state.

### 11. Internal & Technical Features
- **V2-V5 Schema Migration**: Automatic state migration to ensure backward compatibility with older saved projects.
- **Polygon Clipping Pipeline**: Advanced geometry handling for room union and exclusion subtraction.
- **Multipolygon Support**: Handles non-convex and complex room geometries.
- **Offcut Optimization Logic**: Algorithmic approach to minimize material waste by tracking usable tile scraps.
- **Functional Geometry Core**: Side-effect-free geometry and calculation logic for high reliability and testability.
- **Event-Driven UI**: Syncing of state changes with the DOM via a centralized `store.commit` pattern.
- **SVG Utility Library**: Custom helpers for generating SVG elements and path data.
- **Sanitization**: Robust input sanitization to prevent invalid numeric states.
- **Comprehensive Test Suite**: 20+ test suites covering geometry, calculations, drag interactions, exports, and state management.
