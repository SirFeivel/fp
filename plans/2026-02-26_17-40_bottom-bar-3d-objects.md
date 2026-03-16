# Plan: Add 3D Objects to Bottom Bar Quick Controls

## Context

3D objects can currently only be added/managed from the settings panel. Exclusions have quick-add in the bottom bar via a dropdown button — 3D objects should have the same treatment for consistency and discoverability. The user approved this approach in a prior conversation turn.

## Scorecard — Iteration 1 (after exploration)

### Hacky (0 → ? / 10)
- +3: No workarounds — adding a button that calls an existing controller method (`obj3dCtrl.addRect()`)
- +2: Reuses existing CSS classes (`quick-btn`, `quick-dropdown`, `quick-dropdown-menu`, `quick-dropdown-item`) — zero new CSS
- +2: Same HTML structure as exclusion dropdown (proven pattern, index.html:781-812)
- +1: Delete button reuse is clean — the mutual-exclusion selection model (main.js:171-178) means only one thing is selected at a time, so a single delete button is correct
- **Score: 8**

### Compliance (0 → ? / 10)
- +3: No state mutation outside controllers — `obj3dCtrl.addRect()` and `obj3dCtrl.deleteSelectedObj()` go through `store.commit()` (objects3d.js:60-62, 75-79)
- +2: Event wiring follows exact same pattern as exclusion dropdown (main.js:3266-3279): stopPropagation toggle + document click close
- +2: Correct layer — HTML in index.html, event wiring in main.js, no DOM in calc.js or geometry.js
- +1: i18n key added for the tooltip (follows existing pattern in i18n.js)
- **Score: 8**

### Complexity (0 → ? / 10)
- +3: ~15 lines HTML (mirroring exclusion dropdown structure)
- +3: ~20 lines JS wiring (getElementById + addEventListener, same as exclusion wiring at main.js:3263-3310)
- +2: No new functions, no new files, no new abstractions
- +1: Single dropdown item for now (Rectangle), extensible later without changing structure
- **Score: 9**

### Problem Understanding (0 → ? / 10)
- +2: Read exclusion dropdown HTML structure (index.html:781-812) — confirmed class names and nesting
- +2: Read exclusion dropdown JS wiring (main.js:3266-3279) — confirmed toggle/close pattern
- +2: Read `#roomDeleteObject` handler (main.js:3133-3139) — currently handles doorway and exclusion only, does NOT handle obj3d
- +1: Read `updateRoomDeleteButtonState()` (main.js:1400-1406) — currently enables only for `selectedExclId || selectedDoorwayId`, obj3d not included
- +1: Read `setSelectedObj3d()` (main.js:171-178) — confirmed it clears `selectedExclId` (mutual exclusion)
- +1: Read settings panel obj3d wiring (main.js:3335-3343) — confirmed `obj3dCtrl.addRect()` and `obj3dCtrl.deleteSelectedObj()` are the correct APIs
- **Score: 9**

### Confidence (0 → ? / 10)
- +3: Identical pattern to an existing working feature (exclusion dropdown)
- +2: All controller APIs already exist and are tested (`obj3dCtrl.addRect()`, `obj3dCtrl.deleteSelectedObj()`)
- +2: Selection mutual exclusion already works (main.js:171-178) — no coordination needed
- +1: No calculations, no geometry, no state schema changes — pure UI wiring
- **Score: 8**

## Steps

### Step 1: Add 3D Object dropdown button to bottom bar HTML

**File**: `index.html` (after the doorway button at ~line 819, before the delete button at ~line 820)

Add a new `quick-dropdown` div containing:
- A `quick-btn` button with id `quickAddObj3d`, with a cube SVG icon, green color via inline style (matching settings panel `#btnAddObj3dRect` at index.html:1177)
- A `quick-dropdown-menu` with id `obj3dDropdown` (class `hidden`), containing one item: "Rectangle" with `data-obj3d-type="rect"` and a `▭` icon

### Step 2: Extend the delete button to handle 3D objects

**File**: `src/main.js`

**2a**: In `updateRoomDeleteButtonState()` (~line 1400), add `selectedObj3dId` to the enabled condition:
```js
btn.disabled = !selectedExclId && !selectedDoorwayId && !selectedObj3dId;
```

**2b**: In the `#roomDeleteObject` click handler (~line 3133), add after the existing branches:
```js
else if (selectedObj3dId) {
  obj3dCtrl.deleteSelectedObj();
}
```

### Step 3: Wire the 3D object dropdown toggle + close + item handlers

**File**: `src/main.js` (near the existing exclusion dropdown wiring at ~line 3263)

- Get references: `const quickAddObj3d = document.getElementById("quickAddObj3d")` and `const obj3dDropdown = document.getElementById("obj3dDropdown")`
- Toggle handler: click on `quickAddObj3d` → `e.stopPropagation(); obj3dDropdown.classList.toggle("hidden"); exclDropdown?.classList.add("hidden")` (close the other dropdown)
- Mirror: when exclusion dropdown toggles open, close the obj3d dropdown
- Close-on-outside-click: in the existing document click handler (~line 3271), add a parallel check for obj3dDropdown
- Item handler: `document.querySelectorAll(".quick-dropdown-item[data-obj3d-type]")` → click calls `obj3dCtrl.addRect()` and hides dropdown

### Step 4: i18n key for the button tooltip

**File**: `src/i18n.js`

Add key `objects3d.add` with:
- DE: `"3D-Objekt hinzufügen"`
- EN: `"Add 3D object"`

## Files Modified

1. `index.html` — new dropdown button + menu in bottom bar
2. `src/main.js` — delete button logic + dropdown wiring (~3 locations)
3. `src/i18n.js` — one tooltip translation key

## Verification

- `npm run test` — all existing tests still pass
- Manual verification:
  - Bottom bar shows new green cube button between doorway and delete buttons
  - Click cube button → dropdown with "Rectangle" appears above
  - Click "Rectangle" → 3D object added to room, dropdown closes
  - Select a 3D object in SVG → delete button enables → click delete → object removed
  - Click outside dropdown → closes
  - Opening one dropdown closes the other

## Implementation

Executed exactly as planned. All 4 steps implemented with no deviations.

### Changes made
- `index.html`: Added `quick-dropdown` div with `#quickAddObj3d` button (green cube SVG) and `#obj3dDropdown` menu with one "Rectangle" item, inserted between doorway button and delete button
- `src/main.js`:
  - `updateRoomDeleteButtonState()`: Added `!selectedObj3dId` to disabled condition
  - `#roomDeleteObject` click handler: Added `else if (selectedObj3dId)` → `obj3dCtrl.deleteSelectedObj()`
  - Added dropdown toggle/close wiring mirroring exclusion pattern, with mutual dropdown exclusion
  - Added `.quick-dropdown-item[data-obj3d-type]` click handler calling `obj3dCtrl.addRect()`
- `src/i18n.js`: Added `objects3d.add` (DE/EN) and `objects3d.rectangle` (DE/EN) keys

### Test results
- 1365 tests passed, 7 skipped, 0 failed
