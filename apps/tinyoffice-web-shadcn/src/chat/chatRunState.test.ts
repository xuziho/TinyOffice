import assert from "node:assert/strict";
import test from "node:test";

import type { TinyOfficeRealtimeEvent, TinyOfficeRealtimeEventPayload } from "tinyoffice/realtime-contracts";
import { activeChatRunForRoom, applyChatRunRealtimeEvent, draftReplyForRoom, emptyChatRunState, reconcileActiveChatRun, streamingReplyForRoom } from "./chatRunState";

test("chat run state tracks active runtime work by room", () => {
  const state = applyChatRunRealtimeEvent(emptyChatRunState(), realtimeEvent({
    type: "chat.runtime_status.changed",
    companyId: "acme",
    conversationId: "conversation-1",
    roomId: "room-1",
    sourceMessageId: "message-1",
    targetMemberId: "aster",
    status: "thinking",
    runId: "run-1",
  }));

  assert.equal(activeChatRunForRoom(state, "room-1")?.runId, "run-1");
  assert.equal(activeChatRunForRoom(state, "room-1")?.status, "thinking");
});

test("chat run state treats reply deltas as streaming work", () => {
  const state = applyChatRunRealtimeEvent(emptyChatRunState(), realtimeEvent({
    type: "chat.reply.delta",
    companyId: "acme",
    conversationId: "conversation-1",
    roomId: "room-1",
    runId: "run-1",
    sourceMessageId: "message-1",
    targetMemberId: "aster",
    delta: "Working",
    sequenceInRun: 1,
  }));

  assert.equal(activeChatRunForRoom(state, "room-1")?.status, "streaming");
  assert.equal(activeChatRunForRoom(state, "room-1")?.streamedContent, "Working");
});

test("chat run state replaces a failed attempt draft when the provider retries", () => {
  const partial = applyChatRunRealtimeEvent(emptyChatRunState(), realtimeEvent({
    type: "chat.reply.delta",
    companyId: "acme",
    conversationId: "conversation-1",
    roomId: "room-1",
    runId: "run-1",
    sourceMessageId: "message-1",
    targetMemberId: "aster",
    delta: "partial attempt",
    sequenceInRun: 1,
  }));
  const reset = applyChatRunRealtimeEvent(partial, realtimeEvent({
    type: "chat.reply.snapshot",
    companyId: "acme",
    conversationId: "conversation-1",
    roomId: "room-1",
    runId: "run-1",
    sourceMessageId: "message-1",
    targetMemberId: "aster",
    content: "",
    sequenceInRun: 2,
  }));
  const retrying = applyChatRunRealtimeEvent(reset, realtimeEvent({
    type: "chat.runtime_status.changed",
    companyId: "acme",
    conversationId: "conversation-1",
    roomId: "room-1",
    sourceMessageId: "message-1",
    targetMemberId: "aster",
    status: "retrying",
    runId: "run-1",
  }));
  const clean = applyChatRunRealtimeEvent(retrying, realtimeEvent({
    type: "chat.reply.delta",
    companyId: "acme",
    conversationId: "conversation-1",
    roomId: "room-1",
    runId: "run-1",
    sourceMessageId: "message-1",
    targetMemberId: "aster",
    delta: "clean retry",
    sequenceInRun: 4,
  }));

  assert.equal(activeChatRunForRoom(retrying, "room-1")?.status, "retrying");
  assert.equal(activeChatRunForRoom(retrying, "room-1")?.streamedContent, "");
  assert.equal(activeChatRunForRoom(clean, "room-1")?.streamedContent, "clean retry");
});

test("chat run state exposes a renderable streaming reply while text is arriving", () => {
  const state = applyChatRunRealtimeEvent(emptyChatRunState(), realtimeEvent({
    type: "chat.reply.delta",
    companyId: "acme",
    conversationId: "conversation-1",
    roomId: "room-1",
    runId: "run-1",
    sourceMessageId: "message-1",
    targetMemberId: "aster",
    delta: "Working",
    sequenceInRun: 1,
  }));

  assert.deepEqual(streamingReplyForRoom(state, "room-1"), {
    companyId: "acme",
    conversationId: "conversation-1",
    roomId: "room-1",
    runId: "run-1",
    sourceMessageId: "message-1",
    targetMemberId: "aster",
    content: "Working",
    sequence: 1,
  });
});

