import { describe, it, expect } from "vitest";
import {
  rectToPolygon,
  getRoomSections,
  computeCompositePolygon,
  computeCompositeBounds,
  sectionsArea,
  validateSections,
  createDefaultSection,
  suggestConnectedSection,
} from "./composite.js";
import { t } from "./i18n.js";

describe("rectToPolygon", () => {
  it("converts rectangle to polygon format", () => {
    const poly = rectToPolygon(10, 20, 100, 50);
    expect(poly).toEqual([
      [
        [
          [10, 20],
          [110, 20],
          [110, 70],
          [10, 70],
          [10, 20],
        ],
      ],
    ]);
  });

  it("handles zero position", () => {
    const poly = rectToPolygon(0, 0, 50, 50);
    expect(poly[0][0][0]).toEqual([0, 0]);
    expect(poly[0][0][2]).toEqual([50, 50]);
  });
});

describe("getRoomSections", () => {
  it("returns sections array when room has sections", () => {
    const room = {
      sections: [
        { id: "s1", label: "Main", x: 0, y: 0, widthCm: 400, heightCm: 300 },
        { id: "s2", label: "Extension", x: 400, y: 0, widthCm: 200, heightCm: 300 },
      ],
    };
    const sections = getRoomSections(room);
    expect(sections).toHaveLength(2);
    expect(sections[0].id).toBe("s1");
    expect(sections[1].widthCm).toBe(200);
  });

  it("returns empty array for null room", () => {
    expect(getRoomSections(null)).toEqual([]);
  });

  it("returns empty array for room with no sections", () => {
    const room = { widthCm: 600, heightCm: 400 };
    expect(getRoomSections(room)).toEqual([]);
  });

  it("normalizes section data types", () => {
    const room = {
      sections: [
        { id: "s1", x: "10", y: "20", widthCm: "300", heightCm: "200" },
      ],
    };
    const sections = getRoomSections(room);
    expect(sections[0].x).toBe(10);
    expect(sections[0].widthCm).toBe(300);
  });

  it("generates id if missing", () => {
    const room = {
      sections: [
        { label: "Test", x: 0, y: 0, widthCm: 100, heightCm: 100 },
      ],
    };
    const sections = getRoomSections(room);
    expect(sections[0].id).toBeDefined();
    expect(typeof sections[0].id).toBe("string");
  });
});

