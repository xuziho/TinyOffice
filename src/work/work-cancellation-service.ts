import { abortNaturalLanguageEmployeeSessions } from "../runtime/provider/natural-language-responder-runtime.js";
import type { WorkRunRecord, WorkTaskDetail } from "./domain.js";
import { WorkDispatchLeaseService } from "./work-dispatch-lease.js";
import { buildWorkRunExecutionSessionKey } from "./work-dispatcher.js";
import { cancelOpenWorkBlockedRecoveryRequests } from "./work-blocked-recovery-request.js";
import { WorkService, type WorkTaskLifecycleInput } from "./work-service.js";

export type WorkRunSessionAborter = (
  predicate: (input: { companyId: string; employeeId: string; sessionKey: string }) => boolean,
) => Promise<number>;

export interface WorkCancellationServiceConfig {
  repoRoot: string;
  companyId: string;
  workService?: WorkService;
  leaseService?: Pick<WorkDispatchLeaseService, "cancelLatestLease">;
  abortSessions?: WorkRunSessionAborter;
  cancelBlockedRecovery?(workRunIds: string[]): Promise<void>;
}

export interface CancelWorkRunInput {
  workRunId: string;
  actorMemberId: string;
  reason: string;
  summary?: string;
}

function isCleanupCandidate(run: WorkRunRecord): boolean {
  return run.status === "queued" ||
    run.status === "in_progress" ||
    run.status === "blocked" ||
    run.status === "canceled";
}

export class WorkCancellationService {
  private readonly workService: WorkService;
  private readonly leaseService: Pick<WorkDispatchLeaseService, "cancelLatestLease">;
  private readonly abortSessions: WorkRunSessionAborter;

  constructor(private readonly config: WorkCancellationServiceConfig) {
    this.workService = config.workService || new WorkService({
      repoRoot: config.repoRoot,
      companyId: config.companyId,
    });
    this.leaseService = config.leaseService || new WorkDispatchLeaseService({
      repoRoot: config.repoRoot,
      companyId: config.companyId,
    });
    this.abortSessions = config.abortSessions || abortNaturalLanguageEmployeeSessions;
  }

  async cancelWorkTask(input: WorkTaskLifecycleInput): Promise<WorkTaskDetail> {
    const before = await this.workService.getWorkTaskDetail(input.workTaskId);
    if (!before) {
      throw new Error(`WorkTask not found: ${input.workTaskId}`);
    }
    const detail = await this.workService.cancelWorkTask(input);
    const cleanupRuns = before.runs.filter(isCleanupCandidate);
    await this.cleanupRuns(cleanupRuns, input.reason || "WorkTask canceled.");
    return detail;
  }

  async cancelWorkRun(input: CancelWorkRunInput): Promise<WorkRunRecord> {
    const detail = await this.workService.getWorkRunDetail(input.workRunId);
    if (!detail) {
      throw new Error(`WorkRun not found: ${input.workRunId}`);
    }
    if (detail.run.status === "done" || detail.run.status === "failed") {
      throw new Error(`Cannot cancel terminal WorkRun ${detail.run.id} while it is ${detail.run.status}.`);
    }
    const updated = detail.run.status === "canceled"
      ? detail.run
      : await this.workService.moveWorkRun({
          workRunId: input.workRunId,
          actorMemberId: input.actorMemberId,
          status: "canceled",
          reason: input.reason,
          summary: input.summary,
        });
    await this.cleanupRuns([updated], input.reason);
    return updated;
  }

  private async cleanupRuns(runs: WorkRunRecord[], reason: string): Promise<void> {
    if (runs.length === 0) {
      return;
    }
    const workRunIds = runs.map((run) => run.id);
    for (const run of runs) {
      await this.leaseService.cancelLatestLease({
        workRunId: run.id,
        reason,
      });
    }
    if (this.config.cancelBlockedRecovery) {
      await this.config.cancelBlockedRecovery(workRunIds);
    } else {
      await cancelOpenWorkBlockedRecoveryRequests({
        repoRoot: this.config.repoRoot,
        companyId: this.config.companyId,
        workRunIds,
      });
    }
    for (const run of runs) {
      const sessionKey = buildWorkRunExecutionSessionKey(run);
      await this.abortSessions(({ companyId, employeeId, sessionKey: candidateSessionKey }) =>
        companyId === this.config.companyId &&
        employeeId === run.assigneeMemberId && candidateSessionKey === sessionKey
      );
    }
  }
}
