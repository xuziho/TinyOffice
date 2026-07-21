import { releaseCompanyPostgresConnection } from "../runtime/company-config/postgres-runtime-connection.js";
import type {
  CompanyPostgresClient,
  CompanyPostgresPoolLike,
} from "../runtime/company-config/postgres-runtime-connection.js";
import type {
  WorkRunEventRecord,
  WorkRunRecord,
  WorkRunStatus,
  WorkScheduleRule,
  WorkScheduleRecord,
  WorkTaskRecord,
  WorkTaskRevisionRecord,
  WorkTaskStatus,
} from "./domain.js";

function optional(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function timestampValue(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }
  return String(value);
}

function optionalTimestamp(value: unknown): string | undefined {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }
  return timestampValue(value);
}

function numberValue(value: unknown): number {
  return Number(value ?? 0);
}

function jsonValue<T>(value: unknown): T | undefined {
  if (!value) {
    return undefined;
  }
  if (typeof value === "string") {
    return JSON.parse(value) as T;
  }
  return value as T;
}

export function workTaskFromRow(row: Record<string, unknown>): WorkTaskRecord {
  return {
    id: String(row.id),
    title: String(row.title),
    description: optional(row.description),
    status: String(row.status) as WorkTaskStatus,
    createdByMemberId: String(row.created_by_member_id),
    ownerMemberId: String(row.owner_member_id),
    sourceKind: String(row.source_kind) as WorkTaskRecord["sourceKind"],
    sourceId: String(row.source_id),
    sourceChannelTopicId: optional(row.source_channel_topic_id),
    requesterId: optional(row.requester_id),
    acceptanceCriteria: String(row.acceptance_criteria),
    revision: numberValue(row.revision) || 1,
    canceledReason: optional(row.canceled_reason),
    metadata: jsonValue<Record<string, unknown>>(row.metadata_json),
    createdAt: timestampValue(row.created_at),
    updatedAt: timestampValue(row.updated_at),
    completedAt: optionalTimestamp(row.completed_at),
  };
}

function workTaskRevisionFromRow(row: Record<string, unknown>): WorkTaskRevisionRecord {
  return {
    id: String(row.id),
    workTaskId: String(row.work_task_id),
    revision: numberValue(row.revision),
    title: String(row.title),
    description: optional(row.description),
    acceptanceCriteria: String(row.acceptance_criteria),
    changedByMemberId: String(row.changed_by_member_id),
    reason: String(row.reason),
    sourceWorkRunId: optional(row.source_work_run_id),
    createdAt: timestampValue(row.created_at),
  };
}

export function workScheduleFromRow(row: Record<string, unknown>): WorkScheduleRecord {
  return {
    id: String(row.id),
    workTaskId: String(row.work_task_id),
    status: String(row.status) as WorkScheduleRecord["status"],
    kind: String(row.kind) as WorkScheduleRecord["kind"],
    timezone: optional(row.timezone),
    scheduleRule: jsonValue<WorkScheduleRule>(row.schedule_rule_json),
    nextRunAt: optionalTimestamp(row.next_run_at),
    lastRunAt: optionalTimestamp(row.last_run_at),
    runCount: numberValue(row.run_count),
    maxRuns: row.max_runs === null || row.max_runs === undefined ? undefined : Number(row.max_runs),
    pausedReason: optional(row.paused_reason),
    canceledReason: optional(row.canceled_reason),
    createdAt: timestampValue(row.created_at),
    updatedAt: timestampValue(row.updated_at),
    completedAt: optionalTimestamp(row.completed_at),
  };
}

export function workRunFromRow(row: Record<string, unknown>): WorkRunRecord {
  return {
    id: String(row.id),
    workTaskId: String(row.work_task_id),
    status: String(row.status) as WorkRunStatus,
    assigneeMemberId: String(row.assignee_member_id),
    taskRevision: numberValue(row.task_revision) || 1,
    triggeredBy: String(row.triggered_by) as WorkRunRecord["triggeredBy"],
    scheduledFor: optionalTimestamp(row.scheduled_for),
    startedAt: optionalTimestamp(row.started_at),
    completedAt: optionalTimestamp(row.completed_at),
    blockedReason: optional(row.blocked_reason),
    failedReason: optional(row.failed_reason),
    canceledReason: optional(row.canceled_reason),
    resultSummary: optional(row.result_summary),
    createdAt: timestampValue(row.created_at),
    updatedAt: timestampValue(row.updated_at),
  };
}

