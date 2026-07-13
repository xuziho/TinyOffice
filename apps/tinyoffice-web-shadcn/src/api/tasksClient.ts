import type {
  TasksAction,
  TasksRunActionResult,
  TasksSortMode,
  TasksStatusFilter,
  TasksViewModel,
  TinyOfficeCurrentSession,
} from "tinyoffice/frontend-api-contracts";
import { companyTasksPath, companyWorkTaskActionPath } from "./tinyofficePaths";
import { currentSessionHeaders, requestJson, required } from "./tinyofficeRequest";

export interface GetTasksViewModelInput {
  companyId: string;
  status?: TasksStatusFilter;
  sort?: TasksSortMode;
  owner?: string;
  workTaskId?: string;
}

export type WorkTaskLifecycleAction = "cancel" | "archive" | "restore";

export interface ExecuteWorkTaskLifecycleActionInput {
  companyId: string;
  currentSession?: TinyOfficeCurrentSession;
  workTaskId: string;
  action: WorkTaskLifecycleAction;
  reason?: string;
}

export async function getTasksViewModel(input: GetTasksViewModelInput): Promise<TasksViewModel> {
  const params = new URLSearchParams();
  appendParam(params, "status", input.status);
  appendParam(params, "sort", input.sort);
  appendParam(params, "owner", input.owner);
  appendParam(params, "workTaskId", input.workTaskId);
  const query = params.toString();
  const path = companyTasksPath(required(input.companyId, "companyId"));
  return requestJson<TasksViewModel>(query ? `${path}?${query}` : path);
}

export async function executeTasksRunAction(input: {
  path: TasksAction["path"];
  actorMemberId?: string;
  reason?: string;
}): Promise<TasksRunActionResult> {
  return requestJson<TasksRunActionResult>(input.path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...(input.actorMemberId?.trim() ? { actorMemberId: input.actorMemberId.trim() } : {}),
      ...(input.reason?.trim() ? { reason: input.reason.trim() } : {}),
    }),
  });
}

export async function executeWorkTaskLifecycleAction(input: ExecuteWorkTaskLifecycleActionInput): Promise<unknown> {
  const companyId = required(input.companyId, "companyId");
  const workTaskId = required(input.workTaskId, "workTaskId");
  return requestJson<unknown>(companyWorkTaskActionPath(companyId, workTaskId, input.action), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...currentSessionHeaders(input.currentSession, companyId),
    },
    body: JSON.stringify({
      companyId,
      workTaskId,
      confirmation: confirmationForWorkTaskAction(input.action),
      ...(input.reason?.trim() ? { reason: input.reason.trim() } : {}),
    }),
  });
}

function confirmationForWorkTaskAction(action: WorkTaskLifecycleAction): "CANCEL" | "ARCHIVE" | "RESTORE" {
  if (action === "cancel") return "CANCEL";
  if (action === "archive") return "ARCHIVE";
  return "RESTORE";
}

function appendParam(params: URLSearchParams, name: string, value: string | undefined): void {
  const trimmed = value?.trim();
  if (trimmed) {
    params.set(name, trimmed);
  }
}