test("chat run state clears active work after terminal statuses", () => {
  const running = applyChatRunRealtimeEvent(emptyChatRunState(), realtimeEvent({
    type: "chat.runtime_status.changed",
    companyId: "acme",
    conversationId: "conversation-1",
    roomId: "room-1",
    sourceMessageId: "message-1",
    targetMemberId: "aster",
    status: "thinking",
    runId: "run-1",
  }));

  const completed = applyChatRunRealtimeEvent(running, realtimeEvent({
    type: "chat.runtime_status.changed",
    companyId: "acme",
    conversationId: "conversation-1",
    roomId: "room-1",
    sourceMessageId: "message-1",
    targetMemberId: "aster",
    status: "completed",
    runId: "run-1",
  }));

  assert.equal(activeChatRunForRoom(completed, "room-1"), undefined);
});

test("chat run state retains a completed streamed reply for atomic persistence reconciliation", () => {
  const streaming = applyChatRunRealtimeEvent(emptyChatRunState(), realtimeEvent({
    type: "chat.reply.snapshot",
    companyId: "acme",
    conversationId: "conversation-1",
    roomId: "room-1",
    runId: "run-1",
    sourceMessageId: "message-1",
    targetMemberId: "aster",
    content: "Final reply",
    sequenceInRun: 1,
  }));
  const completed = applyChatRunRealtimeEvent(streaming, realtimeEvent({
    type: "chat.runtime_status.changed",
    companyId: "acme",
    conversationId: "conversation-1",
    roomId: "room-1",
    sourceMessageId: "message-1",
    targetMemberId: "aster",
    status: "completed",
    runId: "run-1",
    replyMessageId: "reply-1",
  }));

  assert.deepEqual(draftReplyForRoom(completed, "room-1"), {
    companyId: "acme",
    conversationId: "conversation-1",
    roomId: "room-1",
    runId: "run-1",
    sourceMessageId: "message-1",
    replyMessageId: "reply-1",
    targetMemberId: "aster",
    content: "Final reply",
    sequence: 1,
    status: "completed",
    isTerminal: true,
  });
});

test("chat run state keeps cancel requested active until the backend publishes canceled", () => {
  const streaming = applyChatRunRealtimeEvent(emptyChatRunState(), realtimeEvent({
    type: "chat.reply.delta",
    companyId: "acme",
    conversationId: "conversation-1",
    roomId: "room-1",
    runId: "run-1",
    sourceMessageId: "message-1",
    targetMemberId: "aster",
    delta: "Partial reply",
    sequenceInRun: 1,
  }));
  const cancelRequested = applyChatRunRealtimeEvent(streaming, realtimeEvent({
    type: "chat.runtime_status.changed",
    companyId: "acme",
    conversationId: "conversation-1",
    roomId: "room-1",
    sourceMessageId: "message-1",
    targetMemberId: "aster",
    status: "cancel_requested",
    runId: "run-1",
  }));

  assert.equal(activeChatRunForRoom(cancelRequested, "room-1")?.status, "cancel_requested");
  assert.deepEqual(draftReplyForRoom(cancelRequested, "room-1"), {
    companyId: "acme",
    conversationId: "conversation-1",
    roomId: "room-1",
    runId: "run-1",
    sourceMessageId: "message-1",
    targetMemberId: "aster",
    content: "Partial reply",
    sequence: 1,
    status: "cancel_requested",
    isTerminal: false,
  });

  const canceled = applyChatRunRealtimeEvent(cancelRequested, realtimeEvent({
    type: "chat.runtime_status.changed",
    companyId: "acme",
    conversationId: "conversation-1",
    roomId: "room-1",
    sourceMessageId: "message-1",
    targetMemberId: "aster",
    status: "canceled",
    runId: "run-1",
  }));

  assert.equal(activeChatRunForRoom(canceled, "room-1"), undefined);
  assert.equal(draftReplyForRoom(canceled, "room-1"), undefined);
});

