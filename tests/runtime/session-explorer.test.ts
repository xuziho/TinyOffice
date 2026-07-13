import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { beforeEach } from "node:test";

import { assertNoForbiddenPublicCarrierFields } from "../../src/collaboration/contracts/conversation-message-contract.js";
import { CompanyDirectoryRepository } from "../../src/runtime/company-config/company-directory-repository.js";
import { createCompany } from "../../src/runtime/company-config/companies-admin.js";
import { DEFAULT_COMPANY_ID } from "../../src/runtime/company-config/postgres-schema.js";
import {
  loadDatabaseSessionExplorerIndex,
  loadDatabaseSessionExplorerViewModel,
  loadDatabaseSessionExplorerSessionDetail,
} from "../../src/runtime/pi/session-explorer.js";
import { buildSessionExplorerViewModel } from "../../src/runtime/pi/session-explorer-view-model.js";
import { RuntimeSessionRepository } from "../../src/runtime/storage/runtime-session-repository.js";
import { resetRuntimePostgresTables } from "./postgres-test-utils.js";

beforeEach(resetRuntimePostgresTables);

const TEST_COMPANY_ID = DEFAULT_COMPANY_ID;


async function seedRuntimeSession(repoRoot: string) {
  const directoryRepository = await CompanyDirectoryRepository.open(repoRoot, {
    companyId: TEST_COMPANY_ID,
  });
  await directoryRepository.upsertEmployee({
    employeeId: "nora-automation",
    enabled: true,
    profile: {
      employeeId: "nora-automation",
      role: "automation_lead",
      displayName: "Nora",
      presenceMode: "resident",
      mountedActions: ["finish_intake_turn", "finish_intake_turn"],
    },
    permissions: [],
    runtime: {
      version: 1,
      modelProvider: "openai",
      modelId: "gpt-5-mini",
      thinkingLevel: "minimal",
    },
  });
  await directoryRepository.save();
  directoryRepository.close();

  const runtimeRepository = await RuntimeSessionRepository.open(repoRoot, { companyId: TEST_COMPANY_ID });
  runtimeRepository.upsertSessionRecord({
    id: "session-record-1",
    employeeId: "nora-automation",
    sessionKey: "nora-automation|channel_thread|thread-123",
    sessionId: "pi-session-1",
    sceneType: "channel_thread",
    channelTopicId: "channel-topic-123",
    requesterId: "requester-admin",
    modelProvider: "openai",
    modelId: "gpt-5-mini",
    runtimeMetadata: {
      cwd: {
        state: "recorded",
        value: "C:\\Users\\Xu\\workspace\\nora-automation",
        source: "employee.workspacePath",
      },
      tools: {
        state: "recorded",
        source: "natural_language_response_input",
        loadedToolNames: ["finish_intake_turn", "finish_intake_turn"],
        activeToolNames: ["finish_intake_turn"],
      },
    },
    status: "completed",
    startedAt: "2026-06-09T12:00:00.000Z",
    updatedAt: "2026-06-09T12:01:00.000Z",
    tokenInputTotal: 100,
    tokenOutputTotal: 40,
    tokenCacheTotal: 12,
  });
  runtimeRepository.appendSessionEvent({
    id: "event-1",
    sessionRecordId: "session-record-1",
    sequence: 1,
    timestamp: "2026-06-09T12:00:00.000Z",
    kind: "user_message",
    role: "user",
    preview: "Please summarize today's automation items.",
  });
  runtimeRepository.appendSessionEvent({
    id: "event-2",
    sessionRecordId: "session-record-1",
    sequence: 2,
    timestamp: "2026-06-09T12:01:00.000Z",
    kind: "assistant_message",
    role: "assistant",
    preview: "I will check the queue and list blockers.",
  });
  runtimeRepository.appendSessionEvent({
    id: "event-3",
    sessionRecordId: "session-record-1",
    sequence: 3,
    timestamp: "2026-06-09T12:00:30.000Z",
    kind: "prompt_input_package",
    role: "user",
    source: "tinyoffice.prompt_input_package",
    visibility: "model_input",
    semanticRole: "prompt_input_package",
    rawEventKind: "prompt_input_package",
    title: "Sent to AI",
    summary: "Runtime prompt for automation items.",
    preview: "Runtime prompt for automation items.",
    payload: {
      source: "tinyoffice_prompt_input_package",
      employeeId: "nora-automation",
      sessionKey: "nora-automation|channel_thread|thread-123",
      sceneType: "channel_thread",
      createdAt: "2026-06-09T12:00:30.000Z",
      systemPrompt: {
        text: "You are employee nora-automation.\nIdentity: Nora.",
        sha256: "system-hash",
      },
      runtimePrompt: {
        userPrompt: [
          "Runtime Context:",
          "Scene: channel_thread",
          "",
          "Channel Thread Context:",
          "Thread summary: automation queue review.",
          "",
          "User Message:",
          "Please summarize today's automation items.",
        ].join("\n"),
        sha256: "runtime-hash",
      },
      userMessage: {
        text: "Please summarize today's automation items.",
        sha256: "user-message-hash",
      },
      promptBlocks: [{
        id: "collaboration",
        sha256: "def456",
        content: "Company collaboration policy.",
      }],
      employeeInstructions: [{
        path: "C:\\Users\\Xu\\workspace\\nora-automation\\AGENTS.md",
        sha256: "employee-instruction-hash",
        content: "Nora should answer with operational evidence.",
      }],
      contextBlocks: [{
        role: "channel_thread_context",
        source: "owned_chat.channel_topic_context",
        label: "Channel Thread Context",
        text: "Thread summary: automation queue review.",
      }],
      tools: [{ name: "finish_intake_turn" }],
      skills: [{ name: "skill-creator" }],
      cacheEvidence: {
        fullInputSha256: "full-input-hash",
        stablePrefixSha256: "stable-prefix-hash",
        estimatedStablePrefixChars: 128,
      },
    },
  });
  runtimeRepository.appendSessionEvent({
    id: "event-4",
    sessionRecordId: "session-record-1",
    sequence: 4,
    timestamp: "2026-06-09T12:01:01.000Z",
    kind: "message_start",
    role: "user",
    summary: "Context:\nScene: channel_thread\n\nMessage:\nPlease summarize today's automation items.",
    preview: "Context:\nScene: channel_thread\n\nMessage:\nPlease summarize today's automation items.",
  });
  runtimeRepository.appendSessionEvent({
    id: "event-6",
    sessionRecordId: "session-record-1",
    sequence: 6,
    timestamp: "2026-06-09T12:01:02.000Z",
    kind: "message_end",
    role: "user",
    summary: "Context:\nScene: channel_thread\n\nMessage:\nPlease summarize today's automation items.",
    preview: "Context:\nScene: channel_thread\n\nMessage:\nPlease summarize today's automation items.",
  });
  runtimeRepository.appendProcessTraceEvent({
    id: "trace-owned-1",
    timestamp: "2026-06-09T12:00:45.000Z",
    kind: "turn_received",
    sessionKey: "nora-automation|channel_thread|thread-123",
    channelTopicId: "channel-topic-123",
    employeeId: "nora-automation",
    title: "Turn received",
    status: "running",
    metadata: {
      conversationId: "conversation-automation-1",
      messageId: "message-automation-1",
      chatEntryId: "chat-entry-automation-1",
    },
  });
  await runtimeRepository.save();
  runtimeRepository.close();
}

