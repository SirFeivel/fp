# Plan: Room PDF — All Tiled Surfaces
**Date:** 2026-03-18
**Branch:** multiple-surfaces

---

## Problem

The room PDF currently produces one page per floor room showing only the floor tile plan (top-down view). Every other tiled surface — wall surfaces, floor exclusion sub-surfaces, wall surface sub-surfaces, and 3D object faces — is absent from the PDF.

---

## Scorecard

| Dimension | Score | Evidence |
|---|---|---|
| **Hacky** | 9 | `renderPlanSvg` already has a `roomOverride` param used in the live UI for exactly this purpose (wall surface elevation view). `exclusionToRegion`, `prepareWallSurface`, `prepareObj3dFaceRegion` all return the same region interface (`polygonVertices`, `tile`, `grout`, `pattern`, `exclusions`). No new abstraction needed — just call the same path with a different region. |
| **Compliance** | 9 | All changes confined to `export.js`. Correct imports (geometry.js → exclusionToRegion, walls.js → prepareWallSurface + getWallsForRoom, objects3d.js → prepareObj3dFaceRegion). No state mutation, no layer violations. |
| **Complexity** | 7 | ~120 lines: one new param on `renderPlanSvgForExport`, one new compact header helper (~30 lines), one async page-render helper (~25 lines), three new loops in `exportRoomsPdf` (~40 lines, one for each surface category). |
| **Problem Understanding** | 8 | (1) `renderPlanSvg` line 1534: `currentRoom = roomOverride \|\| getCurrentRoom(state)` — override takes full control. (2) `_renderPlanWalls` line 1092: returns `null` when `isExportBW=true`, so wall outlines are suppressed in all export renders. (3) `metrics` param in `renderPlanSvg` used only for debug overlay (`showNeeds`), not tile computation — passing `null` is safe. (4) `buildRoomList` already returns `{ floor, room }` — destructuring `floor` is a zero-effort change. (5) `getWallsForRoom(floor, room.id)` is the correct API (walls.js line 1101). (6) Wall surface sub-surface exclusions are in wall-local coordinate space; `exclusionToRegion` handles them correctly since they're stored as rect/circle/tri shapes with local coords. (7) `prepareObj3dFaceRegion(obj, surf, [], state)` — passing empty contacts is safe: contacts only affect which tiles are blocked near a wall, not the tile pattern geometry. (8) Sub-surface regions have `exclusions: []` so no recursive sub-sub-surfaces are attempted. −2: `renderPlanSvg` tile path not fully traced for regions missing `skirting`/`sections`/`id`/`name` — these fields are accessed only in paths that are either guarded or irrelevant when `roomOverride` is set. |
| **Confidence** | 5 | (1) Wall surface `roomOverride` path proven in live UI. (2) `prepareWallSurface` and `prepareObj3dFaceRegion` both battle-tested. (3) `exclusionToRegion` has 18 E2E tests passing. (4) `exportStyle: "bw"` already suppresses walls rendering. −2: floor exclusion sub-surface and object face pages via `roomOverride` not yet runtime-tested as standalone pages. −2: PDF rendering pipeline (svg2pdf / fallback PNG) not verified for regions with non-rectangular `polygonVertices`. Honest cap at 5. |

---

## All Surface Types Covered

| Surface | Source | Rendering |
|---|---|---|
| Floor room | `room.tile` | existing page (unchanged) |
| Floor exclusion sub-surface | `room.exclusions[i].tile != null` | `exclusionToRegion(excl, state)` → new page |
| Wall surface | `wall.surfaces[idx].tile != null` | `prepareWallSurface(wall, idx, room, floor, state)` → new page |
| Wall surface sub-surface | non-contact exclusion on wall surface with `.tile != null` | `exclusionToRegion(excl, state)` → new page |
| 3D object face | `room.objects3d[j].surfaces[k].tile != null` | `prepareObj3dFaceRegion(obj, surf, [], state)` → new page |

Skirting zones (`wall.surfaces[idx].skirtingZones[zi].tile`) are rendered within the wall surface elevation page when `includeSkirting=true`. No separate page needed.

---

## Steps

### Step 1 — Add `regionOverride` param to `renderPlanSvgForExport`

```js
export function renderPlanSvgForExport(state, roomId, options, regionOverride = null) {
  ...
  renderPlanSvg({
    ...existing params...
    roomOverride: regionOverride,
    exportStyle: "bw"
  });
  return { svg, container: tmp };
}
```

`npm run test` after.

### Step 2 — New `layoutSurfacePageHeader(doc, title, region, options, pageWidth, pageHeight)`

Compact single-box header for non-floor pages. Returns layout object with `planX`, `planY`, `planWidth`, `planHeight`, `legendX`, `legendY`, `legendFontSize`.

- Top: two lines — title (e.g. "Wall Surface — Bathroom / Wall 1") and dimensions (`widthCm × heightCm cm`)
- One info box: tile reference, tile dimensions, pattern type, grout mm, grout color, rotation
- No right-hand info box, no skirting/pricing info

