import polygonClipping from "polygon-clipping";

/**
 * Converts a rectangle to a polygon-clipping MultiPolygon format.
 * Useful for exclusions and other rectangle-based shapes.
 */
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

/**
 * Computes the union of multiple rectangular sections into a single MultiPolygon.
 * Used by migration code to convert old sections format to polygonVertices.
 * @deprecated This function is only used for migration from v7 to v8.
 */
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
