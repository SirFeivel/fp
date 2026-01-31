/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { renderTilePatternForm } from './render.js';
import { setUiState } from './ui_state.js';

function buildDom() {
  document.body.innerHTML = `
    <datalist id="tileReferences"></datalist>
    <div id="tilePresetRow"></div>
    <div id="tilePresetEmptyRow" class="hidden"></div>
    <select id="tilePresetSelect"></select>
    <select id="skirtingPresetSelect"></select>
    <input id="tileConfigEditToggle" type="checkbox" />
    <div id="tileEditActions" class="hidden"></div>
    <button id="tileEditUpdateBtn"></button>
    <button id="tileEditSaveBtn"></button>
    <input id="tileReference" />
    <select id="tileShape"></select>
    <input id="tileW" />
    <input id="tileH" />
    <input id="groutW" />
    <input id="groutColor" />
    <input id="tilePricePerM2" />
    <input id="tilePackM2" />
    <input id="tilePricePerPack" />
    <input id="tileAllowSkirting" type="checkbox" />
    <div class="tile-config-fields"></div>
    <div id="groutColorPresets"></div>
    <select id="patternType"></select>
    <select id="bondFraction"></select>
    <select id="rotationDeg"></select>
    <input id="offsetX" />
    <input id="offsetY" />
    <select id="originPreset"></select>
    <input id="originX" />
    <input id="originY" />
    <input id="reserveTiles" />
    <input id="wasteAllowRotate" type="checkbox" />
    <input id="wasteKerfCm" />
    <input id="wasteOptimizeCuts" type="checkbox" />
    <input id="debugShowNeeds" type="checkbox" />
  `;
}

describe('tile reference edit actions', () => {
  it('keeps update/save visible when reference changes away from preset', () => {
    buildDom();
    setUiState({ tileEditActive: true, tileEditDirty: true, tileEditMode: 'edit', tileEditHasPreset: true });

    const state = {
      tilePresets: [{ id: 'p1', name: 'Tommy', shape: 'rect', widthCm: 20, heightCm: 10 }],
      skirtingPresets: [],
      materials: {},
      pricing: { pricePerM2: 0, packM2: 0 },
      floors: [{
        id: 'f1',
        rooms: [{
          id: 'r1',
          name: 'Room 1',
          tile: { reference: 'Bill', shape: 'rect', widthCm: 20, heightCm: 10 },
          grout: { widthCm: 0.2, colorHex: '#ffffff' },
          pattern: { type: 'grid', bondFraction: 0.5, rotationDeg: 0, offsetXcm: 0, offsetYcm: 0, origin: { preset: 'tl', xCm: 0, yCm: 0 } }
        }]
      }],
      selectedFloorId: 'f1',
      selectedRoomId: 'r1'
    };

    renderTilePatternForm(state);

    const updateBtn = document.getElementById('tileEditUpdateBtn');
    const saveBtn = document.getElementById('tileEditSaveBtn');
    expect(updateBtn.style.display).toBe('');
    expect(saveBtn.style.display).toBe('');
  });
});
