import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertTinyOfficeRealtimeEvent,
  createTinyOfficeRealtimeEvent,
  TINYOFFICE_REALTIME_EVENT_SCHEMA,
} from "../../src/runtime/realtime/tinyoffice-realtime-contract.js";

test("TinyOffice realtime event contract covers Chat events with a durable envelope", () => {
  const entry = createTinyOfficeRealtimeEvent({
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

  assert.equal(entry.schema, TINYOFFICE_REALTIME_EVENT_SCHEMA);
  assert.equal(entry.version, 1);
  assert.equal(entry.type, "chat.entry.created");
  assert.equal(entry.companyId, "acme");
  assert.equal(entry.sequence, 1);
  assertTinyOfficeRealtimeEvent(entry);

  assert.doesNotThrow(() => assertTinyOfficeRealtimeEvent(createTinyOfficeRealtimeEvent({
    type: "chat.message.created",
    companyId: "acme",
    conversationId: "conversation-topic-launch",
    roomId: "conversation-topic-launch",
    messageId: "message-1",
  }, { eventId: "event-message", occurredAt: entry.occurredAt, sequence: 2 })));

  assert.doesNotThrow(() => assertTinyOfficeRealtimeEvent(createTinyOfficeRealtimeEvent({
    type: "chat.read_state.updated",
    companyId: "acme",
    roomId: "conversation-topic-launch",
    memberId: "iris-growth",
  }, { eventId: "event-read", occurredAt: entry.occurredAt, sequence: 3 })));

  assert.doesNotThrow(() => assertTinyOfficeRealtimeEvent(createTinyOfficeRealtimeEvent({
    type: "chat.projection.changed",
    companyId: "acme",
    viewerMemberId: "iris-growth",
  }, { eventId: "event-projection", occurredAt: entry.occurredAt, sequence: 4 })));

  assert.doesNotThrow(() => assertTinyOfficeRealtimeEvent(createTinyOfficeRealtimeEvent({
    type: "chat.read_state.updated",
    companyId: "acme",
    roomId: "conversation-topic-launch",
    memberId: "xuziho",
  }, { eventId: "event-member-read", occurredAt: entry.occurredAt, sequence: 5 })));

  assert.doesNotThrow(() => assertTinyOfficeRealtimeEvent(createTinyOfficeRealtimeEvent({
    type: "chat.projection.changed",
    companyId: "acme",
    viewerMemberId: "xuziho",
  }, { eventId: "event-member-projection", occurredAt: entry.occurredAt, sequence: 6 })));
});

test("TinyOffice realtime event contract rejects incomplete Chat events", () => {
  assert.throws(
    () => assertTinyOfficeRealtimeEvent({
      schema: TINYOFFICE_REALTIME_EVENT_SCHEMA,
      version: 1,
      eventId: "event-bad",
      occurredAt: "2026-06-24T01:00:00.000Z",
      sequence: 1,
      type: "chat.message.created",
      companyId: "acme",
      conversationId: "conversation-topic-launch",
      roomId: "conversation-topic-launch",
    }),
    /messageId is required/,
  );
});

test("TinyOffice realtime gateway only accepts member viewer identity for Chat delivery", async () => {
  const source = await readFile("src/runtime/realtime/tinyoffice-realtime-gateway.ts", "utf8");

  assert.doesNotMatch(source, /viewerEmployeeId/);
  assert.match(source, /viewerMemberId/);
  assert.match(source, /socket\.handshake\.query\.viewerMemberId/);
});
