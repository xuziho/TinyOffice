import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCollaborationActionEventFromToolLog,
  buildRecoveredEmittedHandoffActionEvent,
  buildSuppressedHandoffActionEvent,
} from "../../src/runtime/orchestration/collaboration-action-boundary.js";

test("collaboration action boundary builds logical action events from tool logs", () => {
  const event = buildCollaborationActionEventFromToolLog({
    timestamp: "2026-06-15T10:00:00.000Z",
    toolName: "handoff",
    params: {
      toId: "iris-growth",
      message: "Iris should continue.",
    },
    result: {
      status: "allowed",
      payload: {
        senderEmployeeId: "mira-hr",
        channelTopicId: "topic-1",
        recipientParticipantId: "iris-growth",
        message: "Iris should continue.",
      },
    },
    context: {
      runtimeEmployeeId: "fallback-actor",
    },
  }, {
    createId: (actionName) => `action-test-${actionName}`,
  });

  assert.equal(event.id, "action-test-handoff");
  assert.equal(event.employeeId, "mira-hr");
  assert.equal(event.actionName, "handoff");
  assert.equal(event.channelTopicId, "topic-1");
  assert.equal(event.recipientId, "iris-growth");
  assert.equal(event.message, "Iris should continue.");
  assert.equal(event.decision, "allowed");
  assert.equal(event.emitted, true);
  assert.equal(event.payload?.timestamp, "2026-06-15T10:00:00.000Z");
  assert.doesNotMatch(JSON.stringify(event), /rootPostId|legacyRootPostId/);
});

test("collaboration action boundary marks denied tool logs as not emitted", () => {
  const event = buildCollaborationActionEventFromToolLog({
    toolName: "finish_intake_turn",
    params: { title: "Prepare manager approval packet." },
    result: { status: "denied" },
  }, {
    now: () => "2026-06-15T10:00:01.000Z",
    createId: (actionName) => `action-test-${actionName}`,
  });

  assert.equal(event.employeeId, "unknown-employee");
  assert.equal(event.actionName, "finish_intake_turn");
  assert.equal(event.timestamp, "2026-06-15T10:00:01.000Z");
  assert.equal(event.message, "Prepare manager approval packet.");
  assert.equal(event.decision, "denied");
  assert.equal(event.emitted, false);
});

test("collaboration action boundary ignores thread fields as current identity", () => {
  const event = buildCollaborationActionEventFromToolLog({
    toolName: "handoff",
    params: {
      threadId: "params-thread-1",
      toId: "iris-growth",
      message: "Iris should continue.",
    },
    result: {
      status: "allowed",
      payload: {
        threadId: "payload-thread-1",
        channelTopicId: "topic-1",
        recipientParticipantId: "iris-growth",
      },
    },
    context: {
      threadId: "context-thread-1",
    },
  }, {
    now: () => "2026-06-15T10:00:01.500Z",
    createId: (actionName) => `action-test-${actionName}`,
  });

  assert.equal(event.employeeId, "unknown-employee");
  assert.equal(event.channelTopicId, "topic-1");
  assert.deepEqual(event.payload?.context, { threadId: "context-thread-1" });
  assert.doesNotMatch(JSON.stringify(event), /rootPostId/);
});

test("collaboration action boundary builds suppressed handoff action evidence", () => {
  const event = buildSuppressedHandoffActionEvent({
    senderEmployeeId: "nora-automation",
    handoff: {
      timestamp: "2026-06-15T10:00:02.000Z",
      channelTopicId: "topic-1",
      threadId: "thread-1",
      roomId: "conversation-launch-room",
      conversationId: "conversation-launch-room",
      chatEntryId: "chat-entry-channel-topic-launch",
      actionId: "handoff-action-1",
      recipientParticipantId: "xuziho",
      message: "Final answer is ready.",
    },
    suppressedReason: "single_handoff_per_employee_turn",
    now: () => "2026-06-15T10:00:03.000Z",
    createId: () => "action-suppressed-test",
  });

  assert.equal(event.id, "action-suppressed-test");
  assert.equal(event.employeeId, "nora-automation");
  assert.equal(event.actionName, "handoff");
  assert.equal(event.decision, "suppressed");
  assert.equal(event.emitted, false);
  assert.equal(event.suppressedReason, "single_handoff_per_employee_turn");
  assert.equal(event.payload?.phase, "natural_language.structured_action_suppressed");
});

test("collaboration action boundary builds recovered emitted handoff evidence", () => {
  const event = buildRecoveredEmittedHandoffActionEvent({
    senderEmployeeId: "nora-automation",
    replayKey: "replay-1",
    handoff: {
      timestamp: "2026-06-15T10:00:04.000Z",
      channelTopicId: "topic-1",
      threadId: "thread-1",
      roomId: "conversation-launch-room",
      conversationId: "conversation-launch-room",
      chatEntryId: "chat-entry-channel-topic-launch",
      actionId: "handoff-action-1",
      recipientParticipantId: "iris-growth",
      recipientEmployeeId: "iris-growth",
      message: "Iris should continue.",
      previousOwnerEmployeeId: "nora-automation",
      newOwnerEmployeeId: "iris-growth",
    },
  });

  assert.equal(event.id, "action-handoff-emitted-replay-1");
  assert.equal(event.timestamp, "2026-06-15T10:00:04.000Z");
  assert.equal(event.employeeId, "nora-automation");
  assert.equal(event.recipientId, "iris-growth");
  assert.equal(event.decision, "allowed");
  assert.equal(event.emitted, true);
  assert.equal(event.payload?.phase, "natural_language.structured_action_emitted_recovered");
  assert.doesNotMatch(JSON.stringify(event), /rootPostId|legacyRootPostId/);
});
