import { describe, it, expect } from "vitest";
import {
  sanitizeFilename,
  buildRoomExportModel,
  buildCommercialExportModel,
  computeRoomPdfLayout,
  buildCommercialRoomsTable,
  buildCommercialMaterialsTable,
  buildCommercialXlsxWorkbook
} from "./export.js";
import { defaultStateWithRoom } from "./core.js";
import { computeProjectTotals } from "./calc.js";
import fs from "node:fs";
import path from "node:path";

describe("export helpers", () => {
  it("sanitizes filenames", () => {
    expect(sanitizeFilename("My Project 2026/01")).toBe("My_Project_2026_01");
    expect(sanitizeFilename("__###")).toBe("export");
  });

  it("builds room export model", () => {
    const state = defaultStateWithRoom();
    const room = state.floors[0].rooms[0];
    const model = buildRoomExportModel(state, room.id);
    expect(model.projectName).toBe(state.project.name);
    expect(model.roomName).toBe(room.name);
    expect(model.tile.reference).toBe("Standard");
    expect(model.skirtingPieces).toBeGreaterThanOrEqual(0);
    expect(model.skirtingLengthCm).toBeGreaterThanOrEqual(0);
    expect(model.pattern.originLabel).toBeDefined();
    expect(model.grout.colorHex).toMatch(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  });

  it("builds commercial export model", () => {
    const state = defaultStateWithRoom();
    const model = buildCommercialExportModel(state);
    expect(model.summary.totalTiles).toBeGreaterThan(0);
    expect(Array.isArray(model.rooms)).toBe(true);
    expect(Array.isArray(model.materials)).toBe(true);
  });

  it("computes room pdf layout with dominant plan area", () => {
    const layout = computeRoomPdfLayout({
      pageWidth: 595,
      pageHeight: 842,
      leftLineCount: 6,
      rightLineCount: 6
    });
    expect(layout.planWidth).toBe(595 - 80);
    expect(layout.planHeight).toBeGreaterThan(842 * 0.6);
    expect(layout.legendWidth).toBeGreaterThan(300);
    expect(layout.legendHeight).toBe(10);
    expect(layout.planY).toBeGreaterThan(layout.boxY);
  });

  it("builds commercial rooms table matching UI columns", () => {
    const state = defaultStateWithRoom();
    const proj = computeProjectTotals(state);
    const table = buildCommercialRoomsTable(proj);
    expect(table.columns.length).toBe(6);
    table.columns.forEach((col) => {
      expect(typeof col.label).toBe("string");
      expect(col.label.length).toBeGreaterThan(0);
    });
    expect(table.rows.length).toBe(proj.rooms.length);
  });

  it("builds commercial materials table with totals row", () => {
    const state = defaultStateWithRoom();
    const proj = computeProjectTotals(state);
    const table = buildCommercialMaterialsTable(proj);
    expect(table.columns.length).toBe(11);
    expect(table.rows.at(-1)?.isTotal).toBe(true);
  });

  it("builds excel workbook with formulas for edge case state", async () => {
    const fixturePath = path.join(process.cwd(), "src/__fixtures__/export_excel_edgecase.json");
    const state = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
    const { wb, roomsName, materialsName, summaryName, introName, wallSurfacesName, XLSX } = await buildCommercialXlsxWorkbook(state);

    expect(wb.Sheets[introName]).toBeDefined();
    expect(wb.Sheets[summaryName]).toBeDefined();
    expect(wb.Sheets[roomsName]).toBeDefined();
    expect(wb.Sheets[materialsName]).toBeDefined();

    const roomsSheet = wb.Sheets[roomsName];
    expect(roomsSheet["G2"]?.f).toBe("E2+F2");
    expect(roomsSheet["I2"]?.f).toBe("G2*H2");
    expect(roomsSheet["L2"]?.f).toBe("J2*K2");
    expect(roomsSheet["M2"]?.f).toBe("IF(J2>0,CEILING(D2/J2,1),0)");
    expect(roomsSheet["N2"]?.f).toBe("IF(J2>0,CEILING((F2*H2)/J2,1),0)");
    expect(roomsSheet["O2"]?.f).toBe("M2+N2");
    expect(roomsSheet["S2"]?.f).toBe("IF(P2=\"bought\",Q2*R2,F2*H2*K2)");
    expect(roomsSheet["T2"]?.f).toBe("D2*K2+S2");

    const matsSheet = wb.Sheets[materialsName];
    expect(matsSheet["B2"]?.f).toContain(roomsName);  // floorTiles
    expect(matsSheet["C2"]?.f).toContain(roomsName);  // skirtingTiles
    expect(matsSheet["D2"]?.f).toContain(wallSurfacesName); // wallTiles ← new col
    expect(matsSheet["E2"]?.f).toBe("B2+C2+D2");     // totalTiles
    expect(matsSheet["G2"]?.f).toBe("E2*F2");         // totalM2
    expect(matsSheet["J2"]?.f).toBe("H2*I2");         // pricePerPack
    expect(matsSheet["L2"]?.f).toBe("IF(H2>0,CEILING(G2/H2,1)+K2,K2)"); // totalPacks
    expect(matsSheet["M2"]?.f).toContain(roomsName);  // skirtingCostBought
    expect(matsSheet["N2"]?.f).toContain("K2*I2");    // totalCost

    const matsRange = XLSX.utils.decode_range(matsSheet["!ref"]);
    const matsLastRow = matsRange.e.r + 1;
    const matsTotalCell = `N${matsLastRow}`;
    expect(matsSheet[matsTotalCell]?.f).toBe(`SUM(N2:N${matsLastRow - 1})`);

    const summarySheet = wb.Sheets[summaryName];
    expect(summarySheet["B1"]?.f).toContain(materialsName);
    expect(summarySheet["B4"]?.f).toContain(materialsName);
  });
});
