import assert from "node:assert/strict";
import test from "node:test";

import type { ProcessTraceEvent } from "../../src/runtime/contracts/process-trace-event.js";
import {
  buildRuntimeSessionInspection,
} from "../../src/runtime/session-inspector/session-inspector.js";
import type {
  CollaborationActionEvent,
  RuntimeSessionEvent,
  RuntimeSessionRecord,
} from "../../src/runtime/storage/runtime-session-repository.js";

function baseRecord(overrides: Partial<RuntimeSessionRecord> = {}): RuntimeSessionRecord {
  return {
    id: "session-1",
    employeeId: "mira-hr",
    sessionKey: "mira-hr|channel_thread|root-1",
    sessionId: "pi-session-1",
    sceneType: "channel_thread",
    channelTopicId: "channel-topic-root-1",
    requesterId: "xuziho",
    status: "running",
    startedAt: "2026-06-15T08:00:00.000Z",
    updatedAt: "2026-06-15T08:00:05.000Z",
    eventCount: 0,
    userMessageCount: 0,
    assistantMessageCount: 0,
    toolCallCount: 0,
    toolResultCount: 0,
    tokenInputTotal: 0,
    tokenOutputTotal: 0,
    tokenCacheTotal: 0,
    byteSize: 0,
    truncated: false,
    ...overrides,
  };
}

function event(
  sequence: number,
  kind: string,
  role: string | undefined,
  preview: string | undefined,
  payload?: Record<string, unknown>,
  overrides: Partial<RuntimeSessionEvent> = {},
): RuntimeSessionEvent {
  return {
    id: `event-${sequence}`,
    sessionRecordId: "session-1",
    sequence,
    timestamp: `2026-06-15T08:00:${String(sequence).padStart(2, "0")}.000Z`,
    kind,
    role,
    preview,
    payload,
    byteSize: 0,
    truncated: false,
    ...overrides,
  };
}

function trace(
  index: number,
  kind: ProcessTraceEvent["kind"],
  title: string,
  summary?: string,
): ProcessTraceEvent {
  return {
    id: `trace-${index}`,
    timestamp: `2026-06-15T08:01:${String(index).padStart(2, "0")}.000Z`,
    kind,
    sessionKey: "mira-hr|channel_thread|root-1",
    channelTopicId: "channel-topic-root-1",
    employeeId: "mira-hr",
    title,
    summary,
  };
}

function action(overrides: Partial<CollaborationActionEvent> = {}): CollaborationActionEvent {
  return {
    id: "action-1",
    timestamp: "2026-06-15T08:02:00.000Z",
    employeeId: "mira-hr",
    actionName: "handoff",
    channelTopicId: "channel-topic-root-1",
    status: "allowed",
    recipientId: "xuziho",
    message: "The onboarding checklist lives in the People handbook.",
    emitted: true,
    ...overrides,
  };
}