describe("computeCompositePolygon", () => {
  it("creates polygon from single section", () => {
    const sections = [{ id: "s1", x: 0, y: 0, widthCm: 400, heightCm: 300 }];
    const { mp, error } = computeCompositePolygon(sections);
    expect(error).toBeNull();
    expect(mp).toBeDefined();
    expect(mp.length).toBeGreaterThan(0);
  });

  it("unions multiple adjacent sections", () => {
    const sections = [
      { id: "s1", x: 0, y: 0, widthCm: 400, heightCm: 300 },
      { id: "s2", x: 400, y: 0, widthCm: 200, heightCm: 300 },
    ];
    const { mp, error } = computeCompositePolygon(sections);
    expect(error).toBeNull();
    expect(mp).toBeDefined();
    expect(mp.length).toBe(1);
  });

  it("handles L-shaped room", () => {
    const sections = [
      { id: "main", x: 0, y: 0, widthCm: 400, heightCm: 300 },
      { id: "extension", x: 0, y: 300, widthCm: 200, heightCm: 200 },
    ];
    const { mp, error } = computeCompositePolygon(sections);
    expect(error).toBeNull();
    expect(mp).toBeDefined();
    expect(mp.length).toBe(1);
  });

  it("handles T-shaped room", () => {
    const sections = [
      { id: "left", x: 0, y: 0, widthCm: 200, heightCm: 300 },
      { id: "center", x: 200, y: 0, widthCm: 200, heightCm: 300 },
      { id: "right", x: 400, y: 0, widthCm: 200, heightCm: 300 },
      { id: "stem", x: 200, y: 300, widthCm: 200, heightCm: 200 },
    ];
    const { mp, error } = computeCompositePolygon(sections);
    expect(error).toBeNull();
    expect(mp).toBeDefined();
    expect(mp.length).toBe(1);
  });

  it("detects disconnected sections", () => {
    const sections = [
      { id: "s1", x: 0, y: 0, widthCm: 200, heightCm: 200 },
      { id: "s2", x: 300, y: 300, widthCm: 200, heightCm: 200 },
    ];
    const { mp, error } = computeCompositePolygon(sections);
    expect(error).toBeNull();
    expect(mp).toBeDefined();
    expect(mp.length).toBe(2);
  });

  it("filters out invalid sections", () => {
    const sections = [
      { id: "s1", x: 0, y: 0, widthCm: 400, heightCm: 300 },
      { id: "s2", x: 0, y: 0, widthCm: 0, heightCm: 0 },
    ];
    const { mp, error } = computeCompositePolygon(sections);
    expect(error).toBeNull();
    expect(mp).toBeDefined();
  });

  it("returns error for empty sections", () => {
    const { mp, error } = computeCompositePolygon([]);
    expect(mp).toBeNull();
    expect(error).toBeTruthy();
  });

  it("returns error for all invalid sections", () => {
    const sections = [
      { id: "s1", x: 0, y: 0, widthCm: 0, heightCm: 0 },
    ];
    const { mp, error } = computeCompositePolygon(sections);
    expect(mp).toBeNull();
    expect(error).toBeTruthy();
  });

  it("handles overlapping sections", () => {
    const sections = [
      { id: "s1", x: 0, y: 0, widthCm: 300, heightCm: 300 },
      { id: "s2", x: 200, y: 0, widthCm: 300, heightCm: 300 },
    ];
    const { mp, error } = computeCompositePolygon(sections);
    expect(error).toBeNull();
    expect(mp).toBeDefined();
    expect(mp.length).toBe(1);
  });
});

describe("computeCompositeBounds", () => {
  it("computes bounds for single section", () => {
    const sections = [{ id: "s1", x: 10, y: 20, widthCm: 400, heightCm: 300 }];
    const bounds = computeCompositeBounds(sections);
    expect(bounds.minX).toBe(10);
    expect(bounds.minY).toBe(20);
    expect(bounds.maxX).toBe(410);
    expect(bounds.maxY).toBe(320);
    expect(bounds.width).toBe(400);
    expect(bounds.height).toBe(300);
  });

  it("computes bounds for multiple sections", () => {
    const sections = [
      { id: "s1", x: 0, y: 0, widthCm: 400, heightCm: 300 },
      { id: "s2", x: 400, y: 0, widthCm: 200, heightCm: 300 },
    ];
    const bounds = computeCompositeBounds(sections);
    expect(bounds.minX).toBe(0);
    expect(bounds.minY).toBe(0);
    expect(bounds.maxX).toBe(600);
    expect(bounds.maxY).toBe(300);
    expect(bounds.width).toBe(600);
    expect(bounds.height).toBe(300);
  });

  it("handles negative coordinates", () => {
    const sections = [
      { id: "s1", x: -100, y: -50, widthCm: 200, heightCm: 150 },
      { id: "s2", x: 100, y: 100, widthCm: 200, heightCm: 150 },
    ];
    const bounds = computeCompositeBounds(sections);
    expect(bounds.minX).toBe(-100);
    expect(bounds.minY).toBe(-50);
    expect(bounds.maxX).toBe(300);
    expect(bounds.maxY).toBe(250);
  });

  it("returns zero bounds for empty sections", () => {
    const bounds = computeCompositeBounds([]);
    expect(bounds.width).toBe(0);
    expect(bounds.height).toBe(0);
  });

  it("ignores invalid sections", () => {
    const sections = [
      { id: "s1", x: 0, y: 0, widthCm: 400, heightCm: 300 },
      { id: "s2", x: 0, y: 0, widthCm: 0, heightCm: 0 },
    ];
    const bounds = computeCompositeBounds(sections);
    expect(bounds.width).toBe(400);
    expect(bounds.height).toBe(300);
  });
});

