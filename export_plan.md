# Export Tab Plan (PDF + Excel) — Deep Technical Plan

## Goal
Add a new **Export** tab that allows:
- PDF export of selected room plans (multi-page PDF)
- Commercial summary export as PDF
- Commercial summary export as Excel (XLSX)

PDFs should look like standard construction plans: clear technical header, centered plan, legend + notes.

---

## Decisions (from user)
- PDF library: **jsPDF + svg2pdf.js** (free, stable, performant)
- Room selection: user picks rooms; export is **multi-page PDF**
- Plan PDFs include all relevant info for craftsmen/engineers
- Commercial PDF includes **summary cards + tables**
- Excel: **room-by-room sheets + summary sheet**

---

## Dependency Evaluation Matrix (Why these libraries)

### jsPDF
- Pros: stable, fully client-side, big ecosystem, good table support
- Cons: manual layout work required
- Fit: strong for custom page layout

### svg2pdf.js
- Pros: vector export preserves sharpness, no raster blur
- Cons: can fail on complex SVGs or unsupported features
- Fit: best for plan line precision

### xlsx (SheetJS community)
- Pros: stable, widely used, easy XLSX creation
- Cons: large bundle; import carefully
- Fit: best for supplier-facing XLSX

Fallback: If svg2pdf fails, rasterize SVG to PNG and embed in jsPDF.

---

## File-Level Architecture Changes

### 1) UI / Layout
**File:** `index.html`
- Add new top-level main tab: `Export`
  - Tab button: `data-main-tab="export"`
  - Panel: `<section class="main-panel" data-main-panel="export">`
- Export panel layout:
  - Section A: **Room Plans (PDF)**
  - Section B: **Commercial (PDF / Excel)**
- Suggested DOM IDs:
  - Room list: `exportRoomsList`
  - Select all: `exportSelectAllRooms`
  - Clear: `exportClearRooms`
  - Page size: `exportPageSize` (A4/A3)
  - Orientation: `exportOrientation` (portrait/landscape)
  - Scale: `exportScale` (fit/1:20/1:50/1:100)
  - Include toggles:
    - `exportIncludeGrid`
    - `exportIncludeSkirting`
    - `exportIncludeExclusions`
    - `exportIncludeLegend`
    - `exportIncludeMetrics`
  - Notes: `exportNotes`
  - Buttons:
    - `btnExportRoomsPdf`
    - `btnExportCommercialPdf`
    - `btnExportCommercialXlsx`

**File:** `src/style.css`
- Export tab styles
  - Two-column layout on wide screens
  - Single-column on narrow screens
  - Room list grouped by floor with subtle separators
  - Footer info row for export status / warnings

---

### 2) Tabs / Navigation
**File:** `src/tabs.js`
- Add Export to main tab controller
- Keep localStorage persistence consistent (`mainTab`)
- Ensure `data-main-panel="export"` switches correctly
- Update tab migration logic if needed

---

### 3) Render Layer
**File:** `src/render.js`
- `renderExportTab(state)`:
  - Build room list grouped by floor
  - Default selection: all rooms checked
  - Disable export buttons if no rooms exist
  - Populate default export options
- `renderExportRoomList(state)`:
  - Reusable helper for re-rendering on state changes

---

### 4) UI Wiring
**File:** `src/ui.js`
- `getExportOptionsFromUi()`:
  - Extract page size, orientation, scale
  - Extract include toggles + notes
  - Selected room IDs
- `bindExportEvents()`:
  - Select all / Clear
  - Export PDF (rooms)
  - Export PDF (commercial)
  - Export XLSX
- `validateExportSelection(roomIds)`:
  - If none selected, show warning and return

---

### 5) New Export Module
**File:** `src/export.js`

#### Public API
- `exportRoomsPdf(state, options)`
- `exportCommercialPdf(state, options)`
- `exportCommercialXlsx(state, options)`

#### Helper Functions
- `buildRoomExportModel(state, roomId)`
  - floor/room name
  - room dimensions + area
  - tile config, grout config, pattern config
  - skirting config
  - computed metrics (tiles/packs/cost)
- `buildCommercialExportModel(state)`
  - summary, materials list, per-room breakdown, skirting summary
- `renderPlanSvgForExport(state, roomId, options)`
  - reuse render logic but remove UI overlays
  - force view options (grid/skirting/exclusions)
- `svgToPdf(doc, svgEl, x, y, width, height)`
  - vector render via svg2pdf
