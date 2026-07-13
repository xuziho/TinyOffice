import assert from "node:assert/strict";
import test from "node:test";
import { employeeAvatarDataUri, newAvatarSeed } from "./employeeAvatarSource";

test("employeeAvatarDataUri is deterministic for an authoritative avatar seed", () => {
  assert.equal(employeeAvatarDataUri("avery"), employeeAvatarDataUri("avery"));
  assert.notEqual(employeeAvatarDataUri("avery"), employeeAvatarDataUri("mira"));
});

test("newAvatarSeed creates a fresh persisted candidate", () => {
  const first = newAvatarSeed();
  const second = newAvatarSeed();
  assert.notEqual(first, second);
  assert.match(first, /^[0-9a-f-]{36}$/);
});

test("employeeAvatarDataUri rejects an absent identity instead of inventing a fallback", () => {
  assert.throws(() => employeeAvatarDataUri("  "), /authoritative avatarSeed/);
});