describe("sectionsArea", () => {
  it("computes area for single section", () => {
    const sections = [{ id: "s1", x: 0, y: 0, widthCm: 400, heightCm: 300 }];
    const area = sectionsArea(sections);
    expect(area).toBe(120000);
  });

  it("computes area for adjacent sections without double-counting", () => {
    const sections = [
      { id: "s1", x: 0, y: 0, widthCm: 400, heightCm: 300 },
      { id: "s2", x: 400, y: 0, widthCm: 200, heightCm: 300 },
    ];
    const area = sectionsArea(sections);
    expect(area).toBe(180000);
  });

  it("computes area for L-shaped room", () => {
    const sections = [
      { id: "main", x: 0, y: 0, widthCm: 400, heightCm: 300 },
      { id: "extension", x: 0, y: 300, widthCm: 200, heightCm: 200 },
    ];
    const area = sectionsArea(sections);
    expect(area).toBe(160000);
  });

  it("handles overlapping sections correctly", () => {
    const sections = [
      { id: "s1", x: 0, y: 0, widthCm: 300, heightCm: 300 },
      { id: "s2", x: 200, y: 0, widthCm: 300, heightCm: 300 },
    ];
    const area = sectionsArea(sections);
    const expectedArea = 300 * 300 + 200 * 300;
    expect(area).toBe(expectedArea);
  });

  it("returns 0 for empty sections", () => {
    expect(sectionsArea([])).toBe(0);
  });

  it("returns 0 for invalid sections", () => {
    const sections = [{ id: "s1", x: 0, y: 0, widthCm: 0, heightCm: 0 }];
    expect(sectionsArea(sections)).toBe(0);
  });
});

describe("validateSections", () => {
  it("passes validation for valid single section", () => {
    const sections = [{ id: "s1", x: 0, y: 0, widthCm: 400, heightCm: 300 }];
    const { errors, warnings } = validateSections(sections);
    expect(errors).toHaveLength(0);
  });

  it("passes validation for valid connected sections", () => {
    const sections = [
      { id: "s1", x: 0, y: 0, widthCm: 400, heightCm: 300 },
      { id: "s2", x: 400, y: 0, widthCm: 200, heightCm: 300 },
    ];
    const { errors, warnings } = validateSections(sections);
    expect(errors).toHaveLength(0);
  });

  it("warns about disconnected sections", () => {
    const sections = [
      { id: "s1", x: 0, y: 0, widthCm: 200, heightCm: 200 },
      { id: "s2", x: 300, y: 300, widthCm: 200, heightCm: 200 },
    ];
    const { errors, warnings } = validateSections(sections);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.some((w) => w.title.includes("Disconnected"))).toBe(true);
  });

  it("errors for empty sections array", () => {
    const { errors } = validateSections([]);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.title.includes(t("validation.roomWidthInvalid")))).toBe(true);
  });

  it("errors for invalid width", () => {
    const sections = [{ id: "s1", x: 0, y: 0, widthCm: 0, heightCm: 300 }];
    const { errors } = validateSections(sections);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.title.includes(t("validation.roomWidthInvalid")))).toBe(true);
  });

  it("errors for invalid height", () => {
    const sections = [{ id: "s1", x: 0, y: 0, widthCm: 400, heightCm: 0 }];
    const { errors } = validateSections(sections);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.title.includes(t("validation.roomHeightInvalid")))).toBe(true);
  });

  it("errors when all sections are invalid", () => {
    const sections = [
      { id: "s1", x: 0, y: 0, widthCm: 0, heightCm: 0 },
      { id: "s2", x: 0, y: 0, widthCm: -100, heightCm: 200 },
    ];
    const { errors } = validateSections(sections);
    expect(errors.some((e) => e.title.includes(t("validation.roomWidthInvalid")))).toBe(true);
  });
});

