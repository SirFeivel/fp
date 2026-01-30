# Stabilisation Plan v2 — Ultra‑Detailed Technical Guide

This is an **implementation‑level stabilization guide**.
Each step includes **file, function, line numbers, exact change, and verification** so a developer can follow it.

---

# Target State (End Goal)

1) **Security**: Zero unsafe user data in the DOM (no unescaped `innerHTML`).
2) **Rendering**: Only relevant sections render; no full UI rebuild per input.
3) **State**: One source of defaults (`src/core.js`), one source of normalization (`src/state.js`).
4) **UI state**: No DOM dataset flags for logic; all in JS `uiState`.
5) **Performance**: Cached metrics and geometry; no lag on large plans.
6) **Testing**: Migration + flow tests cover core user workflows.
7) **Errors**: All critical failures produce user‑visible, i18n-aware feedback.

---

# Phase Dependencies

```
Phase 1 (Security) ─────────────────────────────────────────┐
                                                            │
Phase 3 (Defaults) ──► Phase 4 (Normalization)              │
                                                            ▼
Phase 5 (UI State) ──► Phase 2 (Render Pipeline) ──► Phase 6 (Performance)
                                                            │
Phase 7 (Error Handling) ◄──────────────────────────────────┘
                                                            │
                                                            ▼
                                                   Phase 8 (Testing)
```

**Recommended order:** 1 → 3 → 4 → 5 → 2 → 6 → 7 → 8

---

# Phase 1 — Security Hardening

## Step 1.1 — Audit and fix unsafe `innerHTML` usage

### Why
`innerHTML` with user‑controlled strings allows XSS (room names, labels, preset names, imported JSON).

### Existing `escapeHTML` function
The codebase already has `escapeHTML()` in `src/core.js:34-46`. Use it or replace innerHTML with DOM APIs.

### innerHTML Audit Results

| File | Line | Usage | Risk | Fix Required |
|------|------|-------|------|--------------|
| `src/main.js` | 62 | `sel.innerHTML = ""` | Safe (clearing) | No |
| `src/main.js` | 198 | `div.innerHTML = ...error.message...` | **HIGH** - error could contain user data | Yes |
| `src/main.js` | 1194 | `quickTilePreset.innerHTML = ""` | Safe (clearing) | No |
| `src/main.js` | 1223 | `planningFloorSelect.innerHTML = ""` | Safe (clearing) | No |
| `src/main.js` | 1236 | `planningRoomSelect.innerHTML = ""` | Safe (clearing) | No |
| `src/fullscreen.js` | 16 | `overlay.innerHTML = template` | **MEDIUM** - includes cloned toolbar | Yes |
| `src/render.js` | 154-155 | `wrap.innerHTML = ""` | Safe (clearing) | No |
| `src/render.js` | 229 | Warning box with `escapeHTML()` | Safe (escaped) | No |
| `src/render.js` | 456, 484, 526, etc. | Various `el.innerHTML = ""` | Safe (clearing) | No |
| `src/render.js` | 656, 679 | Toggle HTML with room data | **HIGH** - room names unescaped | Yes |
| `src/render.js` | 760, 1075 | Label HTML with `escapeHTML()` | Safe (escaped) | No |
| `src/render.js` | 778, 1093 | Label HTML with i18n keys only | Safe (no user data) | No |
| `src/render.js` | 798, 1126 | Section/exclusion props | **MEDIUM** - uses i18n but builds HTML | Review |
| `src/render.js` | 2066 | `svgFullscreen.innerHTML = svg.innerHTML` | Safe (internal SVG copy) | No |
| `src/render.js` | 2114-2116 | Room table with `escapeHTML()` | Safe (escaped) | No |
| `src/render.js` | 2123 | `roomsListEl.innerHTML = roomsHtml` | **HIGH** - roomsHtml built with user data | Yes |
| `src/render.js` | 2148-2164 | Materials table with `escapeHTML()` | Safe (escaped) | No |
| `src/render.js` | 2183 | `materialsListEl.innerHTML = matsHtml` | **HIGH** - matsHtml built with user data | Yes |

