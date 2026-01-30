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
- Cons: large bundle (~300KB minified)
- Fit: best for supplier-facing XLSX
- **Import strategy**: Use dynamic import `await import('xlsx')` to avoid bloating initial bundle

Fallback: If svg2pdf fails, rasterize SVG to PNG and embed in jsPDF.

---

## Important Considerations

### i18n (Internationalization)
- App is bilingual (German/English). All export labels, PDF headers, table headers must use `t()` from `i18n.js`
- Add translation keys for: export tab labels, PDF headers, column names, status messages
- PDF content language should match current UI language

### Existing Export Button Conflict
- App already has `btnExport` (JSON export) and `fileImport` in settings menu
- Rename existing JSON export to `btnExportJson` or keep separate in settings
- New PDF/XLSX exports live in the Export tab only

### Filename Conventions
- Room PDF: `{projectName}_{floorName}_{roomName}_{date}.pdf` or `{projectName}_rooms_{date}.pdf` for multi-room
- Commercial PDF: `{projectName}_commercial_{date}.pdf`
- Excel: `{projectName}_commercial_{date}.xlsx`
- Sanitize names (remove special chars, spaces → underscores)

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
  - Progress indicator: `exportProgress` (hidden by default)
  - Status message: `exportStatus`
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

**Note:** Keep export render functions minimal in render.js. Complex PDF layout logic belongs in export.js.

---

### 4) UI Wiring
**File:** `src/main.js` (not ui.js, for consistency with existing patterns)
- Wire export button handlers in main IIFE
- `getExportOptionsFromUi()`: Extract all form values
- `validateExportSelection(roomIds)`: Show warning if none selected
- Show/hide progress indicator during export
- Handle errors with user-friendly messages

---

### 5) New Export Module
**File:** `src/export.js`

#### Public API
- `exportRoomsPdf(state, options, onProgress)` - onProgress callback for UI updates
- `exportCommercialPdf(state, options)`
- `exportCommercialXlsx(state, options)`

#### Helper Functions
- `buildRoomExportModel(state, roomId)`
  - Reuse `computePlanMetrics()` from calc.js for metrics
  - Reuse `getRoomPricing()` from calc.js for pricing
  - floor/room name, dimensions, area
  - tile config, grout config, pattern config
  - skirting config
- `buildCommercialExportModel(state)`
  - Reuse `computeProjectTotals()` from calc.js
  - Reuse `computeGrandTotals()` from calc.js
  - Reuse `computeSkirtingNeeds()` from calc.js
  - summary, materials list, per-room breakdown, skirting summary
