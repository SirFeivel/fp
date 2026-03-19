// src/render-commercial.js
import { computeProjectTotals } from "./calc.js";
import { getRoomBounds } from "./geometry.js";
import { t } from "./i18n.js";

export function renderCommercialTab(state) {
  const roomsListEl = document.getElementById("commercialRoomsList");
  const materialsListEl = document.getElementById("commercialMaterialsList");
  if (!roomsListEl || !materialsListEl) return;

  const proj = computeProjectTotals(state);

  // ── 1. Usage by location ──────────────────────────────────────────────────
  roomsListEl.replaceChildren();

  // Section: floor rooms
  const roomsTable = document.createElement("table");
  roomsTable.className = "commercial-table";
  const roomsHeaders = [
    { label: t("tabs.floor") },
    { label: t("tabs.room") },
    { label: t("commercial.sourceFloor"), align: "center" },
    { label: t("tile.reference") },
    { label: t("metrics.netArea"), align: "right" },
    { label: t("metrics.totalTiles"), align: "right" },
    { label: t("metrics.price"), align: "right" }
  ];
  roomsTable.appendChild(_thead(roomsHeaders));
  const roomsTbody = document.createElement("tbody");
  for (const r of proj.rooms) {
    const tr = document.createElement("tr");
    _td(tr, r.floorName || "", "subtle");
    _td(tr, r.name || "", "room-name");
    _tdCenter(tr, t("commercial.sourceFloor"), "source-tag source-floor");
    _td(tr, r.reference || "–", "material-ref");
    _tdRight(tr, `${r.netAreaM2.toFixed(2)} m²`);
    _tdRight(tr, String(r.totalTiles));
    _tdRight(tr, `${r.totalCost.toFixed(2)} €`);
    roomsTbody.appendChild(tr);
  }

  // Wall surface rows inline (visually distinct)
  for (const ws of (proj.wallRooms || [])) {
    const tr = document.createElement("tr");
    tr.className = "commercial-wall-row";
    _td(tr, ws.floorName || "", "subtle");
    _td(tr, ws.roomName || "", "room-name");
    _tdCenter(tr, t("commercial.sourceWall"), "source-tag source-wall");
    _td(tr, ws.reference || "–", "material-ref");
    _tdRight(tr, `${ws.areaM2.toFixed(2)} m²`);
    _tdRight(tr, String(ws.tiles));
    _tdRight(tr, `${ws.cost.toFixed(2)} €`);
    roomsTbody.appendChild(tr);
  }

  // Sub-surface rows (tiled exclusions on floor and wall surfaces)
  for (const ss of (proj.subSurfaceRooms || [])) {
    const tr = document.createElement("tr");
    tr.className = "commercial-wall-row";
    _td(tr, ss.floorName || "", "subtle");
    _td(tr, ss.roomName || "", "room-name");
    _tdCenter(tr, t("commercial.sourceSubSurface"), "source-tag source-sub");
    _td(tr, ss.reference || "–", "material-ref");
    _tdRight(tr, `${ss.areaM2.toFixed(2)} m²`);
    _tdRight(tr, String(ss.tiles));
    _tdRight(tr, `${ss.cost.toFixed(2)} €`);
    roomsTbody.appendChild(tr);
  }

  roomsTable.appendChild(roomsTbody);
  roomsListEl.appendChild(roomsTable);

  // ── 2. Consolidated materials ─────────────────────────────────────────────
  materialsListEl.replaceChildren();
  const matsTable = document.createElement("table");
  matsTable.className = "commercial-table";
  const matsHeaders = [
    { label: t("tile.reference") },
    { label: t("commercial.totalM2"), align: "right" },
    { label: t("commercial.totalTiles"), align: "right" },
    { label: t("commercial.totalPacks"), align: "right" },
    { label: t("commercial.packsFloor"), align: "right" },
    { label: t("commercial.packsSkirting"), align: "right" },
    { label: t("commercial.packsWall"), align: "right" },
    { label: t("commercial.amountOverride"), align: "right" },
    { label: t("commercial.pricePerM2"), align: "right" },
    { label: t("commercial.pricePerPack"), align: "right" },
    { label: t("commercial.packSize"), align: "right" },
    { label: t("commercial.totalCost"), align: "right" }
  ];
  matsTable.appendChild(_thead(matsHeaders));
  const matsTbody = document.createElement("tbody");

  for (const m of proj.materials) {
    const ref = m.reference || "";
    const pricePerPack = (m.pricePerM2 * m.packM2).toFixed(2);
    const wallAndSubPacks = (m.wallPacks || 0) + (m.subSurfacePacks || 0);
    const tr = document.createElement("tr");

    _td(tr, ref || t("commercial.defaultMaterial"), "material-ref");
    _tdRight(tr, `${m.netAreaM2.toFixed(2)} m²`);
    _tdRight(tr, String(m.totalTiles));

    // Total packs — bold
    const packsTd = document.createElement("td");
    packsTd.style.textAlign = "right";
    const packsStrong = document.createElement("strong");
    packsStrong.textContent = String(m.totalPacks || 0);
    packsTd.appendChild(packsStrong);
    tr.appendChild(packsTd);

    _tdRight(tr, String(m.floorPacks || 0));
    _tdRight(tr, String(m.skirtingPacks || 0));
    _tdRight(tr, wallAndSubPacks > 0 ? String(wallAndSubPacks) : "–");

    // Editable: extra packs
    const extraTd = document.createElement("td");
    extraTd.style.textAlign = "right";
    const extraInput = _editInput("number", "1", ref, "extraPacks", String(m.extraPacks), "40px");
    extraTd.appendChild(extraInput);
    tr.appendChild(extraTd);

    // Editable: price/m²
    const priceM2Td = document.createElement("td");
    priceM2Td.style.textAlign = "right";
    const priceM2Input = _editInput("number", "0.01", ref, "pricePerM2", m.pricePerM2.toFixed(2), "60px");
    const priceM2Unit = document.createElement("span");
    priceM2Unit.textContent = " €";
    priceM2Td.append(priceM2Input, priceM2Unit);
    tr.appendChild(priceM2Td);

    // Editable: price/pack
    const pricePackTd = document.createElement("td");
    pricePackTd.style.textAlign = "right";
    const pricePackInput = _editInput("number", "0.01", ref, "pricePerPack", pricePerPack, "60px");
    const pricePackUnit = document.createElement("span");
    pricePackUnit.textContent = " €";
    pricePackTd.append(pricePackInput, pricePackUnit);
    tr.appendChild(pricePackTd);

    // Editable: pack size
    const packSizeTd = document.createElement("td");
    packSizeTd.style.textAlign = "right";
    const packSizeInput = _editInput("number", "0.01", ref, "packM2", String(m.packM2), null);
    const packSizeUnit = document.createElement("span");
    packSizeUnit.textContent = " m²";
    packSizeTd.append(packSizeInput, packSizeUnit);
    tr.appendChild(packSizeTd);

    // Total cost — bold
    const costTd = document.createElement("td");
    costTd.style.textAlign = "right";
    const costStrong = document.createElement("strong");
    costStrong.textContent = `${m.adjustedCost.toFixed(2)} €`;
    costTd.appendChild(costStrong);
    tr.appendChild(costTd);

    matsTbody.appendChild(tr);
  }

  // Grand total row
  const totalRow = document.createElement("tr");
  totalRow.style.borderTop = "2px solid var(--line2)";
  totalRow.style.fontWeight = "bold";
  const totalLabel = document.createElement("td");
  totalLabel.textContent = t("commercial.grandTotal");
  const totalArea = document.createElement("td");
  totalArea.style.textAlign = "right";
  totalArea.textContent = `${proj.totalNetAreaM2.toFixed(2)} m²`;
  const totalTiles = document.createElement("td");
  totalTiles.style.textAlign = "right";
  totalTiles.textContent = String(proj.totalTiles);
  const totalPacks = document.createElement("td");
  totalPacks.style.textAlign = "right";
  totalPacks.textContent = String(proj.totalPacks);
  const totalSpacer = document.createElement("td");
  totalSpacer.colSpan = 7; // floor + skirting + wall + override + price/m² + price/pack + pack size
  const totalCost = document.createElement("td");
  totalCost.style.textAlign = "right";
  totalCost.style.color = "var(--accent)";
  totalCost.textContent = `${proj.totalCost.toFixed(2)} €`;
  totalRow.append(totalLabel, totalArea, totalTiles, totalPacks, totalSpacer, totalCost);
  matsTbody.appendChild(totalRow);
  matsTable.appendChild(matsTbody);
  materialsListEl.appendChild(matsTable);
}