### Fixes Required

**`src/main.js:198`** - Error message display
```js
// Before
div.innerHTML = `<div class="wTitle">${t("errors.renderFailed")}</div><div class="wText">${t("errors.reloadPage")} ${error.message}</div>`;

// After
const title = document.createElement("div");
title.className = "wTitle";
title.textContent = t("errors.renderFailed");
const text = document.createElement("div");
text.className = "wText";
text.textContent = `${t("errors.reloadPage")} ${error.message}`;
div.replaceChildren(title, text);
```

**`src/fullscreen.js:14-24`** - Fullscreen overlay
```js
// Before
const toolbarHtml = toolbarOriginal ? toolbarOriginal.innerHTML : '';
overlay.innerHTML = `<div class="fullscreen-header">...</div><div class="fullscreen-content"><div class="plan-toolbar">${toolbarHtml}</div>...`;

// After
const header = document.createElement("div");
header.className = "fullscreen-header";
header.innerHTML = '<button id="btnExitFullscreen" class="btn small" title="Exit Fullscreen">✕</button>';

const content = document.createElement("div");
content.className = "fullscreen-content";

if (toolbarOriginal) {
  const toolbarClone = toolbarOriginal.cloneNode(true);
  content.appendChild(toolbarClone);
}

const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
svg.id = "planSvgFullscreen";
content.appendChild(svg);

overlay.replaceChildren(header, content);
```

**`src/render.js:656, 679`** - Skirting room toggles
```js
// Before
roomToggle.innerHTML = `<input type="checkbox" ...><span class="room-name">${room.name}</span>...`;

// After
const checkbox = document.createElement("input");
checkbox.type = "checkbox";
// ... set attributes
const nameSpan = document.createElement("span");
nameSpan.className = "room-name";
nameSpan.textContent = room.name;
roomToggle.replaceChildren(checkbox, nameSpan, ...);
```

**`src/render.js:2123, 2183`** - Commercial tables
- The `roomsHtml` and `matsHtml` strings already use `escapeHTML()` for user data
- However, building HTML strings is error-prone
- Consider refactoring to DOM-based table building for maintainability
- **Lower priority** since escaping is already in place

### Verification
```bash
# Find all innerHTML usages
grep -n "innerHTML" src/*.js | grep -v "test.js" | grep -v '= ""'

# Verify no unescaped user data
# Manual review of each remaining usage
```

---

# Phase 2 — Render Pipeline Stabilization

## Step 2.1 — Split `renderAll` into scoped render functions

### Why
Full re-render on every change causes UI stalls and potential state overwrites.

### Dependency Analysis

| Change Type | Affects Setup | Affects Planning | Affects Commercial |
|-------------|--------------|------------------|-------------------|
| Floor/room selection | ✓ | ✓ | ✓ |
| Room dimensions | | ✓ | ✓ |
| Tile settings | | ✓ | ✓ |
| Pattern change | | ✓ | ✓ |
| Exclusion change | | ✓ | ✓ |
| Skirting toggle | | ✓ | ✓ |
| Pricing change | | | ✓ |
| View toggles | | ✓ | |

**Key insight:** Most changes affect Planning + Commercial, so we need a combined scope.

### Implementation

**`src/render.js`** - Add scope constants and functions
```js
export const RenderScope = {
  SETUP: "setup",           // Floor/room selectors only
  PLANNING: "planning",     // Plan view + controls
  COMMERCIAL: "commercial", // Commercial tables
  PLAN_AND_COMMERCIAL: "plan_and_commercial", // Most common
  ALL: "all"
};

export function renderByScope(state, scope, options = {}) {
  switch (scope) {
    case RenderScope.SETUP:
      renderSetupSection(state);
      break;
    case RenderScope.PLANNING:
      renderPlanningSection(state, options);
      break;
    case RenderScope.COMMERCIAL:
      renderCommercialSection(state);
      break;
    case RenderScope.PLAN_AND_COMMERCIAL:
      renderPlanningSection(state, options);
      renderCommercialSection(state);
      break;
    case RenderScope.ALL:
    default:
      renderSetupSection(state);
      renderPlanningSection(state, options);
      renderCommercialSection(state);
      break;
  }
}
```

