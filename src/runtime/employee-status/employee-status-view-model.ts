import type { ChannelTopic } from "../../channel-topics/domain/channel-topic.js";
import type { EmployeeAdminRecord } from "../company-config/employees-admin.js";
import type { RuntimeSessionRecord } from "../storage/runtime-session-repository.js";
import type {
  WorkRunRecord,
  WorkScheduleRule,
  WorkTaskRecord,
  WorkTriggerKind,
} from "../../work/domain.js";
import type { WorkDispatchLeaseRecord } from "../../work/work-dispatch-lease.js";

export type EmployeePrimaryStatusKind =
  | "blocked"
  | "configuration_needed"
  | "executing"
  | "holding_topic"
  | "has_work"
  | "idle";

export type EmployeeStatusFilter = "all" | "configuration" | "running" | "blocked" | "failed" | "idle";
export type EmployeeStatusSortMode = "recent" | "severity" | "name";

export interface EmployeeStatusCurrentItem {
  kind: "work-run" | "work-task" | "session" | "topic";
  id: string;
  title: string;
  status: string;
  updatedAt: string;
  summary?: string;
  href?: string;
}

export interface EmployeeStatusIssue {
  kind: "blocked-work-run" | "failed-work-run" | "failed-session" | "interrupted-session";
  title: string;
  summary: string;
  status: string;
  updatedAt: string;
  target: {
    kind: "work-run" | "work-task" | "session";
    id: string;
    label?: string;
  };
  relatedTarget?: {
    kind: "work-run" | "work-task" | "session";
    id: string;
    label?: string;
  };
}

export interface EmployeeStatusCard {
  employeeId: string;
  displayName: string;
  role: string;
  presenceMode: string;
  runtime: {
    modelProvider?: string;
    modelId?: string;
    modelConfigured: boolean;
    modelDisplay: string;
    thinkingLevel: string;
  };
  primaryStatus: {
    kind: EmployeePrimaryStatusKind;
    label: string;
    reason: string;
    updatedAt?: string;
  };
  evidence: {
    persistedWorkRunStatus: string;
    runtimeSessionStatus: string;
    dispatchLeaseStatus: WorkDispatchLeaseRecord["status"] | "not_observed";
    latestEventAt?: string;
  };
  load: {
    runningSessionCount: number;
    topicInHandCount: number;
    activeWorkRunCount: number;
    blockedWorkRunCount: number;
    activeWorkTaskCount: number;
    recentFailureCount: number;
  };
  currentItems: EmployeeStatusCurrentItem[];
  issues: EmployeeStatusIssue[];
}

export type EmployeeStatusDetailSectionId =
  | "current-work-run"
  | "active-work-task"
  | "running-session"
  | "failed-session"
  | "topics-in-hand";

export interface EmployeeStatusDetailSection {
  id: EmployeeStatusDetailSectionId;
  title: string;
  summary: string;
  items: Array<[label: string, value: string]>;
  links: Array<{
    label: string;
    href: string;
  }>;
}

export interface EmployeeStatusViewModel {
  contract: {
    name: "employee-status";
    version: 1;
    productBoundary: "employee-centered-runtime-status";
  };
  routes: {
    viewModelJsonPath: string;
  };
  refresh: {
    strategy: "runtime-events";
    reconnectRecovery: true;
  };
  filters: {
    employeeId?: string;
    status: EmployeeStatusFilter;
    sort: EmployeeStatusSortMode;
  };
  statusOptions: Array<{
    id: EmployeeStatusFilter;
    label: string;
    count: number;
  }>;
  sortOptions: Array<{
    id: EmployeeStatusSortMode;
    label: string;
  }>;
  generatedAt: string;
  employees: EmployeeStatusCard[];
  selected: {
    employeeId?: string;
    employee?: EmployeeStatusCard;
    detailSections: EmployeeStatusDetailSection[];
  };
}
export interface ScheduledWorkTaskRecord extends WorkTaskRecord {
  scheduleKind: WorkTriggerKind;
  timezone?: string;
  scheduleRule?: WorkScheduleRule;
  nextRunAt?: string;
  lastRunAt?: string;
  runCount: number;
  maxRuns?: number;
}

