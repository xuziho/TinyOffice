import assert from "node:assert/strict";
import test from "node:test";

import { NO_TARGET_MEMBER_NOTICE, noTargetMemberNoticeForChatSubmit } from "./chatNoTargetNotice";

test("noTargetMemberNoticeForChatSubmit warns for channel messages without an employee mention", () => {
  assert.equal(noTargetMemberNoticeForChatSubmit({
    value: { body: "Please look at this", mentionedMemberIds: [] },
    mentionCandidates: [{ memberId: "avery", displayName: "Avery", hasRuntimeProfile: true }],
    containerKind: "channel",
  }), NO_TARGET_MEMBER_NOTICE);
});

test("noTargetMemberNoticeForChatSubmit stays quiet when a channel message mentions an employee", () => {
  assert.equal(noTargetMemberNoticeForChatSubmit({
    value: { body: "@Avery please look at this", mentionedMemberIds: [] },
    mentionCandidates: [{ memberId: "avery", displayName: "Avery", hasRuntimeProfile: true }],
    containerKind: "channel",
  }), undefined);
});

test("noTargetMemberNoticeForChatSubmit does not warn in direct messages or non-runnable channels", () => {
  assert.equal(noTargetMemberNoticeForChatSubmit({
    value: { body: "Please look at this", mentionedMemberIds: [] },
    mentionCandidates: [{ memberId: "avery", displayName: "Avery", hasRuntimeProfile: true }],
    containerKind: "member_dm",
  }), undefined);
  assert.equal(noTargetMemberNoticeForChatSubmit({
    value: { body: "Please look at this", mentionedMemberIds: [] },
    mentionCandidates: [{ memberId: "viewer", displayName: "Xu", hasRuntimeProfile: false }],
    containerKind: "channel",
  }), undefined);
});
