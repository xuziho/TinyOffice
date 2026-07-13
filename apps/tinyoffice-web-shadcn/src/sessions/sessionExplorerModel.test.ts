import assert from "node:assert/strict";
import test from "node:test";

import type {
  SessionExplorerPromptInputPackage,
  SessionExplorerSessionSummary,
  SessionExplorerViewModel,
} from "tinyoffice/frontend-api-contracts";
import {
  chatReturnTargetForSession,
  inputPackageReadableFacts,
  sessionListPresentation,
  selectedSessionFor,
  sessionPreview,
  sessionSceneLabel,
  visibleSessionsFor,
} from "./sessionExplorerModel";

function session(input: Partial<SessionExplorerSessionSummary>): SessionExplorerSessionSummary {
  return {
    employeeId: "alex",
    displayName: "Alex",
    role: "automation-operations-manager",
    sessionId: "runtime-session-alex",
    sessionDirPath: "database:session_records/runtime-session-alex",
    sceneType: "chat_direct_room",
    transcriptFileCount: 0,
    eventCount: 2,
    userMessageCount: 1,
    assistantMessageCount: 1,
    toolCallCount: 0,
    toolResultCount: 0,
    tokenInputTotal: 100,
    tokenOutputTotal: 50,
    tokenCacheTotal: 0,
    evidenceLinks: [],
    ...input,
  };
}

function viewModel(input: Partial<SessionExplorerViewModel> = {}): SessionExplorerViewModel {
  const sessions = input.list?.sessions ?? [
    session({ sessionId: "runtime-session-alex", employeeId: "alex", displayName: "Alex" }),
    session({ sessionId: "runtime-session-nina", employeeId: "nina", displayName: "Nina" }),
  ];
  return {
    contract: { name: "session-explorer", version: 1, runtimeBoundary: "runtime-session-inspector" },
    routes: {
      indexJsonPath: "/api/companies/ziho-e-com/sessions/view-model",
      detailJsonPath: "/api/companies/ziho-e-com/sessions/view-model",
      viewModelJsonPath: "/api/companies/ziho-e-com/sessions/view-model",
    },
    refresh: {
      strategy: "runtime-events",
      snapshotUses: ["initial-load", "manual-refresh", "reconnect-reconciliation"],
      eventSources: ["session", "employee", "process_trace"],
      expectsRunningSessions: true,
      expectsIncrementalDetailEvents: true,
    },
    filters: { query: "", employeeIdFilter: "" },
    index: {
      generatedAt: "2026-07-06T00:00:00.000Z",
      employeeCount: 2,
      sessionCount: sessions.length,
      sessions,
    },
    selectedSession: null,
    list: {
      mode: "employee_grouped",
      sessions,
      queryMatchedSessionCount: sessions.length,
      employeeFilters: [],
    },
    sections: [],
    detail: undefined,
    ...input,
  };
}

test("selects explicit detail before falling back to the first visible session", () => {
  const model = viewModel({
    selectedSession: { employeeId: "nina", sessionId: "runtime-session-nina" },
    detail: {
      summary: session({ sessionId: "runtime-session-nina", employeeId: "nina", displayName: "Nina" }),
      overview: {
        status: "completed",
        surface: "chat_direct_room",
        turns: 1,
        messages: { user: 1, employee: 1 },
        modelCalls: 1,
        tools: 0,
        usage: { inputTokens: 100, outputTokens: 50, cacheTokens: 0 },
      },
      runtimeTurns: [],
      conversationTurns: [],
      promptInputPackages: [],
      workDone: { toolCalls: [], toolResults: [], actions: [], artifacts: [] },
      usage: { total: { inputTokens: 100, outputTokens: 50, cacheTokens: 0 }, byTurn: [] },
      rawEvidence: { sessionEventCount: 0, processTraceEventCount: 0, collaborationActionEventCount: 0, rawEventCount: 0, sources: [], diagnostics: [] },
      transcriptFiles: [],
      events: [],
      aiCallTranscript: { turns: [], rawEventCount: 0 },
      runtimeInspection: { schema: "runtime-session-inspection", version: 1, sessionId: "runtime-session-nina", status: "recorded", facts: [], sources: [] },
      actionSummary: { items: [], sourceEventCount: 0 },
      sections: [],
    },
  });

  assert.equal(selectedSessionFor(model)?.sessionId, "runtime-session-nina");
  assert.equal(selectedSessionFor(viewModel())?.sessionId, "runtime-session-alex");
});

