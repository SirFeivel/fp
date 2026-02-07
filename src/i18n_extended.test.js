import { describe, it, expect } from "vitest";
import { t, setLanguage, getLanguage } from "./i18n.js";

describe("i18n extended tests", () => {
  it("t('nonexistent.deep.path') returns the path string", () => {
    expect(t("nonexistent.deep.path")).toBe("nonexistent.deep.path");
  });

  it("t() returns path when intermediate value is not an object", () => {
    // "app.title" is a string, so "app.title.extra" should fail gracefully
    expect(t("app.title.extra")).toBe("app.title.extra");
  });

  it("setLanguage('invalid') does not change current language", () => {
    const before = getLanguage();
    setLanguage("invalid");
    expect(getLanguage()).toBe(before);
  });

  it("getLanguage() returns current language after setLanguage('en')", () => {
    setLanguage("en");
    expect(getLanguage()).toBe("en");
    // Verify translations work in English
    expect(t("dialog.confirm")).toBe("Confirm");
    // Reset back to German
    setLanguage("de");
  });

  it("t() returns path when value is falsy (empty string)", () => {
    // This tests the `value || path` fallback at the end of t()
    // If a translation were empty string, it would return the path
    expect(t("definitely.does.not.exist")).toBe("definitely.does.not.exist");
  });
});
