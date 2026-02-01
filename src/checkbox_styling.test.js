/**
 * @vitest-environment jsdom
 *
 * Tests for checkbox styling consistency.
 * Verifies that checkboxes have the correct class applied.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderTilePresets, renderExportTab } from './render.js';

describe('Checkbox Styling', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('Tile Preset Room List Checkboxes', () => {
    function makeState() {
      return {
        floors: [{
          id: 'f1',
          name: 'Floor 1',
          rooms: [
            { id: 'r1', name: 'Room 1', tile: { reference: 'TestPreset' } },
            { id: 'r2', name: 'Room 2', tile: { reference: '' } }
          ]
        }],
        selectedFloorId: 'f1',
        selectedRoomId: 'r1',
        tilePresets: [
          { id: 'p1', name: 'TestPreset', widthCm: 60, heightCm: 30 }
        ]
      };
    }

    function setupTilePresetDOM() {
      document.body.innerHTML = `
        <select id="tilePresetList"></select>
        <div id="tilePresetRoomList"></div>
        <input id="tilePresetName" />
        <input id="tilePresetW" />
        <input id="tilePresetH" />
        <input id="tilePresetPricePerM2" />
        <input id="tilePresetPackM2" />
        <input id="tilePresetPricePerPack" />
        <select id="tilePresetShape"><option value="rect">rect</option></select>
        <input id="tilePresetGroutW" />
        <input id="tilePresetGroutColor" />
        <div id="tilePresetGroutColorPresets"></div>
        <input id="tilePresetUseSkirting" type="checkbox" />
        <button id="btnCreateTilePreset"></button>
        <button id="btnDeleteTilePreset"></button>
        <button id="btnSaveTilePreset"></button>
      `;
    }

    it('applies checkbox class to preset room list checkboxes', () => {
      setupTilePresetDOM();
      const state = makeState();

      renderTilePresets(state, 'p1', () => {});

      const roomList = document.getElementById('tilePresetRoomList');
      const checkboxes = roomList.querySelectorAll('input[type="checkbox"]');

      expect(checkboxes.length).toBe(2); // Two rooms
      checkboxes.forEach(checkbox => {
        expect(checkbox.classList.contains('checkbox')).toBe(true);
      });
    });

    it('checkboxes have correct data-room-id attribute', () => {
      setupTilePresetDOM();
      const state = makeState();

      renderTilePresets(state, 'p1', () => {});

      const roomList = document.getElementById('tilePresetRoomList');
      const checkboxes = roomList.querySelectorAll('input[type="checkbox"]');

      const roomIds = Array.from(checkboxes).map(cb => cb.dataset.roomId);
      expect(roomIds).toContain('r1');
      expect(roomIds).toContain('r2');
    });
  });

  describe('Export Room List Checkboxes', () => {
    function makeExportState() {
      return {
        floors: [{
          id: 'f1',
          name: 'Floor 1',
          rooms: [
            {
              id: 'r1',
              name: 'Room 1',
              sections: [{ widthCm: 200, heightCm: 300 }]
            },
            {
              id: 'r2',
              name: 'Room 2',
              sections: [{ widthCm: 150, heightCm: 250 }]
            }
          ]
        }],
        selectedFloorId: 'f1',
        selectedRoomId: 'r1'
      };
    }

    it('applies both checkbox and export-room-checkbox classes', () => {
      document.body.innerHTML = `<div id="exportRoomsList"></div>`;

      const state = makeExportState();
      renderExportTab(state);

      const checkboxes = document.querySelectorAll('#exportRoomsList input[type="checkbox"]');

      expect(checkboxes.length).toBe(2);
      checkboxes.forEach(checkbox => {
        expect(checkbox.classList.contains('checkbox')).toBe(true);
        expect(checkbox.classList.contains('export-room-checkbox')).toBe(true);
      });
    });

    it('renders checkbox BEFORE the label (left alignment)', () => {
      document.body.innerHTML = `<div id="exportRoomsList"></div>`;

      const state = makeExportState();
      renderExportTab(state);

      const items = document.querySelectorAll('#exportRoomsList .export-room-item');

      items.forEach(item => {
        const children = Array.from(item.children);
        const checkboxIndex = children.findIndex(el => el.tagName === 'INPUT');
        const labelIndex = children.findIndex(el => el.classList.contains('export-room-label'));

        // Checkbox should come before label
        expect(checkboxIndex).toBeLessThan(labelIndex);
        expect(checkboxIndex).toBe(0); // Checkbox should be first child
      });
    });

    it('checkboxes are checked by default', () => {
      document.body.innerHTML = `<div id="exportRoomsList"></div>`;

      const state = makeExportState();
      renderExportTab(state);

      const checkboxes = document.querySelectorAll('#exportRoomsList input[type="checkbox"]');

      checkboxes.forEach(checkbox => {
        expect(checkbox.checked).toBe(true);
      });
    });
  });
});
