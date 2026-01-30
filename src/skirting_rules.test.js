import { describe, it, expect } from "vitest";
import { enforceCutoutForPresetRooms } from "./skirting_rules.js";

describe("enforceCutoutForPresetRooms", () => {
  it("switches rooms back to cutout when preset is re-enabled", () => {
    const state = {
      floors: [
        {
          rooms: [
            {
              tile: { reference: "Preset A" },
              skirting: { enabled: true, type: "bought" }
            },
            {
              tile: { reference: "Preset B" },
              skirting: { enabled: true, type: "bought" }
            }
          ]
        }
      ]
    };

    enforceCutoutForPresetRooms(state, "Preset A");
    expect(state.floors[0].rooms[0].skirting.type).toBe("cutout");
    expect(state.floors[0].rooms[1].skirting.type).toBe("bought");
  });
});