export function renderExportTab(state, selection = null) {
  const listEl = document.getElementById("exportRoomsList");
  if (!listEl) return;

  listEl.replaceChildren();

  const floors = state.floors || [];
  const roomCount = floors.reduce((sum, floor) => sum + (floor.rooms?.length || 0), 0);
  const btnRoomsPdf = document.getElementById("btnExportRoomsPdf");
  const btnCommercialPdf = document.getElementById("btnExportCommercialPdf");
  const btnCommercialXlsx = document.getElementById("btnExportCommercialXlsx");

  if (btnRoomsPdf) btnRoomsPdf.disabled = roomCount === 0;
  if (btnCommercialPdf) btnCommercialPdf.disabled = roomCount === 0;
  if (btnCommercialXlsx) btnCommercialXlsx.disabled = roomCount === 0;

  if (!floors.length || roomCount === 0) {
    const empty = document.createElement("div");
    empty.className = "subtle";
    empty.textContent = t("export.noRoomsSelected");
    listEl.appendChild(empty);
    return;
  }

  const hasSelection = selection instanceof Set;

  for (const floor of floors) {
    if (!floor.rooms || floor.rooms.length === 0) continue;

    const group = document.createElement("div");
    group.className = "export-room-group";

    const title = document.createElement("div");
    title.className = "export-room-group-title";
    title.textContent = floor.name || t("tabs.floor");
    group.appendChild(title);

    for (const room of floor.rooms) {
      const row = document.createElement("div");
      row.className = "export-room-item";

      const labelWrap = document.createElement("div");
      labelWrap.className = "export-room-label";

      const name = document.createElement("div");
      name.className = "export-room-name";
      name.textContent = room.name || t("tabs.room");

      const meta = document.createElement("div");
      meta.className = "export-room-meta";
      const bounds = getRoomBounds(room);
      if (bounds.width > 0 && bounds.height > 0) {
        meta.textContent = `${Math.round(bounds.width)} x ${Math.round(bounds.height)} cm`;
      } else {
        meta.textContent = "–";
      }

      labelWrap.append(name, meta);

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "checkbox export-room-checkbox";
      checkbox.dataset.roomId = room.id;
      checkbox.checked = hasSelection ? selection.has(room.id) : true;

      row.append(checkbox, labelWrap);
      group.appendChild(row);
    }

    listEl.appendChild(group);
  }
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

function _thead(headers) {
  const thead = document.createElement("thead");
  const tr = document.createElement("tr");
  for (const { label, align } of headers) {
    const th = document.createElement("th");
    th.textContent = label;
    if (align) th.style.textAlign = align;
    tr.appendChild(th);
  }
  thead.appendChild(tr);
  return thead;
}

function _td(tr, text, className) {
  const td = document.createElement("td");
  if (className) td.className = className;
  td.textContent = text;
  tr.appendChild(td);
}

function _tdRight(tr, text) {
  const td = document.createElement("td");
  td.style.textAlign = "right";
  td.textContent = text;
  tr.appendChild(td);
}

function _tdCenter(tr, text, className) {
  const td = document.createElement("td");
  td.style.textAlign = "center";
  if (className) td.className = className;
  td.textContent = text;
  tr.appendChild(td);
}

function _editInput(type, step, ref, prop, value, width) {
  const input = document.createElement("input");
  input.type = type;
  input.step = step;
  input.className = "commercial-edit";
  input.dataset.ref = ref;
  input.dataset.prop = prop;
  input.value = value;
  if (width) input.style.width = width;
  return input;
}
