# Stabilisation Plan — Ultra‑Detailed Technical Guide

This is an **implementation‑level stabilization guide**.  
Each step includes **file, function, exact change, and verification** so a junior developer can follow it.

---

# Target State (End Goal)

1) **Security**: Zero unsafe user data in the DOM (no unescaped `innerHTML`).  
2) **Rendering**: Only relevant sections render; no full UI rebuild per input.  
3) **State**: One source of defaults (`src/core.js`), one source of normalization (`src/state.js`).  
4) **UI state**: No DOM dataset flags for logic; all in JS `uiState`.  
5) **Performance**: Cached metrics and geometry; no lag on large plans.  
6) **Testing**: Migration + flow tests cover core user workflows.  
7) **Errors**: All critical failures produce user‑visible feedback.

---

# Phase 1 — Security Hardening

## Step 1.1 — Remove unsafe `innerHTML` usage

### Why
`innerHTML` with user‑controlled strings allows XSS (room names, labels, preset names, imported JSON).

### Files & functions

**`src/main.js`**
- **Function/Block:** Render error box (catch in render pipeline)
- **Current issue:** `div.innerHTML = ...${error.message}...`
- **Fix:**
  - Replace with DOM creation:
    ```js
    const title = document.createElement("div");
    title.className = "wTitle";
    title.textContent = t("errors.renderFailed");
    const text = document.createElement("div");
    text.className = "wText";
    text.textContent = `${t("errors.reloadPage")} ${error.message}`;
    div.replaceChildren(title, text);
    ```

**`src/render.js`**
- **Function:** warning box builder (uses `div.innerHTML`)
  - Replace template string with DOM elements.
- **Function:** room list rendering (strings → HTML)
  - Replace `roomsHtml` string builder with:
    - `document.createElement("div")`
    - `el.textContent = room.name`
- **Function:** materials list rendering (`matsHtml`)
  - Replace string builder with DOM nodes.
- **Function:** section/exclusion props
  - Replace:
    ```js
    d.innerHTML = `<label>${escapeHTML(...)}</label><input ...>`
    ```
  - With:
    ```js
    const label = document.createElement("label");
    label.textContent = ...
    const input = document.createElement("input");
    d.append(label, input);
    ```

**`src/fullscreen.js`**
- **Function:** fullscreen overlay creation
- **Current issue:** `overlay.innerHTML = ...${toolbarOriginal.innerHTML}...`
- **Fix:** clone DOM:
  ```js
  const toolbarClone = toolbarOriginal.cloneNode(true);
  overlay.append(toolbarClone);
  ```

### Verification
- Run: `rg -n "innerHTML" src`
- Manually confirm every usage with user data is replaced or escaped.

---

# Phase 2 — Render Pipeline Stabilization

## Step 2.1 — Split `renderAll` into scoped render functions

### Why
Full re-render on every change causes UI stalls and unintended state overwrites.

### Files & functions

**`src/render.js`**
Create explicit functions:
- `renderSetup(state)`  
- `renderPlanning(state)`  
- `renderCommercial(state)`  
- (future) `renderExport(state)`

**Move code into the correct functions:**
- Setup: floor/room selectors, structure info.
- Planning: tile settings, pattern, skirting, exclusions, preview.
- Commercial: commercial tables and summary.

**`src/main.js`**
Replace `renderAll` in commits with scoped calls:
- Example mapping:
  - `tile.changed` → `renderPlanning`
  - `skirting.changed` → `renderPlanning`
  - `structure.changed` → `renderSetup`
  - `pricing.changed` → `renderCommercial`

### Implementation detail
Add `renderScope` constants:
```js
const RenderScope = {
  SETUP: "setup",
  PLANNING: "planning",
  COMMERCIAL: "commercial",
  ALL: "all"
};
```

### Verification
- Editing tile settings should not refresh commercial tables.
- Switching floor/room should not re-render commercial.

---

# Phase 3 — Defaults Consolidation

## Step 3.1 — Ensure all defaults come from `src/core.js`

### Why
Scattered defaults cause inconsistencies and regressions.