test("session explorer reads runtime sessions from the company database", async () => {
  const repoRoot = await mkdtemp(
    path.join(tmpdir(), "tinyoffice-session-explorer-db-"),
  );
  await seedRuntimeSession(repoRoot);

  const index = await loadDatabaseSessionExplorerIndex(repoRoot, TEST_COMPANY_ID);

  assert.ok(index.employeeCount >= 1);
  assert.equal(index.sessionCount, 1);
  assert.equal(index.sessions[0]?.employeeId, "nora-automation");
  assert.equal(index.sessions[0]?.displayName, "Nora");
  assert.equal(index.sessions[0]?.role, "automation_lead");
  assert.deepEqual(index.sessions[0]?.evidenceLinks.map((link) => [link.kind, link.targetId]), [
    ["session", "session-record-1"],
    ["process_trace", "trace-owned-1"],
  ]);
  assert.equal(index.sessions[0]?.sessionId, "session-record-1");
  assert.equal(index.sessions[0]?.sessionKey, "nora-automation|channel_thread|thread-123");
  assert.deepEqual(index.sessions[0]?.chatReturnTarget, {
    conversationId: "thread-123",
    surface: "channel",
  });
  assert.equal("rootPostId" in index.sessions[0]!, false);
  assert.equal("channelTopicId" in index.sessions[0]!, false);
  assertNoForbiddenPublicCarrierFields(index);
  assert.doesNotMatch(JSON.stringify(index), /\brootPostId\b/);
  assert.equal(index.sessions[0]?.eventCount, 5);
  assert.equal(index.sessions[0]?.startedAt, "2026-06-09T12:00:00.000Z");
  assert.equal(index.sessions[0]?.lastActivityAt, "2026-06-09T12:01:00.000Z");
  assert.equal(index.sessions[0]?.sessionDirPath, "database:session_records/session-record-1");
  assert.equal(index.sessions[0]?.cwd, "C:\\Users\\Xu\\workspace\\nora-automation");
  assert.equal(index.sessions[0]?.lastUserMessagePreview, "Please summarize today's automation items.");
  assert.equal(index.sessions[0]?.lastAssistantMessagePreview, "I will check the queue and list blockers.");

  const detail = await loadDatabaseSessionExplorerSessionDetail({
    repoRoot,
    companyId: TEST_COMPANY_ID,
    employeeId: "nora-automation",
    sessionId: "session-record-1",
  });

  assert.ok(detail);
  assertNoForbiddenPublicCarrierFields(detail);
  assert.doesNotMatch(JSON.stringify(detail), /\brootPostId\b/);
  assert.deepEqual(detail.transcriptFiles, ["database:session_events"]);
  assert.equal(detail.events.length, 5);
  assert.equal(detail.events[0]?.fileName, "database");
  assert.equal(detail.events[0]?.text, "Please summarize today's automation items.");
  assert.equal(detail.promptInputPackages.length, 1);
  assert.equal(detail.promptInputPackages[0]?.systemPrompt, "You are employee nora-automation.\nIdentity: Nora.");
  assert.match(detail.promptInputPackages[0]?.runtimePrompt || "", /User Message:/);
  assert.match(detail.promptInputPackages[0]?.runtimeContext || "", /Scene: channel_thread/);
  assert.equal(Object.prototype.hasOwnProperty.call(detail.promptInputPackages[0] || {}, "completionPolicy"), false);
  assert.equal(detail.promptInputPackages[0]?.contextBlocks[0]?.label, "Channel Thread Context");
  assert.equal(detail.promptInputPackages[0]?.employeeInstructions[0]?.path, "C:\\Users\\Xu\\workspace\\nora-automation\\AGENTS.md");
  assert.deepEqual(detail.promptInputPackages[0]?.tools, ["finish_intake_turn"]);
  assert.deepEqual(detail.promptInputPackages[0]?.skills, ["skill-creator"]);
  assert.equal(detail.promptInputPackages[0]?.cacheEvidence.fullInputSha256, "full-input-hash");
  assert.equal(detail.summary.cwd, "C:\\Users\\Xu\\workspace\\nora-automation");
  assert.deepEqual(detail.summary.chatReturnTarget, {
    conversationId: "thread-123",
    surface: "channel",
  });
  assert.deepEqual(detail.runtimeInspection.runtimeMetadata.tools.activeToolNames, ["finish_intake_turn"]);
  assert.equal(detail.runtimeTurns.length, 1);
  assert.equal(detail.runtimeTurns[0]?.triggerMessage?.label, "Trigger message");
  assert.equal(detail.runtimeTurns[0]?.triggerMessage?.text, "Please summarize today's automation items.");
  assert.equal(detail.runtimeTurns[0]?.inputPackage?.contextBlocks[0]?.label, "Channel Thread Context");
  assert.equal(detail.runtimeTurns[0]?.outputMessage?.text, "I will check the queue and list blockers.");
  assert.deepEqual(detail.runtimeTurns[0]?.activity.items, []);
  const missing = await loadDatabaseSessionExplorerSessionDetail({
    repoRoot,
    companyId: TEST_COMPANY_ID,
    employeeId: "iris-growth",
    sessionId: "session-record-1",
  });
  assert.equal(missing, undefined);
});

