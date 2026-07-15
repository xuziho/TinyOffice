import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const srcRoot = fileURLToPath(new URL("..", import.meta.url));
const css = [
  readFileSync(new URL("../index.css", import.meta.url), "utf8"),
  readFileSync(new URL("../styles/semantic-states.css", import.meta.url), "utf8"),
].join("\n");

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

test("product pages use shared state and note compositions", () => {
  const sources = productSourceFiles()
    .filter((path) => !path.includes(`${join("components", "product")}`))
    .map((path) => ({ path, source: readFileSync(path, "utf8") }));
  const localStateComponents = sources.flatMap(({ path, source }) => {
    const hits = source.match(/function (?:StateBlock|PanelNote)\b/g) ?? [];
    return hits.map((hit) => `${path}: ${hit}`);
  });
  assert.deepEqual(localStateComponents, []);

  const combined = sources.map(({ source }) => source).join("\n");
  assert.match(combined, /from "@\/components\/product\/ProductState"/);
  assert.match(combined, /from ["'](?:@\/|\.\.\/components\/)product\/PanelNote["']/);
});

test("audited selection rows expose the shared title contract", () => {
  const selectionList = readFileSync(new URL("../components/product/SelectionList.tsx", import.meta.url), "utf8");
  const settings = readFileSync(new URL("../settings/SettingsPage.tsx", import.meta.url), "utf8");
  const employees = readFileSync(new URL("../employees/EmployeesPage.tsx", import.meta.url), "utf8");
  const company = readFileSync(new URL("./CompanyLifecyclePage.tsx", import.meta.url), "utf8");

  assert.match(selectionList, /title === undefined \? children : \([\s\S]*?<SelectionRowTitle/);
  assert.match(settings, /<SelectionRow\b[^>]*title=\{t\("settings\.profile"\)\}/);
  assert.match(settings, /<SelectionRow\b[^>]*title=\{t\("settings\.security"\)\}/);
  assert.match(employees, /selected=\{skill\.skillId === activeSkillId\}[\s\S]*?title=\{skill\.name\}/);
  assert.match(company, /function CompanyRow[\s\S]*?<SelectionRowTitle/);
});

test("component CSS consumes semantic tokens instead of page-local color literals", () => {
  const indexCss = readFileSync(new URL("../index.css", import.meta.url), "utf8");
  const componentCss = indexCss.slice(indexCss.indexOf("@layer components {"));
  const semanticCss = readFileSync(new URL("../styles/semantic-states.css", import.meta.url), "utf8");
  assert.doesNotMatch(componentCss, /#[0-9a-f]{3,8}\b|rgba?\(/i);
  assert.doesNotMatch(semanticCss, /#[0-9a-f]{3,8}\b|rgba?\(/i);
});

test("standalone management pages share one header composition", () => {
  const paths = [
    "../app/CompanyLifecyclePage.tsx",
    "../integrations/IntegrationsPage.tsx",
    "../settings/SettingsPage.tsx",
  ];
  for (const path of paths) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.match(source, /<ManagementPageHeader\b/);
  }
});