test("filters visible sessions by employee and query", () => {
  const model = viewModel({
    filters: { query: "handoff", employeeIdFilter: "nina" },
    list: {
      mode: "employee_grouped",
      employeeFilters: [],
      queryMatchedSessionCount: 2,
      sessions: [
        session({ employeeId: "alex", displayName: "Alex", lastUserMessagePreview: "Please inspect the queue." }),
        session({ employeeId: "nina", displayName: "Nina", lastUserMessagePreview: "Please handoff the report." }),
      ],
    },
  });

  assert.deepEqual(visibleSessionsFor(model).map((item) => item.displayName), ["Nina"]);
});

test("filters visible sessions by scene and relative time", () => {
  const model = viewModel({
    filters: { query: "", employeeIdFilter: "nina" },
    list: {
      mode: "employee_grouped",
      employeeFilters: [],
      queryMatchedSessionCount: 4,
      sessions: [
        session({
          sessionId: "nina-channel-recent",
          employeeId: "nina",
          displayName: "Nina",
          sceneType: "chat_topic_room",
          lastActivityAt: "2026-07-05T12:00:00.000Z",
        }),
        session({
          sessionId: "nina-direct-recent",
          employeeId: "nina",
          displayName: "Nina",
          sceneType: "chat_direct_room",
          lastActivityAt: "2026-07-05T12:00:00.000Z",
        }),
        session({
          sessionId: "alex-channel-recent",
          employeeId: "alex",
          displayName: "Alex",
          sceneType: "chat_topic_room",
          lastActivityAt: "2026-07-05T12:00:00.000Z",
        }),
        session({
          sessionId: "nina-channel-old",
          employeeId: "nina",
          displayName: "Nina",
          sceneType: "chat_topic_room",
          lastActivityAt: "2026-07-01T12:00:00.000Z",
        }),
      ],
    },
  });

  assert.deepEqual(
    visibleSessionsFor(model, {
      sceneFilter: "channel",
      timeFilter: "3d",
      now: new Date("2026-07-06T12:00:00.000Z"),
    }).map((item) => item.sessionId),
    ["nina-channel-recent"],
  );
});

test("formats session preview and scene labels for product rows", () => {
  assert.equal(sessionPreview(session({ lastUserMessagePreview: "User asked first.", lastAssistantMessagePreview: "Assistant answered." })), "Assistant answered.");
  assert.equal(sessionPreview(session({ lastAssistantMessagePreview: "Assistant answered." })), "Assistant answered.");
  assert.equal(sessionSceneLabel("chat_topic_room"), "Channel topic");
  assert.equal(sessionSceneLabel("work_run_execution"), "Work run");
});

test("productizes Session list previews while keeping raw evidence out of the list", () => {
  assert.equal(sessionPreview(session({
    sceneType: "intake_event",
    lastAssistantMessagePreview: "Created WorkTask `work-task-123` for Avery.",
  })), "External input created a background Task.");
  assert.equal(sessionPreview(session({
    sceneType: "work_run_execution",
    lastAssistantMessagePreview: "Blocked: waiting for API access.",
  })), "Background Task is waiting for input or access.");
  assert.equal(sessionPreview(session({
    sceneType: "chat_direct_room",
    lastAssistantMessagePreview: "Confirmed Work created and started immediately. WorkTask: `work-task-123`.",
  })), "Background Task created from this conversation.");
  assert.equal(sessionPreview(session({
    sceneType: "chat_direct_room",
    lastAssistantMessagePreview: "Reviewed WorkRun `work-run-123` and recorded the result.",
  })), "Reviewed Task and recorded the result.");
});

test("exposes explicit Chat return targets only for Chat sessions", () => {
  assert.deepEqual(
    chatReturnTargetForSession(session({
      sessionKey: "alex|chat_direct_room|conversation-dm-alex",
      sceneType: "chat_direct_room",
      chatReturnTarget: { conversationId: "conversation-dm-alex", surface: "direct" },
    })),
    { conversationId: "conversation-dm-alex", surface: "direct" },
  );
  assert.deepEqual(
    chatReturnTargetForSession(session({
      sessionKey: "nina|chat_topic_room|conversation-topic-1",
      sceneType: "chat_topic_room",
      chatReturnTarget: { conversationId: "conversation-topic-1", surface: "channel" },
    })),
    { conversationId: "conversation-topic-1", surface: "channel" },
  );
  assert.equal(
    chatReturnTargetForSession(session({
      sessionKey: "alex|work_run_execution|run-1",
      sceneType: "work_run_execution",
    })),
    undefined,
  );
});

