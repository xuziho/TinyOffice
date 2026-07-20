import assert from "node:assert/strict";
import test from "node:test";
import type { MessageDto, TinyOfficeCurrentSession } from "tinyoffice/frontend-api-contracts";
import { appendOptimisticMessage, optimisticChatMessage, reconcileOptimisticMessage, removeOptimisticMessage } from "./optimisticChatMessage";

const session: TinyOfficeCurrentSession = {
  schema: "tinyoffice-current-session",
  version: 2,
  user: { id: "owner", displayName: "Xu Ziho" },
  companyId: "ziho-e-com",
  member: { memberId: "owner", displayName: "Xu Ziho", role: "boss" },
  needsProfileInitialization: false,
  needsCompanyInitialization: false,
};

test("optimisticChatMessage creates an immediately renderable pending owner message", () => {
  const message = optimisticChatMessage({
    companyId: "ziho-e-com",
    roomId: "room-1",
    session,
    value: {
      body: "hello",
      mentionedMemberIds: [],
      attachmentIds: ["attachment-1"],
      optimisticAttachments: [{
        attachmentId: "attachment-1",
        fileName: "preview.png",
        mimeType: "image/png",
        byteLength: 42,
        previewUrl: "blob:preview",
      }],
    },
    messageId: "optimistic:1",
    createdAt: "2026-07-20T00:00:00.000Z",
  });

  assert.equal(message.deliveryState, "pending");
  assert.equal(message.sender.memberId, "owner");
  assert.equal(message.attachments[0]?.previewUrl, "blob:preview");
});

test("reconcileOptimisticMessage replaces the pending row without duplicating a realtime durable row", () => {
  const pending = optimisticChatMessage({
    companyId: "ziho-e-com",
    roomId: "room-1",
    session,
    value: { body: "hello", mentionedMemberIds: [] },
    messageId: "optimistic:1",
    createdAt: "2026-07-20T00:00:00.000Z",
  });
  const durable: MessageDto = {
    ...pending,
    messageId: "message-1",
    deliveryState: "sent",
  };
  const page = appendOptimisticMessage({ messages: [durable] }, pending);
  const reconciled = reconcileOptimisticMessage(page, pending.messageId, durable);

  assert.deepEqual(reconciled.messages.map((message) => message.messageId), ["message-1"]);
  assert.equal(reconciled.messages[0]?.deliveryState, "sent");
});

test("removeOptimisticMessage preserves messages that arrived while the send was pending", () => {
  const pending = optimisticChatMessage({
    companyId: "ziho-e-com",
    roomId: "room-1",
    session,
    value: { body: "hello", mentionedMemberIds: [] },
    messageId: "optimistic:1",
    createdAt: "2026-07-20T00:00:00.000Z",
  });
  const incoming: MessageDto = {
    ...pending,
    messageId: "message-incoming",
    body: "arrived while sending",
    deliveryState: "sent",
  };

  const cleaned = removeOptimisticMessage({ messages: [pending, incoming] }, pending.messageId);

  assert.deepEqual(cleaned?.messages.map((message) => message.messageId), ["message-incoming"]);
});
