/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createStateStore } from './state.js';
import { defaultState } from './core.js';
import { bindUI } from './ui.js';
import { renderTilePresets } from './render.js';

describe('Setup grout color presets', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="tilePresetGroutColorPresets">
        <button type="button" class="color-swatch" data-color="#ffffff"></button>
        <button type="button" class="color-swatch" data-color="#000000"></button>
      </div>
      <input id="tilePresetGroutColor" type="color" value="#ffffff" />
      <select id="tilePresetList"></select>
      <input id="tilePresetName" />
      <select id="tilePresetShape"></select>
      <input id="tilePresetW" />
      <input id="tilePresetH" />
      <input id="tilePresetGroutW" />
      <input id="tilePresetPricePerM2" />
      <input id="tilePresetPackM2" />
      <input id="tilePresetPricePerPack" />
      <input id="tilePresetUseSkirting" type="checkbox" />
      <div id="tilePresetRoomList"></div>
      <select id="skirtingPresetList"></select>
      <input id="skirtingPresetName" />
      <input id="skirtingPresetHeight" />
      <input id="skirtingPresetLength" />
      <input id="skirtingPresetPrice" />
      <button id="btnAddTilePreset"></button>
      <button id="btnDeleteTilePreset"></button>
      <button id="btnConfirmDeleteTilePreset"></button>
      <button id="btnCancelDeleteTilePreset"></button>
      <button id="btnAddSkirtingPreset"></button>
      <button id="btnDeleteSkirtingPreset"></button>
      <div id="tilePresetDeleteWarning"></div>
      <div id="tilePresetDeleteWarningText"></div>
    `;
  });

  it('applies swatch selection to preset color input', () => {
    const store = createStateStore(defaultState, () => ({ errors: [], warns: [] }));
    const seed = structuredClone(store.getState());
    seed.tilePresets = [{
      id: 'tp1',
      name: 'Preset 1',
      shape: 'rect',
      widthCm: 60,
      heightCm: 30,
      groutWidthCm: 0.2,
      groutColorHex: '#ffffff',
      pricePerM2: 0,
      packM2: 0,
      useForSkirting: false
    }];
    store.setStateDirect(seed);
    const renderAll = vi.fn();
    const refreshProjectSelect = vi.fn();
    const updateMeta = vi.fn();

    bindUI({
      store,
      renderAll,
      refreshProjectSelect,
      updateMeta,
      validateState: () => ({ errors: [], warns: [] }),
      defaultStateFn: () => defaultState,
      excl: { getSelectedExcl: () => null },
      setSelectedExcl: () => {},
      resetErrors: () => {}
    });

    renderTilePresets(store.getState(), 'tp1', () => {});

    const swatches = document.querySelectorAll('#tilePresetGroutColorPresets .color-swatch');
    swatches[1].click();

    const input = document.getElementById('tilePresetGroutColor');
    expect(input.value.toLowerCase()).toBe('#000000');
  });
});
