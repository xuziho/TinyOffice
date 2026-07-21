import assert from "node:assert/strict";
import test from "node:test";

import {
  assertTinyOfficeRealtimeEvent,
  createTinyOfficeRealtimeEvent,
  PUBLIC_TINYOFFICE_REALTIME_EVENT_KEY_SETS,
  TINYOFFICE_REALTIME_EVENT_SCHEMA,
} from "../../src/collaboration/contracts/tinyoffice-realtime-contract.js";

test("collaboration realtime contract exposes Chat events with TinyOffice-owned ids only", () => {
  const event = createTinyOfficeRealtimeEvent({
    type: "chat.entry.created",
    companyId: "acme",
    containerId: "chat-container-channel-topics",
    entryId: "chat-entry-channel-topic-launch",
    roomId: "conversation-topic-launch",
  }, {
    eventId: "event-entry",
    occurredAt: "2026-06-24T01:00:00.000Z",
    sequence: 1,
  });

  assert.equal(event.schema, TINYOFFICE_REALTIME_EVENT_SCHEMA);
  assert.equal(event.version, 1);
  assert.deepEqual(Object.keys(event).sort(), [
    "companyId",
    "containerId",
    "entryId",
    "eventId",
    "occurredAt",
    "roomId",
    "schema",
    "sequence",
    "type",
    "version",
  ]);
  assertTinyOfficeRealtimeEvent(event);

  const publicKeys = JSON.stringify(PUBLIC_TINYOFFICE_REALTIME_EVENT_KEY_SETS);
  assert.doesNotMatch(publicKeys, /\b(team_id|teamId|user_id|userId|channel_id|channelId|post_id|postId|root_id|rootPostId|carrier)/);
  assert.doesNotMatch(JSON.stringify(event), /\b(team_id|teamId|user_id|userId|channel_id|channelId|post_id|postId|root_id|rootPostId|carrier)/);
});

test("collaboration realtime contract rejects carrier-native fields in event payloads", () => {
  assert.throws(
    () =>
      createTinyOfficeRealtimeEvent({
        type: "chat.message.created",
        companyId: "acme",
        conversationId: "conversation-topic-launch",
        roomId: "conversation-topic-launch",
        messageId: "message-1",
        channelId: "mattermost-channel",
      } as never, {
        eventId: "event-message",
        occurredAt: "2026-06-24T01:00:00.000Z",
        sequence: 1,
      }),
    /forbidden carrier field: channelId/,
  );
});

test("collaboration realtime contract exposes Chat run lifecycle with runId and cancel states", () => {
  const event = createTinyOfficeRealtimeEvent({
    type: "chat.runtime_status.changed",
    companyId: "acme",
    conversationId: "conversation-topic-launch",
    roomId: "conversation-topic-launch",
    sourceMessageId: "message-1",
    targetMemberId: "aster",
    status: "canceled",
    runId: "chat-run-1",
    sessionKey: "aster|chat_topic_room|conversation-topic-launch",
    sessionRecordId: "tinyoffice-chat-session:chat-run-1",
    runtimeProviderId: "pi",
    errorMessage: "Canceled by Xuziho",
  } as never, {
    eventId: "event-run",
    occurredAt: "2026-06-24T01:00:00.000Z",
    sequence: 2,
  });

  assert.equal(event.type, "chat.runtime_status.changed");
  assert.equal(event.runId, "chat-run-1");
  assert.equal(event.status, "canceled");
  assert.doesNotMatch(JSON.stringify(event), /\beventKey\b/);
  assertTinyOfficeRealtimeEvent(event);
});

test("collaboration realtime contract exposes provider retry as an active Chat runtime state", () => {
  const event = createTinyOfficeRealtimeEvent({
    type: "chat.runtime_status.changed",
    companyId: "acme",
    conversationId: "conversation-topic-launch",
    roomId: "conversation-topic-launch",
    sourceMessageId: "message-1",
    targetMemberId: "aster",
    status: "retrying",
    runId: "chat-run-1",
    sessionKey: "aster|chat_topic_room|conversation-topic-launch",
  }, {
    eventId: "event-retrying",
    occurredAt: "2026-07-15T01:00:00.000Z",
    sequence: 3,
  });

  assert.equal(event.status, "retrying");
  assertTinyOfficeRealtimeEvent(event);
});

test("collaboration realtime Chat viewer targeting is memberId-only", () => {
  const event = createTinyOfficeRealtimeEvent({
    type: "chat.projection.changed",
    companyId: "acme",
    viewerMemberId: "xuziho",
  }, {
    eventId: "event-projection",
    occurredAt: "2026-07-04T01:00:00.000Z",
    sequence: 3,
  });

  assert.equal(event.viewerMemberId, "xuziho");
  assertTinyOfficeRealtimeEvent(event);
  assert.throws(
    () =>
      createTinyOfficeRealtimeEvent({
        type: "chat.projection.changed",
        companyId: "acme",
        viewerEmployeeId: "nora-automation",
      } as never, {
        eventId: "event-projection-employee",
        occurredAt: "2026-07-04T01:00:00.000Z",
        sequence: 4,
      }),
    /viewerMemberId/,
  );
});

