import { DbChannelTopicStore } from "../../channel-topics/storage/db-channel-topic-store.js";
import type { WorkScheduleRecord, WorkTaskRecord } from "../../work/domain.js";
import { WorkService } from "../../work/work-service.js";
import { WorkDispatchLeaseRepository } from "../../work/work-dispatch-lease.js";
import { loadEmployeesAdminState } from "../company-config/employees-admin.js";
import { RuntimeSessionRepository } from "../storage/runtime-session-repository.js";
import {
  buildEmployeeStatusViewModel,
  type ScheduledWorkTaskRecord,
  type EmployeeStatusFilter,
  type EmployeeStatusSortMode,
  type EmployeeStatusViewModel,
} from "./employee-status-view-model.js";

export interface LoadEmployeeStatusViewModelInput {
  repoRoot: string;
  companyId: string;
  employeeId?: string;
  status?: EmployeeStatusFilter;
  sort?: EmployeeStatusSortMode;
  routes?: {
    viewModelJsonPath?: string;
  };
  workService?: WorkService;
}

export async function loadEmployeeStatusViewModel(
  input: LoadEmployeeStatusViewModelInput,
): Promise<EmployeeStatusViewModel> {
  const workService = input.workService || new WorkService({ repoRoot: input.repoRoot, companyId: input.companyId });
  const [employeesState, workTasks, workSchedules, workRuns, channelTopicStore] = await Promise.all([
    loadEmployeesAdminState({
      repoRoot: input.repoRoot,
      companyId: input.companyId,
    }),
    workService.listWorkTasks(),
    workService.listWorkSchedules(),
    workService.listWorkRuns(),
    DbChannelTopicStore.open({ repoRoot: input.repoRoot, companyId: input.companyId }),
  ]);
  const scheduleByTaskId = new Map(workSchedules.map((schedule) => [schedule.workTaskId, schedule] as const));
  const scheduledWorkTasks = workTasks.map((task) => scheduledWorkTaskFromTask(task, scheduleByTaskId.get(task.id)));

  const runtimeRepository = await RuntimeSessionRepository.open(input.repoRoot, { companyId: input.companyId });
  const leaseRepository = await WorkDispatchLeaseRepository.open(input.repoRoot, { companyId: input.companyId });
  try {
    const channelTopicState = await channelTopicStore.load();
    return buildEmployeeStatusViewModel({
      employeeId: input.employeeId,
      status: input.status,
      sort: input.sort,
      employees: employeesState.employees,
      workTasks: scheduledWorkTasks,
      workRuns,
      dispatchLeases: leaseRepository.listLeases(),
      sessions: runtimeRepository.listSessionRecords(),
      channelTopics: channelTopicState.channelTopics,
      routes: input.routes,
    });
  } finally {
    leaseRepository.close();
    runtimeRepository.close();
    channelTopicStore.close?.();
  }
}

function scheduledWorkTaskFromTask(task: WorkTaskRecord, schedule?: WorkScheduleRecord): ScheduledWorkTaskRecord {
  return {
    ...task,
    scheduleKind: schedule?.kind ?? "immediate",
    timezone: schedule?.timezone,
    scheduleRule: schedule?.scheduleRule,
    nextRunAt: schedule?.nextRunAt,
    lastRunAt: schedule?.lastRunAt,
    runCount: schedule?.runCount ?? 0,
    maxRuns: schedule?.maxRuns,
    canceledReason: schedule?.canceledReason ?? task.canceledReason,
    updatedAt: task.updatedAt > (schedule?.updatedAt ?? "") ? task.updatedAt : (schedule?.updatedAt ?? task.updatedAt),
    completedAt: task.completedAt ?? schedule?.completedAt,
  };
}