function workRunEventFromRow(row: Record<string, unknown>): WorkRunEventRecord {
  return {
    id: String(row.id),
    workRunId: String(row.work_run_id),
    timestamp: timestampValue(row.timestamp),
    actorMemberId: String(row.actor_member_id),
    eventType: String(row.event_type),
    summary: String(row.summary),
    metadata: jsonValue<Record<string, unknown>>(row.metadata_json),
  };
}

function byRunCreated(left: WorkRunRecord, right: WorkRunRecord) {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function byEventTimestamp(left: WorkRunEventRecord, right: WorkRunEventRecord) {
  return left.timestamp.localeCompare(right.timestamp) || left.id.localeCompare(right.id);
}

function upsertById<T extends { id: string }>(items: T[], item: T) {
  const index = items.findIndex((candidate) => candidate.id === item.id);
  if (index >= 0) {
    items[index] = item;
  } else {
    items.push(item);
  }
}

export class PostgresWorkRepository {
  private pendingWrites: Promise<unknown> = Promise.resolve();
  private pendingWriteCount = 0;
  private closed = false;

  private constructor(
    private readonly client: CompanyPostgresClient,
    private readonly pool: CompanyPostgresPoolLike,
    private readonly companyId: string,
    private readonly workTasks: WorkTaskRecord[],
    private readonly workTaskRevisions: WorkTaskRevisionRecord[],
    private readonly workSchedules: WorkScheduleRecord[],
    private readonly workRuns: WorkRunRecord[],
    private readonly workRunEvents: WorkRunEventRecord[],
  ) {}

  static async open(input: {
    client: CompanyPostgresClient;
    pool: CompanyPostgresPoolLike;
    companyId: string;
  }): Promise<PostgresWorkRepository> {
    const tasks = await input.client.query(
      "SELECT * FROM work_tasks WHERE company_id = $1 ORDER BY updated_at DESC, created_at DESC, id ASC",
      [input.companyId],
    );
    const schedules = await input.client.query(
      "SELECT * FROM work_schedules WHERE company_id = $1 ORDER BY updated_at DESC, created_at DESC, id ASC",
      [input.companyId],
    );
    const revisions = await input.client.query(
      "SELECT * FROM work_task_revisions WHERE company_id = $1 ORDER BY work_task_id ASC, revision ASC",
      [input.companyId],
    );
    const runs = await input.client.query(
      "SELECT * FROM work_runs WHERE company_id = $1 ORDER BY created_at ASC, id ASC",
      [input.companyId],
    );
    const events = await input.client.query(
      "SELECT * FROM work_run_events WHERE company_id = $1 ORDER BY timestamp ASC, id ASC",
      [input.companyId],
    );
    return new PostgresWorkRepository(
      input.client,
      input.pool,
      input.companyId,
      tasks.rows.map(workTaskFromRow),
      revisions.rows.map(workTaskRevisionFromRow),
      schedules.rows.map(workScheduleFromRow),
      runs.rows.map(workRunFromRow),
      events.rows.map(workRunEventFromRow),
    );
  }

  createWorkTask(input: WorkTaskRecord): WorkTaskRecord {
    const revisionNumber = input.revision || 1;
    const normalizedInput = { ...input, revision: revisionNumber };
    upsertById(this.workTasks, normalizedInput);
    this.queueQuery(
      `INSERT INTO work_tasks (
  company_id, id, title, description, status, created_by_member_id, owner_member_id,
  source_kind, source_id, source_channel_topic_id,
  requester_id, acceptance_criteria, revision,
  canceled_reason, metadata_json, created_at, updated_at, completed_at
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
ON CONFLICT (company_id, id) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  status = EXCLUDED.status,
  created_by_member_id = EXCLUDED.created_by_member_id,
  owner_member_id = EXCLUDED.owner_member_id,
  source_kind = EXCLUDED.source_kind,
  source_id = EXCLUDED.source_id,
  source_channel_topic_id = EXCLUDED.source_channel_topic_id,
  requester_id = EXCLUDED.requester_id,
  acceptance_criteria = EXCLUDED.acceptance_criteria,
  revision = EXCLUDED.revision,
  canceled_reason = EXCLUDED.canceled_reason,
  metadata_json = EXCLUDED.metadata_json,
  updated_at = EXCLUDED.updated_at,
  completed_at = EXCLUDED.completed_at`,
      [
        this.companyId,
        input.id,
        input.title,
        input.description ?? null,
        input.status,
        input.createdByMemberId,
        input.ownerMemberId,
        input.sourceKind,
        input.sourceId,
        input.sourceChannelTopicId ?? null,
        input.requesterId ?? null,
        input.acceptanceCriteria,
        revisionNumber,
        input.canceledReason ?? null,
        input.metadata ?? null,
        input.createdAt,
        input.updatedAt,
        input.completedAt ?? null,
      ],
    );
    const initialRevision: WorkTaskRevisionRecord = {
      id: `work-task-revision-initial-${input.id}`,
      workTaskId: input.id,
      revision: revisionNumber,
      title: input.title,
      description: input.description,
      acceptanceCriteria: input.acceptanceCriteria,
      changedByMemberId: input.createdByMemberId,
      reason: "Initial Task objective confirmed.",
      createdAt: input.createdAt,
    };
    upsertById(this.workTaskRevisions, initialRevision);
    this.queueQuery(
      `INSERT INTO work_task_revisions (
  company_id, id, work_task_id, revision, title, description,
  acceptance_criteria, changed_by_member_id, reason, source_work_run_id, created_at
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
ON CONFLICT (company_id, work_task_id, revision) DO NOTHING`,
      [
        this.companyId,
        initialRevision.id,
        initialRevision.workTaskId,
        initialRevision.revision,
        initialRevision.title,
        initialRevision.description ?? null,
        initialRevision.acceptanceCriteria,
        initialRevision.changedByMemberId,
        initialRevision.reason,
        null,
        initialRevision.createdAt,
      ],
    );
    return normalizedInput;
  }

  createWorkSchedule(input: WorkScheduleRecord): WorkScheduleRecord {
    upsertById(this.workSchedules, input);
    this.queueQuery(
      `INSERT INTO work_schedules (
  company_id, id, work_task_id, status, kind, timezone,
  schedule_rule_json, next_run_at, last_run_at, run_count, max_runs,
  paused_reason, canceled_reason, created_at, updated_at, completed_at
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
ON CONFLICT (company_id, id) DO UPDATE SET
  work_task_id = EXCLUDED.work_task_id,
  status = EXCLUDED.status,
  kind = EXCLUDED.kind,
  timezone = EXCLUDED.timezone,
  schedule_rule_json = EXCLUDED.schedule_rule_json,
  next_run_at = EXCLUDED.next_run_at,
  last_run_at = EXCLUDED.last_run_at,
  run_count = EXCLUDED.run_count,
  max_runs = EXCLUDED.max_runs,
  paused_reason = EXCLUDED.paused_reason,
  canceled_reason = EXCLUDED.canceled_reason,
  updated_at = EXCLUDED.updated_at,
  completed_at = EXCLUDED.completed_at`,
      [
        this.companyId,
        input.id,
        input.workTaskId,
        input.status,
        input.kind,
        input.timezone ?? null,
        input.scheduleRule ?? null,
        input.nextRunAt ?? null,
        input.lastRunAt ?? null,
        input.runCount,
        input.maxRuns ?? null,
        input.pausedReason ?? null,
        input.canceledReason ?? null,
        input.createdAt,
        input.updatedAt,
        input.completedAt ?? null,
      ],
    );
    return input;
  }

  getWorkTask(id: string): WorkTaskRecord | undefined {
    return this.workTasks.find((task) => task.id === id);
  }

  getWorkSchedule(id: string): WorkScheduleRecord | undefined {
    return this.workSchedules.find((schedule) => schedule.id === id);
  }

  updateWorkTask(input: WorkTaskRecord): WorkTaskRecord {
    upsertById(this.workTasks, input);
    this.queueQuery(
      `UPDATE work_tasks SET
  title = $3,
  description = $4,
  status = $5,
  owner_member_id = $6,
  acceptance_criteria = $7,
  revision = $8,
  canceled_reason = $9,
  metadata_json = $10,
  updated_at = $11,
  completed_at = $12
WHERE company_id = $1 AND id = $2`,
      [
        this.companyId,
        input.id,
        input.title,
        input.description ?? null,
        input.status,
        input.ownerMemberId,
        input.acceptanceCriteria,
        input.revision,
        input.canceledReason ?? null,
        input.metadata ?? null,
        input.updatedAt,
        input.completedAt ?? null,
      ],
    );
    return input;
  }

  reviseWorkTask(input: {
    task: WorkTaskRecord;
    revision: WorkTaskRevisionRecord;
    run?: WorkRunRecord;
  }): void {
    upsertById(this.workTasks, input.task);
    upsertById(this.workTaskRevisions, input.revision);
    if (input.run) {
      upsertById(this.workRuns, input.run);
    }
    this.queueQuery(
      `WITH updated_task AS (
  UPDATE work_tasks SET
    title = $3,
    description = $4,
    acceptance_criteria = $5,
    revision = $6,
    updated_at = $7
  WHERE company_id = $1 AND id = $2
  RETURNING id
), updated_run AS (
  UPDATE work_runs SET
    task_revision = $6,
    updated_at = $7
  WHERE company_id = $1 AND id = $8
  RETURNING id
)
INSERT INTO work_task_revisions (
  company_id, id, work_task_id, revision, title, description,
  acceptance_criteria, changed_by_member_id, reason, source_work_run_id, created_at
)
SELECT $1, $9, $2, $6, $3, $4, $5, $10, $11, $8, $7
FROM updated_task`,
      [
        this.companyId,
        input.task.id,
        input.task.title,
        input.task.description ?? null,
        input.task.acceptanceCriteria,
        input.task.revision,
        input.task.updatedAt,
        input.run?.id ?? null,
        input.revision.id,
        input.revision.changedByMemberId,
        input.revision.reason,
      ],
    );
  }

  listWorkTaskRevisions(workTaskId: string): WorkTaskRevisionRecord[] {
    return this.workTaskRevisions
      .filter((revision) => revision.workTaskId === workTaskId)
      .sort((left, right) => left.revision - right.revision);
  }

  updateWorkSchedule(input: WorkScheduleRecord): WorkScheduleRecord {
    upsertById(this.workSchedules, input);
    this.queueQuery(
      `UPDATE work_schedules SET
  status = $3,
  kind = $4,
  timezone = $5,
  schedule_rule_json = $6,
  next_run_at = $7,
  last_run_at = $8,
  run_count = $9,
  max_runs = $10,
  paused_reason = $11,
  canceled_reason = $12,
  updated_at = $13,
  completed_at = $14
WHERE company_id = $1 AND id = $2`,
      [
        this.companyId,
        input.id,
        input.status,
        input.kind,
        input.timezone ?? null,
        input.scheduleRule ?? null,
        input.nextRunAt ?? null,
        input.lastRunAt ?? null,
        input.runCount,
        input.maxRuns ?? null,
        input.pausedReason ?? null,
        input.canceledReason ?? null,
        input.updatedAt,
        input.completedAt ?? null,
      ],
    );
    return input;
  }

  listWorkTasks(input: { ownerMemberId?: string; status?: WorkTaskStatus } = {}): WorkTaskRecord[] {
    return this.workTasks
      .filter((task) => !input.ownerMemberId || task.ownerMemberId === input.ownerMemberId)
      .filter((task) => !input.status || task.status === input.status)
      .sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) ||
        right.createdAt.localeCompare(left.createdAt) ||
        left.id.localeCompare(right.id)
      );
  }

  listWorkSchedules(input: { workTaskId?: string; status?: WorkScheduleRecord["status"] } = {}): WorkScheduleRecord[] {
    return this.workSchedules
      .filter((schedule) => !input.workTaskId || schedule.workTaskId === input.workTaskId)
      .filter((schedule) => !input.status || schedule.status === input.status)
      .sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) ||
        right.createdAt.localeCompare(left.createdAt) ||
        left.id.localeCompare(right.id)
      );
  }

  listWorkRuns(input: { workTaskId?: string; assigneeMemberId?: string; status?: WorkRunStatus } = {}): WorkRunRecord[] {
    return this.workRuns
      .filter((run) => !input.workTaskId || run.workTaskId === input.workTaskId)
      .filter((run) => !input.assigneeMemberId || run.assigneeMemberId === input.assigneeMemberId)
      .filter((run) => !input.status || run.status === input.status)
      .sort(byRunCreated);
  }

  createWorkRun(input: WorkRunRecord): WorkRunRecord {
    const taskRevision = input.taskRevision || this.workTasks.find((task) => task.id === input.workTaskId)?.revision || 1;
    const normalizedInput = { ...input, taskRevision };
    upsertById(this.workRuns, normalizedInput);
    this.incrementScheduleRunCount(input.workTaskId, input.createdAt);
    this.queueQuery(
      `INSERT INTO work_runs (
  company_id, id, work_task_id, status, assignee_member_id, task_revision, triggered_by, scheduled_for,
  started_at, completed_at, blocked_reason, failed_reason, canceled_reason,
  result_summary, created_at, updated_at
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
ON CONFLICT (company_id, id) DO UPDATE SET
  work_task_id = EXCLUDED.work_task_id,
  status = EXCLUDED.status,
  assignee_member_id = EXCLUDED.assignee_member_id,
  task_revision = EXCLUDED.task_revision,
  triggered_by = EXCLUDED.triggered_by,
  scheduled_for = EXCLUDED.scheduled_for,
  started_at = EXCLUDED.started_at,
  completed_at = EXCLUDED.completed_at,
  blocked_reason = EXCLUDED.blocked_reason,
  failed_reason = EXCLUDED.failed_reason,
  canceled_reason = EXCLUDED.canceled_reason,
  result_summary = EXCLUDED.result_summary,
  updated_at = EXCLUDED.updated_at`,
      [
        this.companyId,
        input.id,
        input.workTaskId,
        input.status,
        input.assigneeMemberId,
        taskRevision,
        input.triggeredBy,
        input.scheduledFor ?? null,
        input.startedAt ?? null,
        input.completedAt ?? null,
        input.blockedReason ?? null,
        input.failedReason ?? null,
        input.canceledReason ?? null,
        input.resultSummary ?? null,
        input.createdAt,
        input.updatedAt,
      ],
    );
    return normalizedInput;
  }

  getWorkRun(id: string): WorkRunRecord | undefined {
    return this.workRuns.find((run) => run.id === id);
  }

  updateWorkRun(input: WorkRunRecord): WorkRunRecord {
    upsertById(this.workRuns, input);
    this.queueQuery(
      `UPDATE work_runs SET
  status = $3,
  assignee_member_id = $4,
  started_at = $5,
  completed_at = $6,
  blocked_reason = $7,
  failed_reason = $8,
  canceled_reason = $9,
  result_summary = $10,
  updated_at = $11
WHERE company_id = $1 AND id = $2`,
      [
        this.companyId,
        input.id,
        input.status,
        input.assigneeMemberId,
        input.startedAt ?? null,
        input.completedAt ?? null,
        input.blockedReason ?? null,
        input.failedReason ?? null,
        input.canceledReason ?? null,
        input.resultSummary ?? null,
        input.updatedAt,
      ],
    );
    return input;
  }

  appendWorkRunEvent(input: WorkRunEventRecord): WorkRunEventRecord {
    upsertById(this.workRunEvents, input);
    this.queueQuery(
      `INSERT INTO work_run_events (
  company_id, id, work_run_id, timestamp, actor_member_id, event_type, summary, metadata_json
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
ON CONFLICT (company_id, id) DO UPDATE SET
  work_run_id = EXCLUDED.work_run_id,
  timestamp = EXCLUDED.timestamp,
  actor_member_id = EXCLUDED.actor_member_id,
  event_type = EXCLUDED.event_type,
  summary = EXCLUDED.summary,
  metadata_json = EXCLUDED.metadata_json`,
      [
        this.companyId,
        input.id,
        input.workRunId,
        input.timestamp,
        input.actorMemberId,
        input.eventType,
        input.summary,
        input.metadata ?? null,
      ],
    );
    return input;
  }

  listWorkRunEvents(workRunId: string): WorkRunEventRecord[] {
    return this.workRunEvents
      .filter((event) => event.workRunId === workRunId)
      .sort(byEventTimestamp);
  }

  async save(): Promise<void> {
    await this.pendingWrites;
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    const release = () => releaseCompanyPostgresConnection({ client: this.client, pool: this.pool });
    if (this.pendingWriteCount === 0) {
      void release();
      return;
    }
    void this.pendingWrites
      .finally(release)
      .catch(() => undefined);
  }

  private queueQuery(sql: string, params?: readonly unknown[]) {
    this.pendingWriteCount += 1;
    this.pendingWrites = this.pendingWrites
      .then(() => this.client.query(sql, params))
      .finally(() => {
        this.pendingWriteCount -= 1;
      });
  }

  private incrementScheduleRunCount(workTaskId: string, timestamp: string): void {
    const schedule = this.workSchedules.find((candidate) => candidate.workTaskId === workTaskId);
    if (schedule) {
      schedule.runCount += 1;
      schedule.lastRunAt = timestamp;
      schedule.updatedAt = timestamp;
    }
    this.queueQuery(
      `UPDATE work_schedules SET
  run_count = run_count + 1,
  last_run_at = $3,
  updated_at = $4
WHERE company_id = $1 AND work_task_id = $2`,
      [this.companyId, workTaskId, timestamp, timestamp],
    );
  }
}