- `renderPlanSvgForExport(state, roomId, options)`
  - **Create offscreen SVG element** (not visible, not #planSvg)
  - Temporarily modify state.view for grid/skirting toggles
  - Call core render logic
  - Return SVG element, then **clean up** (remove from DOM)
- `svgToPdf(doc, svgEl, x, y, width, height)`
  - Vector render via svg2pdf
  - Wrap in try/catch, return success boolean
- `svgToPngDataUrl(svgEl, width, height)`
  - Raster fallback using canvas
  - Use for retry if svgToPdf fails
- `layoutRoomPlanPage(doc, model, svg, options)`
  - Header block
  - Plan block (centered, aspect-ratio preserved)
  - Scale bar (if not fit-to-page)
  - Footer block
- `layoutCommercialPdf(doc, model, options)`
  - Summary cards + tables
- `sanitizeFilename(name)`
  - Remove special chars, replace spaces with underscores

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

## Scale Bar Implementation

When using fixed scales (1:20, 1:50, 1:100):
- Draw a horizontal line in bottom-right of plan area
- Length represents a round number (e.g., 1m, 50cm)
- Label with actual measurement
- Example at 1:50 scale: 2cm line = 1m real

```
calculateScaleBar(scale, pageWidthPt):
  realMeterInPt = (100 / scale) * 2.83465  // 1cm = 2.83465pt
  // Choose bar length: 1m, 50cm, or 20cm depending on fit
  return { lengthPt, labelText }
```

For "fit" scale: show calculated scale ratio in header instead of scale bar.

---

## i18n Keys to Add

Add to `src/i18n.js`:
```
export.tab: "Export" / "Export"
export.roomPlans: "Room Plans (PDF)" / "Raumpläne (PDF)"
export.commercial: "Commercial Summary" / "Kommerzielle Übersicht"
export.selectAll: "Select All" / "Alle auswählen"
export.clear: "Clear" / "Auswahl aufheben"
export.pageSize: "Page Size" / "Seitengröße"
export.orientation: "Orientation" / "Ausrichtung"
export.portrait: "Portrait" / "Hochformat"
export.landscape: "Landscape" / "Querformat"
export.scale: "Scale" / "Maßstab"
export.fitToPage: "Fit to Page" / "An Seite anpassen"
export.includeGrid: "Include Grid" / "Raster einblenden"
export.includeSkirting: "Include Skirting" / "Sockelleisten einblenden"
export.includeExclusions: "Include Exclusions" / "Aussparungen einblenden"
export.includeLegend: "Include Legend" / "Legende einblenden"
export.includeMetrics: "Include Metrics" / "Maße einblenden"
export.notes: "Notes" / "Anmerkungen"
export.exportPdf: "Export PDF" / "PDF exportieren"
export.exportXlsx: "Export Excel" / "Excel exportieren"
export.exporting: "Exporting..." / "Exportiere..."
export.exportingRoom: "Exporting room {0} of {1}" / "Exportiere Raum {0} von {1}"
export.success: "Export complete" / "Export abgeschlossen"
export.error: "Export failed" / "Export fehlgeschlagen"
export.noRoomsSelected: "No rooms selected" / "Keine Räume ausgewählt"
export.noTileConfigured: "No tile configured" / "Keine Fliese konfiguriert"
pdf.projectName: "Project" / "Projekt"
pdf.floor: "Floor" / "Etage"
pdf.room: "Room" / "Raum"
pdf.dimensions: "Dimensions" / "Abmessungen"
pdf.area: "Area" / "Fläche"
pdf.tile: "Tile" / "Fliese"
pdf.pattern: "Pattern" / "Muster"
pdf.grout: "Grout" / "Fuge"
pdf.skirting: "Skirting" / "Sockelleiste"
pdf.legend: "Legend" / "Legende"
pdf.generatedBy: "Generated by TilePerfect" / "Erstellt mit TilePerfect"
```

---

## Implementation Steps (Detailed)

### Phase 1: Setup & UI
1) Add dependencies
   - `npm install jspdf svg2pdf.js xlsx`
2) Add i18n keys to `src/i18n.js`
3) Add Export tab markup in `index.html`
   - Tab button in main nav
   - Export panel with room list, options, buttons
   - Progress indicator (hidden by default)
4) Add Export styles in `src/style.css`
   - Two-column layout (room list | options)
   - Room list with floor grouping
   - Checkbox styling
   - Progress bar styling
5) Update `src/tabs.js` to include export tab

### Phase 2: Core Export Logic
6) Create `src/export.js`
   - buildRoomExportModel (reuse calc.js functions)
   - buildCommercialExportModel (reuse calc.js functions)
   - renderPlanSvgForExport (offscreen SVG)
   - svgToPdf + svgToPngDataUrl (with fallback)
   - layoutRoomPlanPage
   - layoutCommercialPdf
   - sanitizeFilename

### Phase 3: Integration
7) Add `renderExportTab` in `src/render.js`
8) Wire UI events in `src/main.js`
   - Button handlers
   - Progress updates
   - Error handling
9) Test manually with various room configurations

### Phase 4: Testing
10) Add tests in `src/export.test.js`:
    - buildRoomExportModel data mapping
    - buildCommercialExportModel data mapping
    - sanitizeFilename edge cases
    - (PDF generation hard to unit test; rely on manual testing)

---

## Pseudo‑Code

