import assert from "node:assert/strict";
import test from "node:test";

import { applyMentionSelection, buildComposerSubmitValue, composerErrorMessage, ensureMentionStarter, selectedMentionIds, visibleMentionOptions } from "./mentionComposerModel";

test("visibleMentionOptions filters runtime-capable channel participants after an at-sign query", () => {
  const options = visibleMentionOptions("@as", [
    { memberId: "aster", displayName: "Aster", role: "analytics", hasRuntimeProfile: true },
    { memberId: "avery", displayName: "Avery Webb", role: "web-designer", hasRuntimeProfile: true },
    { memberId: "xuziho", displayName: "Xuziho", role: "boss", hasRuntimeProfile: false },
  ]);

  assert.deepEqual(options.map((option) => option.memberId), ["aster"]);
});

test("selectedMentionIds returns member ids whose explicit at-label remains in the draft", () => {
  const ids = selectedMentionIds("@Aster can you review this with @Avery Webb?", [
    { memberId: "aster", displayName: "Aster", role: "analytics", hasRuntimeProfile: true },
    { memberId: "avery", displayName: "Avery Webb", role: "web-designer", hasRuntimeProfile: true },
  ]);

  assert.deepEqual(ids, ["aster", "avery"]);
});

test("applyMentionSelection replaces the trailing at-query with the selected display label", () => {
  const draft = applyMentionSelection("Can @as", {
    memberId: "aster",
    displayName: "Aster",
    role: "analytics",
    hasRuntimeProfile: true,
  });

  assert.equal(draft, "Can @Aster ");
});

test("ensureMentionStarter appends an at-sign without replacing existing draft text", () => {
  assert.equal(ensureMentionStarter("Can you check"), "Can you check @");
  assert.equal(ensureMentionStarter("Can you check "), "Can you check @");
  assert.equal(ensureMentionStarter("Can @as"), "Can @as");
});

test("buildComposerSubmitValue allows image-only messages with uploaded attachments", () => {
  const value = buildComposerSubmitValue({
    draft: "   ",
    uploadedAttachmentIds: ["att-screen"],
    mentionCandidates: [],
    selectedMentionCandidates: [],
  });

  assert.deepEqual(value, {
    body: "",
    mentionedMemberIds: [],
    attachmentIds: ["att-screen"],
  });
});

test("composerErrorMessage explains unsupported image understanding without backend wording", () => {
  const message = composerErrorMessage(new Error("The configured TinyOffice runtime provider does not support image understanding for Chat attachments."));

  assert.equal(message, "This employee cannot understand images yet. The image was sent, but the current runtime provider cannot inspect it.");
});
