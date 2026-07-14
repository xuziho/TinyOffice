import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./OwnerAuthGate.tsx", import.meta.url), "utf8");

test("local Owner access exchanges the launcher ticket without a visible token field", () => {
  assert.match(source, /\/api\/auth\/tinyoffice\/local-owner-access/);
  assert.doesNotMatch(source, /setBootstrapToken|One-time setup token|<Input/);
});

test("remote Owner setup keeps Passkey bootstrap separate from local access", () => {
  assert.match(source, /status\?\.accessMode === "local"/);
  assert.match(source, /Create Owner passkey/);
  assert.match(source, /The setup token is not entered manually/);
});
