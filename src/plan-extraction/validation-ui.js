/**
 * Validation UI
 * Interactive preview for editing extracted floor plans
 */

import { pixelsToCm } from './calibration.js';
import { t } from '../i18n.js';

/**
 * Show validation UI with extracted results
 * @param {Object} extractionResult - Full extraction result
 * @param {Function} onImport - Callback when user confirms import
 * @param {Function} onCancel - Callback when user cancels
 */
export function showValidationUI(extractionResult, onImport, onCancel) {
  const {
    rooms,
    calibration,
    originalImage,
    width,
    height
  } = extractionResult;

  // Create modal container
  const modal = createModalContainer();

  // Render preview (use null if calibration failed)
  const pixelsPerCm = (calibration.success && calibration.pixelsPerCm) ? calibration.pixelsPerCm : null;
  const preview = renderExtractionPreview(
    rooms,
    originalImage,
    width,
    height,
    pixelsPerCm
  );

  modal.querySelector('.extraction-preview-container').appendChild(preview.svg);

  // Bind events
  bindValidationEvents(modal, extractionResult, preview, onImport, onCancel);

  // Show modal
  document.body.appendChild(modal);
  modal.classList.add('show');

  // ESC to cancel
  const handleEsc = (e) => {
    if (e.key === 'Escape') {
      closeValidationUI(modal);
      onCancel();
      document.removeEventListener('keydown', handleEsc);
    }
  };
  document.addEventListener('keydown', handleEsc);

  return {
    modal,
    updateRoom: (roomId, updates) => updateRoomInPreview(preview, roomId, updates)
  };
}

/**
 * Create modal container element
 * @returns {HTMLElement} Modal element
 */
function createModalContainer() {
  const modal = document.createElement('div');
  modal.className = 'extraction-validation-modal';
  modal.innerHTML = `
    <div class="modal-backdrop"></div>
    <div class="modal-content">
      <div class="modal-header">
        <h2>${t('extraction.validationTitle')}</h2>
        <button class="close-btn" aria-label="${t('common.close')}">&times;</button>
      </div>
      <div class="modal-body">
        <div class="extraction-preview-container"></div>
        <div class="extraction-info">
          <div class="info-item">
            <span class="label">${t('extraction.roomsDetected')}:</span>
            <span class="value" data-field="roomCount">-</span>
          </div>
          <div class="info-item">
            <span class="label">${t('extraction.scale')}:</span>
            <span class="value" data-field="scale">-</span>
          </div>
          <div class="info-item">
            <span class="label">${t('extraction.confidence')}:</span>
            <span class="value" data-field="confidence">-</span>
          </div>
        </div>
        <div class="extraction-help">
          <p>${t('extraction.helpText')}</p>
          <ul>
            <li>${t('extraction.helpDrag')}</li>
            <li>${t('extraction.helpClick')}</li>
            <li>${t('extraction.helpDelete')}</li>
          </ul>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary cancel-btn">${t('common.cancel')}</button>
        <button class="btn btn-primary import-btn">${t('extraction.import')}</button>
      </div>
    </div>
  `;

  return modal;
}

/**
 * Render extraction preview with SVG overlay
 * @param {Array} rooms - Detected rooms
 * @param {string} originalImage - Original image data URL
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @param {number} pixelsPerCm - Calibration ratio
 * @returns {Object} Preview components
 */
function renderExtractionPreview(rooms, originalImage, width, height, pixelsPerCm) {
  const container = document.createElement('div');
  container.className = 'extraction-preview';
  container.style.position = 'relative';
  container.style.maxWidth = '100%';
  container.style.maxHeight = '70vh';

  // Background image
  const img = document.createElement('img');
  img.src = originalImage;
  img.style.width = '100%';
  img.style.height = 'auto';
  img.style.display = 'block';
  container.appendChild(img);

  // SVG overlay
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.style.position = 'absolute';
  svg.style.top = '0';
  svg.style.left = '0';
  svg.style.width = '100%';
  svg.style.height = '100%';
  svg.style.pointerEvents = 'none';

  // Render rooms
  const roomElements = [];
  for (const room of rooms) {
    const roomEl = renderRoom(room, pixelsPerCm);
    svg.appendChild(roomEl);
    roomElements.push({ room, element: roomEl });
  }

  container.appendChild(svg);

  return {
    container,
    svg,
    rooms: roomElements
  };
}

/**
 * Render a single room
 * @param {Object} room - Room data
 * @param {number} pixelsPerCm - Calibration ratio
 * @returns {SVGElement} Room group element
 */
