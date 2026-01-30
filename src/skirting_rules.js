export function enforceCutoutForPresetRooms(state, presetName) {
  if (!presetName || !state?.floors) return;
  state.floors.forEach(floor => {
    floor.rooms?.forEach(room => {
      if (room.tile?.reference === presetName && room.skirting?.enabled) {
        room.skirting.type = "cutout";
      }
    });
  });
}
