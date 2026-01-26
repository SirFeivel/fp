import { describe, it, expect, vi } from 'vitest';
import { createExclusionsController } from './exclusions.js';

describe('createExclusionsController', () => {
  function createMockController(initialState = null) {
    const state = initialState || {
      room: { widthCm: 200, heightCm: 300 },
      exclusions: [],
    };

    let selectedId = null;

    const getState = vi.fn(() => state);
    const commit = vi.fn((label, nextState) => {
      Object.assign(state, nextState);
    });
    const getSelectedId = vi.fn(() => selectedId);
    const setSelectedId = vi.fn((id) => {
      selectedId = id;
    });

    const controller = createExclusionsController({
      getState,
      commit,
      getSelectedId,
      setSelectedId,
    });

    return { controller, getState, commit, getSelectedId, setSelectedId, state };
  }

  describe('addRect', () => {
    it('adds rectangle exclusion', () => {
      const { controller, state, commit, setSelectedId } = createMockController();

      controller.addRect();

      expect(commit).toHaveBeenCalledWith('Ausschluss hinzugefügt', expect.any(Object));
      expect(state.exclusions).toHaveLength(1);
      expect(state.exclusions[0].type).toBe('rect');
      expect(setSelectedId).toHaveBeenCalled();
    });

    it('creates rect with valid dimensions', () => {
      const { controller, state } = createMockController();

      controller.addRect();

      const rect = state.exclusions[0];
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.w).toBeGreaterThan(0);
      expect(rect.h).toBeGreaterThan(0);
    });

    it('creates rect with unique id', () => {
      const { controller, state } = createMockController();

      controller.addRect();
      controller.addRect();

      expect(state.exclusions[0].id).not.toBe(state.exclusions[1].id);
    });

    it('sets label for rect', () => {
      const { controller, state } = createMockController();

      controller.addRect();

      expect(state.exclusions[0].label).toContain('Rechteck');
    });

    it('selects newly added rect', () => {
      const { controller, state, setSelectedId } = createMockController();

      controller.addRect();

      expect(setSelectedId).toHaveBeenCalledWith(state.exclusions[0].id);
    });
  });

  describe('addCircle', () => {
    it('adds circle exclusion', () => {
      const { controller, state, commit } = createMockController();

      controller.addCircle();

      expect(commit).toHaveBeenCalledWith('Ausschluss hinzugefügt', expect.any(Object));
      expect(state.exclusions).toHaveLength(1);
      expect(state.exclusions[0].type).toBe('circle');
    });

    it('creates circle with valid properties', () => {
      const { controller, state } = createMockController();

      controller.addCircle();

      const circle = state.exclusions[0];
      expect(circle.cx).toBeGreaterThanOrEqual(0);
      expect(circle.cy).toBeGreaterThanOrEqual(0);
      expect(circle.r).toBeGreaterThan(0);
    });

    it('sets label for circle', () => {
      const { controller, state } = createMockController();

      controller.addCircle();

      expect(state.exclusions[0].label).toContain('Kreis');
    });

    it('selects newly added circle', () => {
      const { controller, state, setSelectedId } = createMockController();

      controller.addCircle();

      expect(setSelectedId).toHaveBeenCalledWith(state.exclusions[0].id);
    });
  });

  describe('addTri', () => {
    it('adds triangle exclusion', () => {
      const { controller, state, commit } = createMockController();

      controller.addTri();

      expect(commit).toHaveBeenCalledWith('Ausschluss hinzugefügt', expect.any(Object));
      expect(state.exclusions).toHaveLength(1);
      expect(state.exclusions[0].type).toBe('tri');
    });

    it('creates triangle with three points', () => {
      const { controller, state } = createMockController();

      controller.addTri();

      const tri = state.exclusions[0];
      expect(tri.p1).toBeDefined();
      expect(tri.p2).toBeDefined();
      expect(tri.p3).toBeDefined();
      expect(tri.p1.x).toBeDefined();
      expect(tri.p1.y).toBeDefined();
    });

    it('sets label for triangle', () => {
      const { controller, state } = createMockController();

      controller.addTri();

      expect(state.exclusions[0].label).toContain('Dreieck');
    });

    it('selects newly added triangle', () => {
      const { controller, state, setSelectedId } = createMockController();

      controller.addTri();

      expect(setSelectedId).toHaveBeenCalledWith(state.exclusions[0].id);
    });
  });

  describe('deleteSelectedExcl', () => {
    it('deletes selected exclusion', () => {
      const initialState = {
        room: { widthCm: 200, heightCm: 300 },
        exclusions: [
          { id: '1', type: 'rect', x: 0, y: 0, w: 10, h: 10 },
          { id: '2', type: 'circle', cx: 50, cy: 50, r: 10 },
        ],
      };
      const { controller, state, commit } = createMockController(initialState);

      controller.deleteSelectedExcl();

      expect(state.exclusions).toHaveLength(2);
    });

    it('does nothing when no selection', () => {
      const { controller, state, commit } = createMockController();

      controller.deleteSelectedExcl();

      expect(commit).not.toHaveBeenCalled();
    });

    it('does nothing when selected id not found', () => {
      const initialState = {
        room: { widthCm: 200, heightCm: 300 },
        exclusions: [{ id: '1', type: 'rect', x: 0, y: 0, w: 10, h: 10 }],
      };
      let selectedId = 'non-existent';
      const { controller, commit } = createMockController(initialState);

      controller.deleteSelectedExcl();

      expect(commit).not.toHaveBeenCalled();
    });

    it('selects last exclusion after deletion', () => {
      const initialState = {
        room: { widthCm: 200, heightCm: 300 },
        exclusions: [
          { id: '1', type: 'rect', x: 0, y: 0, w: 10, h: 10 },
          { id: '2', type: 'circle', cx: 50, cy: 50, r: 10 },
        ],
      };
      const mock = createMockController(initialState);

      mock.setSelectedId('1');
      mock.controller.deleteSelectedExcl();

      expect(mock.setSelectedId).toHaveBeenCalledWith('2');
    });

    it('selects null when last exclusion deleted', () => {
      const initialState = {
        room: { widthCm: 200, heightCm: 300 },
        exclusions: [{ id: '1', type: 'rect', x: 0, y: 0, w: 10, h: 10 }],
      };
      const mock = createMockController(initialState);

      mock.setSelectedId('1');
      mock.controller.deleteSelectedExcl();

      expect(mock.setSelectedId).toHaveBeenCalledWith(null);
    });
  });

  describe('getSelectedExcl', () => {
    it('returns selected exclusion', () => {
      const initialState = {
        room: { widthCm: 200, heightCm: 300 },
        exclusions: [
          { id: '1', type: 'rect', x: 0, y: 0, w: 10, h: 10 },
          { id: '2', type: 'circle', cx: 50, cy: 50, r: 10 },
        ],
      };
      const mock = createMockController(initialState);

      mock.setSelectedId('2');
      const result = mock.controller.getSelectedExcl();

      expect(result).toBeDefined();
      expect(result.id).toBe('2');
      expect(result.type).toBe('circle');
    });

    it('returns null when no selection', () => {
      const { controller } = createMockController();

      const result = controller.getSelectedExcl();

      expect(result).toBeNull();
    });

    it('returns null when selected id not found', () => {
      const initialState = {
        room: { widthCm: 200, heightCm: 300 },
        exclusions: [{ id: '1', type: 'rect', x: 0, y: 0, w: 10, h: 10 }],
      };
      const mock = createMockController(initialState);

      mock.setSelectedId('non-existent');
      const result = mock.controller.getSelectedExcl();

      expect(result).toBeNull();
    });
  });

  describe('commitExclProps', () => {
    it('does nothing when no selection', () => {
      const { controller, commit } = createMockController();

      controller.commitExclProps('Test');

      expect(commit).not.toHaveBeenCalled();
    });

    it('does nothing when selected id not found', () => {
      const initialState = {
        room: { widthCm: 200, heightCm: 300 },
        exclusions: [{ id: '1', type: 'rect', x: 0, y: 0, w: 10, h: 10 }],
      };
      const mock = createMockController(initialState);

      mock.setSelectedId('non-existent');
      mock.controller.commitExclProps('Test');

      expect(mock.commit).not.toHaveBeenCalled();
    });
  });

  describe('integration', () => {
    it('can add and delete multiple exclusions', () => {
      const { controller, state } = createMockController();

      controller.addRect();
      controller.addCircle();
      controller.addTri();

      expect(state.exclusions).toHaveLength(3);

      controller.deleteSelectedExcl();
      expect(state.exclusions).toHaveLength(2);
    });

    it('maintains separate ids for different shapes', () => {
      const { controller, state } = createMockController();

      controller.addRect();
      const rectId = state.exclusions[0].id;

      controller.addCircle();
      const circleId = state.exclusions[1].id;

      controller.addTri();
      const triId = state.exclusions[2].id;

      expect(rectId).not.toBe(circleId);
      expect(circleId).not.toBe(triId);
      expect(rectId).not.toBe(triId);
    });
  });
});
