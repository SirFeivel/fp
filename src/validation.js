/**
 * @typedef {{title: string, text: string}} ValidationMessage
 * @typedef {{errors: ValidationMessage[], warns: ValidationMessage[]}} ValidationResult
 */

import { t } from "./i18n.js";
import { getCurrentRoom } from "./core.js";

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

  const currentRoom = getCurrentRoom(s);
  const roomW = currentRoom?.widthCm;
  const roomH = currentRoom?.heightCm;

  if (!currentRoom) {
    errors.push({
      title: t("validation.noRoomSelected"),
      text: t("validation.selectRoom")
    });
  } else {
    if (!n(roomW) || roomW <= 0)
      errors.push({
        title: t("validation.roomWidthInvalid"),
        text: `${t("validation.currentValue")} "${roomW}". ${t("validation.roomWidthText")}`
      });
    if (!n(roomH) || roomH <= 0)
      errors.push({
        title: t("validation.roomHeightInvalid"),
        text: `${t("validation.currentValue")} "${roomH}". ${t("validation.roomHeightText")}`
      });
  }

  const tileW = currentRoom?.tile?.widthCm;
  const tileH = currentRoom?.tile?.heightCm;
  const grout = currentRoom?.grout?.widthCm;
  if (!n(tileW) || tileW <= 0)
    errors.push({
      title: t("validation.tileWidthInvalid"),
      text: `${t("validation.currentValue")} "${tileW}". ${t("validation.tileWidthText")}`
    });
  if (!n(tileH) || tileH <= 0)
    errors.push({
      title: t("validation.tileHeightInvalid"),
      text: `${t("validation.currentValue")} "${tileH}". ${t("validation.tileHeightText")}`
    });
  if (!n(grout) || grout < 0)
    errors.push({
      title: t("validation.groutInvalid"),
      text: `${t("validation.currentValue")} "${grout}". ${t("validation.groutText")}`
    });

  const rot = currentRoom?.pattern?.rotationDeg;
  if (n(rot) && (rot % 45 !== 0 || rot < 0 || rot >= 360)) {
    warns.push({
      title: t("validation.rotationWarning"),
      text: t("validation.rotationText")
    });
  }

  if (currentRoom && Array.isArray(currentRoom.exclusions)) {
    for (const ex of currentRoom.exclusions) {
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
            title: t("exclusions.outside"),
            text: `${ex.label || ex.type} ${t("validation.exclOutside")}`
          });
        }
      }
    }
  }

  return { errors, warns };
}