/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { pointerToSvgXY, svgPointToClient, snapToMm, snapToHalfCm, formatCm, dist } from "./svg-coords.js";

/**
 * Build a mock SVG element whose getScreenCTM() returns a matrix
 * representing: scale(sx, sy) then translate(tx, ty).
 *
 * Screen = SVG * scale + translate  →  SVG = (Screen - translate) / scale
 *
 * The mock faithfully applies matrixTransform so pointerToSvgXY and
 * svgPointToClient exercise the real code path (createSVGPoint, CTM
 * inverse, matrixTransform).
 */
function createMockSvg(sx = 1, sy = 1, tx = 0, ty = 0) {
  // CTM: maps SVG → client  (a=sx, d=sy, e=tx, f=ty)
  const ctm = {
    a: sx, b: 0, c: 0, d: sy, e: tx, f: ty,
    inverse() {
      // Inverse of [ sx 0 tx ; 0 sy ty ; 0 0 1 ]
      return {
        a: 1 / sx, b: 0, c: 0, d: 1 / sy,
        e: -tx / sx, f: -ty / sy,
      };
    },
  };

  return {
    createSVGPoint() {
      return {
        x: 0,
        y: 0,
        matrixTransform(m) {
          return {
            x: this.x * m.a + this.y * (m.c || 0) + (m.e || 0),
            y: this.x * (m.b || 0) + this.y * m.d + (m.f || 0),
          };
        },
      };
    },
    getScreenCTM: () => ctm,
  };
}

describe("pointerToSvgXY", () => {
  it("converts client coords to SVG coords with identity CTM", () => {
    const svg = createMockSvg(1, 1, 0, 0);
    const result = pointerToSvgXY(svg, 100, 200);
    expect(result.x).toBeCloseTo(100);
    expect(result.y).toBeCloseTo(200);
  });

  it("accounts for scale (zoom)", () => {
    // CTM scale 2x: client 200 → SVG 100
    const svg = createMockSvg(2, 2, 0, 0);
    const result = pointerToSvgXY(svg, 200, 400);
    expect(result.x).toBeCloseTo(100);
    expect(result.y).toBeCloseTo(200);
  });

  it("accounts for translation (pan)", () => {
    // CTM translate (50, 80): client 150 → SVG 100
    const svg = createMockSvg(1, 1, 50, 80);
    const result = pointerToSvgXY(svg, 150, 280);
    expect(result.x).toBeCloseTo(100);
    expect(result.y).toBeCloseTo(200);
  });

  it("accounts for combined scale and translation", () => {
    // scale 2x, translate (10, 20): client = SVG*2 + (10,20)
    // SVG = (client - translate) / scale = (110-10)/2 = 50
    const svg = createMockSvg(2, 2, 10, 20);
    const result = pointerToSvgXY(svg, 110, 120);
    expect(result.x).toBeCloseTo(50);
    expect(result.y).toBeCloseTo(50);
  });

  it("returns {0,0} when getScreenCTM returns null", () => {
    const svg = {
      createSVGPoint: () => ({ x: 0, y: 0, matrixTransform: () => ({ x: 0, y: 0 }) }),
      getScreenCTM: () => null,
    };
    const result = pointerToSvgXY(svg, 500, 500);
    expect(result).toEqual({ x: 0, y: 0 });
  });
});

