import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { OperatingLogRepository } from "../../src/operating-log/operating-log-repository.js";
import { runEvidenceQuery } from "../../src/runtime/evidence-query/evidence-query-service.js";
import { companyEmployeeHomePath } from "../../src/runtime/company-config/company-paths.js";
import { CompanyDirectoryRepository } from "../../src/runtime/company-config/company-directory-repository.js";
import { createCompany } from "../../src/runtime/company-config/companies-admin.js";
import type { ProcessTraceEvent } from "../../src/runtime/contracts/process-trace-event.js";
import type { EmployeeHome } from "../../src/runtime/registry/employee-home.js";
import { RuntimeSessionRepository } from "../../src/runtime/storage/runtime-session-repository.js";
import type { RuntimeSessionRepositoryLike } from "../../src/runtime/storage/runtime-session-repository.js";
import { loadTasksViewModel } from "../../src/work/tasks-loader.js";
import { WorkRepository } from "../../src/work/work-repository.js";
import {
  CompanyControlPlane,
  WorkDispatchLeaseService,
  WorkExecutionService,
  WorkService,
  type WorkExecutionResponderInput,
} from "../../src/work/index.js";

function createDeterministicClock(start = "2026-06-08T00:00:00.000Z") {
  let tick = 0;
  const base = Date.parse(start);
  return () => new Date(base + tick++ * 1000).toISOString();
}

function createDeterministicIds(idPrefix = "") {
  let tick = 0;
  return (prefix: string) => `${idPrefix}${prefix}-${++tick}`;
}

async function createFixture() {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "tinyoffice-work-e2e-"));
  const idPrefix = `${path.basename(repoRoot).replace(/[^a-zA-Z0-9-]/g, "")}-`;
  const companyId = idPrefix.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+$/g, "");
  const requesterEmployeeId = `${idPrefix}nora-automation`;
  const assigneeMemberId = `${idPrefix}iris-growth`;
  const homePath = companyEmployeeHomePath({
    repoRoot,
    companyId,
    employeeId: assigneeMemberId,
  });
  const workspacePath = path.join(homePath, "workspace");
  await mkdir(workspacePath, { recursive: true });
  await createCompany({
    repoRoot,
    companyId,
    displayName: `Work E2E ${companyId}`,
    ownerMemberId: `${idPrefix}owner`,
    ownerDisplayName: "Work E2E Owner",
    hrEmployeeDisplayName: "Work E2E HR",
  });

  const directory = await CompanyDirectoryRepository.open(repoRoot, { companyId });
  try {
    for (const employeeId of [requesterEmployeeId, assigneeMemberId]) {
      await directory.upsertEmployee({
        employeeId,
        enabled: true,
        profile: {
          employeeId,
          displayName: employeeId,
          role: "employee",
          presenceMode: "resident",
        },
        resourcePolicy: {
          version: 1,
          filesystem: {
            ownWorkspace: "allow",
            otherEmployeeWorkspace: "allow",
            repo: "allow",
            secrets: "deny",
          },
        },
        runtime: { version: 1, modelProvider: "openai", modelId: "gpt-5-codex", thinkingLevel: "minimal" },
      });
    }
    await directory.save();
  } finally {
    directory.close();
  }

  const now = createDeterministicClock();
  const createId = createDeterministicIds(idPrefix);
  const employee: EmployeeHome = {
    employeeId: assigneeMemberId,
    homePath,
    workspacePath,
    profile: {
      employeeId: assigneeMemberId,
      displayName: "Iris",
      role: "growth",
      presenceMode: "resident",
    },
    resourcePolicy: {
      version: 1,
      filesystem: {
        ownWorkspace: "allow",
        otherEmployeeWorkspace: "allow",
        repo: "allow",
        secrets: "deny",
      },
    },
  };
  const workService = new WorkService({ repoRoot, companyId, now, createId });
  const leaseService = new WorkDispatchLeaseService({ repoRoot, companyId, now, createId });
  const runtimeRepository = await RuntimeSessionRepository.open(repoRoot, { companyId });

  return {
    repoRoot,
    companyId,
    requesterEmployeeId,
    employee,
    workService,
    leaseService,
    runtimeRepository,
    now,
    createId,
  };
}

