import { createDbCompanyGovernanceServices } from "../../governance/services/company-governance-services.js";
import { WorkCancellationService } from "../../work/work-cancellation-service.js";
import { WorkService } from "../../work/work-service.js";
import type { RuntimeProvider } from "../provider/contracts.js";
import { abortNaturalLanguageEmployeeSessions } from "../provider/natural-language-responder-runtime.js";
import {
  setEmployeeRuntimeEnabled,
  type EmployeesAdminState,
} from "./employees-admin.js";

export interface SetMemberRuntimeLifecycleInput {
  repoRoot: string;
  companyId: string;
  memberId: string;
  actorMemberId: string;
  enabled: boolean;
  runtimeProvider?: RuntimeProvider;
}

export async function setMemberRuntimeLifecycle(
  input: SetMemberRuntimeLifecycleInput,
): Promise<EmployeesAdminState> {
  if (input.enabled) {
    return setEmployeeRuntimeEnabled({
      repoRoot: input.repoRoot,
      companyId: input.companyId,
      employeeId: input.memberId,
      enabled: true,
    });
  }

  const state = await setEmployeeRuntimeEnabled({
    repoRoot: input.repoRoot,
    companyId: input.companyId,
    employeeId: input.memberId,
    enabled: false,
  });
  const reason = `Runtime-capable member ${input.memberId} was deactivated.`;

  const abortSessions = input.runtimeProvider
    ? (predicate: Parameters<RuntimeProvider["abortWhere"]>[0]) => input.runtimeProvider!.abortWhere(predicate)
    : abortNaturalLanguageEmployeeSessions;
  await abortSessions(({ companyId, employeeId }) =>
    companyId === input.companyId && employeeId === input.memberId
  );

  const workService = new WorkService({
    repoRoot: input.repoRoot,
    companyId: input.companyId,
  });
  const cancellation = new WorkCancellationService({
    repoRoot: input.repoRoot,
    companyId: input.companyId,
    workService,
    abortSessions,
  });

  for (const task of await workService.listWorkTasks({
    ownerMemberId: input.memberId,
    status: "active",
  })) {
    await cancellation.cancelWorkTask({
      workTaskId: task.id,
      actorMemberId: input.actorMemberId,
      reason,
    });
  }

  const activeRuns = (
    await Promise.all([
      workService.listWorkRuns({ assigneeMemberId: input.memberId, status: "queued" }),
      workService.listWorkRuns({ assigneeMemberId: input.memberId, status: "in_progress" }),
      workService.listWorkRuns({ assigneeMemberId: input.memberId, status: "blocked" }),
    ])
  ).flat();
  for (const run of activeRuns) {
    await cancellation.cancelWorkRun({
      workRunId: run.id,
      actorMemberId: input.actorMemberId,
      reason,
    });
  }

  const governance = await createDbCompanyGovernanceServices(input.repoRoot, {
    companyId: input.companyId,
  });
  try {
    await governance.approvalService.cancelPendingApprovalsForMember({
      memberId: input.memberId,
      reason,
    });
    await governance.approvalService.revokeGrantsForMember(input.memberId);
  } finally {
    governance.store.close?.();
  }

  return state;
}
