import { jsPDF } from "jspdf";
import { svg2pdf } from "svg2pdf.js";
import { computePlanMetrics, computeSkirtingNeeds, computeProjectTotals, computeGrandTotals, getRoomPricing } from "./calc.js";
import { t } from "./i18n.js";
import { getCurrentRoom, DEFAULT_SKIRTING_PRESET } from "./core.js";
import { renderPlanSvg } from "./render.js";

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
    includeExclusions: options.includeExclusions !== false
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

function layoutHeader(doc, model, options, pageWidth) {
  doc.setFontSize(12);
  doc.setTextColor(30);
  doc.text(`${t("pdf.projectName")}: ${model.projectName}`, 40, 40);
  doc.text(`${t("pdf.floor")}: ${model.floorName}`, 40, 58);
  doc.text(`${t("pdf.room")}: ${model.roomName}`, 40, 76);

  doc.setFontSize(10);
  doc.text(`${t("pdf.dimensions")}: ${model.roomDimensionsCm.width} x ${model.roomDimensionsCm.length} cm`, 40, 96);
  doc.text(`${t("pdf.area")}: ${model.roomAreaM2.toFixed(2)} m²`, 40, 112);
  if (options.scale && options.scale !== "fit") {
    doc.text(`${t("export.scale")}: ${options.scale}`, 40, 128);
  }

  const rightX = pageWidth - 220;
  doc.text(`${t("pdf.company")}: ____________________`, rightX, 40);
  doc.text(`${t("pdf.address")}: ____________________`, rightX, 58);
  doc.text(`${t("pdf.contact")}: ____________________`, rightX, 76);

  if (options.includeMetrics) {
    doc.text(`${t("metrics.totalTiles")}: ${model.metrics.tiles}`, rightX, 96);
    doc.text(`${t("commercial.totalPacks")}: ${model.metrics.packs}`, rightX, 112);
    doc.text(`${t("commercial.totalCost")}: ${model.metrics.cost.toFixed(2)}`, rightX, 128);
  }
}

function layoutFooter(doc, y, notes) {
  doc.setFontSize(9);
  doc.setTextColor(80);
  doc.text(`${t("pdf.generatedBy")} • ${dateStamp()}`, 40, y);
  if (notes) {
    doc.text(`${t("pdf.notes")}: ${notes}`, 40, y + 14);
  }
}

function layoutLegend(doc, x, y) {
  doc.setFontSize(9);
  doc.text(`${t("pdf.legend")}:`, x, y);
  doc.text(`— ${t("pdf.skirting")}`, x, y + 14);
  doc.text(`— ${t("export.includeExclusions")}`, x, y + 28);
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
  const minPageH = Math.max(pageHeight, planHeight + 240);

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
  const { format, orientation } = getPageSize(options);
  let doc = null;

  for (let i = 0; i < roomEntries.length; i++) {
    const { room } = roomEntries[i];
    const model = buildRoomExportModel(state, room.id);
    if (!model) continue;

    const basePage = doc
      ? { width: doc.internal.pageSize.getWidth(), height: doc.internal.pageSize.getHeight() }
      : { width: 0, height: 0 };
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
      doc = new jsPDF({ unit: "pt", format: pageFormat, orientation });
    } else {
      doc.addPage(pageFormat, orientation);
    }

    onProgress?.({ current: i + 1, total: roomEntries.length, roomId: room.id });

    layoutHeader(doc, model, options, doc.internal.pageSize.getWidth());

    const svgResult = renderPlanSvgForExport(state, room.id, options);
    const svg = svgResult.svg;
    const planX = 40;
    const planY = 140;
    const planWidth = scaleInfo.planWidth || (doc.internal.pageSize.getWidth() - 80);
    const planHeight = scaleInfo.planHeight || (doc.internal.pageSize.getHeight() - 240);

    const ok = await svgToPdf(doc, svg, planX, planY, planWidth, planHeight);
    if (!ok) {
      const dataUrl = await svgToPngDataUrl(svg, Math.round(planWidth), Math.round(planHeight));
      doc.addImage(dataUrl, "PNG", planX, planY, planWidth, planHeight);
    }

    svgResult.container.remove();

    if (options.includeLegend) {
      layoutLegend(doc, planX, doc.internal.pageSize.getHeight() - 90);
    }
    layoutFooter(doc, doc.internal.pageSize.getHeight() - 40, options.notes || "");
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
  const XLSX = await import("xlsx");
  const model = buildCommercialExportModel(state);

  const wb = XLSX.utils.book_new();

  const summarySheet = XLSX.utils.json_to_sheet([
    {
      totalAreaM2: model.summary.totalAreaM2,
      totalTiles: model.summary.totalTiles,
      totalPacks: model.summary.totalPacks,
      totalCost: model.summary.totalCost,
      grandTotal: model.summary.grandTotal
    }
  ]);

  const materialsSheet = XLSX.utils.json_to_sheet(model.materials || []);
  const roomsSheet = XLSX.utils.json_to_sheet(model.rooms || []);
  const skirtingSheet = XLSX.utils.json_to_sheet(model.skirting || []);

  const sheetName = (label) => sanitizeFilename(label).slice(0, 31) || "Sheet";

  XLSX.utils.book_append_sheet(wb, summarySheet, sheetName(t("export.summary")));
  XLSX.utils.book_append_sheet(wb, materialsSheet, sheetName(t("export.materials")));
  XLSX.utils.book_append_sheet(wb, roomsSheet, sheetName(t("export.rooms")));
  XLSX.utils.book_append_sheet(wb, skirtingSheet, sheetName(t("export.skirting")));

  const filename = sanitizeFilename(`${state.project?.name || "plan"}_commercial_${dateStamp()}.xlsx`);
  XLSX.writeFile(wb, filename);
}