test("chat run state keeps the handoff child active when the parent completes", () => {
  const parentThinking = applyChatRunRealtimeEvent(emptyChatRunState(), {
    schema: "tinyoffice-realtime-event",
    version: 1,
    type: "chat.runtime_status.changed",
    eventId: "event-1",
    occurredAt: "2026-07-14T00:00:00.000Z",
    sequence: 1,
    companyId: "acme",
    conversationId: "room-1",
    roomId: "room-1",
    runId: "run-parent",
    chainId: "chain-1",
    sourceMessageId: "message-1",
    targetMemberId: "nora",
    status: "thinking",
  });
  const childQueued = applyChatRunRealtimeEvent(parentThinking, {
    schema: "tinyoffice-realtime-event",
    version: 1,
    type: "chat.runtime_status.changed",
    eventId: "event-2",
    occurredAt: "2026-07-14T00:00:01.000Z",
    sequence: 2,
    companyId: "acme",
    conversationId: "room-1",
    roomId: "room-1",
    runId: "run-child",
    chainId: "chain-1",
    sourceMessageId: "message-2",
    targetMemberId: "iris",
    status: "queued",
  });
  const parentCompleted = applyChatRunRealtimeEvent(childQueued, {
    schema: "tinyoffice-realtime-event",
    version: 1,
    type: "chat.runtime_status.changed",
    eventId: "event-3",
    occurredAt: "2026-07-14T00:00:02.000Z",
    sequence: 3,
    companyId: "acme",
    conversationId: "room-1",
    roomId: "room-1",
    runId: "run-parent",
    chainId: "chain-1",
    sourceMessageId: "message-1",
    targetMemberId: "nora",
    status: "completed",
  });

  assert.equal(activeChatRunForRoom(parentCompleted, "room-1")?.runId, "run-child");
  assert.equal(activeChatRunForRoom(parentCompleted, "room-1")?.chainId, "chain-1");
});

test("chat run state restores the durable current holder after a page refresh", () => {
  const restored = reconcileActiveChatRun(emptyChatRunState(), "room-1", {
    companyId: "acme",
    roomId: "room-1",
    chainId: "chain-1",
    runId: "run-child",
    sourceMessageId: "message-1",
    targetMemberId: "iris",
    status: "active",
  });

  assert.deepEqual(activeChatRunForRoom(restored, "room-1"), {
    companyId: "acme",
    conversationId: "room-1",
    roomId: "room-1",
    chainId: "chain-1",
    runId: "run-child",
    sourceMessageId: "message-1",
    targetMemberId: "iris",
    status: "thinking",
    streamedContent: "",
    sequence: 0,
  });
  assert.equal(activeChatRunForRoom(reconcileActiveChatRun(restored, "room-1", null), "room-1"), undefined);
});

test("chat run state tracks backend-projected Activity without interpreting raw trace", () => {
  const state = applyChatRunRealtimeEvent(emptyChatRunState(), realtimeEvent({
    type: "chat.activity.observed",
    companyId: "acme",
    conversationId: "conversation-1",
    roomId: "room-1",
    runId: "run-1",
    sourceMessageId: "message-1",
    targetMemberId: "aster",
    sequenceInRun: 1,
    activity: {
      items: [],
    },
  }));

  assert.equal(activeChatRunForRoom(state, "room-1")?.runId, "run-1");
  assert.equal(activeChatRunForRoom(state, "room-1")?.status, "thinking");
});

test("chat run state keeps unsupported image failures visible without backend wording", () => {
  const failed = applyChatRunRealtimeEvent(emptyChatRunState(), realtimeEvent({
    type: "chat.runtime_status.changed",
    companyId: "acme",
    conversationId: "conversation-1",
    roomId: "room-1",
    sourceMessageId: "message-1",
    targetMemberId: "aster",
    status: "failed",
    runId: "run-1",
    errorMessage: "The configured TinyOffice runtime provider does not support image understanding for Chat attachments.",
  }));

  assert.deepEqual(draftReplyForRoom(failed, "room-1"), {
    companyId: "acme",
    conversationId: "conversation-1",
    roomId: "room-1",
    runId: "run-1",
    sourceMessageId: "message-1",
    targetMemberId: "aster",
    content: "This employee cannot understand images yet. The image was sent, but the current runtime provider cannot inspect it.",
    errorMessage: "This employee cannot understand images yet. The image was sent, but the current runtime provider cannot inspect it.",
    sequence: 1,
    status: "failed",
    isTerminal: true,
  });
});

function realtimeEvent(input: TinyOfficeRealtimeEventPayload): TinyOfficeRealtimeEvent {
  return {
    schema: "tinyoffice-realtime-event",
    version: 1,
    eventId: "event-1",
    occurredAt: "2026-07-02T00:00:00.000Z",
    sequence: 1,
    ...input,
  } as TinyOfficeRealtimeEvent;
}
