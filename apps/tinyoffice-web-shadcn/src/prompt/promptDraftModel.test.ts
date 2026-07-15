import assert from "node:assert/strict";
import test from "node:test";

import {
  editPromptDraft,
  emptyPromptDraft,
  promptDraftIsDirty,
  promptDraftValue,
  reconcilePromptDraft,
} from "./promptDraftModel";

test("cached prompt data is visible and clean before draft hydration", () => {
  assert.equal(promptDraftValue(emptyPromptDraft, "template:base", "Persisted prompt"), "Persisted prompt");
  assert.equal(promptDraftIsDirty(emptyPromptDraft, "template:base", "Persisted prompt"), false);
  assert.deepEqual(reconcilePromptDraft(emptyPromptDraft, "template:base", "Persisted prompt"), {
    targetKey: "template:base",
    persistedContent: "Persisted prompt",
    content: "Persisted prompt",
  });
});

test("only a real prompt edit becomes dirty", () => {
  const draft = editPromptDraft("template:base", "Persisted prompt", "Edited prompt");
  assert.equal(promptDraftValue(draft, "template:base", "Persisted prompt"), "Edited prompt");
  assert.equal(promptDraftIsDirty(draft, "template:base", "Persisted prompt"), true);
});

test("a clean draft follows server refreshes without becoming dirty", () => {
  const draft = reconcilePromptDraft(emptyPromptDraft, "template:base", "Old prompt");
  assert.equal(promptDraftValue(draft, "template:base", "New prompt"), "New prompt");
  assert.equal(promptDraftIsDirty(draft, "template:base", "New prompt"), false);
  assert.deepEqual(reconcilePromptDraft(draft, "template:base", "New prompt"), {
    targetKey: "template:base",
    persistedContent: "New prompt",
    content: "New prompt",
  });
});
