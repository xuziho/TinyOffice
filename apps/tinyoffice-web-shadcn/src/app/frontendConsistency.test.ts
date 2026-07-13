import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const srcRoot = fileURLToPath(new URL("..", import.meta.url));
const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");

function productSourceFiles(directory = srcRoot): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (path.includes(`${join("components", "ui")}`)) {
        return [];
      }
      return productSourceFiles(path);
    }
    return extname(entry.name) === ".tsx" && !entry.name.endsWith(".test.tsx") ? [path] : [];
  });
}

test("product pages compose shared controls instead of visible native replacements", () => {
  const sources = productSourceFiles().map((path) => ({ path, source: readFileSync(path, "utf8") }));
  const nativeControlHits = sources.flatMap(({ path, source }) => {
    const hits = source.match(/<(button|select|textarea)\b/g) ?? [];
    return hits.map((hit) => `${path}: ${hit}`);
  });
  assert.deepEqual(nativeControlHits, []);

  const visibleFileInputs = sources.flatMap(({ path, source }) => {
    const inputs = source.match(/<input[\s\S]*?>/g) ?? [];
    return inputs
      .filter((input) => !/type="file"/.test(input) || !/className="hidden"/.test(input))
      .map((input) => `${path}: ${input}`);
  });
  assert.deepEqual(visibleFileInputs, []);
});

test("shared interaction states cover actions, menus, disclosures, links, and reduced motion", () => {
  assert.match(css, /\[data-slot="button"\]\[data-variant="default"\]:hover/);
  assert.match(css, /\[data-slot="button"\]\[data-variant="default"\]:disabled/);
  assert.match(css, /\[data-slot="dropdown-menu-item"\]:not\(\[data-disabled\]\):hover/);
  assert.match(css, /\[data-slot="select-item"\]\[data-highlighted\]/);
  assert.match(css, /\.tiny-soft-retro-shell summary:hover,[\s\S]*?summary:focus-visible/);
  assert.match(css, /a\[href\]:not\(\[data-slot="button"\]\):focus-visible/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test("shared product roles keep selection, danger, status, and scroll feedback semantic", () => {
  assert.match(css, /\.tiny-selection-row\[data-slot="button"\]\[data-active="true"\]/);
  assert.match(css, /\[data-slot="button"\]\[data-variant="destructive"\]:hover/);
  assert.match(css, /\.tiny-session-status\.completed/);
  assert.match(css, /\.tiny-task-error/);
  assert.match(css, /::-webkit-scrollbar-thumb:hover/);
});