function renderRoom(room, pixelsPerCm) {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.setAttribute('data-room-id', room.id);
  g.classList.add('room-overlay');

  // Determine confidence color
  const confidence = room.nameConfidence || 0;
  const color = confidence > 85 ? '#10b981' : confidence > 70 ? '#f59e0b' : '#ef4444';

  // Polygon
  const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  const points = room.polygonVertices.map(v => `${v.x},${v.y}`).join(' ');
  polygon.setAttribute('points', points);
  polygon.setAttribute('fill', 'none');
  polygon.setAttribute('stroke', color);
  polygon.setAttribute('stroke-width', '3');
  polygon.setAttribute('stroke-dasharray', '5,5');
  polygon.style.pointerEvents = 'auto';
  polygon.style.cursor = 'pointer';
  g.appendChild(polygon);

  // Vertices (editable handles)
  for (let i = 0; i < room.polygonVertices.length; i++) {
    const v = room.polygonVertices[i];
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', v.x);
    circle.setAttribute('cy', v.y);
    circle.setAttribute('r', '6');
    circle.setAttribute('fill', color);
    circle.setAttribute('stroke', 'white');
    circle.setAttribute('stroke-width', '2');
    circle.classList.add('vertex-handle');
    circle.setAttribute('data-vertex-index', i);
    circle.style.pointerEvents = 'auto';
    circle.style.cursor = 'move';
    g.appendChild(circle);
  }

  // Room name label
  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  text.setAttribute('x', room.centroid.x);
  text.setAttribute('y', room.centroid.y);
  text.setAttribute('text-anchor', 'middle');
  text.setAttribute('dominant-baseline', 'middle');
  text.setAttribute('fill', color);
  text.setAttribute('font-size', '16');
  text.setAttribute('font-weight', 'bold');
  text.textContent = room.name || t('room.newRoom');
  text.style.pointerEvents = 'none';
  g.appendChild(text);

  // Area label (calculated from polygon)
  const areaValue = calculatePolygonArea(room.polygonVertices, pixelsPerCm);
  let areaLabel;
  if (pixelsPerCm && pixelsPerCm > 0) {
    // Calibrated: show in m²
    const areaM2 = (areaValue / 10000).toFixed(2);
    areaLabel = `${areaM2} m²`;
  } else {
    // Not calibrated: show in pixels²
    areaLabel = `${Math.round(areaValue)} px²`;
  }

  const areaText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  areaText.setAttribute('x', room.centroid.x);
  areaText.setAttribute('y', room.centroid.y + 20);
  areaText.setAttribute('text-anchor', 'middle');
  areaText.setAttribute('dominant-baseline', 'middle');
  areaText.setAttribute('fill', color);
  areaText.setAttribute('font-size', '12');
  areaText.textContent = areaLabel;
  areaText.style.pointerEvents = 'none';
  g.appendChild(areaText);

  return g;
}

/**
 * Calculate polygon area in cm²
 * @param {Array} vertices - Polygon vertices in pixels
 * @param {number|null} pixelsPerCm - Calibration ratio (null if not calibrated)
 * @returns {number} Area in cm² (or pixels² if not calibrated)
 */
function calculatePolygonArea(vertices, pixelsPerCm) {
  // Shoelace formula
  let area = 0;
  for (let i = 0; i < vertices.length; i++) {
    const j = (i + 1) % vertices.length;
    area += vertices[i].x * vertices[j].y;
    area -= vertices[j].x * vertices[i].y;
  }
  area = Math.abs(area) / 2;

  // Convert to cm² if calibrated, otherwise return pixels²
  if (pixelsPerCm && pixelsPerCm > 0) {
    return area / (pixelsPerCm * pixelsPerCm);
  }
  return area; // Return pixels² if not calibrated
}

/**
 * Bind validation UI events
 * @param {HTMLElement} modal - Modal element
 * @param {Object} extractionResult - Extraction result
 * @param {Object} preview - Preview components
 * @param {Function} onImport - Import callback
 * @param {Function} onCancel - Cancel callback
 */
