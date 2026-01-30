import { describe, it, expect } from "vitest";
import { sanitizeFilename, buildRoomExportModel, buildCommercialExportModel, computeRoomPdfLayout } from "./export.js";
import { defaultState } from "./core.js";

describe("export helpers", () => {
  it("sanitizes filenames", () => {
    expect(sanitizeFilename("My Project 2026/01")).toBe("My_Project_2026_01");
    expect(sanitizeFilename("__###")).toBe("export");
  });

  it("builds room export model", () => {
    const state = defaultState();
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
    const state = defaultState();
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
});
