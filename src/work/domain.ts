export type WorkTaskStatus =
  | "active"
  | "completed"
  | "canceled"
  | "archived";

export type WorkRunStatus =
  | "queued"
  | "in_progress"
  | "blocked"
  | "done"
  | "failed"
  | "canceled";

export type WorkTriggerKind =
  | "immediate"
  | "scheduled_once"
  | "recurring";

export type WorkSourceKind =
  | "chat_request"
  | "intake_event"
  | "manual";

export interface WorkScheduleRule {
  scheduledFor?: string;
  intervalMs?: number;
  cron?: string;
  rrule?: string;
}

export interface WorkTaskRecord {
  id: string;
  title: string;
  description?: string;
  status: WorkTaskStatus;
  createdByMemberId: string;
  ownerMemberId: string;
  sourceKind: WorkSourceKind;
  sourceId: string;
  sourceChannelTopicId?: string;
  requesterId?: string;
  acceptanceCriteria: string;
  revision: number;
  canceledReason?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface WorkTaskRevisionRecord {
  id: string;
  workTaskId: string;
  revision: number;
  title: string;
  description?: string;
  acceptanceCriteria: string;
  changedByMemberId: string;
  reason: string;
  sourceWorkRunId?: string;
  createdAt: string;
}

export interface WorkScheduleRecord {
  id: string;
  workTaskId: string;
  status: "enabled" | "paused" | "canceled" | "completed";
  kind: WorkTriggerKind;
  timezone?: string;
  scheduleRule?: WorkScheduleRule;
  nextRunAt?: string;
  lastRunAt?: string;
  runCount: number;
  maxRuns?: number;
  pausedReason?: string;
  canceledReason?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface WorkRunRecord {
  id: string;
  workTaskId: string;
  status: WorkRunStatus;
  assigneeMemberId: string;
  taskRevision: number;
  triggeredBy: "immediate" | "schedule" | "recurrence" | "migration" | "retry";
  scheduledFor?: string;
  startedAt?: string;
  completedAt?: string;
  blockedReason?: string;
  failedReason?: string;
  canceledReason?: string;
  resultSummary?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkRunEventRecord {
  id: string;
  workRunId: string;
  timestamp: string;
  actorMemberId: string;
  eventType: string;
  summary: string;
  metadata?: Record<string, unknown>;
}

export interface WorkTaskDetail {
  task: WorkTaskRecord;
  revisions: WorkTaskRevisionRecord[];
  schedules: WorkScheduleRecord[];
  runs: WorkRunRecord[];
}

export interface WorkRunDetail {
  run: WorkRunRecord;
  events: WorkRunEventRecord[];
}
