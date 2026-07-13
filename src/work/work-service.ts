import { randomUUID } from "node:crypto";

import type {
  WorkRunDetail,
  WorkRunEventRecord,
  WorkRunRecord,
  WorkRunStatus,
  WorkScheduleRecord,
  WorkSourceKind,
  WorkTaskDetail,
  WorkTaskRecord,
  WorkTaskRevisionRecord,
  WorkTaskStatus,
  WorkTriggerKind,
} from "./domain.js";
import { CompanyDirectoryRepository } from "../runtime/company-config/company-directory-repository.js";
import { WorkRepository } from "./work-repository.js";

export class WorkAssigneeUnavailableError extends Error {
  readonly statusCode = 409;

  constructor(memberId: string) {
    super(`Work assignee ${memberId} is not an active runtime-capable member in this Company.`);
    this.name = "WorkAssigneeUnavailableError";
  }
}

export interface WorkServiceConfig {
  repoRoot: string;
  companyId: string;
  now?: () => string;
  createId?: (prefix: string) => string;
  observer?: WorkServiceObserver;
  onWorkRunTerminal?(run: WorkRunRecord): Promise<void>;
}

export interface WorkServiceObserver {
  workTaskChanged?(event: { companyId: string; task: WorkTaskRecord }): void;
  workRunChanged?(event: { companyId: string; run: WorkRunRecord }): void;
}

export interface CreateWorkTriggerInput {
  kind: WorkTriggerKind;
  scheduledFor?: string;
  timezone?: string;
  intervalMs?: number;
  cron?: string;
  rrule?: string;
}

export interface CreateWorkInput {
  title: string;
  description?: string;
  createdByMemberId: string;
  ownerMemberId: string;
  sourceKind: WorkSourceKind;
  sourceId: string;
  sourceChannelTopicId?: string;
  requesterId?: string;
  acceptanceCriteria: string;
  trigger: CreateWorkTriggerInput;
  maxRuns?: number;
  metadata?: Record<string, unknown>;
}

export interface CreateWorkResult {
  task: WorkTaskRecord;
  schedule?: WorkScheduleRecord;
  run?: WorkRunRecord;
}

export interface MoveWorkRunInput {
  workRunId: string;
  actorMemberId: string;
  status: WorkRunStatus;
  summary?: string;
  reason?: string;
  evidence?: string;
}

export interface MoveWorkScheduleInput {
  workScheduleId: string;
  actorMemberId: string;
  status: "enabled" | "paused" | "canceled";
  reason?: string;
}

export interface WorkTaskLifecycleInput {
  workTaskId: string;
  actorMemberId: string;
  reason?: string;
}

export interface RetryWorkRunInput {
  workRunId: string;
  actorMemberId: string;
  assigneeMemberId?: string;
}

export interface ReviseWorkTaskInput {
  workTaskId: string;
  actorMemberId: string;
  reason: string;
  title?: string;
  description?: string;
  acceptanceCriteria?: string;
  sourceWorkRunId?: string;
}

export interface RecordWorkRunEventInput {
  workRunId: string;
  actorMemberId: string;
  eventType: string;
  summary: string;
  metadata?: Record<string, unknown>;
}

export interface CreateDueWorkRunInput {
  workScheduleId: string;
  actorMemberId: string;
}

export interface CreateDueWorkRunResult {
  task: WorkTaskRecord;
  schedule: WorkScheduleRecord;
  run: WorkRunRecord;
  created: boolean;
}

export interface WorkRunExecutionDetail {
  task: WorkTaskRecord;
  schedule?: WorkScheduleRecord;
  run: WorkRunRecord;
  events: WorkRunEventRecord[];
}

const allowedRunTransitions: Record<WorkRunStatus, WorkRunStatus[]> = {
  queued: ["in_progress", "canceled"],
  in_progress: ["blocked", "done", "failed", "canceled"],
  blocked: ["blocked", "in_progress", "done", "failed", "canceled"],
  done: [],
  failed: [],
  canceled: [],
};

const allowedScheduleTransitions: Record<WorkScheduleRecord["status"], WorkScheduleRecord["status"][]> = {
  enabled: ["paused", "canceled", "completed"],
  paused: ["enabled", "canceled", "completed"],
  completed: [],
  canceled: [],
};

