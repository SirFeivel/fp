/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderPlanSvg } from './render.js';
import { defaultState, getCurrentRoom } from './core.js';
import { validateState } from './validation.js';

describe('renderPlanSvg pattern validation', () => {
  let state;
  let currentRoom;

  beforeEach(() => {
    document.body.innerHTML = '<svg id="planSvg"></svg>';
    state = defaultState();
    currentRoom = getCurrentRoom(state);
  });

  it('renders tiles for valid ratio (e.g. grid)', () => {
    // Grid usually doesn't have ratio constraint in our validation yet, but let's test a valid state
    const setLastTileError = vi.fn();
    renderPlanSvg({
      state,
      setSelectedExcl: vi.fn(),
      setLastUnionError: vi.fn(),
      setLastTileError
    });

    const svg = document.getElementById('planSvg');
    // Expect some paths to be rendered (tiles)
    const paths = svg.querySelectorAll('g path');
    expect(paths.length).toBeGreaterThan(0);
    expect(setLastTileError).not.toHaveBeenCalledWith(expect.stringContaining('Ratio'));
  });

  it('should NOT render tiles for invalid herringbone ratio', () => {
    currentRoom.pattern.type = 'herringbone';
    currentRoom.tile.widthCm = 10;
    currentRoom.tile.heightCm = 25; // 2.5:1 ratio, invalid (must be integer)
    
    // Disable skirting to avoid counting its paths
    state.view.showSkirting = false;

    const validation = validateState(state);
    const hasRatioError = validation.errors.some(e => e.title.includes('Herringbone'));
    expect(hasRatioError).toBe(true);

    const setLastTileError = vi.fn();
    renderPlanSvg({
      state,
      setSelectedExcl: vi.fn(),
      setLastUnionError: vi.fn(),
      setLastTileError
    });

    const svg = document.getElementById('planSvg');
    // Currently it MIGHT still render because we haven't implemented the block yet.
    // This test is expected to FAIL until we implement the fix.
    const tileGroup = svg.querySelector('g'); 
    // In current implementation, tilesForPreview is called anyway.
    // We want to ensure that if there is a ratio error, we don't render them.
    
    // Check if the error box is rendered
    const errorTitle = svg.querySelector('text[fill="#ffc107"]');
    expect(errorTitle).not.toBeNull();
    // Use a more flexible check that works for both languages or specifically for the default 'de' in jsdom
    const expectedText = state.meta?.version ? "Muster kann nicht angezeigt werden" : "Can't display pattern";
    expect(errorTitle.textContent).toContain(expectedText);

    const paths = svg.querySelectorAll('g path');
    expect(paths.length).toBe(0); 
  });
});
