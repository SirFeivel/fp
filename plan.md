# Wall Planning Architecture: Simplification & Implementation

**Date:** 2026-02-13
**Status:** Ready for Implementation
**Approach:** Simplify architecture first, then implement feature cleanly
**Previous Status:** V13→V14 implementation (2026-02-12) - Hacky Score 7/10

---

## Context

### Problem Evolution

**Original Problem (2026-02-12):**
- Walls created/rendered during room layout → instability
- Solution: Added `wallsFinalized` flag to gate wall rendering

**New Problem (2026-02-13):**
- Disabling `enforceAdjacentPositions()` made system fragile (Hacky Score 7/10)
- Rooms positioned > 13cm apart → walls don't merge (fragmentation)
- When finalization enabled, rooms move unexpectedly (destroys layout)
- Duplicate wall rendering paths (room-level + floor-level) → maintenance burden

**User Questions:**
> "What happens when I adjust wall dimensions to 30cm walls?"
With previous approach: Room would move 18cm (from 12cm spacing to 30cm) ❌

> "What happens in tight spaces?"
Overlapping rooms would be separated, but only on finalization ⚠️

### Root Cause Analysis

The wall system is **well-architected** but has:
1. **`enforceAdjacentPositions()` timing problem** - runs at wrong time
2. **Duplicate rendering logic** - room-level AND floor-level paths
3. **Excessive enforcement** - runs on every sync instead of once

**Not a fundamental architecture problem** - just needs simplification and smarter logic.

---

## Approach: Simplify Then Implement

**Philosophy:** Slim down to minimum, remove duplicates, then add feature cleanly.

### Step 1: Simplify Architecture
- Consolidate two wall rendering paths into one
- Remove unnecessary complexity
- Single responsibility functions

### Step 2: Smart Enforcement
- One-time enforcement on finalization only
- Dynamic tolerance (2× wall thickness, adapts to wall size)
- Respects user intent (close = share wall, distant = separate)

### Expected Outcome
- **Hacky Score:** 7/10 → **2/10** ✓
- **Code Reduction:** -70 lines (consolidation)
- **No unexpected room movement** after finalization
- **Maintainable** for future features (columns, pre-walls)

---

## Implementation Plan

### Phase 1: Consolidate Wall Rendering (4 hours)

**Problem:** Two separate rendering paths duplicate ~150 lines of logic

**Current State:**
- Room-level rendering (render.js:1545-2040)
- Floor-level rendering (render.js:3427-3477)

**Solution:** Single parameterized function

```javascript
function renderWalls(svg, floor, state, options = {}) {
  const {
    roomId = null,           // Filter to specific room
    interactive = false,     // Enable click/hover
    selectedEdge = null,     // Highlight edge
    wallsFinalized = true    // Finalization check
  } = options;

  if (!wallsFinalized) return;

  const walls = roomId
    ? getWallsForRoom(floor, roomId)
    : (floor.walls || []);

  const wallGeometry = computeFloorWallGeometry(floor);

  for (const wall of walls) {
    renderWallQuad(svg, wall, wallGeometry, {
      interactive,
      selectedEdge: (wall.roomEdge?.edgeIndex === selectedEdge),
      floor,
      state
    });
  }
}
```

**Usage:**
```javascript
// Room view (replace lines 1545-2040):
renderWalls(svg, floor, state, {
  roomId: currentRoom.id,
  interactive: true,
  selectedEdge: selectedWallEdge,
  wallsFinalized: floor?.wallsFinalized !== false
});

// Floor view (replace lines 3427-3477):
renderWalls(svg, floor, state, {
  wallsFinalized: floor?.wallsFinalized !== false
});
```

**Benefits:**
- Single source of truth (~80 lines vs. 300 duplicated)
- Bug fixes only needed once
- Consistent rendering behavior

**Files Modified:**
- `/src/render.js` - Consolidate rendering logic

---

### Phase 2: Smart One-Time Enforcement (2 hours)

**Problem:** `enforceAdjacentPositions()` runs on every sync, moves rooms unexpectedly

**Solution:** One-time enforcement with dynamic tolerance

#### Add Enforcement Flag

