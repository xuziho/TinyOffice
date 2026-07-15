import type { TasksAction } from "./tasks-view-model.js";
import { buildTasksRunActions, type TasksViewModelRoutes } from "./tasks-view-model.js";
import {
  WorkCancellationService,
  type WorkRunSessionAborter,
} from "./work-cancellation-service.js";
import { WorkDispatchLeaseService } from "./work-dispatch-lease.js";
import { WorkService } from "./work-service.js";
import type { WorkRunStatus } from "./domain.js";

export type TasksRunActionId = TasksAction["id"];

export interface ExecuteTasksRunActionInput {
  requestUrl: URL;
  workRunId: string;
  actionId: TasksRunActionId;
  actorMemberId: string;
  reason?: string;
}

export interface TasksRunActionResult {
  accepted: true;
  actionId: TasksRunActionId;
  workRunId: string;
  status: WorkRunStatus;
  message: string;
}

export interface TasksRunActionService {
  executeTasksRunAction(companyId: string, input: ExecuteTasksRunActionInput): Promise<TasksRunActionResult>;
}

export interface WorkServiceTasksRunActionServiceConfig {
  repoRoot: string;
  companyId?: string;
  workService?: WorkService;
  workDispatchLeaseService?: WorkDispatchLeaseService;
  workCancellationService?: WorkCancellationService;
  abortWorkRunSessions?: WorkRunSessionAborter;
  cancelBlockedRecovery?(workRunId: string): Promise<void>;
}

function statusError(message: string, statusCode: number): Error & { statusCode: number } {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

function actorMemberId(input: ExecuteTasksRunActionInput): string {
  const value = input.actorMemberId?.trim();
  if (!value) {
    throw new Error("actorMemberId is required");
  }
  return value;
}

function reason(input: ExecuteTasksRunActionInput, fallback: string): string {
  return input.reason?.trim() || fallback;
}

export class WorkServiceTasksRunActionService implements TasksRunActionService {
  constructor(private readonly config: WorkServiceTasksRunActionServiceConfig) {}

  async executeTasksRunAction(companyId: string, input: ExecuteTasksRunActionInput): Promise<TasksRunActionResult> {
    const authenticatedActorMemberId = actorMemberId(input);
    const scopedCompanyId = this.config.companyId || companyId;
    const workService = this.config.workService || new WorkService({
      repoRoot: this.config.repoRoot,
      companyId: scopedCompanyId,
    });
    const leaseService = this.config.workDispatchLeaseService || new WorkDispatchLeaseService({
      repoRoot: this.config.repoRoot,
      companyId: scopedCompanyId,
    });
    const runDetail = await workService.getWorkRunDetail(input.workRunId);
    if (!runDetail) {
      throw statusError(`WorkRun not found: ${input.workRunId}`, 404);
    }
    const routes: TasksViewModelRoutes = {
      htmlPath: "/tasks",
      viewModelJsonPath: `/api/companies/${encodeURIComponent(scopedCompanyId)}/tasks/view-model`,
      runActionPathPrefix: `/api/companies/${encodeURIComponent(scopedCompanyId)}/tasks/runs`,
    };
    const latestLease = await leaseService.getLatestLeaseForWorkRun(input.workRunId);
    const actions = buildTasksRunActions(runDetail.run, latestLease, routes);
    const action = actions.find((candidate) => candidate.id === input.actionId);
    if (!action) {
      throw statusError(`Tasks Run action not found: ${input.actionId}`, 404);
    }
    if (!action.enabled) {
      throw statusError(action.reason || `Tasks Run action ${input.actionId} is disabled.`, 409);
    }

    if (input.actionId === "retry-dispatch") {
      if (!latestLease || latestLease.status !== "failed") {
        throw statusError("Retry dispatch requires a failed dispatch lease.", 409);
      }
      await leaseService.createPendingLease({
        workRunId: input.workRunId,
        assigneeMemberId: latestLease.assigneeMemberId,
        sessionKey: latestLease.sessionKey,
        createdBy: authenticatedActorMemberId,
        retryOfLeaseId: latestLease.id,
        metadata: {
          actionId: input.actionId,
          source: "tasks-run-action",
        },
      });
      return {
        accepted: true,
        actionId: input.actionId,
        workRunId: input.workRunId,
        status: runDetail.run.status,
        message: "Retry dispatch accepted.",
      };
    }

    if (input.actionId === "retry-run") {
      const retriedRun = await workService.retryWorkRun({
        workRunId: input.workRunId,
        actorMemberId: authenticatedActorMemberId,
      });
      return {
        accepted: true,
        actionId: input.actionId,
        workRunId: retriedRun.id,
        status: retriedRun.status,
        message: `Created retry WorkRun ${retriedRun.id}.`,
      };
    }

    const cancellationService = this.config.workCancellationService || new WorkCancellationService({
      repoRoot: this.config.repoRoot,
      companyId: scopedCompanyId,
      workService,
      leaseService,
      abortSessions: this.config.abortWorkRunSessions,
      cancelBlockedRecovery: this.config.cancelBlockedRecovery
        ? async (workRunIds) => {
            for (const workRunId of workRunIds) {
              await this.config.cancelBlockedRecovery?.(workRunId);
            }
          }
        : undefined,
    });
    const updated = await cancellationService.cancelWorkRun({
      workRunId: input.workRunId,
      actorMemberId: authenticatedActorMemberId,
      reason: reason(input, "Canceled from Tasks Run action."),
      summary: `${action.label} accepted from Tasks Run actions.`,
    });
    return {
      accepted: true,
      actionId: input.actionId,
      workRunId: input.workRunId,
      status: updated.status,
      message: `${action.label} accepted.`,
    };
  }
}