```js
function layoutSurfacePageHeader(doc, title, region, options, pageWidth, pageHeight) {
  const isCompact = pageHeight < 700;
  const fontSize = isCompact ? 9 : 10;
  const line = isCompact ? 12 : 14;
  const topY = 28;
  const leftX = 40;
  const boxHeight = isCompact ? 44 : 52;
  const row = isCompact ? 11 : 12;
  const boxWidth = Math.min(pageWidth - 80, 360);
  const footerReserve = isCompact ? 20 : 28;
  const planY = topY + line * 2 + 10 + boxHeight + 10;
  const planWidth = pageWidth - leftX * 2;
  const planHeight = pageHeight - planY - footerReserve;

  doc.setFontSize(fontSize);
  doc.setTextColor(30);
  doc.text(title, leftX, topY);
  doc.text(`${Math.round(region.widthCm)} × ${Math.round(region.heightCm)} cm`, leftX, topY + line);

  const boxY = topY + line * 2 + 10;
  doc.setDrawColor(180);
  doc.setFillColor(248);
  doc.rect(leftX, boxY, boxWidth, boxHeight, "FD");
  doc.setFont(undefined, "bold");
  doc.text(t("pdf.tileDetails"), leftX, boxY - 6);
  doc.setFont(undefined, "normal");
  doc.setFontSize(Math.max(7, Math.round(fontSize * 0.8)));

  const tile = region.tile || {};
  const pattern = region.pattern || {};
  const grout = region.grout || {};
  doc.text(`${t("pdf.tile")}: ${tile.reference || "–"}`, leftX + 6, boxY + row);
  doc.text(`${t("pdf.dimensions")}: ${tile.widthCm || 0} × ${tile.heightCm || 0} cm`, leftX + 6, boxY + row * 2);
  doc.text(`${t("pdf.pattern")}: ${pattern.type || "grid"}  ${t("pdf.rotation")}: ${pattern.rotationDeg || 0}°`, leftX + 6, boxY + row * 3);
  doc.text(`${t("pdf.grout")}: ${Number(grout.widthCm || 0) * 10} mm  ${t("pdf.color")}: ${grout.colorHex || "–"}`, leftX + 6, boxY + row * 4);

  doc.setFontSize(fontSize);

  return {
    planX: leftX,
    planY,
    planWidth,
    planHeight,
    legendX: pageWidth - leftX - Math.min(pageWidth - 80, Math.max(320, Math.round(pageWidth * 0.7))),
    legendY: pageHeight - 18,
    legendWidth: Math.min(pageWidth - 80, Math.max(320, Math.round(pageWidth * 0.7))),
    legendFontSize: isCompact ? 7 : 8,
  };
}
```

`npm run test` after.

### Step 3 — New async `addSurfacePage(doc, state, roomId, region, title, options, pageFormat, surfOrientation)`

Encapsulates: layout header, render SVG, embed in PDF, footer.

```js
async function addSurfacePage(doc, state, roomId, region, title, options, pageFormat, surfOrientation) {
  doc.addPage(pageFormat, surfOrientation);
  console.log(`[export:surfacePage] ${title} region=${region.id || '?'} w=${region.widthCm?.toFixed(1)} h=${region.heightCm?.toFixed(1)}`);

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const layout = layoutSurfacePageHeader(doc, title, region, options, pageWidth, pageHeight);

  const svgResult = renderPlanSvgForExport(state, roomId, options, region);
  const ok = await svgToPdf(doc, svgResult.svg, layout.planX, layout.planY, layout.planWidth, layout.planHeight);
  if (!ok) {
    const dataUrl = await svgToPngDataUrl(svgResult.svg, Math.round(layout.planWidth), Math.round(layout.planHeight));
    doc.addImage(dataUrl, "PNG", layout.planX, layout.planY, layout.planWidth, layout.planHeight);
  }
  svgResult.container.remove();

  if (options.includeLegend) {
    layoutLegend(doc, layout.legendX, layout.legendY, layout.legendFontSize, layout.legendWidth, 10);
  }
  layoutFooter(doc, pageHeight - 18, options.notes || "", layout.legendFontSize);
}
```

`npm run test` after.

### Step 4 — New imports and wire loops into `exportRoomsPdf`

**New imports in export.js**:
```js
// Extend existing geometry.js import:
import { getRoomBounds, exclusionToRegion } from "./geometry.js";
// New imports:
import { prepareWallSurface, getWallsForRoom } from "./walls.js";
import { prepareObj3dFaceRegion } from "./objects3d.js";
```

**In `exportRoomsPdf` loop**: change `const { room } = roomEntries[i]` to `const { floor, room } = roomEntries[i]`.

**After `svgResult.container.remove()` and before `layoutLegend`/`layoutFooter` on the floor page**, add surface-page loops. These run for the same room before moving to the next room.

