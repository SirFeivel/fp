// src/removal.js
import { getCurrentRoom } from "./core.js";
import { t } from "./i18n.js";

export function createRemovalController(store, renderAll) {
  function toggleRemovalMode() {
    const state = store.getState();
    const next = structuredClone(state);
    next.view = next.view || {};
    next.view.removalMode = !next.view.removalMode;
    store.commit(t("removal.modeToggled"), next, { onRender: renderAll });
  }

  function handlePlanClick(e) {
    const state = store.getState();
    if (!state.view?.removalMode) return;

    const tileId = e.target.closest("[data-tileid]")?.dataset.tileid;
    const skirtId = e.target.closest("[data-skirtid]")?.dataset.skirtid;

    if (!tileId && !skirtId) return;

    e.stopPropagation();
    e.preventDefault();

    const next = structuredClone(state);
    const room = getCurrentRoom(next);
    if (!room) return;

    if (tileId) {
      room.excludedTiles = room.excludedTiles || [];
      const idx = room.excludedTiles.indexOf(tileId);
      if (idx >= 0) {
        room.excludedTiles.splice(idx, 1);
      } else {
        room.excludedTiles.push(tileId);
      }
      store.commit(t("removal.tileToggled"), next, { onRender: renderAll });
    } else if (skirtId) {
      room.excludedSkirts = room.excludedSkirts || [];
      const idx = room.excludedSkirts.indexOf(skirtId);
      if (idx >= 0) {
        room.excludedSkirts.splice(idx, 1);
      } else {
        room.excludedSkirts.push(skirtId);
      }
      store.commit(t("removal.skirtToggled"), next, { onRender: renderAll });
    }
  }

  // Bind to the SVG plan (delegated to support fullscreen)
  document.addEventListener("click", (e) => {
    const svg = e.target.closest("svg");
    if (svg && (svg.id === "planSvg" || svg.id === "planSvgFullscreen")) {
      handlePlanClick(e);
    }
  }, true);

  return {
    toggleRemovalMode
  };
}
