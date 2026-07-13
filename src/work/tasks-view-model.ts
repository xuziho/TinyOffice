import type { ProcessTraceEvent } from "../runtime/contracts/process-trace-event.js";
import type { OperatingEventRecord } from "../operating-log/domain.js";
import type { RuntimeSessionRecord } from "../runtime/storage/runtime-session-repository.js";
import type { CompanyMemberProfile } from "../runtime/members/company-member-directory.js";
import type { WorkDispatchLeaseRecord } from "./work-dispatch-lease.js";
import type {
  WorkRunEventRecord,
  WorkRunRecord,
  WorkRunStatus,
  WorkScheduleRecord,
  WorkTaskDetail as PersistedWorkTaskDetail,
  WorkTaskRecord,
  WorkTaskStatus,
} from "./domain.js";

type WorkScheduleStatus = WorkScheduleRecord["status"];

export interface TasksViewState {
  state: {
    tasks: WorkTaskRecord[];
    schedules: WorkScheduleRecord[];
    runs: Array<{
      run: WorkRunRecord;
      task?: WorkTaskRecord;
      schedule?: WorkScheduleRecord;
      latestLease?: WorkDispatchLeaseRecord;
    }>;
    ownerFilter?: string;
    selectedWorkTaskId?: string;
    selectedTaskDetail?: PersistedWorkTaskDetail;
  };
  summary: {
    activeCount: number;
    blockedCount: number;
    dispatchFailedCount: number;
    recentOperatingEvents: OperatingEventRecord[];
  };
}

export type TasksViewMode = "tasks";
export type TasksStatusFilter = "all" | WorkTaskStatus;
export type TasksSortMode = "recent" | "severity" | "status" | "owner";

export interface TasksViewModelRoutes {
  htmlPath: string;
  viewModelJsonPath: string;
  runActionPathPrefix: string;
}

export interface TasksViewModelOptions {
  requestUrl?: URL;
  routes?: Partial<TasksViewModelRoutes>;
  now?: string;
  memberProfiles?: CompanyMemberProfile[];
}

export interface TasksSourceLink {
  kind: "conversation-message" | "conversation" | "chat-entry" | "intake-event" | "manual-source";
  href: string;
  label: string;
  sourceId?: string;
  conversationId?: string;
  messageId?: string;
  chatEntryId?: string;
}

export interface TasksEvidenceLink {
  kind: "work-run" | "session" | "process-trace";
  href: string;
  label: string;
  targetId: string;
  workRunId?: string;
  sessionId?: string;
  processTraceId?: string;
}

export interface TasksAction {
  id:
    | "retry-dispatch"
    | "retry-run"
    | "cancel-run";
  label: string;
  method: "post";
  path: string;
  enabled: boolean;
  reason?: string;
}

export interface TasksTimelineEntry {
  kind: "event" | "trace" | "lease";
  timestamp: string;
  title: string;
  summary?: string;
  status?: string;
  targetId?: string;
  href?: string;
}

export type TasksRunDetailSectionId = "execution" | "objective" | "outcome" | "activity";

export interface TasksRunDetailSection {
  id: TasksRunDetailSectionId;
  title: string;
  summary: string;
  items: Array<[label: string, value: string]>;
}

export interface TasksUsageSummary {
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  sourceSessionId: string;
}

export interface TasksTaskListItem {
  id: string;
  title: string;
  status: WorkTaskStatus;
  ownerMemberId: string;
  ownerDisplayName?: string;
  ownerAvatarSeed?: string;
  requesterMemberId?: string;
  sourceKind: WorkTaskRecord["sourceKind"];
  updatedAt: string;
  acceptanceCriteria: string;
  revision: number;
  nextStep: string;
  sourceLink?: TasksSourceLink;
  schedule: TasksTaskScheduleSummary;
  executionCount: number;
  latestExecution?: TasksRunListItem;
}

export interface TasksTaskScheduleSummary {
  kind: "none" | WorkScheduleRecord["kind"];
  status?: WorkScheduleStatus;
  nextRunAt?: string;
  lastRunAt?: string;
  timezone?: string;
  ruleSummary?: string;
  runCount: number;
  maxRuns?: number;
}

export interface TasksScheduleListItem {
  id: string;
  workTaskId: string;
  title: string;
  status: WorkScheduleStatus;
  ownerMemberId?: string;
  kind: WorkScheduleRecord["kind"];
  nextRunAt?: string;
  lastRunAt?: string;
  updatedAt: string;
  runCount: number;
  maxRuns?: number;
  timezone?: string;
  nextStep: string;
  task?: TasksTaskListItem;
}

export interface TasksRunListItem {
  id: string;
  workTaskId: string;
  title: string;
  status: WorkRunStatus;
  assigneeMemberId: string;
  taskRevision: number;
  sourceKind: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
  nextStep: string;
  needsParticipantInput: boolean;
  actions: TasksAction[];
  sourceLink?: TasksSourceLink;
}