test("runtime session inspection groups lifecycle wrappers into one model call while keeping raw evidence", () => {
  const inspection = buildRuntimeSessionInspection({
    record: baseRecord({
      tokenInputTotal: 120,
      tokenOutputTotal: 40,
      tokenCacheTotal: 8,
    }),
    events: [
      event(1, "user_message", "user", "Where should a new employee find the onboarding checklist?"),
      event(2, "message_start", "user", "Context:\n...\nMessage:\nWhere should a new employee find the onboarding checklist?"),
      event(3, "message_end", "user", "Context:\n...\nMessage:\nWhere should a new employee find the onboarding checklist?"),
      event(4, "message_start", "assistant", undefined),
      event(5, "stream_event", "assistant", "The checklist"),
      event(6, "message_end", "assistant", "The onboarding checklist lives in the People handbook."),
      event(7, "assistant_message", "assistant", "The onboarding checklist lives in the People handbook."),
    ],
    processTraceEvents: [],
    collaborationActionEvents: [],
  });

  assert.equal(inspection.header.liveStatus, "running");
  assert.equal(inspection.trigger.userMessage, "Where should a new employee find the onboarding checklist?");
  assert.equal(inspection.userVisibleTimeline.length, 2);
  assert.deepEqual(inspection.userVisibleTimeline.map((entry) => entry.kind), [
    "user_message",
    "assistant_message",
  ]);
  assert.equal(inspection.modelCalls.length, 1);
  assert.equal(inspection.modelCalls[0]?.input.userPrompt, "Where should a new employee find the onboarding checklist?");
  assert.equal(inspection.modelCalls[0]?.input.fullInput, "Context:\n...\nMessage:\nWhere should a new employee find the onboarding checklist?");
  assert.equal(inspection.modelCalls[0]?.output.finalText, "The onboarding checklist lives in the People handbook.");
  assert.equal(inspection.rawEvidence.length, 7);
  assert.equal(inspection.diagnostics.some((item) => item.code === "missing_model_observation"), true);
  assert.equal(inspection.model.dataState.configured, "not_recorded");
  assert.deepEqual(inspection.model.usage, {
    inputTokens: 120,
    outputTokens: 40,
    cacheTokens: 8,
    dataState: "recorded",
  });
  assert.deepEqual(inspection.promptAndContext.userPrompt, {
    state: "derived",
    value: "Where should a new employee find the onboarding checklist?",
    source: "runtime_events.user_message",
  });
});

test("runtime session inspection represents collaboration actions on the primary model turn", () => {
  const primaryModelCallId = "session-1|model_call|primary";
  const inspection = buildRuntimeSessionInspection({
    record: baseRecord({ status: "completed" }),
    events: [
      event(1, "user_message", "user", "Can Mira explain where the onboarding checklist is?", undefined, { modelCallId: primaryModelCallId }),
      event(2, "message_start", "user", "Context:\nMessage:\nCan Mira explain where the onboarding checklist is?", undefined, { modelCallId: primaryModelCallId }),
      event(3, "message_end", "user", "Context:\nMessage:\nCan Mira explain where the onboarding checklist is?", undefined, { modelCallId: primaryModelCallId }),
      event(4, "message_start", "assistant", undefined, undefined, { modelCallId: primaryModelCallId }),
      event(5, "message_end", "assistant", "The checklist lives in the People handbook.", undefined, { modelCallId: primaryModelCallId }),
      event(6, "assistant_message", "assistant", "The checklist lives in the People handbook.", undefined, { modelCallId: primaryModelCallId }),
      event(7, "model_call_completed", undefined, "channel result accepted.", undefined, { modelCallId: primaryModelCallId }),
    ],
    processTraceEvents: [],
    collaborationActionEvents: [
      action({ id: "action-emitted", emitted: true, status: "allowed", message: "The checklist lives in the People handbook." }),
      action({ id: "action-suppressed", emitted: false, status: undefined, message: "The checklist lives in the People handbook." }),
    ],
  });

  assert.equal(inspection.header.liveStatus, "completed");
  assert.equal(inspection.trigger.userMessage, "Can Mira explain where the onboarding checklist is?");
  assert.equal(inspection.modelCalls.length, 1);
  assert.equal(inspection.modelCalls[0]?.purpose, "primary_response");
  assert.equal(inspection.actionLedger.length, 1);
  assert.equal(inspection.actionLedger[0]?.name, "handoff");
  assert.equal(inspection.actionLedger[0]?.status, "allowed");
  assert.equal(inspection.actionLedger[0]?.emitted, true);
  assert.equal(inspection.actionLedger[0]?.suppressedCount, 1);
  assert.deepEqual(inspection.actionLedger[0]?.actionEventIds, ["action-emitted", "action-suppressed"]);
  assert.equal(Object.prototype.hasOwnProperty.call(inspection, "finalOutputPolicies"), false);
  assert.equal(
    inspection.userVisibleTimeline.filter((entry) => entry.kind === "user_message").length,
    1,
  );
});

