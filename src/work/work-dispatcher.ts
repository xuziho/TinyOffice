import type { WorkRunRecord, WorkTaskRecord } from "./domain.js";
import { WorkDispatchLeaseService, type WorkDispatchLeaseRecord } from "./work-dispatch-lease.js";
import { WorkService } from "./work-service.js";

export interface WorkDispatchPackage {
  workTaskId: string;
  workRunId: string;
  taskRevision: number;
  title: string;
  description?: string;
  assigneeMemberId: string;
  acceptanceCriteria: string;
  source: {
    kind: WorkTaskRecord["sourceKind"];
    id: string;
    channelTopicId?: string;
    requesterId?: string;
  };
}

export interface WorkDispatchCandidate {
  task: WorkTaskRecord;
  run: WorkRunRecord;
  assigneeMemberId: string;
  package: WorkDispatchPackage;
  sessionKey: string;
  pendingLease?: WorkDispatchLeaseRecord;
}

type ExplicitRetryLease = WorkDispatchLeaseRecord & {
  status: "pending";
  retryOfLeaseId: string;
};

function isExplicitRetryLease(lease: WorkDispatchLeaseRecord | undefined): lease is ExplicitRetryLease {
  return lease?.status === "pending" &&
    lease.retryOfLeaseId !== undefined &&
    lease.metadata?.source === "tasks-run-action";
}

export class WorkDispatcher {
  constructor(
    private readonly workService: WorkService,
    private readonly leaseService?: WorkDispatchLeaseService,
  ) {}

  async isAssigneeIdle(assigneeMemberId: string): Promise<boolean> {
    const activeRuns = await this.workService.listWorkRuns({
      assigneeMemberId,
      status: "in_progress",
    });
    return activeRuns.length === 0;
  }

  async findNextDispatchCandidate(): Promise<WorkDispatchCandidate | undefined> {
    const queuedRuns = await this.workService.listWorkRuns({ status: "queued" });
    const oldestQueuedRuns = [...queuedRuns].sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id)
    );

    const candidates: WorkDispatchCandidate[] = [];
    for (const run of oldestQueuedRuns) {
      if (!(await this.isAssigneeIdle(run.assigneeMemberId))) {
        continue;
      }
      let pendingLease: WorkDispatchLeaseRecord | undefined;
      if (this.leaseService) {
        const latestLease = await this.leaseService.getLatestLeaseForWorkRun(run.id);
        if (isExplicitRetryLease(latestLease)) {
          pendingLease = latestLease;
        } else if (latestLease?.status === "pending" || latestLease?.status === "failed") {
          continue;
        }
      }
      const detail = await this.workService.getWorkRunExecutionDetail(run.id);
      if (!detail) {
        continue;
      }
      candidates.push({
        task: detail.task,
        run,
        assigneeMemberId: run.assigneeMemberId,
        package: buildWorkDispatchPackage(detail.task, run),
        sessionKey: buildWorkRunExecutionSessionKey(run),
        pendingLease,
      });
    }
    return candidates.find((candidate) => candidate.pendingLease) || candidates[0];
  }

  async dispatchNext(input: {
    createdBy: string;
  }): Promise<{
    candidate: WorkDispatchCandidate;
    lease?: WorkDispatchLeaseRecord;
  } | undefined> {
    const candidate = await this.findNextDispatchCandidate();
    if (!candidate) {
      return undefined;
    }
    const lease = candidate.pendingLease || (this.leaseService
      ? await this.leaseService.createPendingLease({
          workRunId: candidate.run.id,
          assigneeMemberId: candidate.assigneeMemberId,
          sessionKey: candidate.sessionKey,
          createdBy: input.createdBy,
          metadata: {
            workTaskId: candidate.task.id,
            source: candidate.package.source,
          },
        })
      : undefined);
    return {
      candidate,
      lease,
    };
  }

  async acknowledgeDispatchedWorkRunStart(input: {
    workRunId: string;
    assigneeMemberId: string;
  }): Promise<WorkDispatchLeaseRecord | undefined> {
    return this.leaseService?.acknowledgeWorkRunStart(input);
  }

  async failPendingDispatch(input: {
    workRunId: string;
    reason: string;
  }): Promise<WorkDispatchLeaseRecord | undefined> {
    return this.leaseService?.failPendingLease(input);
  }
}

export function buildWorkRunExecutionSessionKey(run: WorkRunRecord): string {
  return `${run.assigneeMemberId}|work_run_execution|${run.id}`;
}

export function buildWorkDispatchPackage(task: WorkTaskRecord, run: WorkRunRecord): WorkDispatchPackage {
  return {
    workTaskId: task.id,
    workRunId: run.id,
    taskRevision: run.taskRevision,
    title: task.title,
    description: task.description,
    assigneeMemberId: run.assigneeMemberId,
    acceptanceCriteria: task.acceptanceCriteria,
    source: {
      kind: task.sourceKind,
      id: task.sourceId,
      channelTopicId: task.sourceChannelTopicId,
      requesterId: task.requesterId,
    },
  };
}
