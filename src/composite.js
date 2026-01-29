import polygonClipping from "polygon-clipping";
import { uuid } from "./core.js";
import { t } from "./i18n.js";

export function rectToPolygon(x, y, w, h) {
  const x1 = x;
  const y1 = y;
  const x2 = x + w;
  const y2 = y + h;
  return [
    [
      [
        [x1, y1],
        [x2, y1],
        [x2, y2],
        [x1, y2],
        [x1, y1],
      ],
    ],
  ];
}

export function getRoomSections(room) {
  if (!room) return [];

  if (room.sections && Array.isArray(room.sections) && room.sections.length > 0) {
    return room.sections.map(s => ({
      ...s,
      id: s.id || uuid(),
      label: s.label || "",
      x: Number(s.x) || 0,
      y: Number(s.y) || 0,
      widthCm: Number(s.widthCm) || 0,
      heightCm: Number(s.heightCm) || 0,
    }));
  }

  return [];
}

export function computeCompositePolygon(sections) {
  if (!sections || sections.length === 0) {
    return { mp: null, error: "No sections defined" };
  }

  const validSections = sections.filter(s => s.widthCm > 0 && s.heightCm > 0);
  if (validSections.length === 0) {
    return { mp: null, error: "No valid sections" };
  }

  const polys = validSections.map(s =>
    rectToPolygon(s.x, s.y, s.widthCm, s.heightCm)
  );

  try {
    const mp = polygonClipping.union(...polys);
    return { mp, error: null };
  } catch (e) {
    return { mp: null, error: String(e?.message || e) };
  }
}

export function computeCompositeBounds(sections) {
  if (!sections || sections.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const s of sections) {
    if (!(s.widthCm > 0 && s.heightCm > 0)) continue;

    const x1 = s.x;
    const y1 = s.y;
    const x2 = s.x + s.widthCm;
    const y2 = s.y + s.heightCm;

    minX = Math.min(minX, x1);
    minY = Math.min(minY, y1);
    maxX = Math.max(maxX, x2);
    maxY = Math.max(maxY, y2);
  }

  if (!Number.isFinite(minX)) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

export function sectionsArea(sections) {
  if (!sections || sections.length === 0) return 0;

  const validSections = sections.filter(s => s.widthCm > 0 && s.heightCm > 0);
  if (validSections.length === 0) return 0;

  const { mp } = computeCompositePolygon(validSections);
  if (!mp || !mp.length) return 0;

  let area = 0;
  for (const poly of mp) {
    if (!poly.length) continue;
    const outer = Math.abs(ringArea(poly[0] || []));
    let holes = 0;
    for (let i = 1; i < poly.length; i++) {
      holes += Math.abs(ringArea(poly[i] || []));
    }
    area += Math.max(0, outer - holes);
  }
  return area;
}

function ringArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

export function validateSections(sections) {
  const errors = [];
  const warnings = [];

  if (!sections || sections.length === 0) {
    errors.push({
      title: t("validation.roomWidthInvalid"),
      text: t("validation.roomWidthText"),
    });
    return { errors, warnings };
  }

  let validCount = 0;
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    const label = s.label || `Section ${i + 1}`;

    if (!(s.widthCm > 0)) {
      errors.push({
        title: t("validation.roomWidthInvalid") + ` (${label})`,
        text: t("validation.roomWidthText"),
      });
    }

    if (!(s.heightCm > 0)) {
      errors.push({
        title: t("validation.roomHeightInvalid") + ` (${label})`,
        text: t("validation.roomHeightText"),
      });
    }

    if (s.widthCm > 0 && s.heightCm > 0) {
      validCount++;
    }
  }

  if (validCount === 0) {
    errors.push({
      title: t("validation.roomWidthInvalid"),
      text: t("validation.roomWidthText"),
    });
  }

  if (sections.length > 1) {
    const { mp } = computeCompositePolygon(sections);
    if (!mp || mp.length === 0) {
      warnings.push({
        title: "Sections may not connect properly",
        text: "The room sections could not be combined into a valid shape",
      });
    } else if (mp.length > 1) {
      warnings.push({
        title: "Disconnected sections",
        text: `Room has ${mp.length} separate areas that don't connect`,
      });
    }
  }

  return { errors, warnings };
}

export function createDefaultSection(x = 0, y = 0, widthCm = 300, heightCm = 300, label = "") {
  return {
    id: uuid(),
    label,
    x,
    y,
    widthCm,
    heightCm,
  };
}

export function suggestConnectedSection(existingSections, direction = "right") {
  const nextNumber = (existingSections?.length || 0) + 1;
  const label = `${t("room.sectionTitle")} ${nextNumber}`;

  if (!existingSections || existingSections.length === 0) {
    return createDefaultSection(0, 0, 300, 300, label);
  }

  // Compute composite bounds to position new section at the edge of the entire shape
  const bounds = computeCompositeBounds(existingSections);
  const { minX, minY, maxX, maxY, width, height } = bounds;

  // Find sections at each edge to determine appropriate dimensions
  const eps = 0.01;
  const sectionsAtRight = existingSections.filter(s => Math.abs((s.x + s.widthCm) - maxX) < eps);
  const sectionsAtLeft = existingSections.filter(s => Math.abs(s.x - minX) < eps);
  const sectionsAtBottom = existingSections.filter(s => Math.abs((s.y + s.heightCm) - maxY) < eps);
  const sectionsAtTop = existingSections.filter(s => Math.abs(s.y - minY) < eps);

  let newX = 0;
  let newY = 0;
  let newW = 300;
  let newH = 300;

  switch (direction) {
    case "right": {
      // Place at right edge of composite, spanning the height of sections at that edge
      const edgeMinY = Math.min(...sectionsAtRight.map(s => s.y));
      const edgeMaxY = Math.max(...sectionsAtRight.map(s => s.y + s.heightCm));
      newX = maxX;
      newY = edgeMinY;
      newW = Math.min(300, width * 0.5);
      newH = edgeMaxY - edgeMinY;
      break;
    }
    case "left": {
      // Place at left edge of composite
      const edgeMinY = Math.min(...sectionsAtLeft.map(s => s.y));
      const edgeMaxY = Math.max(...sectionsAtLeft.map(s => s.y + s.heightCm));
      newW = Math.min(300, width * 0.5);
      newX = minX - newW;
      newY = edgeMinY;
      newH = edgeMaxY - edgeMinY;
      break;
    }
    case "bottom": {
      // Place at bottom edge of composite
      const edgeMinX = Math.min(...sectionsAtBottom.map(s => s.x));
      const edgeMaxX = Math.max(...sectionsAtBottom.map(s => s.x + s.widthCm));
      newX = edgeMinX;
      newY = maxY;
      newW = edgeMaxX - edgeMinX;
      newH = Math.min(300, height * 0.5);
      break;
    }
    case "top": {
      // Place at top edge of composite
      const edgeMinX = Math.min(...sectionsAtTop.map(s => s.x));
      const edgeMaxX = Math.max(...sectionsAtTop.map(s => s.x + s.widthCm));
      newH = Math.min(300, height * 0.5);
      newX = edgeMinX;
      newY = minY - newH;
      newW = edgeMaxX - edgeMinX;
      break;
    }
    default: {
      // Default to right
      newX = maxX;
      newY = minY;
      newW = Math.min(300, width * 0.5);
      newH = height;
    }
  }

  return createDefaultSection(newX, newY, newW, newH, label);
}
