# FloorPlanner (fp) - Development Guidelines

## 1. Build & Configuration

This project is a browser-based tile layout planning tool built with **Vite**.

### Prerequisites
- **Node.js**: (LTS recommended)
- **npm**: (Included with Node.js)

### Setup & Commands
- **Install Dependencies**: `npm install`
- **Development Server**: `npm run dev`
  - Starts a local server (usually at http://localhost:5173).
- **Production Build**: `npm run build`
  - Generates optimized assets in the `dist/` directory.
- **Preview Build**: `npm run preview`
  - Localy previews the production build.

---

## 2. Testing Guidelines

The project uses **Vitest** for unit and integration testing.

### Running Tests
- **All Tests**: `npm run test` (runs once)
- **Watch Mode**: `npm run test:watch` (useful during development)
- **Vitest UI**: `npm run test:ui` (graphical interface for tests)
- **Specific File**: `npx vitest run path/to/file.test.js`

### Adding New Tests
1. Create a file ending in `.test.js` (preferably in `src/` alongside the code or in a dedicated `test/` directory).
2. Import `describe`, `it`, and `expect` from `vitest`.
3. Example of a simple test (`src/example.test.js`):
   ```javascript
   import { describe, it, expect } from 'vitest';
   import { t } from './i18n.js';

   describe('Simple I18n Test', () => {
     it('returns the key if translation is missing', () => {
       expect(t('missing.key')).toBe('missing.key');
     });
   });
   ```

---

## 3. Development Information

### Architecture Highlights
- **State Management**: Centralized in `src/state.js`. Uses a `store.commit` pattern for undo/redo support. State is persisted in `localStorage`.
- **Data Model**: The project uses a multi-floor, multi-room model (V2 schema). Dimensions are handled in **centimeters**.
- **Geometry Pipeline**: Uses `polygon-clipping` for complex shapes. 
  - `src/geometry.js` contains core logic for room polygons, exclusions, and tile clipping.
  - Pattern-specific generators handle Grid, Herringbone, Hex, etc.
- **Calculations**: `src/calc.js` handles material requirements, waste calculation (via `OffcutPool`), and pricing.
- **Internationalization**: `src/i18n.js` provides a `t(key)` helper. Supports German (default) and English.

### Code Style & Standards
- **ES Modules**: Use `import/export` syntax.
- **Functional Approach**: Most geometry and calculation logic is functional and side-effect free, making it highly testable.
- **Units**: Always use **CM** for physical dimensions in the code and state.
- **Translations**: UI strings should be added to `src/i18n.js` and accessed via `t()`.

### Debugging
- Use `npm run test:ui` for a better debugging experience with tests.
- Check `localStorage` in the browser for the current application state (`fp-session-v2`).

---

## 4. General Development Rules

### Post-Development Workflow
- **Verification**: When coding is finished, always:
  - Run all tests: `npm run test`
  - Fix any potential issues or regressions.
  - Verify the build: `npm run build`
  - Run the development server to check the UI: `npm run dev`

### Acceptance & Integration
- **Test Coverage**: When changes are accepted or ready for integration, always:
  - Check the existing test suite for relevance.
  - Extend **unit tests** and/or **visual tests** (e.g., `visual-test.html`) to cover the new code or bug fix.
  - Ensure all tests pass.
- **Persistence**: Commit and push changes only after the above steps are completed.
