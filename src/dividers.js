// src/dividers.js — Controller for surface dividers (floor rooms + wall surfaces)
import { computeZones, deriveDividerZoneName } from './geometry.js';
import { deepClone, uuid } from './core.js';

export function createDividerController({ getState, commit, getTarget, t }) {
  function addDivider(p1, p2) {
    const state = getState();
    const target = getTarget(state);
    if (!target?.polygonVertices) return;
    const id = uuid();
    const newDividers = [...(target.dividers || []), { id, p1, p2 }];
    const zones = computeZones(target.polygonVertices, newDividers);
    const existingLabels = Object.values(target.zoneSettings || {}).map(z => z.label).filter(Boolean);
    const next = deepClone(state);
    const nextTarget = getTarget(next);
    nextTarget.dividers.push({ id, p1, p2 });
    for (const zone of zones) {
      if (!nextTarget.zoneSettings[zone.id]) {
        const label = deriveDividerZoneName(target.polygonVertices, zone.polygonVertices, existingLabels);
        nextTarget.zoneSettings[zone.id] = { tile: null, grout: null, pattern: null, label };
        existingLabels.push(label);
      }
    }
    console.log(`[dividers:addDivider] id=${id} p1=(${p1.x.toFixed(1)},${p1.y.toFixed(1)}) p2=(${p2.x.toFixed(1)},${p2.y.toFixed(1)}) zones=${zones.length}`);
    commit(t('dividers.added'), next);
    return id;
  }

  function deleteDivider(dividerId) {
    const state = getState();
    const target = getTarget(state);
    if (!target) return;
    const next = deepClone(state);
    const nextTarget = getTarget(next);
    nextTarget.dividers = nextTarget.dividers.filter(d => d.id !== dividerId);
    const remainingZones = computeZones(nextTarget.polygonVertices, nextTarget.dividers);
    const validIds = new Set(remainingZones.map(z => z.id));
    const orphaned = Object.keys(nextTarget.zoneSettings).filter(k => !validIds.has(k));
    orphaned.forEach(k => delete nextTarget.zoneSettings[k]);
    console.log(`[dividers:deleteDivider] id=${dividerId} remainingDividers=${nextTarget.dividers.length} orphanedSettings=${orphaned.length}`);
    commit(t('dividers.deleted'), next);
  }

  function commitZoneSettings(zoneId, label) {
    const state = getState();
    const target = getTarget(state);
    if (!target) return;
    const el = (qId, sId) => document.getElementById(qId) || document.getElementById(sId);
    const enabledInp = el('qzEnabled', 'divZoneEnabled');
    if (!enabledInp) return;
    const next = deepClone(state);
    const nextTarget = getTarget(next);
    if (!nextTarget.zoneSettings[zoneId]) nextTarget.zoneSettings[zoneId] = {};
    const z = nextTarget.zoneSettings[zoneId];
    z.label = label || z.label;
    if (!enabledInp.checked) {
      z.tile = null; z.grout = null; z.pattern = null;
    } else {
      const presetSel = el('qzPreset', 'divZonePreset');
      const presets = state.tilePresets || [];
      const preset = presetSel ? presets.find(p => p.id === presetSel.value) : null;
      z.tile = preset
        ? { widthCm: preset.widthCm, heightCm: preset.heightCm, shape: preset.shape || 'rect', reference: preset.name }
        : (z.tile || { widthCm: 20, heightCm: 20, shape: 'rect', reference: null });
      const groutW = el('qzGroutWidth', 'divZoneGroutWidth');
      const groutC = el('qzGroutColor', 'divZoneGroutColor');
      z.grout = {
        widthCm: groutW ? Math.max(0, Number(groutW.value) || 0.2) : (z.grout?.widthCm ?? 0.2),
        colorHex: groutC ? groutC.value : (z.grout?.colorHex ?? '#ffffff'),
      };
      const patternSel = el('qzPattern', 'divZonePattern');
      z.pattern = {
        type: patternSel ? patternSel.value : (z.pattern?.type || 'grid'),
        bondFraction: z.pattern?.bondFraction ?? 0.5,
        rotationDeg: z.pattern?.rotationDeg ?? 0,
        offsetXcm: z.pattern?.offsetXcm ?? 0,
        offsetYcm: z.pattern?.offsetYcm ?? 0,
        origin: z.pattern?.origin ?? { preset: 'tl', xCm: 0, yCm: 0 },
      };
    }
    console.log(`[dividers:commitZoneSettings] zone=${zoneId} enabled=${enabledInp.checked} tile=${z.tile?.widthCm ?? 'null'}×${z.tile?.heightCm ?? 'null'}`);
    commit(t('dividers.zoneChanged'), next);
  }

  return { addDivider, deleteDivider, commitZoneSettings };
}
