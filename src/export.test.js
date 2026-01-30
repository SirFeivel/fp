import { describe, it, expect } from "vitest";
import { sanitizeFilename, buildRoomExportModel, buildCommercialExportModel } from "./export.js";
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
  });

  it("builds commercial export model", () => {
    const state = defaultState();
    const model = buildCommercialExportModel(state);
    expect(model.summary.totalTiles).toBeGreaterThan(0);
    expect(Array.isArray(model.rooms)).toBe(true);
    expect(Array.isArray(model.materials)).toBe(true);
  });
});
