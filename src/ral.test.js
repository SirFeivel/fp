import { describe, it, expect, beforeEach, vi } from "vitest";

const MOCK_CSV = `RAL|HEX|English
1000|#BEBD7F|Green beige
3000|#AF2B1E|Flame red
5015|#2271B3|Sky blue
9005|#0A0A0A|Jet black`;

// We need to reset the module-level cache between test groups
let getRalMatch;

let storage = {};
const mockStorage = {
  getItem: (key) => storage[key] ?? null,
  setItem: (key, value) => { storage[key] = String(value); },
  removeItem: (key) => { delete storage[key]; }
};

try {
  Object.defineProperty(globalThis, "localStorage", {
    value: mockStorage,
    configurable: true
  });
} catch {
  globalThis.localStorage = mockStorage;
}

describe("ral.js", () => {
  beforeEach(async () => {
    storage = {};
    vi.restoreAllMocks();
    // Reset module to clear ralColorsCache
    vi.resetModules();
    const mod = await import("./ral.js");
    getRalMatch = mod.getRalMatch;
  });

  describe("end-to-end matching", () => {
    it("exact color match returns distance near 0", async () => {
      vi.stubGlobal("fetch", vi.fn(() =>
        Promise.resolve({ ok: true, text: () => Promise.resolve(MOCK_CSV) })
      ));

      const result = await getRalMatch("#BEBD7F");
      expect(result).not.toBeNull();
      expect(result.code).toBe("1000");
      expect(result.name).toBe("Green beige");
      expect(result.distance).toBeLessThan(1);
    });

    it("nearby color returns closest match", async () => {
      vi.stubGlobal("fetch", vi.fn(() =>
        Promise.resolve({ ok: true, text: () => Promise.resolve(MOCK_CSV) })
      ));

      // A dark color should match Jet black
      const result = await getRalMatch("#0B0B0B");
      expect(result).not.toBeNull();
      expect(result.code).toBe("9005");
    });

    it("returns null for invalid hex", async () => {
      vi.stubGlobal("fetch", vi.fn(() =>
        Promise.resolve({ ok: true, text: () => Promise.resolve(MOCK_CSV) })
      ));

      const result = await getRalMatch("not-a-color");
      expect(result).toBeNull();
    });

    it("returns null when fetch fails", async () => {
      vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("network"))));

      const result = await getRalMatch("#FF0000");
      expect(result).toBeNull();
    });

    it("returns null for empty hex", async () => {
      const result = await getRalMatch("");
      expect(result).toBeNull();
    });

    it("returns null when response is not ok", async () => {
      vi.stubGlobal("fetch", vi.fn(() =>
        Promise.resolve({ ok: false })
      ));

      const result = await getRalMatch("#FF0000");
      expect(result).toBeNull();
    });
  });

  describe("caching", () => {
    it("first call fetches + caches in localStorage; second uses cache", async () => {
      const fetchFn = vi.fn(() =>
        Promise.resolve({ ok: true, text: () => Promise.resolve(MOCK_CSV) })
      );
      vi.stubGlobal("fetch", fetchFn);

      const result1 = await getRalMatch("#BEBD7F");
      expect(result1).not.toBeNull();
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(storage["ralClassicColors"]).toBeDefined();

      // Reset module to clear in-memory cache but keep localStorage
      vi.resetModules();
      const mod2 = await import("./ral.js");
      const fetchFn2 = vi.fn();
      vi.stubGlobal("fetch", fetchFn2);

      const result2 = await mod2.getRalMatch("#BEBD7F");
      expect(result2).not.toBeNull();
      // Should NOT have called fetch again since localStorage has data
      expect(fetchFn2).not.toHaveBeenCalled();
    });
  });

  describe("CSV parsing", () => {
    it("handles pipe-delimited CSV", async () => {
      vi.stubGlobal("fetch", vi.fn(() =>
        Promise.resolve({ ok: true, text: () => Promise.resolve(MOCK_CSV) })
      ));

      const result = await getRalMatch("#AF2B1E");
      expect(result.code).toBe("3000");
      expect(result.name).toBe("Flame red");
    });

    it("skips comment lines", async () => {
      const csvWithComments = `# This is a comment
RAL|HEX|English
# Another comment
1000|#BEBD7F|Green beige`;

      vi.stubGlobal("fetch", vi.fn(() =>
        Promise.resolve({ ok: true, text: () => Promise.resolve(csvWithComments) })
      ));

      const result = await getRalMatch("#BEBD7F");
      expect(result).not.toBeNull();
      expect(result.code).toBe("1000");
    });

    it("handles short hex codes (#ABC → #AABBCC)", async () => {
      // Even though our mock CSV uses 6-digit hex, verify that input handling works
      vi.stubGlobal("fetch", vi.fn(() =>
        Promise.resolve({ ok: true, text: () => Promise.resolve(MOCK_CSV) })
      ));

      // #0A0 expands to #00AA00
      const result = await getRalMatch("#0A0");
      expect(result).not.toBeNull();
    });
  });
});
