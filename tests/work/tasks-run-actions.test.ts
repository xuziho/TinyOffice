import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { beforeEach } from "node:test";

import { CompanyDirectoryRepository } from "../../src/runtime/company-config/company-directory-repository.js";
import { DEFAULT_COMPANY_ID } from "../../src/runtime/company-config/postgres-schema.js";
import { WorkServiceTasksRunActionService } from "../../src/work/tasks-run-actions.js";
import { WorkDispatchLeaseService } from "../../src/work/work-dispatch-lease.js";
import { buildWorkRunExecutionSessionKey } from "../../src/work/work-dispatcher.js";
import type { WorkRunSessionAborter } from "../../src/work/work-cancellation-service.js";
import { WorkService } from "../../src/work/work-service.js";
import { resetRuntimePostgresTables } from "../runtime/postgres-test-utils.js";

beforeEach(resetRuntimePostgresTables);

function createDeterministicClock() {
  let tick = 0;
  return () => `2026-06-27T00:00:${String(tick++).padStart(2, "0")}.000Z`;
}

function createDeterministicIds() {
  let tick = 0;
  return (prefix: string) => `${prefix}-${++tick}`;
}

async function seedEmployee(repoRoot: string, companyId: string) {
  const directory = await CompanyDirectoryRepository.open(repoRoot, { companyId });
  try {
    await directory.upsertEmployee({
      employeeId: "quality-editor",
      enabled: true,
      profile: {
        employeeId: "quality-editor",
        displayName: "Quality Editor",
        role: "quality",
        presenceMode: "resident",
        mountedActions: [],
      },
      permissions: [],
      runtime: { version: 1, modelProvider: "openai", modelId: "gpt-5-codex", thinkingLevel: "minimal" },
    });
    await directory.save();
  } finally {
    directory.close();
  }
}

async function createBlockedWorkRun(
  cancelBlockedRecovery?: (workRunId: string) => Promise<void>,
  abortWorkRunSessions?: WorkRunSessionAborter,
) {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "tinyoffice-tasks-actions-"));
  const companyId = DEFAULT_COMPANY_ID;
  await seedEmployee(repoRoot, companyId);
  const workService = new WorkService({
    repoRoot,
    companyId,
    now: createDeterministicClock(),
    createId: createDeterministicIds(),
  });
  const created = await workService.createWork({
    title: "Check action wiring",
    createdByMemberId: "quality-editor",
    ownerMemberId: "quality-editor",
    sourceKind: "manual",
    sourceId: "task-action-test",
    acceptanceCriteria: "Run action changes persisted state.",
    trigger: { kind: "immediate" },
  });
  assert.ok(created.run);
  await workService.moveWorkRun({
    workRunId: created.run.id,
    actorMemberId: "quality-editor",
    status: "in_progress",
  });
  await workService.moveWorkRun({
    workRunId: created.run.id,
    actorMemberId: "quality-editor",
    status: "blocked",
    reason: "Needs approval.",
  });
  const leaseService = new WorkDispatchLeaseService({ repoRoot, companyId });
  return {
    repoRoot,
    companyId,
    workRunId: created.run.id,
    workService,
    leaseService,
    actionService: new WorkServiceTasksRunActionService({
      repoRoot,
      companyId,
      workService,
      workDispatchLeaseService: leaseService,
      cancelBlockedRecovery,
      abortWorkRunSessions,
    }),
  };
}

test("Tasks Run action service no longer exposes participant resume as a manual action", async () => {
  const { actionService, companyId, workRunId, workService } = await createBlockedWorkRun();

  await assert.rejects(
    actionService.executeTasksRunAction(companyId, {
      requestUrl: new URL(`http://localhost/api/companies/${companyId}/tasks/runs/${workRunId}/actions/resume-from-participant`),
      workRunId,
      actionId: "resume-from-participant" as never,
      actorMemberId: "quality-editor",
    }),
    (error) => {
      assert.equal((error as { statusCode?: number }).statusCode, 404);
      assert.match(String((error as Error).message), /not found/);
      return true;
    },
  );
  assert.equal((await workService.getWorkRunDetail(workRunId))?.run.status, "blocked");
});

test("Tasks Run action service rejects retired stop-execution actions", async () => {
  const { actionService, companyId, workRunId } = await createBlockedWorkRun();

  await assert.rejects(
    actionService.executeTasksRunAction(companyId, {
      requestUrl: new URL(`http://localhost/api/companies/${companyId}/tasks/runs/${workRunId}/actions/stop-execution`),
      workRunId,
      actionId: "stop-execution" as never,
      actorMemberId: "quality-editor",
    }),
    (error) => {
      assert.equal((error as { statusCode?: number }).statusCode, 404);
      assert.match(String((error as Error).message), /not found/);
      return true;
    },
  );
});

test("Tasks Run action service creates a new queued retry for a failed WorkRun", async () => {
  const { actionService, companyId, workRunId, workService } = await createBlockedWorkRun();
  await workService.moveWorkRun({
    workRunId,
    actorMemberId: "quality-editor",
    status: "failed",
    reason: "The upstream source was temporarily unavailable.",
  });

  const result = await actionService.executeTasksRunAction(companyId, {
    requestUrl: new URL(`http://localhost/api/companies/${companyId}/tasks/runs/${workRunId}/actions/retry-run`),
    workRunId,
    actionId: "retry-run",
    actorMemberId: "quality-editor",
  });

  assert.equal(result.actionId, "retry-run");
  assert.equal(result.status, "queued");
  assert.notEqual(result.workRunId, workRunId);
  assert.equal((await workService.getWorkRunDetail(workRunId))?.run.status, "failed");
  assert.equal((await workService.getWorkRunDetail(result.workRunId))?.run.triggeredBy, "retry");
});

test("Tasks Run cancellation closes the linked blocked recovery request", async () => {
  const canceledRecoveryRuns: string[] = [];
  const abortedSessionMatches: boolean[] = [];
  const fixture = await createBlockedWorkRun(
    async (runId) => {
      canceledRecoveryRuns.push(runId);
    },
    async (predicate) => {
      abortedSessionMatches.push(predicate({
        companyId,
        employeeId: "quality-editor",
        sessionKey: `quality-editor|work_run_execution|${fixture.workRunId}`,
      }));
      return 1;
    },
  );
  const { actionService, companyId, workRunId, workService, leaseService } = fixture;
  await leaseService.createPendingLease({
    workRunId,
    assigneeMemberId: "quality-editor",
    sessionKey: buildWorkRunExecutionSessionKey((await workService.getWorkRunDetail(workRunId))!.run),
    createdBy: "test",
  });
  await leaseService.acknowledgeWorkRunStart({
    workRunId,
    assigneeMemberId: "quality-editor",
  });

  const result = await actionService.executeTasksRunAction(companyId, {
    requestUrl: new URL(`http://localhost/api/companies/${companyId}/tasks/runs/${workRunId}/actions/cancel-run`),
    workRunId,
    actionId: "cancel-run",
    actorMemberId: "quality-editor",
  });

  assert.equal(result.status, "canceled");
  assert.deepEqual(canceledRecoveryRuns, [workRunId]);
  assert.deepEqual(abortedSessionMatches, [true]);
  assert.equal((await leaseService.getLatestLeaseForWorkRun(workRunId))?.status, "canceled");
  assert.equal((await workService.getWorkRunDetail(workRunId))?.run.status, "canceled");
});
