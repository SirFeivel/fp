# Session Notes

## Goal
- Fix herringbone/double-herringbone bugs and ensure coverage with unit + visual tests.

## Current State
- Herringbone supports non-2:1 ratios with corrected shear and dynamic preview cap.
- Double herringbone uses double-width band and shear = (L - 2W) + grout to support 1:8, etc.
- Validation enforces integer ratio for herringbone and integer multiple of 2×W for double herringbone.
- Added tests for sectioned room + 45° rotation rendering and new ratio validations.

## Next Steps
- Recheck double-herringbone visuals for 1:4 and 1:8 ratios.
- Consider adding a visual snapshot for sectioned + rotated herringbone.

## Commands Run
- npm test
- npm run build

## Notes
- Herringbone 45° + sections bug was caused by MAX_PREVIEW_TILES guard; dynamic cap fixes render abort.
