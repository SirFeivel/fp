// src/background.js
// Background image controller for floor layout tracing

import { t } from "./i18n.js";
import { deepClone, getCurrentFloor } from "./core.js";

/**
 * Creates a background controller for handling floor background images.
 * Supports image upload, calibration, and opacity control.
 */
export function createBackgroundController({ store, renderAll, updateMeta }) {
  let calibrationState = null;

  /**
   * Reads a file as a data URL.
   */
  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  /**
   * Validates and processes an uploaded file.
   * Returns the data URL for images, or renders PDF first page for PDFs.
   */
  async function processUploadedFile(file) {
    const isImage = file.type.startsWith("image/");
    const isPdf = file.type === "application/pdf";

    if (!isImage && !isPdf) {
      throw new Error(t("background.invalidType") || "Invalid file type. Please upload an image or PDF.");
    }

    const dataUrl = await readFileAsDataUrl(file);

    // For PDF files, we would need pdf.js to render to canvas
    // For now, just return the dataUrl (PDF rendering can be added later)
    if (isPdf) {
      console.warn("PDF rendering not yet implemented. Treating as image.");
    }

    return { dataUrl, filename: file.name };
  }

  /**
   * Sets the background image for the current floor.
   */
  function setBackground(dataUrl, filename) {
    const state = store.getState();
    const next = deepClone(state);
    const floor = getCurrentFloor(next);

    if (!floor) {
      console.warn("No floor selected");
      return;
    }

    floor.layout = floor.layout || { enabled: false, background: null };
    floor.layout.enabled = true;
    floor.layout.background = {
      dataUrl,
      filename,
      scale: { calibrated: false, pixelsPerCm: null, referenceLengthCm: null, referencePixels: null },
      position: { x: 0, y: 0 },
      opacity: 0.5,
      locked: false
    };

    store.commit(t("floor.backgroundUploaded") || "Background uploaded", next, {
      onRender: renderAll,
      updateMetaCb: updateMeta
    });
  }

  /**
   * Removes the background image from the current floor.
   */
  function removeBackground() {
    const state = store.getState();
    const next = deepClone(state);
    const floor = getCurrentFloor(next);

    if (!floor) return;

    if (floor.layout) {
      floor.layout.background = null;
    }

    store.commit(t("floor.backgroundRemoved") || "Background removed", next, {
      onRender: renderAll,
      updateMetaCb: updateMeta
    });
  }

  /**
   * Updates the background opacity.
   */
  function updateOpacity(opacity) {
    const state = store.getState();
    const next = deepClone(state);
    const floor = getCurrentFloor(next);

    if (!floor?.layout?.background) return;

    floor.layout.background.opacity = Math.max(0, Math.min(1, opacity));

    store.commit(t("floor.opacityChanged") || "Opacity changed", next, {
      onRender: renderAll,
      updateMetaCb: updateMeta
    });
  }

  /**
   * Toggles the background lock state.
   */
  function toggleLock() {
    const state = store.getState();
    const next = deepClone(state);
    const floor = getCurrentFloor(next);

    if (!floor?.layout?.background) return;

    floor.layout.background.locked = !floor.layout.background.locked;

    store.commit(t("floor.lockToggled") || "Background lock toggled", next, {
      onRender: renderAll,
      updateMetaCb: updateMeta
    });
  }

  /**
   * Updates the background position.
   */
  function updatePosition(x, y) {
    const state = store.getState();
    const next = deepClone(state);
    const floor = getCurrentFloor(next);

    if (!floor?.layout?.background) return;

    floor.layout.background.position = { x, y };

    store.commit(t("floor.positionChanged") || "Background position changed", next, {
      onRender: renderAll,
      updateMetaCb: updateMeta
    });
  }

  /**
   * Starts calibration mode.
   * User needs to click two points on the image and provide the known distance.
   */
  function startCalibration(svg, onComplete) {
    if (calibrationState) {
      cancelCalibration();
    }

    calibrationState = {
      svg,
      startPoint: null,
      endPoint: null,
      line: null,
      markers: [],
      onComplete
    };

    // Change cursor
    svg.style.cursor = "crosshair";

    // Add click handler
    calibrationState.clickHandler = (e) => handleCalibrationClick(e);
    svg.addEventListener("click", calibrationState.clickHandler);

    return true;
  }

  /**
   * Handles click during calibration.
   */
  function handleCalibrationClick(e) {
    if (!calibrationState) return;

    const svg = calibrationState.svg;
    const rect = svg.getBoundingClientRect();
    const viewBox = svg.viewBox.baseVal;

    // Convert screen coordinates to SVG coordinates
    const scaleX = viewBox.width / rect.width;
    const scaleY = viewBox.height / rect.height;
    const svgX = viewBox.x + (e.clientX - rect.left) * scaleX;
    const svgY = viewBox.y + (e.clientY - rect.top) * scaleY;

    if (!calibrationState.startPoint) {
      // First click - set start point
      calibrationState.startPoint = { x: svgX, y: svgY };

      // Draw marker
      const marker = createCalibrationMarker(svg, svgX, svgY);
      calibrationState.markers.push(marker);
    } else {
      // Second click - set end point and calculate
      calibrationState.endPoint = { x: svgX, y: svgY };

      // Draw marker
      const marker = createCalibrationMarker(svg, svgX, svgY);
      calibrationState.markers.push(marker);

      // Draw line
      const line = createCalibrationLine(svg, calibrationState.startPoint, calibrationState.endPoint);
      calibrationState.line = line;

      // Calculate pixel distance
      const dx = calibrationState.endPoint.x - calibrationState.startPoint.x;
      const dy = calibrationState.endPoint.y - calibrationState.startPoint.y;
      const pixelDistance = Math.sqrt(dx * dx + dy * dy);

      // Prompt user for known length
      promptForKnownLength(pixelDistance);
    }
  }

  /**
   * Creates a calibration marker at the given point.
   */
  function createCalibrationMarker(svg, x, y) {
    const ns = "http://www.w3.org/2000/svg";
    const size = 6;

    const g = document.createElementNS(ns, "g");
    g.setAttribute("class", "calibration-marker");

    // Crosshair
    const h = document.createElementNS(ns, "line");
    h.setAttribute("x1", x - size);
    h.setAttribute("y1", y);
    h.setAttribute("x2", x + size);
    h.setAttribute("y2", y);
    h.setAttribute("stroke", "#22c55e");
    h.setAttribute("stroke-width", "2");

    const v = document.createElementNS(ns, "line");
    v.setAttribute("x1", x);
    v.setAttribute("y1", y - size);
    v.setAttribute("x2", x);
    v.setAttribute("y2", y + size);
    v.setAttribute("stroke", "#22c55e");
    v.setAttribute("stroke-width", "2");

    g.appendChild(h);
    g.appendChild(v);
    svg.appendChild(g);

    return g;
  }

  /**
   * Creates a calibration line between two points.
   */
  function createCalibrationLine(svg, start, end) {
    const ns = "http://www.w3.org/2000/svg";

    const line = document.createElementNS(ns, "line");
    line.setAttribute("x1", start.x);
    line.setAttribute("y1", start.y);
    line.setAttribute("x2", end.x);
    line.setAttribute("y2", end.y);
    line.setAttribute("stroke", "#22c55e");
    line.setAttribute("stroke-width", "2");
    line.setAttribute("stroke-dasharray", "4,4");
    line.setAttribute("class", "calibration-line");

    svg.appendChild(line);

    return line;
  }

  /**
   * Prompts the user for the known length and completes calibration.
   */
  function promptForKnownLength(pixelDistance) {
    const knownLength = prompt(t("floor.calibratePrompt") || "Enter the known length in cm:");

    if (knownLength === null) {
      cancelCalibration();
      return;
    }

    const lengthCm = parseFloat(knownLength);
    if (!Number.isFinite(lengthCm) || lengthCm <= 0) {
      alert(t("floor.calibrateInvalidLength") || "Please enter a valid positive number.");
      cancelCalibration();
      return;
    }

    completeCalibration(pixelDistance, lengthCm);
  }

  /**
   * Completes calibration with the calculated scale.
   */
  function completeCalibration(pixelDistance, knownLengthCm) {
    const state = store.getState();
    const next = deepClone(state);
    const floor = getCurrentFloor(next);

    if (!floor?.layout?.background) {
      cancelCalibration();
      return;
    }

    const pixelsPerCm = pixelDistance / knownLengthCm;

    floor.layout.background.scale = {
      calibrated: true,
      pixelsPerCm,
      referenceLengthCm: knownLengthCm,
      referencePixels: pixelDistance
    };

    cleanupCalibration();

    store.commit(t("floor.calibrateSuccess") || "Calibration successful", next, {
      onRender: renderAll,
      updateMetaCb: updateMeta
    });

    if (calibrationState?.onComplete) {
      calibrationState.onComplete(true);
    }

    calibrationState = null;
  }

  /**
   * Cancels calibration mode.
   */
  function cancelCalibration() {
    cleanupCalibration();
    if (calibrationState?.onComplete) {
      calibrationState.onComplete(false);
    }
    calibrationState = null;
  }

  /**
   * Cleans up calibration UI elements.
   */
  function cleanupCalibration() {
    if (!calibrationState) return;

    const { svg, clickHandler, markers, line } = calibrationState;

    // Remove event listener
    if (clickHandler) {
      svg.removeEventListener("click", clickHandler);
    }

    // Reset cursor
    svg.style.cursor = "";

    // Remove markers
    markers.forEach(m => m.remove());

    // Remove line
    if (line) line.remove();
  }

  /**
   * Checks if calibration is active.
   */
  function isCalibrating() {
    return calibrationState !== null;
  }

  /**
   * Handles file upload from input element.
   */
  async function handleFileUpload(file) {
    try {
      const { dataUrl, filename } = await processUploadedFile(file);
      setBackground(dataUrl, filename);
      return true;
    } catch (error) {
      console.error("Background upload failed:", error);
      alert(error.message);
      return false;
    }
  }

  return {
    handleFileUpload,
    setBackground,
    removeBackground,
    updateOpacity,
    toggleLock,
    updatePosition,
    startCalibration,
    cancelCalibration,
    isCalibrating
  };
}
