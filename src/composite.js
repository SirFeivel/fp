import polygonClipping from "polygon-clipping";
import { uuid } from "./core.js";

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
    // Return all sections, regardless of properties like skirtingEnabled
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

  const w = Number(room.widthCm);
  const h = Number(room.heightCm);
  if (w > 0 && h > 0) {
    return [
      {
        id: "main",
        label: "Main Area",
        x: 0,
        y: 0,
        widthCm: w,
        heightCm: h,
        skirtingEnabled: !!room.skirting?.enabled,
      },
    ];
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
      title: "No room sections",
      text: "At least one room section is required",
    });
    return { errors, warnings };
  }

  let validCount = 0;
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    const label = s.label || `Section ${i + 1}`;

    if (!(s.widthCm > 0)) {
      errors.push({
        title: `Invalid width in ${label}`,
        text: `Section width must be positive (got ${s.widthCm})`,
      });
    }

    if (!(s.heightCm > 0)) {
      errors.push({
        title: `Invalid height in ${label}`,
        text: `Section height must be positive (got ${s.heightCm})`,
      });
    }

    if (s.widthCm > 0 && s.heightCm > 0) {
      validCount++;
    }
  }

  if (validCount === 0) {
    errors.push({
      title: "No valid sections",
      text: "At least one section must have positive width and height",
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

export function createDefaultSection(x = 0, y = 0, widthCm = 300, heightCm = 300) {
  return {
    id: uuid(),
    label: "",
    x,
    y,
    widthCm,
    heightCm,
  };
}

export function suggestConnectedSection(existingSections, direction = "right") {
  if (!existingSections || existingSections.length === 0) {
    return createDefaultSection();
  }

  const lastSection = existingSections[existingSections.length - 1];
  const w = lastSection.widthCm || 300;
  const h = lastSection.heightCm || 300;
  const x = lastSection.x || 0;
  const y = lastSection.y || 0;

  let newX = x;
  let newY = y;
  let newW = w;
  let newH = h;

  switch (direction) {
    case "right":
      newX = x + w;
      newY = y;
      newW = Math.min(w, 300);
      newH = h;
      break;
    case "left":
      newX = x - Math.min(w, 300);
      newY = y;
      newW = Math.min(w, 300);
      newH = h;
      break;
    case "bottom":
      newX = x;
      newY = y + h;
      newW = w;
      newH = Math.min(h, 300);
      break;
    case "top":
      newX = x;
      newY = y - Math.min(h, 300);
      newW = w;
      newH = Math.min(h, 300);
      break;
    default:
      newX = x + w;
      newY = y;
      newW = Math.min(w, 300);
      newH = h;
  }

  return createDefaultSection(newX, newY, newW, newH);
}