**`src/main.js`** - Update commit calls
```js
// Map labels to scopes
const labelToScope = {
  [t("tile.changed")]: RenderScope.PLAN_AND_COMMERCIAL,
  [t("skirting.changed")]: RenderScope.PLAN_AND_COMMERCIAL,
  [t("exclusions.moved")]: RenderScope.PLANNING,
  [t("exclusions.changed")]: RenderScope.PLAN_AND_COMMERCIAL,
  [t("pricing.changed")]: RenderScope.COMMERCIAL,
  [t("room.changed")]: RenderScope.PLAN_AND_COMMERCIAL,
  // ...
};

// Modify commitViaStore to accept scope
const commitViaStore = (label, next, scope = RenderScope.ALL) =>
  store.commit(label, next, {
    onRender: () => renderByScope(store.getState(), scope),
    updateMetaCb: updateMeta
  });
```

### Verification
- Edit tile settings → commercial tables should not flicker/re-render
- Switch rooms → all sections update
- Drag exclusion → only plan view updates

---

# Phase 3 — Defaults Consolidation

## Step 3.1 — Verify all defaults come from `src/core.js`

### Existing Defaults (core.js:58-90)
```js
DEFAULT_PRICING = { packM2: 1.44, pricePerM2: 39.9, reserveTiles: 5 }
DEFAULT_TILE_PRESET = { shape: "rect", widthCm: 40, heightCm: 20, groutWidthCm: 0.2, groutColorHex: "#ffffff", useForSkirting: false }
DEFAULT_SKIRTING_PRESET = { heightCm: 8, lengthCm: 240, pricePerPiece: 12 }
DEFAULT_SKIRTING_CONFIG = { enabled: false, type: "cutout", heightCm: 8, ... }
```

### Files to Audit

**`src/structure.js`** - `addRoom` function
- Verify new rooms use `DEFAULT_TILE_PRESET` values
- Check for any hardcoded numbers

**`src/ui.js`** - Tile edit functions
- `openTileEditNewPreset` should use `getDefaultTilePresetTemplate()`

**`src/render.js`** - Form rendering
- Remove any `?? 0` or `|| 40` fallbacks
- If value is missing, state normalization should have set it

### Verification
```bash
# Search for suspicious hardcoded defaults
grep -rn "40\|20\|1\.44\|39\.9\|0\.2" src/*.js | grep -v test | grep -v core.js
```

---

# Phase 4 — Normalization Centralization

## Step 4.1 — All normalization logic in `state.js`

### Why
UI logic shouldn't fix missing state; it should assume state is valid after normalization.

### Fields to ensure in `normalizeState`

**Global state:**
- `waste.kerfCm` (default: 0.3)
- `view.showGrid` (default: true)
- `view.showSkirting` (default: true)

**Per-room:**
- `tile.reference` (default: "")
- `tile.shape` (default: "rect")
- `grout.colorHex` (default: "#ffffff")
- `pattern.type` (default: "grid")
- `pattern.origin` (default: { x: 0, y: 0 })
- `skirting` object (default: DEFAULT_SKIRTING_CONFIG)

### Implementation
```js
// In normalizeState, after room loop:
room.tile = room.tile || {};
room.tile.reference = room.tile.reference ?? "";
room.tile.shape = room.tile.shape || "rect";
room.grout = room.grout || {};
room.grout.colorHex = room.grout.colorHex || "#ffffff";
room.pattern = room.pattern || {};
room.pattern.type = room.pattern.type || "grid";
room.pattern.origin = room.pattern.origin || { x: 0, y: 0 };
room.skirting = { ...DEFAULT_SKIRTING_CONFIG, ...room.skirting };
```

### Verification
- Add unit tests for each missing field scenario
- Load old project files and verify normalized correctly

---

# Phase 5 — UI State Stabilization

## Step 5.1 — Replace `document.body.dataset` flags with JS module