test("collaboration realtime contract exposes company directory changes", () => {
  const event = createTinyOfficeRealtimeEvent({
    type: "company.directory.changed",
    companyId: "acme",
  }, {
    eventId: "event-directory",
    occurredAt: "2026-07-05T01:00:00.000Z",
    sequence: 5,
  });

  assert.deepEqual(Object.keys(event).sort(), [
    "companyId",
    "eventId",
    "occurredAt",
    "schema",
    "sequence",
    "type",
    "version",
  ]);
  assertTinyOfficeRealtimeEvent(event);
});

test("collaboration realtime contract exposes Access request changes", () => {
  const event = createTinyOfficeRealtimeEvent({
    type: "access.request.changed",
    companyId: "acme",
    approvalId: "approval-1",
    status: "pending",
    contextKind: "dm_thread",
    contextId: "conversation-1",
  }, {
    eventId: "event-access",
    occurredAt: "2026-07-08T01:00:00.000Z",
    sequence: 6,
  });

  assert.equal(event.type, "access.request.changed");
  assert.equal(event.approvalId, "approval-1");
  assert.equal(event.status, "pending");
  assertTinyOfficeRealtimeEvent(event);
});

test("collaboration realtime contract exposes ephemeral Chat reply deltas without persisting them as messages", () => {
  const event = createTinyOfficeRealtimeEvent({
    type: "chat.reply.delta",
    companyId: "acme",
    conversationId: "conversation-topic-launch",
    roomId: "conversation-topic-launch",
    runId: "chat-run-1",
    sourceMessageId: "message-1",
    targetMemberId: "aster",
    sessionKey: "aster|chat_topic_room|conversation-topic-launch",
    delta: "partial text",
    sequenceInRun: 1,
  } as never, {
    eventId: "event-delta",
    occurredAt: "2026-06-24T01:00:00.000Z",
    sequence: 3,
  });

  assert.equal(event.type, "chat.reply.delta");
  assert.equal(event.delta, "partial text");
  assert.equal(event.sequenceInRun, 1);
  assert.equal("messageId" in event, false);
  assertTinyOfficeRealtimeEvent(event);
});

test("collaboration realtime contract separates live Activity from its persistence watermark", () => {
  const observed = createTinyOfficeRealtimeEvent({
    type: "chat.activity.observed",
    companyId: "acme",
    conversationId: "conversation-topic-launch",
    roomId: "conversation-topic-launch",
    runId: "chat-run-1",
    sourceMessageId: "message-1",
    targetMemberId: "aster",
    sessionKey: "aster|chat_topic_room|conversation-topic-launch",
    sequenceInRun: 2,
    activity: {
      items: [{
        id: "activity:run_started:chat-run-1",
        kind: "run_started",
        title: "Run started",
        raw: { eventIds: ["trace-1"], events: [] },
      }],
    },
  }, {
    eventId: "event-activity-observed",
    occurredAt: "2026-07-21T01:00:00.000Z",
    sequence: 4,
  });
  const persisted = createTinyOfficeRealtimeEvent({
    type: "chat.activity.persisted",
    companyId: "acme",
    conversationId: "conversation-topic-launch",
    roomId: "conversation-topic-launch",
    runId: "chat-run-1",
    sourceMessageId: "message-1",
    targetMemberId: "aster",
    persistedThroughSequence: 2,
  }, {
    eventId: "event-activity-persisted",
    occurredAt: "2026-07-21T01:00:00.100Z",
    sequence: 5,
  });

  assert.equal(observed.type, "chat.activity.observed");
  assert.equal(observed.activity.items[0]?.kind, "run_started");
  assert.equal(persisted.type, "chat.activity.persisted");
  assert.equal(persisted.persistedThroughSequence, 2);
  assertTinyOfficeRealtimeEvent(observed);
  assertTinyOfficeRealtimeEvent(persisted);
});

test("collaboration realtime contract rejects legacy public eventKey on Chat runtime events", () => {
  assert.throws(
    () =>
      createTinyOfficeRealtimeEvent({
        type: "chat.runtime_status.changed",
        companyId: "acme",
        conversationId: "conversation-topic-launch",
        roomId: "conversation-topic-launch",
        sourceMessageId: "message-1",
        targetEmployeeId: "aster",
        status: "replying",
        eventKey: "legacy-event-key",
      } as never, {
        eventId: "event-run",
        occurredAt: "2026-06-24T01:00:00.000Z",
        sequence: 4,
      }),
    /runId is required|unsupported TinyOffice realtime event field: eventKey/,
  );
});
