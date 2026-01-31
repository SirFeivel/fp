/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createExclusionDragController } from './drag.js';

describe('createExclusionDragController', () => {
  let mockSvg;
  let mockElements;
  let pointerMoveHandler;
  let pointerUpHandler;

  beforeEach(() => {
    mockElements = [];

    // Mock SVG element
    mockSvg = {
      createSVGPoint: () => ({
        x: 0,
        y: 0,
        matrixTransform: (matrix) => ({ x: mockSvg._transformedX, y: mockSvg._transformedY })
      }),
      getScreenCTM: () => ({
        inverse: () => ({})
      }),
      setPointerCapture: vi.fn(),
      addEventListener: vi.fn((event, handler, options) => {
        if (event === 'pointermove') pointerMoveHandler = handler;
        if (event === 'pointerup') pointerUpHandler = handler;
        if (event === 'pointercancel') pointerUpHandler = handler;
      }),
      removeEventListener: vi.fn(),
      _transformedX: 0,
      _transformedY: 0
    };

    // Mock document.querySelectorAll
    vi.spyOn(document, 'querySelectorAll').mockImplementation((selector) => {
      return mockElements;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    pointerMoveHandler = null;
    pointerUpHandler = null;
  });

  function createMockController(initialExclusions = [], { onDragStart, onDragEnd } = {}) {
    const state = {
      floors: [{
        id: 'floor1',
        name: 'Test Floor',
        rooms: [{
          id: 'room1',
          name: 'Test Room',
          sections: [{ id: 's1', x: 0, y: 0, widthCm: 600, heightCm: 400 }],
          exclusions: initialExclusions,
          tile: { widthCm: 60, heightCm: 60 },
          grout: { widthCm: 0.2 },
          pattern: { type: "grid" }
        }]
      }],
      selectedFloorId: 'floor1',
      selectedRoomId: 'room1'
    };

    let currentState = JSON.parse(JSON.stringify(state));
    let selectedExcl = null;

    const getSvg = vi.fn(() => mockSvg);
    const getState = vi.fn(() => currentState);
    const setStateDirect = vi.fn((newState) => {
      currentState = newState;
    });
    const commit = vi.fn((label, newState) => {
      currentState = JSON.parse(JSON.stringify(newState));
    });
    const render = vi.fn();
    const getSelectedExcl = vi.fn(() => selectedExcl);
    const setSelectedExcl = vi.fn((id) => {
      selectedExcl = currentState.floors[0].rooms[0].exclusions.find(e => e.id === id) || null;
    });
    const setSelectedIdOnly = vi.fn((id) => {
      selectedExcl = currentState.floors[0].rooms[0].exclusions.find(e => e.id === id) || null;
    });
    const getSelectedId = vi.fn(() => selectedExcl?.id || null);
    const getMoveLabel = vi.fn(() => 'Exclusion moved');

    const controller = createExclusionDragController({
      getSvg,
      getState,
      setStateDirect,
      commit,
      render,
      getSelectedExcl,
      setSelectedExcl,
      setSelectedIdOnly,
      getSelectedId,
      getMoveLabel,
      onDragStart,
      onDragEnd
    });

    return {
      controller,
      getSvg,
      getState,
      setStateDirect,
      commit,
      render,
      getSelectedExcl,
      setSelectedExcl,
      setSelectedIdOnly,
      getSelectedId,
      getMoveLabel,
      get currentState() { return currentState; }
    };
  }

  describe('onExclPointerDown', () => {
    it('returns controller with onExclPointerDown method', () => {
      const { controller } = createMockController();
      expect(controller.onExclPointerDown).toBeDefined();
      expect(typeof controller.onExclPointerDown).toBe('function');
    });

    it('sets selected exclusion on pointer down and triggers drag-mode render', () => {
      const exclusions = [{ id: 'ex1', type: 'rect', x: 10, y: 20, w: 50, h: 30 }];
      const { controller, setSelectedIdOnly, render } = createMockController(exclusions);

      const mockEvent = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        currentTarget: { getAttribute: () => 'ex1' },
        pointerId: 1,
        clientX: 100,
        clientY: 100
      };

      mockSvg._transformedX = 100;
      mockSvg._transformedY = 100;

      controller.onExclPointerDown(mockEvent);

      expect(setSelectedIdOnly).toHaveBeenCalledWith('ex1');
      expect(render).toHaveBeenCalledWith({ mode: 'drag' });
    });

    it('captures pointer on drag start', () => {
      const exclusions = [{ id: 'ex1', type: 'rect', x: 10, y: 20, w: 50, h: 30 }];
      const { controller } = createMockController(exclusions);

      const mockEvent = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        currentTarget: { getAttribute: () => 'ex1' },
        pointerId: 42,
        clientX: 100,
        clientY: 100
      };

      mockSvg._transformedX = 100;
      mockSvg._transformedY = 100;

      controller.onExclPointerDown(mockEvent);

      expect(mockSvg.setPointerCapture).toHaveBeenCalledWith(42);
    });

    it('registers pointermove and pointerup listeners', () => {
      const exclusions = [{ id: 'ex1', type: 'rect', x: 10, y: 20, w: 50, h: 30 }];
      const { controller } = createMockController(exclusions);

      const mockEvent = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        currentTarget: { getAttribute: () => 'ex1' },
        pointerId: 1,
        clientX: 100,
        clientY: 100
      };

      controller.onExclPointerDown(mockEvent);

      expect(mockSvg.addEventListener).toHaveBeenCalledWith('pointermove', expect.any(Function));
      expect(mockSvg.addEventListener).toHaveBeenCalledWith('pointerup', expect.any(Function), { once: true });
    });

    it('invokes drag callbacks on start and end', () => {
      const exclusions = [{ id: 'ex1', type: 'rect', x: 10, y: 20, w: 50, h: 30 }];
      const onDragStart = vi.fn();
      const onDragEnd = vi.fn();
      const { controller } = createMockController(exclusions, { onDragStart, onDragEnd });

      const mockEvent = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        currentTarget: { getAttribute: () => 'ex1' },
        pointerId: 1,
        clientX: 100,
        clientY: 100
      };

      mockSvg._transformedX = 100;
      mockSvg._transformedY = 100;

      controller.onExclPointerDown(mockEvent);
      expect(onDragStart).toHaveBeenCalledWith('ex1');

      pointerUpHandler({});
      expect(onDragEnd).toHaveBeenCalledWith({ id: 'ex1', moved: false, type: 'drag' });
    });

    it('does nothing when no id attribute', () => {
      const { controller, setSelectedExcl } = createMockController();

      const mockEvent = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        currentTarget: { getAttribute: () => null },
        pointerId: 1,
        clientX: 100,
        clientY: 100
      };

      controller.onExclPointerDown(mockEvent);

      expect(setSelectedExcl).not.toHaveBeenCalled();
    });
  });

  describe('drag movement with CSS transforms', () => {
    it('applies transform to elements during drag', async () => {
      const exclusions = [{ id: 'ex1', type: 'rect', x: 10, y: 20, w: 50, h: 30 }];
      const { controller, render } = createMockController(exclusions);

      // Create mock element that will be found by querySelectorAll
      const mockEl = { setAttribute: vi.fn(), removeAttribute: vi.fn() };
      mockElements = [mockEl];

      const mockDownEvent = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        currentTarget: { getAttribute: () => 'ex1' },
        pointerId: 1,
        clientX: 100,
        clientY: 100
      };

      mockSvg._transformedX = 100;
      mockSvg._transformedY = 100;

      controller.onExclPointerDown(mockDownEvent);
      
      // Clear initial render call from drag start
      render.mockClear();

      // Simulate move
      mockSvg._transformedX = 150;
      mockSvg._transformedY = 120;

      const mockMoveEvent = {
        clientX: 150,
        clientY: 120
      };

      // Trigger pointermove
      pointerMoveHandler(mockMoveEvent);

      // Wait for requestAnimationFrame
      await new Promise(resolve => requestAnimationFrame(resolve));

      // Should apply transform, not call render during drag
      expect(mockEl.setAttribute).toHaveBeenCalledWith('transform', 'translate(50, 20)');
      expect(render).not.toHaveBeenCalled();
    });

    it('does not rebuild DOM during drag (performance optimization)', async () => {
      const exclusions = [{ id: 'ex1', type: 'rect', x: 10, y: 20, w: 50, h: 30 }];
      const { controller, render, setStateDirect } = createMockController(exclusions);

      const mockEl = { setAttribute: vi.fn(), removeAttribute: vi.fn() };
      mockElements = [mockEl];

      const mockDownEvent = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        currentTarget: { getAttribute: () => 'ex1' },
        pointerId: 1,
        clientX: 100,
        clientY: 100
      };

      mockSvg._transformedX = 100;
      mockSvg._transformedY = 100;

      controller.onExclPointerDown(mockDownEvent);
      
      // Clear initial render call from drag start
      render.mockClear();

      // Simulate multiple moves
      for (let i = 0; i < 10; i++) {
        mockSvg._transformedX = 100 + i * 10;
        mockSvg._transformedY = 100 + i * 5;

        pointerMoveHandler({ clientX: 100 + i * 10, clientY: 100 + i * 5 });
        await new Promise(resolve => requestAnimationFrame(resolve));
      }

      // render should never be called during drag
      expect(render).not.toHaveBeenCalled();
      // setStateDirect should never be called during drag
      expect(setStateDirect).not.toHaveBeenCalled();
    });
  });

  describe('drag end and commit', () => {
    it('commits final state with updated rect position on drag end', async () => {
      const exclusions = [{ id: 'ex1', type: 'rect', x: 10, y: 20, w: 50, h: 30 }];
      const { controller, commit } = createMockController(exclusions);

      const mockEl = { setAttribute: vi.fn(), removeAttribute: vi.fn() };
      mockElements = [mockEl];

      const mockDownEvent = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        currentTarget: { getAttribute: () => 'ex1' },
        pointerId: 1,
        clientX: 100,
        clientY: 100
      };

      mockSvg._transformedX = 100;
      mockSvg._transformedY = 100;

      controller.onExclPointerDown(mockDownEvent);

      // Move
      mockSvg._transformedX = 150;
      mockSvg._transformedY = 130;
      pointerMoveHandler({ clientX: 150, clientY: 130 });
      await new Promise(resolve => requestAnimationFrame(resolve));

      // End drag
      pointerUpHandler({});

      expect(commit).toHaveBeenCalledWith('Exclusion moved', expect.any(Object));

      const committedState = commit.mock.calls[0][1];
      const movedRect = committedState.floors[0].rooms[0].exclusions[0];
      expect(movedRect.x).toBe(60); // 10 + 50
      expect(movedRect.y).toBe(50); // 20 + 30
    });

    it('commits final state with updated circle position on drag end', async () => {
      const exclusions = [{ id: 'ex1', type: 'circle', cx: 100, cy: 100, r: 25 }];
      const { controller, commit } = createMockController(exclusions);

      const mockEl = { setAttribute: vi.fn(), removeAttribute: vi.fn() };
      mockElements = [mockEl];

      const mockDownEvent = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        currentTarget: { getAttribute: () => 'ex1' },
        pointerId: 1,
        clientX: 100,
        clientY: 100
      };

      mockSvg._transformedX = 100;
      mockSvg._transformedY = 100;

      controller.onExclPointerDown(mockDownEvent);

      // Move
      mockSvg._transformedX = 180;
      mockSvg._transformedY = 160;
      pointerMoveHandler({ clientX: 180, clientY: 160 });
      await new Promise(resolve => requestAnimationFrame(resolve));

      // End drag
      pointerUpHandler({});

      expect(commit).toHaveBeenCalled();

      const committedState = commit.mock.calls[0][1];
      const movedCircle = committedState.floors[0].rooms[0].exclusions[0];
      expect(movedCircle.cx).toBe(180); // 100 + 80
      expect(movedCircle.cy).toBe(160); // 100 + 60
    });

    it('commits final state with updated triangle position on drag end', async () => {
      const exclusions = [{
        id: 'ex1',
        type: 'tri',
        p1: { x: 10, y: 10 },
        p2: { x: 50, y: 10 },
        p3: { x: 30, y: 40 }
      }];
      const { controller, commit } = createMockController(exclusions);

      const mockEl = { setAttribute: vi.fn(), removeAttribute: vi.fn() };
      mockElements = [mockEl];

      const mockDownEvent = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        currentTarget: { getAttribute: () => 'ex1' },
        pointerId: 1,
        clientX: 100,
        clientY: 100
      };

      mockSvg._transformedX = 100;
      mockSvg._transformedY = 100;

      controller.onExclPointerDown(mockDownEvent);

      // Move by (25, 15)
      mockSvg._transformedX = 125;
      mockSvg._transformedY = 115;
      pointerMoveHandler({ clientX: 125, clientY: 115 });
      await new Promise(resolve => requestAnimationFrame(resolve));

      // End drag
      pointerUpHandler({});

      expect(commit).toHaveBeenCalled();

      const committedState = commit.mock.calls[0][1];
      const movedTri = committedState.floors[0].rooms[0].exclusions[0];
      expect(movedTri.p1.x).toBe(35); // 10 + 25
      expect(movedTri.p1.y).toBe(25); // 10 + 15
      expect(movedTri.p2.x).toBe(75); // 50 + 25
      expect(movedTri.p2.y).toBe(25); // 10 + 15
      expect(movedTri.p3.x).toBe(55); // 30 + 25
      expect(movedTri.p3.y).toBe(55); // 40 + 15
    });

    it('does not commit when no movement occurred', async () => {
      const exclusions = [{ id: 'ex1', type: 'rect', x: 10, y: 20, w: 50, h: 30 }];
      const { controller, commit } = createMockController(exclusions);

      const mockEl = { setAttribute: vi.fn(), removeAttribute: vi.fn() };
      mockElements = [mockEl];

      const mockDownEvent = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        currentTarget: { getAttribute: () => 'ex1' },
        pointerId: 1,
        clientX: 100,
        clientY: 100
      };

      mockSvg._transformedX = 100;
      mockSvg._transformedY = 100;

      controller.onExclPointerDown(mockDownEvent);

      // End drag without moving
      pointerUpHandler({});

      expect(commit).not.toHaveBeenCalled();
    });

    it('clears transform and triggers render when no movement', () => {
      const exclusions = [{ id: 'ex1', type: 'rect', x: 10, y: 20, w: 50, h: 30 }];
      const { controller, render } = createMockController(exclusions);

      const mockEl = { setAttribute: vi.fn(), removeAttribute: vi.fn() };
      mockElements = [mockEl];

      const mockDownEvent = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        currentTarget: { getAttribute: () => 'ex1' },
        pointerId: 1,
        clientX: 100,
        clientY: 100
      };

      mockSvg._transformedX = 100;
      mockSvg._transformedY = 100;

      controller.onExclPointerDown(mockDownEvent);

      // Clear render mock to isolate pointerup's render call
      render.mockClear();

      // End drag without moving
      pointerUpHandler({});

      expect(mockEl.removeAttribute).toHaveBeenCalledWith('transform');
      // render() is called directly (ID already set in pointerdown)
      expect(render).toHaveBeenCalled();
    });

    it('removes pointermove listener on drag end', () => {
      const exclusions = [{ id: 'ex1', type: 'rect', x: 10, y: 20, w: 50, h: 30 }];
      const { controller } = createMockController(exclusions);

      const mockDownEvent = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        currentTarget: { getAttribute: () => 'ex1' },
        pointerId: 1,
        clientX: 100,
        clientY: 100
      };

      controller.onExclPointerDown(mockDownEvent);

      pointerUpHandler({});

      expect(mockSvg.removeEventListener).toHaveBeenCalledWith('pointermove', expect.any(Function));
    });
  });

  describe('multiple elements (main + fullscreen SVG)', () => {
    it('applies transform to all matching elements', async () => {
      const exclusions = [{ id: 'ex1', type: 'rect', x: 10, y: 20, w: 50, h: 30 }];
      const { controller } = createMockController(exclusions);

      // Multiple elements (main SVG + fullscreen SVG)
      const mockEl1 = { setAttribute: vi.fn(), removeAttribute: vi.fn() };
      const mockEl2 = { setAttribute: vi.fn(), removeAttribute: vi.fn() };
      mockElements = [mockEl1, mockEl2];

      const mockDownEvent = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        currentTarget: { getAttribute: () => 'ex1' },
        pointerId: 1,
        clientX: 100,
        clientY: 100
      };

      mockSvg._transformedX = 100;
      mockSvg._transformedY = 100;

      controller.onExclPointerDown(mockDownEvent);

      // Move
      mockSvg._transformedX = 120;
      mockSvg._transformedY = 110;
      pointerMoveHandler({ clientX: 120, clientY: 110 });
      await new Promise(resolve => requestAnimationFrame(resolve));

      // Both elements should have transform applied
      expect(mockEl1.setAttribute).toHaveBeenCalledWith('transform', 'translate(20, 10)');
      expect(mockEl2.setAttribute).toHaveBeenCalledWith('transform', 'translate(20, 10)');
    });
  });
});
