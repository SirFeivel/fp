import { jsPDF } from "jspdf";
import { svg2pdf } from "svg2pdf.js";
import { computePlanMetrics, computeSkirtingNeeds, computeProjectTotals, computeGrandTotals, getRoomPricing } from "./calc.js";
import { t } from "./i18n.js";
import { getCurrentRoom, DEFAULT_SKIRTING_PRESET } from "./core.js";
import { renderPlanSvg } from "./render.js";
import { getRalMatch } from "./ral.js";
import { getRoomBounds } from "./geometry.js";

function dateStamp() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function sanitizeFilename(name) {
  return String(name || "export")
    .normalize("NFKD")
    .replace(/[^\w\d-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || "export";
}

export function buildRoomExportModel(state, roomId) {
  let room = null;
  for (const floor of state.floors || []) {
    const found = floor.rooms?.find(r => r.id === roomId);
    if (found) {
      room = found;
      break;
    }
  }
  if (!room) room = getCurrentRoom(state);
  if (!room) return null;

  const floor = state.floors?.find(f => f.rooms?.some(r => r.id === room.id));
  const metrics = computePlanMetrics(state, room);
  const skirting = computeSkirtingNeeds(state, room);
  const pricing = getRoomPricing(state, room);

  return {
    projectName: state.project?.name || "",
    floorName: floor?.name || "",
    roomName: room.name || "",
    roomDimensionsCm: {
      width: Math.round(getRoomBounds(room).width || 0),
      length: Math.round(getRoomBounds(room).height || 0)
    },
    roomAreaM2: metrics.ok ? metrics.data.area.netAreaM2 : 0,
    tile: {
      reference: room.tile?.reference || "",
      shape: room.tile?.shape || "rect",
      widthCm: Number(room.tile?.widthCm) || 0,
      heightCm: Number(room.tile?.heightCm) || 0,
      pattern: room.pattern?.type || "grid"
    },
    pattern: {
      type: room.pattern?.type || "grid",
      rotationDeg: Number(room.pattern?.rotationDeg) || 0,
      offsetXcm: Number(room.pattern?.offsetXcm) || 0,
      offsetYcm: Number(room.pattern?.offsetYcm) || 0,
      originLabel: room.pattern?.origin?.preset || "tl",
      originXcm: Number(room.pattern?.origin?.xCm) || 0,
      originYcm: Number(room.pattern?.origin?.yCm) || 0,
      bondFraction: Number(room.pattern?.bondFraction) || 0
    },
    grout: {
      widthMm: Number(room.grout?.widthCm || 0) * 10,
      colorHex: room.grout?.colorHex || "#ffffff"
    },
    skirting: {
      enabled: room.skirting?.enabled !== false,
      type: room.skirting?.type || "cutout",
      heightCm: Number(room.skirting?.heightCm) || 0,
      lengthCm: skirting.totalLengthCm || 0
    },
    metrics: metrics.ok
      ? {
        tiles: metrics.data.tiles.purchasedTilesWithReserve,
        packs: metrics.data.pricing.packs || 0,
        cost: metrics.data.pricing.priceTotal || 0
      }
      : { tiles: 0, packs: 0, cost: 0 },
    pricing
    ,
    skirtingPieces: skirting.count || 0,
    skirtingLengthCm: skirting.totalLengthCm || 0
  };
}

export function buildCommercialExportModel(state) {
  const totals = computeProjectTotals(state);
  const grand = computeGrandTotals(state);
  const rooms = [];
  const materials = totals.materials || [];
  const skirtingRows = [];

  for (const floor of state.floors || []) {
    for (const room of (floor.rooms || [])) {
      const metrics = computePlanMetrics(state, room);
      const skirting = computeSkirtingNeeds(state, room);
      const pricing = getRoomPricing(state, room);
      const pricePerPiece = room.skirting?.type === "bought"
        ? (Number(room.skirting?.boughtPricePerPiece) || DEFAULT_SKIRTING_PRESET.pricePerPiece)
        : 0;
      const skirtingCost = skirting.totalCost || 0;
      rooms.push({
        floor: floor.name,
        room: room.name,
        areaM2: metrics.ok ? metrics.data.area.netAreaM2 : 0,
        tiles: metrics.ok ? metrics.data.tiles.purchasedTilesWithReserve : 0,
        packs: metrics.ok ? metrics.data.pricing.packs || 0 : 0,
        skirtingLengthCm: skirting.totalLengthCm || 0,
        cost: metrics.ok ? metrics.data.pricing.priceTotal || 0 : 0
      });

      skirtingRows.push({
        floor: floor.name,
        room: room.name,
        skirtingLengthCm: skirting.totalLengthCm || 0,
        skirtingPieces: skirting.count || 0,
        skirtingCost,
        skirtingType: room.skirting?.type || "cutout",
        pricePerPiece
      });
    }
  }

  return {
    summary: {
      totalAreaM2: totals.totalNetAreaM2 || 0,
      totalTiles: totals.totalTiles || 0,
      totalPacks: totals.totalPacks || 0,
      totalCost: totals.totalCost || 0,
      grandTotal: grand.ok ? grand.totalCost : totals.totalCost || 0
    },
    materials,
    rooms,
    skirting: skirtingRows
  };
}

function buildRoomList(state) {
  const list = [];
  for (const floor of state.floors || []) {
    for (const room of (floor.rooms || [])) {
      list.push({ floor, room });
    }
  }
  return list;
}

function cloneStateWithView(state, options) {
  const next = JSON.parse(JSON.stringify(state));
  if (!next.view) next.view = { showGrid: true, showNeeds: false, showSkirting: true };
  next.view.showGrid = options.includeGrid;
  next.view.showSkirting = options.includeSkirting;
  return next;
}

export function renderPlanSvgForExport(state, roomId, options) {
  const tmp = document.createElement("div");
  tmp.style.position = "absolute";
  tmp.style.left = "-99999px";
  tmp.style.top = "-99999px";
  document.body.appendChild(tmp);

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "1000");
  svg.setAttribute("height", "700");
  tmp.appendChild(svg);

  const scopedState = cloneStateWithView(state, options);
  let roomFloorId = scopedState.selectedFloorId;
  for (const floor of scopedState.floors || []) {
    if (floor.rooms?.some(r => r.id === roomId)) {
      roomFloorId = floor.id;
      break;
    }
  }
  scopedState.selectedFloorId = roomFloorId;
  scopedState.selectedRoomId = roomId;

  renderPlanSvg({
    state: scopedState,
    selectedExclId: null,
    setSelectedExcl: () => {},
    onExclPointerDown: () => {},
    onInlineEdit: () => {},
    onResizeHandlePointerDown: () => {},
    lastUnionError: null,
    lastTileError: null,
    setLastUnionError: () => {},
    setLastTileError: () => {},
    metrics: null,
    skipTiles: false,
    svgOverride: svg,
    includeExclusions: options.includeExclusions !== false,
    exportStyle: "bw"
  });

  return { svg, container: tmp };
}

async function svgToPdf(doc, svgEl, x, y, width, height) {
  try {
    await svg2pdf(svgEl, doc, { x, y, width, height });
    return true;
  } catch (e) {
    return false;
  }
}

async function svgToPngDataUrl(svgEl, width, height) {
  const svgData = new XMLSerializer().serializeToString(svgEl);
  const blob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const img = new Image();
  const imgLoad = new Promise((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = reject;
  });
  img.src = url;
  await imgLoad;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  URL.revokeObjectURL(url);
  return canvas.toDataURL("image/png");
}

export function computeRoomPdfLayout({ pageWidth, pageHeight, leftLineCount, rightLineCount }) {
  const isCompact = pageHeight < 700;
  const fontSize = isCompact ? 9 : 10;
  const line = isCompact ? 12 : 14;
  const headerGap = isCompact ? 6 : 8;
  const boxHeight = isCompact ? 56 : 68;
  const row = isCompact ? 11 : 12;
  const footerReserve = isCompact ? 20 : 28;
  const leftX = 40;
  const rightX = pageWidth - 220;
  const topY = 28;
  const headerBottom = topY + line * Math.max(leftLineCount, rightLineCount) + headerGap;
  const gap = isCompact ? 8 : 10;
  const boxWidth = (pageWidth - 80 - gap) / 2;
  const boxY = headerBottom + 10;
  const planY = boxY + boxHeight + 10;
  const planX = leftX;
  const planWidth = pageWidth - leftX * 2;
  const planHeight = pageHeight - planY - footerReserve;
  const legendWidth = Math.min(pageWidth - leftX * 2, Math.max(320, Math.round(pageWidth * 0.7)));
  const legendHeight = 10;
  const legendX = pageWidth - leftX - legendWidth;
  const legendY = pageHeight - 18;

  return {
    isCompact,
    fontSize,
    line,
    headerGap,
    boxHeight,
    row,
    footerReserve,
    leftX,
    rightX,
    topY,
    headerBottom,
    gap,
    boxWidth,
    boxY,
    planX,
    planY,
    planWidth,
    planHeight,
    legendX,
    legendY,
    legendWidth,
    legendHeight,
    legendFontSize: isCompact ? 7 : 8
  };
}

function layoutHeader(doc, model, options, pageWidth, pageHeight, ralInfo) {
  const leftLines = [
    `${t("pdf.projectName")}: ${model.projectName}`,
    `${t("pdf.floor")}: ${model.floorName}`,
    `${t("pdf.room")}: ${model.roomName}`,
    `${t("pdf.dimensions")}: ${model.roomDimensionsCm.width} x ${model.roomDimensionsCm.length} cm`,
    `${t("pdf.area")}: ${model.roomAreaM2.toFixed(2)} m²`,
  ];
  if (options.scale && options.scale !== "fit") {
    leftLines.push(`${t("export.scale")}: ${options.scale}`);
  }

  const rightLines = [
    `${t("pdf.company")}: ____________________`,
    `${t("pdf.address")}: ____________________`,
    `${t("pdf.contact")}: ____________________`,
  ];
  if (options.includeMetrics) {
    rightLines.push(`${t("metrics.totalTiles")}: ${model.metrics.tiles}`);
    rightLines.push(`${t("commercial.totalPacks")}: ${model.metrics.packs}`);
    rightLines.push(`${t("commercial.totalCost")}: ${model.metrics.cost.toFixed(2)} €`);
  }

  const layout = computeRoomPdfLayout({
    pageWidth,
    pageHeight,
    leftLineCount: leftLines.length + 1,
    rightLineCount: rightLines.length
  });

  doc.setFontSize(layout.fontSize);
  doc.setTextColor(30);

  leftLines.forEach((text, idx) => doc.text(text, layout.leftX, layout.topY + layout.line * idx));
  doc.text(`${dateStamp()}`, layout.leftX, layout.topY + layout.line * leftLines.length);
  rightLines.forEach((text, idx) => doc.text(text, layout.rightX, layout.topY + layout.line * idx));
  const pricePerPack = (Number(model.pricing?.pricePerM2) || 0) * (Number(model.pricing?.packM2) || 0);
  const ralLabel = ralInfo ? `${ralInfo.code} ${ralInfo.name}` : "–";
  const pattern = model.pattern || {};

  doc.setDrawColor(180);
  doc.setFillColor(248);
  doc.rect(layout.leftX, layout.boxY, layout.boxWidth, layout.boxHeight, "FD");
  doc.rect(layout.leftX + layout.boxWidth + layout.gap, layout.boxY, layout.boxWidth, layout.boxHeight, "FD");

  doc.setFont(undefined, "bold");
  doc.text(t("pdf.tileDetails"), layout.leftX, layout.boxY - 6);
  doc.text(t("pdf.layoutDetails"), layout.leftX + layout.boxWidth + layout.gap, layout.boxY - 6);
  doc.setFont(undefined, "normal");
  doc.setFontSize(Math.max(7, Math.round(layout.fontSize * 0.8)));

  doc.text(`${t("pdf.tile")}: ${model.tile.reference || "–"}`, layout.leftX + 6, layout.boxY + layout.row);
  doc.text(`${t("pdf.dimensions")}: ${model.tile.widthCm} x ${model.tile.heightCm} cm`, layout.leftX + 6, layout.boxY + layout.row * 2);
  doc.text(`${t("commercial.packSize")}: ${(model.pricing?.packM2 || 0).toFixed(2)} m²`, layout.leftX + 6, layout.boxY + layout.row * 3);
  doc.text(`${t("commercial.pricePerPack")}: ${pricePerPack.toFixed(2)} €`, layout.leftX + 6, layout.boxY + layout.row * 4);
  doc.text(`${t("pdf.skirtingPieces")}: ${model.skirtingPieces}`, layout.leftX + 6, layout.boxY + layout.row * 5);

  const layoutX = layout.leftX + layout.boxWidth + layout.gap;
  doc.text(`${t("pdf.pattern")}: ${pattern.type || "grid"}`, layoutX + 6, layout.boxY + layout.row);
  doc.text(`${t("pdf.grout")}: ${model.grout.widthMm} mm`, layoutX + 6, layout.boxY + layout.row * 2);
  doc.text(`${t("pdf.color")}: ${ralLabel} ${model.grout.colorHex}`, layoutX + 6, layout.boxY + layout.row * 3);
  doc.text(`${t("pdf.origin")}: ${pattern.originLabel || "tl"} (${pattern.originXcm || 0}/${pattern.originYcm || 0})`, layoutX + 6, layout.boxY + layout.row * 4);
  doc.text(`${t("pdf.rotation")}: ${pattern.rotationDeg || 0}°`, layoutX + 6, layout.boxY + layout.row * 5);
  doc.setFontSize(layout.fontSize);

  return layout;
}

function layoutFooter(doc, y, notes, fontSize = 8) {
  doc.setFontSize(fontSize);
  doc.setTextColor(80);
  doc.text(`${t("pdf.generatedBy")}`, 40, y);
  if (notes) {
    doc.text(`${t("pdf.notes")}: ${notes}`, 40, y + 14);
  }
}

function layoutLegend(doc, x, y, fontSize = 10, width = 260, height = 22) {
  const boxW = width;
  const boxH = height;
  doc.setDrawColor(160);
  doc.setFillColor(245);
  doc.rect(x, y - boxH + 2, boxW, boxH, "FD");

  doc.setFontSize(fontSize);
  doc.setTextColor(20);

  const labels = [
    { label: t("pdf.skirting"), draw: "line" },
    { label: t("export.legendExclusion"), draw: "box-dashed" },
    { label: t("export.legendRemovedTile"), draw: "box-x" },
    { label: t("export.legendRemovedSkirting"), draw: "line-x" },
    { label: t("export.legendStartPoint"), draw: "circle" }
  ];
  const pad = 6;
  const itemWidth = (boxW - pad * 2) / labels.length;
  const baselineY = y - boxH / 2 + 4;

  labels.forEach((item, idx) => {
    const itemX = x + pad + idx * itemWidth;
    const iconX = itemX + 4;
    const textX = itemX + 22;
    const iconY = baselineY - 1;

    doc.setDrawColor(20);
    doc.setFillColor(220);

    if (item.draw === "line") {
      doc.line(iconX, iconY, iconX + 14, iconY);
    } else if (item.draw === "box-dashed") {
      doc.rect(iconX, iconY - 6, 12, 8, "FD");
      doc.setLineDashPattern([3, 2], 0);
      doc.rect(iconX, iconY - 6, 12, 8, "S");
      doc.setLineDashPattern([], 0);
    } else if (item.draw === "box-x") {
      doc.rect(iconX, iconY - 6, 12, 8, "FD");
      doc.line(iconX, iconY - 6, iconX + 12, iconY + 2);
      doc.line(iconX, iconY + 2, iconX + 12, iconY - 6);
    } else if (item.draw === "line-x") {
      doc.line(iconX, iconY, iconX + 14, iconY);
      doc.line(iconX + 4, iconY - 4, iconX + 8, iconY + 2);
      doc.line(iconX + 4, iconY + 2, iconX + 8, iconY - 4);
    } else if (item.draw === "circle") {
      doc.setFillColor(255);
      doc.circle(iconX + 6, iconY - 2, 3.5, "FD");
      doc.circle(iconX + 6, iconY - 2, 3.5, "S");
    }

    doc.text(item.label, textX, baselineY);
  });
}

function getPageSize(options) {
  const format = options.pageSize || "A4";
  const orientation = options.orientation || "portrait";
  return { format, orientation };
}

function resolveScale(scale, roomWidthCm, roomHeightCm, pageWidth, pageHeight) {
  if (scale === "fit") return { scale: null };
  const factor = Number(scale.split(":")[1]) || 50;
  const cmToPt = 28.3465; // 1cm in pt
  const planWidth = (roomWidthCm / factor) * cmToPt;
  const planHeight = (roomHeightCm / factor) * cmToPt;

  const minPageW = Math.max(pageWidth, planWidth + 80);
  const minPageH = Math.max(pageHeight, planHeight + 300);

  return {
    scale: factor,
    planWidth,
    planHeight,
    pageWidth: minPageW,
    pageHeight: minPageH
  };
}

export async function exportRoomsPdf(state, options, onProgress) {
  const roomEntries = buildRoomList(state).filter(({ room }) => options.roomIds.includes(room.id));
  const { format } = getPageSize(options);
  let doc = null;

  for (let i = 0; i < roomEntries.length; i++) {
    const { room } = roomEntries[i];
    const model = buildRoomExportModel(state, room.id);
    if (!model) continue;

    const roomOrientation = model.roomDimensionsCm.width >= model.roomDimensionsCm.length ? "landscape" : "portrait";
    const measurementDoc = new jsPDF({ unit: "pt", format, orientation: roomOrientation });
    const basePage = {
      width: measurementDoc.internal.pageSize.getWidth(),
      height: measurementDoc.internal.pageSize.getHeight()
    };
    const scaleInfo = resolveScale(
      options.scale,
      model.roomDimensionsCm.width,
      model.roomDimensionsCm.length,
      basePage.width || 595,
      basePage.height || 842
    );

    const pageFormat = scaleInfo.pageWidth && scaleInfo.pageHeight
      ? [scaleInfo.pageWidth, scaleInfo.pageHeight]
      : format;

    if (!doc) {
      doc = new jsPDF({ unit: "pt", format: pageFormat, orientation: roomOrientation });
    } else {
      doc.addPage(pageFormat, roomOrientation);
    }

    onProgress?.({ current: i + 1, total: roomEntries.length, roomId: room.id });

    const ralInfo = await getRalMatch(model.grout.colorHex);
    const layout = layoutHeader(doc, model, options, doc.internal.pageSize.getWidth(), doc.internal.pageSize.getHeight(), ralInfo);

    const svgResult = renderPlanSvgForExport(state, room.id, options);
    const svg = svgResult.svg;
    const planX = layout.planX;
    const planY = layout.planY;
    const planWidth = Math.min(scaleInfo.planWidth || layout.planWidth, layout.planWidth);
    const planHeight = Math.min(scaleInfo.planHeight || layout.planHeight, layout.planHeight);

    const ok = await svgToPdf(doc, svg, planX, planY, planWidth, planHeight);
    if (!ok) {
      const dataUrl = await svgToPngDataUrl(svg, Math.round(planWidth), Math.round(planHeight));
      doc.addImage(dataUrl, "PNG", planX, planY, planWidth, planHeight);
    }

    svgResult.container.remove();

    if (options.includeLegend) {
      layoutLegend(
        doc,
        layout.legendX,
        layout.legendY,
        layout.legendFontSize,
        layout.legendWidth,
        layout.legendHeight
      );
    }
    layoutFooter(doc, doc.internal.pageSize.getHeight() - 18, options.notes || "", layout.legendFontSize);
  }

  const filename = sanitizeFilename(`${state.project?.name || "plan"}_rooms_${dateStamp()}.pdf`);
  doc.save(filename);
}

export async function exportCommercialPdf(state, options) {
  const { format } = getPageSize(options);
  let doc = new jsPDF({ unit: "pt", format, orientation: "landscape" });
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  if (w < h) {
    doc = new jsPDF({ unit: "pt", format: [h, w], orientation: "landscape" });
  }
  const proj = computeProjectTotals(state);

  const headerFontSize = 10;
  doc.setFontSize(headerFontSize);
  doc.setTextColor(30);
  const leftX = 40;
  const rightX = doc.internal.pageSize.getWidth() - 220;
  const topY = 28;
  const line = 14;

  doc.text(`${t("pdf.projectName")}: ${state.project?.name || ""}`, leftX, topY);
  doc.text(`${dateStamp()}`, leftX, topY + line);
  doc.text(`${t("pdf.company")}: ____________________`, rightX, topY);
  doc.text(`${t("pdf.address")}: ____________________`, rightX, topY + line);
  doc.text(`${t("pdf.contact")}: ____________________`, rightX, topY + line * 2);

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  let y = 90;
  const roomsTable = buildCommercialRoomsTable(proj);
  y = drawTableGrid(doc, t("commercial.rooms"), roomsTable.columns, roomsTable.rows, y, pageWidth, pageHeight, { fontSize: 9 });

  layoutFooter(doc, pageHeight - 18, options.notes || "", 8);

  doc.addPage();
  const pageWidth2 = doc.internal.pageSize.getWidth();
  const pageHeight2 = doc.internal.pageSize.getHeight();
  const rightX2 = pageWidth2 - 220;
  doc.setFontSize(headerFontSize);
  doc.setTextColor(30);
  doc.text(`${t("pdf.projectName")}: ${state.project?.name || ""}`, leftX, topY);
  doc.text(`${dateStamp()}`, leftX, topY + line);
  doc.text(`${t("pdf.company")}: ____________________`, rightX2, topY);
  doc.text(`${t("pdf.address")}: ____________________`, rightX2, topY + line);
  doc.text(`${t("pdf.contact")}: ____________________`, rightX2, topY + line * 2);

  const matsTable = buildCommercialMaterialsTable(proj);
  drawTableGrid(doc, t("commercial.materials"), matsTable.columns, matsTable.rows, 90, pageWidth2, pageHeight2, { fontSize: 8 });

  layoutFooter(doc, pageHeight2 - 18, options.notes || "", 8);

  const filename = sanitizeFilename(`${state.project?.name || "plan"}_commercial_${dateStamp()}.pdf`);
  doc.save(filename);
}

function drawTable(doc, title, headers, rows, startY, pageHeight) {
  let y = startY;
  const left = 40;
  const rowHeight = 16;
  const maxY = pageHeight - 40;

  doc.setFontSize(11);
  doc.setTextColor(30);
  doc.text(title, left, y);
  y += 18;

  doc.setFontSize(9);
  doc.setTextColor(80);
  doc.text(headers.join(" | "), left, y);
  y += rowHeight;

  for (const row of rows) {
    if (y > maxY) {
      doc.addPage();
      y = 40;
      doc.setFontSize(9);
      doc.setTextColor(80);
      doc.text(headers.join(" | "), left, y);
      y += rowHeight;
    }
    doc.setTextColor(30);
    doc.text(row.join(" | "), left, y);
    y += rowHeight;
  }

  return y;
}

function drawTableGrid(doc, title, columns, rows, startY, pageWidth, pageHeight, opts = {}) {
  const left = 40;
  const right = 40;
  const tableWidth = pageWidth - left - right;
  const rowHeight = opts.rowHeight || 16;
  const headerHeight = opts.headerHeight || 18;
  const fontSize = opts.fontSize || 9;
  const maxY = pageHeight - 40;

  let y = startY;
  doc.setFontSize(fontSize + 1);
  doc.setTextColor(30);
  doc.text(title, left, y);
  y += headerHeight;

  const totalWeight = columns.reduce((sum, col) => sum + (col.weight || 1), 0);
  const widths = columns.map((col) => (tableWidth * (col.weight || 1)) / totalWeight);

  const drawHeader = () => {
    doc.setFillColor(240);
    doc.rect(left, y - headerHeight + 4, tableWidth, headerHeight, "F");
    doc.setFontSize(fontSize);
    doc.setTextColor(60);
    let x = left;
    columns.forEach((col, idx) => {
      const textX = col.align === "right" ? x + widths[idx] - 4 : x + 4;
      doc.text(col.label, textX, y, { align: col.align || "left", maxWidth: widths[idx] - 8 });
      x += widths[idx];
    });
    y += rowHeight;
  };

  drawHeader();

  rows.forEach((row) => {
    if (y + rowHeight > maxY) {
      doc.addPage();
      y = 40;
      drawHeader();
    }

    doc.setFontSize(fontSize);
    doc.setTextColor(30);
    doc.setFont(undefined, row.isTotal ? "bold" : "normal");

    let x = left;
    row.cells.forEach((cell, idx) => {
      const text = String(cell ?? "");
      const textX = columns[idx].align === "right" ? x + widths[idx] - 4 : x + 4;
      doc.text(text, textX, y, { align: columns[idx].align || "left", maxWidth: widths[idx] - 8 });
      x += widths[idx];
    });
    y += rowHeight;
  });

  doc.setFont(undefined, "normal");
  return y;
}

export function buildCommercialRoomsTable(proj) {
  const columns = [
    { label: t("tabs.floor"), weight: 1.2 },
    { label: t("tabs.room"), weight: 1.2 },
    { label: t("tile.reference"), weight: 1.4 },
    { label: t("metrics.netArea"), align: "right", weight: 1 },
    { label: t("metrics.totalTiles"), align: "right", weight: 0.9 },
    { label: t("metrics.price"), align: "right", weight: 1 }
  ];
  const rows = proj.rooms.map((r) => ({
    cells: [
      r.floorName || "",
      r.name || "",
      r.reference || t("commercial.defaultMaterial"),
      `${r.netAreaM2.toFixed(2)} m²`,
      String(r.totalTiles),
      `${r.totalCost.toFixed(2)} €`
    ]
  }));
  return { columns, rows };
}

export function buildCommercialMaterialsTable(proj) {
  const columns = [
    { label: t("tile.reference"), weight: 1.6 },
    { label: t("commercial.totalM2"), align: "right", weight: 0.9 },
    { label: t("commercial.totalTiles"), align: "right", weight: 0.9 },
    { label: t("commercial.totalPacks"), align: "right", weight: 0.9 },
    { label: t("commercial.packsFloor"), align: "right", weight: 0.9 },
    { label: t("commercial.packsSkirting"), align: "right", weight: 0.9 },
    { label: t("commercial.amountOverride"), align: "right", weight: 0.9 },
    { label: t("commercial.pricePerM2"), align: "right", weight: 1 },
    { label: t("commercial.pricePerPack"), align: "right", weight: 1 },
    { label: t("commercial.packSize"), align: "right", weight: 1 },
    { label: t("commercial.totalCost"), align: "right", weight: 1 }
  ];
  const rows = proj.materials.map((m) => {
    const pricePerPack = (m.pricePerM2 * m.packM2).toFixed(2);
    return {
      cells: [
        m.reference || t("commercial.defaultMaterial"),
        `${m.netAreaM2.toFixed(2)} m²`,
        String(m.totalTiles),
        String(m.totalPacks || 0),
        String(m.floorPacks || 0),
        String(m.skirtingPacks || 0),
        String(m.extraPacks || 0),
        `${m.pricePerM2.toFixed(2)} €`,
        `${pricePerPack} €`,
        `${m.packM2.toFixed(2)} m²`,
        `${m.adjustedCost.toFixed(2)} €`
      ]
    };
  });
  rows.push({
    isTotal: true,
    cells: [
      t("commercial.grandTotal"),
      `${proj.totalNetAreaM2.toFixed(2)} m²`,
      String(proj.totalTiles),
      String(proj.totalPacks),
      "–",
      "–",
      "",
      "",
      "",
      "",
      `${proj.totalCost.toFixed(2)} €`
    ]
  });
  return { columns, rows };
}

export async function buildCommercialXlsxWorkbook(state) {
  const XLSXModule = await import("xlsx");
  const XLSX = XLSXModule.default || XLSXModule;
  const proj = computeProjectTotals(state);

  const wb = XLSX.utils.book_new();

  const sheetName = (label) => sanitizeFilename(label).slice(0, 31) || "Sheet";
  const introName = sheetName(t("export.intro"));
  const summaryName = sheetName(t("export.summary"));
  const roomsName = sheetName(t("export.rooms"));
  const materialsName = sheetName(t("export.materials"));
  const skirtingName = sheetName(t("export.skirting"));

  const introSheet = XLSX.utils.aoa_to_sheet([
    [t("export.introTitle")],
    [t("export.introProject"), state.project?.name || "–"],
    [t("export.introDate"), dateStamp()],
    [t("export.introGenerated"), "TilePerfect"],
    [""],
    [t("export.introOverview")],
    [t("export.introAssumptions")],
    [t("export.introRooms")],
    [t("export.introMaterials")],
    [t("export.introSkirting")],
    [t("export.introSummary")],
    [""],
    [t("export.introNotes")]
  ]);

  const summarySheet = XLSX.utils.aoa_to_sheet([
    [t("metrics.totalArea"), ""],
    [t("metrics.totalTiles"), ""],
    [t("commercial.totalPacks"), ""],
    [t("commercial.totalCost"), ""],
    [t("metrics.grandTotal"), ""]
  ]);

  const calcTileAreaM2 = (room) => {
    const tw = Number(room.tile?.widthCm) || 0;
    const th = Number(room.tile?.heightCm) || 0;
    const shape = room.tile?.shape || "rect";
    if (shape === "hex") {
      const radius = tw / Math.sqrt(3);
      return ((3 * Math.sqrt(3) / 2) * radius * radius) / 10000;
    }
    if (shape === "rhombus") {
      return (tw * th) / 20000;
    }
    if (shape === "square") {
      return (tw * tw) / 10000;
    }
    return (tw * th) / 10000;
  };

  const tileAreaForRef = new Map();
  for (const floor of state.floors || []) {
    for (const room of (floor.rooms || [])) {
      const ref = room.tile?.reference || t("commercial.defaultMaterial");
      if (!tileAreaForRef.has(ref)) {
        tileAreaForRef.set(ref, calcTileAreaM2(room));
      }
    }
  }

  const roomsHeader = [
    t("tabs.floor"),
    t("tabs.room"),
    t("tile.reference"),
    t("metrics.netArea"),
    t("commercial.floorTiles"),
    t("commercial.skirtingTiles"),
    t("commercial.totalTiles"),
    t("commercial.tileAreaM2"),
    t("commercial.totalM2"),
    t("commercial.packSize"),
    t("commercial.pricePerM2"),
    t("commercial.pricePerPack"),
    t("commercial.packsFloor"),
    t("commercial.packsSkirting"),
    t("commercial.totalPacks"),
    t("skirting.type"),
    t("skirting.pieces"),
    t("skirting.pricePerPiece"),
    t("skirting.cost"),
    t("commercial.totalCost")
  ];

  const roomsRows = [];
  for (const floor of state.floors || []) {
    for (const room of (floor.rooms || [])) {
      const grand = computeGrandTotals(state, room);
      if (!grand.ok) continue;
      const pricing = getRoomPricing(state, room);
      const skirting = computeSkirtingNeeds(state, room);
      roomsRows.push([
        floor.name || "",
        room.name || "",
        room.tile?.reference || t("commercial.defaultMaterial"),
        grand.netAreaM2,
        grand.floorTiles,
        grand.skirtingTiles,
        "",
        calcTileAreaM2(room),
        "",
        pricing.packM2,
        pricing.pricePerM2,
        "",
        "",
        "",
        "",
        skirting.type || room.skirting?.type || "cutout",
        skirting.count || 0,
        Number(room.skirting?.boughtPricePerPiece) || 0,
        "",
        ""
      ]);
    }
  }
  roomsRows.push([
    t("commercial.grandTotal"),
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    ""
  ]);
  const roomsSheet = XLSX.utils.aoa_to_sheet([roomsHeader, ...roomsRows]);

  const materialsHeader = [
    t("tile.reference"),
    t("commercial.floorTiles"),
    t("commercial.skirtingTiles"),
    t("commercial.totalTiles"),
    t("commercial.tileAreaM2"),
    t("commercial.totalM2"),
    t("commercial.packSize"),
    t("commercial.pricePerM2"),
    t("commercial.pricePerPack"),
    t("commercial.amountOverride"),
    t("commercial.totalPacks"),
    t("commercial.skirtingCostBought"),
    t("commercial.totalCost")
  ];

  const materialRows = (proj.materials || []).map((m) => {
    const ref = m.reference || t("commercial.defaultMaterial");
    return [
      ref,
      "",
      "",
      "",
      tileAreaForRef.get(ref) || 0,
      "",
      m.packM2,
      m.pricePerM2,
      "",
      m.extraPacks,
      "",
      "",
      ""
    ];
  });
  materialRows.push([
    t("commercial.grandTotal"),
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    ""
  ]);
  const materialsSheet = XLSX.utils.aoa_to_sheet([materialsHeader, ...materialRows]);

  const skirtingHeader = [
    t("tabs.floor"),
    t("tabs.room"),
    t("tile.reference"),
    t("pdf.dimensions"),
    t("skirting.pieces"),
    t("skirting.type"),
    t("skirting.pricePerPiece"),
    t("commercial.tileAreaM2"),
    t("commercial.pricePerM2"),
    t("metrics.totalTiles"),
    t("commercial.totalCost")
  ];

  const skirtingRows = [];
  for (const floor of state.floors || []) {
    for (const room of (floor.rooms || [])) {
      const skirting = computeSkirtingNeeds(state, room);
      if (!skirting || !skirting.enabled) continue;
      skirtingRows.push([
        floor.name || "",
        room.name || "",
        room.tile?.reference || t("commercial.defaultMaterial"),
        skirting.totalLengthCm || 0,
        skirting.count || 0,
        skirting.type || room.skirting?.type || "cutout",
        Number(room.skirting?.boughtPricePerPiece) || 0,
        calcTileAreaM2(room),
        getRoomPricing(state, room).pricePerM2,
        skirting.additionalTiles || 0,
        ""
      ]);
    }
  }
  skirtingRows.push([
    t("commercial.grandTotal"),
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    ""
  ]);
  const skirtingSheet = XLSX.utils.aoa_to_sheet([skirtingHeader, ...skirtingRows]);

  XLSX.utils.book_append_sheet(wb, introSheet, introName);
  XLSX.utils.book_append_sheet(wb, summarySheet, summaryName);
  XLSX.utils.book_append_sheet(wb, roomsSheet, roomsName);
  XLSX.utils.book_append_sheet(wb, materialsSheet, materialsName);
  XLSX.utils.book_append_sheet(wb, skirtingSheet, skirtingName);

  const setFormula = (sheet, rowIndex, colIndex, formula) => {
    const cell = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
    sheet[cell] = sheet[cell] || {};
    sheet[cell].f = formula;
    sheet[cell].t = "n";
  };

  const lastRow = (sheet) => {
    const ref = sheet["!ref"];
    if (!ref) return 1;
    const range = XLSX.utils.decode_range(ref);
    return range.e.r + 1;
  };

  const setNumberFormat = (sheet, fromRow, toRow, colIndices, format) => {
    for (let r = fromRow; r <= toRow; r++) {
      for (const c of colIndices) {
        const cellRef = XLSX.utils.encode_cell({ r, c });
        if (!sheet[cellRef]) continue;
        sheet[cellRef].z = format;
      }
    }
  };

  const setAutoFilter = (sheet, lastCol, lastRowIndex) => {
    sheet["!autofilter"] = { ref: `A1:${lastCol}${lastRowIndex}` };
  };


  const roomsLast = lastRow(roomsSheet);
  for (let r = 2; r <= roomsLast - 1; r++) {
    setFormula(roomsSheet, r - 1, 6, `E${r}+F${r}`);
    setFormula(roomsSheet, r - 1, 8, `G${r}*H${r}`);
    setFormula(roomsSheet, r - 1, 11, `J${r}*K${r}`);
    setFormula(roomsSheet, r - 1, 12, `IF(J${r}>0,CEILING(D${r}/J${r},1),0)`);
    setFormula(roomsSheet, r - 1, 13, `IF(J${r}>0,CEILING((F${r}*H${r})/J${r},1),0)`);
    setFormula(roomsSheet, r - 1, 14, `M${r}+N${r}`);
    setFormula(roomsSheet, r - 1, 18, `IF(P${r}=\"bought\",Q${r}*R${r},F${r}*H${r}*K${r})`);
    setFormula(roomsSheet, r - 1, 19, `D${r}*K${r}+S${r}`);
  }
  if (roomsLast > 2) {
    const totalRow = roomsLast;
    setFormula(roomsSheet, totalRow - 1, 3, `SUM(D2:D${totalRow - 1})`);
    setFormula(roomsSheet, totalRow - 1, 4, `SUM(E2:E${totalRow - 1})`);
    setFormula(roomsSheet, totalRow - 1, 5, `SUM(F2:F${totalRow - 1})`);
    setFormula(roomsSheet, totalRow - 1, 6, `SUM(G2:G${totalRow - 1})`);
    setFormula(roomsSheet, totalRow - 1, 8, `SUM(I2:I${totalRow - 1})`);
    setFormula(roomsSheet, totalRow - 1, 12, `SUM(M2:M${totalRow - 1})`);
    setFormula(roomsSheet, totalRow - 1, 13, `SUM(N2:N${totalRow - 1})`);
    setFormula(roomsSheet, totalRow - 1, 14, `SUM(O2:O${totalRow - 1})`);
    setFormula(roomsSheet, totalRow - 1, 18, `SUM(S2:S${totalRow - 1})`);
    setFormula(roomsSheet, totalRow - 1, 19, `SUM(T2:T${totalRow - 1})`);
  }

  const matsLast = lastRow(materialsSheet);
  for (let r = 2; r <= matsLast - 1; r++) {
    setFormula(materialsSheet, r - 1, 1, `SUMIFS('${roomsName}'!E:E,'${roomsName}'!C:C,A${r})`);
    setFormula(materialsSheet, r - 1, 2, `SUMIFS('${roomsName}'!F:F,'${roomsName}'!C:C,A${r})`);
    setFormula(materialsSheet, r - 1, 3, `B${r}+C${r}`);
    setFormula(materialsSheet, r - 1, 5, `D${r}*E${r}`);
    setFormula(materialsSheet, r - 1, 8, `G${r}*H${r}`);
    setFormula(materialsSheet, r - 1, 10, `IF(G${r}>0,CEILING(F${r}/G${r},1)+J${r},J${r})`);
    setFormula(materialsSheet, r - 1, 11, `SUMIFS('${roomsName}'!S:S,'${roomsName}'!C:C,A${r},'${roomsName}'!P:P,\"bought\")`);
    setFormula(materialsSheet, r - 1, 12, `SUMIFS('${roomsName}'!T:T,'${roomsName}'!C:C,A${r})+J${r}*I${r}`);
  }
  if (matsLast > 2) {
    const totalRow = matsLast;
    setFormula(materialsSheet, totalRow - 1, 1, `SUM(B2:B${totalRow - 1})`);
    setFormula(materialsSheet, totalRow - 1, 2, `SUM(C2:C${totalRow - 1})`);
    setFormula(materialsSheet, totalRow - 1, 3, `SUM(D2:D${totalRow - 1})`);
    setFormula(materialsSheet, totalRow - 1, 5, `SUM(F2:F${totalRow - 1})`);
    setFormula(materialsSheet, totalRow - 1, 10, `SUM(K2:K${totalRow - 1})`);
    setFormula(materialsSheet, totalRow - 1, 11, `SUM(L2:L${totalRow - 1})`);
    setFormula(materialsSheet, totalRow - 1, 12, `SUM(M2:M${totalRow - 1})`);
  }

  const skirtLast = lastRow(skirtingSheet);
  for (let r = 2; r <= skirtLast - 1; r++) {
    setFormula(skirtingSheet, r - 1, 10, `IF(F${r}=\"bought\",E${r}*G${r},J${r}*H${r}*I${r})`);
  }
  if (skirtLast > 2) {
    const totalRow = skirtLast;
    setFormula(skirtingSheet, totalRow - 1, 3, `SUM(D2:D${totalRow - 1})`);
    setFormula(skirtingSheet, totalRow - 1, 4, `SUM(E2:E${totalRow - 1})`);
    setFormula(skirtingSheet, totalRow - 1, 9, `SUM(J2:J${totalRow - 1})`);
    setFormula(skirtingSheet, totalRow - 1, 10, `SUM(K2:K${totalRow - 1})`);
  }

  const matsDataLast = Math.max(2, matsLast - 1);
  setFormula(summarySheet, 0, 1, `SUM('${materialsName}'!F2:F${matsDataLast})`);
  setFormula(summarySheet, 1, 1, `SUM('${materialsName}'!D2:D${matsDataLast})`);
  setFormula(summarySheet, 2, 1, `SUM('${materialsName}'!K2:K${matsDataLast})`);
  setFormula(summarySheet, 3, 1, `SUM('${materialsName}'!M2:M${matsDataLast})`);
  setFormula(summarySheet, 4, 1, `B4`);

  // Formats and layout (readability)
  const fmtInt = "0";
  const fmtNum2 = "0.00";
  const fmtNum3 = "0.000";
  const fmtCurrency = "€ #,##0.00";

  setNumberFormat(summarySheet, 0, 4, [1], fmtNum2);
  setNumberFormat(summarySheet, 1, 1, [1], fmtInt);
  setNumberFormat(summarySheet, 2, 2, [1], fmtInt);
  setNumberFormat(summarySheet, 3, 4, [1], fmtCurrency);
  summarySheet["!cols"] = [{ wch: 28 }, { wch: 18 }];

  introSheet["!cols"] = [{ wch: 120 }];

  setNumberFormat(roomsSheet, 1, roomsLast - 1, [3], fmtNum2); // net area
  setNumberFormat(roomsSheet, 1, roomsLast - 1, [4, 5, 6], fmtInt); // tiles
  setNumberFormat(roomsSheet, 1, roomsLast - 1, [7], fmtNum3); // tile area
  setNumberFormat(roomsSheet, 1, roomsLast - 1, [8], fmtNum2); // total m2
  setNumberFormat(roomsSheet, 1, roomsLast - 1, [9], fmtNum2); // pack size
  setNumberFormat(roomsSheet, 1, roomsLast - 1, [10, 11], fmtCurrency); // price/m2 + price/pack
  setNumberFormat(roomsSheet, 1, roomsLast - 1, [12, 13, 14], fmtInt); // packs
  setNumberFormat(roomsSheet, 1, roomsLast - 1, [16], fmtInt); // skirting pieces
  setNumberFormat(roomsSheet, 1, roomsLast - 1, [17, 18, 19], fmtCurrency); // skirting cost + total cost
  roomsSheet["!cols"] = [
    { wch: 18 }, { wch: 24 }, { wch: 24 }, { wch: 12 }, { wch: 12 },
    { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 },
    { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 12 },
    { wch: 12 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 14 }
  ];
  setAutoFilter(roomsSheet, "T", roomsLast);

  setNumberFormat(materialsSheet, 1, matsLast - 1, [1, 2, 3], fmtInt); // tiles
  setNumberFormat(materialsSheet, 1, matsLast - 1, [4], fmtNum3); // tile area
  setNumberFormat(materialsSheet, 1, matsLast - 1, [5, 6], fmtNum2); // total m2 + pack size
  setNumberFormat(materialsSheet, 1, matsLast - 1, [7, 8], fmtCurrency); // price m2/pack
  setNumberFormat(materialsSheet, 1, matsLast - 1, [9, 10], fmtInt); // extra packs + total packs
  setNumberFormat(materialsSheet, 1, matsLast - 1, [11, 12], fmtCurrency); // bought skirting + total cost
  materialsSheet["!cols"] = [
    { wch: 24 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 12 },
    { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 12 },
    { wch: 12 }, { wch: 16 }, { wch: 16 }
  ];
  setAutoFilter(materialsSheet, "M", matsLast);

  setNumberFormat(skirtingSheet, 1, skirtLast - 1, [3], fmtNum2); // length cm
  setNumberFormat(skirtingSheet, 1, skirtLast - 1, [4], fmtInt); // pieces
  setNumberFormat(skirtingSheet, 1, skirtLast - 1, [6], fmtCurrency); // price per piece
  setNumberFormat(skirtingSheet, 1, skirtLast - 1, [7], fmtNum3); // tile area
  setNumberFormat(skirtingSheet, 1, skirtLast - 1, [8], fmtCurrency); // price per m2
  setNumberFormat(skirtingSheet, 1, skirtLast - 1, [9], fmtInt); // tiles
  setNumberFormat(skirtingSheet, 1, skirtLast - 1, [10], fmtCurrency); // total cost
  skirtingSheet["!cols"] = [
    { wch: 18 }, { wch: 24 }, { wch: 24 }, { wch: 14 }, { wch: 10 },
    { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 12 },
    { wch: 14 }
  ];
  setAutoFilter(skirtingSheet, "K", skirtLast);

  return { wb, introName, summaryName, roomsName, materialsName, skirtingName, XLSX };
}

export async function exportCommercialXlsx(state, options) {
  const { wb, XLSX } = await buildCommercialXlsxWorkbook(state);
  const baseName = sanitizeFilename(`${state.project?.name || "plan"}_commercial_${dateStamp()}`);
  XLSX.writeFile(wb, `${baseName}.xlsx`);
}