```js
    // ── Floor exclusion sub-surfaces ──────────────────────────────────────
    for (const excl of (room.exclusions || [])) {
      if (!excl.tile) continue;
      const region = exclusionToRegion(excl, state);
      if (!region?.tile) continue;
      const surfOrientation = region.widthCm >= region.heightCm ? "landscape" : "portrait";
      const title = `${model.roomName} — ${excl.label || excl.type || "Sub-surface"}`;
      await addSurfacePage(doc, state, room.id, region, title, options, pageFormat, surfOrientation);
    }

    // ── Wall surfaces + wall surface sub-surfaces ──────────────────────────
    for (const wall of getWallsForRoom(floor, room.id)) {
      for (let idx = 0; idx < (wall.surfaces || []).length; idx++) {
        const surface = wall.surfaces[idx];
        if (!surface.tile) continue;
        const region = prepareWallSurface(wall, idx, room, floor, state);
        if (!region?.tile) continue;
        const surfOrientation = region.widthCm >= region.heightCm ? "landscape" : "portrait";
        const title = `${model.roomName} — ${t("commercial.sourceWall")} ${idx + 1}`;
        await addSurfacePage(doc, state, room.id, region, title, options, pageFormat, surfOrientation);

        // Wall surface sub-surfaces
        for (const excl of (region.exclusions || [])) {
          if (excl._isContact || !excl.tile) continue;
          const subRegion = exclusionToRegion(excl, state);
          if (!subRegion?.tile) continue;
          const subOrientation = subRegion.widthCm >= subRegion.heightCm ? "landscape" : "portrait";
          const subTitle = `${model.roomName} — ${t("commercial.sourceWall")} ${idx + 1} / ${excl.label || excl.type || "Sub-surface"}`;
          await addSurfacePage(doc, state, room.id, subRegion, subTitle, options, pageFormat, subOrientation);
        }
      }
    }

    // ── 3D object faces ────────────────────────────────────────────────────
    for (const obj of (room.objects3d || [])) {
      for (const surf of (obj.surfaces || [])) {
        if (!surf.tile) continue;
        const region = prepareObj3dFaceRegion(obj, surf, [], state);
        if (!region) continue;
        const faceLabel = _obj3dFaceName(obj, surf.face);
        const surfOrientation = region.widthCm >= region.heightCm ? "landscape" : "portrait";
        const title = `${model.roomName} — ${obj.label || obj.type || "Object"} / ${faceLabel}`;
        await addSurfacePage(doc, state, room.id, region, title, options, pageFormat, surfOrientation);
      }
    }
```

**Private helper** (inline in export.js, mirrors `getObj3dFaceName` from main.js):
```js
function _obj3dFaceName(obj, face) {
  if (face === "top") return t("objects3d.faceTop") || "Top";
  if (obj.type === "rect") {
    const names = { front: "Front", back: "Back", left: "Left", right: "Right" };
    return t(`objects3d.face_${face}`) || names[face] || face;
  }
  const m = face.match(/^side-(\d+)$/);
  return m ? `${t("objects3d.faceSide") || "Side"} ${parseInt(m[1]) + 1}` : face;
}
```

`npm run test` after.

---

## Logging

Every new surface page emits `[export:surfacePage]` with title, region id, and dimensions. This lets the user confirm pages are being generated per surface.

---

## Critical Files

| File | Change |
|---|---|
| `src/export.js` | All changes — imports, `renderPlanSvgForExport` param, `layoutSurfacePageHeader`, `addSurfacePage`, `_obj3dFaceName`, loops in `exportRoomsPdf` |

---

## Implementation

**Status: COMPLETE** — all 4 steps implemented, 71/71 test files passing (1545 tests).

### What was done
- `renderPlanSvgForExport` gets `regionOverride = null` param, forwarded as `roomOverride` to `renderPlanSvg`.
- `layoutSurfacePageHeader(doc, title, region, pageWidth, pageHeight)` — compact single-box header, returns layout object.
- `addSurfacePage(...)` — async helper: adds page, renders header, embeds SVG (with PNG fallback), footer.
- `_obj3dFaceName(obj, face)` — private helper mirroring main.js (not exported from there).
- `exportRoomsPdf` loop: `floor` destructured from roomEntries (was only `room`). Three surface loops added after floor page footer: floor exclusion sub-surfaces, wall surfaces + their sub-surfaces, 3D object faces.

### Core findings
- `buildRoomList` already returns `{ floor, room }` — destructuring floor required zero other changes.
- `_renderPlanWalls` returns `null` for `isExportBW=true`, so no wall outlines bleed into surface elevation pages.
- Wall surface sub-surface exclusions from `region.exclusions` are in wall-local coord space — `exclusionToRegion` handles them correctly.

---

## What remains unverified until user runs PDF export

- Floor exclusion sub-surface and object face pages render correctly via `roomOverride` (no live test yet)
- SVG bounding box computes correctly for non-rectangular `polygonVertices` (circle/tri/freeform exclusions)
- Page orientation choice looks sensible for all region aspect ratios
