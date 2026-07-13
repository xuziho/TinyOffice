import assert from "node:assert/strict";
import test from "node:test";
import type { MessagePage } from "tinyoffice/frontend-api-contracts";
import type { DraftReply } from "./chatRunState";
import { messagesWithoutReconciledReply, persistedMessageForDraftReply } from "./chatReplyReconciliation";

const draftReply: DraftReply = {
  companyId: "acme",
  conversationId: "conversation-1",
  roomId: "conversation-1",
  runId: "run-1",
  sourceMessageId: "source-1",
  replyMessageId: "reply-1",
  targetMemberId: "avery",
  content: "Persisted reply",
  sequence: 7,
  status: "completed",
  isTerminal: true,
};

const messages = [{
  messageId: "source-1",
  sender: { memberId: "xu", displayName: "Xu" },
  body: "Question",
  runtimeLinks: [],
}, {
  messageId: "reply-1",
  sender: { memberId: "avery", displayName: "Avery" },
  body: "Persisted reply",
  runtimeLinks: [{ targetKind: "session", targetId: "session-1", sourceMessageId: "source-1" }],
}] as MessagePage["messages"];

test("finds the persisted reply by completed reply id", () => {
  assert.equal(persistedMessageForDraftReply(messages, draftReply)?.messageId, "reply-1");
});

test("finds a persisted reply by source link before completed status arrives", () => {
  const replyingDraft = { ...draftReply, replyMessageId: undefined, status: "replying" as const, isTerminal: false };
  assert.equal(persistedMessageForDraftReply(messages, replyingDraft)?.messageId, "reply-1");
});

test("removes the reconciled persisted reply from the ordinary message rows", () => {
  const persisted = persistedMessageForDraftReply(messages, draftReply);
  assert.deepEqual(messagesWithoutReconciledReply(messages, persisted).map((message) => message.messageId), ["source-1"]);
});
