import assert from "node:assert/strict";
import test from "node:test";
import { chatQueryKeys } from "@/chat/chatQueryKeys";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SessionExplorerSessionSummary, SessionExplorerViewModel, TinyOfficeCurrentSession } from "tinyoffice/frontend-api-contracts";

const currentSession: TinyOfficeCurrentSession = {
  schema: "tinyoffice-current-session",
  version: 1,
  user: { id: "user-xu", displayName: "Xu Ziho" },
  currentCompanyId: "ziho-e-com",
  member: { memberId: "xuziho", displayName: "Xu Ziho", role: "boss" },
  needsInitialization: false,
};

function sessionViewModel(): SessionExplorerViewModel {
  const summary: SessionExplorerSessionSummary = {
    employeeId: "alex",
    displayName: "Alex",
    role: "automation-operations-manager",
    sessionId: "runtime-session-alex",
    sessionDirPath: "database:session_records/runtime-session-alex",
    sceneType: "chat_direct_room",
    chatReturnTarget: { conversationId: "conversation-dm-alex", surface: "direct" },
    transcriptFileCount: 1,
    eventCount: 4,
    userMessageCount: 1,
    assistantMessageCount: 1,
    toolCallCount: 1,
    toolResultCount: 1,
    tokenInputTotal: 120,
    tokenOutputTotal: 40,
    tokenCacheTotal: 10,
    lastUserMessagePreview: "Please inspect the company roster.",
    lastAssistantMessagePreview: "Current members are Alex and Nina.",
    evidenceLinks: [],
  };
  return {
    contract: { name: "session-explorer", version: 1, runtimeBoundary: "runtime-session-inspector" },
    routes: {
      indexJsonPath: "/api/companies/ziho-e-com/sessions/view-model",
      detailJsonPath: "/api/companies/ziho-e-com/sessions/view-model",
      viewModelJsonPath: "/api/companies/ziho-e-com/sessions/view-model",
    },
    refresh: {
      strategy: "runtime-events",
      snapshotUses: ["initial-load"],
      eventSources: ["session"],
      expectsRunningSessions: true,
      expectsIncrementalDetailEvents: true,
    },
    filters: { query: "", employeeIdFilter: "" },
    index: { generatedAt: "2026-07-06T00:00:00.000Z", employeeCount: 1, sessionCount: 1, sessions: [summary] },
    selectedSession: { employeeId: "alex", sessionId: "runtime-session-alex" },
    list: { mode: "employee_grouped", sessions: [summary], queryMatchedSessionCount: 1, employeeFilters: [] },
    sections: [],
    detail: {
      summary,
      overview: {
        status: "completed",
        surface: "chat_direct_room",
        turns: 1,
        messages: { user: 1, employee: 1 },
        modelCalls: 1,
        tools: 1,
        usage: { inputTokens: 120, outputTokens: 40, cacheTokens: 10 },
      },
      runtimeTurns: [{
        turnId: "turn-1",
        index: 1,
        modelCallId: "model-call-1",
        usage: { inputTokens: 120, outputTokens: 40, cacheTokens: 10 },
        triggerMessage: {
          label: "Trigger message",
          text: "Please inspect the company roster.",
          timestamp: "2026-07-06T00:00:00.000Z",
          source: "session_events",
        },
        inputPackage: {
          turnId: "turn-1",
          modelCallId: "model-call-1",
          createdAt: "2026-07-06T00:00:00.000Z",
          employeeId: "alex",
          sceneType: "chat_direct_room",
          triggerMessage: "Please inspect the company roster.",
          userMessage: "Please inspect the company roster.",
          systemPrompt: "System prompt",
          runtimePrompt: "Runtime prompt",
          runtimeContext: "Current company context.",
          promptBlocks: [{ id: "scene", content: "Direct message scene.", sha256: "hash-scene" }],
          contextBlocks: [{ role: "system", source: "runtime", label: "Runtime Context", text: "Current company context." }],
          employeeInstructions: [],
          tools: ["tinyoffice_capability_call"],
          skills: ["work-creator"],
          cacheEvidence: {},
        },
        activity: {
          items: [{
            id: "activity:tool:tool-call-1",
            kind: "tool_call",
            title: "Model tool call",
            details: "tinyoffice_capability_call completed",
            raw: {
              eventIds: ["trace-tool-1"],
              events: [{
                id: "trace-tool-1",
                timestamp: "2026-07-06T00:00:00.000Z",
                kind: "model_tool_call",
                sessionKey: "alex|chat_direct_room|room-1",
                employeeId: "alex",
                title: "Model tool call",
                summary: "tinyoffice_capability_call completed",
                status: "succeeded",
              }],
            },
          }],
        },
        outputMessage: {
          label: "Output message",
          text: "Current members are Alex and Nina.",
          timestamp: "2026-07-06T00:00:01.000Z",
          source: "session_events",
        },
      }],
      conversationTurns: [{
        turnId: "turn-1",
        index: 0,
        usage: { inputTokens: 120, outputTokens: 40, cacheTokens: 10 },
        userMessage: { text: "Please inspect the company roster.", timestamp: "2026-07-06T00:00:00.000Z" },
        employeeReply: { text: "Current members are Alex and Nina.", timestamp: "2026-07-06T00:00:01.000Z" },
        toolCalls: [{ name: "tinyoffice_capability_call", summary: "company.member.directory.list" }],
      }],
      promptInputPackages: [{
        turnId: "turn-1",
        modelCallId: "model-call-1",
        createdAt: "2026-07-06T00:00:00.000Z",
        employeeId: "alex",
        sceneType: "chat_direct_room",
        triggerMessage: "Please inspect the company roster.",
        userMessage: "Please inspect the company roster.",
        systemPrompt: "System prompt",
        runtimePrompt: "Runtime prompt",
        runtimeContext: "Current company context.",
        promptBlocks: [{ id: "scene", content: "Direct message scene.", sha256: "hash-scene" }],
        contextBlocks: [{ role: "system", source: "runtime", label: "Runtime Context", text: "Current company context." }],
        employeeInstructions: [],
        tools: ["tinyoffice_capability_call"],
        skills: ["work-creator"],
        cacheEvidence: {},
      }],
      workDone: { toolCalls: [], toolResults: [], actions: [], artifacts: [] },
      usage: { total: { inputTokens: 120, outputTokens: 40, cacheTokens: 10 }, byTurn: [] },
      rawEvidence: { sessionEventCount: 2, processTraceEventCount: 2, collaborationActionEventCount: 0, rawEventCount: 4, sources: [], diagnostics: [] },
      transcriptFiles: [],
      events: [],
      aiCallTranscript: { turns: [], rawEventCount: 0 },
      runtimeInspection: { schema: "runtime-session-inspection", version: 1, sessionId: "runtime-session-alex", status: "recorded", facts: [], sources: [] },
      actionSummary: { items: ["tinyoffice_capability_call completed"], sourceEventCount: 1 },
      sections: [],
    },
  };
}

