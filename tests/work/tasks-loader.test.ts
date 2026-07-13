import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import test, { beforeEach } from "node:test";

import { assertNoForbiddenPublicCarrierFields } from "../../src/collaboration/contracts/conversation-message-contract.js";
import {
  loadTasksViewModel,
  loadTasksViewState,
} from "../../src/work/tasks-loader.js";
import { createCompany } from "../../src/runtime/company-config/companies-admin.js";
import { CompanyDirectoryRepository } from "../../src/runtime/company-config/company-directory-repository.js";
import { DEFAULT_COMPANY_ID } from "../../src/runtime/company-config/postgres-schema.js";
import { RuntimeSessionRepository } from "../../src/runtime/storage/runtime-session-repository.js";
import { WorkService } from "../../src/work/work-service.js";
import { resetRuntimePostgresTables } from "../runtime/postgres-test-utils.js";

const TEST_COMPANY_ID = DEFAULT_COMPANY_ID;

beforeEach(resetRuntimePostgresTables);

async function seedQualityEditor(repoRoot: string, companyId: string) {
  const directory = await CompanyDirectoryRepository.open(repoRoot, { companyId });
  try {
    await directory.upsertEmployee({
      employeeId: "quality-editor",
      enabled: true,
      profile: {
        employeeId: "quality-editor",
        role: "quality",
        displayName: "Quality Editor",
        presenceMode: "resident",
        mountedActions: [],
      },
      resourcePolicy: {},
      runtime: {
        version: 1,
        modelProvider: "openai-codex",
        modelId: "gpt-5.4",
        thinkingLevel: "minimal",
      },
    });
    await directory.save();
  } finally {
    directory.close();
  }
}

test("tasks loader builds Task aggregates from shared backend state", async () => {
  const repoRoot = path.join(process.cwd(), ".scratch", `tmp-tasks-loader-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await mkdir(repoRoot, { recursive: true });
  await seedQualityEditor(repoRoot, TEST_COMPANY_ID);

  const workService = new WorkService({ repoRoot, companyId: TEST_COMPANY_ID });
  const planned = await workService.createWork({
    title: "Loader visible scheduled work",
    description: "Verify the Tasks loader owns the runtime query boundary.",
    createdByMemberId: "quality-editor",
    ownerMemberId: "quality-editor",
    sourceKind: "intake_event",
    sourceId: "loader-report-001",
    sourceChannelTopicId: "loader-topic-001",
    acceptanceCriteria: "The loader returns this WorkTask.",
    trigger: {
      kind: "scheduled_once",
      scheduledFor: "2026-06-16T09:00:00.000Z",
    },
  });
  assert.equal(planned.run, undefined);
  assert.ok(planned.schedule);

  const state = await loadTasksViewState({
    repoRoot,
    companyId: TEST_COMPANY_ID,
    requestUrl: new URL("http://localhost/tasks?view=tasks"),
  });
  const model = await loadTasksViewModel({
    repoRoot,
    companyId: TEST_COMPANY_ID,
    requestUrl: new URL("http://localhost/api/companies/default-company/tasks/view-model?view=tasks"),
    routes: {
      htmlPath: "/tasks",
      viewModelJsonPath: "/api/companies/default-company/tasks/view-model",
    },
  });

  assert.equal(state.state.tasks.length, 1);
  assert.equal(state.state.schedules.length, 1);
  assert.equal(state.state.runs.length, 0);
  assert.equal(model.filters.view, "tasks");
  assert.equal(model.routes.viewModelJsonPath, "/api/companies/default-company/tasks/view-model");
  assert.equal(model.tasks[0]?.title, "Loader visible scheduled work");
  assert.equal(model.filters.selectedWorkTaskId, undefined);
  assert.equal(model.selected.kind, undefined);
  assert.equal(model.tasks[0]?.schedule.kind, "scheduled_once");
  assert.equal(model.tasks[0]?.executionCount, 0);
  assertNoForbiddenPublicCarrierFields(model);
  assert.doesNotMatch(JSON.stringify(model), /\brootPostId\b/);
  assert.deepEqual(model.tasks[0]?.sourceLink, {
    kind: "intake-event",
    href: "/app/tasks/source/intake-event/loader-report-001",
    label: "Intake event loader-report-001",
    sourceId: "loader-report-001",
  });
  assert.doesNotMatch(JSON.stringify(model), /legacy-carrier|Mattermost/i);
});

test("tasks loader preserves dissolved Channel source evidence without a broken Chat target", async () => {
  const repoRoot = path.join(process.cwd(), ".scratch", `tmp-tasks-source-unavailable-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await mkdir(repoRoot, { recursive: true });
  await seedQualityEditor(repoRoot, TEST_COMPANY_ID);
  const workService = new WorkService({ repoRoot, companyId: TEST_COMPANY_ID });
  const created = await workService.createWork({
    title: "Preserve dissolved Channel evidence",
    createdByMemberId: "quality-editor",
    ownerMemberId: "quality-editor",
    sourceKind: "chat_request",
    sourceId: "conversation-dissolved",
    acceptanceCriteria: "Task evidence remains readable without navigating to a deleted room.",
    trigger: { kind: "immediate" },
    metadata: {
      conversationId: "conversation-dissolved",
      messageId: "message-dissolved",
      sourceConversationUnavailable: true,
      sourceConversationUnavailableReason: "Source Channel was dissolved.",
    },
  });
  const model = await loadTasksViewModel({
    repoRoot,
    companyId: TEST_COMPANY_ID,
    requestUrl: new URL(`http://localhost/tasks?workTaskId=${created.task.id}`),
  });

  assert.deepEqual(model.tasks[0]?.sourceLink, {
    kind: "manual-source",
    href: "#",
    label: "Source Channel was dissolved.",
    sourceId: "conversation-dissolved",
  });
  assert.equal(model.tasks[0]?.sourceLink?.conversationId, undefined);
});

test("tasks loader rejects legacy schedule selection URLs", async () => {
  const repoRoot = path.join(process.cwd(), ".scratch", `tmp-tasks-schedule-detail-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await mkdir(repoRoot, { recursive: true });
  await seedQualityEditor(repoRoot, TEST_COMPANY_ID);

  const workService = new WorkService({ repoRoot, companyId: TEST_COMPANY_ID });
  const planned = await workService.createWork({
    title: "Inspect selected schedule",
    description: "The native Tasks should show this schedule without requiring a run.",
    createdByMemberId: "quality-editor",
    ownerMemberId: "quality-editor",
    sourceKind: "intake_event",
    sourceId: "loader-schedule-detail-001",
    acceptanceCriteria: "The selected schedule detail is visible.",
    trigger: {
      kind: "scheduled_once",
      scheduledFor: "2026-06-16T09:00:00.000Z",
    },
  });
  assert.ok(planned.schedule);
  await assert.rejects(
    () => loadTasksViewModel({
      repoRoot,
      companyId: TEST_COMPANY_ID,
      requestUrl: new URL(`http://localhost/api/companies/default-company/tasks/view-model?view=schedules&workScheduleId=${planned.schedule.id}`),
      routes: {
        htmlPath: "/tasks",
        viewModelJsonPath: "/api/companies/default-company/tasks/view-model",
      },
    }),
    /Retired workScheduleId selection is not supported/,
  );
});