### Current dataset usage (from audit)
```
src/ui.js:56   document.body.dataset.tileEditDirty = "false"
src/ui.js:57   document.body.dataset.tileEditMode = "edit"
src/ui.js:110  document.body.dataset.tileEditMode = mode
src/ui.js:161  document.body.dataset.tileEditMode === "create"
src/render.js:24  document.body.dataset.inlineEditing = "true"
src/render.js:26  delete document.body.dataset.inlineEditing
src/main.js:874,883,898  document.body.dataset.inlineEditing === "true"
```

### Implementation

**Create `src/ui-state.js`:**
```js
// Module-level state (not persisted)
const uiState = {
  tileEditActive: false,
  tileEditDirty: false,
  tileEditMode: "edit",  // "edit" | "create"
  inlineEditing: false
};

export function getUiState() {
  return { ...uiState };
}

export function setUiState(updates) {
  Object.assign(uiState, updates);
}

export function isInlineEditing() {
  return uiState.inlineEditing;
}

export function setInlineEditing(value) {
  uiState.inlineEditing = value;
}
```

**Update imports in:**
- `src/ui.js` - replace dataset reads/writes
- `src/render.js` - replace inlineEditing checks
- `src/main.js` - replace inlineEditing checks

### Verification
```bash
grep -n "dataset.tileEdit\|dataset.inlineEditing" src/*.js
# Should return 0 results after migration
```

---

# Phase 6 — Performance Improvements

## Step 6.1 — Cache `computePlanMetrics`

### Cache Strategy

**Key composition:**
```js
function metricsKey(room) {
  return JSON.stringify({
    id: room.id,
    tile: room.tile,
    grout: room.grout,
    pattern: room.pattern,
    exclusions: room.exclusions,
    sections: room.sections,
    widthCm: room.widthCm,
    heightCm: room.heightCm
  });
}
```

**Cache invalidation:**
- Clear room's cache entry when any of the key fields change
- Clear all cache on undo/redo (simplest approach)
- Clear on room deletion

### Implementation

**`src/calc.js`:**
```js
const metricsCache = new Map();

export function clearMetricsCache(roomId = null) {
  if (roomId) {
    metricsCache.delete(roomId);
  } else {
    metricsCache.clear();
  }
}

export function computePlanMetrics(state, options = {}) {
  const room = getCurrentRoom(state);
  if (!room) return null;

  const key = metricsKey(room);
  const cached = metricsCache.get(room.id);

  if (cached && cached.key === key && !options.forceRecalc) {
    return cached.result;
  }

  // ... existing computation ...

  metricsCache.set(room.id, { key, result });
  return result;
}
```

**`src/state.js`:**
```js
// In undo/redo handlers:
import { clearMetricsCache } from "./calc.js";

function undo() {
  // ... existing logic ...
  clearMetricsCache();
}
```

### Geometry Caching (Optional, Phase 6.2)

For very large plans, also cache:
- `roomPolygon()` results
- `computeAvailableArea()` results
- `tilesForPreview()` results

Use same pattern with room-specific keys.

### Verification
- Open large plan (500+ tiles)
- Toggle view settings rapidly
- UI should remain responsive

---

# Phase 7 — Error Handling & Warnings

## Step 7.1 — User-visible errors with i18n

### Implementation

**`src/core.js`** - Add warning helper:
```js
export function showUserWarning(messageKey, details = "") {
  const warningsEl = document.getElementById("warnings");
  if (!warningsEl) {
    console.warn(t(messageKey), details);
    return;
  }

  const div = document.createElement("div");
  div.className = "warnItem";
  div.style.border = "2px solid rgba(255,193,7,0.5)";

  const title = document.createElement("div");
  title.className = "wTitle";
  title.textContent = t(messageKey);

  const text = document.createElement("div");
  text.className = "wText";
  text.textContent = details;

  div.replaceChildren(title, text);
  warningsEl.prepend(div);

  // Auto-dismiss after 10 seconds
  setTimeout(() => div.remove(), 10000);
}
```

**`src/state.js`** - Autosave error:
```js
import { showUserWarning } from "./core.js";

// In autosave catch block:
catch (e) {
  console.warn("Autosave failed:", e);
  showUserWarning("errors.autosaveFailed", e.message);
}
```

