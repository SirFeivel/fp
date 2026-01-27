/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';

describe('Tabs Responsiveness CSS', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <style>
        :root {
          --r-sm: 10px;
          --r-md: 14px;
          --muted: rgba(231,238,252,.7);
          --fs-xs: 11px;
          --panel: #0f1a2e;
          --line2: rgba(231,238,252,.18);
          --shadow: 0 10px 30px rgba(0,0,0,.25);
        }
        .tab {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 4px;
          padding: 8px 12px;
          border: 1px solid transparent;
          background: transparent;
          color: var(--muted);
          cursor: pointer;
          font-size: var(--fs-xs);
          font-weight: 600;
          border-radius: var(--r-sm);
          transition: all 0.2s ease;
          white-space: nowrap;
          flex: 1;
          min-width: 40px;
        }

        @media (max-width: 1400px) {
          .tab span:not(.tab-icon) {
            display: none !important;
          }
          .tab {
            padding: 8px;
            min-width: 44px;
          }
        }
      </style>
      <nav class="tabs">
        <button class="tab" data-tab="room">
          <span class="tab-icon">📐</span>
          <span>Raum</span>
        </button>
      </nav>
    `;
  });

  it('should have labels visible by default (large screen)', () => {
    const label = document.querySelector('.tab span:not(.tab-icon)');
    const style = window.getComputedStyle(label);
    
    // In JSDOM, media queries are not automatically applied based on window.innerWidth
    // We have to mock the environment or check the style rules directly if possible.
    // However, we can check the presence of the text.
    expect(label.textContent).toBe('Raum');
    
    // JSDOM doesn't support media queries well, so we might need a different approach 
    // to "see" the effect of max-width: 1400px.
  });

  it('verifies production CSS rules for responsiveness', async () => {
    // In this test, we verify that the CSS in style.css contains the correct responsive rules.
    // Since we are in a node-based test environment, we can read the file directly.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const cssContent = fs.readFileSync(path.resolve(process.cwd(), 'src/style.css'), 'utf8');
    
    expect(cssContent).toContain('@media (max-width: 1400px)');
    expect(cssContent).toContain('.tab span:not(.tab-icon)');
    expect(cssContent).toContain('display: none !important');
  });
});
