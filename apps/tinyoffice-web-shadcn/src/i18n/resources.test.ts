import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { en, zhCN } from "./resources";

test("English and Simplified Chinese resources expose the same semantic keys", () => {
  assert.deepEqual(flattenKeys(zhCN), flattenKeys(en));
});

test("every static translation call resolves to a maintained resource key", () => {
  const sourceRoot = fileURLToPath(new URL("../", import.meta.url));
  const available = new Set(flattenKeys(en));
  const used = new Set<string>();
  for (const file of sourceFiles(sourceRoot)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/\bt\(["']([^"']+)["']/g)) {
      used.add(match[1]);
    }
  }
  assert.deepEqual([...used].filter((key) => !available.has(key)).sort(), []);
});

test("migrated product surfaces do not regress to known hard-coded English chrome", () => {
  const sourceRoot = fileURLToPath(new URL("../", import.meta.url));
  const files = [
    "access/AccessRequestCards.tsx", "capabilities/CapabilitiesPage.tsx", "chat/ContextPanel.tsx", "chat/MessagePanel.tsx",
    "config/SaveStateBadge.tsx", "config/UnsavedChangesProvider.tsx", "doctor/DoctorPage.tsx", "sessions/SessionsPage.tsx", "updates/UpdatesPage.tsx",
  ];
  const source = files.map((file) => readFileSync(join(sourceRoot, file), "utf8")).join("\n");
  for (const literal of ["Access approval required", "Channel settings", "Discard unsaved changes?", "Overall status", "Product updates", "Session summary", "Loading capabilities..."]) {
    assert.equal(source.includes(`>${literal}<`), false, `${literal} must come from localization resources`);
  }
});

function flattenKeys(value: object, prefix = ""): string[] {
  return Object.entries(value)
    .flatMap(([key, child]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      return child && typeof child === "object" ? flattenKeys(child, path) : [path];
    })
    .sort();
}

function sourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    if (name === "resources.ts" || name.endsWith(".test.ts") || name.endsWith(".test.tsx")) return [];
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}
