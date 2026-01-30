const RAL_CSV_URL = "https://gist.githubusercontent.com/lunohodov/1995178/raw/ral_classic.csv";
const RAL_CACHE_KEY = "ralClassicColors";
const RAL_CACHE_VERSION = "v1";

function normalizeHex(hex) {
  if (!hex) return "";
  let value = String(hex).trim();
  if (!value.startsWith("#")) value = `#${value}`;
  if (value.length === 4) {
    value = `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`;
  }
  return value.toUpperCase();
}

function hexToRgb(hex) {
  const clean = normalizeHex(hex).replace("#", "");
  if (clean.length !== 6) return null;
  const num = Number.parseInt(clean, 16);
  if (!Number.isFinite(num)) return null;
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255
  };
}

function srgbToLinear(channel) {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function rgbToXyz({ r, g, b }) {
  const rl = srgbToLinear(r);
  const gl = srgbToLinear(g);
  const bl = srgbToLinear(b);
  return {
    x: (rl * 0.4124 + gl * 0.3576 + bl * 0.1805) * 100,
    y: (rl * 0.2126 + gl * 0.7152 + bl * 0.0722) * 100,
    z: (rl * 0.0193 + gl * 0.1192 + bl * 0.9505) * 100
  };
}

function xyzToLab({ x, y, z }) {
  const refX = 95.047;
  const refY = 100.0;
  const refZ = 108.883;
  let fx = x / refX;
  let fy = y / refY;
  let fz = z / refZ;

  fx = fx > 0.008856 ? Math.cbrt(fx) : (7.787 * fx) + 16 / 116;
  fy = fy > 0.008856 ? Math.cbrt(fy) : (7.787 * fy) + 16 / 116;
  fz = fz > 0.008856 ? Math.cbrt(fz) : (7.787 * fz) + 16 / 116;

  return {
    l: (116 * fy) - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz)
  };
}

function deltaE(labA, labB) {
  const dl = labA.l - labB.l;
  const da = labA.a - labB.a;
  const db = labA.b - labB.b;
  return Math.sqrt(dl * dl + da * da + db * db);
}

function splitPipeRow(line) {
  if (!line.includes("|")) return null;
  return line
    .split("|")
    .map((cell) => cell.trim())
    .filter((cell) => cell.length);
}

function splitCsvRow(line) {
  if (!line.includes(",")) return null;
  return line.split(",").map((cell) => cell.trim());
}

function parseRalCsv(text) {
  const lines = String(text || "").split(/\r?\n/);
  let header = null;
  const items = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) continue;

    const parts = splitPipeRow(line) || splitCsvRow(line);
    if (!parts || parts.length < 3) continue;

    if (!header && parts.some((p) => p.toLowerCase() === "ral")) {
      const headerMap = {};
      parts.forEach((p, idx) => {
        const key = p.toLowerCase();
        if (key === "ral") headerMap.ral = idx;
        if (key === "hex") headerMap.hex = idx;
        if (key === "english") headerMap.name = idx;
      });
      if (headerMap.ral != null && headerMap.hex != null && headerMap.name != null) {
        header = headerMap;
      }
      continue;
    }

    const ral = header ? parts[header.ral] : parts[0];
    const hex = header ? parts[header.hex] : parts[2];
    const name = header ? parts[header.name] : parts[5];
    if (!ral || !hex || !name) continue;

    items.push({
      code: ral.trim(),
      name: name.trim(),
      hex: normalizeHex(hex)
    });
  }

  return items;
}

let ralColorsCache = null;

async function loadRalColors() {
  if (ralColorsCache) return ralColorsCache;
  const cached = typeof localStorage !== "undefined" ? localStorage.getItem(RAL_CACHE_KEY) : null;
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (parsed && parsed.version === RAL_CACHE_VERSION && Array.isArray(parsed.items)) {
        ralColorsCache = parsed.items;
        return ralColorsCache;
      }
    } catch {
      // ignore cache errors
    }
  }

  if (typeof fetch !== "function") return [];

  try {
    const res = await fetch(RAL_CSV_URL, { cache: "force-cache" });
    if (!res.ok) return [];
    const text = await res.text();
    const items = parseRalCsv(text);
    if (items.length && typeof localStorage !== "undefined") {
      localStorage.setItem(RAL_CACHE_KEY, JSON.stringify({ version: RAL_CACHE_VERSION, items }));
    }
    ralColorsCache = items;
    return ralColorsCache;
  } catch {
    return [];
  }
}

export async function getRalMatch(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const colors = await loadRalColors();
  if (!colors.length) return null;

  const target = xyzToLab(rgbToXyz(rgb));
  let best = null;
  let bestDist = Infinity;

  for (const color of colors) {
    const cRgb = hexToRgb(color.hex);
    if (!cRgb) continue;
    const dist = deltaE(target, xyzToLab(rgbToXyz(cRgb)));
    if (dist < bestDist) {
      bestDist = dist;
      best = color;
    }
  }

  if (!best) return null;
  return { ...best, distance: bestDist };
}
