# Plan: Clip 3D Walls to Selected Room's Surface Range

## Context

When navigating from floor view to room view in 3D, shared walls render at their full building-spanning length, but only the selected room's floor is shown. The room looks tiny inside enormous walls. In 2D room view, walls appear proportional because `getWallRenderHelpers(wallDesc, roomId)` computes room-specific extended endpoints. The fix: in room-level 3D, clip each wall's geometry to the selected room's portion using the same API.

## Implementation

### Approach history

**Attempt 1 — `clipWallDescToRoom` using `getWallRenderHelpers`**: Used room-specific extensions applied to the wall's raw start/end. Barely clipped anything because for guest rooms the wall's raw endpoints already span the owner's full edge, and room-specific extensions don't meaningfully shorten them.

**Attempt 2 — `clipWallDescToRoom` using surface `fromFrac/toFrac`**: Used surface fractions to locate the room's position on the wall, then clipped. Worked for simple 3-box layouts, failed for complex real-world layouts where many walls got "no clip needed" because the room's surface covered most of the wall.

**Attempt 3 (final) — `rebuildWallForRoom` mirroring 2D renderer**: Anchors wall geometry to the room's own polygon vertices (exactly like `render.js:1579-1601` does for 2D room-level rendering), applies room-specific extensions, computes normal-offset outer face. This always produces room-proportional walls regardless of how long the underlying wall entity is.

### What was done

1. **Added `rebuildWallForRoom()` in `src/walls.js`** (after `getWallRenderHelpers`, ~70 lines)
   - Takes assembled wallDesc, raw wallDesc, and room object (needs `id`, `polygonVertices`, `floorPosition`)
   - Finds the surface for the room to get `edgeIndex`
   - Computes floor-coordinate vertices from `room.polygonVertices[edgeIdx]` + `room.floorPosition`
   - Applies room-specific extensions from `rawDesc.extensions.get(roomId)` to get A/B/OA/OB
   - Uses `getDoorwaysInEdgeSpace(rawDesc, room, edgeIdx)` for doorway remapping (no extra offset — API already includes extStart)
   - Sets surface fracs to `extStart/L` and `(extStart+origL)/L`
   - Discards corner fills (they belong to owner geometry)
   - Logs with `[walls] rebuildWallForRoom:` prefix

2. **Wired in `src/main.js`** (room-3D path, line ~764)
   - Changed import from `clipWallDescToRoom` to `rebuildWallForRoom`
   - Changed call to pass full `room` object instead of `room.id`
   - Cleaned up verbose diagnostic logging

3. **Added 5 tests in `src/walls.test.js`**
   - Owner room: wall length matches room edge + extensions
   - Guest room: wall rebuilt to room's shorter edge, not owner's full length (500cm owner → ~200cm guest)
   - Corner fills always discarded
   - Surface fracs correctly computed
   - E2E: two-room floor with shared merged wall, both rooms rebuilt independently

### Core findings

- The root cause of all 3D wall sizing issues was that `prepareFloorWallData` builds wall descriptors from owner's `extStartPt/extEndPt`, which span the entire building for merged walls. The 2D renderer avoids this by anchoring to room polygon vertices.
- `getDoorwaysInEdgeSpace` already includes `roomExtStart` in the returned offsets — an earlier version of `rebuildWallForRoom` double-counted this.
- `syncFloorWalls` merges collinear edges (e.g. two 200cm right edges become one 400cm wall), so "shared wall" in tests may refer to merged walls, not just interface walls.

### Test results

- 60 test files, 1358 passed, 1 failed (pre-existing room-detection test), 7 skipped