function bindValidationEvents(modal, extractionResult, preview, onImport, onCancel) {
  const { rooms, calibration } = extractionResult;

  // Update info fields
  modal.querySelector('[data-field="roomCount"]').textContent = rooms.length;

  // Handle calibration - might be undefined if auto-calibration failed
  const scaleText = calibration.success && calibration.pixelsPerCm
    ? `${calibration.pixelsPerCm.toFixed(2)} px/cm`
    : 'Not calibrated';
  modal.querySelector('[data-field="scale"]').textContent = scaleText;

  const avgConfidence = rooms.length > 0
    ? rooms.reduce((sum, r) => sum + (r.nameConfidence || 0), 0) / rooms.length
    : 0;
  const confidenceText = avgConfidence > 85
    ? `${avgConfidence.toFixed(0)}% (${t('extraction.confidenceGood')})`
    : avgConfidence > 70
      ? `${avgConfidence.toFixed(0)}% (${t('extraction.confidenceMedium')})`
      : `${avgConfidence.toFixed(0)}% (${t('extraction.confidenceLow')})`;
  modal.querySelector('[data-field="confidence"]').textContent = confidenceText;

  // Close button
  modal.querySelector('.close-btn').addEventListener('click', () => {
    closeValidationUI(modal);
    onCancel();
  });

  // Cancel button
  modal.querySelector('.cancel-btn').addEventListener('click', () => {
    closeValidationUI(modal);
    onCancel();
  });

  // Import button
  modal.querySelector('.import-btn').addEventListener('click', () => {
    closeValidationUI(modal);
    onImport(extractionResult);
  });

  // Backdrop click
  modal.querySelector('.modal-backdrop').addEventListener('click', () => {
    closeValidationUI(modal);
    onCancel();
  });

  // Room click (select for editing)
  preview.rooms.forEach(({ room, element }) => {
    const polygon = element.querySelector('polygon');
    polygon.addEventListener('click', (e) => {
      e.stopPropagation();
      selectRoom(element);
      showRoomEditor(modal, room, extractionResult);
    });
  });

  // Vertex dragging (simplified - would need full drag implementation)
  preview.rooms.forEach(({ room, element }) => {
    const vertices = element.querySelectorAll('.vertex-handle');
    vertices.forEach((vertex, i) => {
      // TODO: Implement vertex dragging
      // Would use mouse/touch events to update polygon vertices
    });
  });
}

/**
 * Select a room visually
 * @param {SVGElement} roomElement - Room group element
 */
function selectRoom(roomElement) {
  // Deselect others
  document.querySelectorAll('.room-overlay').forEach(el => {
    el.classList.remove('selected');
  });

  roomElement.classList.add('selected');
}

/**
 * Show room editor panel
 * @param {HTMLElement} modal - Modal element
 * @param {Object} room - Room data
 * @param {Object} extractionResult - Extraction result
 */
function showRoomEditor(modal, room, extractionResult) {
  // Find or create editor panel
  let editor = modal.querySelector('.room-editor');
  if (!editor) {
    editor = document.createElement('div');
    editor.className = 'room-editor';
    editor.innerHTML = `
      <h3>${t('extraction.editRoom')}</h3>
      <div class="form-group">
        <label>${t('room.name')}</label>
        <input type="text" class="room-name-input" />
      </div>
      <div class="form-group">
        <button class="btn btn-danger delete-room-btn">${t('extraction.deleteRoom')}</button>
      </div>
    `;
    modal.querySelector('.modal-body').appendChild(editor);
  }

  // Populate
  const nameInput = editor.querySelector('.room-name-input');
  nameInput.value = room.name || '';
  nameInput.focus();

  // Update on change
  nameInput.addEventListener('input', () => {
    room.name = nameInput.value;
    // Update label in SVG
    const roomEl = modal.querySelector(`[data-room-id="${room.id}"]`);
    const textEl = roomEl.querySelector('text');
    textEl.textContent = room.name || t('room.newRoom');
  });

  // Delete room
  editor.querySelector('.delete-room-btn').addEventListener('click', () => {
    const index = extractionResult.rooms.indexOf(room);
    if (index > -1) {
      extractionResult.rooms.splice(index, 1);
      const roomEl = modal.querySelector(`[data-room-id="${room.id}"]`);
      roomEl.remove();
      editor.remove();

      // Update count
      modal.querySelector('[data-field="roomCount"]').textContent = extractionResult.rooms.length;
    }
  });
}

/**
 * Close validation UI
 * @param {HTMLElement} modal - Modal element
 */
function closeValidationUI(modal) {
  modal.classList.remove('show');
  setTimeout(() => modal.remove(), 300);
}

/**
 * Update room in preview
 * @param {Object} preview - Preview components
 * @param {string} roomId - Room ID
 * @param {Object} updates - Updates to apply
 */
function updateRoomInPreview(preview, roomId, updates) {
  const roomData = preview.rooms.find(r => r.room.id === roomId);
  if (!roomData) return;

  Object.assign(roomData.room, updates);

  // Re-render room element
  const newElement = renderRoom(roomData.room, updates.pixelsPerCm || 1);
  roomData.element.replaceWith(newElement);
  roomData.element = newElement;
}