### Files & functions

**`src/structure.js`**
- `createStructureController.addRoom`
  - Replace hardcoded tile/grout/skirting defaults with:
    - `DEFAULT_TILE_PRESET`
    - `DEFAULT_SKIRTING_CONFIG`

**`src/main.js`**
- `bindPresetCollection` (tile/skirting preset creation)
  - Replace inline defaults with `getDefaultTilePresetTemplate` and `getDefaultPricing`.

**`src/render.js`**
- `renderTilePatternForm`
  - Remove `?? 0` fallbacks
  - Use defaults from `core.js`

**`src/ui.js`**
- `openTileEditNewPreset`
  - Ensure default width/height/pricing from `core.js`.

**`src/state.js`**
- `normalizeState`
  - Set missing defaults using `DEFAULT_*` only.

### Verification
- Search for literal defaults in codebase (`40`, `20`, `1.44`, `39.9`, `0.2`) and remove them unless they come from core defaults.

---

# Phase 4 — Normalization Centralization

## Step 4.1 — All normalization logic in `state.js`

### Why
UI logic shouldn’t fix missing state; it should assume state is valid.

### Files & functions

**`src/state.js`**
- `normalizeState`:
  - Add missing:
    - `waste.kerfCm`
    - `view.showGrid`
    - `view.showSkirting`
  - Ensure every room has:
    - `tile.reference`
    - `skirting` object
    - `grout.colorHex`
    - `pattern.origin`

### Verification
- Add tests for missing fields and ensure normalized state has all required properties.

---

# Phase 5 — UI State Stabilization

## Step 5.1 — Replace `document.body.dataset` flags with JS object

### Files & functions

**`src/ui.js`**
- Add:
  ```js
  const uiState = {
    tileEditActive: false,
    tileEditDirty: false,
    tileEditMode: "edit"
  };
  ```
- Replace all:
  - `document.body.dataset.tileEdit`
  - `document.body.dataset.tileEditDirty`
  - `document.body.dataset.tileEditMode`

**`src/render.js`**
- `renderTilePatternForm` should read `uiState`, not `dataset`.

### Verification
- `rg -n "tileEditMode" src` should no longer find `document.body.dataset`.

---

# Phase 6 — Performance Improvements

## Step 6.1 — Cache `computePlanMetrics`

### Files & functions

**`src/calc.js`**
- Wrap `computePlanMetrics`:
  - Add `metricsCache`:
    ```js
    const metricsCache = new Map();
    ```
  - Cache key: `room.id + hash(tile+pattern+exclusions)`
  - If hash unchanged, return cached result.

**`src/geometry.js`**
- Cache polygon clipping results per room.
- Key by room geometry and exclusions.

### Verification
- Large plan edits do not freeze UI.

---

# Phase 7 — Error Handling & Warnings

## Step 7.1 — Autosave errors visible to user

**File:** `src/state.js`
- Replace:
  ```js
  console.warn("Autosave failed:", e);
  ```
- With:
  - still log warning
  - also call UI warning (add `showWarning` helper).

**File:** `src/main.js`
- Render errors should show UI warning (not just console error).

---

# Phase 8 — Test Coverage Improvements

## Step 8.1 — Migration tests
**File:** `src/state.test.js`
- Add fixtures for schema versions v1–v6.
- Verify `normalizeState` output.

## Step 8.2 — E2E workflow tests
**New:** `e2e/`
- Test scenarios:
  1. create room → set tile → save preset
  2. toggle skirting → verify plan update
  3. export tab → export PDF

---

# Known Issue Ratings (Summary)

- **Critical**: XSS risk from `innerHTML`
- **High**: Full re-render pipeline
- **Medium**: Dataset state + scattered defaults
- **Low**: Test warnings, missing E2E

---

# Final Checklist

- [ ] All unsafe `innerHTML` removed or escaped
- [ ] Render split implemented
- [ ] Defaults centralized
- [ ] Normalization centralized
- [ ] UI state in JS object
- [ ] Metrics caching added
- [ ] Autosave errors visible
- [ ] Migration + E2E tests exist
