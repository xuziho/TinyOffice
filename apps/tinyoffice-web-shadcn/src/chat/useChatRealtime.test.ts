import assert from "node:assert/strict";
import test from "node:test";
import type { TinyOfficeRealtimeEvent } from "tinyoffice/realtime-contracts";
import { chatRealtimeInvalidationsForEvent } from "./useChatRealtime";

function realtimeEvent(event: Partial<TinyOfficeRealtimeEvent> & Pick<TinyOfficeRealtimeEvent, "type">): TinyOfficeRealtimeEvent {
  return {
    schema: "tinyoffice-realtime-event",
    version: 1,
    eventId: "event-1",
    occurredAt: "2026-07-06T00:00:00.000Z",
    sequence: 1,
    companyId: "acme",
    ...event,
  } as TinyOfficeRealtimeEvent;
}

test("chat realtime invalidates authoritative queries only for persisted data events", () => {
  assert.deepEqual(chatRealtimeInvalidationsForEvent(realtimeEvent({
    type: "chat.message.created",
    conversationId: "conversation-1",
    roomId: "room-1",
    messageId: "message-1",
  })), ["roomMessages", "projection"]);

  assert.deepEqual(chatRealtimeInvalidationsForEvent(realtimeEvent({
    type: "chat.entry.created",
    containerId: "container-1",
    entryId: "entry-1",
    roomId: "room-1",
  })), ["projection"]);

  assert.deepEqual(chatRealtimeInvalidationsForEvent(realtimeEvent({
    type: "chat.projection.changed",
    viewerMemberId: "xuziho",
  })), ["projection"]);

  assert.deepEqual(chatRealtimeInvalidationsForEvent(realtimeEvent({
    type: "company.directory.changed",
  })), ["directory"]);

  assert.deepEqual(chatRealtimeInvalidationsForEvent(realtimeEvent({
    type: "chat.read_state.updated",
    roomId: "room-1",
    memberId: "xuziho",
  })), ["projection"]);

  assert.deepEqual(chatRealtimeInvalidationsForEvent(realtimeEvent({
    type: "access.request.changed",
    approvalId: "approval-1",
    status: "pending",
    contextKind: "dm_thread",
    contextId: "room-1",
  })), ["accessRequests"]);
});

test("workspace runtime events keep status refreshes semantic and trace refreshes evidence-only", () => {
  assert.deepEqual(chatRealtimeInvalidationsForEvent(realtimeEvent({
    type: "work_run.updated",
    workRunId: "work-run-1",
    workTaskId: "work-task-1",
    employeeId: "avery",
    status: "in_progress",
  })), ["employeeRuntimeSummary", "tasks", "sessions"]);

  assert.deepEqual(chatRealtimeInvalidationsForEvent(realtimeEvent({
    type: "work_task.updated",
    workTaskId: "work-task-1",
    employeeId: "avery",
    status: "active",
  })), ["employeeRuntimeSummary", "tasks"]);

  assert.deepEqual(chatRealtimeInvalidationsForEvent(realtimeEvent({
    type: "session.updated",
    sessionId: "runtime-session-1",
    employeeId: "avery",
    sessionKey: "avery|work_run_execution|work-run-1",
    status: "completed",
  })), ["employeeRuntimeSummary", "sessions"]);

  assert.deepEqual(chatRealtimeInvalidationsForEvent(realtimeEvent({
    type: "process_trace.appended",
    processTraceId: "trace-1",
    employeeId: "avery",
    sessionKey: "avery|work_run_execution|work-run-1",
  })), ["sessions"]);
});

test("chat realtime run-state events do not invalidate authoritative query data", () => {
  assert.deepEqual(chatRealtimeInvalidationsForEvent(realtimeEvent({
    type: "chat.runtime_status.changed",
    conversationId: "conversation-1",
    roomId: "room-1",
    runId: "run-1",
    sourceMessageId: "message-1",
    targetMemberId: "alex",
    status: "thinking",
  })), []);

  assert.deepEqual(chatRealtimeInvalidationsForEvent(realtimeEvent({
    type: "chat.process_trace.appended",
    conversationId: "conversation-1",
    roomId: "room-1",
    runId: "run-1",
    sourceMessageId: "message-1",
    targetMemberId: "alex",
    processTraceEvent: {
      id: "trace-1",
      employeeId: "alex",
      sessionKey: "alex|chat|room-1",
      kind: "employee_reply_started",
      title: "alex started replying",
      summary: "alex started replying.",
      timestamp: "2026-07-06T00:00:00.000Z",
    },
  })), []);

  assert.deepEqual(chatRealtimeInvalidationsForEvent(realtimeEvent({
    type: "chat.reply.delta",
    conversationId: "conversation-1",
    roomId: "room-1",
    runId: "run-1",
    sourceMessageId: "message-1",
    targetMemberId: "alex",
    delta: "hello",
    sequenceInRun: 1,
  })), []);

  assert.deepEqual(chatRealtimeInvalidationsForEvent(realtimeEvent({
    type: "chat.reply.snapshot",
    conversationId: "conversation-1",
    roomId: "room-1",
    runId: "run-1",
    sourceMessageId: "message-1",
    targetMemberId: "alex",
    content: "hello",
    sequenceInRun: 2,
  })), []);
});
