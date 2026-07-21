import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { DbChannelTopicStore } from "../../src/channel-topics/storage/db-channel-topic-store.js";
import { createCompany } from "../../src/runtime/company-config/companies-admin.js";
import { CompanyDirectoryRepository } from "../../src/runtime/company-config/company-directory-repository.js";
import { DEFAULT_COMPANY_ID } from "../../src/runtime/company-config/postgres-schema.js";
import { loadEmployeeStatusViewModel } from "../../src/runtime/employee-status/employee-status-loader.js";
import { RuntimeSessionRepository } from "../../src/runtime/storage/runtime-session-repository.js";
import { WorkService } from "../../src/work/work-service.js";

const now = "2026-06-16T08:00:00.000Z";

async function seedEmployee(repoRoot: string, companyId: string, employeeId: string) {
  const directory = await CompanyDirectoryRepository.open(repoRoot, { companyId });
  try {
    await directory.upsertEmployee({
      employeeId,
      enabled: true,
      profile: {
        employeeId,
        role: "quality",
        displayName: employeeId,
        presenceMode: "resident",
      },
      resourcePolicy: {
        version: 1,
        filesystem: { ownWorkspace: "allow", otherEmployeeWorkspace: "allow", repo: "allow", secrets: "deny" },
      },
      runtime: { version: 1, modelProvider: "openai", modelId: "gpt-5-codex", thinkingLevel: "minimal" },
    });
    await directory.save();
  } finally {
    directory.close();
  }
}

async function seedWork(repoRoot: string, companyId: string, employeeId: string, title: string) {
  const work = new WorkService({
    repoRoot,
    companyId,
    now: () => now,
    createId: (prefix) => `${prefix}-shared`,
  });
  await work.createWork({
    title,
    createdByMemberId: employeeId,
    ownerMemberId: employeeId,
    sourceKind: "chat_request",
    sourceId: "shared-source",
    acceptanceCriteria: `${title} succeeds.`,
    trigger: { kind: "immediate" },
  });
}

async function seedRuntimeSession(repoRoot: string, companyId: string, employeeId: string, title: string) {
  const repository = await RuntimeSessionRepository.open(repoRoot, { companyId });
  try {
    repository.upsertSessionRecord({
      id: "session-shared",
      employeeId,
      sessionKey: `${employeeId}|work_run_execution|work-run-shared`,
      sessionId: "session-shared",
      sceneType: "work_run_execution",
      workRunId: "work-run-shared",
      status: "running",
      title,
      summary: title,
      startedAt: now,
      updatedAt: now,
      eventCount: 1,
      userMessageCount: 0,
      assistantMessageCount: 0,
      toolCallCount: 0,
      toolResultCount: 0,
      tokenInputTotal: 0,
      tokenOutputTotal: 0,
      tokenCacheTotal: 0,
      byteSize: 128,
      truncated: false,
    });
    await repository.save();
  } finally {
    repository.close();
  }
}

async function seedTopic(repoRoot: string, companyId: string, employeeId: string, roomId: string) {
  const store = await DbChannelTopicStore.open({ repoRoot, companyId });
  try {
    await store.update((state) => {
      state.channelTopics.push({
        id: "topic-shared",
        roomId,
        conversationId: roomId,
        ownerId: employeeId,
        participantIds: [employeeId],
        lastActivityAt: now,
        identitySource: "tinyoffice_room",
      });
    });
  } finally {
    store.close();
  }
}

test("employee status loader aggregates only the requested company's Work, Sessions, and Topics", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "tinyoffice-employee-status-loader-"));
  const otherCompanyId = `support-status-${process.pid}`;
  const employeeId = `quality-editor-loader-${process.pid}`;
  await createCompany({ repoRoot, companyId: otherCompanyId, displayName: "Support Status" });

  for (const companyId of [DEFAULT_COMPANY_ID, otherCompanyId]) {
    await seedEmployee(repoRoot, companyId, employeeId);
  }
  await seedWork(repoRoot, DEFAULT_COMPANY_ID, employeeId, "Primary tenant work");
  await seedWork(repoRoot, otherCompanyId, employeeId, "Support company work");
  await seedRuntimeSession(repoRoot, DEFAULT_COMPANY_ID, employeeId, "Primary tenant session");
  await seedRuntimeSession(repoRoot, otherCompanyId, employeeId, "Support company session");
  await seedTopic(repoRoot, DEFAULT_COMPANY_ID, employeeId, "default-root");
  await seedTopic(repoRoot, otherCompanyId, employeeId, "support-root");

  const model = await loadEmployeeStatusViewModel({
    repoRoot,
    companyId: DEFAULT_COMPANY_ID,
    employeeId,
  });
  const employee = model.selected.employee;

  assert.ok(employee);
  assert.equal(employee.load.activeWorkRunCount, 1);
  assert.equal(employee.load.runningSessionCount, 1);
  assert.equal(employee.load.topicInHandCount, 1);
  assert.deepEqual(
    employee.currentItems.map((item) => item.title).sort(),
    ["Primary tenant session", "Primary tenant work", "Topic topic-shared"],
  );
  assert.equal(JSON.stringify(model).includes("Support company"), false);
  assert.equal(JSON.stringify(model).includes("default-root"), true);
  assert.equal(JSON.stringify(model).includes("support-root"), false);

  const concurrentLoads = await Promise.all(Array.from({ length: 40 }, () => loadEmployeeStatusViewModel({
    repoRoot,
    companyId: DEFAULT_COMPANY_ID,
    employeeId,
  })));
  assert.equal(concurrentLoads.every((candidate) => candidate === concurrentLoads[0]), true);
});
