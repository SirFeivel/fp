/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createZoomPanController } from './zoom-pan.js';
import { setBaseViewBox } from './viewport.js';

describe('createZoomPanController', () => {
  let getSvg;
  let getCurrentRoomId;
  let onViewportChange;
  let getSelectedExclId;
  let getSelectedSectionId;
  let svg;

  beforeEach(() => {
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    document.body.appendChild(svg);

    getSvg = vi.fn(() => svg);
    getCurrentRoomId = vi.fn(() => 'room-1');
    onViewportChange = vi.fn();
    getSelectedExclId = vi.fn(() => null);
    getSelectedSectionId = vi.fn(() => null);

    setBaseViewBox('room-1', { minX: 0, minY: 0, width: 1000, height: 800 });
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('does not pan on arrow keys when a section is selected', () => {
    getSelectedSectionId.mockReturnValue('sec-1');
    const controller = createZoomPanController({
      getSvg,
      getCurrentRoomId,
      onViewportChange,
      getSelectedExclId,
      getSelectedSectionId
    });

    controller.attach();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));

    expect(onViewportChange).not.toHaveBeenCalled();
    controller.detach();
  });
});