### exportRoomsPdf
```javascript
async function exportRoomsPdf(state, options, onProgress) {
  const doc = new jsPDF(options.orientation, "pt", options.pageSize);
  const total = options.roomIds.length;

  for (let i = 0; i < total; i++) {
    const roomId = options.roomIds[i];
    onProgress?.({ current: i + 1, total, roomId });

    if (i > 0) doc.addPage();

    const model = buildRoomExportModel(state, roomId);
    const svg = renderPlanSvgForExport(state, roomId, options);

    try {
      await layoutRoomPlanPage(doc, model, svg, options);
    } finally {
      svg.remove(); // Clean up offscreen SVG
    }
  }

  const filename = sanitizeFilename(`${state.project?.name || 'plan'}_rooms_${dateStr()}.pdf`);
  doc.save(filename);
}
```

### exportCommercialXlsx
```javascript
async function exportCommercialXlsx(state, options) {
  const XLSX = await import('xlsx'); // Dynamic import
  const model = buildCommercialExportModel(state);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheetFromSummary(model.summary), t('export.summary'));
  XLSX.utils.book_append_sheet(wb, sheetFromMaterials(model.materials), t('export.materials'));
  XLSX.utils.book_append_sheet(wb, sheetFromRooms(model.rooms), t('export.rooms'));
  XLSX.utils.book_append_sheet(wb, sheetFromSkirting(model.skirting), t('export.skirting'));

  const filename = sanitizeFilename(`${state.project?.name || 'plan'}_commercial_${dateStr()}.xlsx`);
  XLSX.writeFile(wb, filename);
}
```

### UI Integration (main.js)
```javascript
document.getElementById("btnExportRoomsPdf")?.addEventListener("click", async () => {
  const options = getExportOptionsFromUi();
  if (!options.roomIds.length) {
    showExportStatus(t("export.noRoomsSelected"), "error");
    return;
  }

  showExportProgress(true);
  try {
    await exportRoomsPdf(store.getState(), options, ({ current, total }) => {
      updateExportProgress(current, total);
    });
    showExportStatus(t("export.success"), "success");
  } catch (err) {
    console.error("Export failed:", err);
    showExportStatus(t("export.error") + ": " + err.message, "error");
  } finally {
    showExportProgress(false);
  }
});
```

---

## Risks / Edge Cases

### SVG → PDF vector conversion failures
- Fallback to PNG rasterization
- Log warning but continue export

### Rooms with no tile preset
- Export anyway with "No tile configured" annotation
- Metrics section shows "N/A"

### Large rooms vs page size
- Scale to fit, show scale factor in header (e.g., "Scale: 1:50")
- For fixed scales (1:20, 1:50, 1:100), warn if room won't fit on page

### Large multi-room exports
- PDF size could grow significantly
- Show progress indicator with "Exporting room X of Y"
- Consider warning if >20 rooms selected

### Memory management
- Create offscreen SVG, render to PDF, then **remove from DOM immediately**
- Don't keep references to rendered SVGs
- For very large exports, process rooms sequentially (not in parallel)

### Error handling
- Wrap entire export in try/catch
- If export fails mid-way, show error message with room that failed
- Don't leave partial files or broken state
- Log detailed error to console for debugging

### Font limitations
- jsPDF default fonts are limited (Helvetica, Times, Courier)
- Special characters (umlauts ä ö ü) work with Helvetica
- If custom fonts needed later, use jsPDF font embedding

### Zoom/pan state
- Export should use base viewBox, ignoring current zoom/pan
- User sees same export regardless of current view state

---

## Acceptance Criteria
- Export tab visible and functional
- User can select rooms and export multi-page PDF
- Plans include header + plan + footer
- Commercial PDF includes summary cards + tables
- Excel export includes Summary + Materials + Rooms + Skirting
- Works client-side only
- Progress feedback during multi-room export
- Graceful error handling with user-friendly messages
- All text respects current language setting (DE/EN)
- Exported files have sensible default filenames
