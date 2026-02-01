import { describe, it, expect, vi } from 'vitest';
import { createExclusionsController } from './exclusions.js';

describe('createExclusionsController', () => {
  function createMockController(initialState = null) {
    const state = initialState || {
      floors: [{
        id: 'floor1',
        name: 'Test Floor',
        rooms: [{
          id: 'room1',
          name: 'Test Room',
          sections: [{ id: 's1', x: 0, y: 0, widthCm: 200, heightCm: 300 }],
          exclusions: [],
          tile: { widthCm: 60, heightCm: 60 },
          grout: { widthCm: 0.2 },
          pattern: {
            type: "grid",
            bondFraction: 0.5,
            rotationDeg: 0,
            offsetXcm: 0,
            offsetYcm: 0,
            origin: { preset: "tl", xCm: 0, yCm: 0 }
          }
        }]
      }],
      selectedFloorId: 'floor1',
      selectedRoomId: 'room1'
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

      const room = state.floors[0].rooms[0];
      expect(commit).toHaveBeenCalledWith('Ausschluss hinzugefügt', expect.any(Object));
      expect(room.exclusions).toHaveLength(1);
      expect(room.exclusions[0].type).toBe('rect');
      expect(setSelectedId).toHaveBeenCalled();
    });

    it('creates rect with valid dimensions', () => {
      const { controller, state } = createMockController();

      controller.addRect();

      const room = state.floors[0].rooms[0];
      const rect = room.exclusions[0];
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.w).toBeGreaterThan(0);
      expect(rect.h).toBeGreaterThan(0);
    });

    it('creates rect with unique id', () => {
      const { controller, state } = createMockController();

      controller.addRect();
      controller.addRect();

      const room = state.floors[0].rooms[0];
      expect(room.exclusions[0].id).not.toBe(room.exclusions[1].id);
    });

    it('sets label for rect', () => {
      const { controller, state } = createMockController();

      controller.addRect();

      const room = state.floors[0].rooms[0];
      expect(room.exclusions[0].label).toContain('Rechteck');
    });

    it('selects newly added rect', () => {
      const { controller, state, setSelectedId } = createMockController();

      controller.addRect();

      const room = state.floors[0].rooms[0];
      expect(setSelectedId).toHaveBeenCalledWith(room.exclusions[0].id);
    });
  });

  describe('addCircle', () => {
    it('adds circle exclusion', () => {
      const { controller, state, commit } = createMockController();

      controller.addCircle();

      const room = state.floors[0].rooms[0];
      expect(commit).toHaveBeenCalledWith('Ausschluss hinzugefügt', expect.any(Object));
      expect(room.exclusions).toHaveLength(1);
      expect(room.exclusions[0].type).toBe('circle');
    });

    it('creates circle with valid properties', () => {
      const { controller, state } = createMockController();

      controller.addCircle();

      const room = state.floors[0].rooms[0];
      const circle = room.exclusions[0];
      expect(circle.cx).toBeGreaterThanOrEqual(0);
      expect(circle.cy).toBeGreaterThanOrEqual(0);
      expect(circle.r).toBeGreaterThan(0);
    });

    it('sets label for circle', () => {
      const { controller, state } = createMockController();

      controller.addCircle();

      const room = state.floors[0].rooms[0];
      expect(room.exclusions[0].label).toContain('Kreis');
    });

    it('selects newly added circle', () => {
      const { controller, state, setSelectedId } = createMockController();

      controller.addCircle();

      const room = state.floors[0].rooms[0];
      expect(setSelectedId).toHaveBeenCalledWith(room.exclusions[0].id);
    });
  });

  describe('addTri', () => {
    it('adds triangle exclusion', () => {
      const { controller, state, commit } = createMockController();

      controller.addTri();

      const room = state.floors[0].rooms[0];
      expect(commit).toHaveBeenCalledWith('Ausschluss hinzugefügt', expect.any(Object));
      expect(room.exclusions).toHaveLength(1);
      expect(room.exclusions[0].type).toBe('tri');
    });

    it('creates triangle with three points', () => {
      const { controller, state } = createMockController();

      controller.addTri();

      const room = state.floors[0].rooms[0];
      const tri = room.exclusions[0];
      expect(tri.p1).toBeDefined();
      expect(tri.p2).toBeDefined();
      expect(tri.p3).toBeDefined();
      expect(tri.p1.x).toBeDefined();
      expect(tri.p1.y).toBeDefined();
    });

    it('sets label for triangle', () => {
      const { controller, state } = createMockController();

      controller.addTri();

      const room = state.floors[0].rooms[0];
      expect(room.exclusions[0].label).toContain('Dreieck');
    });

    it('selects newly added triangle', () => {
      const { controller, state, setSelectedId } = createMockController();

      controller.addTri();

      const room = state.floors[0].rooms[0];
      expect(setSelectedId).toHaveBeenCalledWith(room.exclusions[0].id);
    });
  });

  describe('addFreeform', () => {
    it('adds freeform exclusion with provided vertices', () => {
      const { controller, state, commit, setSelectedId } = createMockController();
      const vertices = [{ x: 10, y: 10 }, { x: 50, y: 10 }, { x: 50, y: 50 }];

      controller.addFreeform(vertices);

      const room = state.floors[0].rooms[0];
      expect(commit).toHaveBeenCalledWith('Freiform-Ausschluss hinzugefügt', expect.any(Object));
      expect(room.exclusions).toHaveLength(1);
      expect(room.exclusions[0].type).toBe('freeform');
      expect(setSelectedId).toHaveBeenCalled();
    });

    it('creates freeform with vertices array', () => {
      const { controller, state } = createMockController();
      const vertices = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];

      controller.addFreeform(vertices);

      const room = state.floors[0].rooms[0];
      const freeform = room.exclusions[0];
      expect(freeform.vertices).toHaveLength(4);
      expect(freeform.vertices[0]).toEqual({ x: 0, y: 0 });
      expect(freeform.vertices[2]).toEqual({ x: 100, y: 100 });
    });

    it('creates freeform with unique id', () => {
      const { controller, state } = createMockController();

      controller.addFreeform([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]);
      controller.addFreeform([{ x: 20, y: 20 }, { x: 30, y: 20 }, { x: 30, y: 30 }]);

      const room = state.floors[0].rooms[0];
      expect(room.exclusions[0].id).not.toBe(room.exclusions[1].id);
    });

    it('sets label for freeform', () => {
      const { controller, state } = createMockController();

      controller.addFreeform([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]);

      const room = state.floors[0].rooms[0];
      expect(room.exclusions[0].label).toContain('Freiform');
    });

    it('selects newly added freeform', () => {
      const { controller, state, setSelectedId } = createMockController();

      controller.addFreeform([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]);

      const room = state.floors[0].rooms[0];
      expect(setSelectedId).toHaveBeenCalledWith(room.exclusions[0].id);
    });

    it('sets skirtingEnabled to true by default', () => {
      const { controller, state } = createMockController();

      controller.addFreeform([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]);

      const room = state.floors[0].rooms[0];
      expect(room.exclusions[0].skirtingEnabled).toBe(true);
    });

    it('does nothing with less than 3 vertices', () => {
      const { controller, commit } = createMockController();

      controller.addFreeform([{ x: 0, y: 0 }, { x: 10, y: 0 }]);

      expect(commit).not.toHaveBeenCalled();
    });

    it('does nothing with null vertices', () => {
      const { controller, commit } = createMockController();

      controller.addFreeform(null);

      expect(commit).not.toHaveBeenCalled();
    });

    it('does nothing with empty vertices array', () => {
      const { controller, commit } = createMockController();

      controller.addFreeform([]);

      expect(commit).not.toHaveBeenCalled();
    });

    it('increments label number for each freeform', () => {
      const { controller, state } = createMockController();

      controller.addFreeform([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]);
      controller.addFreeform([{ x: 20, y: 20 }, { x: 30, y: 20 }, { x: 30, y: 30 }]);

      const room = state.floors[0].rooms[0];
      expect(room.exclusions[0].label).toContain('1');
      expect(room.exclusions[1].label).toContain('2');
    });
  });

  describe('deleteSelectedExcl', () => {
    it('deletes selected exclusion', () => {
      const initialState = {
        floors: [{
          id: 'floor1',
          name: 'Test Floor',
          rooms: [{
            id: 'room1',
            name: 'Test Room',
            widthCm: 200,
            heightCm: 300,
            exclusions: [
              { id: '1', type: 'rect', x: 0, y: 0, w: 10, h: 10 },
              { id: '2', type: 'circle', cx: 50, cy: 50, r: 10 },
            ]
          }]
        }],
        selectedFloorId: 'floor1',
        selectedRoomId: 'room1'
      };
      const { controller, state, commit } = createMockController(initialState);

      controller.deleteSelectedExcl();

      const room = state.floors[0].rooms[0];
      expect(room.exclusions).toHaveLength(2);
    });

    it('does nothing when no selection', () => {
      const { controller, state, commit } = createMockController();

      controller.deleteSelectedExcl();

      expect(commit).not.toHaveBeenCalled();
    });

    it('does nothing when selected id not found', () => {
      const initialState = {
        floors: [{
          id: 'floor1',
          name: 'Test Floor',
          rooms: [{
            id: 'room1',
            name: 'Test Room',
            widthCm: 200,
            heightCm: 300,
            exclusions: [{ id: '1', type: 'rect', x: 0, y: 0, w: 10, h: 10 }]
          }]
        }],
        selectedFloorId: 'floor1',
        selectedRoomId: 'room1'
      };
      let selectedId = 'non-existent';
      const { controller, commit } = createMockController(initialState);

      controller.deleteSelectedExcl();

      expect(commit).not.toHaveBeenCalled();
    });

    it('selects last exclusion after deletion', () => {
      const initialState = {
        floors: [{
          id: 'floor1',
          name: 'Test Floor',
          rooms: [{
            id: 'room1',
            name: 'Test Room',
            widthCm: 200,
            heightCm: 300,
            exclusions: [
              { id: '1', type: 'rect', x: 0, y: 0, w: 10, h: 10 },
              { id: '2', type: 'circle', cx: 50, cy: 50, r: 10 },
            ]
          }]
        }],
        selectedFloorId: 'floor1',
        selectedRoomId: 'room1'
      };
      const mock = createMockController(initialState);

      mock.setSelectedId('1');
      mock.controller.deleteSelectedExcl();

      expect(mock.setSelectedId).toHaveBeenCalledWith('2');
    });

    it('selects null when last exclusion deleted', () => {
      const initialState = {
        floors: [{
          id: 'floor1',
          name: 'Test Floor',
          rooms: [{
            id: 'room1',
            name: 'Test Room',
            widthCm: 200,
            heightCm: 300,
            exclusions: [{ id: '1', type: 'rect', x: 0, y: 0, w: 10, h: 10 }]
          }]
        }],
        selectedFloorId: 'floor1',
        selectedRoomId: 'room1'
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
        floors: [{
          id: 'floor1',
          name: 'Test Floor',
          rooms: [{
            id: 'room1',
            name: 'Test Room',
            widthCm: 200,
            heightCm: 300,
            exclusions: [
              { id: '1', type: 'rect', x: 0, y: 0, w: 10, h: 10 },
              { id: '2', type: 'circle', cx: 50, cy: 50, r: 10 },
            ]
          }]
        }],
        selectedFloorId: 'floor1',
        selectedRoomId: 'room1'
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
        floors: [{
          id: 'floor1',
          name: 'Test Floor',
          rooms: [{
            id: 'room1',
            name: 'Test Room',
            widthCm: 200,
            heightCm: 300,
            exclusions: [{ id: '1', type: 'rect', x: 0, y: 0, w: 10, h: 10 }]
          }]
        }],
        selectedFloorId: 'floor1',
        selectedRoomId: 'room1'
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
        floors: [{
          id: 'floor1',
          name: 'Test Floor',
          rooms: [{
            id: 'room1',
            name: 'Test Room',
            widthCm: 200,
            heightCm: 300,
            exclusions: [{ id: '1', type: 'rect', x: 0, y: 0, w: 10, h: 10 }]
          }]
        }],
        selectedFloorId: 'floor1',
        selectedRoomId: 'room1'
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
      controller.addFreeform([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]);

      const roomAfterAdd = state.floors[0].rooms[0];
      expect(roomAfterAdd.exclusions).toHaveLength(4);

      controller.deleteSelectedExcl();
      const roomAfterDelete = state.floors[0].rooms[0];
      expect(roomAfterDelete.exclusions).toHaveLength(3);
    });

    it('maintains separate ids for different shapes', () => {
      const { controller, state } = createMockController();

      controller.addRect();
      const roomAfterRect = state.floors[0].rooms[0];
      const rectId = roomAfterRect.exclusions[0].id;

      controller.addCircle();
      const roomAfterCircle = state.floors[0].rooms[0];
      const circleId = roomAfterCircle.exclusions[1].id;

      controller.addTri();
      const roomAfterTri = state.floors[0].rooms[0];
      const triId = roomAfterTri.exclusions[2].id;

      controller.addFreeform([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]);
      const roomAfterFreeform = state.floors[0].rooms[0];
      const freeformId = roomAfterFreeform.exclusions[3].id;

      expect(rectId).not.toBe(circleId);
      expect(circleId).not.toBe(triId);
      expect(rectId).not.toBe(triId);
      expect(freeformId).not.toBe(rectId);
      expect(freeformId).not.toBe(circleId);
      expect(freeformId).not.toBe(triId);
    });
  });
});
