/**
 * @typedef {{title: string, text: string}} ValidationMessage
 * @typedef {{errors: ValidationMessage[], warns: ValidationMessage[]}} ValidationResult
 */

/**
 * Calculate bounding box for an exclusion shape
 * @param {Object} ex - Exclusion object
 * @returns {{minX: number, minY: number, maxX: number, maxY: number} | null}
 */
function exclusionBounds(ex) {
  if (!ex) return null;
  if (ex.type === "rect")
    return { minX: ex.x, minY: ex.y, maxX: ex.x + ex.w, maxY: ex.y + ex.h };
  if (ex.type === "circle")
    return {
      minX: ex.cx - ex.r,
      minY: ex.cy - ex.r,
      maxX: ex.cx + ex.r,
      maxY: ex.cy + ex.r
    };
  if (ex.type === "tri") {
    const xs = [ex.p1.x, ex.p2.x, ex.p3.x];
    const ys = [ex.p1.y, ex.p2.y, ex.p3.y];
    return {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys)
    };
  }
  return null;
}

/**
 * Validate application state
 * @param {Object} s - Application state
 * @returns {ValidationResult} Validation errors and warnings
 */
export function validateState(s) {
  const errors = [];
  const warns = [];
  const n = (v) => typeof v === "number" && Number.isFinite(v);

  const roomW = s?.room?.widthCm,
    roomH = s?.room?.heightCm;
  if (!n(roomW) || roomW <= 0)
    errors.push({
      title: "Raumbreite ungültig",
      text: `Aktueller Wert: "${roomW}". Muss eine positive Zahl > 0 sein.`
    });
  if (!n(roomH) || roomH <= 0)
    errors.push({
      title: "Raumlänge ungültig",
      text: `Aktueller Wert: "${roomH}". Muss eine positive Zahl > 0 sein.`
    });

  const tileW = s?.tile?.widthCm,
    tileH = s?.tile?.heightCm;
  const grout = s?.grout?.widthCm;
  if (!n(tileW) || tileW <= 0)
    errors.push({
      title: "Fliesenbreite ungültig",
      text: `Aktueller Wert: "${tileW}". Muss eine positive Zahl > 0 sein.`
    });
  if (!n(tileH) || tileH <= 0)
    errors.push({
      title: "Fliesenlänge ungültig",
      text: `Aktueller Wert: "${tileH}". Muss eine positive Zahl > 0 sein.`
    });
  if (!n(grout) || grout < 0)
    errors.push({
      title: "Fuge ungültig",
      text: `Aktueller Wert: "${grout}". Muss eine Zahl ≥ 0 sein.`
    });

  const rot = s?.pattern?.rotationDeg;
  if (n(rot) && (rot % 45 !== 0 || rot < 0 || rot >= 360)) {
    warns.push({
      title: "Rotation außerhalb 45° Raster",
      text: "MVP: 0..315 in 45°-Schritten."
    });
  }

  if (Array.isArray(s.exclusions)) {
    for (const ex of s.exclusions) {
      if (!ex?.id || !ex?.type) continue;
      const out = exclusionBounds(ex);
      if (out && n(roomW) && n(roomH)) {
        if (
          out.minX < 0 ||
          out.minY < 0 ||
          out.maxX > roomW ||
          out.maxY > roomH
        ) {
          warns.push({
            title: "Ausschluss außerhalb Raum",
            text: `${ex.label || ex.type} liegt teilweise außerhalb.`
          });
        }
      }
    }
  }

  return { errors, warns };
}