describe("createDefaultSection", () => {
  it("creates section with default values", () => {
    const section = createDefaultSection();
    expect(section.id).toBeDefined();
    expect(section.x).toBe(0);
    expect(section.y).toBe(0);
    expect(section.widthCm).toBe(300);
    expect(section.heightCm).toBe(300);
  });

  it("creates section with custom values", () => {
    const section = createDefaultSection(100, 200, 400, 500);
    expect(section.x).toBe(100);
    expect(section.y).toBe(200);
    expect(section.widthCm).toBe(400);
    expect(section.heightCm).toBe(500);
  });

  it("generates unique IDs", () => {
    const s1 = createDefaultSection();
    const s2 = createDefaultSection();
    expect(s1.id).not.toBe(s2.id);
  });
});

describe("suggestConnectedSection", () => {
  it("creates section to the right by default", () => {
    const existing = [{ id: "s1", x: 0, y: 0, widthCm: 400, heightCm: 300 }];
    const suggested = suggestConnectedSection(existing, "right");
    expect(suggested.x).toBe(400);
    expect(suggested.y).toBe(0);
    expect(suggested.heightCm).toBe(300);
  });

  it("creates section to the left", () => {
    const existing = [{ id: "s1", x: 400, y: 0, widthCm: 400, heightCm: 300 }];
    const suggested = suggestConnectedSection(existing, "left");
    // New section placed at left edge of composite bounds
    // newW = min(300, 400*0.5) = 200, newX = 400 - 200 = 200
    expect(suggested.x).toBe(200);
    expect(suggested.y).toBe(0);
    expect(suggested.heightCm).toBe(300);
  });

  it("creates section at bottom", () => {
    const existing = [{ id: "s1", x: 0, y: 0, widthCm: 400, heightCm: 300 }];
    const suggested = suggestConnectedSection(existing, "bottom");
    expect(suggested.x).toBe(0);
    expect(suggested.y).toBe(300);
    expect(suggested.widthCm).toBe(400);
  });

  it("creates section at top", () => {
    const existing = [{ id: "s1", x: 0, y: 300, widthCm: 400, heightCm: 300 }];
    const suggested = suggestConnectedSection(existing, "top");
    // New section placed at top edge of composite bounds
    // newH = min(300, 300*0.5) = 150, newY = 300 - 150 = 150
    expect(suggested.x).toBe(0);
    expect(suggested.y).toBe(150);
    expect(suggested.widthCm).toBe(400);
    expect(suggested.heightCm).toBe(150);
  });

  it("creates default section when no existing sections", () => {
    const suggested = suggestConnectedSection([]);
    expect(suggested.x).toBe(0);
    expect(suggested.y).toBe(0);
    expect(suggested.widthCm).toBe(300);
    expect(suggested.heightCm).toBe(300);
    expect(suggested.label).toBe(`${t("room.sectionTitle")} 1`);
  });

  it("suggests incremented room labels", () => {
    const existing = [
      { id: "s1", x: 0, y: 0, widthCm: 300, heightCm: 300 },
      { id: "s2", x: 300, y: 0, widthCm: 300, heightCm: 300 },
    ];
    const suggested = suggestConnectedSection(existing, "right");
    expect(suggested.label).toBe(`${t("room.sectionTitle")} 3`);
  });

  it("limits suggested dimension to 300cm max", () => {
    const existing = [{ id: "s1", x: 0, y: 0, widthCm: 800, heightCm: 600 }];
    const suggested = suggestConnectedSection(existing, "right");
    expect(suggested.widthCm).toBe(300);
    expect(suggested.heightCm).toBe(600);
  });
});
