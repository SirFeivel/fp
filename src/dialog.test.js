/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { showConfirm, showAlert, showPrompt, showSelect } from "./dialog.js";

function setupDialogDOM() {
  document.body.innerHTML = `
    <div id="dialogOverlay" class="hidden"></div>
    <div id="dialogModal" class="hidden">
      <div id="dialogTitle"></div>
      <div id="dialogMessage"></div>
      <div id="dialogInputSection" class="hidden"><input id="dialogInput" /></div>
      <div id="dialogSelectSection" class="hidden"><select id="dialogSelect"></select></div>
      <button id="dialogConfirmBtn"></button>
      <button id="dialogCancelBtn"></button>
    </div>
  `;
}

describe("dialog.js", () => {
  beforeEach(() => {
    setupDialogDOM();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  describe("showConfirm", () => {
    it("resolves to true on confirm click", async () => {
      const promise = showConfirm({ title: "Delete?", message: "Are you sure?" });
      // Dialog should be visible
      expect(document.getElementById("dialogOverlay").classList.contains("hidden")).toBe(false);
      document.getElementById("dialogConfirmBtn").click();
      expect(await promise).toBe(true);
    });

    it("resolves to false on cancel click", async () => {
      const promise = showConfirm({ title: "Delete?", message: "Sure?" });
      document.getElementById("dialogCancelBtn").click();
      expect(await promise).toBe(false);
    });

    it("resolves to false on Escape key", async () => {
      const promise = showConfirm({ title: "T", message: "M" });
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      expect(await promise).toBe(false);
    });

    it("resolves to false on overlay click", async () => {
      const promise = showConfirm({ title: "T", message: "M" });
      const overlay = document.getElementById("dialogOverlay");
      overlay.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(await promise).toBe(false);
    });

    it("applies danger styling", async () => {
      const promise = showConfirm({ title: "T", message: "M", danger: true });
      const btn = document.getElementById("dialogConfirmBtn");
      expect(btn.classList.contains("danger")).toBe(true);
      expect(btn.classList.contains("primary")).toBe(false);
      btn.click();
      await promise;
    });
  });

  describe("showAlert", () => {
    it("resolves on OK click", async () => {
      const promise = showAlert({ title: "Info", message: "Done" });
      document.getElementById("dialogConfirmBtn").click();
      await promise; // should resolve without error
    });

    it("resolves on Escape key", async () => {
      const promise = showAlert({ title: "Info", message: "Done" });
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      await promise;
    });

    it("hides cancel button", async () => {
      const promise = showAlert({ title: "Info", message: "Done" });
      expect(document.getElementById("dialogCancelBtn").classList.contains("hidden")).toBe(true);
      document.getElementById("dialogConfirmBtn").click();
      await promise;
    });
  });

  describe("showPrompt", () => {
    it("resolves to input value on confirm", async () => {
      const promise = showPrompt({ title: "Name", placeholder: "Enter name" });
      const input = document.getElementById("dialogInput");
      // Simulate typing
      input.value = "Hello";
      document.getElementById("dialogConfirmBtn").click();
      expect(await promise).toBe("Hello");
    });

    it("resolves to null on cancel", async () => {
      const promise = showPrompt({ title: "Name" });
      document.getElementById("dialogCancelBtn").click();
      expect(await promise).toBeNull();
    });

    it("resolves to null on Escape key", async () => {
      const promise = showPrompt({ title: "Name" });
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      expect(await promise).toBeNull();
    });

    it("resolves to input value on Enter key in input", async () => {
      const promise = showPrompt({ title: "Name" });
      const input = document.getElementById("dialogInput");
      input.value = "EnterVal";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      expect(await promise).toBe("EnterVal");
    });

    it("shows defaultValue in input", async () => {
      const promise = showPrompt({ title: "Name", defaultValue: "Default" });
      expect(document.getElementById("dialogInput").value).toBe("Default");
      document.getElementById("dialogCancelBtn").click();
      await promise;
    });
  });

  describe("showSelect", () => {
    const items = [
      { value: "a", label: "Alpha" },
      { value: "b", label: "Beta" },
      { value: "c", label: "Gamma" }
    ];

    it("resolves to selected value on confirm", async () => {
      const promise = showSelect({ title: "Pick", items });
      const select = document.getElementById("dialogSelect");
      select.value = "b";
      document.getElementById("dialogConfirmBtn").click();
      expect(await promise).toBe("b");
    });

    it("resolves to null on cancel", async () => {
      const promise = showSelect({ title: "Pick", items });
      document.getElementById("dialogCancelBtn").click();
      expect(await promise).toBeNull();
    });

    it("populates options from items", async () => {
      const promise = showSelect({ title: "Pick", items });
      const select = document.getElementById("dialogSelect");
      expect(select.options).toHaveLength(3);
      expect(select.options[0].textContent).toBe("Alpha");
      expect(select.options[1].value).toBe("b");
      document.getElementById("dialogCancelBtn").click();
      await promise;
    });

    it("selects default value", async () => {
      const promise = showSelect({ title: "Pick", items, defaultValue: "c" });
      expect(document.getElementById("dialogSelect").value).toBe("c");
      document.getElementById("dialogCancelBtn").click();
      await promise;
    });
  });

  describe("Fallback", () => {
    it("falls back to native when dialog elements missing", async () => {
      document.body.innerHTML = ""; // Remove all dialog elements

      // Mock the native confirm function
      const originalConfirm = globalThis.confirm;
      globalThis.confirm = vi.fn(() => true);

      const result = await showConfirm({ title: "T", message: "M" });
      expect(result).toBe(true);
      expect(globalThis.confirm).toHaveBeenCalled();

      globalThis.confirm = originalConfirm;
    });
  });
});
