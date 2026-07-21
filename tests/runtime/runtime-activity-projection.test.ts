import assert from "node:assert/strict";
import test from "node:test";

import type { ProcessTraceEvent } from "../../src/runtime/contracts/process-trace-event.js";
import { buildRuntimeActivity } from "../../src/runtime/activity/runtime-activity-projection.js";

test("runtime Activity projects tool calls, tool results, and raw details without duplicating replies", () => {
  const activity = buildRuntimeActivity([
    traceEvent({
      id: "trace-started",
      timestamp: "2026-07-07T06:27:44.729Z",
      kind: "employee_reply_started",
      title: "employee-hr started Chat reply",
      summary: "Chat runtime accepted message-a8d and started preparing a reply.",
      status: "running",
      metadata: { runId: "run-1", sourceMessageId: "message-a8d", targetMemberId: "employee-hr" },
    }),
    traceEvent({
      id: "trace-tool-running",
      timestamp: "2026-07-07T06:27:46.925Z",
      kind: "tool_activity",
      title: "Ran a command",
      status: "running",
      metadata: { runId: "run-1", sourceMessageId: "message-a8d", toolCallId: "call-1", toolName: "bash" },
    }),
    traceEvent({
      id: "trace-tool-call",
      timestamp: "2026-07-07T06:27:47.096Z",
      kind: "model_tool_call",
      title: "employee-hr called bash",
      summary: "{\"command\":\"pwd && ls -la\",\"timeout\":10}",
      status: "succeeded",
      metadata: {
        runId: "run-1",
        sourceMessageId: "message-a8d",
        toolCallId: "call-1",
        toolName: "bash",
        arguments: { command: "pwd && ls -la", timeout: 10 },
      },
    }),
    traceEvent({
      id: "trace-tool-activity-succeeded",
      timestamp: "2026-07-07T06:27:47.096Z",
      kind: "tool_activity",
      title: "Ran pwd && ls -la",
      status: "succeeded",
      metadata: {
        runId: "run-1",
        sourceMessageId: "message-a8d",
        toolCallId: "call-1",
        toolName: "bash",
        activityTarget: "pwd && ls -la",
      },
    }),
    traceEvent({
      id: "trace-result",
      timestamp: "2026-07-07T06:27:47.261Z",
      kind: "model_tool_result",
      title: "bash returned a result",
      summary: "/workspace\nREADME.md\n",
      status: "succeeded",
      metadata: { runId: "run-1", sourceMessageId: "message-a8d", toolCallId: "call-1", toolName: "bash" },
    }),
    traceEvent({
      id: "trace-reply",
      timestamp: "2026-07-07T06:27:49.362Z",
      kind: "model_reply_observed",
      title: "employee-hr drafted a reply",
      preview: "Final reply is already visible in the conversation.",
      status: "succeeded",
      metadata: { runId: "run-1", sourceMessageId: "message-a8d" },
    }),
    traceEvent({
      id: "trace-completed",
      timestamp: "2026-07-07T06:27:49.431Z",
      kind: "turn_completed",
      title: "employee-hr posted a Chat reply",
      summary: "Reply message message-reply was written to the TinyOffice Conversation.",
      status: "succeeded",
      metadata: { runId: "run-1", sourceMessageId: "message-a8d", replyMessageId: "message-reply" },
    }),
  ]);

  assert.deepEqual(activity.items.map((item) => ({
    kind: item.kind,
    title: item.title,
    details: item.details,
    status: item.status,
    primary: item.primary,
    rawEventIds: item.raw.eventIds,
  })), [
    {
      kind: "run_started",
      title: "Run started",
      details: "Chat runtime accepted message-a8d and started preparing a reply.",
      status: "running",
      primary: { targetMemberId: "employee-hr" },
      rawEventIds: ["trace-started"],
    },
    {
      kind: "tool_call",
      title: "Tool · bash",
      details: "/workspace\nREADME.md\n",
      status: "succeeded",
      primary: {
        toolName: "bash",
        arguments: { command: "pwd && ls -la", timeout: 10 },
      },
      rawEventIds: ["trace-tool-running", "trace-tool-call", "trace-tool-activity-succeeded", "trace-result"],
    },
    {
      kind: "run_completed",
      title: "Run completed",
      details: "Reply posted to conversation.",
      status: "succeeded",
      primary: { replyMessageId: "message-reply" },
      rawEventIds: ["trace-completed"],
    },
  ]);
});

test("runtime Activity keeps full details instead of a truncated summary", () => {
  const longThinking = [
    "Considering task creation in Chinese.",
    "I need to explain the available workflow, list the exact tool path, mention approval behavior, and keep the entire reasoning detail visible when the user expands this activity row.",
    "This final sentence must survive intact instead of being replaced with an ellipsis.",
  ].join(" ");

  const activity = buildRuntimeActivity([
    traceEvent({
      id: "trace-thinking",
      timestamp: "2026-07-07T06:27:46.925Z",
      kind: "model_reasoning_observed",
      title: "employee-hr prepared its approach",
      summary: longThinking,
      status: "running",
      metadata: { runId: "run-1", modelCallId: "model-call-1" },
    }),
  ]);

  assert.equal(activity.items[0]?.kind, "thinking");
  assert.equal(activity.items[0]?.details, longThinking);
  assert.equal(Object.prototype.hasOwnProperty.call(activity.items[0] || {}, "summary"), false);
});

