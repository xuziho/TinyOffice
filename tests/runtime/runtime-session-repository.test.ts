import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { beforeEach } from "node:test";

import {
  DEFAULT_RUNTIME_STORAGE_RETENTION_POLICY,
  RuntimeSessionRepository,
} from "../../src/runtime/storage/runtime-session-repository.js";
import { DEFAULT_COMPANY_ID } from "../../src/runtime/company-config/postgres-schema.js";
import { resetRuntimePostgresTables } from "./postgres-test-utils.js";

beforeEach(resetRuntimePostgresTables);

async function createRepoRoot() {
  return mkdtemp(path.join(tmpdir(), "tinyoffice-runtime-sessions-"));
}

test("runtime session repository stores sessions, events, and retention state", async () => {
  const repoRoot = await createRepoRoot();
  const repository = await RuntimeSessionRepository.open(repoRoot, { companyId: DEFAULT_COMPANY_ID });

  try {
    const session = repository.upsertSessionRecord({
      id: "session-record-1",
      employeeId: "mira-hr",
      sessionKey: "mira-hr|channel_thread|root-1",
      sessionId: "pi-session-1",
      sceneType: "channel_thread",
      channelTopicId: "channel-topic-1",
      workRunId: "work-run-1",
      requesterId: "participant-principal",
      modelProvider: "openai",
      modelId: "gpt-5",
      runtimeMetadata: {
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
      status: "running",
      title: "Mira investigates onboarding",
      summary: "Initial session.",
      startedAt: "2026-06-09T00:00:00.000Z",
      updatedAt: "2026-06-09T00:01:00.000Z",
    });

    assert.equal(session.employeeId, "mira-hr");
    assert.equal(session.eventCount, 0);

    repository.appendSessionEvent({
      id: "session-event-1",
      sessionRecordId: session.id,
      sequence: 1,
      timestamp: "2026-06-09T00:00:01.000Z",
      kind: "user_message",
      role: "user",
      sceneId: "mira-hr|channel_thread|root-1",
      turnId: "mira-hr|channel_thread|root-1|turn",
      runId: "session-record-1",
      modelCallId: "session-record-1|model_call|primary",
      source: "tinyoffice.chat.user_message",
      visibility: "user_visible",
      semanticRole: "user_message",
      rawEventKind: "user_message",
      title: "User message",
      summary: "Please inspect onboarding.",
      preview: "Please inspect onboarding.",
      payload: { text: "Please inspect onboarding." },
      byteSize: 128,
    });
    repository.appendSessionEvent({
      id: "session-event-2",
      sessionRecordId: session.id,
      sequence: 2,
      timestamp: "2026-06-09T00:00:02.000Z",
      kind: "assistant_message",
      role: "assistant",
      title: "Assistant reply",
      summary: "I will inspect it.",
      preview: "I will inspect it.",
      byteSize: 96,
    });
    repository.appendSessionEvent({
      id: "session-event-3",
      sessionRecordId: session.id,
      sequence: 3,
      timestamp: "2026-06-09T00:00:03.000Z",
      kind: "prompt_context",
      role: "user",
      visibility: "prompt_context",
      semanticRole: "work_run_context",
      rawEventKind: "prompt_context",
      title: "WorkRun context",
      preview: "WorkRun package",
      byteSize: 40,
    });
    repository.appendSessionEvent({
      id: "session-event-4",
      sessionRecordId: session.id,
      sequence: 4,
      timestamp: "2026-06-09T00:00:04.000Z",
      kind: "assistant_message",
      role: "assistant",
      visibility: "diagnostic",
      semanticRole: "model_output",
      rawEventKind: "assistant_message",
      title: "Assistant lifecycle wrapper",
      preview: "message_end",
      byteSize: 40,
    });

    const detail = repository.getSessionDetail(session.id);
    assert.equal(detail?.record.eventCount, 4);
    assert.deepEqual(detail?.record.runtimeMetadata?.cwd, {
      state: "recorded",
      value: "C:\\Users\\Xu\\workspace\\mira-hr",
      source: "employee.workspacePath",
    });
    assert.deepEqual(detail?.record.runtimeMetadata?.tools?.activeToolNames, ["finish_intake_turn"]);
    assert.equal(detail?.record.userMessageCount, 1);
    assert.equal(detail?.record.assistantMessageCount, 1);
    assert.deepEqual(detail?.events.map((event) => event.id), [
      "session-event-1",
      "session-event-2",
      "session-event-3",
      "session-event-4",
    ]);
    assert.equal(detail?.events[0]?.sceneId, "mira-hr|channel_thread|root-1");
    assert.equal(detail?.events[0]?.turnId, "mira-hr|channel_thread|root-1|turn");
    assert.equal(detail?.events[0]?.runId, "session-record-1");
    assert.equal(detail?.events[0]?.modelCallId, "session-record-1|model_call|primary");
    assert.equal(detail?.events[0]?.source, "tinyoffice.chat.user_message");
    assert.equal(detail?.events[0]?.visibility, "user_visible");
    assert.equal(detail?.events[0]?.semanticRole, "user_message");
    assert.equal(detail?.events[0]?.rawEventKind, "user_message");

    const byEmployee = repository.listSessionRecords({
      employeeId: "mira-hr",
      limit: 10,
    });
    assert.equal(byEmployee.length, 1);
    assert.equal(byEmployee[0]?.sessionKey, "mira-hr|channel_thread|root-1");

    repository.upsertRetentionState({
      id: "runtime-storage",
      policy: DEFAULT_RUNTIME_STORAGE_RETENTION_POLICY,
      lastCleanupAt: "2026-06-09T00:05:00.000Z",
      deletedSessionCount: 2,
      deletedEventCount: 12,
    });

    assert.equal(repository.getRetentionState("runtime-storage")?.deletedEventCount, 12);
    await repository.save();
  } finally {
    repository.close();
  }

  const reopened = await RuntimeSessionRepository.open(repoRoot, { companyId: DEFAULT_COMPANY_ID });
  try {
    const [record] = reopened.listSessionRecords({ employeeId: "mira-hr" });
    assert.ok(record);
    assert.equal(record.runtimeMetadata?.cwd?.value, "C:\\Users\\Xu\\workspace\\mira-hr");
    assert.deepEqual(record.runtimeMetadata?.tools?.loadedToolNames, ["finish_intake_turn", "finish_intake_turn"]);
    assert.equal(record.userMessageCount, 1);
    assert.equal(record.assistantMessageCount, 1);
    const events = reopened.getSessionDetail("session-record-1")?.events || [];
    assert.equal(events.length, 4);
    assert.equal(events[0]?.modelCallId, "session-record-1|model_call|primary");
    assert.equal(events[0]?.semanticRole, "user_message");
  } finally {
    reopened.close();
  }
});

test("runtime session repository stores process trace, action history, and memory summaries", async () => {
  const repoRoot = await createRepoRoot();
  const repository = await RuntimeSessionRepository.open(repoRoot, { companyId: DEFAULT_COMPANY_ID });

  try {
    repository.appendProcessTraceEvent({
      id: "ptrace-1",
      timestamp: "2026-06-09T00:00:03.000Z",
      sessionKey: "mira-hr|channel_thread|root-1",
      channelTopicId: "channel-topic-1",
      workRunId: "work-run-1",
      employeeId: "mira-hr",
      kind: "turn_received",
      title: "Turn received",
      status: "running",
      summary: "Mira received the turn.",
      metadata: { source: "test" },
    });
    repository.appendCollaborationActionEvent({
      id: "action-1",
      timestamp: "2026-06-09T00:00:04.000Z",
      employeeId: "mira-hr",
      actionName: "handoff",
      channelTopicId: "channel-topic-1",
      workRunId: "work-run-1",
      status: "final",
      recipientId: "participant-principal",
      message: "Done for now.",
      progressSummary: "Returned with a summary.",
      decision: "allowed",
      emitted: true,
      payload: { status: "final" },
    });
    repository.upsertMemorySummary({
      id: "memory-1",
      createdAt: "2026-06-09T00:00:05.000Z",
      updatedAt: "2026-06-09T00:00:05.000Z",
      scopeKind: "work_run",
      scopeId: "work-run-1",
      employeeId: "mira-hr",
      sourceKind: "session",
      sourceId: "session-record-1",
      category: "lesson",
      title: "Onboarding task pattern",
      summary: "Ask HR for missing account context before handing off.",
      importance: 0.7,
      lastAccessedAt: "2026-06-09T00:00:05.000Z",
      embeddingStatus: "pending",
    });

    assert.equal(repository.listProcessTraceEvents({ workRunId: "work-run-1" }).length, 1);
    assert.equal(repository.listCollaborationActionEvents({ channelTopicId: "channel-topic-1" }).length, 1);
    assert.equal(repository.listMemorySummaries({ employeeId: "mira-hr" }).length, 1);
  } finally {
    repository.close();
  }
});

test("runtime session repository infers WorkRun id from work_run_execution session key", async () => {
  const repoRoot = await createRepoRoot();
  const repository = await RuntimeSessionRepository.open(repoRoot, { companyId: DEFAULT_COMPANY_ID });

  try {
    const session = repository.upsertSessionRecord({
      id: "session-work-run-1",
      employeeId: "mira-hr",
      sessionKey: "mira-hr|work_run_execution|work-run-1",
      sessionId: "session-work-run-1",
      sceneType: "work_run_execution",
      status: "running",
      startedAt: "2026-06-09T00:00:00.000Z",
      updatedAt: "2026-06-09T00:01:00.000Z",
    });

    assert.equal(session.workRunId, "work-run-1");
    await repository.save();
  } finally {
    repository.close();
  }

  const reopened = await RuntimeSessionRepository.open(repoRoot, { companyId: DEFAULT_COMPANY_ID });
  try {
    assert.equal(reopened.getSessionRecord("session-work-run-1")?.workRunId, "work-run-1");
    assert.equal(reopened.listSessionRecords({ workRunId: "work-run-1" }).length, 1);
  } finally {
    reopened.close();
  }
});

test("runtime session repository cleanup removes old sessions and keeps memory summaries", async () => {
  const repoRoot = await createRepoRoot();
  const repository = await RuntimeSessionRepository.open(repoRoot, { companyId: DEFAULT_COMPANY_ID });

  try {
    for (const [id, updatedAt] of [
      ["old-session", "2026-05-01T00:00:00.000Z"],
      ["recent-session", "2026-06-09T00:00:00.000Z"],
    ] as const) {
      repository.upsertSessionRecord({
        id,
        employeeId: "mira-hr",
        sessionKey: `mira-hr|work_run_execution|${id}`,
        sessionId: id,
        sceneType: "work_run_execution",
        status: "completed",
        startedAt: updatedAt,
        updatedAt,
      });
      repository.appendSessionEvent({
        id: `${id}-event`,
        sessionRecordId: id,
        sequence: 1,
        timestamp: updatedAt,
        kind: "message",
        role: "assistant",
        preview: id,
      });
    }
    repository.upsertMemorySummary({
      id: "memory-keep",
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
      scopeKind: "work_run",
      scopeId: "work-run-1",
      employeeId: "mira-hr",
      sourceKind: "session",
      sourceId: "old-session",
      category: "lesson",
      title: "Keep memory",
      summary: "Memory survives raw session cleanup.",
      importance: 0.5,
      embeddingStatus: "not_requested",
    });

    const cleanup = repository.cleanupRuntimeStorage({
      now: "2026-06-09T00:00:00.000Z",
      policy: {
        keepSessionDays: 30,
        maxSessionRecords: 3000,
        maxSessionEvents: 500000,
        maxEventPreviewBytes: 8192,
        maxEventPayloadBytes: 262144,
      },
    });

    assert.equal(cleanup.deletedSessionCount, 1);
    assert.equal(cleanup.deletedEventCount, 1);
    assert.equal(repository.getSessionRecord("old-session"), undefined);
    assert.ok(repository.getSessionRecord("recent-session"));
    assert.equal(repository.listMemorySummaries({ id: "memory-keep" }).length, 1);
    assert.equal(repository.getRetentionState("runtime-storage")?.deletedSessionCount, 1);
    await repository.save();
  } finally {
    repository.close();
  }
});