test("session explorer preserves history while projecting the current member identity after deactivation", async () => {
  const repoRoot = await mkdtemp(
    path.join(tmpdir(), "tinyoffice-session-explorer-inactive-identity-"),
  );
  await seedRuntimeSession(repoRoot);

  const directoryRepository = await CompanyDirectoryRepository.open(repoRoot, {
    companyId: TEST_COMPANY_ID,
  });
  await directoryRepository.upsertEmployee({
    employeeId: "nora-automation",
    enabled: false,
    profile: {
      employeeId: "nora-automation",
      role: "operations_director",
      displayName: "Nora Operations",
      presenceMode: "resident",
      mountedActions: [],
    },
    permissions: [],
    runtime: {
      version: 1,
      modelProvider: "openai",
      modelId: "gpt-5-mini",
      thinkingLevel: "minimal",
    },
  });
  await directoryRepository.save();
  directoryRepository.close();

  const index = await loadDatabaseSessionExplorerIndex(repoRoot, TEST_COMPANY_ID);

  assert.equal(index.sessionCount, 1);
  assert.equal(index.sessions[0]?.employeeId, "nora-automation");
  assert.equal(index.sessions[0]?.displayName, "Nora Operations");
  assert.equal(index.sessions[0]?.role, "operations_director");
});

