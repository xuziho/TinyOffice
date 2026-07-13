import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createDbCompanyGovernanceServices } from "../../src/governance/services/company-governance-services.js";
import { createCompany } from "../../src/runtime/company-config/companies-admin.js";
import { CompanyDirectoryRepository } from "../../src/runtime/company-config/company-directory-repository.js";
import { setMemberRuntimeLifecycle } from "../../src/runtime/company-config/member-runtime-lifecycle-service.js";
import type { RuntimeProvider } from "../../src/runtime/provider/contracts.js";
import { WorkService } from "../../src/work/work-service.js";
import { resetRuntimePostgresTables } from "./postgres-test-utils.js";

test("member runtime deactivation cancels active work, runtime sessions, pending Access, and grants", async () => {
  await resetRuntimePostgresTables();
  const repoRoot = await mkdtemp(path.join(tmpdir(), "tinyoffice-member-lifecycle-"));
  const companyId = "member-lifecycle-company";
  const memberId = "lifecycle-worker";
  try {
    await createCompany({ repoRoot, companyId, displayName: "Member Lifecycle Company" });
    const directory = await CompanyDirectoryRepository.open(repoRoot, { companyId });
    try {
      await directory.upsertEmployee({
        employeeId: memberId,
        enabled: true,
        profile: {
          employeeId: memberId,
          displayName: "Lifecycle Worker",
          role: "operations",
          presenceMode: "resident",
        },
        resourcePolicy: {},
        runtime: { version: 1, modelProvider: "openai", modelId: "gpt-5-codex", thinkingLevel: "minimal" },
      });
    } finally {
      directory.close();
    }

    const workService = new WorkService({ repoRoot, companyId });
    const work = await workService.createWork({
      title: "Lifecycle work",
      createdByMemberId: "operator",
      ownerMemberId: memberId,
      sourceKind: "chat_request",
      sourceId: "conversation-lifecycle",
      acceptanceCriteria: "Work is canceled when the runtime member is deactivated.",
      trigger: { kind: "immediate" },
    });

    const governance = await createDbCompanyGovernanceServices(repoRoot, { companyId });
    try {
      const approved = await governance.approvalService.createApproval({
        contextKind: "dm_thread",
        contextId: "conversation-approved",
        sessionKey: `${memberId}|dm_thread|conversation-approved`,
        requestedByMemberId: memberId,
        requestedAction: "read.file",
        reason: "Read a file.",
      });
      await governance.approvalService.resolveApproval(approved.id, "approved", { grantScope: "session" });
      await governance.approvalService.createApproval({
        contextKind: "work_run",
        contextId: work.run!.id,
        sessionKey: `${memberId}|work_run_execution|${work.run!.id}`,
        requestedByMemberId: memberId,
        requestedAction: "write.file",
        reason: "Write a file.",
      });
    } finally {
      governance.store.close?.();
    }

    const aborted: Array<{ companyId: string; employeeId: string; sessionKey: string }> = [];
    const sessions = [
      { companyId, employeeId: memberId, sessionKey: `${memberId}|dm_thread|conversation-approved` },
      { companyId: "other-company", employeeId: memberId, sessionKey: `${memberId}|dm_thread|other` },
    ];
    const runtimeProvider: RuntimeProvider = {
      providerId: "lifecycle-test",
      async warm() {},
      async reply() { return "ok"; },
      async abortWhere(predicate) {
        for (const session of sessions) {
          if (predicate(session)) aborted.push(session);
        }
        return aborted.length;
      },
      async reloadWhere() { return { reloadedCount: 0, sessionKeys: [] }; },
    };

    const state = await setMemberRuntimeLifecycle({
      repoRoot,
      companyId,
      memberId,
      actorMemberId: "operator",
      enabled: false,
      runtimeProvider,
    });

    assert.equal(state.employees.find((employee) => employee.employeeId === memberId)?.enabled, false);
    assert.equal((await workService.getWorkTaskDetail(work.task.id))?.task.status, "canceled");
    assert.equal((await workService.getWorkRunDetail(work.run!.id))?.run.status, "canceled");
    assert.equal(aborted.some((session) => session.companyId === companyId), true);
    assert.equal(aborted.some((session) => session.companyId === "other-company"), false);

    const afterGovernance = await createDbCompanyGovernanceServices(repoRoot, { companyId });
    try {
      assert.equal(
        (await afterGovernance.approvalRepository.list()).filter((approval) => approval.status === "pending").length,
        0,
      );
      assert.equal((await afterGovernance.approvalRepository.listGrants()).length, 0);
    } finally {
      afterGovernance.store.close?.();
    }
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});
