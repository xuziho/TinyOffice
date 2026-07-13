import assert from "node:assert/strict";
import test from "node:test";

import type { ProcessTraceEvent } from "../../src/runtime/contracts/process-trace-event.js";
import { buildRuntimeTurns } from "../../src/runtime/pi/session-explorer-projection-detail.js";

test("session explorer exposes Activity instead of raw work trace items", () => {
  const runtimeTurns = buildRuntimeTurns({
    conversationTurns: [{
      index: 1,
      turnId: "turn-1",
      startedAt: "2026-07-07T00:00:00.000Z",
      completedAt: "2026-07-07T00:00:05.000Z",
      modelCallId: "model-call-1",
      usage: { inputTokens: 0, outputTokens: 0, cacheTokens: 0 },
      toolCalls: [],
    }],
    promptInputPackages: [],
    processTraceEvents: [
      traceEvent({
        id: "trace-thinking-1",
        timestamp: "2026-07-07T00:00:01.000Z",
        kind: "model_reasoning_observed",
        title: "employee-hr prepared its approach",
        summary: "Initial thinking delta.",
        status: "running",
        metadata: { modelCallId: "model-call-1", streamEventKey: "thinking:model-call-1" },
      }),
      traceEvent({
        id: "trace-thinking-2",
        timestamp: "2026-07-07T00:00:02.000Z",
        kind: "model_reasoning_observed",
        title: "employee-hr prepared its approach",
        summary: "Final thinking summary.",
        status: "succeeded",
        metadata: { modelCallId: "model-call-1", streamEventKey: "thinking:model-call-1" },
      }),
    ],
    actionSummary: { items: [], sourceEventCount: 0 },
  });

  const turn = runtimeTurns[0] as unknown as { work?: unknown; activity?: { items: unknown[] } };
  assert.equal(Object.prototype.hasOwnProperty.call(turn, "work"), false);
  assert.deepEqual(turn.activity?.items, [{
    id: "activity:thinking:model-call-1",
    kind: "thinking",
    title: "Thinking",
    details: "Final thinking summary.",
    status: "succeeded",
    timestamp: "2026-07-07T00:00:02.000Z",
    raw: {
      eventIds: ["trace-thinking-1", "trace-thinking-2"],
      events: [
        traceEvent({
          id: "trace-thinking-1",
          timestamp: "2026-07-07T00:00:01.000Z",
          kind: "model_reasoning_observed",
          title: "employee-hr prepared its approach",
          summary: "Initial thinking delta.",
          status: "running",
          metadata: { modelCallId: "model-call-1", streamEventKey: "thinking:model-call-1" },
        }),
        traceEvent({
          id: "trace-thinking-2",
          timestamp: "2026-07-07T00:00:02.000Z",
          kind: "model_reasoning_observed",
          title: "employee-hr prepared its approach",
          summary: "Final thinking summary.",
          status: "succeeded",
          metadata: { modelCallId: "model-call-1", streamEventKey: "thinking:model-call-1" },
        }),
      ],
    },
  }]);
});

test("session explorer Activity does not duplicate final replies", () => {
  const runtimeTurns = buildRuntimeTurns({
    conversationTurns: [{
      index: 1,
      turnId: "turn-1",
      startedAt: "2026-07-07T00:00:00.000Z",
      completedAt: "2026-07-07T00:00:05.000Z",
      modelCallId: "model-call-1",
      usage: { inputTokens: 0, outputTokens: 0, cacheTokens: 0 },
      toolCalls: [],
      employeeReply: {
        timestamp: "2026-07-07T00:00:05.000Z",
        text: "Final reply belongs in Output message.",
      },
    }],
    promptInputPackages: [],
    processTraceEvents: [
      traceEvent({
        id: "trace-reply",
        timestamp: "2026-07-07T00:00:05.000Z",
        kind: "model_reply_observed",
        title: "employee-hr drafted a reply",
        preview: "Final reply belongs in Output message.",
        status: "succeeded",
        metadata: { modelCallId: "model-call-1" },
      }),
    ],
    actionSummary: { items: [], sourceEventCount: 0 },
  });

  assert.deepEqual(runtimeTurns[0]?.activity.items, []);
  assert.equal(runtimeTurns[0]?.outputMessage?.text, "Final reply belongs in Output message.");
});

test("session explorer Activity ignores high-frequency text deltas", () => {
  const runtimeTurns = buildRuntimeTurns({
    conversationTurns: [{
      index: 1,
      turnId: "turn-1",
      startedAt: "2026-07-07T00:00:00.000Z",
      completedAt: "2026-07-07T00:00:05.000Z",
      modelCallId: "model-call-1",
      usage: { inputTokens: 0, outputTokens: 0, cacheTokens: 0 },
      toolCalls: [],
    }],
    promptInputPackages: [],
    processTraceEvents: [
      traceEvent({
        id: "trace-text-delta",
        timestamp: "2026-07-07T00:00:01.000Z",
        kind: "model_text_delta",
        title: "employee-hr streamed reply text",
        summary: "A single token.",
        metadata: { modelCallId: "model-call-1", streamEventKey: "text:model-call-1:1" },
      }),
      traceEvent({
        id: "trace-tool-call",
        timestamp: "2026-07-07T00:00:02.000Z",
        kind: "model_tool_call",
        title: "employee-hr called tinyoffice_capability_call",
        summary: "Created a task.",
        status: "succeeded",
        metadata: { modelCallId: "model-call-1", toolCallId: "tool-call-1" },
      }),
    ],
    actionSummary: { items: [], sourceEventCount: 0 },
  });

  assert.deepEqual(runtimeTurns[0]?.activity.items.map((item) => item.details), ["Created a task."]);
});

test("session explorer Activity collapses thinking deltas without model call metadata", () => {
  const runtimeTurns = buildRuntimeTurns({
    conversationTurns: [{
      index: 1,
      turnId: "turn-1",
      startedAt: "2026-07-07T00:00:00.000Z",
      completedAt: "2026-07-07T00:00:05.000Z",
      usage: { inputTokens: 0, outputTokens: 0, cacheTokens: 0 },
      toolCalls: [],
    }],
    promptInputPackages: [],
    processTraceEvents: [
      traceEvent({
        id: "trace-thinking-no-model-1",
        timestamp: "2026-07-07T00:00:01.000Z",
        kind: "model_reasoning_observed",
        title: "employee-hr prepared its approach",
        summary: "First delta.",
        status: "running",
      }),
      traceEvent({
        id: "trace-thinking-no-model-2",
        timestamp: "2026-07-07T00:00:02.000Z",
        kind: "model_reasoning_observed",
        title: "employee-hr prepared its approach",
        summary: "Second delta.",
        status: "running",
      }),
    ],
    actionSummary: { items: [], sourceEventCount: 0 },
  });

  assert.deepEqual(runtimeTurns[0]?.activity.items.map((item) => item.id), [
    "activity:thinking:employee-hr|chat_direct_room|conversation-1",
  ]);
});

function traceEvent(input: Omit<ProcessTraceEvent, "sessionKey">): ProcessTraceEvent {
  return {
    sessionKey: "employee-hr|chat_direct_room|conversation-1",
    ...input,
  };
}
