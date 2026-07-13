import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { beforeEach } from "node:test";

import { CompanyDirectoryRepository } from "../../src/runtime/company-config/company-directory-repository.js";
import { DEFAULT_COMPANY_ID } from "../../src/runtime/company-config/postgres-schema.js";
import { WorkCancellationService } from "../../src/work/work-cancellation-service.js";
import { WorkService } from "../../src/work/work-service.js";
import { resetRuntimePostgresTables } from "../runtime/postgres-test-utils.js";

beforeEach(resetRuntimePostgresTables);

test("canceling a Task closes its Run ownership and aborts the exact WorkRun session", async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "tinyoffice-work-cancel-"));
  const directory = await CompanyDirectoryRepository.open(repoRoot, { companyId: DEFAULT_COMPANY_ID });
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
  const workService = new WorkService({
    repoRoot,
    companyId: DEFAULT_COMPANY_ID,
  });
  const created = await workService.createWork({
    title: "Cancel active background work",
    createdByMemberId: "operator",
    ownerMemberId: "quality-editor",
    sourceKind: "chat_request",
    sourceId: "message-cancel-work",
    acceptanceCriteria: "The active execution stops without a late result.",
    trigger: { kind: "immediate" },
  });
  assert.ok(created.run);
  await workService.moveWorkRun({
    workRunId: created.run.id,
    actorMemberId: "quality-editor",
    status: "in_progress",
  });

  const canceledLeases: string[] = [];
  const canceledRecoveries: string[][] = [];
  const abortedMatches: boolean[] = [];
  const cancellationService = new WorkCancellationService({
    repoRoot,
    companyId: DEFAULT_COMPANY_ID,
    workService,
    leaseService: {
      async cancelLatestLease(input) {
        canceledLeases.push(input.workRunId);
        return undefined;
      },
    },
    async cancelBlockedRecovery(workRunIds) {
      canceledRecoveries.push(workRunIds);
    },
    async abortSessions(predicate) {
      abortedMatches.push(predicate({
        companyId: DEFAULT_COMPANY_ID,
        employeeId: "quality-editor",
        sessionKey: `quality-editor|work_run_execution|${created.run!.id}`,
      }));
      abortedMatches.push(predicate({
        companyId: DEFAULT_COMPANY_ID,
        employeeId: "quality-editor",
        sessionKey: "quality-editor|work_run_execution|another-run",
      }));
      return 1;
    },
  });

  const detail = await cancellationService.cancelWorkTask({
    workTaskId: created.task.id,
    actorMemberId: "operator",
    reason: "The operator withdrew the request.",
  });

  assert.equal(detail.task.status, "canceled");
  assert.equal(detail.runs[0]?.status, "canceled");
  assert.deepEqual(canceledLeases, [created.run.id]);
  assert.deepEqual(canceledRecoveries, [[created.run.id]]);
  assert.deepEqual(abortedMatches, [true, false]);
});
