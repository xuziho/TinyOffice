import assert from "node:assert/strict";
import test from "node:test";

import { runNoCarrierTinyOfficeChatSmoke } from "../../scripts/runtime/smoke-no-carrier-chat.js";

const forbiddenCarrierFieldPattern =
  /\b(teamId|team_id|channelId|channel_id|postId|post_id|rootPostId|root_post_id|userId|user_id|carrierTeamId|carrierChannelId|carrierPostId|8065)\b/;

test("no-carrier TinyOffice Chat smoke proves owned API, dispatch, reply persistence, realtime, and frontend refresh", async () => {
  const result = await runNoCarrierTinyOfficeChatSmoke();

  assert.equal(result.ok, true);
  assert.equal(result.command, "npm run smoke:no-carrier-chat");
  assert.equal(result.companyId, "smoke-company");
  assert.equal(result.actorMemberId, "iris-growth");
  assert.equal(result.targetMemberId, "nora-automation");
  assert.match(result.containerId, /^chat-container-channel-channel-/);
  assert.match(result.entryId, /^chat-entry-channel-topic-/);
  assert.match(result.roomId, /^conversation-/);
  assert.match(result.firstMessageId, /^message-/);
  assert.equal(result.dispatchDecision.kind, "routable");
  assert.equal(result.dispatchDecision.reason, "mentioned_member");
  assert.equal(result.executionIntent.kind, "started");
  assert.equal(result.executionIntent.targetMemberId, "nora-automation");
  assert.equal(result.replyPersistence.kind, "persisted");
  assert.equal(result.replyPersistence.senderMemberId, "nora-automation");
  assert.match(result.replyPersistence.runtimeSessionRecordId || "", /^runtime-session-/);
  assert.equal(result.replyPersistence.runtimeLinkTargetIds[0], result.replyPersistence.runtimeSessionRecordId);
  assert.match(result.replyPersistence.runtimeLinkTargetIds[1] || "", /^tinyoffice-chat-process:/);
  assert.equal(result.messages.map((message) => message.senderMemberId).join(","), "iris-growth,nora-automation");
  assert.equal(result.carrierEvidence.conversationMattermostCarrier, false);
  assert.equal(result.carrierEvidence.firstMessageMattermostCarrier, false);
  assert.equal(result.carrierEvidence.replyMessageMattermostCarrier, false);
  assert.deepEqual(result.realtimeEventTypes.filter((type) => type !== "chat.runtime_status.changed"), [
    "chat.entry.created",
    "chat.message.created",
    "chat.projection.changed",
    "chat.reply.snapshot",
    "chat.message.created",
    "chat.projection.changed",
    "chat.projection.changed",
  ]);
  assert.deepEqual(result.frontendInvalidations, ["roomMessages", "projection"]);
  assert.doesNotMatch(JSON.stringify(result), forbiddenCarrierFieldPattern);
});