test("session explorer only reads sessions for the requested company", async () => {
  const repoRoot = await mkdtemp(
    path.join(tmpdir(), "tinyoffice-session-explorer-company-isolation-"),
  );
  const otherCompanyId = "support-ops";
  await createCompany({
    repoRoot,
    companyId: otherCompanyId,
    displayName: "Support Ops",
  });
  await seedRuntimeSession(repoRoot);

  const otherRuntimeRepository = await RuntimeSessionRepository.open(repoRoot, {
    companyId: otherCompanyId,
  });
  try {
    otherRuntimeRepository.upsertSessionRecord({
      id: "session-record-1",
      employeeId: "nora-automation",
      sessionKey: "nora-automation|channel_thread|thread-123",
      sessionId: "pi-session-other-company",
      sceneType: "channel_thread",
      channelTopicId: "channel-topic-123",
      status: "completed",
      title: "Other company session",
      startedAt: "2026-06-09T13:00:00.000Z",
      updatedAt: "2026-06-09T13:01:00.000Z",
    });
    await otherRuntimeRepository.save();
  } finally {
    otherRuntimeRepository.close();
  }

  const defaultIndex = await loadDatabaseSessionExplorerIndex(repoRoot, TEST_COMPANY_ID);
  const otherIndex = await loadDatabaseSessionExplorerIndex(repoRoot, otherCompanyId);

  assert.deepEqual(defaultIndex.sessions.map((session) => session.sessionId), ["session-record-1"]);
  assert.equal(defaultIndex.sessions[0]?.lastActivityAt, "2026-06-09T12:01:00.000Z");
  assert.deepEqual(otherIndex.sessions.map((session) => session.sessionId), ["session-record-1"]);
  assert.equal(otherIndex.sessions[0]?.lastActivityAt, "2026-06-09T13:01:00.000Z");
});

