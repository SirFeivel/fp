// src/ui_state.js
const uiState = {
  tileEditActive: false,
  tileEditDirty: false,
  tileEditMode: "edit",
  tileEditHasPreset: false,
  inlineEditing: false
};

export function getUiState() {
  return { ...uiState };
}

export function setUiState(updates) {
  Object.assign(uiState, updates);
}

export function isInlineEditing() {
  return uiState.inlineEditing === true;
}

export function setInlineEditing(value) {
  uiState.inlineEditing = Boolean(value);
}
