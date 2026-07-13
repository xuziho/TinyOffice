import assert from "node:assert/strict";
import test from "node:test";

import {
  assertConversationMessageRealtimeEventBoundary,
  CONVERSATION_MESSAGE_CONTRACT_VERSION,
  createConversationMessageRealtimeEvent,
  ensureConversationCompanyScope,
  FORBIDDEN_PUBLIC_CARRIER_FIELD_NAMES,
  nextConversationRealtimeSequence,
  PUBLIC_CONVERSATION_MESSAGE_DTO_KEY_SETS,
} from "../../src/collaboration/contracts/conversation-message-contract.js";

test("public conversation and message DTO keys expose TinyOffice-owned ids only", () => {
  const forbidden = new Set<string>(FORBIDDEN_PUBLIC_CARRIER_FIELD_NAMES);
  const leaks: string[] = [];

  for (const [schemaName, keys] of Object.entries(PUBLIC_CONVERSATION_MESSAGE_DTO_KEY_SETS)) {
    for (const key of keys) {
      if (forbidden.has(key)) {
        leaks.push(`${schemaName}.${key}`);
      }
    }
  }

  assert.deepEqual(leaks, []);
  assert.deepEqual(PUBLIC_CONVERSATION_MESSAGE_DTO_KEY_SETS.conversation, [
    "schema",
    "version",
    "companyId",
    "conversationId",
    "title",
    "titleStatus",
    "titleSourceMessageId",
    "titleFailureReason",
    "conversationKind",
    "topic",
    "participants",
    "participantStates",
    "lastMessageId",
    "runtimeLinks",
    "realtimeSequence",
    "createdAt",
    "updatedAt",
  ]);
  assert.deepEqual(PUBLIC_CONVERSATION_MESSAGE_DTO_KEY_SETS.message, [
    "schema",
    "version",
    "companyId",
    "conversationId",
    "messageId",
    "sender",
    "body",
    "mentions",
    "attachments",
    "runtimeLinks",
    "runtimeUsage",
    "createdAt",
    "updatedAt",
    "deliveryState",
  ]);
});

test("conversation contract requires explicit matching company scope", () => {
  assert.throws(
    () => ensureConversationCompanyScope({ companyId: "" }),
    /explicit companyId is required/,
  );

  assert.throws(
    () =>
      ensureConversationCompanyScope({
        companyId: "acme",
        resourceCompanyId: "other-company",
      }),
    /companyId mismatch/,
  );

  assert.equal(
    ensureConversationCompanyScope({
      companyId: "acme",
      resourceCompanyId: "acme",
    }),
    "acme",
  );
});

test("conversation realtime events carry stable TinyOffice identifiers", () => {
  const event = createConversationMessageRealtimeEvent({
    eventId: "event-1",
    type: "message.created",
    occurredAt: "2026-06-23T03:55:00.000Z",
    sequence: 7,
    companyId: "acme",
    conversationId: "conversation-1",
    messageId: "message-1",
    actorMemberId: "employee-hr",
    payload: {
      deliveryState: "sent",
    },
  });

  assert.equal(event.schema, "conversation-message-realtime-event");
  assert.equal(event.version, CONVERSATION_MESSAGE_CONTRACT_VERSION);
  assert.equal(event.companyId, "acme");
  assert.equal(event.conversationId, "conversation-1");
  assert.equal(event.messageId, "message-1");
  assert.equal(event.actorMemberId, "employee-hr");
  assert.deepEqual(Object.keys(event).sort(), [
    "actorMemberId",
    "companyId",
    "conversationId",
    "eventId",
    "messageId",
    "occurredAt",
    "payload",
    "schema",
    "sequence",
    "type",
    "version",
  ]);
  assertConversationMessageRealtimeEventBoundary(event);
  assert.doesNotMatch(JSON.stringify(event), /\b(team_id|teamId|carrierTeamId|user_id|userId|providerUserId|carrierUserId|channel_id|channelId|carrierChannelId|post_id|postId|carrierPostId)\b/);
});