test("runtime Activity keeps repeated same-name tool calls separate", () => {
  const activity = buildRuntimeActivity([
    traceEvent({
      id: "trace-call-python",
      timestamp: "2026-07-07T06:27:47.000Z",
      kind: "model_tool_call",
      title: "employee-hr called bash",
      summary: "{\"command\":\"python script.py\"}",
      status: "succeeded",
      metadata: {
        runId: "run-1",
        toolCallId: "call-python",
        toolName: "bash",
        arguments: { command: "python script.py" },
      },
    }),
    traceEvent({
      id: "trace-result-python",
      timestamp: "2026-07-07T06:27:48.000Z",
      kind: "model_tool_result",
      title: "bash returned a result",
      summary: "python: command not found",
      status: "failed",
      metadata: {
        runId: "run-1",
        toolCallId: "call-python",
        toolName: "bash",
      },
    }),
    traceEvent({
      id: "trace-call-sed",
      timestamp: "2026-07-07T06:27:49.000Z",
      kind: "model_tool_call",
      title: "employee-hr called bash",
      summary: "{\"command\":\"sed -n p .env.local\"}",
      status: "succeeded",
      metadata: {
        runId: "run-1",
        toolCallId: "call-sed",
        toolName: "bash",
        arguments: { command: "sed -n p .env.local" },
      },
    }),
    traceEvent({
      id: "trace-result-sed",
      timestamp: "2026-07-07T06:27:50.000Z",
      kind: "model_tool_result",
      title: "bash returned a result",
      summary: "KEY=<redacted>",
      status: "succeeded",
      metadata: {
        runId: "run-1",
        toolCallId: "call-sed",
        toolName: "bash",
      },
    }),
  ]);

  assert.deepEqual(activity.items.map((item) => ({
    kind: item.kind,
    status: item.status,
    details: item.details,
  })), [
    {
      kind: "tool_call",
      status: "failed",
      details: "python: command not found",
    },
    {
      kind: "tool_call",
      status: "succeeded",
      details: "KEY=<redacted>",
    },
  ]);
});

test("runtime Activity projects topic handoff as a first-class activity", () => {
  const activity = buildRuntimeActivity([
    traceEvent({
      id: "trace-handoff-activity",
      timestamp: "2026-07-07T06:27:47.000Z",
      kind: "tool_activity",
      title: "Handed off topic to Olivia",
      status: "running",
      metadata: {
        runId: "run-1",
        sessionRecordId: "handoff-call-1",
        toolName: "handoff_topic_turn",
        activityKind: "topic_handoff",
        activityTarget: "Olivia",
      },
    }),
    traceEvent({
      id: "trace-handoff-call",
      timestamp: "2026-07-07T06:27:47.100Z",
      kind: "model_tool_call",
      title: "employee-hr called handoff_topic_turn",
      summary: "{\"toId\":\"olivia\",\"reason\":\"SEO owner\"}",
      status: "succeeded",
      metadata: {
        runId: "run-1",
        sessionRecordId: "handoff-call-1",
        toolName: "handoff_topic_turn",
        arguments: { toId: "olivia", reason: "SEO owner" },
      },
    }),
  ]);

  assert.deepEqual(activity.items.map((item) => ({
    kind: item.kind,
    title: item.title,
    details: item.details,
    status: item.status,
    primary: item.primary,
    rawEventIds: item.raw.eventIds,
  })), [{
    kind: "handoff",
    title: "Handoff",
    details: "{\"toId\":\"olivia\",\"reason\":\"SEO owner\"}",
    status: "succeeded",
    primary: {
      toolName: "handoff_topic_turn",
      targetMemberId: "Olivia",
      arguments: { toId: "olivia", reason: "SEO owner" },
    },
    rawEventIds: ["trace-handoff-activity", "trace-handoff-call"],
  }]);
});

test("runtime Activity keeps provider backoff visible as one retry item", () => {
  const activity = buildRuntimeActivity([
    traceEvent({
      id: "retry-start",
      timestamp: "2026-07-14T12:00:00.000Z",
      kind: "provider_retry",
      title: "Provider retry scheduled",
      status: "running",
      metadata: { runId: "run-1", attempt: 1, delayMs: 5000, errorMessage: "Provider overloaded" },
    }),
    traceEvent({
      id: "retry-end",
      timestamp: "2026-07-14T12:00:05.000Z",
      kind: "provider_retry",
      title: "Provider retry succeeded",
      status: "succeeded",
      metadata: { runId: "run-1", attempt: 1 },
    }),
  ]);

  assert.equal(activity.items.length, 1);
  assert.deepEqual(activity.items[0] && {
    kind: activity.items[0].kind,
    title: activity.items[0].title,
    status: activity.items[0].status,
    rawEventIds: activity.items[0].raw.eventIds,
  }, {
    kind: "provider_retry",
    title: "Provider retry 1",
    status: "succeeded",
    rawEventIds: ["retry-start", "retry-end"],
  });
});

function traceEvent(input: Omit<ProcessTraceEvent, "sessionKey" | "employeeId">): ProcessTraceEvent {
  return {
    sessionKey: "employee-hr|chat_direct_room|conversation-1",
    employeeId: "employee-hr",
    ...input,
  };
}