```javascript
// In floor state:
floor.wallsAlignmentEnforced = false;  // Track if enforcement ran

// In syncFloorWalls():
const isFirstFinalization = floor.wallsFinalized && !floor.wallsAlignmentEnforced;

if (isFirstFinalization) {
  enforceAdjacentPositionsWithTolerance(floor);
  floor.wallsAlignmentEnforced = true;
}
```

#### Modify Enforcement Logic

```javascript
function enforceAdjacentPositions(floor) {
  for (const wall of floor.walls) {
    if (wall.surfaces.length < 2) continue;
    const ownerRoomId = wall.roomEdge?.roomId;
    if (!ownerRoomId) continue;

    const normal = getWallNormal(wall, floor);
    const thick = wall.thicknessCm ?? DEFAULT_WALL_THICKNESS_CM;

    // NEW: Dynamic tolerance (2× wall thickness)
    const tolerance = WALL_ENFORCEMENT_TOLERANCE_FACTOR * thick;

    const adjSurf = wall.surfaces.find(s => s.roomId !== ownerRoomId);
    if (!adjSurf) continue;

    const adjRoom = floor.rooms.find(r => r.id === adjSurf.roomId);
    if (!adjRoom?.polygonVertices?.length) continue;

    const adjPos = adjRoom.floorPosition || { x: 0, y: 0 };
    const adjVertex = adjRoom.polygonVertices[adjSurf.edgeIndex];
    if (!adjVertex) continue;

    const currentDist =
      (adjPos.x + adjVertex.x - wall.start.x) * normal.x +
      (adjPos.y + adjVertex.y - wall.start.y) * normal.y;

    const delta = thick - currentDist;

    // NEW: Skip if beyond tolerance (separate walls) or already aligned
    if (Math.abs(delta) >= tolerance || Math.abs(delta) < 0.5) continue;

    // Move adjacent room to exact spacing
    adjRoom.floorPosition = {
      x: adjPos.x + normal.x * delta,
      y: adjPos.y + normal.y * delta,
    };
  }
}
```

**Behavior:**
- **Planning mode** (wallsFinalized = false): No walls, no enforcement
- **First finalization**: Enforcement runs ONCE
  - Rooms within 24cm (for 12cm walls) → Aligned to exact 12cm
  - Rooms beyond 24cm → Left alone (separate walls)
  - Overlapping rooms (< 12cm) → Separated to 12cm (prevents invalid geometry)
- **After finalization**: Enforcement never runs again
  - Drag room → Walls update, room stays in new position ✓
  - Change wall thickness to 30cm → Walls update, rooms stay at 12cm spacing ✓
- **Unfinalize/Refinalize**: Reset flag, allows re-alignment

**Tolerance Scaling:**
| Wall Thickness | Tolerance (2×) | Rooms Aligned If Within |
|----------------|----------------|-------------------------|
| 12cm (default) | 24cm | < 24cm apart |
| 30cm (thick) | 60cm | < 60cm apart |
| 5cm (thin) | 10cm | < 10cm apart |

**Files Modified:**
- `/src/constants.js` - Add `WALL_ENFORCEMENT_TOLERANCE_FACTOR = 2`
- `/src/state.js` - Add `floor.wallsAlignmentEnforced` normalization, migration
- `/src/walls.js` - Modify `enforceAdjacentPositions()`, `syncFloorWalls()`
- `/src/walls_finalization.js` - Reset flag on unfinalize

---

### Phase 3: Tests (2 hours)

**New Test File:** `/src/walls_finalization.test.js`

**Test Cases:**
1. Aligns rooms within 2× tolerance on first finalization
2. Does not align rooms beyond 2× tolerance
3. Does not re-enforce after wall thickness change
4. Allows re-enforcement after unfinalize/refinalize
5. Separates overlapping rooms (tight spaces)

**Run Tests:**
```bash
npm run test
```

---

### Phase 4: Manual Testing (2 hours)

**Scenarios:**
1. **New Project Planning**
   - Create rooms 20cm apart → Finalize → Verify aligned to 12cm ✓
   - Create rooms 40cm apart → Finalize → Verify no movement ✓

2. **Wall Thickness Changes**
   - Finalized floor (12cm walls) → Change to 30cm → Verify rooms stay at 12cm ✓

3. **Tight Spaces**
   - Create rooms 5cm apart → Finalize → Verify separated to 12cm ✓