- `svgToPngDataUrl(svgEl, width, height)`
  - raster fallback using canvas
- `layoutRoomPlanPage(doc, model, svg, options)`
  - header block
  - plan block
  - footer block
- `layoutCommercialPdf(doc, model, options)`
  - summary cards + tables

---

## Data Structures (Proposed)

### ExportOptions
```
{
  roomIds: string[],
  pageSize: "A4" | "A3",
  orientation: "portrait" | "landscape",
  scale: "fit" | "1:20" | "1:50" | "1:100",
  includeGrid: boolean,
  includeSkirting: boolean,
  includeExclusions: boolean,
  includeLegend: boolean,
  includeMetrics: boolean,
  notes: string
}
```

### RoomExportModel
```
{
  projectName: string,
  floorName: string,
  roomName: string,
  roomDimensionsCm: { width: number, length: number },
  roomAreaM2: number,
  tile: {
    reference: string,
    shape: string,
    widthCm: number,
    heightCm: number,
    pattern: string
  },
  grout: { widthMm: number, colorHex: string },
  skirting: { enabled: boolean, type: string, heightCm: number },
  metrics: { tiles: number, packs: number, cost: number }
}
```

### CommercialExportModel
```
{
  summary: {...},
  materials: [...],
  rooms: [...],
  skirting: [...]
}
```

---

## PDF Layout Details

### Room Plan PDF (per page)

**Header (Top bar)**
- Project name
- Floor / Room name
- Export date
- Room dimensions (cm + m²)
- Tile config:
  - Reference
  - Size (WxH)
  - Shape
  - Pattern
  - Grout width / color
  - Skirting type + height

**Plan Area (Center)**
- SVG plan scaled to fit printable area
- Optional grid/skirting/exclusions per toggles
- Scale bar at bottom-right (if not fit-to-page)
- Aspect ratio letterboxing if needed

**Footer (Bottom)**
- Legend for skirting + exclusions
- Notes field
- Export timestamp

---

### Commercial PDF

**Summary cards**
- Total area (net/gross)
- Total tiles + packs (floor vs skirting)
- Total cost

**Tables**
- Materials table (reference, pack, qty, unit price, total)
- Room breakdown (room, area, tiles, packs, skirting length)

---

## Excel Export (XLSX)

**Sheets**
1) Summary
2) Materials
3) Rooms
4) Skirting

**Columns**
- Summary: totals, costs, tiles, packs
- Materials: reference, pack size, price per unit, totals
- Rooms: room, area, tiles, packs, skirting length, cost
- Skirting: room, pieces, length, cost

---

## Implementation Steps (Detailed)

1) Add dependencies
   - `npm install jspdf svg2pdf.js xlsx`
2) Add Export tab markup in `index.html`
3) Add Export styles in `src/style.css`
4) Update `src/tabs.js`
5) Create `src/export.js`
6) Add `renderExportTab` in `src/render.js`
7) Wire UI events in `src/ui.js`
8) Add tests:
   - buildRoomExportModel data mapping
   - buildCommercialExportModel data mapping
   - Export tab render smoke test

---

## Pseudo‑Code

### exportRoomsPdf
```
doc = new jsPDF(options.orientation, "pt", options.pageSize)
for roomId in options.roomIds:
  if not first page: doc.addPage()
  model = buildRoomExportModel(state, roomId)
  svg = renderPlanSvgForExport(state, roomId, options)
  layoutRoomPlanPage(doc, model, svg, options)
doc.save(filename)
```

### exportCommercialXlsx
```
model = buildCommercialExportModel(state)
wb = XLSX.utils.book_new()
wb.Sheets["Summary"] = sheetFromSummary(model.summary)
wb.Sheets["Materials"] = sheetFromMaterials(model.materials)
wb.Sheets["Rooms"] = sheetFromRooms(model.rooms)
wb.Sheets["Skirting"] = sheetFromSkirting(model.skirting)
XLSX.writeFile(wb, filename)
```

---

## Risks / Edge Cases
- SVG → PDF vector conversion failures
  - fallback to PNG
- Rooms with no tile preset
  - export anyway, annotate header
- Large rooms vs page size
  - scale to fit, show scale factor
- Large multi-room exports
  - PDF size could grow; consider warnings

---

## Acceptance Criteria
- Export tab visible and functional
- User can select rooms and export multi-page PDF
- Plans include header + plan + footer
- Commercial PDF includes summary cards + tables
- Excel export includes Summary + Materials + Rooms + Skirting
- Works client-side only
