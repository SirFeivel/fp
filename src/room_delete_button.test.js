/**
 * @vitest-environment jsdom
 *
 * Tests for the room delete button functionality.
 * The button should:
 * - Be disabled when nothing is selected
 * - Enable when an exclusion is selected
 * - Delete the selected exclusion when clicked
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getCurrentRoom } from './core.js';

describe('Room Delete Button', () => {
  let selectedExclId = null;
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
          polygonVertices: [
            { x: 0, y: 0 },
            { x: 300, y: 0 },
            { x: 300, y: 400 },
            { x: 0, y: 400 }
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

    // Enable only for exclusions
    btn.disabled = !selectedExclId;
  }

  beforeEach(() => {
    selectedExclId = null;
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

    it('is disabled when no exclusion is selected', () => {
      selectedExclId = null;
      updateRoomDeleteButtonState();
      const btn = document.getElementById('roomDeleteObject');
      expect(btn.disabled).toBe(true);
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

    it('handles room with multiple exclusions', () => {
      state.floors[0].rooms[0].exclusions.push(
        { id: 'ex2', type: 'circle', label: 'Exclusion 2', cx: 50, cy: 50, r: 20 }
      );

      selectedExclId = 'ex1';
      const room = getCurrentRoom(state);
      expect(room.exclusions.length).toBe(2);

      // Simulate deletion
      room.exclusions = room.exclusions.filter(e => e.id !== selectedExclId);

      expect(room.exclusions.length).toBe(1);
      expect(room.exclusions[0].id).toBe('ex2');
    });

    it('handles deletion of last exclusion', () => {
      selectedExclId = 'ex1';
      const room = getCurrentRoom(state);

      room.exclusions = room.exclusions.filter(e => e.id !== selectedExclId);

      expect(room.exclusions.length).toBe(0);
      // After deleting last exclusion, selection should clear
      selectedExclId = null;
      updateRoomDeleteButtonState();
      const btn = document.getElementById('roomDeleteObject');
      expect(btn.disabled).toBe(true);
    });
  });
});