test("runtime session inspection attaches raw tool evidence to logical collaboration actions", () => {
  const inspection = buildRuntimeSessionInspection({
    record: baseRecord({ status: "completed" }),
    events: [
      event(1, "user_message", "user", "Please hand this to Iris."),
      event(2, "message_end", "assistant", undefined, {
        message: {
          items: [{
            type: "toolCall",
            name: "handoff",
            arguments: { toId: "iris-growth", message: "Please continue." },
          }],
        },
      }),
      event(3, "model_tool_call", "assistant", "handoff", {
        toolCall: {
          name: "handoff",
          arguments: { toId: "iris-growth", message: "Please continue." },
        },
      }),
      event(4, "message_end", "toolResult", "handoff recorded with status allowed."),
    ],
    processTraceEvents: [
      trace(1, "tool_call_detected", "handoff detected", "internal handoff target iris-growth"),
      trace(2, "structured_action_replayed", "handoff emitted", "1 action replayed into the thread."),
    ],
    collaborationActionEvents: [
      action({
        id: "action-emitted",
        emitted: true,
        status: "allowed",
        recipientId: "iris-growth",
        message: "Please continue.",
      }),
      action({
        id: "action-suppressed",
        emitted: false,
        status: undefined,
        recipientId: "iris-growth",
        message: "Please continue.",
        suppressedReason: "single_handoff_per_employee_turn",
      }),
    ],
  });

  assert.equal(inspection.actionLedger.length, 1);
  assert.deepEqual(inspection.actionLedger[0]?.actionEventIds, ["action-emitted", "action-suppressed"]);
  assert.deepEqual(inspection.actionLedger[0]?.toolEvidenceEventIds, ["event-2", "event-3"]);
  assert.deepEqual(inspection.actionLedger[0]?.processTraceEventIds, ["trace-1", "trace-2"]);
  assert.equal(inspection.actionLedger[0]?.rawEvidenceIds.length, 6);
});

test("runtime session inspection does not inflate repeated flush snapshots into extra model calls", () => {
  const originalUserPrompt = "Mira, where should a new employee find the onboarding checklist?";
  const fullPrompt = [
    "Runtime Context:",
    "Scene: channel_thread",
    "Topic context:",
    "Handoff candidates:",
    "- xuziho",
    "",
    "User Message:",
    originalUserPrompt,
  ].join("\n");
  const events: RuntimeSessionEvent[] = [];
  for (let flush = 0; flush < 11; flush += 1) {
    const offset = flush * 3;
    events.push(
      event(offset + 1, "user_message", "user", originalUserPrompt),
      event(offset + 2, "message_start", "user", fullPrompt),
      event(offset + 3, "message_end", "user", fullPrompt),
    );
  }
  events.push(
    event(34, "message_start", "assistant", undefined),
    event(35, "message_end", "assistant", "The checklist lives in the People handbook."),
    event(36, "assistant_message", "assistant", "The checklist lives in the People handbook."),
  );

  const inspection = buildRuntimeSessionInspection({
    record: baseRecord({ status: "completed" }),
    events,
    processTraceEvents: [],
    collaborationActionEvents: [
      action({ id: "action-emitted", emitted: true, status: "allowed" }),
      action({ id: "action-suppressed", emitted: false, status: undefined }),
    ],
  });

  assert.equal(inspection.trigger.userMessage, originalUserPrompt);
  assert.equal(
    inspection.userVisibleTimeline.filter((entry) => entry.kind === "user_message").length,
    1,
  );
  assert.equal(inspection.modelCalls.length, 1);
  assert.equal(inspection.modelCalls[0]?.purpose, "primary_response");
  assert.equal(inspection.modelCalls[0]?.input.userPrompt, originalUserPrompt);
  assert.equal(inspection.actionLedger.length, 1);
  assert.equal(inspection.actionLedger[0]?.emittedCount, 1);
  assert.equal(inspection.actionLedger[0]?.suppressedCount, 1);
  assert.equal(inspection.rawEvidence.length, events.length + 2);
});

