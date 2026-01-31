/**
 * @typedef {{title: string, text: string}} ValidationMessage
 * @typedef {{errors: ValidationMessage[], warns: ValidationMessage[]}} ValidationResult
 */

import { t } from "./i18n.js";
import { getCurrentRoom } from "./core.js";
import { getRoomSections, computeCompositeBounds, validateSections as validateSectionsGeometry } from "./composite.js";
import { getRoomBounds } from "./geometry.js";

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

  if (!currentRoom) {
    errors.push({
      title: t("validation.noRoomSelected"),
      text: t("validation.selectRoom")
    });
  } else {
    // Check if room is free-form (has polygonVertices) or sections-based
    const isFreeForm = currentRoom.polygonVertices && currentRoom.polygonVertices.length >= 3;
    const sections = getRoomSections(currentRoom);

    if (!isFreeForm && sections.length === 0) {
      // Only show error if room has neither valid polygon nor sections
      errors.push({
        title: t("validation.roomWidthInvalid"),
        text: t("validation.roomWidthText")
      });
    } else if (!isFreeForm && sections.length > 0) {
      // Validate sections for sections-based rooms
      const sectionsValidation = validateSectionsGeometry(sections);
      errors.push(...sectionsValidation.errors);
      warns.push(...sectionsValidation.warnings);
    }
    // Free-form rooms with valid polygonVertices pass validation
  }

  // Use getRoomBounds which handles both free-form and sections-based rooms
  const bounds = getRoomBounds(currentRoom);
  const roomW = bounds.width;
  const roomH = bounds.height;

  const tileW = currentRoom?.tile?.widthCm;
  const tileH = currentRoom?.tile?.heightCm;
  const grout = currentRoom?.grout?.widthCm;
  const ref = currentRoom?.tile?.reference;
  const preset = ref ? s.tilePresets?.find(p => p?.name && p.name === ref) : null;
  const hasPresetAssigned = Boolean(preset);
  if (!hasPresetAssigned) {
    warns.push({
      title: t("validation.tilePresetMissingTitle"),
      text: t("validation.tilePresetMissingText")
    });
  } else {
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
  }

  const patternType = currentRoom?.pattern?.type;
  if (hasPresetAssigned && (patternType === "herringbone" || patternType === "doubleHerringbone" || patternType === "basketweave")) {
    if (n(tileW) && n(tileH) && tileW > 0 && tileH > 0) {
      const L = Math.max(tileW, tileH);
      const W = Math.min(tileW, tileH);
      const ratio = L / W;
      const nearest = Math.round(ratio);
      const ratioEps = 1e-6;

      if (patternType === "doubleHerringbone") {
        const doubleRatio = L / (2 * W);
        const nearestDouble = Math.round(doubleRatio);
        if (Math.abs(doubleRatio - nearestDouble) > ratioEps) {
          const ratioText = `${ratio.toFixed(2)}:1`;
          errors.push({
            title: t("validation.doubleHerringboneRatioTitle"),
            text: `${t("validation.doubleHerringboneRatioText")} ${ratioText}.`
          });
        }
      } else if (patternType === "basketweave") {
        if (Math.abs(ratio - nearest) > ratioEps) {
          const ratioText = `${ratio.toFixed(2)}:1`;
          errors.push({
            title: t("validation.basketweaveRatioTitle"),
            text: `${t("validation.basketweaveRatioText")} ${ratioText}.`
          });
        }
      } else if (Math.abs(ratio - nearest) > ratioEps) {
        const ratioText = `${ratio.toFixed(2)}:1`;
        errors.push({
          title: t("validation.herringboneRatioTitle"),
          text: `${t("validation.herringboneRatioText")} ${ratioText}.`
        });
      }
    }
  }

  const rot = currentRoom?.pattern?.rotationDeg;
  if (n(rot) && (rot % 45 !== 0 || rot < 0 || rot >= 360)) {
    warns.push({
      title: t("validation.rotationWarning"),
      text: t("validation.rotationText")
    });
  }

  // Skirting validation
  const skirting = currentRoom?.skirting;
  if (skirting?.enabled) {
    if (!n(skirting.heightCm) || skirting.heightCm <= 0) {
      errors.push({
        title: t("skirting.changed"),
        text: t("skirting.height") + " " + t("validation.invalid")
      });
    }
    if (skirting.type === "bought") {
      if (!n(skirting.boughtWidthCm) || skirting.boughtWidthCm <= 0) {
        errors.push({
          title: t("skirting.changed"),
          text: t("skirting.boughtWidth") + " " + t("validation.invalid")
        });
      }
    }
  }

  const cutoutAllowed = Boolean(preset?.useForSkirting);
  if (hasPresetAssigned && skirting?.enabled && skirting?.type === "cutout" && !cutoutAllowed) {
    warns.push({
      title: t("skirting.cutoutNotAllowedTitle"),
      text: t("skirting.cutoutNotAllowedText")
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
