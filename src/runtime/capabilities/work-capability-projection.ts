import type {
  WorkRunEventRecord,
  WorkRunRecord,
  WorkScheduleRecord,
  WorkTaskDetail,
  WorkTaskRecord,
} from "../../work/domain.js";

export type WorkCapabilityListScope = "mine" | "company";

export interface WorkCapabilityListInput {
  scope: WorkCapabilityListScope;
  currentMemberId?: string;
  ownerMemberId?: string;
  status?: WorkTaskRecord["status"];
  attentionOnly?: boolean;
  limit: number;
  contextSourceIds?: string[];
}

function byRecentUpdate(left: { updatedAt: string; createdAt: string }, right: { updatedAt: string; createdAt: string }) {
  return right.updatedAt.localeCompare(left.updatedAt) || right.createdAt.localeCompare(left.createdAt);
}

function latestRun(runs: WorkRunRecord[]): WorkRunRecord | undefined {
  return [...runs].sort(byRecentUpdate)[0];
}

function primarySchedule(schedules: WorkScheduleRecord[]): WorkScheduleRecord | undefined {
  return [...schedules].sort(byRecentUpdate)[0];
}

function runReason(run: WorkRunRecord): string | undefined {
  return run.blockedReason || run.failedReason || run.canceledReason;
}

function runNeedsAttention(run: WorkRunRecord | undefined): boolean {
  return run?.status === "blocked" || run?.status === "failed";
}

function taskNeedsAttention(task: WorkTaskRecord, run: WorkRunRecord | undefined): boolean {
  return Boolean(task.canceledReason || runNeedsAttention(run));
}

function suggestedNextStep(task: WorkTaskRecord, run: WorkRunRecord | undefined): string {
  if (run?.status === "blocked") {
    return "review_blocked_run";
  }
  if (run?.status === "failed") {
    return "review_failed_run";
  }
  if (run?.status === "in_progress" || run?.status === "queued") {
    return "wait_for_active_run";
  }
  if (task.status === "completed") {
    return "task_completed";
  }
  return "review_task";
}

function summarizeRun(run: WorkRunRecord) {
  return {
    workRunId: run.id,
    status: run.status,
    assigneeMemberId: run.assigneeMemberId,
    taskRevision: run.taskRevision,
    triggeredBy: run.triggeredBy,
    scheduledFor: run.scheduledFor,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    reason: runReason(run),
    resultSummary: run.resultSummary,
    updatedAt: run.updatedAt,
    createdAt: run.createdAt,
  };
}

function summarizeSchedule(schedule: WorkScheduleRecord) {
  return {
    workScheduleId: schedule.id,
    kind: schedule.kind,
    status: schedule.status,
    nextRunAt: schedule.nextRunAt,
    lastRunAt: schedule.lastRunAt,
    runCount: schedule.runCount,
    maxRuns: schedule.maxRuns,
  };
}

export function summarizeWorkTaskForCapability(detail: WorkTaskDetail) {
  const run = latestRun(detail.runs);
  const schedule = primarySchedule(detail.schedules);
  return {
    workTaskId: detail.task.id,
    title: detail.task.title,
    description: detail.task.description,
    status: detail.task.status,
    ownerMemberId: detail.task.ownerMemberId,
    createdByMemberId: detail.task.createdByMemberId,
    sourceKind: detail.task.sourceKind,
    sourceId: detail.task.sourceId,
    sourceChannelTopicId: detail.task.sourceChannelTopicId,
    requesterId: detail.task.requesterId,
    acceptanceCriteria: detail.task.acceptanceCriteria,
    revision: detail.task.revision,
    canceledReason: detail.task.canceledReason,
    latestRun: run ? summarizeRun(run) : undefined,
    scheduleSummary: schedule ? summarizeSchedule(schedule) : undefined,
    needsAttention: taskNeedsAttention(detail.task, run),
    updatedAt: detail.task.updatedAt,
    createdAt: detail.task.createdAt,
  };
}

function isMine(input: WorkCapabilityListInput, detail: WorkTaskDetail): boolean {
  if (!input.currentMemberId) {
    return false;
  }
  if (detail.task.ownerMemberId === input.currentMemberId) {
    return true;
  }
  if (detail.runs.some((run) => run.assigneeMemberId === input.currentMemberId)) {
    return true;
  }
  return input.contextSourceIds?.some((sourceId) =>
    detail.task.sourceId === sourceId ||
    detail.task.sourceChannelTopicId === sourceId ||
    detail.task.metadata?.conversationId === sourceId ||
    detail.task.metadata?.threadId === sourceId ||
    detail.task.metadata?.roomId === sourceId ||
    detail.task.metadata?.chatEntryId === sourceId
  ) ?? false;
}

export function listWorkTasksForCapability(details: WorkTaskDetail[], input: WorkCapabilityListInput) {
  return details
    .filter((detail) => !input.ownerMemberId || detail.task.ownerMemberId === input.ownerMemberId)
    .filter((detail) => !input.status || detail.task.status === input.status)
    .filter((detail) => input.scope === "company" || isMine(input, detail))
    .map(summarizeWorkTaskForCapability)
    .filter((task) => !input.attentionOnly || task.needsAttention)
    .sort(byRecentUpdate)
    .slice(0, input.limit);
}

export function describeWorkTaskForCapability(input: {
  detail: WorkTaskDetail;
  latestRunEvents?: WorkRunEventRecord[];
}) {
  const run = latestRun(input.detail.runs);
  return {
    task: summarizeWorkTaskForCapability(input.detail),
    schedules: input.detail.schedules.map(summarizeSchedule),
    runs: [...input.detail.runs].sort(byRecentUpdate).map(summarizeRun),
    revisions: [...input.detail.revisions]
      .sort((left, right) => right.revision - left.revision)
      .map((revision) => ({
        revision: revision.revision,
        title: revision.title,
        description: revision.description,
        acceptanceCriteria: revision.acceptanceCriteria,
        changedByMemberId: revision.changedByMemberId,
        reason: revision.reason,
        sourceWorkRunId: revision.sourceWorkRunId,
        createdAt: revision.createdAt,
      })),
    latestRunEvents: input.latestRunEvents
      ? [...input.latestRunEvents]
          .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
          .map((event) => ({
            timestamp: event.timestamp,
            eventType: event.eventType,
            actorMemberId: event.actorMemberId,
            summary: event.summary,
          }))
      : undefined,
    needsAttention: taskNeedsAttention(input.detail.task, run),
    suggestedNextStep: suggestedNextStep(input.detail.task, run),
  };
}