describe("svgPointToClient", () => {
  it("converts SVG coords to client coords with identity CTM", () => {
    const svg = createMockSvg(1, 1, 0, 0);
    const result = svgPointToClient(svg, 100, 200);
    expect(result.x).toBeCloseTo(100);
    expect(result.y).toBeCloseTo(200);
  });

  it("accounts for scale (zoom)", () => {
    // CTM scale 2x: SVG 100 → client 200
    const svg = createMockSvg(2, 2, 0, 0);
    const result = svgPointToClient(svg, 100, 200);
    expect(result.x).toBeCloseTo(200);
    expect(result.y).toBeCloseTo(400);
  });

  it("accounts for translation (pan)", () => {
    const svg = createMockSvg(1, 1, 50, 80);
    const result = svgPointToClient(svg, 100, 200);
    expect(result.x).toBeCloseTo(150);
    expect(result.y).toBeCloseTo(280);
  });

  it("accounts for combined scale and translation", () => {
    const svg = createMockSvg(2, 2, 10, 20);
    const result = svgPointToClient(svg, 50, 50);
    // client = SVG*2 + (10,20) = 110, 120
    expect(result.x).toBeCloseTo(110);
    expect(result.y).toBeCloseTo(120);
  });

  it("returns {0,0} when getScreenCTM returns null", () => {
    const svg = {
      createSVGPoint: () => ({ x: 0, y: 0, matrixTransform: () => ({ x: 0, y: 0 }) }),
      getScreenCTM: () => null,
    };
    const result = svgPointToClient(svg, 500, 500);
    expect(result).toEqual({ x: 0, y: 0 });
  });

  it("is the inverse of pointerToSvgXY", () => {
    const svg = createMockSvg(1.5, 2.5, 30, 40);
    const svgCoord = { x: 75, y: 120 };
    const client = svgPointToClient(svg, svgCoord.x, svgCoord.y);
    const roundtrip = pointerToSvgXY(svg, client.x, client.y);
    expect(roundtrip.x).toBeCloseTo(svgCoord.x);
    expect(roundtrip.y).toBeCloseTo(svgCoord.y);
  });
});

describe("snapToMm", () => {
  it("rounds to nearest 0.1 cm", () => {
    expect(snapToMm(3.14159)).toBe(3.1);
    expect(snapToMm(3.15)).toBe(3.2);
    expect(snapToMm(3.04)).toBe(3);
    expect(snapToMm(-2.76)).toBe(-2.8);
  });

  it("preserves exact millimeter values", () => {
    expect(snapToMm(5.0)).toBe(5);
    expect(snapToMm(0.1)).toBe(0.1);
    expect(snapToMm(0)).toBe(0);
  });
});

describe("snapToHalfCm", () => {
  it("rounds to nearest 0.5 cm", () => {
    expect(snapToHalfCm(3.2)).toBe(3.0);
    expect(snapToHalfCm(3.3)).toBe(3.5);
    expect(snapToHalfCm(3.7)).toBe(3.5);
    expect(snapToHalfCm(3.8)).toBe(4.0);
  });

  it("preserves exact half-cm values", () => {
    expect(snapToHalfCm(5.0)).toBe(5.0);
    expect(snapToHalfCm(5.5)).toBe(5.5);
    expect(snapToHalfCm(0)).toBe(0);
  });

  it("handles negative values", () => {
    expect(snapToHalfCm(-1.2)).toBe(-1.0);
    expect(snapToHalfCm(-1.3)).toBe(-1.5);
  });
});

describe("formatCm", () => {
  it("formats integers without decimal", () => {
    expect(formatCm(5)).toBe("5");
    expect(formatCm(10)).toBe("10");
    expect(formatCm(0)).toBe("0");
  });

  it("formats decimals with one digit", () => {
    expect(formatCm(5.3)).toBe("5.3");
    expect(formatCm(12.1)).toBe("12.1");
  });

  it("rounds to one decimal place", () => {
    expect(formatCm(5.37)).toBe("5.4");
    expect(formatCm(5.34)).toBe("5.3");
  });

  it("returns '0' for non-finite values", () => {
    expect(formatCm(NaN)).toBe("0");
    expect(formatCm(Infinity)).toBe("0");
    expect(formatCm(-Infinity)).toBe("0");
  });
});

describe("dist", () => {
  it("computes distance between two points", () => {
    expect(dist({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(dist({ x: 1, y: 1 }, { x: 1, y: 1 })).toBe(0);
  });

  it("handles negative coordinates", () => {
    expect(dist({ x: -3, y: 0 }, { x: 0, y: 4 })).toBe(5);
  });

  it("is symmetrical", () => {
    const a = { x: 2, y: 7 };
    const b = { x: 5, y: 3 };
    expect(dist(a, b)).toBe(dist(b, a));
  });
});
