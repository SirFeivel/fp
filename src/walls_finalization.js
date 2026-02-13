// src/walls_finalization.js
// Controller for wall finalization workflow

import { getCurrentFloor } from "./core.js";
import { syncFloorWalls } from "./walls.js";
import { showConfirm } from "./dialog.js";
import { t } from "./i18n.js";

export function createWallFinalizationController(store, renderAll) {

  function toggleWallsFinalized(floorId) {
    const state = store.getState();
    const floor = state.floors.find(f => f.id === floorId);
    if (!floor) return;

    const finalized = floor.wallsFinalized !== false;

    if (finalized) {
      // Unfinalize - hide walls
      showConfirm({
        title: t("walls.unfinalizeTitle"),
        message: t("walls.unfinalizeWarning"),
        confirmText: t("walls.unfinalizeConfirm"),
        cancelText: t("dialog.cancel")
      }).then(confirmed => {
        if (confirmed) {
          setWallsFinalized(floorId, false);
        }
      });
    } else {
      // Finalize - show walls
      showConfirm({
        title: t("walls.finalizeTitle"),
        message: t("walls.finalizeMessage"),
        confirmText: t("walls.finalizeConfirm"),
        cancelText: t("dialog.cancel")
      }).then(confirmed => {
        if (confirmed) {
          setWallsFinalized(floorId, true);
        }
      });
    }
  }

  function setWallsFinalized(floorId, finalized) {
    const next = structuredClone(store.getState());
    const floor = next.floors.find(f => f.id === floorId);
    if (!floor) return;

    floor.wallsFinalized = finalized;

    // Reset enforcement flag when unfinalizing (allows re-alignment)
    if (!finalized) {
      floor.wallsAlignmentEnforced = false;
    }

    if (finalized) {
      syncFloorWalls(floor); // Ensure walls synced when finalizing (will enforce on first time)
    }

    const label = finalized ? t("walls.finalized") : t("walls.unfinalized");
    store.commit(label, next, { onRender: renderAll });
  }

  function updateFinalizationUI(state) {
    const floor = getCurrentFloor(state);
    if (!floor) return;

    const finalized = floor.wallsFinalized !== false;

    const btn = document.getElementById("finalizeWallsBtn");
    if (btn) {
      btn.classList.toggle("finalized", finalized);
      btn.classList.toggle("planning", !finalized);
      btn.title = finalized ? t("walls.unfinalize") : t("walls.finalize");
    }

    const banner = document.getElementById("wallsStatusBanner");
    if (banner) {
      banner.classList.toggle("hidden", finalized);
    }
  }

  return { toggleWallsFinalized, setWallsFinalized, updateFinalizationUI };
}