async function finishWorkTurn(input: WorkExecutionResponderInput, args: {
  status: "complete" | "blocked" | "failed" | "canceled" | "in_progress";
  summary: string;
  evidence?: string[];
}) {
  await input.onProcessEvent?.({
    kind: "model_tool_call",
    sessionKey: input.sessionKey,
    employeeId: input.employee.employeeId,
    title: "finish_work_turn called",
    status: "succeeded",
    metadata: {
      toolName: "finish_work_turn",
      arguments: {
        evidence: [],
        blockerMessage: "",
        ...args,
      },
    },
  });
  await input.onProcessEvent?.({
    kind: "model_tool_result",
    sessionKey: input.sessionKey,
    employeeId: input.employee.employeeId,
    title: "finish_work_turn returned a result",
    status: "succeeded",
    metadata: {
      toolName: "finish_work_turn",
    },
  });
  return args.summary;
}

function persistRuntimeSession(input: {
  repository: RuntimeSessionRepositoryLike;
  now: () => string;
  employee: EmployeeHome;
  workRunId: string;
  sessionKey: string;
  sessionRecordId: string;
  contextText?: string;
}) {
  input.repository.upsertSessionRecord({
    id: input.sessionRecordId,
    employeeId: input.employee.employeeId,
    sessionKey: input.sessionKey,
    sessionId: input.sessionRecordId,
    sceneType: "work_run_execution",
    workRunId: input.workRunId,
    status: "running",
    title: `${input.employee.employeeId} work_run_execution session`,
    summary: "Runtime session started for scheduled WorkRun.",
    startedAt: input.now(),
    updatedAt: input.now(),
    eventCount: 2,
    userMessageCount: 1,
    assistantMessageCount: 0,
    toolCallCount: 0,
    toolResultCount: 0,
    tokenInputTotal: 120,
    tokenOutputTotal: 0,
    tokenCacheTotal: 0,
    byteSize: 300,
    truncated: false,
  });
  input.repository.appendSessionEvent({
    id: `${input.sessionRecordId}-input`,
    sessionRecordId: input.sessionRecordId,
    sequence: 1,
    timestamp: input.now(),
    kind: "prompt_context",
    visibility: "prompt_context",
    semanticRole: "work_run_context",
    preview: "WorkRun package",
    payload: {
      workRunId: input.workRunId,
      contextText: input.contextText,
    },
    byteSize: 150,
    truncated: false,
  });
  input.repository.appendSessionEvent({
    id: `${input.sessionRecordId}-assistant`,
    sessionRecordId: input.sessionRecordId,
    sequence: 2,
    timestamp: input.now(),
    kind: "assistant_message",
    role: "assistant",
    visibility: "user_visible",
    semanticRole: "assistant_visible_message",
    preview: "Scheduled WorkRun completed with evidence.",
    byteSize: 90,
    truncated: false,
  });
}

