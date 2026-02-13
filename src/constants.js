export const CIRCLE_APPROXIMATION_STEPS = 48;

export const TILE_MARGIN_MULTIPLIER = 3;

export const TILE_AREA_TOLERANCE = 0.999;

export const ROTATION_STEP_DEG = 45;
export const MAX_ROTATION_DEG = 360;

export const GRID_MINOR_STEP = 10;
export const GRID_MAJOR_STEP = 100;

export const MIN_DIMENSION = 0.1;

export const BOND_PERIOD_MIN = 2;
export const BOND_PERIOD_MAX = 12;
export const BOND_PERIOD_EPSILON = 1e-6;

export const EPSILON = 1e-6;
export const TRIANGULAR_CUT_MIN = 0.45;
export const TRIANGULAR_CUT_MAX = 0.6;
export const AREA_RATIO_SCALING_THRESHOLD = 0.75;
export const COMPLEMENTARY_FIT_MIN = 0.90;
export const COMPLEMENTARY_FIT_MAX = 1.10;
export const HEX_STEP_RATIO = 0.75;

export const DEFAULT_WALL_THICKNESS_CM = 12;
export const DEFAULT_WALL_HEIGHT_CM = 200;

// Wall adjacency detection tolerance - how far apart can rooms be and still share a wall?
// Increased from 13cm to 50cm to accommodate floor plan extraction use case
// where users trace rooms from architectural drawings with varying wall thicknesses:
// - Interior walls: 10-15cm
// - Load-bearing walls: 15-20cm
// - Exterior walls: 20-30cm
// - Thick exterior walls: 30-50cm
export const WALL_ADJACENCY_TOLERANCE_CM = 50;

export const WALL_ENFORCEMENT_TOLERANCE_FACTOR = 2; // 2× wall thickness for enforcement

export const COLORS = {
  background: "#081022",
  roomFill: "rgba(122,162,255,0.06)",
  roomStroke: "rgba(122,162,255,0.8)",
  gridMinor: "#14203a",
  gridMajor: "#1f2b46",
  tileFull: "rgba(255,255,255,0.10)",
  tileCut: "rgba(255,255,255,0.05)",
  tileStrokeFull: "rgba(255,255,255,0.30)",
  tileStrokeCut: "rgba(255,255,255,0.80)",
  exclusionFill: "rgba(122,162,255,0.10)",
  exclusionFillSelected: "rgba(122,162,255,0.20)",
  exclusionStroke: "rgba(122,162,255,0.45)",
  exclusionStrokeSelected: "rgba(122,162,255,0.95)",
  unionFill: "rgba(0,255,0,0.35)",
  unionStroke: "rgba(0,255,0,0.95)",
  debugReused: "rgba(0,255,0,0.95)",
  debugNotReused: "rgba(255,165,0,0.95)",
  errorText: "rgba(255,107,107,0.95)",
  warningText: "rgba(255,204,102,0.95)",
  labelText: "rgba(231,238,252,0.95)"
};

export const STROKE_WIDTHS = {
  room: 1.2,
  gridMinor: 0.4,
  gridMajor: 0.8,
  tileFull: 0.5,
  tileCut: 1.2,
  exclusion: 1,
  exclusionSelected: 2,
  union: 1.5,
  debug: 2
};
