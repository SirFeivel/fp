# Step 00: Greyscale Normalized

## Goal
Transform the raw RGBA floorplan image into a single-channel greyscale image with full contrast range, suitable as the base for all subsequent processing steps.

## Input
- **File:** `input/preprocessed_greyscale.png`
- **Format:** RGBA, sRGB
- **Dimensions:** 3508 x 3071 px
- **Real-world size:** ~29.64m x 25.94m (at 1.1837 px/cm)

## Output
- **File:** `output/00_greyscale_normalized.png`
- **Format:** Single-channel greyscale, 8-bit
- **Dimensions:** 3508 x 3071 px (unchanged)
- **Pixel distribution:** 97.4% light (>191), 2.3% dark (<64), 0.3% mid-tone

## Processing Steps

### 1. Flatten Alpha Channel
- **Operation:** Composite the RGBA image onto a solid white background
- **Why:** The source image has an alpha channel. Without flattening, semi-transparent pixels produce incorrect greyscale values. Any pixel with partial transparency shifts darker than intended when interpreted as greyscale directly. Flattening onto white ensures the background remains pure white (255) and all drawn features retain their intended brightness.
- **Sharp API:** `.flatten({ background: { r: 255, g: 255, b: 255 } })`
- **Effect:** RGBA (4 channels) → RGB (3 channels), alpha blended against white

### 2. Convert to Greyscale
- **Operation:** Reduce 3-channel RGB to 1-channel luminance
- **Why:** All subsequent pixel-level operations (thresholding, run-length analysis, morphological filters) operate on a single intensity value per pixel. Greyscale conversion reduces memory usage by 3x and simplifies all downstream logic.
- **Sharp API:** `.greyscale()`
- **Method:** Weighted luminance: `0.2126*R + 0.7152*G + 0.0722*B` (ITU-R BT.709)
- **Effect:** RGB (3 channels) → Greyscale (1 channel)

### 3. Normalize Contrast
- **Operation:** Linear stretch of pixel values so that the darkest pixel maps to 0 and the lightest maps to 255
- **Why:** The raw image may not use the full 0–255 range. Normalization maximizes contrast, which makes subsequent thresholding more reliable — the gap between wall pixels and background pixels becomes as large as possible.
- **Sharp API:** `.normalize()`
- **Method:** For each pixel: `output = 255 * (input - min) / (max - min)`
- **Effect:** Full 0–255 dynamic range regardless of original exposure

## Code
```js
const sharp = require('sharp');

await sharp('./input/preprocessed_greyscale.png')
  .flatten({ background: { r: 255, g: 255, b: 255 } })
  .greyscale()
  .normalize()
  .toFile('./output/00_greyscale_normalized.png');
```

## Notes
- The order of operations matters: flatten must come before greyscale (can't flatten a single-channel image), and normalize must come last (operates on the final pixel values).
- This step does not discard any information — it is a lossless transformation of the visual content. All features (walls, text, hatching, dimension lines) are preserved.
- Scale calibration constant `PIXELS_PER_CM = 1.1837020725483214` is not used in this step but applies to all spatial measurements downstream.