function defaultCreateId(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

function requireText(value: string | undefined, fieldName: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${fieldName} is required.`);
  }
  return normalized;
}

function optionalText(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

function requireIsoTimestamp(value: string | undefined, fieldName: string): string {
  const normalized = requireText(value, fieldName);
  if (Number.isNaN(Date.parse(normalized))) {
    throw new Error(`${fieldName} must be a valid ISO timestamp.`);
  }
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized)) {
    throw new Error(`${fieldName} must include an explicit UTC offset or Z.`);
  }
  return new Date(normalized).toISOString();
}

function validateWorkTrigger(input: CreateWorkInput): void {
  if (input.trigger.kind === "scheduled_once") {
    requireIsoTimestamp(input.trigger.scheduledFor, "trigger.scheduledFor");
  }
  if (input.trigger.kind === "recurring") {
    requireIsoTimestamp(input.trigger.scheduledFor, "trigger.scheduledFor");
    if (typeof input.trigger.intervalMs !== "number" || !Number.isFinite(input.trigger.intervalMs) || input.trigger.intervalMs <= 0) {
      throw new Error("recurring work requires a positive trigger.intervalMs.");
    }
  }
  if (input.maxRuns !== undefined && (!Number.isInteger(input.maxRuns) || input.maxRuns <= 0)) {
    throw new Error("maxRuns must be a positive integer.");
  }
}

function eventTypeForStatus(status: WorkRunStatus): string {
  switch (status) {
    case "in_progress":
      return "started";
    case "done":
      return "completed";
    default:
      return status;
  }
}

function statusReasonField(status: WorkRunStatus) {
  return status === "blocked" || status === "failed" || status === "canceled";
}

function isTerminalRunStatus(status: WorkRunStatus) {
  return status === "done" || status === "failed" || status === "canceled";
}

function isInactiveTaskStatus(status: WorkTaskStatus) {
  return status === "completed" || status === "canceled";
}

function metadataText(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" ? value : undefined;
}

function previousArchivedTaskStatus(task: WorkTaskRecord): WorkTaskStatus {
  const previous = metadataText(task.metadata, "archivedFromStatus");
  if (previous === "active" || previous === "completed" || previous === "canceled") {
    return previous;
  }
  return "canceled";
}

function shouldCreateSchedule(scheduleKind: WorkTriggerKind) {
  return scheduleKind === "scheduled_once" || scheduleKind === "recurring";
}

function isOneShotWork(input: {
  task: WorkTaskRecord;
  schedule?: WorkScheduleRecord;
  runsForTask: WorkRunRecord[];
}) {
  if (input.schedule) {
    return input.schedule.kind === "scheduled_once";
  }
  return input.runsForTask.some((candidate) => candidate.createdAt === input.task.createdAt);
}

function taskStatusForTerminalRun(status: WorkRunStatus): WorkTaskStatus {
  if (status === "done") {
    return "completed";
  }
  if (status === "canceled") {
    return "canceled";
  }
  return "active";
}

function nextRunAtForSchedule(schedule: WorkScheduleRecord, dueAt: string): string | undefined {
  if (schedule.kind !== "recurring") {
    return undefined;
  }
  const intervalMs = schedule.scheduleRule?.intervalMs;
  if (typeof intervalMs !== "number" || !Number.isFinite(intervalMs) || intervalMs <= 0) {
    return undefined;
  }
  return new Date(Date.parse(dueAt) + intervalMs).toISOString();
}

export class WorkService {
  private readonly now: () => string;
  private readonly createId: (prefix: string) => string;

  constructor(private readonly config: WorkServiceConfig) {
    this.now = config.now || (() => new Date().toISOString());
    this.createId = config.createId || defaultCreateId;
  }

  private async requireActiveRuntimeMember(memberId: string): Promise<string> {
    const normalizedMemberId = requireText(memberId, "assigneeMemberId");
    const directory = await CompanyDirectoryRepository.open(this.config.repoRoot, {
      companyId: this.config.companyId,
    });
    try {
      const member = (await directory.loadEmployees()).find((candidate) =>
        candidate.employeeId === normalizedMemberId
      );
      if (!member?.enabled) {
        throw new WorkAssigneeUnavailableError(normalizedMemberId);
      }
      return normalizedMemberId;
    } finally {
      directory.close();
    }
  }

  async createWork(input: CreateWorkInput): Promise<CreateWorkResult> {
    const timestamp = this.now();
    const scheduleKind = input.trigger.kind;
    validateWorkTrigger(input);
    const scheduledFor = shouldCreateSchedule(scheduleKind)
      ? requireIsoTimestamp(input.trigger.scheduledFor, "trigger.scheduledFor")
      : undefined;
    if (!shouldCreateSchedule(scheduleKind) && input.maxRuns !== undefined) {
      throw new Error("maxRuns belongs to a WorkSchedule and requires scheduled_once or recurring work.");
    }
    const ownerMemberId = await this.requireActiveRuntimeMember(input.ownerMemberId);

    const workTaskId = this.createId("work-task");
    const workScheduleId = shouldCreateSchedule(scheduleKind) ? this.createId("work-schedule") : undefined;
    const runId = scheduleKind === "immediate" ? this.createId("work-run") : undefined;
    const createdEventId = scheduleKind === "immediate" ? this.createId("work-run-event") : undefined;

    const repository = await WorkRepository.open(this.config.repoRoot, { companyId: this.config.companyId });
    try {
      const task = repository.createWorkTask({
        id: workTaskId,
        title: requireText(input.title, "title"),
        description: optionalText(input.description),
        status: "active",
        createdByMemberId: requireText(input.createdByMemberId, "createdByMemberId"),
        ownerMemberId,
        sourceKind: input.sourceKind,
        sourceId: requireText(input.sourceId, "sourceId"),
        sourceChannelTopicId: optionalText(input.sourceChannelTopicId),
        requesterId: optionalText(input.requesterId),
        acceptanceCriteria: requireText(input.acceptanceCriteria, "acceptanceCriteria"),
        revision: 1,
        metadata: {
          ...(input.metadata || {}),
        },
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      const schedule = workScheduleId
        ? repository.createWorkSchedule({
            id: workScheduleId,
            workTaskId: task.id,
            status: "enabled",
            kind: scheduleKind,
            timezone: optionalText(input.trigger.timezone),
            scheduleRule: {
              ...(scheduledFor ? { scheduledFor } : {}),
              ...(input.trigger.intervalMs ? { intervalMs: input.trigger.intervalMs } : {}),
              ...(optionalText(input.trigger.cron) ? { cron: optionalText(input.trigger.cron) } : {}),
              ...(optionalText(input.trigger.rrule) ? { rrule: optionalText(input.trigger.rrule) } : {}),
            },
            nextRunAt: scheduledFor,
            runCount: 0,
            maxRuns: input.maxRuns,
            createdAt: timestamp,
            updatedAt: timestamp,
          })
        : undefined;

      let run: WorkRunRecord | undefined;
      if (scheduleKind === "immediate") {
        run = repository.createWorkRun({
          id: runId as string,
          workTaskId: task.id,
          status: "queued",
          assigneeMemberId: task.ownerMemberId,
          taskRevision: task.revision,
          triggeredBy: "immediate",
          scheduledFor: timestamp,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        repository.appendWorkRunEvent({
          id: createdEventId as string,
          workRunId: run.id,
          timestamp,
          actorMemberId: task.createdByMemberId,
          eventType: "created",
          summary: `Created WorkRun for ${task.ownerMemberId}.`,
          metadata: {
            workTaskId: task.id,
            scheduleKind,
          },
        });
      }

      await repository.save();
      this.notifyWorkTaskChanged(repository.getWorkTask(task.id) as WorkTaskRecord);
      if (run) {
        this.notifyWorkRunChanged(run);
      }
      return {
        task: repository.getWorkTask(task.id) as WorkTaskRecord,
        schedule: schedule ? repository.getWorkSchedule(schedule.id) : undefined,
        run,
      };
    } finally {
      repository.close();
    }
  }

  async getWorkTaskDetail(workTaskId: string): Promise<WorkTaskDetail | undefined> {
    const repository = await WorkRepository.open(this.config.repoRoot, { companyId: this.config.companyId });
    try {
      const task = repository.getWorkTask(workTaskId);
      return task
        ? {
            task,
            revisions: repository.listWorkTaskRevisions(workTaskId),
            schedules: repository.listWorkSchedules({ workTaskId }),
            runs: repository.listWorkRuns({ workTaskId }),
          }
        : undefined;
    } finally {
      repository.close();
    }
  }

  async listWorkTasks(input: {
    ownerMemberId?: string;
    status?: WorkTaskStatus;
  } = {}): Promise<WorkTaskRecord[]> {
    const repository = await WorkRepository.open(this.config.repoRoot, { companyId: this.config.companyId });
    try {
      return repository.listWorkTasks(input);
    } finally {
      repository.close();
    }
  }

  async listWorkSchedules(input: {
    workTaskId?: string;
    status?: WorkScheduleRecord["status"];
  } = {}): Promise<WorkScheduleRecord[]> {
    const repository = await WorkRepository.open(this.config.repoRoot, { companyId: this.config.companyId });
    try {
      return repository.listWorkSchedules(input);
    } finally {
      repository.close();
    }
  }

  async listDueWorkSchedules(input: {
    dueAt?: string;
    limit?: number;
  } = {}): Promise<WorkScheduleRecord[]> {
    const dueAt = input.dueAt || this.now();
    const repository = await WorkRepository.open(this.config.repoRoot, { companyId: this.config.companyId });
    try {
      return repository.listWorkSchedules({ status: "enabled" })
        .filter((schedule) => Boolean(schedule.nextRunAt) && (schedule.nextRunAt as string) <= dueAt)
        .sort((left, right) =>
          (left.nextRunAt || "").localeCompare(right.nextRunAt || "") ||
          left.id.localeCompare(right.id)
        )
        .slice(0, input.limit ?? 50);
    } finally {
      repository.close();
    }
  }

  async createDueWorkRun(input: CreateDueWorkRunInput): Promise<CreateDueWorkRunResult> {
    const timestamp = this.now();
    const repository = await WorkRepository.open(this.config.repoRoot, { companyId: this.config.companyId });
    try {
      const schedule = repository.getWorkSchedule(input.workScheduleId);
      if (!schedule) {
        throw new Error(`WorkSchedule not found: ${input.workScheduleId}`);
      }
      if (schedule.status !== "enabled") {
        throw new Error(`WorkSchedule ${input.workScheduleId} is ${schedule.status}, not enabled.`);
      }
      if (!schedule.nextRunAt || schedule.nextRunAt > timestamp) {
        throw new Error(`WorkSchedule ${input.workScheduleId} is not due.`);
      }
      const task = repository.getWorkTask(schedule.workTaskId);
      if (!task) {
        throw new Error(`WorkTask not found for WorkSchedule ${input.workScheduleId}: ${schedule.workTaskId}`);
      }
      await this.requireActiveRuntimeMember(task.ownerMemberId);
      const existing = repository.listWorkRuns({ workTaskId: task.id })
        .find((run) =>
          run.scheduledFor === schedule.nextRunAt &&
          (run.triggeredBy === "schedule" || run.triggeredBy === "recurrence")
        );
      if (existing) {
        return {
          task,
          schedule,
          run: existing,
          created: false,
        };
      }

      const dueAt = schedule.nextRunAt;
      const run = repository.createWorkRun({
        id: this.createId("work-run"),
        workTaskId: task.id,
        status: "queued",
        assigneeMemberId: task.ownerMemberId,
        taskRevision: task.revision,
        triggeredBy: schedule.kind === "recurring" ? "recurrence" : "schedule",
        scheduledFor: dueAt,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      repository.appendWorkRunEvent({
        id: this.createId("work-run-event"),
        workRunId: run.id,
        timestamp,
        actorMemberId: requireText(input.actorMemberId, "actorMemberId"),
        eventType: "created",
        summary: `Created WorkRun from due WorkSchedule ${schedule.id}.`,
        metadata: {
          workTaskId: task.id,
          workScheduleId: schedule.id,
          dueAt,
          scheduleKind: schedule.kind,
        },
      });

      const incrementedSchedule = repository.getWorkSchedule(schedule.id) || schedule;
      const nextRunAt = nextRunAtForSchedule(schedule, dueAt);
      const maxRunsReached = incrementedSchedule.maxRuns !== undefined && incrementedSchedule.runCount >= incrementedSchedule.maxRuns;
      const updatedSchedule = repository.updateWorkSchedule({
        ...incrementedSchedule,
        status: schedule.kind === "scheduled_once" || maxRunsReached ? "completed" : incrementedSchedule.status,
        nextRunAt: schedule.kind === "scheduled_once" || maxRunsReached ? undefined : nextRunAt,
        completedAt: schedule.kind === "scheduled_once" || maxRunsReached ? timestamp : incrementedSchedule.completedAt,
        updatedAt: timestamp,
      });
      await repository.save();
      this.notifyWorkRunChanged(run);
      return {
        task,
        schedule: updatedSchedule,
        run,
        created: true,
      };
    } finally {
      repository.close();
    }
  }

  async getWorkRunDetail(workRunId: string): Promise<WorkRunDetail | undefined> {
    const repository = await WorkRepository.open(this.config.repoRoot, { companyId: this.config.companyId });
    try {
      const run = repository.getWorkRun(workRunId);
      return run
        ? {
            run,
            events: repository.listWorkRunEvents(workRunId),
          }
        : undefined;
    } finally {
      repository.close();
    }
  }

  async getWorkRunExecutionDetail(workRunId: string): Promise<WorkRunExecutionDetail | undefined> {
    const repository = await WorkRepository.open(this.config.repoRoot, { companyId: this.config.companyId });
    try {
      const run = repository.getWorkRun(workRunId);
      if (!run) {
        return undefined;
      }
      const task = repository.getWorkTask(run.workTaskId);
      if (!task) {
        return undefined;
      }
      return {
        task,
        schedule: repository.listWorkSchedules({ workTaskId: task.id })[0],
        run,
        events: repository.listWorkRunEvents(workRunId),
      };
    } finally {
      repository.close();
    }
  }

  async listWorkRuns(input: {
    workTaskId?: string;
    assigneeMemberId?: string;
    status?: WorkRunStatus;
  } = {}): Promise<WorkRunRecord[]> {
    const repository = await WorkRepository.open(this.config.repoRoot, { companyId: this.config.companyId });
    try {
      return repository.listWorkRuns(input);
    } finally {
      repository.close();
    }
  }

  async retryWorkRun(input: RetryWorkRunInput): Promise<WorkRunRecord> {
    const timestamp = this.now();
    const actorMemberId = requireText(input.actorMemberId, "actorMemberId");
    const repository = await WorkRepository.open(this.config.repoRoot, { companyId: this.config.companyId });
    try {
      const previousRun = repository.getWorkRun(input.workRunId);
      if (!previousRun) {
        throw new Error(`WorkRun not found: ${input.workRunId}`);
      }
      if (previousRun.status !== "failed") {
        throw new Error(`Only failed WorkRuns can be retried; ${previousRun.id} is ${previousRun.status}.`);
      }
      const task = repository.getWorkTask(previousRun.workTaskId);
      if (!task) {
        throw new Error(`WorkTask not found: ${previousRun.workTaskId}`);
      }
      if (task.status !== "active") {
        throw new Error(`Cannot retry a WorkRun for ${task.status} WorkTask ${task.id}.`);
      }
      const activeRun = repository.listWorkRuns({ workTaskId: task.id })
        .find((candidate) => candidate.status === "queued" || candidate.status === "in_progress" || candidate.status === "blocked");
      if (activeRun) {
        throw new Error(`Cannot retry WorkRun ${previousRun.id} while active WorkRun ${activeRun.id} is ${activeRun.status}.`);
      }

      const assigneeMemberId = await this.requireActiveRuntimeMember(
        optionalText(input.assigneeMemberId) || previousRun.assigneeMemberId,
      );
      const retriedRun = repository.createWorkRun({
        id: this.createId("work-run"),
        workTaskId: task.id,
        status: "queued",
        assigneeMemberId,
        taskRevision: task.revision,
        triggeredBy: "retry",
        scheduledFor: previousRun.scheduledFor,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      repository.appendWorkRunEvent({
        id: this.createId("work-run-event"),
        workRunId: previousRun.id,
        timestamp,
        actorMemberId,
        eventType: "retry_created",
        summary: `Created retry WorkRun ${retriedRun.id}.`,
        metadata: {
          retryWorkRunId: retriedRun.id,
        },
      });
      repository.appendWorkRunEvent({
        id: this.createId("work-run-event"),
        workRunId: retriedRun.id,
        timestamp,
        actorMemberId,
        eventType: "created",
        summary: `Created as a retry of failed WorkRun ${previousRun.id}.`,
        metadata: {
          retryOfWorkRunId: previousRun.id,
          workTaskId: task.id,
        },
      });
      const updatedTask = repository.updateWorkTask({
        ...task,
        updatedAt: timestamp,
      });
      await repository.save();
      this.notifyWorkTaskChanged(updatedTask);
      this.notifyWorkRunChanged(retriedRun);
      return retriedRun;
    } finally {
      repository.close();
    }
  }

  async reviseWorkTask(input: ReviseWorkTaskInput): Promise<WorkTaskDetail> {
    const timestamp = this.now();
    const actorMemberId = requireText(input.actorMemberId, "actorMemberId");
    const reason = requireText(input.reason, "reason");
    const repository = await WorkRepository.open(this.config.repoRoot, { companyId: this.config.companyId });
    try {
      const task = repository.getWorkTask(input.workTaskId);
      if (!task) {
        throw new Error(`WorkTask not found: ${input.workTaskId}`);
      }
      if (task.status !== "active") {
        throw new Error(`Only active WorkTasks can be revised; ${task.id} is ${task.status}.`);
      }
      const sourceRun = input.sourceWorkRunId ? repository.getWorkRun(input.sourceWorkRunId) : undefined;
      if (input.sourceWorkRunId && !sourceRun) {
        throw new Error(`Source WorkRun not found: ${input.sourceWorkRunId}`);
      }
      if (sourceRun && sourceRun.workTaskId !== task.id) {
        throw new Error(`WorkRun ${sourceRun.id} does not belong to WorkTask ${task.id}.`);
      }
      if (sourceRun && isTerminalRunStatus(sourceRun.status)) {
        throw new Error(`Cannot revise WorkTask ${task.id} from terminal WorkRun ${sourceRun.id}.`);
      }

      const title = input.title === undefined ? task.title : requireText(input.title, "title");
      const description = input.description === undefined ? task.description : requireText(input.description, "description");
      const acceptanceCriteria = input.acceptanceCriteria === undefined
        ? task.acceptanceCriteria
        : requireText(input.acceptanceCriteria, "acceptanceCriteria");
      if (title === task.title && description === task.description && acceptanceCriteria === task.acceptanceCriteria) {
        throw new Error("Task revision must change title, description, or acceptanceCriteria.");
      }

      const revisionNumber = task.revision + 1;
      const updatedTask: WorkTaskRecord = {
        ...task,
        title,
        description,
        acceptanceCriteria,
        revision: revisionNumber,
        updatedAt: timestamp,
      };
      const updatedRun = sourceRun
        ? { ...sourceRun, taskRevision: revisionNumber, updatedAt: timestamp }
        : undefined;
      const revision: WorkTaskRevisionRecord = {
        id: this.createId("work-task-revision"),
        workTaskId: task.id,
        revision: revisionNumber,
        title,
        description,
        acceptanceCriteria,
        changedByMemberId: actorMemberId,
        reason,
        sourceWorkRunId: sourceRun?.id,
        createdAt: timestamp,
      };
      repository.reviseWorkTask({ task: updatedTask, revision, run: updatedRun });
      if (updatedRun) {
        repository.appendWorkRunEvent({
          id: this.createId("work-run-event"),
          workRunId: updatedRun.id,
          timestamp,
          actorMemberId,
          eventType: "task_revised",
          summary: `WorkTask objective revised to revision ${revisionNumber}.`,
          metadata: {
            workTaskId: task.id,
            taskRevision: revisionNumber,
            reason,
          },
        });
      }
      await repository.save();
      this.notifyWorkTaskChanged(updatedTask);
      if (updatedRun) {
        this.notifyWorkRunChanged(updatedRun);
      }
      return {
        task: updatedTask,
        revisions: repository.listWorkTaskRevisions(task.id),
        schedules: repository.listWorkSchedules({ workTaskId: task.id }),
        runs: repository.listWorkRuns({ workTaskId: task.id }),
      };
    } finally {
      repository.close();
    }
  }

  async moveWorkSchedule(input: MoveWorkScheduleInput): Promise<WorkScheduleRecord> {
    const timestamp = this.now();
    const repository = await WorkRepository.open(this.config.repoRoot, { companyId: this.config.companyId });
    try {
      const schedule = repository.getWorkSchedule(input.workScheduleId);
      if (!schedule) {
        throw new Error(`WorkSchedule not found: ${input.workScheduleId}`);
      }
      if (schedule.status === input.status) {
        return schedule;
      }
      if (!allowedScheduleTransitions[schedule.status].includes(input.status)) {
        throw new Error(`Cannot move WorkSchedule from ${schedule.status} to ${input.status}.`);
      }

      const reason = optionalText(input.reason);
      const updated = repository.updateWorkSchedule({
        ...schedule,
        status: input.status,
        pausedReason: input.status === "paused" ? reason : undefined,
        canceledReason: input.status === "canceled" ? reason : undefined,
        completedAt: input.status === "canceled" ? timestamp : undefined,
        updatedAt: timestamp,
      });
      if (input.status === "canceled") {
        const task = repository.getWorkTask(schedule.workTaskId);
        if (task) {
          repository.updateWorkTask({
            ...task,
            status: "canceled",
            canceledReason: reason,
            completedAt: timestamp,
            updatedAt: timestamp,
          });
        }
      }
      await repository.save();
      return updated;
    } finally {
      repository.close();
    }
  }

  async cancelWorkTask(input: WorkTaskLifecycleInput): Promise<WorkTaskDetail> {
    const timestamp = this.now();
    const reason = requireText(input.reason, "reason");
    const actorMemberId = requireText(input.actorMemberId, "actorMemberId");
    const repository = await WorkRepository.open(this.config.repoRoot, { companyId: this.config.companyId });
    try {
      const task = repository.getWorkTask(input.workTaskId);
      if (!task) {
        throw new Error(`WorkTask not found: ${input.workTaskId}`);
      }
      if (task.status === "archived") {
        throw new Error("Archived WorkTasks must be restored before they can be canceled.");
      }

      const schedules = repository.listWorkSchedules({ workTaskId: task.id });
      const runs = repository.listWorkRuns({ workTaskId: task.id });
      const updatedTask = repository.updateWorkTask({
        ...task,
        status: "canceled",
        canceledReason: reason,
        completedAt: timestamp,
        updatedAt: timestamp,
      });
      for (const schedule of schedules) {
        if (schedule.status === "enabled" || schedule.status === "paused") {
          repository.updateWorkSchedule({
            ...schedule,
            status: "canceled",
            canceledReason: reason,
            nextRunAt: undefined,
            completedAt: timestamp,
            updatedAt: timestamp,
          });
        }
      }
      for (const run of runs) {
        if (!isTerminalRunStatus(run.status)) {
          repository.updateWorkRun({
            ...run,
            status: "canceled",
            completedAt: timestamp,
            canceledReason: reason,
            updatedAt: timestamp,
          });
          repository.appendWorkRunEvent({
            id: this.createId("work-run-event"),
            workRunId: run.id,
            timestamp,
            actorMemberId,
            eventType: "canceled",
            summary: `Canceled WorkRun because WorkTask ${task.id} was canceled.`,
            metadata: {
              workTaskId: task.id,
              reason,
            },
          });
        }
      }
      await repository.save();
      this.notifyWorkTaskChanged(updatedTask);
      for (const run of repository.listWorkRuns({ workTaskId: task.id })) {
        this.notifyWorkRunChanged(run);
      }
      return {
        task: updatedTask,
        revisions: repository.listWorkTaskRevisions(task.id),
        schedules: repository.listWorkSchedules({ workTaskId: task.id }),
        runs: repository.listWorkRuns({ workTaskId: task.id }),
      };
    } finally {
      repository.close();
    }
  }

  async archiveWorkTask(input: WorkTaskLifecycleInput): Promise<WorkTaskDetail> {
    const timestamp = this.now();
    const actorMemberId = requireText(input.actorMemberId, "actorMemberId");
    const reason = optionalText(input.reason);
    const repository = await WorkRepository.open(this.config.repoRoot, { companyId: this.config.companyId });
    try {
      const task = repository.getWorkTask(input.workTaskId);
      if (!task) {
        throw new Error(`WorkTask not found: ${input.workTaskId}`);
      }
      if (task.status === "archived") {
        return {
          task,
          revisions: repository.listWorkTaskRevisions(task.id),
          schedules: repository.listWorkSchedules({ workTaskId: task.id }),
          runs: repository.listWorkRuns({ workTaskId: task.id }),
        };
      }
      if (!isInactiveTaskStatus(task.status)) {
        throw new Error(`Cannot archive ${task.status} WorkTask. Cancel or complete it before archiving.`);
      }
      const updatedTask = repository.updateWorkTask({
        ...task,
        status: "archived",
        metadata: {
          ...(task.metadata || {}),
          archivedFromStatus: task.status,
          archivedByMemberId: actorMemberId,
          archivedReason: reason,
          archivedAt: timestamp,
        },
        updatedAt: timestamp,
      });
      await repository.save();
      this.notifyWorkTaskChanged(updatedTask);
      return {
        task: updatedTask,
        revisions: repository.listWorkTaskRevisions(task.id),
        schedules: repository.listWorkSchedules({ workTaskId: task.id }),
        runs: repository.listWorkRuns({ workTaskId: task.id }),
      };
    } finally {
      repository.close();
    }
  }

  async restoreWorkTask(input: WorkTaskLifecycleInput): Promise<WorkTaskDetail> {
    const timestamp = this.now();
    requireText(input.actorMemberId, "actorMemberId");
    const repository = await WorkRepository.open(this.config.repoRoot, { companyId: this.config.companyId });
    try {
      const task = repository.getWorkTask(input.workTaskId);
      if (!task) {
        throw new Error(`WorkTask not found: ${input.workTaskId}`);
      }
      if (task.status !== "archived") {
        return {
          task,
          revisions: repository.listWorkTaskRevisions(task.id),
          schedules: repository.listWorkSchedules({ workTaskId: task.id }),
          runs: repository.listWorkRuns({ workTaskId: task.id }),
        };
      }
      const updatedTask = repository.updateWorkTask({
        ...task,
        status: previousArchivedTaskStatus(task),
        updatedAt: timestamp,
      });
      await repository.save();
      this.notifyWorkTaskChanged(updatedTask);
      return {
        task: updatedTask,
        revisions: repository.listWorkTaskRevisions(task.id),
        schedules: repository.listWorkSchedules({ workTaskId: task.id }),
        runs: repository.listWorkRuns({ workTaskId: task.id }),
      };
    } finally {
      repository.close();
    }
  }

  async moveWorkRun(input: MoveWorkRunInput): Promise<WorkRunRecord> {
    const timestamp = this.now();
    const eventId = this.createId("work-run-event");

    const repository = await WorkRepository.open(this.config.repoRoot, { companyId: this.config.companyId });
    try {
      const run = repository.getWorkRun(input.workRunId);
      if (!run) {
        throw new Error(`WorkRun not found: ${input.workRunId}`);
      }
      if (!allowedRunTransitions[run.status].includes(input.status)) {
        throw new Error(`WorkRun cannot move from ${run.status} to ${input.status}.`);
      }
      const reason = optionalText(input.reason);
      if (statusReasonField(input.status) && !reason) {
        throw new Error(`Moving WorkRun to ${input.status} requires a reason.`);
      }
      const evidence = optionalText(input.evidence);
      if (input.status === "done" && !evidence) {
        throw new Error("Moving WorkRun to done requires evidence.");
      }
      const updated = repository.updateWorkRun({
        ...run,
        status: input.status,
        startedAt: input.status === "in_progress" && !run.startedAt ? timestamp : run.startedAt,
        completedAt: ["done", "failed", "canceled"].includes(input.status) ? timestamp : run.completedAt,
        blockedReason: input.status === "blocked" ? reason : run.blockedReason,
        failedReason: input.status === "failed" ? reason : run.failedReason,
        canceledReason: input.status === "canceled" ? reason : run.canceledReason,
        resultSummary: input.status === "done"
          ? optionalText(input.summary) || evidence
          : run.resultSummary,
        updatedAt: timestamp,
      });
      repository.appendWorkRunEvent({
        id: eventId,
        workRunId: run.id,
        timestamp,
        actorMemberId: requireText(input.actorMemberId, "actorMemberId"),
        eventType: eventTypeForStatus(input.status),
        summary: optionalText(input.summary) || `Moved WorkRun from ${run.status} to ${input.status}.`,
        metadata: {
          fromStatus: run.status,
          toStatus: input.status,
          reason,
          evidence,
        },
      });

      const workTaskId = run.workTaskId;
      const task = repository.getWorkTask(workTaskId);
      const schedule = repository.listWorkSchedules({ workTaskId })[0];
      let changedTask: WorkTaskRecord | undefined;
      if (task && isTerminalRunStatus(input.status)) {
        const runsForTask = repository.listWorkRuns({ workTaskId });
        const scheduleRunCount = Math.max(schedule?.runCount ?? 0, runsForTask.length);
        const baseTask = {
          ...task,
          updatedAt: timestamp,
        };
        const baseSchedule = schedule
          ? {
              ...schedule,
              runCount: scheduleRunCount,
              lastRunAt: timestamp,
              updatedAt: timestamp,
            }
          : undefined;
        const oneShotWork = isOneShotWork({ task, schedule, runsForTask });
        const finalRunShouldCloseWork =
          oneShotWork ||
          (baseSchedule?.maxRuns !== undefined && scheduleRunCount >= baseSchedule.maxRuns);

        if (finalRunShouldCloseWork) {
          const taskStatus = taskStatusForTerminalRun(input.status);
          const terminalReason =
            input.status === "failed"
              ? `${oneShotWork ? "One-shot" : "Final"} WorkRun failed: ${reason || "No failure reason was provided."}`
              : input.status === "canceled"
                ? reason || `${oneShotWork ? "One-shot" : "Final"} WorkRun was canceled.`
                : undefined;
          changedTask = repository.updateWorkTask({
            ...baseTask,
            status: taskStatus,
            canceledReason: taskStatus === "canceled" ? terminalReason : undefined,
            completedAt: taskStatus === "completed" || taskStatus === "canceled" ? timestamp : task.completedAt,
          });
          if (baseSchedule) {
            repository.updateWorkSchedule({
              ...baseSchedule,
              status: "completed",
              nextRunAt: undefined,
              pausedReason: undefined,
              canceledReason: undefined,
              completedAt: baseSchedule.completedAt || timestamp,
            });
          }
        } else {
          changedTask = repository.updateWorkTask(baseTask);
          if (baseSchedule) {
            repository.updateWorkSchedule(baseSchedule);
          }
        }
      }
      await repository.save();
      if (isTerminalRunStatus(updated.status)) {
        try {
          await this.config.onWorkRunTerminal?.(updated);
        } catch {
          // Work state is authoritative once persisted. Access projections reconcile terminal contexts on read.
        }
      }
      this.notifyWorkRunChanged(updated);
      if (changedTask) {
        this.notifyWorkTaskChanged(changedTask);
      }
      return updated;
    } finally {
      repository.close();
    }
  }

  async recordWorkRunEvent(input: RecordWorkRunEventInput): Promise<WorkRunEventRecord> {
    const timestamp = this.now();
    const eventId = this.createId("work-run-event");
    const repository = await WorkRepository.open(this.config.repoRoot, { companyId: this.config.companyId });
    try {
      const run = repository.getWorkRun(input.workRunId);
      if (!run) {
        throw new Error(`WorkRun not found: ${input.workRunId}`);
      }
      const event = repository.appendWorkRunEvent({
        id: eventId,
        workRunId: run.id,
        timestamp,
        actorMemberId: requireText(input.actorMemberId, "actorMemberId"),
        eventType: requireText(input.eventType, "eventType"),
        summary: requireText(input.summary, "summary"),
        metadata: input.metadata,
      });
      await repository.save();
      return event;
    } finally {
      repository.close();
    }
  }

  private notifyWorkTaskChanged(task: WorkTaskRecord): void {
    try {
      this.config.observer?.workTaskChanged?.({
        companyId: this.config.companyId,
        task,
      });
    } catch {
      // Realtime projection notifications must not roll back persisted work state.
    }
  }

  private notifyWorkRunChanged(run: WorkRunRecord): void {
    try {
      this.config.observer?.workRunChanged?.({
        companyId: this.config.companyId,
        run,
      });
    } catch {
      // Realtime projection notifications must not roll back persisted work state.
    }
  }
}