export interface BuildEmployeeStatusViewModelInput {
  generatedAt?: string;
  employeeId?: string;
  status?: EmployeeStatusFilter;
  sort?: EmployeeStatusSortMode;
  employees: EmployeeAdminRecord[];
  workTasks: ScheduledWorkTaskRecord[];
  workRuns: WorkRunRecord[];
  dispatchLeases?: WorkDispatchLeaseRecord[];
  sessions: RuntimeSessionRecord[];
  channelTopics: ChannelTopic[];
  routes?: {
    viewModelJsonPath?: string;
  };
}

const activeWorkRunStatuses = new Set<WorkRunRecord["status"]>(["queued", "in_progress", "blocked"]);
const statusOrder: EmployeeStatusFilter[] = ["all", "configuration", "running", "blocked", "failed", "idle"];
const statusLabels: Record<EmployeeStatusFilter, string> = {
  all: "All",
  configuration: "Needs config",
  running: "Running",
  blocked: "Blocked",
  failed: "Failed",
  idle: "Idle",
};
const sortOptions: EmployeeStatusViewModel["sortOptions"] = [
  { id: "recent", label: "Recent activity" },
  { id: "severity", label: "Severity" },
  { id: "name", label: "Name" },
];
const severityRank: Record<EmployeeStatusFilter, number> = {
  blocked: 0,
  failed: 1,
  configuration: 2,
  running: 3,
  idle: 4,
  all: 5,
};

function latestTimestamp(values: Array<string | undefined>): string | undefined {
  return values.filter((value): value is string => Boolean(value)).sort().at(-1);
}

function workTaskHref(workTaskId: string): string {
  return `/app/tasks?workTaskId=${encodeURIComponent(workTaskId)}`;
}

function sessionHref(session: RuntimeSessionRecord): string {
  return `/app/sessions?employeeId=${encodeURIComponent(session.employeeId)}&sessionId=${encodeURIComponent(session.id)}`;
}

function buildWorkRunItem(run: WorkRunRecord, task?: ScheduledWorkTaskRecord): EmployeeStatusCurrentItem {
  return {
    kind: "work-run",
    id: run.id,
    title: task?.title || run.id,
    status: run.status,
    updatedAt: run.updatedAt,
    summary: run.blockedReason || run.failedReason || run.resultSummary,
    href: workTaskHref(run.workTaskId),
  };
}

function buildSessionItem(session: RuntimeSessionRecord): EmployeeStatusCurrentItem {
  return {
    kind: "session",
    id: session.id,
    title: session.title || session.sceneType,
    status: session.status,
    updatedAt: session.updatedAt,
    summary: session.summary,
    href: sessionHref(session),
  };
}

function buildTopicItem(topic: ChannelTopic): EmployeeStatusCurrentItem {
  return {
    kind: "topic",
    id: topic.id,
    title: `Topic ${topic.id}`,
    status: "owned",
    updatedAt: topic.lastActivityAt,
    summary: `Owner: ${topic.ownerId}`,
  };
}

function buildWorkTaskItem(task: ScheduledWorkTaskRecord): EmployeeStatusCurrentItem {
  return {
    kind: "work-task",
    id: task.id,
    title: task.title,
    status: task.status,
    updatedAt: task.updatedAt,
    summary: task.nextRunAt ? `Next run: ${task.nextRunAt}` : undefined,
    href: workTaskHref(task.id),
  };
}

function detailItems(items: Array<[label: string, value: string | undefined]>): Array<[label: string, value: string]> {
  return items
    .filter((item): item is [string, string] => Boolean(item[1]))
    .map(([label, value]) => [label, value]);
}