test("session explorer hides Chat dispatch intent records from the product session list", async () => {
  const repoRoot = await mkdtemp(
    path.join(tmpdir(), "tinyoffice-session-explorer-dispatch-boundary-"),
  );
  await seedRuntimeSession(repoRoot);

  const runtimeRepository = await RuntimeSessionRepository.open(repoRoot, { companyId: TEST_COMPANY_ID });
  runtimeRepository.upsertSessionRecord({
    id: "tinyoffice-chat-session:event-123",
    employeeId: "nora-automation",
    sessionKey: "nora-automation|channel_thread|thread-123",
    sessionId: "tinyoffice-chat-session:event-123",
    sceneType: "channel_thread",
    requesterId: "requester-admin",
    status: "completed",
    title: "nora-automation owned Chat session",
    summary: "Owned Chat dispatch intent recorded from room-123.",
    startedAt: "2026-06-09T11:59:59.000Z",
    updatedAt: "2026-06-09T12:01:01.000Z",
  });
  runtimeRepository.appendSessionEvent({
    id: "tinyoffice-chat-session:event-123|intent:message-123",
    sessionRecordId: "tinyoffice-chat-session:event-123",
    sequence: 1,
    timestamp: "2026-06-09T11:59:59.000Z",
    kind: "owned_chat_execution_intent",
    role: "user",
    sceneId: "nora-automation|channel_thread|thread-123",
    turnId: "nora-automation|channel_thread|thread-123|message-123",
    runId: "tinyoffice-chat-session:event-123",
    source: "tinyoffice.chat_dispatch",
    visibility: "user_visible",
    semanticRole: "user_message",
    rawEventKind: "owned_chat_execution_intent",
    title: "Owned Chat execution intent",
    summary: "Please summarize today's automation items.",
    preview: "Please summarize today's automation items.",
  });
  await runtimeRepository.save();
  runtimeRepository.close();

  const index = await loadDatabaseSessionExplorerIndex(repoRoot, TEST_COMPANY_ID);
  assert.deepEqual(index.sessions.map((session) => session.sessionId), ["session-record-1"]);
  assert.equal(index.sessionCount, 1);

  const viewModel = await loadDatabaseSessionExplorerViewModel({
    repoRoot,
    companyId: TEST_COMPANY_ID,
    employeeId: "nora-automation",
    sessionId: "tinyoffice-chat-session:event-123",
  });
  assert.deepEqual(viewModel.list.sessions.map((session) => session.sessionId), ["session-record-1"]);
  assert.equal(viewModel.detail, undefined);
});

test("session explorer token response count ignores assistant lifecycle events", async () => {
  const repoRoot = await mkdtemp(
    path.join(tmpdir(), "tinyoffice-session-explorer-token-response-count-"),
  );
  await seedRuntimeSession(repoRoot);

  const runtimeRepository = await RuntimeSessionRepository.open(repoRoot, { companyId: TEST_COMPANY_ID });
  runtimeRepository.appendSessionEvent({
    id: "event-5",
    sessionRecordId: "session-record-1",
    sequence: 5,
    timestamp: "2026-06-09T12:01:03.000Z",
    kind: "message_start",
    role: "assistant",
    summary: "Assistant lifecycle event: message_start.",
  });
  runtimeRepository.appendSessionEvent({
    id: "event-7",
    sessionRecordId: "session-record-1",
    sequence: 7,
    timestamp: "2026-06-09T12:01:04.000Z",
    kind: "stream_event",
    role: "assistant",
    summary: "Assistant stream update: text_start.",
  });
  runtimeRepository.appendSessionEvent({
    id: "event-8",
    sessionRecordId: "session-record-1",
    sequence: 8,
    timestamp: "2026-06-09T12:01:05.000Z",
    kind: "turn_end",
    role: "assistant",
    summary: "Assistant lifecycle event: turn_end.",
  });
  await runtimeRepository.save();
  runtimeRepository.close();

  const detail = await loadDatabaseSessionExplorerSessionDetail({
    repoRoot,
    companyId: TEST_COMPANY_ID,
    employeeId: "nora-automation",
    sessionId: "session-record-1",
  });

  assert.ok(detail);
  assert.equal(detail.summary.assistantMessageCount, 1);
  assert.equal(detail.events.filter((event) => event.eventType === "assistant_message").length, 1);
});