export interface TasksTaskDetail extends TasksTaskListItem {
  description?: string;
  canceledReason?: string;
  scheduleRecord?: TasksScheduleListItem;
  executions: TasksRunListItem[];
  revisions: Array<{
    revision: number;
    title: string;
    description?: string;
    acceptanceCriteria: string;
    changedByMemberId: string;
    reason: string;
    sourceWorkRunId?: string;
    createdAt: string;
  }>;
}

export interface TasksScheduleDetail extends TasksScheduleListItem {
  pausedReason?: string;
  canceledReason?: string;
  scheduleRule?: WorkScheduleRecord["scheduleRule"];
}

export interface TasksRunDetail extends TasksRunListItem {
  task?: TasksTaskListItem;
  schedule?: TasksScheduleListItem;
  blockedReason?: string;
  failedReason?: string;
  canceledReason?: string;
  resultSummary?: string;
  actions: TasksAction[];
  participantInput: {
    required: boolean;
    reason?: string;
  };
  evidenceLinks: TasksEvidenceLink[];
  usageSummary?: TasksUsageSummary;
  timeline: TasksTimelineEntry[];
  detailSections: TasksRunDetailSection[];
}

export interface TasksViewModel {
  contract: {
    name: "tasks";
    version: 3;
    productBoundary: "task-aggregate";
  };
  routes: {
    htmlPath: string;
    viewModelJsonPath: string;
  };
  refresh: {
    indexIntervalMs: number;
    detailIntervalMs: number;
  };
  filters: {
    view: TasksViewMode;
    status: TasksStatusFilter;
    sort: TasksSortMode;
    owner?: string;
    selectedWorkTaskId?: string;
  };
  statusOptions: Array<{
    id: TasksStatusFilter;
    label: string;
    count: number;
  }>;
  sortOptions: Array<{
    id: TasksSortMode;
    label: string;
  }>;
  summary: {
    runningRunCount: number;
    blockedRunCount: number;
    dispatchFailedCount: number;
    activeTaskCount: number;
    enabledScheduleCount: number;
    participantInputCount: number;
  };
  tasks: TasksTaskListItem[];
  selected:
    | { kind: "task"; task: TasksTaskDetail }
    | { kind: undefined };
  recentOperatingEvents: OperatingEventRecord[];
}

function actionPath(runId: string, action: TasksAction["id"], routes: TasksViewModelRoutes): string {
  return `${routes.runActionPathPrefix}/${encodeURIComponent(runId)}/actions/${action}`;
}

function productHref(basePath: "/app/tasks" | "/app/sessions", params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) {
      query.set(key, value);
    }
  }
  const queryText = query.toString();
  return queryText ? `${basePath}?${queryText}` : basePath;
}

function buildAction(input: {
  id: TasksAction["id"];
  label: string;
  run: WorkRunRecord;
  latestLease?: WorkDispatchLeaseRecord;
  routes: TasksViewModelRoutes;
}): TasksAction {
  const { id, label, run, latestLease, routes } = input;
  let enabled = false;
  let reason: string | undefined;
  if (id === "retry-dispatch") {
    enabled = run.status === "queued" && latestLease?.status === "failed";
    reason = enabled
      ? undefined
      : "Retry dispatch is only available for queued runs with a failed dispatch lease.";
  }
  if (id === "retry-run") {
    enabled = run.status === "failed";
    reason = enabled ? undefined : "Retry is only available for failed WorkRuns.";
  }
  if (id === "cancel-run") {
    enabled = run.status === "queued" || run.status === "in_progress" || run.status === "blocked";
    reason = enabled ? undefined : "Cancel is only available before the WorkRun reaches a terminal state.";
  }
  return {
    id,
    label,
    method: "post",
    path: actionPath(run.id, id, routes),
    enabled,
    reason,
  };
}

export function buildTasksRunActions(run: WorkRunRecord, latestLease: WorkDispatchLeaseRecord | undefined, routes: TasksViewModelRoutes): TasksAction[] {
  return [
    buildAction({ id: "retry-dispatch", label: "Retry Dispatch", run, latestLease, routes }),
    buildAction({ id: "retry-run", label: "Retry WorkRun", run, latestLease, routes }),
    buildAction({ id: "cancel-run", label: "Cancel", run, latestLease, routes }),
  ];
}