function latestByUpdatedAt<T extends { updatedAt: string }>(items: T[]): T | undefined {
  return [...items].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).at(0);
}

function mostRelevantWorkRun(runs: WorkRunRecord[]): WorkRunRecord | undefined {
  return latestByUpdatedAt(runs.filter((run) => run.status === "in_progress")) ||
    latestByUpdatedAt(runs.filter((run) => run.status === "blocked")) ||
    latestByUpdatedAt(runs.filter((run) => run.status === "queued")) ||
    latestByUpdatedAt(runs);
}

function latestLeaseForWorkRun(
  leases: WorkDispatchLeaseRecord[],
  workRunId: string | undefined,
): WorkDispatchLeaseRecord | undefined {
  if (!workRunId) {
    return undefined;
  }
  return leases
    .filter((lease) => lease.workRunId === workRunId)
    .sort((left, right) =>
      right.dispatchedAt.localeCompare(left.dispatchedAt) || right.id.localeCompare(left.id)
    )[0];
}

function mostRelevantRuntimeSession(sessions: RuntimeSessionRecord[]): RuntimeSessionRecord | undefined {
  return latestByUpdatedAt(sessions.filter((session) => session.status === "running")) ||
    latestByUpdatedAt(sessions.filter((session) => session.status === "failed" || session.status === "interrupted")) ||
    latestByUpdatedAt(sessions);
}

function buildDetailSections(input: {
  tasks: ScheduledWorkTaskRecord[];
  runs: WorkRunRecord[];
  sessions: RuntimeSessionRecord[];
  dispatchLeases: WorkDispatchLeaseRecord[];
  topics: ChannelTopic[];
  taskById: Map<string, ScheduledWorkTaskRecord>;
}): EmployeeStatusDetailSection[] {
  const currentRun = mostRelevantWorkRun(input.runs);
  const currentRunTask = currentRun ? input.taskById.get(currentRun.workTaskId) : undefined;
  const latestLease = latestLeaseForWorkRun(input.dispatchLeases, currentRun?.id);
  const activeTask = latestByUpdatedAt(input.tasks.filter((task) => task.status === "active"));
  const runningSession = latestByUpdatedAt(input.sessions.filter((session) => session.status === "running"));
  const runtimeSession = mostRelevantRuntimeSession(input.sessions);
  const failedSession = latestByUpdatedAt(
    input.sessions.filter((session) => session.status === "failed" || session.status === "interrupted"),
  );
  const topics = [...input.topics].sort((left, right) =>
    right.lastActivityAt.localeCompare(left.lastActivityAt)
  );

  return [
    {
      id: "current-work-run",
      title: "Current WorkRun",
      summary: currentRun
        ? "Most relevant current WorkRun assigned to this employee."
        : "No current WorkRun is assigned to this employee.",
      items: currentRun
        ? detailItems([
            ["WorkRun", currentRun.id],
            ["Status", currentRun.status],
            ["WorkTask", currentRun.workTaskId],
            ["Title", currentRunTask?.title],
            ["Persisted WorkRun status", currentRun.status],
            ["Runtime session evidence", runtimeSession?.status || "not_observed"],
            ["Dispatch lease evidence", latestLease?.status || "not_observed"],
            ["Latest event / updated", currentRun.updatedAt],
            ["Blocked reason", currentRun.blockedReason],
            ["Failed reason", currentRun.failedReason],
            ["Updated", currentRun.updatedAt],
          ])
        : [],
      links: currentRun ? [{ label: "Open Task", href: workTaskHref(currentRun.workTaskId) }] : [],
    },
    {
      id: "active-work-task",
      title: "Active WorkTask",
      summary: activeTask
        ? "Most recent active WorkTask owned by this employee."
        : "No active WorkTask is owned by this employee.",
      items: activeTask
        ? detailItems([
            ["WorkTask", activeTask.id],
            ["Status", activeTask.status],
            ["Schedule", activeTask.scheduleKind],
            ["Acceptance", activeTask.acceptanceCriteria],
            ["Next run", activeTask.nextRunAt],
            ["Updated", activeTask.updatedAt],
          ])
        : [],
      links: activeTask ? [{ label: "Open WorkTask", href: workTaskHref(activeTask.id) }] : [],
    },
    {
      id: "running-session",
      title: "Running Session",
      summary: runningSession
        ? "Current running runtime session for this employee."
        : "No running runtime session is currently recorded.",
      items: runningSession
        ? detailItems([
            ["Session", runningSession.id],
            ["Scene", runningSession.sceneType],
            ["Status", runningSession.status],
            ["Summary", runningSession.summary],
            ["Updated", runningSession.updatedAt],
          ])
        : [],
      links: runningSession ? [{ label: "Open Session", href: sessionHref(runningSession) }] : [],
    },
    {
      id: "failed-session",
      title: "Failed or Interrupted Session",
      summary: failedSession
        ? "Most recent failed or interrupted runtime session for this employee."
        : "No failed or interrupted runtime session is currently recorded.",
      items: failedSession
        ? detailItems([
            ["Session", failedSession.id],
            ["Scene", failedSession.sceneType],
            ["Status", failedSession.status],
            ["Summary", failedSession.summary],
            ["Updated", failedSession.updatedAt],
          ])
        : [],
      links: failedSession ? [{ label: "Open Session", href: sessionHref(failedSession) }] : [],
    },
    {
      id: "topics-in-hand",
      title: "Topics in Hand",
      summary: topics.length
        ? "Channel Topics currently owned by this employee."
        : "No Channel Topic is currently owned by this employee.",
      items: topics.slice(0, 5).map((topic) => [
        `Topic ${topic.id}`,
        `${topic.roomId || topic.conversationId || topic.id} updated ${topic.lastActivityAt}`,
      ]),
      links: topics.slice(0, 5)
        .map((topic) => ({
          label: `Open Topic ${topic.roomId || topic.conversationId || topic.id}`,
          href: `/app/chat/${encodeURIComponent(topic.roomId || topic.conversationId || topic.id)}`,
        })),
    },
  ];
}