test("session explorer assigns Activity items to their own runtime turn", async () => {
  const repoRoot = await mkdtemp(
    path.join(tmpdir(), "tinyoffice-session-explorer-turn-activity-"),
  );
  await seedRuntimeSession(repoRoot);

  const runtimeRepository = await RuntimeSessionRepository.open(repoRoot, { companyId: TEST_COMPANY_ID });
  runtimeRepository.appendSessionEvent({
    id: "event-9",
    sessionRecordId: "session-record-1",
    sequence: 9,
    timestamp: "2026-06-09T12:02:00.000Z",
    kind: "user_message",
    role: "user",
    preview: "Please summarize tomorrow's automation items.",
  });
  runtimeRepository.appendSessionEvent({
    id: "event-10",
    sessionRecordId: "session-record-1",
    sequence: 10,
    timestamp: "2026-06-09T12:03:00.000Z",
    kind: "assistant_message",
    role: "assistant",
    preview: "Tomorrow's automation queue is ready.",
  });
  runtimeRepository.appendProcessTraceEvent({
    id: "trace-thinking-turn-1",
    timestamp: "2026-06-09T12:00:50.000Z",
    kind: "model_reasoning_observed",
    sessionKey: "nora-automation|channel_thread|thread-123",
    channelTopicId: "channel-topic-123",
    employeeId: "nora-automation",
    title: "nora-automation prepared its approach",
    summary: "First turn reasoning.",
    status: "running",
  });
  runtimeRepository.appendProcessTraceEvent({
    id: "trace-thinking-turn-2",
    timestamp: "2026-06-09T12:02:50.000Z",
    kind: "model_reasoning_observed",
    sessionKey: "nora-automation|channel_thread|thread-123",
    channelTopicId: "channel-topic-123",
    employeeId: "nora-automation",
    title: "nora-automation prepared its approach",
    summary: "Second turn reasoning.",
    status: "running",
  });
  await runtimeRepository.save();
  runtimeRepository.close();

  const detail = await loadDatabaseSessionExplorerSessionDetail({
    repoRoot,
    companyId: TEST_COMPANY_ID,
    employeeId: "nora-automation",
    sessionId: "session-record-1",
  });

  assert.ok(detail);
  assert.equal(detail.runtimeTurns.length, 2);
  assert.deepEqual(detail.runtimeTurns[0]?.activity.items.map((item) => item.details), ["First turn reasoning."]);
  assert.deepEqual(detail.runtimeTurns[1]?.activity.items.map((item) => item.details), ["Second turn reasoning."]);
});

test("session explorer action summary deduplicates repeated tool call trace wrappers", async () => {
  const repoRoot = await mkdtemp(
    path.join(tmpdir(), "tinyoffice-session-explorer-dedupe-tool-call-"),
  );
  await seedRuntimeSession(repoRoot);

  const runtimeRepository = await RuntimeSessionRepository.open(repoRoot, { companyId: TEST_COMPANY_ID });
  const baseTrace = {
    sessionKey: "nora-automation|channel_thread|thread-123",
    channelTopicId: "channel-topic-123",
    employeeId: "nora-automation",
    kind: "model_tool_call" as const,
    title: "Nora called webfetch",
  };
  runtimeRepository.appendProcessTraceEvent({
    ...baseTrace,
    id: "trace-empty-running",
    timestamp: "2026-06-09T12:00:01.000Z",
    summary: "{}",
    status: "running",
  });
  runtimeRepository.appendProcessTraceEvent({
    ...baseTrace,
    id: "trace-args-running",
    timestamp: "2026-06-09T12:00:02.000Z",
    summary: "{\"url\":\"https://example.test/article\",\"format\":\"html\"}",
    status: "running",
  });
  runtimeRepository.appendProcessTraceEvent({
    ...baseTrace,
    id: "trace-args-succeeded",
    timestamp: "2026-06-09T12:00:03.000Z",
    summary: "{\"url\":\"https://example.test/article\",\"format\":\"html\"}",
    status: "succeeded",
  });
  runtimeRepository.appendProcessTraceEvent({
    id: "trace-result",
    timestamp: "2026-06-09T12:00:04.000Z",
    sessionKey: "nora-automation|channel_thread|thread-123",
    channelTopicId: "channel-topic-123",
    employeeId: "nora-automation",
    kind: "model_tool_result",
    title: "webfetch returned a result",
    summary: "HTTP 404 Page not found.",
    status: "succeeded",
  });
  await runtimeRepository.save();
  runtimeRepository.close();

  const detail = await loadDatabaseSessionExplorerSessionDetail({
    repoRoot,
    companyId: TEST_COMPANY_ID,
    employeeId: "nora-automation",
    sessionId: "session-record-1",
  });

  assert.ok(detail);
  const toolCallItems = detail.actionSummary.items.filter((item) =>
    item.includes("webfetch") && item.includes("https://example.test/article")
  );
  assert.equal(toolCallItems.length, 1);
  assert.ok(!detail.actionSummary.items.some((item) => item.includes("webfetch") && item.includes("{}")));
  assert.ok(detail.actionSummary.items.some((item) => item.includes("HTTP 404 Page not found")));
});