test("renders Sessions as a dense evidence inspector", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { SessionsPage } = await import("./SessionsPage");
  const queryClient = new QueryClient();
  queryClient.setQueryData(
    chatQueryKeys.sessions("ziho-e-com", { employeeId: "alex", sessionId: "runtime-session-alex", query: "", employeeIdFilter: "alex" }),
    sessionViewModel(),
  );

  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <SessionsPage
        currentSession={currentSession}
        focus={{ employeeId: "alex", sessionId: "runtime-session-alex" }}
        onOpenChatTarget={() => {}}
      />
    </QueryClientProvider>,
  );

  assert.match(html, /Back to session list/);
  assert.match(html, /href="\/sessions\?employeeId=alex"/);
  assert.match(html, /Open related chat/);
  assert.doesNotMatch(html, /Refresh sessions/);
  assert.match(html, /Session summary/);
  assert.match(html, /Runtime turns/);
  assert.doesNotMatch(html, /Open turn/);
  assert.match(html, /Trigger message/);
  assert.match(html, /Prompt input/);
  assert.doesNotMatch(html, /Open prompt input/);
  assert.match(html, /Tools and skills/);
  assert.doesNotMatch(html, /Open tools and skills/);
  assert.match(html, /tinyoffice_capability_call/);
  assert.match(html, /work-creator/);
  assert.match(html, /lucide-chevron-down/);
  assert.match(html, /Activity/);
  assert.match(html, /Output message/);
  assert.doesNotMatch(html, /User message/);
  assert.doesNotMatch(html, /Input package/);
  assert.doesNotMatch(html, /Work trace/);
  assert.match(html, /170 tokens/);
  assert.doesNotMatch(html, /Model calls/);
  assert.doesNotMatch(html, /Tool calls/);
  assert.doesNotMatch(html, /Runtime metadata/);
  assert.doesNotMatch(html, /Evidence counts/);
  assert.doesNotMatch(html, /Workspace/);
  assert.doesNotMatch(html, /Inspector/);
});