function currentItemsFor(input: {
  tasks: ScheduledWorkTaskRecord[];
  runs: WorkRunRecord[];
  sessions: RuntimeSessionRecord[];
  topics: ChannelTopic[];
  taskById: Map<string, ScheduledWorkTaskRecord>;
}): EmployeeStatusCurrentItem[] {
  const blockedRuns = input.runs
    .filter((run) => run.status === "blocked")
    .map((run) => buildWorkRunItem(run, input.taskById.get(run.workTaskId)));
  const runningSessions = input.sessions
    .filter((session) => session.status === "running")
    .map(buildSessionItem);
  const ownedTopics = input.topics.map(buildTopicItem);
  const activeRuns = input.runs
    .filter((run) => activeWorkRunStatuses.has(run.status) && run.status !== "blocked")
    .map((run) => buildWorkRunItem(run, input.taskById.get(run.workTaskId)));
  const activeTasks = input.tasks
    .filter((task) => task.status === "active")
    .map(buildWorkTaskItem);

  return [
    ...runningSessions,
    ...activeRuns,
    ...blockedRuns,
    ...ownedTopics,
    ...activeTasks,
  ]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 3);
}

function statusFilterFor(input: EmployeeStatusCard["load"] & { runtimeModelConfigured: boolean }): EmployeeStatusFilter {
  if (!input.runtimeModelConfigured) return "configuration";
  if (
    input.runningSessionCount > 0 ||
    input.activeWorkRunCount > input.blockedWorkRunCount
  ) {
    return "running";
  }
  if (input.blockedWorkRunCount > 0) return "blocked";
  if (input.recentFailureCount > 0) return "failed";
  if (input.topicInHandCount > 0 || input.activeWorkTaskCount > 0) return "running";
  return "idle";
}

