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
   * Loads image to get native dimensions for proper calibration.
   */
  async function setBackground(dataUrl, filename) {
    const state = store.getState();
    const next = deepClone(state);
    const floor = getCurrentFloor(next);

    if (!floor) {
      console.warn("No floor selected");
      return;
    }

    // Load image to get native dimensions
    let nativeWidth = 0;
    let nativeHeight = 0;
    try {
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = dataUrl;
      });
      nativeWidth = img.naturalWidth;
      nativeHeight = img.naturalHeight;
    } catch (e) {
      console.warn("Could not get image dimensions:", e);
    }

    floor.layout = floor.layout || { enabled: false, background: null };
    floor.layout.enabled = true;
    floor.layout.background = {
      dataUrl,
      filename,
      nativeWidth,
      nativeHeight,
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

    // Add handlers to redraw after zoom/pan (render clears SVG)
    calibrationState.redrawHandler = () => {
      requestAnimationFrame(() => redrawCalibrationUI());
    };
    if (typeof document !== "undefined") {
      document.addEventListener("wheel", calibrationState.redrawHandler);
      document.addEventListener("pointermove", calibrationState.redrawHandler);
    }

    // Notify UI that step 1 is starting
    callbacks.onStepStart?.(1, REQUIRED_MEASUREMENTS);

    return true;
  }

  /**
   * Converts screen coordinates to SVG coordinates using CTM.
   * Properly handles preserveAspectRatio and any transforms.
   */
  function screenToSvgCoords(svg, clientX, clientY) {
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const svgPt = pt.matrixTransform(ctm.inverse());
    return { x: svgPt.x, y: svgPt.y };
  }

  /**
   * Handles click during calibration.
   */
  function handleCalibrationClick(e) {
    if (!calibrationState || calibrationState.waitingForInput) return;

    const svg = calibrationState.svg;
    const { x: svgX, y: svgY } = screenToSvgCoords(svg, e.clientX, e.clientY);

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
   * Redraws calibration UI elements after render cycle (e.g., zoom).
   * Called via requestAnimationFrame after wheel events.
   */
  function redrawCalibrationUI() {
    if (!calibrationState) return;

    const svg = calibrationState.svg;
    if (!svg) return;

    // Check if markers were removed by render
    const markersRemoved = calibrationState.currentMarkers.length > 0 &&
      !calibrationState.currentMarkers[0].parentNode;

    if (markersRemoved) {
      // Re-create markers at stored positions
      calibrationState.currentMarkers = [];

      if (calibrationState.startPoint) {
        const marker = createCalibrationMarker(svg, calibrationState.startPoint.x, calibrationState.startPoint.y);
        calibrationState.currentMarkers.push(marker);
      }

      if (calibrationState.endPoint) {
        const marker = createCalibrationMarker(svg, calibrationState.endPoint.x, calibrationState.endPoint.y);
        calibrationState.currentMarkers.push(marker);

        // Re-create line
        calibrationState.currentLine = createCalibrationLine(svg, calibrationState.startPoint, calibrationState.endPoint);
      }
    }
  }

  /**
   * Creates a calibration marker at the given point.
   * Uses thin crosshair with center dot, blue outline with white inside.
   */
  function createCalibrationMarker(svg, x, y) {
    const ns = "http://www.w3.org/2000/svg";
    const size = 8;
    const accent = "rgba(122,162,255,1)";

    const g = document.createElementNS(ns, "g");
    g.setAttribute("class", "calibration-marker");

    // Helper to create a line with blue outline and white center
    const createLine = (x1, y1, x2, y2) => {
      // Blue outline
      const outline = document.createElementNS(ns, "line");
      outline.setAttribute("x1", x1);
      outline.setAttribute("y1", y1);
      outline.setAttribute("x2", x2);
      outline.setAttribute("y2", y2);
      outline.setAttribute("stroke", accent);
      outline.setAttribute("stroke-width", "3");
      outline.setAttribute("stroke-linecap", "round");
      outline.setAttribute("vector-effect", "non-scaling-stroke");
      g.appendChild(outline);

      // White center line
      const line = document.createElementNS(ns, "line");
      line.setAttribute("x1", x1);
      line.setAttribute("y1", y1);
      line.setAttribute("x2", x2);
      line.setAttribute("y2", y2);
      line.setAttribute("stroke", "white");
      line.setAttribute("stroke-width", "1");
      line.setAttribute("stroke-linecap", "round");
      line.setAttribute("vector-effect", "non-scaling-stroke");
      g.appendChild(line);
    };

    // Horizontal crosshair
    createLine(x - size, y, x + size, y);
    // Vertical crosshair
    createLine(x, y - size, x, y + size);

    // Center dot (blue ring with transparent center)
    const dot = document.createElementNS(ns, "circle");
    dot.setAttribute("cx", x);
    dot.setAttribute("cy", y);
    dot.setAttribute("r", "2.5");
    dot.setAttribute("fill", "none");
    dot.setAttribute("stroke", accent);
    dot.setAttribute("stroke-width", "1.5");
    dot.setAttribute("vector-effect", "non-scaling-stroke");
    g.appendChild(dot);

    svg.appendChild(g);
    return g;
  }

  /**
   * Creates a calibration line between two points.
   * Uses blue outline with white center for visibility.
   */
  function createCalibrationLine(svg, start, end) {
    const ns = "http://www.w3.org/2000/svg";
    const accent = "rgba(122,162,255,1)";

    const g = document.createElementNS(ns, "g");
    g.setAttribute("class", "calibration-line");

    // Blue outline
    const outline = document.createElementNS(ns, "line");
    outline.setAttribute("x1", start.x);
    outline.setAttribute("y1", start.y);
    outline.setAttribute("x2", end.x);
    outline.setAttribute("y2", end.y);
    outline.setAttribute("stroke", accent);
    outline.setAttribute("stroke-width", "5");
    outline.setAttribute("stroke-linecap", "round");
    outline.setAttribute("vector-effect", "non-scaling-stroke");
    g.appendChild(outline);

    // White dashed center line
    const line = document.createElementNS(ns, "line");
    line.setAttribute("x1", start.x);
    line.setAttribute("y1", start.y);
    line.setAttribute("x2", end.x);
    line.setAttribute("y2", end.y);
    line.setAttribute("stroke", "white");
    line.setAttribute("stroke-width", "1.6");
    line.setAttribute("stroke-dasharray", "6,4");
    line.setAttribute("stroke-linecap", "round");
    line.setAttribute("vector-effect", "non-scaling-stroke");
    g.appendChild(line);

    svg.appendChild(g);
    return g;
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
   * Uses weighted average (total distance / total cm) for better accuracy.
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

    // Check for outliers - calculate coefficient of variation
    const measurements = calibrationState.measurements;
    const ratios = measurements.map(m => m.pixelsPerCm);
    const meanRatio = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    const variance = ratios.reduce((sum, r) => sum + Math.pow(r - meanRatio, 2), 0) / ratios.length;
    const stdDev = Math.sqrt(variance);
    const coefficientOfVariation = (stdDev / meanRatio) * 100; // as percentage

    // Reject calibration if measurements are too inconsistent (CV > 5%)
    if (coefficientOfVariation > 5) {
      console.warn(`Calibration failed: measurements vary by ${coefficientOfVariation.toFixed(1)}%`);
      const callbacks = calibrationState.callbacks;
      cleanupCalibration();
      calibrationState = null;
      callbacks.onFailed?.(coefficientOfVariation);
      return;
    }

    // Use weighted average (total distance / total cm) - gives more weight to longer measurements
    const totalSvgDistance = measurements.reduce((sum, m) => sum + m.pixelDistance, 0);
    const totalLengthCm = measurements.reduce((sum, m) => sum + m.lengthCm, 0);
    const avgSvgPixelsPerCm = totalSvgDistance / totalLengthCm;

    // Convert SVG units to native pixels using the ACTUAL rendering scale
    const bg = floor.layout.background;
    const nativeWidth = bg.nativeWidth || 1000;
    const currentPixelsPerCm = (bg.scale?.calibrated && bg.scale.pixelsPerCm)
      ? bg.scale.pixelsPerCm
      : (nativeWidth / 1000);
    const avgPixelsPerCm = avgSvgPixelsPerCm * currentPixelsPerCm;

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

    const { svg, clickHandler, redrawHandler, currentMarkers, currentLine } = calibrationState;

    // Remove event listeners
    if (clickHandler) {
      svg.removeEventListener("click", clickHandler);
    }
    if (redrawHandler && typeof document !== "undefined") {
      document.removeEventListener("wheel", redrawHandler);
      document.removeEventListener("pointermove", redrawHandler);
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
      await setBackground(dataUrl, filename);
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