test("conversation realtime events require explicit company, conversation, event id, and positive sequence", () => {
  assert.equal(nextConversationRealtimeSequence(undefined), 1);
  assert.equal(nextConversationRealtimeSequence(1), 2);

  assert.throws(
    () => nextConversationRealtimeSequence(-1),
    /non-negative integer/,
  );
  assert.throws(
    () =>
      createConversationMessageRealtimeEvent({
        eventId: "event-1",
        type: "message.created",
        occurredAt: "2026-06-23T03:55:00.000Z",
        sequence: 0,
        companyId: "acme",
        conversationId: "conversation-1",
        messageId: "message-1",
        actorMemberId: "employee-hr",
        payload: {
          deliveryState: "sent",
        },
      }),
    /sequence must be a monotonic positive integer/,
  );
  assert.throws(
    () =>
      createConversationMessageRealtimeEvent({
        eventId: " ",
        type: "message.created",
        occurredAt: "2026-06-23T03:55:00.000Z",
        sequence: 1,
        companyId: "acme",
        conversationId: "conversation-1",
        payload: {},
      }),
    /eventId is required/,
  );
  assert.throws(
    () =>
      createConversationMessageRealtimeEvent({
        eventId: "event-1",
        type: "message.created",
        occurredAt: "2026-06-23T03:55:00.000Z",
        sequence: 1,
        companyId: " ",
        conversationId: "conversation-1",
        payload: {},
      }),
    /explicit companyId is required/,
  );
});

test("conversation realtime event payloads cannot expose carrier-native ids", () => {
  assert.throws(
    () =>
      createConversationMessageRealtimeEvent({
        eventId: "event-1",
        type: "message.created",
        occurredAt: "2026-06-23T03:55:00.000Z",
        sequence: 1,
        companyId: "acme",
        conversationId: "conversation-1",
        messageId: "message-1",
        actorMemberId: "employee-hr",
        payload: {
          carrierChannelId: "mm-channel-acme-conversation-1",
        },
      }),
    /forbidden carrier field: carrierChannelId/,
  );
});

test("conversation state contract exposes topic, read projection, attachments, and runtime links without carrier ids", () => {
  assert.deepEqual(PUBLIC_CONVERSATION_MESSAGE_DTO_KEY_SETS.topicState, [
    "schema",
    "version",
    "companyId",
    "conversationId",
    "topicId",
    "chatChannelId",
    "title",
    "status",
    "ownerParticipantId",
    "participantIds",
    "summary",
    "createdAt",
    "updatedAt",
  ]);
  assert.deepEqual(PUBLIC_CONVERSATION_MESSAGE_DTO_KEY_SETS.participantState, [
    "schema",
    "version",
    "companyId",
    "conversationId",
    "participantId",
    "memberId",
    "lastReadMessageId",
    "lastMentionMessageId",
    "archivedAt",
    "unreadCount",
    "mentionCount",
    "updatedAt",
  ]);
  assert.deepEqual(PUBLIC_CONVERSATION_MESSAGE_DTO_KEY_SETS.runtimeLink, [
    "schema",
    "version",
    "companyId",
    "conversationId",
    "linkId",
    "targetKind",
    "targetId",
    "label",
    "messageId",
    "createdAt",
  ]);
  assert.deepEqual(PUBLIC_CONVERSATION_MESSAGE_DTO_KEY_SETS.mention, [
    "schema",
    "version",
    "companyId",
    "conversationId",
    "messageId",
    "participantId",
    "memberId",
    "createdAt",
  ]);

  const publicKeys = JSON.stringify(PUBLIC_CONVERSATION_MESSAGE_DTO_KEY_SETS);
  assert.doesNotMatch(publicKeys, /\b(employeeId|actorEmployeeId|viewerEmployeeId)\b/);
  assert.doesNotMatch(publicKeys, /\b(team_id|teamId|user_id|userId|channel_id|channelId|post_id|postId)\b/);
});

test("conversation message contract source does not expose employee collaboration identity fields", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile("src/collaboration/contracts/conversation-message-contract.ts", "utf8");

  assert.doesNotMatch(source, /participantKind: ConversationParticipantKind;\s*employeeId\?:/);
  assert.doesNotMatch(source, /viewerEmployeeId\?:/);
  assert.doesNotMatch(source, /actorEmployeeId\?:/);
  assert.doesNotMatch(source, /actorEmployeeId/);
  assert.doesNotMatch(source, /employeeId\?: EmployeeId/);
  assert.match(source, /memberId: CompanyMemberId/);
});
