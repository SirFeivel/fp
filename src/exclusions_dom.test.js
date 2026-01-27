/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createExclusionsController } from './exclusions.js';

describe('Exclusions Controller DOM tests', () => {
  function createMockController(initialState = null) {
    const state = initialState || {
      floors: [{
        id: 'floor1',
        name: 'Test Floor',
        rooms: [{
          id: 'room1',
          name: 'Test Room',
          widthCm: 200,
          heightCm: 300,
          exclusions: [
            { id: '1', type: 'rect', label: 'R1', x: 10, y: 10, w: 50, h: 50 },
            { id: '2', type: 'circle', label: 'C1', cx: 100, cy: 100, r: 20 },
            { id: '3', type: 'tri', label: 'T1', p1: {x:0, y:0}, p2: {x:10, y:0}, p3: {x:5, y:10} }
          ],
          tile: { widthCm: 60, heightCm: 60 },
          grout: { widthCm: 0.2 },
          pattern: { type: "grid" }
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
    const setSelectedId = vi.fn((id) => { selectedId = id; });

    const controller = createExclusionsController({
      getState,
      commit,
      getSelectedId,
      setSelectedId,
    });

    return { controller, getState, commit, getSelectedId, setSelectedId, state };
  }

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('updates rect properties from DOM', () => {
    const { controller, state, setSelectedId } = createMockController();
    setSelectedId('1');

    document.body.innerHTML = `
      <input id="exLabel" value="New Rect">
      <input id="exX" value="20">
      <input id="exY" value="30">
      <input id="exW" value="100">
      <input id="exH" value="150">
    `;

    controller.commitExclProps('Update Rect');

    const ex = state.floors[0].rooms[0].exclusions[0];
    expect(ex.label).toBe('New Rect');
    expect(ex.x).toBe(20);
    expect(ex.y).toBe(30);
    expect(ex.w).toBe(100);
    expect(ex.h).toBe(150);
  });

  it('updates circle properties from DOM', () => {
    const { controller, state, setSelectedId } = createMockController();
    setSelectedId('2');

    document.body.innerHTML = `
      <input id="exLabel" value="New Circle">
      <input id="exCX" value="120">
      <input id="exCY" value="130">
      <input id="exR" value="40">
    `;

    controller.commitExclProps('Update Circle');

    const ex = state.floors[0].rooms[0].exclusions[1];
    expect(ex.label).toBe('New Circle');
    expect(ex.cx).toBe(120);
    expect(ex.cy).toBe(130);
    expect(ex.r).toBe(40);
  });

  it('updates tri properties from DOM', () => {
    const { controller, state, setSelectedId } = createMockController();
    setSelectedId('3');

    document.body.innerHTML = `
      <input id="exLabel" value="New Tri">
      <input id="exP1X" value="10">
      <input id="exP1Y" value="10">
      <input id="exP2X" value="20">
      <input id="exP2Y" value="10">
      <input id="exP3X" value="15">
      <input id="exP3Y" value="20">
    `;

    controller.commitExclProps('Update Tri');

    const ex = state.floors[0].rooms[0].exclusions[2];
    expect(ex.label).toBe('New Tri');
    expect(ex.p1.x).toBe(10);
    expect(ex.p1.y).toBe(10);
    expect(ex.p2.x).toBe(20);
    expect(ex.p2.y).toBe(10);
    expect(ex.p3.x).toBe(15);
    expect(ex.p3.y).toBe(20);
  });

  it('uses default values when DOM elements are missing', () => {
    const { controller, state, setSelectedId } = createMockController();
    setSelectedId('1');

    // Body is empty, getElementById will return null
    controller.commitExclProps('Update Rect Missing');

    const ex = state.floors[0].rooms[0].exclusions[0];
    expect(ex.x).toBe(10); // stayed the same
    expect(ex.label).toBe('R1');
  });

  it('uses default values when DOM values are invalid', () => {
    const { controller, state, setSelectedId } = createMockController();
    setSelectedId('1');

    document.body.innerHTML = `
      <input id="exX" value="invalid">
      <input id="exW" value="-10">
    `;

    controller.commitExclProps('Update Rect Invalid');

    const ex = state.floors[0].rooms[0].exclusions[0];
    expect(ex.x).toBe(10); // stayed the same
    expect(ex.w).toBe(0.1); // Math.max(0.1, readNum) where readNum returns def=50 if el.value is invalid? 
    // Wait, readNum(id, def) returns def if el.value is NaN.
    // So if exX is "invalid", it returns 10.
    // if exW is "-10", it returns -10, then Math.max(0.1, -10) is 0.1.
  });
});