function metadataText(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function metadataBoolean(metadata: Record<string, unknown> | undefined, key: string): boolean {
  return metadata?.[key] === true;
}

function buildSourceLink(task: WorkTaskRecord): TasksSourceLink | undefined {
  const conversationId = metadataText(task.metadata, "conversationId");
  const messageId = metadataText(task.metadata, "messageId");
  const chatEntryId = metadataText(task.metadata, "chatEntryId");
  if (metadataBoolean(task.metadata, "sourceConversationUnavailable")) {
    return {
      kind: "manual-source",
      href: "#",
      label: metadataText(task.metadata, "sourceConversationUnavailableReason") || "Original Chat source is unavailable.",
      sourceId: task.sourceId,
    };
  }
  if (conversationId && messageId) {
    return {
      kind: "conversation-message",
      href: `/app/tasks/source/chat-message/${encodeURIComponent(`${conversationId}:${messageId}`)}`,
      label: `Message ${messageId}`,
      conversationId,
      messageId,
      chatEntryId,
    };
  }
  if (conversationId) {
    return {
      kind: "conversation",
      href: `/app/tasks/source/chat-conversation/${encodeURIComponent(conversationId)}`,
      label: `Conversation ${conversationId}`,
      conversationId,
      chatEntryId,
    };
  }
  if (chatEntryId) {
    return {
      kind: "chat-entry",
      href: `/app/tasks/source/chat-entry/${encodeURIComponent(chatEntryId)}`,
      label: `Chat entry ${chatEntryId}`,
      chatEntryId,
    };
  }
  if (task.sourceKind === "intake_event") {
    return {
      kind: "intake-event",
      href: `/app/tasks/source/intake-event/${encodeURIComponent(task.sourceId)}`,
      label: `Intake event ${task.sourceId}`,
      sourceId: task.sourceId,
    };
  }
  if (task.sourceKind === "manual") {
    return {
      kind: "manual-source",
      href: `/app/tasks/source/manual-source/${encodeURIComponent(task.sourceId)}`,
      label: `Manual source ${task.sourceId}`,
      sourceId: task.sourceId,
    };
  }
  return undefined;
}

function describeTaskNextStep(input: {
  task: WorkTaskRecord;
  schedules: WorkScheduleRecord[];
  latestRun?: WorkRunRecord;
}): string {
  if (input.latestRun?.status === "blocked") {
    return `Waiting for participant input on ${input.latestRun.id}.`;
  }
  if (input.task.status === "canceled") {
    return input.task.canceledReason ? `Canceled: ${input.task.canceledReason}` : "Canceled.";
  }
  if (input.task.status === "completed") {
    return input.latestRun?.resultSummary ? `Completed: ${input.latestRun.resultSummary}` : "Completed.";
  }
  if (input.task.status === "archived") {
    return input.latestRun
      ? `Archived with latest execution ${input.latestRun.status}: ${describeRunNextStep(input.latestRun)}`
      : "Archived without execution history.";
  }
  const nextSchedule = input.schedules
    .filter((schedule) => schedule.status === "enabled" && schedule.nextRunAt)
    .sort((left, right) => (left.nextRunAt || "").localeCompare(right.nextRunAt || ""))[0];
  if (nextSchedule?.nextRunAt) {
    return `Next scheduled run at ${nextSchedule.nextRunAt}.`;
  }
  if (input.latestRun?.status === "queued") {
    return `Queued run ${input.latestRun.id} is waiting for dispatch.`;
  }
  if (input.latestRun?.status === "in_progress") {
    return `Run ${input.latestRun.id} is in progress.`;
  }
  if (input.latestRun?.status === "failed") {
    return `Latest run failed: ${input.latestRun.failedReason || "No failure reason was recorded."}`;
  }
  if (input.latestRun?.status === "canceled") {
    return `Latest run was canceled: ${input.latestRun.canceledReason || "No cancellation reason was recorded."}`;
  }
  if (input.latestRun?.status === "done") {
    return `Latest run completed: ${input.latestRun.resultSummary || "Completion evidence is available in execution history."}`;
  }
  if (input.schedules.some((schedule) => schedule.status === "enabled")) {
    return "Waiting for the next schedule tick.";
  }
  return "No execution or schedule exists. Cancel this invalid Task and recreate it from Chat.";
}

function describeScheduleNextStep(schedule: WorkScheduleRecord): string {
  if (schedule.status === "paused") {
    return schedule.pausedReason ? `Paused: ${schedule.pausedReason}` : "Paused.";
  }
  if (schedule.status === "canceled") {
    return schedule.canceledReason ? `Canceled: ${schedule.canceledReason}` : "Canceled.";
  }
  if (schedule.status === "completed") {
    return "Schedule completed.";
  }
  if (schedule.nextRunAt) {
    return `Next run at ${schedule.nextRunAt}.`;
  }
  return "Enabled; waiting for the next calculated run.";
}

function describeRunNextStep(run: WorkRunRecord): string {
  if (run.status === "queued") return "Waiting for dispatch to an assigned member.";
  if (run.status === "in_progress") return "Assigned member is executing this WorkRun.";
  if (run.status === "blocked") return run.blockedReason || "Waiting for participant input.";
  if (run.status === "done") return run.resultSummary || "Completed.";
  if (run.status === "failed") return run.failedReason || "Failed.";
  return run.canceledReason || "Canceled.";
}

function buildTaskItem(input: {
  task: WorkTaskRecord;
  schedules: WorkScheduleRecord[];
  runs: WorkRunRecord[];
  latestLeaseByRunId: Map<string, WorkDispatchLeaseRecord | undefined>;
  routes: TasksViewModelRoutes;
  memberProfiles?: CompanyMemberProfile[];
}): TasksTaskListItem {
  const latestRun = latestRunForTask(input.runs, input.task.id);
  const taskRuns = input.runs.filter((run) => run.workTaskId === input.task.id);
  return {
    id: input.task.id,
    title: input.task.title,
    status: input.task.status,
    ownerMemberId: input.task.ownerMemberId,
    ownerDisplayName: input.memberProfiles?.find((member) => member.id === input.task.ownerMemberId)?.displayName,
    ownerAvatarSeed: input.memberProfiles?.find((member) => member.id === input.task.ownerMemberId)?.avatarSeed,
    requesterMemberId: input.task.requesterId,
    sourceKind: input.task.sourceKind,
    updatedAt: input.task.updatedAt,
    acceptanceCriteria: input.task.acceptanceCriteria,
    revision: input.task.revision,
    nextStep: describeTaskNextStep({
      task: input.task,
      schedules: input.schedules,
      latestRun,
    }),
    sourceLink: buildSourceLink(input.task),
    schedule: buildTaskScheduleSummary(input.task, input.schedules),
    executionCount: taskRuns.length,
    latestExecution: latestRun ? buildRunItem({
      run: latestRun,
      task: input.task,
      latestLease: input.latestLeaseByRunId.get(latestRun.id),
      routes: input.routes,
    }) : undefined,
  };
}

function buildTaskScheduleSummary(task: WorkTaskRecord, schedules: WorkScheduleRecord[]): TasksTaskScheduleSummary {
  const schedule = schedules.find((candidate) => candidate.status === "enabled") ?? schedules[0];
  if (schedule) {
    return {
      kind: schedule.kind,
      status: schedule.status,
      nextRunAt: schedule.nextRunAt,
      lastRunAt: schedule.lastRunAt,
      timezone: schedule.timezone,
      ruleSummary: scheduleRuleSummary(schedule),
      runCount: schedule.runCount,
      maxRuns: schedule.maxRuns,
    };
  }
  return {
    kind: "none",
    runCount: 0,
  };
}

function scheduleRuleSummary(schedule: WorkScheduleRecord): string | undefined {
  if (schedule.kind === "scheduled_once") return "Once";
  if (schedule.kind !== "recurring") return undefined;
  const intervalMs = schedule.scheduleRule?.intervalMs;
  if (typeof intervalMs === "number" && Number.isFinite(intervalMs) && intervalMs > 0) {
    if (intervalMs === 60 * 60 * 1000) return "Hourly";
    if (intervalMs === 24 * 60 * 60 * 1000) return "Daily";
    if (intervalMs === 7 * 24 * 60 * 60 * 1000) return "Weekly";
    if (intervalMs % (24 * 60 * 60 * 1000) === 0) {
      return `Every ${intervalMs / (24 * 60 * 60 * 1000)} days`;
    }
    if (intervalMs % (60 * 60 * 1000) === 0) {
      return `Every ${intervalMs / (60 * 60 * 1000)} hours`;
    }
    if (intervalMs % (60 * 1000) === 0) {
      return `Every ${intervalMs / (60 * 1000)} minutes`;
    }
    return "Recurring";
  }
  if (schedule.scheduleRule?.cron) return `Cron ${schedule.scheduleRule.cron}`;
  if (schedule.scheduleRule?.rrule) return "RRule";
  return "Recurring";
}

function buildScheduleItem(input: {
  schedule: WorkScheduleRecord;
  task?: WorkTaskRecord;
  taskItem?: TasksTaskListItem;
}): TasksScheduleListItem {
  return {
    id: input.schedule.id,
    workTaskId: input.schedule.workTaskId,
    title: input.task?.title || input.schedule.id,
    status: input.schedule.status,
    ownerMemberId: input.task?.ownerMemberId,
    kind: input.schedule.kind,
    nextRunAt: input.schedule.nextRunAt,
    lastRunAt: input.schedule.lastRunAt,
    updatedAt: input.schedule.updatedAt,
    runCount: input.schedule.runCount,
    maxRuns: input.schedule.maxRuns,
    timezone: input.schedule.timezone,
    nextStep: describeScheduleNextStep(input.schedule),
    task: input.taskItem,
  };
}

function buildRunItem(input: {
  run: WorkRunRecord;
  task?: WorkTaskRecord;
  latestLease?: WorkDispatchLeaseRecord;
  routes: TasksViewModelRoutes;
}): TasksRunListItem {
  return {
    id: input.run.id,
    workTaskId: input.run.workTaskId,
    title: input.task?.title || input.run.id,
    status: input.run.status,
    assigneeMemberId: input.run.assigneeMemberId,
    taskRevision: input.run.taskRevision,
    sourceKind: input.task?.sourceKind || "unknown-source",
    startedAt: input.run.startedAt,
    completedAt: input.run.completedAt,
    updatedAt: input.run.updatedAt,
    nextStep: describeRunNextStep(input.run),
    needsParticipantInput: input.run.status === "blocked",
    actions: buildTasksRunActions(input.run, input.latestLease, input.routes),
    sourceLink: input.task ? buildSourceLink(input.task) : undefined,
  };
}

function buildTaskDetail(input: {
  detail: PersistedWorkTaskDetail;
  taskItem: TasksTaskListItem;
  scheduleItems: TasksScheduleListItem[];
  runItems: TasksRunListItem[];
}): TasksTaskDetail {
  return {
    ...input.taskItem,
    description: input.detail.task.description,
    canceledReason: input.detail.task.canceledReason,
    scheduleRecord: input.scheduleItems.find((schedule) => schedule.status === "enabled") ?? input.scheduleItems[0],
    executions: input.runItems,
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
  };
}

function buildScheduleDetail(input: {
  schedule: WorkScheduleRecord;
  task?: WorkTaskRecord;
  scheduleItem: TasksScheduleListItem;
}): TasksScheduleDetail {
  return {
    ...input.scheduleItem,
    pausedReason: input.schedule.pausedReason,
    canceledReason: input.schedule.canceledReason,
    scheduleRule: input.schedule.scheduleRule,
  };
}

function leaseTimestamp(lease: WorkDispatchLeaseRecord): string {
  return lease.failedAt || lease.acknowledgedAt || lease.canceledAt || lease.dispatchedAt;
}

function buildLeaseTimelineEntry(lease: WorkDispatchLeaseRecord): TasksTimelineEntry {
  const title = lease.status === "failed"
    ? "Dispatch failed"
    : lease.status === "acknowledged"
      ? "Dispatch acknowledged"
      : lease.status === "canceled"
        ? "Dispatch canceled"
        : "Dispatch pending";
  return {
    kind: "lease",
    timestamp: leaseTimestamp(lease),
    title,
    summary: lease.failureReason,
    status: lease.status,
  };
}

function buildEventTimelineEntry(event: WorkRunEventRecord): TasksTimelineEntry {
  return {
    kind: "event",
    timestamp: event.timestamp,
    title: event.eventType,
    summary: event.summary,
  };
}

function buildTraceTimelineEntry(event: ProcessTraceEvent): TasksTimelineEntry {
  return {
    kind: "trace",
    timestamp: event.timestamp,
    title: event.title,
    summary: event.summary || event.preview,
    status: event.status,
    targetId: event.id,
    href: `/api/process-trace?processTraceId=${encodeURIComponent(event.id)}`,
  };
}

function formatInteger(value: number): string {
  return Math.max(0, Math.round(value)).toLocaleString("en-US");
}

function buildUsageSummary(session: RuntimeSessionRecord | undefined): TasksUsageSummary | undefined {
  if (!session) {
    return undefined;
  }
  if (!session.tokenInputTotal && !session.tokenOutputTotal && !session.tokenCacheTotal) {
    return undefined;
  }
  return {
    inputTokens: session.tokenInputTotal,
    outputTokens: session.tokenOutputTotal,
    cacheTokens: session.tokenCacheTotal,
    sourceSessionId: session.id,
  };
}

function buildEvidenceLinks(input: {
  run: WorkRunRecord;
  runtimeSession?: RuntimeSessionRecord;
  traces: ProcessTraceEvent[];
}): TasksEvidenceLink[] {
  const links: TasksEvidenceLink[] = [{
    kind: "work-run",
    href: productHref("/app/tasks", { workTaskId: input.run.workTaskId }),
    label: `WorkRun ${input.run.id}`,
    targetId: input.run.id,
    workRunId: input.run.id,
  }];
  if (input.runtimeSession) {
    links.push({
      kind: "session",
      href: productHref("/app/sessions", {
        employeeId: input.runtimeSession.employeeId,
        sessionId: input.runtimeSession.id,
      }),
      label: `Session ${input.runtimeSession.id}`,
      targetId: input.runtimeSession.id,
      sessionId: input.runtimeSession.id,
      workRunId: input.run.id,
    });
  }
  for (const trace of input.traces) {
    links.push({
      kind: "process-trace",
      href: `/api/process-trace?processTraceId=${encodeURIComponent(trace.id)}`,
      label: `Process Trace ${trace.id}`,
      targetId: trace.id,
      processTraceId: trace.id,
      workRunId: input.run.id,
      sessionId: input.runtimeSession?.id,
    });
  }
  const seen = new Set<string>();
  return links.filter((link) => {
    const key = `${link.kind}:${link.targetId}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function formatUsageSummary(usage: TasksUsageSummary | undefined): string | undefined {
  if (!usage) {
    return undefined;
  }
  return `in: ${formatInteger(usage.inputTokens)} / out: ${formatInteger(usage.outputTokens)} / cache: ${formatInteger(usage.cacheTokens)}`;
}

function buildTimeline(input: {
  events: WorkRunEventRecord[];
  traces: ProcessTraceEvent[];
  latestLease?: WorkDispatchLeaseRecord;
}): TasksTimelineEntry[] {
  const entries = [
    ...(input.latestLease ? [buildLeaseTimelineEntry(input.latestLease)] : []),
    ...input.traces.map(buildTraceTimelineEntry),
    ...input.events.map(buildEventTimelineEntry),
  ];
  return entries.sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}

function detailItems(items: Array<[string, string | undefined]>): Array<[label: string, value: string]> {
  return items
    .filter((item): item is [string, string] => Boolean(item[1]))
    .map(([label, value]) => [label, value]);
}

function buildRunDetailSections(input: {
  base: TasksRunListItem;
  run: WorkRunRecord;
  task?: TasksTaskListItem;
  latestLease?: WorkDispatchLeaseRecord;
  timeline: TasksTimelineEntry[];
  usageSummary?: TasksUsageSummary;
}): TasksRunDetailSection[] {
  const latestTimelineEntry = input.timeline.at(-1);
  const runtimeEvidence = input.timeline.some((entry) => entry.kind === "trace")
    ? "process trace observed"
    : "not_observed";
  return [
    {
      id: "execution",
      title: "Execution",
      summary: "Current WorkRun ownership and execution state.",
      items: detailItems([
        ["WorkRun", input.base.id],
        ["Status", input.base.status],
        ["Assignee", input.base.assigneeMemberId],
        ["What happens next", input.base.nextStep],
      ]),
    },
    {
      id: "objective",
      title: "Objective",
      summary: "The WorkTask goal and verification contract for this run.",
      items: detailItems([
        ["WorkTask", input.base.workTaskId],
        ["Acceptance", input.task?.acceptanceCriteria],
        ["Source", input.base.sourceLink?.label],
      ]),
    },
    {
      id: "outcome",
      title: "Outcome",
      summary: "Observed result and terminal or blocking reason.",
      items: detailItems([
        ["Result", input.run.resultSummary],
        ["Blocked reason", input.run.blockedReason],
        ["Failed reason", input.run.failedReason],
        ["Canceled reason", input.run.canceledReason],
      ]),
    },
    {
      id: "activity",
      title: "Activity",
      summary: "Runtime evidence available for inspection.",
      items: detailItems([
        ["Persisted WorkRun status", input.run.status],
        ["Dispatch lease evidence", input.latestLease?.status || "not_observed"],
        ["Runtime evidence", runtimeEvidence],
        ["Usage", formatUsageSummary(input.usageSummary)],
        ["Latest event", latestTimelineEntry?.title || "not_observed"],
        ["Updated at", input.run.updatedAt],
        ["Timeline entries", String(input.timeline.length)],
      ]),
    },
  ];
}

function buildRunDetail(input: {
  run: WorkRunRecord;
  task?: WorkTaskRecord;
  schedule?: WorkScheduleRecord;
  latestLease?: WorkDispatchLeaseRecord;
  runtimeSession?: RuntimeSessionRecord;
  events: WorkRunEventRecord[];
  traces: ProcessTraceEvent[];
  taskItem?: TasksTaskListItem;
  scheduleItem?: TasksScheduleListItem;
  routes: TasksViewModelRoutes;
}): TasksRunDetail {
  const base = buildRunItem({
    run: input.run,
    task: input.task,
    latestLease: input.latestLease,
    routes: input.routes,
  });
  const timeline = buildTimeline({
    events: input.events,
    traces: input.traces,
    latestLease: input.latestLease,
  });
  const usageSummary = buildUsageSummary(input.runtimeSession);
  const evidenceLinks = buildEvidenceLinks({
    run: input.run,
    runtimeSession: input.runtimeSession,
    traces: input.traces,
  });
  return {
    ...base,
    task: input.taskItem,
    schedule: input.scheduleItem,
    blockedReason: input.run.blockedReason,
    failedReason: input.run.failedReason,
    canceledReason: input.run.canceledReason,
    resultSummary: input.run.resultSummary,
    actions: buildTasksRunActions(input.run, input.latestLease, input.routes),
    participantInput: {
      required: input.run.status === "blocked",
      reason: input.run.blockedReason,
    },
    evidenceLinks,
    usageSummary,
    timeline,
    detailSections: buildRunDetailSections({
      base,
      run: input.run,
      task: input.taskItem,
      latestLease: input.latestLease,
      timeline,
      usageSummary,
    }),
  };
}

function tasksContractError(message: string): Error & { statusCode: number } {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = 400;
  return error;
}

function resolveView(requestUrl?: URL): TasksViewMode {
  const view = requestUrl?.searchParams.get("view");
  if (view && view !== "tasks") {
    throw tasksContractError("Tasks view only supports view=tasks. Retired Tasks view routes are not supported.");
  }
  return "tasks";
}

function resolveStatus(requestUrl: URL | undefined, view: TasksViewMode): TasksStatusFilter {
  const status = requestUrl?.searchParams.get("status");
  if (!status || status === "all") return "all";
  if ((taskStatusOrder as readonly string[]).includes(status)) {
    return status as WorkTaskStatus;
  }
  return "all";
}

function resolveSort(requestUrl?: URL): TasksSortMode {
  const sort = requestUrl?.searchParams.get("sort");
  return sort === "severity" || sort === "status" || sort === "owner" ? sort : "recent";
}

const runStatusOrder: Array<"all" | WorkRunStatus> = [
  "all",
  "queued",
  "in_progress",
  "blocked",
  "failed",
  "done",
  "canceled",
];

const taskStatusOrder: Array<"all" | WorkTaskStatus> = [
  "all",
  "active",
  "completed",
  "canceled",
  "archived",
];

const statusLabels: Record<TasksStatusFilter, string> = {
  all: "All",
  active: "Active",
  completed: "Completed",
  canceled: "Canceled",
  archived: "Archived",
};

const severityRank: Record<WorkRunStatus, number> = {
  failed: 0,
  blocked: 1,
  in_progress: 2,
  queued: 3,
  done: 4,
  canceled: 5,
};

function compareRecent(left: { updatedAt: string; id: string }, right: { updatedAt: string; id: string }): number {
  return right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id);
}

function sortRuns(rows: TasksRunListItem[], sort: TasksSortMode): TasksRunListItem[] {
  const sorted = [...rows];
  if (sort === "severity") {
    return sorted.sort((left, right) =>
      severityRank[left.status] - severityRank[right.status] ||
      compareRecent(left, right)
    );
  }
  if (sort === "status") {
    return sorted.sort((left, right) =>
      left.status.localeCompare(right.status) ||
      compareRecent(left, right)
    );
  }
  if (sort === "owner") {
    return sorted.sort((left, right) =>
      left.assigneeMemberId.localeCompare(right.assigneeMemberId) ||
      compareRecent(left, right)
    );
  }
  return sorted.sort(compareRecent);
}

function sortTasks(rows: TasksTaskListItem[], sort: TasksSortMode): TasksTaskListItem[] {
  const sorted = [...rows];
  if (sort === "status") {
    return sorted.sort((left, right) =>
      left.status.localeCompare(right.status) ||
      compareRecent(left, right)
    );
  }
  if (sort === "owner") {
    return sorted.sort((left, right) =>
      left.ownerMemberId.localeCompare(right.ownerMemberId) ||
      compareRecent(left, right)
    );
  }
  return sorted.sort(compareRecent);
}

function sortSchedules(rows: TasksScheduleListItem[], sort: TasksSortMode): TasksScheduleListItem[] {
  const sorted = [...rows];
  if (sort === "status") {
    return sorted.sort((left, right) =>
      left.status.localeCompare(right.status) ||
      compareRecent(left, right)
    );
  }
  if (sort === "owner") {
    return sorted.sort((left, right) =>
      (left.ownerMemberId || "").localeCompare(right.ownerMemberId || "") ||
      compareRecent(left, right)
    );
  }
  return sorted.sort(compareRecent);
}

function buildStatusOptions<T extends { status: string }>(
  rows: T[],
  order: Array<"all" | T["status"]>,
): TasksViewModel["statusOptions"] {
  return order.map((status) => ({
    id: status as TasksStatusFilter,
    label: statusLabels[status as TasksStatusFilter],
    count: status === "all" ? rows.length : rows.filter((row) => row.status === status).length,
  }));
}

function buildSortOptions(view: TasksViewMode): TasksViewModel["sortOptions"] {
  return [
    { id: "recent", label: "Recent" },
    { id: "status", label: "Status" },
    { id: "owner", label: "Owner" },
  ];
}

function normalizeOptions(input?: URL | TasksViewModelOptions): TasksViewModelOptions {
  if (input instanceof URL) {
    return { requestUrl: input };
  }
  return input || {};
}

function latestRunForTask(runs: WorkRunRecord[], workTaskId: string): WorkRunRecord | undefined {
  return runs
    .filter((run) => run.workTaskId === workTaskId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))[0];
}

export function buildTasksViewModel(
  view: TasksViewState,
  input?: URL | TasksViewModelOptions,
): TasksViewModel {
  const options = normalizeOptions(input);
  const routes: TasksViewModelRoutes = {
    htmlPath: options.routes?.htmlPath || "/tasks",
    viewModelJsonPath: options.routes?.viewModelJsonPath || "/api/companies/:companyId/tasks/view-model",
    runActionPathPrefix: options.routes?.runActionPathPrefix || "/api/companies/:companyId/tasks/runs",
  };
  const scheduleRowsByTaskId = new Map<string, WorkScheduleRecord[]>();
  for (const schedule of view.state.schedules) {
    const rows = scheduleRowsByTaskId.get(schedule.workTaskId) || [];
    rows.push(schedule);
    scheduleRowsByTaskId.set(schedule.workTaskId, rows);
  }
  const runRowsByTaskId = new Map<string, WorkRunRecord[]>();
  const latestLeaseByRunId = new Map<string, WorkDispatchLeaseRecord | undefined>();
  for (const row of view.state.runs) {
    const rows = runRowsByTaskId.get(row.run.workTaskId) || [];
    rows.push(row.run);
    runRowsByTaskId.set(row.run.workTaskId, rows);
    latestLeaseByRunId.set(row.run.id, row.latestLease);
  }
  const taskById = new Map(view.state.tasks.map((task) => [task.id, task] as const));
  const taskRows = view.state.tasks.map((task) =>
    buildTaskItem({
      task,
      schedules: scheduleRowsByTaskId.get(task.id) || [],
      runs: runRowsByTaskId.get(task.id) || [],
      latestLeaseByRunId,
      routes,
      memberProfiles: options.memberProfiles,
    })
  );
  const taskRowById = new Map(taskRows.map((task) => [task.id, task] as const));
  const scheduleRows = view.state.schedules.map((schedule) =>
    buildScheduleItem({
      schedule,
      task: taskById.get(schedule.workTaskId),
      taskItem: taskRowById.get(schedule.workTaskId),
    })
  );
  const scheduleRowById = new Map(scheduleRows.map((schedule) => [schedule.id, schedule] as const));
  const runRows = view.state.runs.map((row) =>
    buildRunItem({
      run: row.run,
      task: row.task,
      latestLease: row.latestLease,
      routes,
    })
  );
  const currentView = resolveView(options.requestUrl);
  const status = resolveStatus(options.requestUrl, currentView);
  const sort = resolveSort(options.requestUrl);
  const filteredTaskRows = status === "all"
    ? taskRows.filter((task) => task.status !== "archived")
    : taskRows.filter((task) => task.status === status);
  const visibleTaskRows = sortTasks(filteredTaskRows, sort);
  const selectedTaskDetail = view.state.selectedTaskDetail;

  return {
    contract: {
      name: "tasks",
      version: 3,
      productBoundary: "task-aggregate",
    },
    routes,
    refresh: {
      indexIntervalMs: 5_000,
      detailIntervalMs: 3_000,
    },
    filters: {
      view: currentView,
      status,
      sort,
      owner: view.state.ownerFilter,
      selectedWorkTaskId: view.state.selectedWorkTaskId,
    },
    statusOptions: buildStatusOptions(taskRows, taskStatusOrder),
    sortOptions: buildSortOptions(currentView),
    summary: {
      runningRunCount: view.summary.activeCount,
      blockedRunCount: view.summary.blockedCount,
      dispatchFailedCount: view.summary.dispatchFailedCount,
      activeTaskCount: view.state.tasks.filter((task) => task.status === "active").length,
      enabledScheduleCount: view.state.schedules.filter((schedule) => schedule.status === "enabled").length,
      participantInputCount: view.state.runs.filter((row) => row.run.status === "blocked").length,
    },
    tasks: visibleTaskRows,
    selected: selectedTaskDetail
        ? {
            kind: "task",
            task: buildTaskDetail({
              detail: selectedTaskDetail,
              taskItem: taskRowById.get(selectedTaskDetail.task.id) || buildTaskItem({
                task: selectedTaskDetail.task,
                schedules: selectedTaskDetail.schedules,
                runs: selectedTaskDetail.runs,
                latestLeaseByRunId,
                routes,
                memberProfiles: options.memberProfiles,
              }),
              scheduleItems: selectedTaskDetail.schedules.map((schedule) =>
                scheduleRowById.get(schedule.id) || buildScheduleItem({
                  schedule,
                  task: selectedTaskDetail.task,
                  taskItem: taskRowById.get(selectedTaskDetail.task.id),
                })
              ),
              runItems: selectedTaskDetail.runs.map((run) =>
                buildRunItem({
                  run,
                  task: selectedTaskDetail.task,
                  latestLease: latestLeaseByRunId.get(run.id),
                  routes,
                })
              ),
            }),
          }
        : { kind: undefined },
    recentOperatingEvents: view.summary.recentOperatingEvents,
  };
}
