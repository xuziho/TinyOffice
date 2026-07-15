import assert from "node:assert/strict";
import test from "node:test";

import { en, zhCN } from "./resources";

test("English and Simplified Chinese resources expose the same semantic keys", () => {
  assert.deepEqual(flattenKeys(zhCN), flattenKeys(en));
});

function flattenKeys(value: object, prefix = ""): string[] {
  return Object.entries(value)
    .flatMap(([key, child]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      return child && typeof child === "object" ? flattenKeys(child, path) : [path];
    })
    .sort();
}
