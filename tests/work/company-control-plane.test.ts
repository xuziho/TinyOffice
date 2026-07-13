import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { OperatingLogService } from "../../src/operating-log/operating-log-service.js";
import { companyEmployeeHomePath } from "../../src/runtime/company-config/company-paths.js";
import { CompanyDirectoryRepository } from "../../src/runtime/company-config/company-directory-repository.js";
import { DEFAULT_COMPANY_ID } from "../../src/runtime/company-config/postgres-schema.js";
import type { EmployeeHome } from "../../src/runtime/registry/employee-home.js";
import {
  CompanyControlPlane,
  WorkDispatchLeaseService,
  WorkExecutionService,
  WorkService,
  type WorkExecutionResponderInput,
} from "../../src/work/index.js";

function createFixedClock(timestamp = "2026-06-08T00:00:00.000Z") {
  return () => timestamp;
}

function createDeterministicIds(idPrefix = "") {
  let tick = 0;
  return (prefix: string) => `${idPrefix}${prefix}-${++tick}`;
}

async function createFixture() {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "tinyoffice-company-control-plane-"));
  const companyId = DEFAULT_COMPANY_ID;
  const idPrefix = `${path.basename(repoRoot).replace(/[^a-zA-Z0-9-]/g, "")}-`;
  const requesterEmployeeId = `${idPrefix}nora-automation`;
  const assigneeMemberId = `${idPrefix}iris-growth`;
  const homePath = companyEmployeeHomePath({
    repoRoot,
    companyId,
    employeeId: assigneeMemberId,
  });
  const workspacePath = path.join(homePath, "workspace");
  await mkdir(workspacePath, { recursive: true });
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

  const now = createFixedClock();
  const createId = createDeterministicIds(idPrefix);
  const workService = new WorkService({
    repoRoot,
    companyId,
    now,
    createId,
  });
  const leaseService = new WorkDispatchLeaseService({
    repoRoot,
    companyId,
    now,
    createId,
  });
  const operatingLogService = new OperatingLogService({
    repoRoot,
    companyId,
    now,
    createId,
  });
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
  return {
    repoRoot,
    companyId,
    requesterEmployeeId,
    workService,
    leaseService,
    operatingLogService,
    employee,
  };
}