test("tasks loader rejects legacy WorkRun selection URLs", async () => {
  const repoRoot = path.join(process.cwd(), ".scratch", `tmp-tasks-loader-usage-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await mkdir(repoRoot, { recursive: true });
  await seedQualityEditor(repoRoot, TEST_COMPANY_ID);

  const workService = new WorkService({ repoRoot, companyId: TEST_COMPANY_ID });
  const planned = await workService.createWork({
    title: "Inspect runtime usage",
    createdByMemberId: "nora-automation",
    ownerMemberId: "quality-editor",
    sourceKind: "manual",
    sourceId: "manual-usage-test",
    acceptanceCriteria: "Usage is visible on the Workboard.",
    trigger: { kind: "immediate" },
  });
  assert.ok(planned.run);

  const runtimeRepository = await RuntimeSessionRepository.open(repoRoot, { companyId: TEST_COMPANY_ID });
  try {
    runtimeRepository.upsertSessionRecord({
      id: "session-work-run-usage",
      employeeId: "quality-editor",
      sessionKey: `quality-editor|work_run_execution|${planned.run.id}`,
      sessionId: "session-work-run-usage",
      sceneType: "work_run_execution",
      workRunId: planned.run.id,
      status: "completed",
      title: "quality-editor work_run_execution session",
      summary: "Usage persisted for Workboard.",
      startedAt: "2026-06-16T09:00:00.000Z",
      updatedAt: "2026-06-16T09:01:00.000Z",
      tokenInputTotal: 2000,
      tokenOutputTotal: 80,
      tokenCacheTotal: 400,
    });
    await runtimeRepository.save();
  } finally {
    runtimeRepository.close();
  }

  await assert.rejects(
    () => loadTasksViewModel({
      repoRoot,
      companyId: TEST_COMPANY_ID,
      requestUrl: new URL(`http://localhost/api/companies/default-company/tasks/view-model?view=runs&workRunId=${planned.run.id}`),
    }),
    /Retired workRunId selection is not supported/,
  );
});

test("tasks loader only shows the requested company's work", async () => {
  const repoRoot = path.join(process.cwd(), ".scratch", `tmp-tasks-company-isolation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await mkdir(repoRoot, { recursive: true });
  const otherCompanyId = "support-ops";
  await createCompany({
    repoRoot,
    companyId: otherCompanyId,
    displayName: "Support Ops",
  });
  await seedQualityEditor(repoRoot, TEST_COMPANY_ID);
  await seedQualityEditor(repoRoot, otherCompanyId);

  for (const companyId of [TEST_COMPANY_ID, otherCompanyId]) {
    let counter = 0;
    const ids = ["work-task-shared", "work-run-shared", "work-run-event-shared"];
    const workService = new WorkService({
      repoRoot,
      companyId,
      createId: () => ids[counter++] || `extra-${counter}`,
      now: () => companyId === TEST_COMPANY_ID
        ? "2026-06-16T09:00:00.000Z"
        : "2026-06-16T10:00:00.000Z",
    });
    await workService.createWork({
      title: companyId === TEST_COMPANY_ID ? "Default company work" : "Support company work",
      createdByMemberId: "quality-editor",
      ownerMemberId: "quality-editor",
      sourceKind: "manual",
      sourceId: "shared-source",
      acceptanceCriteria: "Company scoped work is visible.",
      trigger: { kind: "immediate" },
    });
  }

  const defaultModel = await loadTasksViewModel({
    repoRoot,
    companyId: TEST_COMPANY_ID,
    requestUrl: new URL("http://localhost/api/companies/default-company/tasks/view-model"),
  });
  const otherModel = await loadTasksViewModel({
    repoRoot,
    companyId: otherCompanyId,
    requestUrl: new URL("http://localhost/api/companies/default-company/tasks/view-model"),
  });

  assert.deepEqual(defaultModel.tasks.map((task) => task.title), ["Default company work"]);
  assert.deepEqual(otherModel.tasks.map((task) => task.title), ["Support company work"]);
});