test("runtime session inspection keeps Mira-style repeated flush symptoms in one turn boundary", () => {
  const userPrompt = "Mira, please hand this onboarding question to the right owner.";
  const primaryModelCallId = "mira-session|model_call|primary";
  const events: RuntimeSessionEvent[] = [];

  for (let flush = 0; flush < 22; flush += 1) {
    events.push(event(flush + 1, "user_message", "user", userPrompt, undefined, {
      id: `flush-${flush + 1}`,
      modelCallId: primaryModelCallId,
      visibility: "user_visible",
      semanticRole: "user_message",
      rawEventKind: "user_message",
    }));
  }
  events.push(
    event(23, "model_call_started", undefined, "Primary model call started.", undefined, {
      modelCallId: primaryModelCallId,
      visibility: "diagnostic",
      semanticRole: "model_call_lifecycle",
      rawEventKind: "model_call_started",
    }),
    event(24, "message_start", "user", "Runtime Context:\n...\nUser Message:\n" + userPrompt, undefined, {
      modelCallId: primaryModelCallId,
      visibility: "model_input",
      semanticRole: "prompt_package",
      rawEventKind: "message_start",
    }),
    event(25, "model_call_completed", undefined, "channel result accepted.", undefined, {
      modelCallId: primaryModelCallId,
      visibility: "diagnostic",
      semanticRole: "model_call_lifecycle",
      rawEventKind: "model_call_completed",
    }),
  );

  const inspection = buildRuntimeSessionInspection({
    record: baseRecord({ id: "mira-session", status: "completed" }),
    events,
    processTraceEvents: [],
    collaborationActionEvents: [
      action({ id: "handoff-emitted", emitted: true, status: "allowed" }),
      action({ id: "handoff-suppressed", emitted: false, status: undefined }),
    ],
  });

  assert.equal(
    inspection.userVisibleTimeline.filter((entry) => entry.kind === "user_message").length,
    1,
  );
  assert.equal(inspection.modelCalls.length, 1);
  assert.equal(inspection.modelCalls[0]?.modelCallId, primaryModelCallId);
  assert.equal(
    inspection.userVisibleTimeline.some((entry) =>
      entry.text?.includes("tinyoffice.handoff_topic_turn")
    ),
    false,
  );
  assert.equal(Object.prototype.hasOwnProperty.call(inspection, "finalOutputPolicies"), false);
  assert.equal(inspection.actionLedger.length, 1);
  assert.deepEqual(inspection.actionLedger[0]?.actionEventIds, [
    "handoff-emitted",
    "handoff-suppressed",
  ]);
  assert.equal(inspection.actionLedger[0]?.emittedCount, 1);
  assert.equal(inspection.actionLedger[0]?.suppressedCount, 1);
});

test("runtime session inspection prefers semantic event fields over kind guesses", () => {
  const structured = {
    sceneId: "mira-hr|dm_thread|root-1",
    turnId: "mira-hr|dm_thread|root-1|turn",
    runId: "runtime-session-1",
    modelCallId: "runtime-session-1|model_call|primary",
  };

  const inspection = buildRuntimeSessionInspection({
    record: baseRecord({ sceneType: "dm_thread", status: "completed" }),
    events: [
      event(1, "user_message", "user", "Can you confirm the HR smoke?", undefined, {
        ...structured,
        source: "tinyoffice.chat.user_message",
        visibility: "user_visible",
        semanticRole: "user_message",
        rawEventKind: "user_message",
      }),
      event(2, "message_start", "user", "Runtime Context:\n...\nUser Message:\nCan you confirm the HR smoke?", undefined, {
        ...structured,
        source: "prompt_compiler",
        visibility: "model_input",
        semanticRole: "prompt_package",
        rawEventKind: "message_start",
      }),
      event(3, "user_message", "user", "Runtime Context:\n...\nUser Message:\nCan you confirm the HR smoke?", undefined, {
        ...structured,
        source: "pi.session_event",
        visibility: "model_input",
        semanticRole: "prompt_package",
        rawEventKind: "user_message",
      }),
      event(4, "stream_event", "assistant", "Confirmed.", undefined, {
        ...structured,
        source: "pi.session_event",
        visibility: "raw_evidence",
        semanticRole: "model_delta",
        rawEventKind: "message_update",
      }),
      event(5, "assistant_message", "assistant", "Confirmed.", undefined, {
        ...structured,
        source: "pi.employee_reply",
        visibility: "user_visible",
        semanticRole: "assistant_visible_message",
        rawEventKind: "assistant_message",
      }),
    ],
    processTraceEvents: [],
    collaborationActionEvents: [],
  });

  assert.deepEqual(inspection.userVisibleTimeline.map((entry) => entry.text), [
    "Can you confirm the HR smoke?",
    "Confirmed.",
  ]);
  assert.equal(inspection.modelCalls.length, 1);
  assert.equal(inspection.modelCalls[0]?.input.userPrompt, "Can you confirm the HR smoke?");
  assert.equal(
    inspection.modelCalls[0]?.input.fullInput,
    "Runtime Context:\n...\nUser Message:\nCan you confirm the HR smoke?",
  );
  assert.equal(inspection.modelCalls[0]?.output.finalText, "Confirmed.");
  assert.deepEqual(inspection.modelCalls[0]?.input.sourceEventIds, ["event-1", "event-2", "event-3"]);
});