function issuesFor(input: {
  runs: WorkRunRecord[];
  sessions: RuntimeSessionRecord[];
  taskById: Map<string, ScheduledWorkTaskRecord>;
}): EmployeeStatusIssue[] {
  const blockedRunIssues = input.runs
    .filter((run) => run.status === "blocked")
    .map((run): EmployeeStatusIssue => {
      const task = input.taskById.get(run.workTaskId);
      return {
        kind: "blocked-work-run",
        title: task?.title || `WorkRun ${run.id}`,
        summary: run.blockedReason || run.resultSummary || "WorkRun is blocked.",
        status: run.status,
        updatedAt: run.updatedAt,
        target: { kind: "work-run", id: run.id, label: "WorkRun" },
        relatedTarget: { kind: "work-task", id: run.workTaskId, label: task?.title || "WorkTask" },
      };
    });
  const failedRunIssues = input.runs
    .filter((run) => run.status === "failed")
    .map((run): EmployeeStatusIssue => {
      const task = input.taskById.get(run.workTaskId);
      return {
        kind: "failed-work-run",
        title: task?.title || `WorkRun ${run.id}`,
        summary: run.failedReason || run.resultSummary || "WorkRun failed.",
        status: run.status,
        updatedAt: run.updatedAt,
        target: { kind: "work-run", id: run.id, label: "WorkRun" },
        relatedTarget: { kind: "work-task", id: run.workTaskId, label: task?.title || "WorkTask" },
      };
    });
  const failedSessionIssues = input.sessions
    .filter((session) => session.status === "failed" || session.status === "interrupted")
    .map((session): EmployeeStatusIssue => ({
      kind: session.status === "interrupted" ? "interrupted-session" : "failed-session",
      title: session.title || `${session.sceneType} session`,
      summary: session.summary || `${session.sceneType} session ${session.status}.`,
      status: session.status,
      updatedAt: session.updatedAt,
      target: { kind: "session", id: session.id, label: "Session" },
      ...(session.workRunId ? { relatedTarget: { kind: "work-run", id: session.workRunId, label: "WorkRun" } } : {}),
    }));

  return [...blockedRunIssues, ...failedRunIssues, ...failedSessionIssues]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 3);
}

function primaryStatusFor(input: {
  runtimeModelConfigured: boolean;
  blockedWorkRunCount: number;
  runningSessionCount: number;
  inProgressWorkRunCount: number;
  topicInHandCount: number;
  activeWorkRunCount: number;
  activeWorkTaskCount: number;
  updatedAt?: string;
}): EmployeeStatusCard["primaryStatus"] {
  if (!input.runtimeModelConfigured) {
    return {
      kind: "configuration_needed",
      label: "Needs config",
      reason: "Configure a runtime model before this employee can start a PI session.",
      updatedAt: input.updatedAt,
    };
  }
  if (input.runningSessionCount > 0 || input.inProgressWorkRunCount > 0) {
    return {
      kind: "executing",
      label: "Executing",
      reason: "Runtime session or WorkRun is in progress.",
      updatedAt: input.updatedAt,
    };
  }
  if (input.blockedWorkRunCount > 0) {
    return {
      kind: "blocked",
      label: "Blocked",
      reason: "A current WorkRun is waiting for participant input.",
      updatedAt: input.updatedAt,
    };
  }
  if (input.topicInHandCount > 0) {
    return {
      kind: "holding_topic",
      label: "Holding Topic",
      reason: "Channel Topic ownership is currently assigned to this employee.",
      updatedAt: input.updatedAt,
    };
  }
  if (input.activeWorkRunCount > 0 || input.activeWorkTaskCount > 0) {
    return {
      kind: "has_work",
      label: "Has work",
      reason: "Employee owns active WorkTasks or queued WorkRuns.",
      updatedAt: input.updatedAt,
    };
  }
  return {
    kind: "idle",
    label: "Idle",
    reason: "No active runtime facts are assigned to this employee.",
    updatedAt: input.updatedAt,
  };
}