test("scheduled WorkTask runs end to end through runtime execution, Tasks, and evidence queries", async () => {
  const {
    repoRoot,
    companyId,
    requesterEmployeeId,
    employee,
    workService,
    leaseService,
    runtimeRepository,
    now,
    createId,
  } = await createFixture();
  try {
    const scheduledFor = "2026-06-07T00:00:00.000Z";
    const planned = await workService.createWork({
      title: "Run scheduled launch QA",
      description: "Check the launch page before the weekly review.",
      createdByMemberId: requesterEmployeeId,
      ownerMemberId: employee.employeeId,
      sourceKind: "manual",
      sourceId: "launch-qa-schedule",
      acceptanceCriteria: "Launch QA evidence exists.",
      trigger: {
        kind: "scheduled_once",
        scheduledFor,
        timezone: "UTC",
      },
    });
    assert.ok(planned.schedule);
    assert.equal(planned.run, undefined);

    const sessionRecordId = createId("runtime-session");
    let processTraceSequence = 0;
    const workExecutionService = new WorkExecutionService({
      workService,
      repoRoot,
      async responder(input) {
        persistRuntimeSession({
          repository: runtimeRepository,
          now,
          employee: input.employee,
          workRunId: input.threadId,
          sessionKey: input.sessionKey,
          sessionRecordId,
          contextText: input.contextBlocks?.[0]?.text,
        });
        await input.onProcessEvent?.({
          kind: "turn_received",
          sessionKey: input.sessionKey,
          employeeId: input.employee.employeeId,
          title: "Scheduled WorkRun received",
          status: "running",
        });
        return finishWorkTurn(input, {
          status: "complete",
          summary: "Launch QA completed and checklist evidence recorded.",
          evidence: ["Checked launch page hero, CTA, and analytics tags."],
        });
      },
    });
    const controlPlane = new CompanyControlPlane({
      repoRoot,
      companyId,
      workService,
      leaseService,
      workExecutionService,
      now,
      createId,
      async resolveEmployee(employeeId) {
        return employeeId === employee.employeeId ? employee : undefined;
      },
    });

    const run = await controlPlane.runOnce({
      createdBy: "company-control-plane",
      preferredLanguage: "zh-CN",
      onProcessEvent(event) {
        processTraceSequence += 1;
        runtimeRepository.appendProcessTraceEvent({
          id: `trace-${processTraceSequence}`,
          timestamp: now(),
          ...event,
        } as ProcessTraceEvent);
      },
    });
    await runtimeRepository.save();

    const workRunId = run.tick.createdRuns[0]?.id;
    assert.ok(workRunId);
    assert.equal(run.tick.dueSchedules[0]?.id, planned.schedule.id);
    assert.equal(run.tick.createdRuns.length, 1);
    assert.equal(run.dispatch.result?.candidate.run.id, workRunId);
    assert.equal(run.dispatch.result?.execution.sessionKey, `${employee.employeeId}|work_run_execution|${workRunId}`);

    const workRunDetail = await workService.getWorkRunDetail(workRunId);
    const taskDetail = await workService.getWorkTaskDetail(planned.task.id);
    const board = await loadTasksViewModel({
      repoRoot,
      companyId,
      requestUrl: new URL(`http://localhost/api/companies/default-company/tasks/view-model?workTaskId=${planned.task.id}`),
    });

    assert.equal(workRunDetail?.run.status, "done");
    assert.equal(workRunDetail?.run.resultSummary, "Launch QA completed and checklist evidence recorded.");
    assert.equal(taskDetail?.task.status, "completed");
    assert.equal(taskDetail?.schedules[0]?.status, "completed");
    assert.equal(board.selected.kind, "task");
    assert.equal(board.selected.kind === "task" ? board.selected.task.id : undefined, planned.task.id);
    assert.deepEqual(
      board.selected.kind === "task"
        ? board.selected.task.executions.map((execution) => [execution.id, execution.status])
        : [],
      [[workRunId, "done"]],
    );

    const directoryRepository = await CompanyDirectoryRepository.open(repoRoot, { companyId });
    const workRepository = await WorkRepository.open(repoRoot, { companyId });
    const evidenceRuntimeRepository = await RuntimeSessionRepository.open(repoRoot, { companyId });
    const opsRepository = await OperatingLogRepository.open(repoRoot, { companyId });
    try {
      const repositories = {
        directory: directoryRepository,
        work: workRepository,
        runtime: evidenceRuntimeRepository,
        governance: {
          list: async () => [],
          listGrants: async () => [],
        },
        intake: {
          load: async () => ({ events: [] }),
          close() {},
        },
        ops: opsRepository,
      };

      const workRunEvidence = await runEvidenceQuery({
        query: { command: "work-run", id: workRunId },
        repositories,
        generatedAt: now(),
      });
      const sessionsEvidence = await runEvidenceQuery({
        query: { command: "sessions", workRunId },
        repositories,
        generatedAt: now(),
      });
      const sessionInputEvidence = await runEvidenceQuery({
        query: { command: "session-input", id: sessionRecordId },
        repositories,
        generatedAt: now(),
      });
      const traceEvidence = await runEvidenceQuery({
        query: { command: "trace", workRunId },
        repositories,
        generatedAt: now(),
      });
      const opsEvidence = await runEvidenceQuery({
        query: { command: "ops" },
        repositories,
        generatedAt: now(),
      });

      assert.equal(workRunEvidence.detail.run.status, "done");
      assert.deepEqual(
        workRunEvidence.detail.events.map((event: { eventType: string }) => event.eventType),
        ["created", "started", "completed"],
      );
      assert.deepEqual(sessionsEvidence.items.map((item) => item.id), [sessionRecordId]);
      assert.deepEqual(sessionInputEvidence.items.map((item) => item.id), [`${sessionRecordId}-input`]);
      assert.deepEqual(
        traceEvidence.items.map((item) => item.title),
        ["Scheduled WorkRun received", "finish_work_turn called", "finish_work_turn returned a result"],
      );
      assert.deepEqual(
        opsEvidence.items.map((item) => item.title).filter((title) =>
          title === "WorkRun queued from WorkSchedule" || title === "WorkRun dispatched"
        ).sort(),
        ["WorkRun dispatched", "WorkRun queued from WorkSchedule"],
      );
      assert.deepEqual(
        opsEvidence.items
          .map((item) => "source" in item ? item.source?.kind : undefined)
          .filter((kind) => kind === "work_run" || kind === "work_schedule")
          .sort(),
        ["work_run", "work_schedule"],
      );
    } finally {
      directoryRepository.close();
      workRepository.close();
      evidenceRuntimeRepository.close();
      opsRepository.close();
    }
  } finally {
    runtimeRepository.close();
  }
});
