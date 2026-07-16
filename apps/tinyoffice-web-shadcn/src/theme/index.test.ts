import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { applyUiThemePreference, UI_THEMES } from "./index";

test("TinyOffice exposes a stable curated theme catalog", () => {
  assert.deepEqual(UI_THEMES, ["sakura", "ocean", "forest", "violet", "neutral"]);
});

test("every theme explicitly defines the shared semantic color roles", async () => {
  const css = await readFile(new URL("../index.css", import.meta.url), "utf8");
  for (const theme of UI_THEMES) {
    const block = css.match(new RegExp(`\\[data-theme="${theme}"\\] \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? "";
    assert.match(block, /--tiny-action-surface:/, `${theme} must define the action role`);
    assert.match(block, /--tiny-selected-surface:/, `${theme} must define the selection role`);
    assert.match(block, /--tiny-tab-active-ink:/, `${theme} must define readable active-tab ink`);
  }
});

test("applying a theme updates the document root", () => {
  const previousDocument = globalThis.document;
  const documentStub = { documentElement: { dataset: {} as Record<string, string> } };
  Object.defineProperty(globalThis, "document", { configurable: true, value: documentStub });
  try {
    applyUiThemePreference("forest");
    assert.equal(documentStub.documentElement.dataset.theme, "forest");
  } finally {
    Object.defineProperty(globalThis, "document", { configurable: true, value: previousDocument });
  }
});

test("product components no longer depend on concrete pink or cyan variable names", async () => {
  const css = await readFile(new URL("../styles/semantic-states.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /--tiny-(?:pink|cyan)/);
});
