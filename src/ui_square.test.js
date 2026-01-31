/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bindUI } from './ui.js';
import { getCurrentRoom } from './core.js';

describe('Square and Rectangle Tile UI logic', () => {
  let store, renderAll, validateState;

  beforeEach(() => {
    // Mock DOM
    document.body.innerHTML = `
      <div id="roomForm">
        <input id="roomName" />
        <input id="roomW" />
        <input id="roomH" />
        <input id="showGrid" type="checkbox" />
      </div>
      <div id="tilePatternForm">
        <select id="tileShape">
          <option value="rect">Rect</option>
          <option value="square">Square</option>
          <option value="hex">Hex</option>
          <option value="rhombus">Rhombus</option>
        </select>
        <div id="tileWidthField">
          <input id="tileW" value="60" />
        </div>
        <div id="tileHeightField">
          <input id="tileH" value="60" />
        </div>
        <div id="hexHint"></div>
        <div id="patternTypeField">
          <select id="patternType">
            <option value="grid">Grid</option>
            <option value="runningBond">Running Bond</option>
            <option value="herringbone">Herringbone</option>
            <option value="doubleHerringbone">Double Herringbone</option>
            <option value="basketweave">Basketweave</option>
            <option value="verticalStackAlternating">Vertical Stack Alternating</option>
          </select>
        </div>
        <select id="bondFraction">
            <option value="0.5">1/2</option>
        </select>
        <select id="rotationDeg">
            <option value="0">0</option>
        </select>
        <input id="offsetX" />
        <input id="offsetY" />
        <select id="originPreset">
            <option value="tl">TL</option>
        </select>
        <input id="originX" />
        <input id="originY" />
        <input id="groutW" />
        <input id="groutColor" type="color" />
        <div id="groutColorPresets"></div>
        <input id="pricePerM2" />
        <input id="packM2" />
        <input id="reserveTiles" />
        <input id="wasteKerfCm" />
        <input id="wasteAllowRotate" type="checkbox" />
        <input id="wasteOptimizeCuts" type="checkbox" />
        <input id="debugShowNeeds" type="checkbox" />
      </div>
      <select id="exclList"></select>
      <select id="sectionsList"></select>
      <select id="projectSelect">
        <option value="">– none –</option>
        <option value="p1">Project 1</option>
      </select>
      <div id="projectDeleteWarning" class="hidden"></div>
      <div id="lastSaved"></div>
      <div id="sessionStatus"></div>
    `;

    store = {
      getState: vi.fn(() => ({
        floors: [{
          id: 'f1',
          rooms: [{
            id: 'r1',
            tile: { widthCm: 60, heightCm: 60, shape: 'rect' },
            grout: {},
            pattern: { type: 'grid', origin: { preset: 'tl' } }
          }]
        }],
        selectedFloorId: 'f1',
        selectedRoomId: 'r1'
      })),
      commit: vi.fn(),
      markDirty: vi.fn(),
      loadProjectById: vi.fn(() => ({ ok: true, name: 'Project 1' })),
      loadProjects: vi.fn(() => []),
      getLastSavedAt: vi.fn(() => null)
    };
    renderAll = vi.fn();
    validateState = vi.fn(() => ({ errors: [], warns: [] }));
    
    const refreshProjectSelect = vi.fn();
    const updateMeta = vi.fn();

    bindUI({ 
      store, 
      renderAll, 
      validateState, 
      refreshProjectSelect, 
      updateMeta,
      excl: { getSelectedExcl: () => null },
      sections: { getSelectedSection: () => null },
      defaultStateFn: () => ({}),
      setSelectedExcl: vi.fn(),
      setSelectedSection: vi.fn(),
      resetErrors: vi.fn()
    });
  });

  it('hides height field for Square tile shape', () => {
    const tileShape = document.getElementById('tileShape');
    const tileHeightField = document.getElementById('tileHeightField');

    tileShape.value = 'square';
    tileShape.dispatchEvent(new Event('change'));

    expect(tileHeightField.style.display).toBe('none');
  });

  it('loads project on select change', () => {
    const projectSelect = document.getElementById('projectSelect');
    projectSelect.value = 'p1';
    projectSelect.dispatchEvent(new Event('change'));

    expect(store.loadProjectById).toHaveBeenCalledWith('p1');
    expect(renderAll).toHaveBeenCalled();
  });

  it('filters patterns for Square tile shape', () => {
    const tileShape = document.getElementById('tileShape');
    const patternType = document.getElementById('patternType');

    tileShape.value = 'square';
    tileShape.dispatchEvent(new Event('change'));

    const options = Array.from(patternType.options);
    const herringbone = options.find(o => o.value === 'herringbone');
    const runningBond = options.find(o => o.value === 'runningBond');

    expect(herringbone.hidden).toBe(true);
    expect(runningBond.hidden).toBe(false);
  });

  it('filters patterns when rect shape is square', () => {
    const tileShape = document.getElementById('tileShape');
    const tileW = document.getElementById('tileW');
    const tileH = document.getElementById('tileH');
    const patternType = document.getElementById('patternType');

    tileShape.value = 'rect';
    tileShape.dispatchEvent(new Event('change'));

    const options = Array.from(patternType.options);
    const herringbone = options.find(o => o.value === 'herringbone');
    const runningBond = options.find(o => o.value === 'runningBond');

    expect(herringbone.hidden).toBe(true);
    expect(herringbone.disabled).toBe(true);
    // Running Bond SHOULD be allowed for square (it's valid physically, just simpler)
    expect(runningBond.hidden).toBe(false);
    expect(runningBond.disabled).toBe(false);
  });

  it('allows all patterns when rect shape is not square', () => {
    const tileW = document.getElementById('tileW');
    const tileH = document.getElementById('tileH');
    const patternType = document.getElementById('patternType');

    // Set to non-square dimensions
    tileW.value = "60";
    tileH.value = "30";
    
    tileW.dispatchEvent(new Event('input'));

    const options = Array.from(patternType.options);
    expect(options.every(o => !o.hidden)).toBe(true);
  });
});
