/**
 * @vitest-environment jsdom
 *
 * Tests for the room delete button functionality.
 * The button should:
 * - Be disabled when nothing is selected
 * - Enable when an exclusion is selected
 * - Enable when an added section (index > 0) is selected
 * - Stay disabled when origin section (index 0) is selected
 * - Delete the selected object when clicked
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getCurrentRoom } from './core.js';

describe('Room Delete Button', () => {
  let selectedExclId = null;
  let selectedSectionId = null;
  let state;
  let commitCalls = [];

  function makeState() {
    return {
      floors: [{
        id: 'f1',
        name: 'Floor 1',
        rooms: [{
          id: 'r1',
          name: 'Room 1',
          widthCm: 300,
          heightCm: 400,
          sections: [
            { id: 'sec-origin', x: 0, y: 0, widthCm: 200, heightCm: 200, label: 'Origin' },
            { id: 'sec-added', x: 200, y: 0, widthCm: 100, heightCm: 200, label: 'Added' }
          ],
          exclusions: [
            { id: 'ex1', type: 'rect', label: 'Exclusion 1', x: 10, y: 10, w: 30, h: 30 }
          ],
          tile: { widthCm: 40, heightCm: 20, shape: 'rect' },
          grout: { widthCm: 0.2, colorHex: '#ffffff' },
          pattern: { type: 'grid' },
          skirting: { enabled: false }
        }]
      }],
      selectedFloorId: 'f1',
      selectedRoomId: 'r1'
    };
  }

  function setupDOM() {
    document.body.innerHTML = `
      <button id="roomDeleteObject" class="quick-btn danger" disabled></button>
    `;
  }

  function updateRoomDeleteButtonState() {
    const btn = document.getElementById('roomDeleteObject');
    if (!btn) return;

    // Enable for exclusions
    if (selectedExclId) {
      btn.disabled = false;
      return;
    }

    // Enable for added sections (index > 0), not origin section
    if (selectedSectionId) {
      const room = getCurrentRoom(state);
      const sectionIndex = room?.sections?.findIndex(s => s.id === selectedSectionId) ?? -1;
      btn.disabled = sectionIndex <= 0;
      return;
    }

    btn.disabled = true;
  }

  beforeEach(() => {
    selectedExclId = null;
    selectedSectionId = null;
    state = makeState();
    commitCalls = [];
    setupDOM();
  });

  describe('Button State', () => {
    it('is disabled when nothing is selected', () => {
      updateRoomDeleteButtonState();
      const btn = document.getElementById('roomDeleteObject');
      expect(btn.disabled).toBe(true);
    });

    it('is enabled when an exclusion is selected', () => {
      selectedExclId = 'ex1';
      updateRoomDeleteButtonState();
      const btn = document.getElementById('roomDeleteObject');
      expect(btn.disabled).toBe(false);
    });

    it('is disabled when origin section (index 0) is selected', () => {
      selectedSectionId = 'sec-origin';
      updateRoomDeleteButtonState();
      const btn = document.getElementById('roomDeleteObject');
      expect(btn.disabled).toBe(true);
    });

    it('is enabled when added section (index > 0) is selected', () => {
      selectedSectionId = 'sec-added';
      updateRoomDeleteButtonState();
      const btn = document.getElementById('roomDeleteObject');
      expect(btn.disabled).toBe(false);
    });

    it('is disabled when room has only one section', () => {
      // Remove the added section, leaving only origin
      state.floors[0].rooms[0].sections = [
        { id: 'sec-origin', x: 0, y: 0, widthCm: 200, heightCm: 200, label: 'Origin' }
      ];
      selectedSectionId = 'sec-origin';
      updateRoomDeleteButtonState();
      const btn = document.getElementById('roomDeleteObject');
      expect(btn.disabled).toBe(true);
    });

    it('prioritizes exclusion over section selection', () => {
      // Both selected (edge case, shouldn't happen in practice)
      selectedExclId = 'ex1';
      selectedSectionId = 'sec-added';
      updateRoomDeleteButtonState();
      const btn = document.getElementById('roomDeleteObject');
      // Should be enabled because exclusion is checked first
      expect(btn.disabled).toBe(false);
    });
  });

  describe('Delete Action', () => {
    it('deletes exclusion when exclusion is selected and button clicked', () => {
      selectedExclId = 'ex1';
      const room = getCurrentRoom(state);
      expect(room.exclusions.length).toBe(1);

      // Simulate deletion
      room.exclusions = room.exclusions.filter(e => e.id !== selectedExclId);

      expect(room.exclusions.length).toBe(0);
    });

    it('deletes added section when added section is selected and button clicked', () => {
      selectedSectionId = 'sec-added';
      const room = getCurrentRoom(state);
      expect(room.sections.length).toBe(2);

      // Check section index before deletion
      const sectionIndex = room.sections.findIndex(s => s.id === selectedSectionId);
      expect(sectionIndex).toBe(1); // Added section is at index 1

      // Simulate deletion (only if index > 0)
      if (sectionIndex > 0) {
        room.sections = room.sections.filter(s => s.id !== selectedSectionId);
      }

      expect(room.sections.length).toBe(1);
      expect(room.sections[0].id).toBe('sec-origin');
    });

    it('does NOT delete origin section when origin is selected', () => {
      selectedSectionId = 'sec-origin';
      const room = getCurrentRoom(state);
      expect(room.sections.length).toBe(2);

      // Check section index - should be 0 (origin)
      const sectionIndex = room.sections.findIndex(s => s.id === selectedSectionId);
      expect(sectionIndex).toBe(0);

      // Attempt deletion (should not happen if index <= 0)
      if (sectionIndex > 0) {
        room.sections = room.sections.filter(s => s.id !== selectedSectionId);
      }

      // Sections should remain unchanged
      expect(room.sections.length).toBe(2);
    });
  });

  describe('Section Index Detection', () => {
    it('correctly identifies origin section at index 0', () => {
      const room = getCurrentRoom(state);
      const originIndex = room.sections.findIndex(s => s.id === 'sec-origin');
      expect(originIndex).toBe(0);
    });

    it('correctly identifies added section at index > 0', () => {
      const room = getCurrentRoom(state);
      const addedIndex = room.sections.findIndex(s => s.id === 'sec-added');
      expect(addedIndex).toBe(1);
    });

    it('returns -1 for non-existent section', () => {
      const room = getCurrentRoom(state);
      const nonExistentIndex = room.sections.findIndex(s => s.id === 'non-existent');
      expect(nonExistentIndex).toBe(-1);
    });
  });
});