export function buildEmployeeStatusViewModel(
  input: BuildEmployeeStatusViewModelInput,
): EmployeeStatusViewModel {
  const taskById = new Map(input.workTasks.map((task) => [task.id, task] as const));
  const dispatchLeases = input.dispatchLeases || [];
  const status = input.status && statusOrder.includes(input.status) ? input.status : "all";
  const sort = input.sort === "severity" || input.sort === "name" ? input.sort : "recent";
  const cardRows = input.employees
    .filter((employee) => employee.enabled !== false)
    .map((employee): { card: EmployeeStatusCard; status: EmployeeStatusFilter; latestActivityAt: string } => {
      const employeeTasks = input.workTasks.filter((task) => task.ownerMemberId === employee.employeeId);
      const activeTaskIds = new Set(input.workTasks.filter((task) => task.status === "active").map((task) => task.id));
      const employeeRuns = input.workRuns.filter((run) =>
        run.assigneeMemberId === employee.employeeId && activeTaskIds.has(run.workTaskId)
      );
      const historicalEmployeeRuns = input.workRuns.filter((run) => run.assigneeMemberId === employee.employeeId);
      const employeeSessions = input.sessions.filter((session) => session.employeeId === employee.employeeId);
      const employeeTopics = input.channelTopics.filter((topic) => topic.ownerId === employee.employeeId);
      const runningSessions = employeeSessions.filter((session) => session.status === "running");
      const activeRuns = employeeRuns.filter((run) => activeWorkRunStatuses.has(run.status));
      const blockedRuns = employeeRuns.filter((run) => run.status === "blocked");
      const failedRuns = historicalEmployeeRuns.filter((run) => run.status === "failed");
      const failedSessions = employeeSessions.filter((session) => session.status === "failed" || session.status === "interrupted");
      const activeTasks = employeeTasks.filter((task) => task.status === "active");
      const currentRun = mostRelevantWorkRun(employeeRuns);
      const latestLease = latestLeaseForWorkRun(dispatchLeases, currentRun?.id);
      const runtimeSession = mostRelevantRuntimeSession(employeeSessions);
      const runtimeModelConfigured = Boolean(employee.runtime.modelProvider && employee.runtime.modelId);
      const runtimeModelDisplay = runtimeModelConfigured
        ? `${employee.runtime.modelProvider} / ${employee.runtime.modelId}`
        : "configure-runtime-model-first";
      const updatedAt = latestTimestamp([
        ...historicalEmployeeRuns.map((run) => run.updatedAt),
        ...employeeTasks.map((task) => task.updatedAt),
        ...employeeSessions.map((session) => session.updatedAt),
        ...employeeTopics.map((topic) => topic.lastActivityAt),
      ]);

      const load = {
        runningSessionCount: runningSessions.length,
        topicInHandCount: employeeTopics.length,
        activeWorkRunCount: activeRuns.length,
        blockedWorkRunCount: blockedRuns.length,
        activeWorkTaskCount: activeTasks.length,
        recentFailureCount: failedRuns.length + failedSessions.length,
      };

      const card: EmployeeStatusCard = {
        employeeId: employee.employeeId,
        displayName: employee.profile.displayName || employee.employeeId,
        role: employee.profile.role,
        presenceMode: employee.profile.presenceMode,
        runtime: {
          modelProvider: employee.runtime.modelProvider,
          modelId: employee.runtime.modelId,
          modelConfigured: runtimeModelConfigured,
          modelDisplay: runtimeModelDisplay,
          thinkingLevel: employee.runtime.thinkingLevel,
        },
        primaryStatus: primaryStatusFor({
          runtimeModelConfigured,
          ...load,
          inProgressWorkRunCount: employeeRuns.filter((run) => run.status === "in_progress").length,
          updatedAt,
        }),
        evidence: {
          persistedWorkRunStatus: currentRun?.status || "none",
          runtimeSessionStatus: runtimeSession?.status || "not_observed",
          dispatchLeaseStatus: latestLease?.status || "not_observed",
          latestEventAt: updatedAt,
        },
        load,
        currentItems: currentItemsFor({
          tasks: employeeTasks,
          runs: employeeRuns,
          sessions: employeeSessions,
          topics: employeeTopics,
          taskById,
        }),
        issues: issuesFor({
          runs: employeeRuns,
          sessions: employeeSessions,
          taskById,
        }),
      };
      return {
        card,
        status: statusFilterFor({ ...load, runtimeModelConfigured }),
        latestActivityAt: updatedAt || "",
      };
    });
  const statusOptions = statusOrder.map((option) => ({
    id: option,
    label: statusLabels[option],
    count: option === "all" ? cardRows.length : cardRows.filter((row) => row.status === option).length,
  }));
  const visibleRows = (status === "all" ? cardRows : cardRows.filter((row) => row.status === status))
    .sort((left, right) => {
      if (sort === "severity") {
        return severityRank[left.status] - severityRank[right.status] ||
          right.latestActivityAt.localeCompare(left.latestActivityAt) ||
          left.card.displayName.localeCompare(right.card.displayName);
      }
      if (sort === "name") {
        return left.card.displayName.localeCompare(right.card.displayName) ||
          left.card.employeeId.localeCompare(right.card.employeeId);
      }
      return right.latestActivityAt.localeCompare(left.latestActivityAt) ||
        left.card.displayName.localeCompare(right.card.displayName);
    });
  const cards = visibleRows.map((row) => row.card);
  const selectedEmployeeId = input.employeeId || cards[0]?.employeeId;
  const selectedEmployee = cards.find((card) => card.employeeId === selectedEmployeeId) ||
    cardRows.find((row) => row.card.employeeId === selectedEmployeeId)?.card;
  const selectedEmployeeRuns = selectedEmployee
    ? input.workRuns.filter((run) =>
        run.assigneeMemberId === selectedEmployee.employeeId &&
        taskById.get(run.workTaskId)?.status === "active"
      )
    : [];
  const selectedEmployeeTasks = selectedEmployee
    ? input.workTasks.filter((task) => task.ownerMemberId === selectedEmployee.employeeId)
    : [];
  const selectedEmployeeSessions = selectedEmployee
    ? input.sessions.filter((session) => session.employeeId === selectedEmployee.employeeId)
    : [];
  const selectedEmployeeTopics = selectedEmployee
    ? input.channelTopics.filter((topic) => topic.ownerId === selectedEmployee.employeeId)
    : [];
  const selectedEmployeeLeases = selectedEmployee
    ? dispatchLeases.filter((lease) => lease.assigneeMemberId === selectedEmployee.employeeId)
    : [];

  return {
    contract: {
      name: "employee-status",
      version: 1,
      productBoundary: "employee-centered-runtime-status",
    },
    routes: {
      viewModelJsonPath: input.routes?.viewModelJsonPath || "/api/companies/:companyId/employees/status",
    },
    refresh: {
      strategy: "runtime-events",
      reconnectRecovery: true,
    },
    filters: {
      employeeId: input.employeeId,
      status,
      sort,
    },
    statusOptions,
    sortOptions,
    generatedAt: input.generatedAt || new Date().toISOString(),
    employees: cards,
    selected: {
      employeeId: selectedEmployee?.employeeId,
      employee: selectedEmployee,
      detailSections: selectedEmployee
        ? buildDetailSections({
            tasks: selectedEmployeeTasks,
            runs: selectedEmployeeRuns,
            sessions: selectedEmployeeSessions,
            dispatchLeases: selectedEmployeeLeases,
            topics: selectedEmployeeTopics,
            taskById,
          })
        : [],
    },
  };
}
