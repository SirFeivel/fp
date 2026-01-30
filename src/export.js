import { jsPDF } from "jspdf";
import { svg2pdf } from "svg2pdf.js";
import { computePlanMetrics, computeSkirtingNeeds, computeProjectTotals, computeGrandTotals, getRoomPricing } from "./calc.js";
import { t } from "./i18n.js";
import { getCurrentRoom, DEFAULT_SKIRTING_PRESET } from "./core.js";
import { renderPlanSvg } from "./render.js";
import { getRalMatch } from "./ral.js";

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
      width: Math.round(room.sections?.[0]?.widthCm || 0),
      length: Math.round(room.sections?.[0]?.heightCm || 0)
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
    for (const room of floor.rooms || []) {
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
    for (const room of floor.rooms || []) {
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
  const { format, orientation } = getPageSize(options);
  const doc = new jsPDF({ unit: "pt", format, orientation });
  const model = buildCommercialExportModel(state);

  doc.setFontSize(16);
  doc.text(t("export.commercial"), 40, 40);

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  const cards = [
    { label: t("metrics.totalArea"), value: `${model.summary.totalAreaM2.toFixed(2)} m²` },
    { label: t("metrics.totalTiles"), value: String(model.summary.totalTiles) },
    { label: t("commercial.totalPacks"), value: String(model.summary.totalPacks) },
    { label: t("commercial.totalCost"), value: model.summary.totalCost.toFixed(2) },
    { label: t("metrics.grandTotal"), value: model.summary.grandTotal.toFixed(2) }
  ];

  const cardWidth = (pageWidth - 100) / 3;
  let cx = 40;
  let cy = 70;
  doc.setFontSize(10);
  cards.forEach((card, idx) => {
    doc.setFillColor(16, 24, 40);
    doc.rect(cx, cy, cardWidth, 52, "F");
    doc.setTextColor(231);
    doc.text(card.label, cx + 8, cy + 18);
    doc.setFontSize(12);
    doc.text(card.value, cx + 8, cy + 38);
    doc.setFontSize(10);
    doc.setTextColor(30);
    cx += cardWidth + 10;
    if ((idx + 1) % 3 === 0) {
      cx = 40;
      cy += 62;
    }
  });

  let y = cy + 20;
  y = drawTable(
    doc,
    t("commercial.materials"),
    [t("tile.reference"), t("commercial.totalPacks"), t("commercial.totalCost")],
    model.materials.map((item) => ([
      item.reference || t("commercial.defaultMaterial"),
      String(item.totalPacks || 0),
      (item.adjustedCost || 0).toFixed(2)
    ])),
    y,
    pageHeight
  );

  y = drawTable(
    doc,
    t("commercial.rooms"),
    [t("pdf.room"), t("metrics.totalArea"), t("metrics.totalTiles"), t("commercial.totalPacks"), t("commercial.totalCost")],
    model.rooms.map((room) => ([
      `${room.floor} / ${room.room}`,
      room.areaM2.toFixed(2),
      String(room.tiles),
      String(room.packs),
      room.cost.toFixed(2)
    ])),
    y + 16,
    pageHeight
  );

  if (model.skirting.length) {
    drawTable(
      doc,
      t("pdf.skirting"),
      [t("pdf.room"), t("pdf.dimensions"), t("skirting.pieces"), t("commercial.totalCost")],
      model.skirting.map((row) => ([
        `${row.floor} / ${row.room}`,
        String(row.skirtingLengthCm),
        String(row.skirtingPieces),
        String((row.skirtingCost || 0).toFixed(2))
      ])),
      y + 16,
      pageHeight
    );
  }

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

export async function exportCommercialXlsx(state, options) {
  const XLSXModule = await import("xlsx");
  const XLSX = XLSXModule.default || XLSXModule;
  const model = buildCommercialExportModel(state);

  const wb = XLSX.utils.book_new();

  const summaryRows = [
    {
      totalAreaM2: model.summary.totalAreaM2,
      totalTiles: model.summary.totalTiles,
      totalPacks: model.summary.totalPacks,
      totalCost: model.summary.totalCost,
      grandTotal: model.summary.grandTotal
    }
  ];

  const materialRows = (model.materials || []).map((m) => ({
    reference: m.reference || t("commercial.defaultMaterial"),
    totalPacks: m.totalPacks || 0,
    totalCost: Number(m.adjustedCost || m.totalCost || 0)
  }));

  const roomRows = (model.rooms || []).map((r) => ({
    room: `${r.floor} / ${r.room}`,
    areaM2: r.areaM2,
    tiles: r.tiles,
    packs: r.packs,
    skirtingLengthCm: r.skirtingLengthCm,
    cost: r.cost
  }));

  const skirtingRows = (model.skirting || []).map((s) => ({
    room: `${s.floor} / ${s.room}`,
    lengthCm: s.skirtingLengthCm,
    pieces: s.skirtingPieces,
    cost: s.skirtingCost,
    type: s.skirtingType
  }));

  const summarySheet = XLSX.utils.json_to_sheet(summaryRows);
  const materialsSheet = XLSX.utils.json_to_sheet(materialRows);
  const roomsSheet = XLSX.utils.json_to_sheet(roomRows);
  const skirtingSheet = XLSX.utils.json_to_sheet(skirtingRows);

  const sheetName = (label) => sanitizeFilename(label).slice(0, 31) || "Sheet";

  XLSX.utils.book_append_sheet(wb, summarySheet, sheetName(t("export.summary")));
  XLSX.utils.book_append_sheet(wb, materialsSheet, sheetName(t("export.materials")));
  XLSX.utils.book_append_sheet(wb, roomsSheet, sheetName(t("export.rooms")));
  XLSX.utils.book_append_sheet(wb, skirtingSheet, sheetName(t("export.skirting")));

  const filename = sanitizeFilename(`${state.project?.name || "plan"}_commercial_${dateStamp()}.xlsx`);
  XLSX.writeFile(wb, filename);
}