test("runtime session inspection exposes structured prompt and context sections", () => {
  const structured = {
    sceneId: "mira-hr|channel_thread|root-1",
    turnId: "mira-hr|channel_thread|root-1|turn-1",
    runId: "runtime-session-1",
    modelCallId: "runtime-session-1|model_call|primary",
  };

  const inspection = buildRuntimeSessionInspection({
    record: baseRecord({ sceneType: "channel_thread", status: "completed" }),
    events: [
      event(1, "user_message", "user", "Mira, please check the handoff status.", undefined, {
        ...structured,
        source: "tinyoffice.chat.user_message",
        visibility: "user_visible",
        semanticRole: "user_message",
        rawEventKind: "user_message",
      }),
      event(2, "prompt_context", undefined, "Thread context:\n- root post\n- latest reply", undefined, {
        ...structured,
        source: "prompt_compiler",
        visibility: "model_input",
        semanticRole: "channel_thread_context",
        rawEventKind: "prompt_context",
      }),
      event(3, "prompt_package", undefined, "System prompt and mounted prompt blocks.", undefined, {
        ...structured,
        source: "prompt_compiler",
        visibility: "model_input",
        semanticRole: "prompt_package",
        rawEventKind: "prompt_package",
      }),
      event(4, "prompt_context", undefined, "Intake payload:\n- missing_featured_image", undefined, {
        ...structured,
        source: "external_intake.event_payload",
        visibility: "prompt_context",
        semanticRole: "intake_event_context",
        rawEventKind: "prompt_context",
      }),
      event(5, "tool_policy", undefined, "Allowed tools: finish_intake_turn, finish_intake_turn.", undefined, {
        ...structured,
        source: "prompt_compiler",
        visibility: "model_input",
        semanticRole: "tool_policy",
        rawEventKind: "tool_policy",
      }),
      event(6, "prompt_context", undefined, "WorkRun package:\n- work-run-2", undefined, {
        ...structured,
        source: "work_execution.work_run_context",
        visibility: "prompt_context",
        semanticRole: "work_run_context",
        rawEventKind: "prompt_context",
      }),
    ],
    processTraceEvents: [],
    collaborationActionEvents: [],
  });

  assert.deepEqual(
    inspection.promptAndContext.sections.map((section) => section.semanticRole),
    [
      "user_message",
      "channel_thread_context",
      "prompt_package",
      "intake_event_context",
      "tool_policy",
      "work_run_context",
    ],
  );
  assert.equal(inspection.promptAndContext.sections[1]?.value, "Thread context:\n- root post\n- latest reply");
  assert.equal(inspection.promptAndContext.sections[2]?.state, "recorded");
  assert.equal(inspection.promptAndContext.sections[3]?.source, "external_intake.event_payload");
  assert.equal(inspection.promptAndContext.sections[5]?.source, "work_execution.work_run_context");
});

