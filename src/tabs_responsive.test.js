/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Tabs Responsiveness (Container Queries)', () => {
  it('verifies that the side panel is defined as a container', () => {
    const cssContent = fs.readFileSync(path.resolve(process.cwd(), 'src/style.css'), 'utf8');
    
    // Check for container-type on panel-nav
    expect(cssContent).toMatch(/\.panel-nav\s*\{[^}]*container-type:\s*inline-size/);
  });

  it('verifies that labels are hidden using container queries', () => {
    const cssContent = fs.readFileSync(path.resolve(process.cwd(), 'src/style.css'), 'utf8');
    
    // Check for @container rule
    expect(cssContent).toContain('@container');
    
    // Verify the selector specifically targets spans that are not icons
    expect(cssContent).toContain('.tab span:not(.tab-icon)');
    expect(cssContent).toContain('display: none !important');
  });

  it('checks for reasonable breakpoint values', () => {
    const cssContent = fs.readFileSync(path.resolve(process.cwd(), 'src/style.css'), 'utf8');
    
    // We expect a breakpoint between 300px and 400px for the container
    const match = cssContent.match(/@container\s*\(max-width:\s*(\d+)px\)/);
    expect(match).not.toBeNull();
    const breakpoint = parseInt(match[1], 10);
    expect(breakpoint).toBeGreaterThanOrEqual(300);
    expect(breakpoint).toBeLessThanOrEqual(400);
  });
});