### i18n Keys to Add
```
errors.autosaveFailed: "Autosave failed" / "Automatisches Speichern fehlgeschlagen"
errors.importFailed: "Import failed" / "Import fehlgeschlagen"
errors.exportFailed: "Export failed" / "Export fehlgeschlagen"
errors.geometryError: "Geometry calculation error" / "Geometrie-Berechnungsfehler"
```

---

# Phase 8 — Test Coverage Improvements

## Step 8.1 — Migration tests

**File:** `src/state.test.js`

Add fixtures for:
- v1 schema (original format)
- v2-v6 schemas (incremental changes)
- Edge cases: missing fields, invalid types

```js
describe("normalizeState migrations", () => {
  it("migrates v1 state to current schema", () => {
    const v1State = { /* fixture */ };
    const normalized = normalizeState(v1State);
    expect(normalized.floors[0].rooms[0].skirting).toBeDefined();
    expect(normalized.view.showGrid).toBe(true);
  });
});
```

## Step 8.2 — Integration tests

**Framework:** Vitest with jsdom (already configured)

**File:** `src/integration.test.js`

Test scenarios:
1. Create room → set tile → verify metrics update
2. Add exclusion → verify area recalculation
3. Toggle skirting → verify render update
4. Undo/redo → verify state restoration
5. Export/import JSON → verify round-trip

## Step 8.3 — E2E tests (Optional)

**Framework:** Playwright (recommended for browser testing)

**Setup:**
```bash
npm install -D @playwright/test
npx playwright install
```

**File:** `e2e/basic-flow.spec.js`

Test scenarios:
1. Load app → create room → set dimensions
2. Select tile preset → verify plan renders
3. Export PDF → verify download triggered

---

# Rollback Strategy

Each phase should be implemented in a separate branch/commit:

```
main
 └── stabilisation/phase-1-security
 └── stabilisation/phase-3-defaults
 └── stabilisation/phase-4-normalization
 └── stabilisation/phase-5-ui-state
 └── stabilisation/phase-2-render-pipeline
 └── stabilisation/phase-6-performance
 └── stabilisation/phase-7-errors
 └── stabilisation/phase-8-testing
```

If a phase causes regressions:
1. Revert the specific commit
2. Fix issues on the branch
3. Re-merge when stable

---

# Effort Estimates

| Phase | Complexity | Files Changed | Est. Time |
|-------|-----------|---------------|-----------|
| Phase 1 (Security) | Medium | 3 | 2-3 hours |
| Phase 2 (Render) | High | 2-3 | 4-6 hours |
| Phase 3 (Defaults) | Low | 3-4 | 1-2 hours |
| Phase 4 (Normalization) | Low | 1 | 1-2 hours |
| Phase 5 (UI State) | Medium | 4 | 2-3 hours |
| Phase 6 (Performance) | Medium | 2 | 2-3 hours |
| Phase 7 (Errors) | Low | 3 | 1-2 hours |
| Phase 8 (Testing) | Medium | New files | 3-4 hours |

**Total estimated effort:** 16-25 hours

---

# Known Issue Ratings (Summary)

| Issue | Severity | Phase |
|-------|----------|-------|
| XSS risk from innerHTML | **Critical** | 1 |
| Full re-render pipeline | High | 2 |
| Dataset state flags | Medium | 5 |
| Scattered defaults | Medium | 3 |
| No metrics caching | Medium | 6 |
| Silent autosave errors | Low | 7 |
| Missing E2E tests | Low | 8 |

---

# Final Checklist

- [ ] All unsafe `innerHTML` removed or replaced with DOM APIs
- [ ] Render scopes implemented and mapped to commit labels
- [ ] All defaults sourced from `src/core.js`
- [ ] State normalization handles all fields
- [ ] UI state in JS module, not dataset
- [ ] Metrics caching with proper invalidation
- [ ] User-visible error feedback with i18n
- [ ] Migration tests for all schema versions
- [ ] Integration tests for core workflows
- [ ] Each phase committed separately for easy rollback