4. **Unfinalize/Refinalize**
   - Finalize → Unfinalize → Adjust positions → Refinalize → Verify re-aligned ✓

5. **3D View**
   - Planning mode: No 3D walls
   - Finalized: 3D walls visible

6. **Multi-Floor**
   - Independent enforcement per floor

---

### Phase 5: Documentation (1 hour)

**Update Files:**
- `/development.md` - Document changes
- `/src/walls.js` - Add function documentation
- `/session.md` - Development session notes

---

## Critical Files

### Modified Files (6)

1. **`/src/render.js`** - Consolidate wall rendering
2. **`/src/walls.js`** - Modify enforcement logic
3. **`/src/state.js`** - Add enforcement flag
4. **`/src/constants.js`** - Add tolerance factor
5. **`/src/walls_finalization.js`** - Reset flag on unfinalize
6. **`/development.md`** - Document changes

### New Files (2)

7. **`/src/walls_finalization.test.js`** (NEW) - Test enforcement logic
8. **`/session.md`** (NEW) - Development session notes

---

## Effort Estimate

| Task | Hours |
|------|-------|
| Consolidate rendering | 4 |
| Enforcement logic | 2 |
| Tests | 2 |
| Manual testing | 2 |
| Documentation | 1 |
| **Total** | **11 hours** |

**Timeline:** 1-2 days

---

## Success Criteria

1. ✅ **Hacky Score:** 7/10 → 2/10
2. ✅ **Code Reduction:** -70 lines (consolidation)
3. ✅ **No Unexpected Movement:** Wall edits don't move rooms
4. ✅ **Smart Alignment:** Rooms within tolerance auto-align, distant rooms stay independent
5. ✅ **Tests Pass:** All existing + new tests green
6. ✅ **Build Succeeds:** No errors
7. ✅ **3D Rendering:** Respects finalization state

---

## Future Scope

### Included in Current Plan

**1. Visual Planning Guides (Scope Extension)**
*Effort: +2 days*

Show visual indicators during planning to preview which rooms will share walls.

**Implementation:**
- During drag or polygon drawing, call `findSharedEdgeMatches()` for preview
- Render dashed lines connecting edges within tolerance
- Color-code room borders:
  - **Green:** Will align and share wall (< 24cm apart)
  - **Orange:** Close but won't share (24-40cm apart)
  - **Gray:** Independent (> 40cm apart)
- Show tooltip on hover: "Will share wall with Kitchen"

**Files:**
- `/src/render.js` - Add visual guide rendering
- `/src/polygon-draw.js` - Add guide during vertex placement
- `/src/drag.js` - Add guide during room drag
- `/src/style.css` - Guide styles (dashed lines, colors)

**Benefits:**
- User sees alignment before finalization
- No surprises when walls appear
- Educational (shows which rooms are "close enough")

---

**2. Manual Alignment Tool (Scope Extension)**
*Effort: +1 day*

Allow user to manually align specific room pair, bypassing automatic tolerance logic.

**Implementation:**
- Add "Align Rooms" button in wall editor
- Select two adjacent rooms
- Calculate and apply exact alignment
- Works even after finalization

**UI:**
```
Wall Editor for Kitchen ↔ Bathroom
[ ] Auto-align on finalization (uses 24cm tolerance)
[Manually Align Now] ← NEW BUTTON
```

**Files:**
- `/src/walls_finalization.js` - Add `alignRoomPair(roomA, roomB)` function
- `/src/main.js` - Wire button
- `/index.html` - Add UI element
- `/src/i18n.js` - Add translations

**Benefits:**
- Power user control
- Fix alignment after finalization without unfinalizing
- Useful for complex layouts (L-shapes, multi-room junctions)

---

### Future Enhancements (Out of Scope)

- Preview UI before finalization (show which rooms will move)
- Tolerance slider (adjust 2× factor per-floor)
- Sloped walls (add back heightStartCm/heightEndCm if needed)
- Column/pre-wall support (vertical tiled objects)
- Bulk finalization (all floors at once)

---

**Plan Created:** 2026-02-13
**Previous Plan:** 2026-02-12 (V13→V14 basic finalization)
**Status:** Ready for implementation
**Risk:** Low
**Hacky Score Improvement:** 7/10 → 2/10
