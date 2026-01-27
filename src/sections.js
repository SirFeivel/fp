import { deepClone, getCurrentRoom } from './core.js';
import { getRoomSections, createDefaultSection, suggestConnectedSection } from './composite.js';
import { t } from './i18n.js';

export function createSectionsController({
  getState,
  commit,
  getSelectedId,
  setSelectedId,
}) {
  function getSelectedSection() {
    const state = getState();
    const id = getSelectedId();
    const room = getCurrentRoom(state);
    if (!room) return null;

    const sections = getRoomSections(room);
    return sections.find((s) => s.id === id) || null;
  }

  function addSection(direction = "right") {
    const state = getState();
    const room = getCurrentRoom(state);
    if (!room) return;

    const existingSections = getRoomSections(room);
    const newSection = suggestConnectedSection(existingSections, direction);

    const next = deepClone(state);
    const nextRoom = getCurrentRoom(next);
    if (!nextRoom) return;

    if (!nextRoom.sections) {
      nextRoom.sections = [];
    }

    nextRoom.sections.push(newSection);
    setSelectedId(newSection.id);
    commit(t('room.sectionAdded') || 'Section added', next);
  }

  function deleteSelectedSection() {
    const state = getState();
    const id = getSelectedId();
    if (!id) return;

    const next = deepClone(state);
    const nextRoom = getCurrentRoom(next);
    if (!nextRoom || !nextRoom.sections) return;

    const beforeLen = nextRoom.sections.length;
    nextRoom.sections = nextRoom.sections.filter((s) => s.id !== id);

    if (nextRoom.sections.length === beforeLen) return;

    if (nextRoom.sections.length === 0) {
      delete nextRoom.sections;
    }

    setSelectedId(nextRoom.sections?.at(-1)?.id ?? null);
    commit(t('room.sectionDeleted') || 'Section deleted', next);
  }

  function commitSectionProps(label) {
    const state = getState();
    const id = getSelectedId();
    if (!id) return;

    const next = deepClone(state);
    const nextRoom = getCurrentRoom(next);
    if (!nextRoom || !nextRoom.sections) return;

    const idx = nextRoom.sections.findIndex((s) => s.id === id);
    if (idx < 0) return;

    const cur = nextRoom.sections[idx];

    const labelInp = document.getElementById('secLabel');
    if (labelInp) cur.label = labelInp.value ?? cur.label;

    const readNum = (id, def) => {
      const el = document.getElementById(id);
      if (!el) return def;
      const v = Number(el.value);
      return Number.isFinite(v) ? v : def;
    };

    cur.x = readNum('secX', cur.x);
    cur.y = readNum('secY', cur.y);
    cur.widthCm = Math.max(1, readNum('secW', cur.widthCm));
    cur.heightCm = Math.max(1, readNum('secH', cur.heightCm));

    const skirtInp = document.getElementById('secSkirtingEnabled');
    if (skirtInp) cur.skirtingEnabled = !!skirtInp.checked;

    commit(label, next);
  }

  return {
    getSelectedSection,
    addSection,
    deleteSelectedSection,
    commitSectionProps,
  };
}