test("session explorer action summary uses handoff message when assistant event is generic", async () => {
  const repoRoot = await mkdtemp(
    path.join(tmpdir(), "tinyoffice-session-explorer-generic-assistant-"),
  );
  await seedRuntimeSession(repoRoot);

  const runtimeRepository = await RuntimeSessionRepository.open(repoRoot, { companyId: TEST_COMPANY_ID });
  runtimeRepository.appendSessionEvent({
    id: "event-5",
    sessionRecordId: "session-record-1",
    sequence: 5,
    timestamp: "2026-06-09T12:01:03.000Z",
    kind: "assistant_message",
    role: "assistant",
    preview: "Assistant reply",
  });
  runtimeRepository.appendCollaborationActionEvent({
    id: "action-1",
    timestamp: "2026-06-09T12:01:04.000Z",
    employeeId: "nora-automation",
    actionName: "handoff",
    channelTopicId: "channel-topic-123",
    status: "final",
    recipientId: "xuziho",
    message: "@xuziho\n\nI have organized the result.",
    decision: "allowed",
    emitted: true,
  });
  await runtimeRepository.save();
  runtimeRepository.close();

  const detail = await loadDatabaseSessionExplorerSessionDetail({
    repoRoot,
    companyId: TEST_COMPANY_ID,
    employeeId: "nora-automation",
    sessionId: "session-record-1",
  });

  assert.ok(detail);
  assert.ok(detail.actionSummary.items.some((item) => item.includes("@xuziho")));
  assert.ok(!detail.actionSummary.items.includes("Sent reply: Assistant reply"));
});

test("session explorer action summary does not invent a reply for failed generic assistant events", async () => {
  const repoRoot = await mkdtemp(
    path.join(tmpdir(), "tinyoffice-session-explorer-failed-generic-"),
  );
  await seedRuntimeSession(repoRoot);

  const runtimeRepository = await RuntimeSessionRepository.open(repoRoot, { companyId: TEST_COMPANY_ID });
  runtimeRepository.appendSessionEvent({
    id: "event-5",
    sessionRecordId: "session-record-1",
    sequence: 5,
    timestamp: "2026-06-09T12:01:03.000Z",
    kind: "assistant_message",
    role: "assistant",
    preview: "Assistant reply",
  });
  runtimeRepository.appendProcessTraceEvent({
    id: "trace-failed",
    timestamp: "2026-06-09T12:01:04.000Z",
    sessionKey: "nora-automation|channel_thread|thread-123",
    channelTopicId: "channel-topic-123",
    employeeId: "nora-automation",
    kind: "turn_failed",
    title: "nora-automation failed this turn",
    summary: "PI returned an empty reply for nora-automation",
    status: "failed",
  });
  await runtimeRepository.save();
  runtimeRepository.close();

  const detail = await loadDatabaseSessionExplorerSessionDetail({
    repoRoot,
    companyId: TEST_COMPANY_ID,
    employeeId: "nora-automation",
    sessionId: "session-record-1",
  });

  assert.ok(detail);
  assert.ok(detail.actionSummary.items.includes("Turn failed: PI returned an empty reply for nora-automation"));
  assert.ok(!detail.actionSummary.items.some((item) => item.startsWith("Sent reply:")));
});