test("renders a source return action when a Session was opened from another surface", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { SessionsPage } = await import("./SessionsPage");
  const queryClient = new QueryClient();
  queryClient.setQueryData(
    chatQueryKeys.sessions("ziho-e-com", { employeeId: "alex", sessionId: "runtime-session-alex", query: "", employeeIdFilter: "alex" }),
    sessionViewModel(),
  );

  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <SessionsPage
        currentSession={currentSession}
        focus={{ employeeId: "alex", sessionId: "runtime-session-alex" }}
        returnContext={{ label: "Back to Alex DM", target: { kind: "chat-room", roomId: "conversation-dm-alex", surface: "direct" } }}
        onOpenNavigationTarget={() => {}}
      />
    </QueryClientProvider>,
  );

  assert.match(html, /Back to Alex DM/);
  assert.match(html, /href="\/chat\?roomId=conversation-dm-alex&amp;surface=direct"/);
  assert.doesNotMatch(html, /Back to session list/);
  assert.doesNotMatch(html, /Open related chat/);
});

test("renders Activity as a scrollable collapsed section", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { SessionsPage } = await import("./SessionsPage");
  const queryClient = new QueryClient();
  const model = sessionViewModel();
  model.detail!.runtimeTurns[0].activity.items = Array.from({ length: 24 }, (_, index) => ({
    id: `activity:thinking:${index + 1}`,
    kind: "thinking",
    title: "Thinking",
    details: `Reasoning chunk ${index + 1}`,
    raw: {
      eventIds: [`trace-thinking-${index + 1}`],
      events: [{
        id: `trace-thinking-${index + 1}`,
        timestamp: "2026-07-06T00:00:00.000Z",
        kind: "model_reasoning_observed",
        sessionKey: "alex|chat_direct_room|room-1",
        employeeId: "alex",
        title: "Thinking",
        summary: `Reasoning chunk ${index + 1}`,
        status: "running",
      }],
    },
  }));
  queryClient.setQueryData(
    chatQueryKeys.sessions("ziho-e-com", { employeeId: "alex", sessionId: "runtime-session-alex", query: "", employeeIdFilter: "alex" }),
    model,
  );

  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <SessionsPage
        currentSession={currentSession}
        focus={{ employeeId: "alex", sessionId: "runtime-session-alex" }}
        onOpenChatTarget={() => {}}
      />
    </QueryClientProvider>,
  );

  assert.doesNotMatch(html, /Open activity/);
  assert.match(html, /<strong>24<\/strong><span>activities<\/span>/);
  assert.doesNotMatch(html, /max-h-\[360px\]/);
  assert.match(html, /Reasoning chunk 24/);
});

test("keeps session list columns visible when previews are long", async () => {
  (globalThis as typeof globalThis & { React: typeof React }).React = React;
  const { SessionsPage } = await import("./SessionsPage");
  const queryClient = new QueryClient();
  const model = sessionViewModel();
  const longPreview = "This is a very long employee output preview that should not push the scene and last active columns outside the visible session list table.";
  model.selectedSession = null;
  model.detail = undefined;
  model.filters = { query: "", employeeIdFilter: "alex" };
  model.list = {
    ...model.list,
    employeeFilters: [{ employeeId: "alex", displayName: "Alex", count: 2 }],
    sessions: [
      {
        ...model.list.sessions[0],
        sessionId: "runtime-session-alex-direct",
        sceneType: "chat_direct_room",
        lastAssistantMessagePreview: longPreview,
        lastActivityAt: "2026-07-06T15:46:48.000Z",
      },
      {
        ...model.list.sessions[0],
        sessionId: "runtime-session-alex-channel",
        sceneType: "chat_topic_room",
        lastAssistantMessagePreview: longPreview,
        lastActivityAt: "2026-07-06T15:46:48.000Z",
      },
    ],
  };

  queryClient.setQueryData(
    chatQueryKeys.sessions("ziho-e-com", { employeeId: "alex", sessionId: undefined, query: "", employeeIdFilter: "alex" }),
    model,
  );

  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <SessionsPage
        currentSession={currentSession}
        focus={{ employeeId: "alex" }}
        onOpenChatTarget={() => {}}
      />
    </QueryClientProvider>,
  );

  assert.match(html, /table-fixed/);
  assert.match(html, /max-w-0/);
  assert.match(html, /w-\[132px\]/);
  assert.match(html, /w-\[112px\]/);
  assert.match(html, /w-\[178px\]/);
  assert.match(html, /170 tokens/);
  assert.match(html, /46:48/);
  assert.match(html, /People/);
  assert.match(html, /href="\/sessions\?employeeId=alex&amp;sessionId=runtime-session-alex-direct"/);
  assert.match(html, /Scene/);
  assert.match(html, /Time/);
  assert.doesNotMatch(html, /Status/);
  assert.ok(html.indexOf(">Preview<") > html.indexOf(">Last active<"));
});

test("keeps previous session data while backend filters refetch", async () => {
  const { sessionQueryPlaceholderData } = await import("./SessionsPage");
  const previous = sessionViewModel();

  assert.equal(sessionQueryPlaceholderData(previous), previous);
  assert.equal(sessionQueryPlaceholderData(undefined), undefined);
});