test("runtime session inspection reads persisted runtime metadata without prompt assembly fields", () => {
  const inspection = buildRuntimeSessionInspection({
    record: baseRecord({
      modelProvider: "openai",
      modelId: "gpt-5.5",
      runtimeMetadata: {
        model: {
          state: "recorded",
          provider: "openai",
          id: "gpt-5.5",
          source: "effective_runtime_config",
        },
        cwd: {
          state: "recorded",
          value: "C:\\Users\\Xu\\workspace\\mira-hr",
          source: "employee.workspacePath",
        },
        tools: {
          state: "recorded",
          source: "natural_language_response_input",
          loadedToolNames: ["finish_intake_turn", "finish_intake_turn"],
          activeToolNames: ["finish_intake_turn"],
        },
      },
    }),
    events: [
      event(1, "user_message", "user", "Can you hand this to Iris?", undefined, {
        visibility: "user_visible",
        semanticRole: "user_message",
      }),
    ],
    processTraceEvents: [],
    collaborationActionEvents: [],
  });

  assert.deepEqual(inspection.runtimeMetadata.cwd, {
    state: "recorded",
    value: "C:\\Users\\Xu\\workspace\\mira-hr",
    source: "employee.workspacePath",
  });
  assert.deepEqual(inspection.runtimeMetadata.tools.loadedToolNames, ["finish_intake_turn", "finish_intake_turn"]);
  assert.deepEqual(inspection.runtimeMetadata.tools.activeToolNames, ["finish_intake_turn"]);
  assert.equal(inspection.promptAndContext.userPrompt.state, "derived");
});

test("runtime session inspection reads first-class model call lifecycle events", () => {
  const structured = {
    sceneId: "mira-hr|dm_thread|root-1",
    turnId: "mira-hr|dm_thread|root-1|turn-1",
    runId: "runtime-session-1",
    modelCallId: "runtime-session-1|model_call|primary",
  };

  const inspection = buildRuntimeSessionInspection({
    record: baseRecord({ sceneType: "dm_thread", status: "completed" }),
    events: [
      event(1, "user_message", "user", "Can you confirm the HR smoke?", undefined, {
        ...structured,
        source: "tinyoffice.chat.user_message",
        visibility: "user_visible",
        semanticRole: "user_message",
        rawEventKind: "user_message",
      }),
      event(2, "prompt_package", undefined, "Runtime Context:\n...\nUser Message:\nCan you confirm the HR smoke?", undefined, {
        ...structured,
        source: "prompt_compiler",
        visibility: "model_input",
        semanticRole: "prompt_package",
        rawEventKind: "prompt_package",
      }),
      event(3, "model_call_started", undefined, "Primary model call started.", undefined, {
        ...structured,
        source: "runtime.model_call",
        visibility: "diagnostic",
        semanticRole: "model_call_lifecycle",
        rawEventKind: "model_call_started",
      }),
      event(4, "model_call_delta", undefined, "Confirming.", undefined, {
        ...structured,
        source: "runtime.model_call",
        visibility: "diagnostic",
        semanticRole: "model_delta",
        rawEventKind: "model_call_delta",
      }),
      event(5, "model_call_completed", undefined, "Confirmed.", undefined, {
        ...structured,
        source: "runtime.model_call",
        visibility: "diagnostic",
        semanticRole: "model_call_lifecycle",
        rawEventKind: "model_call_completed",
      }),
    ],
    processTraceEvents: [],
    collaborationActionEvents: [],
  });

  assert.equal(inspection.userVisibleTimeline.length, 1);
  assert.equal(inspection.modelCalls.length, 1);
  assert.equal(inspection.modelCalls[0]?.startedAt, "2026-06-15T08:00:03.000Z");
  assert.equal(inspection.modelCalls[0]?.completedAt, "2026-06-15T08:00:05.000Z");
  assert.equal(inspection.modelCalls[0]?.input.fullInput, "Runtime Context:\n...\nUser Message:\nCan you confirm the HR smoke?");
  assert.equal(inspection.modelCalls[0]?.output.finalText, "Confirmed.");
  assert.deepEqual(inspection.modelCalls[0]?.output.sourceEventIds, ["event-4", "event-5"]);
});