test("session explorer view model is the frontend JSON contract without HTML semantics", async () => {
  const repoRoot = await mkdtemp(
    path.join(tmpdir(), "tinyoffice-session-explorer-view-model-contract-"),
  );
  await seedRuntimeSession(repoRoot);

  const index = await loadDatabaseSessionExplorerIndex(repoRoot, TEST_COMPANY_ID);
  const detail = await loadDatabaseSessionExplorerSessionDetail({
    repoRoot,
    companyId: TEST_COMPANY_ID,
    employeeId: "nora-automation",
    sessionId: "session-record-1",
  });
  assert.ok(detail);

  const viewModel = buildSessionExplorerViewModel({
    index,
    selectedDetail: detail,
    query: "nora",
    employeeIdFilter: "nora-automation",
    routes: {
      indexJsonPath: "/api/companies/default-company/sessions/view-model",
      detailJsonPath: "/api/companies/default-company/sessions/view-model",
      viewModelJsonPath: "/api/companies/default-company/sessions/view-model",
    },
  });

  assert.equal(viewModel.contract.name, "session-explorer");
  assert.equal(viewModel.contract.version, 1);
  assert.equal(viewModel.contract.runtimeBoundary, "runtime-session-inspector");
  assert.deepEqual(viewModel.refresh, {
    strategy: "runtime-events",
    snapshotUses: ["initial-load", "manual-refresh", "reconnect-reconciliation"],
    eventSources: ["session", "employee", "process_trace"],
    expectsRunningSessions: true,
    expectsIncrementalDetailEvents: true,
  });
  assert.deepEqual(viewModel.filters, {
    query: "nora",
    employeeIdFilter: "nora-automation",
  });
  assert.deepEqual(viewModel.selectedSession, {
    employeeId: "nora-automation",
    sessionId: "session-record-1",
  });
  assert.equal(viewModel.list.mode, "employee_grouped");
  assert.equal(viewModel.list.sessions.length, 1);
  assert.equal(viewModel.list.employeeFilters[0]?.employeeId, "nora-automation");
  assert.equal(viewModel.detail?.summary.sessionId, "session-record-1");
  assert.deepEqual(viewModel.detail?.summary.evidenceLinks.map((link) => [link.kind, link.targetId]), [
    ["session", "session-record-1"],
    ["process_trace", "trace-owned-1"],
  ]);
  assert.deepEqual(viewModel.detail?.sections.map((section) => section.id), [
    "session-overview",
    "runtime-turns",
    "evidence-package",
  ]);
  assert.deepEqual(
    viewModel.detail?.sections.filter((section) => section.defaultOpen).map((section) => section.id),
    ["session-overview", "runtime-turns", "evidence-package"],
  );
  assert.equal(viewModel.detail?.sections.find((section) => section.id === "raw-evidence"), undefined);
  assert.equal(viewModel.routes.viewModelJsonPath, "/api/companies/default-company/sessions/view-model");
  assertNoForbiddenPublicCarrierFields(viewModel);
  assert.doesNotMatch(JSON.stringify(viewModel), /\brootPostId\b/);
  assert.doesNotMatch(
    JSON.stringify(viewModel),
    /<details|<div class=|session-explorer-shell|localStorage|\/console\/sessions|\/api\/console\/sessions|renderSessionExplorerHtml/i,
  );
});

test("session explorer projection public entry stays thin after boundary split", async () => {
  const entrySource = await readFile("src/runtime/pi/session-explorer-projection.ts", "utf8");
  assert.equal(entrySource.split(/\r?\n/).filter(Boolean).length, 5);
  assert.doesNotMatch(entrySource, /function\s+/);

  for (const moduleName of [
    "session-explorer-projection-utils.ts",
    "session-explorer-projection-prompts.ts",
    "session-explorer-projection-transcript.ts",
    "session-explorer-projection-summary.ts",
    "session-explorer-projection-detail.ts",
  ]) {
    const source = await readFile(`src/runtime/pi/${moduleName}`, "utf8");
    assert.match(source, /export function /, `${moduleName} should own projection behavior`);
  }
});
