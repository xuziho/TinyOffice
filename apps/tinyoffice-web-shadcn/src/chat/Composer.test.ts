import assert from "node:assert/strict";
import test from "node:test";

import { shouldSubmitComposerKey } from "./Composer";

function keyEvent(input: {
  key: string;
  shiftKey?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  isComposing?: boolean;
}) {
  return {
    key: input.key,
    shiftKey: input.shiftKey ?? false,
    altKey: input.altKey ?? false,
    ctrlKey: input.ctrlKey ?? false,
    metaKey: input.metaKey ?? false,
    nativeEvent: { isComposing: input.isComposing ?? false },
  };
}

test("composer submits on plain Enter", () => {
  assert.equal(shouldSubmitComposerKey(keyEvent({ key: "Enter" })), true);
});

test("composer keeps modified Enter available for textarea input", () => {
  assert.equal(shouldSubmitComposerKey(keyEvent({ key: "Enter", shiftKey: true })), false);
  assert.equal(shouldSubmitComposerKey(keyEvent({ key: "Enter", altKey: true })), false);
  assert.equal(shouldSubmitComposerKey(keyEvent({ key: "Enter", ctrlKey: true })), false);
  assert.equal(shouldSubmitComposerKey(keyEvent({ key: "Enter", metaKey: true })), false);
});

test("composer does not submit while an IME composition is active", () => {
  assert.equal(shouldSubmitComposerKey(keyEvent({ key: "Enter", isComposing: true })), false);
});
