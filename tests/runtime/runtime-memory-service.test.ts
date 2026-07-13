import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  recordSessionCompletionMemory,
  recallRuntimeMemories,
} from "../../src/runtime/memory/runtime-memory-service.js";
import { DEFAULT_COMPANY_ID } from "../../src/runtime/company-config/postgres-schema.js";
import { RuntimeSessionRepository } from "../../src/runtime/storage/runtime-session-repository.js";

async function createRepoRoot() {
  return mkdtemp(path.join(tmpdir(), "tinyoffice-runtime-memory-"));
}

test("runtime memory service writes session completion summaries separate from raw session events", async () => {
  const repoRoot = await createRepoRoot();
  const repository = await RuntimeSessionRepository.open(repoRoot, { companyId: DEFAULT_COMPANY_ID });
  try {
    repository.upsertSessionRecord({
      id: "session-record-1",
      employeeId: "mira-hr",
      sessionKey: "mira-hr|channel_thread|root-1",
      sessionId: "mira-hr|channel_thread|root-1",
      sceneType: "channel_thread",
      channelTopicId: "channel-topic-1",
      status: "completed",
      title: "Mira channel topic session",
      summary: "Employee reply completed.",
      startedAt: "2026-06-09T00:00:00.000Z",
      updatedAt: "2026-06-09T00:01:00.000Z",
    });
    repository.appendSessionEvent({
      id: "session-event-1",
      sessionRecordId: "session-record-1",
      sequence: 1,
      timestamp: "2026-06-09T00:00:30.000Z",
      kind: "assistant_message",
      role: "assistant",
      summary: "Use onboarding checklist B for remote hires.",
      preview: "Use onboarding checklist B for remote hires.",
    });
    await repository.save();
  } finally {
    repository.close();
  }

  const memory = await recordSessionCompletionMemory({
    repoRoot,
    companyId: DEFAULT_COMPANY_ID,
    sessionRecordId: "session-record-1",
    now: () => "2026-06-09T00:02:00.000Z",
  });

  assert.equal(memory?.scopeKind, "session");
  assert.equal(memory?.sourceKind, "session");
  assert.equal(memory?.embeddingStatus, "not_requested");
  assert.match(memory?.summary || "", /onboarding checklist B/);

  const memories = await recallRuntimeMemories({
    repoRoot,
    companyId: DEFAULT_COMPANY_ID,
    employeeId: "mira-hr",
    limit: 10,
  });
  assert.deepEqual(memories.map((entry) => entry.id), ["memory-session-session-record-1"]);

  const reopened = await RuntimeSessionRepository.open(repoRoot, { companyId: DEFAULT_COMPANY_ID });
  try {
    assert.equal(reopened.getSessionDetail("session-record-1")?.events.length, 1);
    assert.equal(reopened.listMemorySummaries({ id: "memory-session-session-record-1" }).length, 1);
  } finally {
    reopened.close();
  }
});