async function finishWorkTurn(input: WorkExecutionResponderInput, args: {
  status: "in_progress" | "complete" | "blocked" | "failed" | "canceled";
  summary: string;
  evidence?: string[];
}): Promise<string> {
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

test("CompanyControlPlane creates exactly one queued WorkRun for a due WorkSchedule tick", async () => {
  const {
    repoRoot,
    companyId,
    requesterEmployeeId,
    workService,
    leaseService,
    operatingLogService,
    employee,
  } = await createFixture();
  const scheduledFor = "2026-06-07T00:00:00.000Z";
  const planned = await workService.createWork({
    title: "Run weekly SEO audit",
    description: "Check whether priority pages still have required metadata.",
    createdByMemberId: requesterEmployeeId,
    ownerMemberId: employee.employeeId,
    sourceKind: "manual",
    sourceId: "work-schedule-smoke",
    acceptanceCriteria: "Audit report exists.",
    trigger: {
      kind: "scheduled_once",
      scheduledFor,
      timezone: "UTC",
    },
  });
  assert.ok(planned.schedule);
  const controlPlane = new CompanyControlPlane({
    repoRoot,
    companyId,
    workService,
    leaseService,
    operatingLogService,
    async resolveEmployee(employeeId) {
      return employeeId === employee.employeeId ? employee : undefined;
    },
  });

  const firstTick = await controlPlane.tickDueSchedules({ createdBy: "company-control-plane" });
  const secondTick = await controlPlane.tickDueSchedules({ createdBy: "company-control-plane" });
  const runs = await workService.listWorkRuns({ workTaskId: planned.task.id });
  const scheduleDetail = await workService.getWorkTaskDetail(planned.task.id);
  const events = await operatingLogService.listEvents({ category: "work" });

  assert.equal(firstTick.createdRuns.length, 1);
  assert.equal(firstTick.createdRuns[0]?.scheduledFor, scheduledFor);
  assert.equal(firstTick.createdRuns[0]?.triggeredBy, "schedule");
  assert.equal(firstTick.reusedRuns.length, 0);
  assert.equal(secondTick.createdRuns.length, 0);
  assert.equal(runs.length, 1);
  assert.equal(scheduleDetail?.schedules[0]?.status, "completed");
  assert.equal(events.filter((event) => event.title === "WorkRun queued from WorkSchedule").length, 1);
});

test("CompanyControlPlane does not start the same WorkRun twice", async () => {
  const {
    repoRoot,
    companyId,
    requesterEmployeeId,
    workService,
    leaseService,
    operatingLogService,
    employee,
  } = await createFixture();
  const planned = await workService.createWork({
    title: "Prepare launch checklist",
    createdByMemberId: requesterEmployeeId,
    ownerMemberId: employee.employeeId,
    sourceKind: "manual",
    sourceId: "launch-checklist",
    acceptanceCriteria: "Checklist is ready.",
    trigger: { kind: "immediate" },
  });
  assert.ok(planned.run);
  const calls: string[] = [];
  const workExecutionService = new WorkExecutionService({
    workService,
    async responder(input) {
      calls.push(input.threadId);
      return finishWorkTurn(input, {
        status: "in_progress",
        summary: "Launch checklist session started.",
      });
    },
  });
  const controlPlane = new CompanyControlPlane({
    repoRoot,
    companyId,
    workService,
    leaseService,
    workExecutionService,
    operatingLogService,
    async resolveEmployee(employeeId) {
      return employeeId === employee.employeeId ? employee : undefined;
    },
  });

  const firstDispatch = await controlPlane.dispatchNext({ createdBy: "company-control-plane" });
  const secondDispatch = await controlPlane.dispatchNext({ createdBy: "company-control-plane" });
  const latestLease = await leaseService.getLatestLeaseForWorkRun(planned.run.id);
  const currentRun = await workService.getWorkRunDetail(planned.run.id);

  assert.equal(firstDispatch.result?.candidate.run.id, planned.run.id);
  assert.equal(secondDispatch.result, undefined);
  assert.deepEqual(calls, [planned.run.id]);
  assert.equal(latestLease?.status, "acknowledged");
  assert.equal(currentRun?.run.status, "in_progress");
});

test("CompanyControlPlane dispatches into the expected work_run_execution session and logs evidence", async () => {
  const {
    repoRoot,
    companyId,
    requesterEmployeeId,
    workService,
    leaseService,
    operatingLogService,
    employee,
  } = await createFixture();
  const planned = await workService.createWork({
    title: "Summarize support backlog",
    createdByMemberId: requesterEmployeeId,
    ownerMemberId: employee.employeeId,
    sourceKind: "manual",
    sourceId: "support-backlog",
    acceptanceCriteria: "Backlog summary exists.",
    trigger: { kind: "immediate" },
  });
  assert.ok(planned.run);
  const calls: Array<{ sessionKey: string; threadId: string; preferredLanguage?: string }> = [];
  const workExecutionService = new WorkExecutionService({
    workService,
    async responder(input) {
      calls.push({
        sessionKey: input.sessionKey,
        threadId: input.threadId,
        preferredLanguage: input.preferredLanguage,
      });
      return finishWorkTurn(input, {
        status: "in_progress",
        summary: "Support backlog session started.",
      });
    },
  });
  const controlPlane = new CompanyControlPlane({
    repoRoot,
    companyId,
    workService,
    leaseService,
    workExecutionService,
    operatingLogService,
    async resolveEmployee(employeeId) {
      return employeeId === employee.employeeId ? employee : undefined;
    },
  });

  const dispatch = await controlPlane.dispatchNext({
    createdBy: "company-control-plane",
    preferredLanguage: "zh-CN",
  });
  const events = await operatingLogService.listEvents({ category: "work" });
  const expectedSessionKey = `${employee.employeeId}|work_run_execution|${planned.run.id}`;

  assert.equal(dispatch.result?.execution.sessionKey, expectedSessionKey);
  assert.equal(calls[0]?.sessionKey, expectedSessionKey);
  assert.equal(calls[0]?.threadId, planned.run.id);
  assert.equal(calls[0]?.preferredLanguage, "zh-CN");
  assert.equal(dispatch.operatingEvents[0]?.title, "WorkRun dispatched");
  assert.equal(dispatch.operatingEvents[0]?.metadata?.sessionKey, expectedSessionKey);
  assert.equal(events.filter((event) => event.title === "WorkRun dispatched").length, 1);
});
