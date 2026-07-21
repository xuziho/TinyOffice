import type { WorkScheduleRecord, WorkTaskRecord } from "../../work/domain.js";
import { loadEmployeesAdminState } from "../company-config/employees-admin.js";
import {
  openConfiguredPostgresConnection,
  releaseCompanyPostgresConnection,
} from "../company-config/postgres-runtime-connection.js";
import {
  buildEmployeeStatusViewModel,
  type ScheduledWorkTaskRecord,
  type EmployeeStatusFilter,
  type EmployeeStatusSortMode,
  type EmployeeStatusViewModel,
} from "./employee-status-view-model.js";
import { readEmployeeStatusPostgresSnapshot } from "./postgres-employee-status-reader.js";

export interface LoadEmployeeStatusViewModelInput {
  repoRoot: string;
  companyId: string;
  employeeId?: string;
  status?: EmployeeStatusFilter;
  sort?: EmployeeStatusSortMode;
  routes?: {
    viewModelJsonPath?: string;
  };
}

const employeeStatusLoads = new Map<string, Promise<EmployeeStatusViewModel>>();

export function loadEmployeeStatusViewModel(
  input: LoadEmployeeStatusViewModelInput,
): Promise<EmployeeStatusViewModel> {
  const key = JSON.stringify([
    input.repoRoot,
    input.companyId,
    input.employeeId ?? "",
    input.status ?? "",
    input.sort ?? "",
    input.routes ?? {},
  ]);
  const existing = employeeStatusLoads.get(key);
  if (existing) {
    return existing;
  }
  const loading = loadEmployeeStatusViewModelOnce(input).finally(() => {
    if (employeeStatusLoads.get(key) === loading) {
      employeeStatusLoads.delete(key);
    }
  });
  employeeStatusLoads.set(key, loading);
  return loading;
}

async function loadEmployeeStatusViewModelOnce(
  input: LoadEmployeeStatusViewModelInput,
): Promise<EmployeeStatusViewModel> {
  const employeesState = await loadEmployeesAdminState({
    repoRoot: input.repoRoot,
    companyId: input.companyId,
  });
  const postgres = await openConfiguredPostgresConnection(input.repoRoot, { companyId: input.companyId });
  if (!postgres) {
    throw new Error("Employee status storage requires PostgreSQL runtime configuration.");
  }
  try {
    const snapshot = await readEmployeeStatusPostgresSnapshot(postgres.client, input.companyId);
    const scheduleByTaskId = new Map(snapshot.workSchedules.map((schedule) => [schedule.workTaskId, schedule] as const));
    const scheduledWorkTasks = snapshot.workTasks.map((task) => scheduledWorkTaskFromTask(task, scheduleByTaskId.get(task.id)));
    return buildEmployeeStatusViewModel({
      employeeId: input.employeeId,
      status: input.status,
      sort: input.sort,
      employees: employeesState.employees,
      workTasks: scheduledWorkTasks,
      workRuns: snapshot.workRuns,
      dispatchLeases: snapshot.dispatchLeases,
      sessions: snapshot.sessions,
      channelTopics: snapshot.channelTopics,
      routes: input.routes,
    });
  } finally {
    releaseCompanyPostgresConnection({ client: postgres.client, pool: postgres.pool });
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
