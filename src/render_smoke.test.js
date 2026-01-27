/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { 
  hexToRgb, 
  renderWarnings, 
  renderMetrics, 
  renderStateView,
  renderExclProps
} from './render.js';
import { defaultState } from './core.js';

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
    document.body.innerHTML = '<div id="warnings"></div><div id="warnPill"></div>';
    const state = defaultState();
    const validateState = vi.fn(() => ({ errors: [], warns: [] }));

    renderWarnings(state, validateState);

    const wrap = document.getElementById('warnings');
    expect(wrap.innerHTML).toContain('Keine Hinweise');
    expect(document.getElementById('warnPill').textContent).toBe('0');
  });

  it('renderWarnings shows ratio error with current ratio', () => {
    document.body.innerHTML = '<div id="warnings"></div><div id="warnPill"></div>';
    const state = defaultState();
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

    const wrap = document.getElementById('warnings');
    expect(wrap.innerHTML).toContain('Current ratio: 2.50:1.');
    expect(wrap.innerHTML).toContain('Herringbone ratio invalid');
  });

  it('renderStateView updates the state view element', () => {
    document.body.innerHTML = '<pre id="stateView"></pre>';
    const state = { test: 123 };

    renderStateView(state);

    expect(document.getElementById('stateView').textContent).toContain('"test": 123');
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
});
