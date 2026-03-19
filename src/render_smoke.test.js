/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  hexToRgb,
  renderWarnings,
  renderMetrics,
  renderStateView,
  renderExclProps,
  renderSkirtingRoomList,
  renderRoomForm,
  renderPlanSvg
} from './render.js';
import { defaultStateWithRoom } from './core.js';
import { validateState } from './validation.js';
import { t } from './i18n.js';

describe('render.js smoke tests', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('hexToRgb converts colors correctly', () => {
    expect(hexToRgb('#ffffff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexToRgb('#ff0000')).toEqual({ r: 255, g: 0, b: 0 });
    expect(hexToRgb('invalid')).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('renderWarnings updates the warnings container', () => {
    document.body.innerHTML = `
      <div id="warningsWrapper"><div id="warnPill"></div></div>
      <div id="tipsWrapper"><div id="tipsPill"></div></div>
      <div id="warningsPanel" class="hidden"><div id="warningsList"></div></div>
      <div id="tipsPanel" class="hidden"><div id="tipsList"></div></div>
    `;
    const state = defaultStateWithRoom();
    const validateState = vi.fn(() => ({ errors: [], warns: [] }));

    renderWarnings(state, validateState);

    const wrap = document.getElementById('warningsList');
    const wrapper = document.getElementById('warningsWrapper');
    expect(wrap.innerHTML).toBe('');
    expect(wrapper.style.display).toBe('flex');
    expect(document.getElementById('warnPill').textContent).toBe('0');
    expect(document.getElementById('tipsWrapper').style.display).toBe('flex');
  });

  it('renderWarnings shows ratio error with current ratio', () => {
    document.body.innerHTML = `
      <div id="warningsWrapper"><div id="warnPill"></div></div>
      <div id="tipsWrapper"><div id="tipsPill"></div></div>
      <div id="warningsPanel" class="hidden"><div id="warningsList"></div></div>
      <div id="tipsPanel" class="hidden"><div id="tipsList"></div></div>
    `;
    const state = defaultStateWithRoom();
    const room = state.floors[0].rooms[0];
    room.pattern.type = 'herringbone';
    room.tile.widthCm = 25;
    room.tile.heightCm = 10;
    
    // Mock validateState to return a ratio error with ratio 2.50:1
    const validateState = vi.fn(() => ({
      errors: [{
        title: 'Herringbone ratio invalid',
        text: 'For herringbone, the long side must fit perfectly into the short side. Current ratio: 2.50:1.'
      }],
      warns: []
    }));

    renderWarnings(state, validateState);

    const wrap = document.getElementById('warningsList');
    const wrapper = document.getElementById('warningsWrapper');
    expect(wrap.innerHTML).toContain('Current ratio: 2.50:1.');
    expect(wrap.innerHTML).toContain('Herringbone ratio invalid');
    expect(wrapper.style.display).toBe('flex');
    expect(document.getElementById('warningsPanel').classList.contains('hidden')).toBe(false);
  });

  it('renderStateView updates the state view element', () => {
    document.body.innerHTML = '<pre id="stateView"></pre>';
    const state = { test: 123 };

    renderStateView(state);

    expect(document.getElementById('stateView').textContent).toContain('"test": 123');
  });

  it('renderMetrics updates skirting metrics when enabled', () => {
    document.body.innerHTML = `
      <div id="metricArea"></div>
      <div id="metricTiles"></div>
      <div id="metricPacks"></div>
      <div id="metricCost"></div>
      <div id="skirtingMetricsBox" style="display:none">
        <div id="metricSkirtingLength"></div>
        <div id="metricSkirtingCount"></div>
        <div id="metricSkirtingCost"></div>
        <div id="labelSkirtingPieces"></div>
        <div id="stripsPerTileWrap"></div>
        <div id="metricSkirtingStripsPerTile"></div>
      </div>
    `;
    const state = defaultStateWithRoom();
    const room = state.floors[0].rooms[0];
    room.skirting.enabled = true;
    room.skirting.type = 'bought';
    room.skirting.boughtWidthCm = 100;
    room.skirting.boughtPricePerPiece = 10;

    // Set room to 100x100 via polygonVertices
    room.polygonVertices = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 }
    ];

    renderMetrics(state);

    const box = document.getElementById('skirtingMetricsBox');
    expect(box.style.display).toBe('block');
    expect(document.getElementById('metricSkirtingLength').textContent).toBe('400.0');
    expect(document.getElementById('metricSkirtingCount').textContent).toBe('4');
    expect(document.getElementById('metricSkirtingCost').textContent).toBe('40.00 €');
  });

  it('renderRoomForm updates skirting fields', () => {
    document.body.innerHTML = `
      <input id="roomName" />
      <input id="tileReference" />
      <input id="showGrid" type="checkbox" />
      <input id="showSkirting" type="checkbox" />
      <input id="removalMode" type="checkbox" />
      <select id="skirtingType"><option value="cutout">C</option><option value="bought">B</option></select>
      <input id="skirtingHeight" />
      <input id="skirtingBoughtWidth" />
      <input id="skirtingPricePerPiece" />
      <div id="boughtWidthWrap"></div>
      <div id="boughtPriceWrap"></div>
    `;
    const state = defaultStateWithRoom();
    const room = state.floors[0].rooms[0];
    room.skirting.type = 'bought';
    room.skirting.heightCm = 8;

    renderRoomForm(state);

    expect(document.getElementById('skirtingType').value).toBe('bought');
    expect(document.getElementById('skirtingHeight').value).toBe('8');
    expect(document.getElementById('boughtWidthWrap').style.display).toBe('block');
  });

  it('renderExclProps renders properties for different exclusion types', () => {
    document.body.innerHTML = '<div id="exclProps"></div>';
    
    let currentEx = null;
    const args = {
      state: {},
      selectedExclId: '1',
      getSelectedExcl: () => currentEx,
      commitExclProps: vi.fn()
    };

    currentEx = { id: '1', type: 'rect', label: 'R1', x: 10, y: 10, w: 20, h: 20 };
    renderExclProps(args);
    expect(document.body.innerHTML).toContain('exX');

    currentEx = { id: '2', type: 'circle', label: 'C1', cx: 50, cy: 50, r: 10 };
    renderExclProps(args);
    expect(document.body.innerHTML).toContain('exCX');

    currentEx = { id: '3', type: 'tri', label: 'T1', p1: {x:0, y:0}, p2: {x:10, y:0}, p3: {x:5, y:10} };
    renderExclProps(args);
    expect(document.body.innerHTML).toContain('exP1X');
  });

  it('renderExclProps does not render skirting toggle for exclusion (2D exclusions have no skirting)', () => {
    document.body.innerHTML = '<div id="exclProps"></div>';
    const currentEx = { id: '1', type: 'rect', label: 'R1', x: 10, y: 10, w: 20, h: 20 };
    const args = {
      state: {},
      selectedExclId: '1',
      getSelectedExcl: () => currentEx,
      commitExclProps: vi.fn()
    };

    renderExclProps(args);

    const toggle = document.getElementById('exSkirtingEnabled');
    expect(toggle).toBeNull();
  });


  it('renderSkirtingRoomList renders room toggles', () => {
    document.body.innerHTML = '<div id="skirtingRoomsList"></div>';
    const state = defaultStateWithRoom();
    state.floors[0].name = "Floor 1";
    const room = state.floors[0].rooms[0];
    room.name = "Living";
    room.polygonVertices = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 100 },
      { x: 0, y: 100 }
    ];

    renderSkirtingRoomList(state, { onToggleRoom: vi.fn(), onToggleSection: vi.fn() });

    const inputs = document.querySelectorAll('#skirtingRoomsList input[type="checkbox"]');
    expect(inputs.length).toBe(1);
  });

  it('renderPlanSvg renders skirting paths when enabled', () => {
    document.body.innerHTML = '<svg id="planSvg"></svg>';
    const state = defaultStateWithRoom();
    state.view.showSkirting = true;
    const room = state.floors[0].rooms[0];
    room.skirting.enabled = true;
    // Ensure room has valid polygonVertices
    room.polygonVertices = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 }
    ];

    renderPlanSvg({
      state,
      setSelectedExcl: vi.fn(),
      setLastUnionError: vi.fn(),
      setLastTileError: vi.fn()
    });

    const svg = document.getElementById('planSvg');
    // New rendering: each skirting piece is a filled band polygon path with data-skirtid attribute
    const skirtPaths = svg.querySelectorAll('path[data-skirtid]');
    expect(skirtPaths.length).toBeGreaterThan(0);
  });

  it('renderMetrics hides grand total when ratio error exists', () => {
    document.body.innerHTML = `
      <div id="metricArea"></div>
      <div id="metricTiles"></div>
      <div id="metricPacks"></div>
      <div id="metricCost"></div>
      <div id="grandTotalBox" style="display:block"></div>
      <div id="skirtingMetricsBox" style="display:none"></div>
    `;
    const state = defaultStateWithRoom();
    const room = state.floors[0].rooms[0];
    room.pattern.type = 'herringbone';
    room.tile.widthCm = 25;
    room.tile.heightCm = 10;
    // Option B resolves from preset — keep preset in sync so ratio error fires
    const preset = state.tilePresets?.find(p => p.name === room.tile.reference);
    if (preset) { preset.widthCm = 25; preset.heightCm = 10; }
    room.skirting.enabled = true; // Grand total usually shows if skirting is enabled

    // Explicitly check ratioError in the test to ensure we know why it fails
    const { errors } = validateState(state);
    const ratioError = errors.find(e => 
      e.title.includes(t("validation.herringboneRatioTitle"))
    );
    expect(ratioError).toBeDefined();

    renderMetrics(state);

    const grandBox = document.getElementById('grandTotalBox');
    expect(grandBox.style.display).toBe('none');
  });

  it('renderCommercialTab renders tables with translations', () => {
    document.body.innerHTML = `
      <div id="commercialRoomsList"></div>
      <div id="commercialMaterialsList"></div>
    `;
    const state = defaultStateWithRoom();
    const room = state.floors[0].rooms[0];
    room.tile.reference = "TEST-REF";
    
    // Import the function
    const { renderCommercialTab } = require('./render.js');
    renderCommercialTab(state);
    
    const materialsList = document.getElementById('commercialMaterialsList');
    expect(materialsList.innerHTML).toContain('TEST-REF');
    expect(materialsList.innerHTML).not.toContain('commercial.totalTiles');
    expect(materialsList.innerHTML).toContain(t('commercial.totalTiles'));
    expect(materialsList.innerHTML).toContain(t('commercial.grandTotal'));
    expect(materialsList.innerHTML).not.toContain('TOTAL'); // Since we replaced hardcoded TOTAL
  });

  it('skirting piece count uses Math.max(widthCm, heightCm) for portrait tiles', () => {
    document.body.innerHTML = '<svg id="planSvg"></svg>';
    const state = defaultStateWithRoom();
    state.view.showSkirting = true;
    const room = state.floors[0].rooms[0];
    room.skirting = { enabled: true, type: 'custom' };
    // Portrait tile: heightCm (40) > widthCm (20)
    room.tile = { widthCm: 20, heightCm: 40, shape: 'rect' };
    room.polygonVertices = [
      { x: 0, y: 0 },
      { x: 300, y: 0 },
      { x: 300, y: 200 },
      { x: 0, y: 200 }
    ];

    renderPlanSvg({
      state,
      setSelectedExcl: vi.fn(),
      setLastUnionError: vi.fn(),
      setLastTileError: vi.fn()
    });

    const svg = document.getElementById('planSvg');
    const skirtPaths = svg.querySelectorAll('path[data-skirtid]');

    // pieceLength should be Math.max(20, 40) = 40 (long side).
    // With longSide=40 and grout=0.2: stepX=40.2
    //   300cm walls: centerOffset=9.4 → 9 pieces each
    //   200cm walls: centerOffset=39.8 → 5 pieces each
    //   Total: 2*9 + 2*5 = 28 pieces
    // If shortSide=20 were used: stepX=20.2 → 15 pieces on 300cm, 11 on 200cm → 52 total.
    expect(skirtPaths.length).toBe(28);
  });
});
