import { OperatingLogService } from "../operating-log/operating-log-service.js";
import { loadCompanyMemberDirectory } from "../runtime/members/company-member-directory.js";
import type { WorkScheduleRecord, WorkTaskRecord } from "./domain.js";
import { WorkDispatchLeaseService } from "./work-dispatch-lease.js";
import {
  buildTasksViewModel,
  type TasksViewModel,
  type TasksViewModelOptions,
  type TasksViewState,
} from "./tasks-view-model.js";
import { WorkService } from "./work-service.js";

export interface LoadTasksViewStateInput {
  repoRoot: string;
  companyId: string;
  requestUrl: URL;
  workService?: WorkService;
  workDispatchLeaseService?: WorkDispatchLeaseService;
  operatingLogService?: OperatingLogService;
}

export interface LoadTasksViewModelInput extends LoadTasksViewStateInput {
  routes?: TasksViewModelOptions["routes"];
}

function tasksContractError(message: string): Error & { statusCode: number } {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = 400;
  return error;
}

function rejectRetiredTasksSelectionParams(requestUrl: URL): void {
  if (requestUrl.searchParams.has("workRunId")) {
    throw tasksContractError("Tasks view only supports workTaskId selection. Retired workRunId selection is not supported.");
  }
  if (requestUrl.searchParams.has("workScheduleId")) {
    throw tasksContractError("Tasks view only supports workTaskId selection. Retired workScheduleId selection is not supported.");
  }
}

export async function loadTasksViewState(
  input: LoadTasksViewStateInput,
): Promise<TasksViewState> {
  rejectRetiredTasksSelectionParams(input.requestUrl);
  const workService = input.workService || new WorkService({ repoRoot: input.repoRoot, companyId: input.companyId });
  const workDispatchLeaseService =
    input.workDispatchLeaseService || new WorkDispatchLeaseService({ repoRoot: input.repoRoot, companyId: input.companyId });
  const operatingLogService =
    input.operatingLogService || new OperatingLogService({ repoRoot: input.repoRoot, companyId: input.companyId });
  const ownerFilter = input.requestUrl.searchParams.get("owner") || undefined;
  const selectedWorkTaskId = input.requestUrl.searchParams.get("workTaskId") || undefined;
  const tasks = await workService.listWorkTasks({
    ownerMemberId: ownerFilter,
  });
  const taskById = new Map(tasks.map((task) => [task.id, task] as const));
  const schedules = await workService.listWorkSchedules();
  const scheduleByTaskId = new Map<string, WorkScheduleRecord>();
  for (const schedule of schedules) {
    if (!scheduleByTaskId.has(schedule.workTaskId)) {
      scheduleByTaskId.set(schedule.workTaskId, schedule);
    }
  }
  const runs = await workService.listWorkRuns();
  const runRows = await Promise.all(runs.map(async (run) => {
    const task = taskById.get(run.workTaskId) ||
      (await workService.getWorkTaskDetail(run.workTaskId))?.task;
    return {
      run,
      task,
      schedule: scheduleByTaskId.get(run.workTaskId),
      latestLease: await workDispatchLeaseService.getLatestLeaseForWorkRun(run.id),
    };
  }));
  const selectedTaskDetail = selectedWorkTaskId
    ? await workService.getWorkTaskDetail(selectedWorkTaskId)
    : undefined;
  const recentOperatingEvents = await operatingLogService.listEvents({ limit: 8 });
  return {
    state: {
      tasks,
      schedules,
      runs: runRows,
      ownerFilter,
      selectedWorkTaskId,
      selectedTaskDetail,
    },
    summary: {
      activeCount: runs.filter((run) => run.status === "in_progress").length,
      blockedCount: runs.filter((run) => run.status === "blocked").length,
      dispatchFailedCount: runRows.filter((row) =>
        row.run.status === "queued" && row.latestLease?.status === "failed"
      ).length,
      recentOperatingEvents,
    },
  };
}

export async function loadTasksViewModel(
  input: LoadTasksViewModelInput,
): Promise<TasksViewModel> {
  const [state, memberDirectory] = await Promise.all([
    loadTasksViewState(input),
    loadCompanyMemberDirectory(input.repoRoot, { companyId: input.companyId }),
  ]);
  return buildTasksViewModel(state, {
    requestUrl: input.requestUrl,
    routes: input.routes,
    memberProfiles: memberDirectory.members,
  });
}