test("expands input package prompt and context blocks while omitting debug identifiers", () => {
  const prompt: SessionExplorerPromptInputPackage = {
    turnId: "turn-1",
    modelCallId: "model-call-debug-id",
    employeeId: "nina",
    systemPrompt: "System guardrails.",
    runtimePrompt: "Runtime wrapper.",
    runtimeContext: "Reachable participants: Alex and Xu Ziho.",
    contextBlocks: [
      {
        role: "system",
        source: "chat",
        label: "Owned Chat room context",
        text: "Latest raw messages:\n- Xu Ziho: please count in order\n- Alex: 1",
      },
    ],
    triggerMessage: "Alex: 1",
    userMessage: "Alex: 1",
    promptBlocks: [
      {
        id: "channel-scene",
        sha256: "prompt-block-debug-hash",
        content: "Channel scene instructions.",
      },
    ],
    employeeInstructions: [],
    tools: ["handoff_topic_turn"],
    skills: [],
    cacheEvidence: {
      fullInputSha256: "full-input-debug-hash",
    },
  };

  const facts = inputPackageReadableFacts(prompt);
  const visibleText = facts
    .filter((fact) => fact.group !== "Diagnostics")
    .map((fact) => `${fact.label}\n${fact.value}`)
    .join("\n");
  const diagnosticText = facts
    .filter((fact) => fact.group === "Diagnostics")
    .map((fact) => `${fact.label}\n${fact.value}`)
    .join("\n");

  assert.match(visibleText, /Channel scene instructions\./);
  assert.match(visibleText, /Latest raw messages:/);
  assert.match(visibleText, /Xu Ziho: please count in order/);
  assert.doesNotMatch(visibleText, /model-call-debug-id/);
  assert.doesNotMatch(visibleText, /full-input-debug-hash/);
  assert.doesNotMatch(visibleText, /prompt-block-debug-hash/);
  assert.match(diagnosticText, /fullInputSha256: full-input-debug-hash/);
  assert.deepEqual(facts.map((fact) => `${fact.group}:${fact.label}`), [
    "Prompt input:System",
    "Prompt input:Runtime prompt",
    "Prompt input:Prompt block: channel-scene",
    "Context input:Runtime context",
    "Context input:Context block: Owned Chat room context",
    "Tools and skills:Tools",
    "Diagnostics:Input hashes",
  ]);
});

test("keeps trigger messages outside prompt input facts because the turn already shows them", () => {
  const prompt: SessionExplorerPromptInputPackage = {
    turnId: "turn-1",
    modelCallId: "model-call-1",
    employeeId: "alex",
    systemPrompt: "System guardrails.",
    runtimePrompt: "Runtime wrapper.",
    runtimeContext: "",
    contextBlocks: [],
    triggerMessage: "Please inspect the roster.",
    userMessage: "Please inspect the roster.",
    promptBlocks: [],
    employeeInstructions: [],
    tools: [],
    skills: [],
    cacheEvidence: {},
  };

  assert.deepEqual(inputPackageReadableFacts(prompt).map((fact) => fact.label), [
    "System",
    "Runtime prompt",
  ]);
});

test("summarizes a filtered session list without repeating invariant employee facts", () => {
  const model = viewModel({
    filters: { query: "", employeeIdFilter: "alex" },
    list: {
      mode: "employee_grouped",
      employeeFilters: [
        { employeeId: "alex", displayName: "Alex", count: 2 },
        { employeeId: "nina", displayName: "Nina", count: 1 },
      ],
      queryMatchedSessionCount: 2,
      sessions: [
        session({
          employeeId: "alex",
          displayName: "Alex",
          role: "automation-operations-manager",
          sceneType: "chat_direct_room",
          lastUserMessagePreview: "First Alex session.",
        }),
        session({
          employeeId: "alex",
          displayName: "Alex",
          role: "automation-operations-manager",
          sceneType: "chat_direct_room",
          lastUserMessagePreview: "Second Alex session.",
        }),
      ],
    },
  });

  const presentation = sessionListPresentation(model, visibleSessionsFor(model));

  assert.equal(presentation.title, "Alex sessions");
  assert.equal(presentation.subtitle, "2 sessions");
  assert.equal(presentation.showEmployeeColumn, false);
  assert.equal(presentation.showSceneColumn, false);
});

test("keeps employee and scene columns only when they differentiate mixed session rows", () => {
  const model = viewModel({
    filters: { query: "", employeeIdFilter: "" },
    list: {
      mode: "employee_grouped",
      employeeFilters: [],
      queryMatchedSessionCount: 2,
      sessions: [
        session({
          employeeId: "alex",
          displayName: "Alex",
          sceneType: "chat_direct_room",
          lastUserMessagePreview: "Direct message.",
        }),
        session({
          employeeId: "nina",
          displayName: "Nina",
          sceneType: "chat_topic_room",
          lastUserMessagePreview: "Channel handoff.",
        }),
      ],
    },
  });

  const presentation = sessionListPresentation(model, visibleSessionsFor(model));

  assert.equal(presentation.title, "Runtime sessions");
  assert.equal(presentation.subtitle, "2 sessions");
  assert.equal(presentation.showEmployeeColumn, true);
  assert.equal(presentation.showSceneColumn, true);
});
