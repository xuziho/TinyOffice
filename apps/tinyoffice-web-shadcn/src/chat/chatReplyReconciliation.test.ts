import assert from "node:assert/strict";
import test from "node:test";
import type { MessagePage } from "tinyoffice/frontend-api-contracts";
import type { DraftReply } from "./chatRunState";
import { persistedMessageForDraftReply, reconciledTimelineRows } from "./chatReplyReconciliation";

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

test("keeps a reconciled reply in canonical order when a newer user message exists", () => {
  const newerMessage: MessagePage["messages"][number] = {
    ...messages[0]!,
    messageId: "source-2",
    sender: { ...messages[0]!.sender, memberId: "xu", displayName: "Xu" },
    body: "Follow-up",
    runtimeLinks: [],
  };

  const rows = reconciledTimelineRows([...messages, newerMessage], draftReply);

  assert.deepEqual(rows.map((row) => row.kind === "message" ? row.message.messageId : "draft"), [
    "source-1",
    "draft",
    "source-2",
  ]);
  assert.equal(rows[1]?.kind === "draft" ? rows[1].persistedMessage?.messageId : undefined, "reply-1");
});

test("appends a draft that has not been persisted yet", () => {
  const rows = reconciledTimelineRows(messages.slice(0, 1), { ...draftReply, replyMessageId: undefined, status: "streaming", isTerminal: false });
  assert.deepEqual(rows.map((row) => row.kind === "message" ? row.message.messageId : "draft"), ["source-1", "draft"]);
});
