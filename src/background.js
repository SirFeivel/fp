// src/background.js
// Background image controller for floor layout tracing

import { t } from "./i18n.js";
import { deepClone, getCurrentFloor } from "./core.js";
import { showAlert } from "./dialog.js";

/**
 * Creates a background controller for handling floor background images.
 * Supports image upload, calibration (3 measurements), and opacity control.
 */
export function createBackgroundController({ store, renderAll, updateMeta }) {
  let calibrationState = null;
  const REQUIRED_MEASUREMENTS = 3;

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
   * User needs to make 3 measurements for accuracy.
   * @param {SVGElement} svg - The SVG element to calibrate on
   * @param {Object} callbacks - Callback functions for UI updates
   * @param {Function} callbacks.onStepStart - Called when a new step starts (stepNumber, totalSteps)
   * @param {Function} callbacks.onLineDrawn - Called when line is drawn, expects length input (pixelDistance, stepNumber)
   * @param {Function} callbacks.onMeasurementAdded - Called when a measurement is confirmed (measurements array)
   * @param {Function} callbacks.onComplete - Called when calibration completes (success, avgPixelsPerCm)
   * @param {Function} callbacks.onCancel - Called when calibration is cancelled
   */
  function startCalibration(svg, callbacks = {}) {
    if (calibrationState) {
      cancelCalibration();
    }

    calibrationState = {
      svg,
      startPoint: null,
      endPoint: null,
      currentLine: null,
      currentMarkers: [],
      measurements: [], // Array of { pixelDistance, lengthCm, pixelsPerCm }
      callbacks,
      waitingForInput: false
    };

    // Change cursor
    svg.style.cursor = "crosshair";

    // Add click handler
    calibrationState.clickHandler = (e) => handleCalibrationClick(e);
    svg.addEventListener("click", calibrationState.clickHandler);

    // Notify UI that step 1 is starting
    callbacks.onStepStart?.(1, REQUIRED_MEASUREMENTS);

    return true;
  }

  /**
   * Handles click during calibration.
   */
  function handleCalibrationClick(e) {
    if (!calibrationState || calibrationState.waitingForInput) return;

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
      calibrationState.currentMarkers.push(marker);
    } else {
      // Second click - set end point and show input
      calibrationState.endPoint = { x: svgX, y: svgY };

      // Draw marker
      const marker = createCalibrationMarker(svg, svgX, svgY);
      calibrationState.currentMarkers.push(marker);

      // Draw line
      const line = createCalibrationLine(svg, calibrationState.startPoint, calibrationState.endPoint);
      calibrationState.currentLine = line;

      // Calculate pixel distance
      const dx = calibrationState.endPoint.x - calibrationState.startPoint.x;
      const dy = calibrationState.endPoint.y - calibrationState.startPoint.y;
      const pixelDistance = Math.sqrt(dx * dx + dy * dy);

      // Store current pixel distance and wait for input
      calibrationState.currentPixelDistance = pixelDistance;
      calibrationState.waitingForInput = true;

      // Notify UI to show input field
      const stepNumber = calibrationState.measurements.length + 1;
      calibrationState.callbacks.onLineDrawn?.(pixelDistance, stepNumber);
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
   * Confirms the current measurement with the user-provided length.
   * Called from UI when user enters the known length.
   */
  function confirmMeasurement(lengthCm) {
    if (!calibrationState || !calibrationState.waitingForInput) return false;

    const parsedLength = parseFloat(lengthCm);
    if (!Number.isFinite(parsedLength) || parsedLength <= 0) {
      return false;
    }

    const pixelDistance = calibrationState.currentPixelDistance;
    const pixelsPerCm = pixelDistance / parsedLength;

    // Add measurement
    calibrationState.measurements.push({
      pixelDistance,
      lengthCm: parsedLength,
      pixelsPerCm
    });

    // Clear current line/markers for next measurement
    clearCurrentMeasurement();

    // Notify UI of measurement added
    calibrationState.callbacks.onMeasurementAdded?.(calibrationState.measurements);

    // Check if we have enough measurements
    if (calibrationState.measurements.length >= REQUIRED_MEASUREMENTS) {
      completeCalibration();
    } else {
      // Prepare for next measurement
      calibrationState.waitingForInput = false;
      calibrationState.startPoint = null;
      calibrationState.endPoint = null;

      // Notify UI that next step is starting
      const nextStep = calibrationState.measurements.length + 1;
      calibrationState.callbacks.onStepStart?.(nextStep, REQUIRED_MEASUREMENTS);
    }

    return true;
  }

  /**
   * Clears the current measurement's visual elements.
   */
  function clearCurrentMeasurement() {
    if (!calibrationState) return;

    // Remove current markers
    calibrationState.currentMarkers.forEach(m => m.remove());
    calibrationState.currentMarkers = [];

    // Remove current line
    if (calibrationState.currentLine) {
      calibrationState.currentLine.remove();
      calibrationState.currentLine = null;
    }
  }

  /**
   * Completes calibration with the average of all measurements.
   */
  function completeCalibration() {
    if (!calibrationState) return;

    const state = store.getState();
    const next = deepClone(state);
    const floor = getCurrentFloor(next);

    if (!floor?.layout?.background) {
      cancelCalibration();
      return;
    }

    // Calculate average pixelsPerCm from all measurements
    const measurements = calibrationState.measurements;
    const avgPixelsPerCm = measurements.reduce((sum, m) => sum + m.pixelsPerCm, 0) / measurements.length;

    // Calculate total reference values for display
    const totalPixels = measurements.reduce((sum, m) => sum + m.pixelDistance, 0);
    const totalCm = measurements.reduce((sum, m) => sum + m.lengthCm, 0);

    floor.layout.background.scale = {
      calibrated: true,
      pixelsPerCm: avgPixelsPerCm,
      measurements: measurements.length,
      referenceLengthCm: totalCm / measurements.length,
      referencePixels: totalPixels / measurements.length
    };

    const callbacks = calibrationState.callbacks;

    cleanupCalibration();
    calibrationState = null;

    store.commit(t("floor.calibrateSuccess") || "Calibration successful", next, {
      onRender: renderAll,
      updateMetaCb: updateMeta
    });

    // Notify UI of completion
    callbacks.onComplete?.(true, avgPixelsPerCm);
  }

  /**
   * Cancels calibration mode.
   */
  function cancelCalibration() {
    const callbacks = calibrationState?.callbacks;
    cleanupCalibration();
    calibrationState = null;
    callbacks?.onCancel?.();
  }

  /**
   * Cleans up calibration UI elements.
   */
  function cleanupCalibration() {
    if (!calibrationState) return;

    const { svg, clickHandler, currentMarkers, currentLine } = calibrationState;

    // Remove event listener
    if (clickHandler) {
      svg.removeEventListener("click", clickHandler);
    }

    // Reset cursor
    svg.style.cursor = "";

    // Remove current markers
    currentMarkers.forEach(m => m.remove());

    // Remove current line
    if (currentLine) currentLine.remove();
  }

  /**
   * Gets the current calibration step info.
   */
  function getCalibrationProgress() {
    if (!calibrationState) return null;
    return {
      currentStep: calibrationState.measurements.length + 1,
      totalSteps: REQUIRED_MEASUREMENTS,
      measurements: calibrationState.measurements,
      waitingForInput: calibrationState.waitingForInput
    };
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
      await showAlert({
        title: t("dialog.uploadFailedTitle") || "Upload Failed",
        message: error.message,
        type: "error"
      });
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
    confirmMeasurement,
    isCalibrating,
    getCalibrationProgress
  };
}
